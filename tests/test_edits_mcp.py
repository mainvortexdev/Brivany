"""Local protocol and editing fixtures. No provider, user project or original media."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from services.edits.client import EditsClient,EditsError
from services.edits.agent import run_edit,LOCAL_TOOLS
from services.computer.skills import LiveSkills


class ProtocolTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.file=Path(self.temp.name)/'mcp.json'
    def tearDown(self):self.temp.cleanup()
    def descriptor(self,**overrides):
        value={'endpoint':'http://127.0.0.1:1234/mcp','token':'a'*43,'pid':123,**overrides};self.file.write_text(json.dumps(value));return value
    def test_descriptor_is_private_local_and_requires_live_process(self):
        self.descriptor();client=EditsClient(self.file,alive=lambda pid:True,launch=False)
        self.assertNotIn('token',client.availability());self.assertNotIn('aaaa',repr(client.descriptor()))
        for patch in [{'endpoint':'https://example.invalid/mcp'},{'endpoint':'http://localhost:1234/mcp'},{'endpoint':'http://127.0.0.1:0/mcp'},{'token':'bad'},{'pid':True}]:
            self.descriptor(**patch)
            with self.subTest(patch=patch),self.assertRaises(EditsError):client.descriptor()
        self.descriptor()
        with self.assertRaises(EditsError):EditsClient(self.file,alive=lambda pid:False).descriptor()
    def test_http_handshake_headers_and_no_replay_after_uncertain_response(self):
        calls=[];token='b'*43;broken=[False]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(handler):
                value=json.loads(handler.rfile.read(int(handler.headers['Content-Length'])));calls.append(value)
                self.assertEqual(handler.headers.get('Authorization'),'Bearer '+token);self.assertIsNone(handler.headers.get('Origin'))
                result={'protocolVersion':'2025-06-18','serverInfo':{'name':'Cognira Edits'}} if value['method']=='initialize' else {'tools':[]} if value['method']=='tools/list' else {'content':[{'type':'text','text':'{"success":true}'}]}
                body=json.dumps({'jsonrpc':'2.0','id':value['id']+int(broken[0]),'result':result}).encode();handler.send_response(200);handler.send_header('Content-Length',str(len(body)));handler.end_headers();handler.wfile.write(body)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            self.descriptor(endpoint='http://127.0.0.1:'+str(server.server_port)+'/mcp',token=token)
            client=EditsClient(self.file,alive=lambda pid:True,launch=False);self.assertEqual(client.tools(),[])
            broken[0]=True
            with self.assertRaises(EditsError):client.call('project_save')
            self.assertEqual(sum(call['method']=='tools/call' for call in calls),1)
            self.descriptor(endpoint='http://127.0.0.1:'+str(server.server_port)+'/mcp',token='c'*43)
            with self.assertRaises(EditsError):client.call('project_save')
            self.assertEqual(len(calls),3)
        finally:server.shutdown();server.server_close();thread.join()
    def test_cancelled_job_sends_cancel_once_and_never_claims_done(self):
        event=threading.Event();calls=[];client=EditsClient(self.file,launch=False)
        def call(name,args,**kwargs):
            calls.append(name)
            if name=='job_status':event.set();return {'status':'running','percent':30}
            return {'success':True}
        client.call=call
        with self.assertRaises(EditsError):client.wait_job('fixture',cancelled=event)
        self.assertEqual(calls,['job_status','job_cancel'])


class EditorFixture:
    def __init__(self):
        self.calls=[];self.path=None;self.sequence='original';self.clips=[{'id':'clip-original','assetId':'asset-1','trackId':'v1','start':0,'in':0,'out':2,'contrast':1}]
        self.definitions=[{'name':name,'inputSchema':{'type':'object'}} for name in ['clip_update','sequence_duplicate','project_save','media_import','export_start','project_get','gmail_send']]
    def start(self,*args):pass
    def tools(self,*args):return self.definitions
    def availability(self):return {'installed':True,'descriptor_ready':True}
    def state(self):return {'project':{'name':'Fixture','sequenceId':self.sequence,'width':320,'height':180,'fps':30,'clips':json.loads(json.dumps(self.clips)),'tracks':[{'id':'v1','type':'video'}],'sequenceDocument':{'sequences':[{'id':'original','name':'Original'},{'id':'copy','name':'Copia'}]}},'assets':[{'id':'asset-1','kind':'video','duration':2}],'path':self.path}
    def call(self,name,args=None,**kwargs):
        args=args or {};self.calls.append((name,args))
        if name=='application_status':return {'project':'Fixture','busy':False}
        if name=='project_get':return self.state()
        if name=='project_save':self.path=args['file'];Path(self.path).write_text(json.dumps(self.state()));return {'success':True}
        if name=='sequence_duplicate':self.sequence='copy';self.clips[0]['id']='clip-copy';return self.state()
        if name=='clip_update':self.clips[0].update(args['patch']);return self.state()
        if name=='export_start':return {'output':'missing.mp4'}
        return {'success':True}


class EditingTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.client=EditorFixture();self.event=threading.Event()
    def tearDown(self):self.temp.cleanup()
    def run_plan(self,decide):return run_edit(self.client,'Edición sintética',job_id='fixture',workspace=self.temp.name,roots=[self.temp.name],selected=[],decide=decide,cancelled=self.event)
    def test_observed_ids_copy_and_verified_save(self):
        steps=iter([{'tool':'sequence_duplicate','arguments':{'id':'original','name':'Copia'}},{'tool':'clip_update','arguments':{'id':'clip-copy','patch':{'contrast':1.08}}},{'done':True}])
        result=self.run_plan(lambda *args:next(steps));self.assertTrue(result['verified']);self.assertFalse(result['semantic_verification']);self.assertTrue(Path(result['project_path']).is_file());self.assertEqual(self.client.clips[0]['contrast'],1.08)
    def test_current_original_sequence_is_not_modified(self):
        with self.assertRaises(EditsError):self.run_plan(lambda *args:{'tool':'clip_update','arguments':{'id':'clip-original','patch':{'contrast':2}}})
        self.assertFalse(any(name=='clip_update' for name,args in self.client.calls))
    def test_unknown_tool_and_account_send_are_not_callable(self):
        for name in ['shell','gmail_send']:
            with self.subTest(name=name),self.assertRaises(EditsError):self.run_plan(lambda *args:{'tool':name,'arguments':{}})
        self.assertFalse(any(name in {'shell','gmail_send'} for name,args in self.client.calls))
    def test_duplicate_mutation_is_not_repeated(self):
        with self.assertRaises(EditsError):self.run_plan(lambda *args:{'tool':'sequence_duplicate','arguments':{'id':'original','name':'Copia'}})
        self.assertEqual(sum(name=='sequence_duplicate' for name,args in self.client.calls),1)
    def test_unselected_media_and_missing_export_are_not_success(self):
        with self.assertRaises(EditsError):self.run_plan(lambda *args:{'tool':'media_import','arguments':{'files':['C:/private/unselected.mp4']}})
        with self.assertRaises(EditsError):self.run_plan(lambda prompt,data:{'tool':'export_start','arguments':{'folder':data['output_folder'],'name':'fixture'}})
    def test_done_without_edit_is_not_success(self):
        with self.assertRaises(EditsError):self.run_plan(lambda *args:{'done':True})
    def test_live_skill_catalog_selects_actual_draft_without_changing_progress(self):
        class Human:
            def library(self):return {'skills':[{'id':'observed-skill','title':'Fixture','objective':'Ensayo'}]}
            def get(self,key):return {'draft':{'title':'Fixture','steps':[{'instruction':'Paso observado'}]},'progress':{'completed_steps':[]}}
        service=LiveSkills(lambda:Human(),None);result=service.run('Guíame',lambda *args:{'operation':'select','id':'observed-skill'})
        self.assertTrue(result['guidance_active']);self.assertEqual(service.context()['context']['progress']['completed_steps'],[])
        self.assertNotIn('gmail_send',LOCAL_TOOLS)

if __name__=='__main__':unittest.main()
