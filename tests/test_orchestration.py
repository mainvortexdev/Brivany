"""Local fixtures: prove concurrency, review and cancellation, not AI quality."""
import base64
from io import BytesIO
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4
from PIL import Image
from services.computer.service import ComputerService
from services.computer.planner import MetaPlanner
from services.orchestration.team import validate_team
from services.orchestration.meta import MetaTools
from services.orchestration.results import ResultViewer
from services.orchestration.research_delivery import research_output,answer_without_citations
from packages.providers.conversation import ConversationRequest

def task(key='t1',kind='document',after=None):return {'key':key,'kind':kind,'title':'Agente '+key,'instruction':'Muestra propia '+key,'criteria':['Contenido solicitado'],'after':after or []}
class Runtime:
 source=Path('.')
 def __init__(self):self.calls=[]
 def availability(self):return {'available':True}
 def call(self,method,**kwargs):self.calls.append(method);return {'windows':[]} if method=='observe' else {'verified':True}
 def cancel(self):pass
 def close(self):pass
class Planner:
 def __init__(self):self.documents=[];self.reviews=[];self.reject_first=False;self.doc_hook=None;self.inputs=[];self.authorizations=[]
 def route(self,value,cancelled=None):return {'kind':'chat','goal':value.text}
 def generate(self,prompt,data,**kwargs):
  if 'Eres Melodi revisando' in prompt:
   self.reviews.append(data);accepted=not self.reject_first or len(self.reviews)>1
   return {'accepted':accepted,'checks':[{'index':i,'passed':accepted,'evidence':'Observación de fixture'} for i in range(len(data['criteria']))],'correction':'' if accepted else 'Añade el detalle concreto que falta.'}
  if 'agente de redacción' in prompt:
   self.documents.append(data['goal']);self.inputs.append(data.get('previous_agent_results_data'));self.authorizations.append(data.get('authorized_user_request'))
   if self.doc_hook:self.doc_hook()
   return {'title':'Documento de prueba','body':'Contenido propio completo: '+data['goal']}
  return {'done':True} if data.get('completed_steps') else {'done':False,'step':{'action':'write_note','params':{'name':'fixture.txt','text':'Muestra propia'}}}
class Tools:
 def __init__(self,plan):self.tasks=plan;self.image_hook=None
 def plan(self,goal,catalog,cancelled,charge):charge();return self.tasks
 def image(self,prompt,directory,identifier,cancelled,charge,images=None):
  charge()
  if self.image_hook:self.image_hook(cancelled)
  if cancelled.is_set():raise ValueError('Cancelada')
  directory.mkdir(parents=True,exist_ok=True);path=directory/(identifier+'.png');Image.new('RGB',(256,256),'#86abcf').save(path)
  return {'path':str(path),'verified':True,'width':256,'height':256}

class Teams(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.planner=Planner();self.runtime=Runtime()
  self.service=ComputerService('http://127.0.0.1:1',lambda:SimpleNamespace(root=self.root/'spatial'),root=self.root/'computer',planner=self.planner,runtime=self.runtime,native=True)
  self.token=self.service.arm()['token']
 def tearDown(self):self.service.close();self.temp.cleanup()
 def start(self,plan):
  tools=Tools(plan);self.service.orchestrator.tools=tools
  parent=self.service.enqueue('orchestrator','Petición propia de prueba',self.token);return self.service.jobs[parent['id']],tools
 def wait(self,parent):
  self.assertTrue(parent['finished'].wait(12),'Coordinator did not finish');return parent
 def test_same_specialty_runs_in_parallel_and_every_result_is_reviewed(self):
  arrived=threading.Barrier(2);self.planner.doc_hook=lambda:arrived.wait(3)
  parent,_=self.start([task('t1'),task('t2')]);self.wait(parent)
  self.assertEqual(parent['state'],'succeeded');self.assertEqual(parent['result']['accepted'],2);self.assertEqual(len(self.planner.reviews),2)
  self.assertTrue(all(self.service.jobs[i]['review_state']=='accepted' for i in parent['children']))
 def test_rejected_artifact_gets_specific_correction_and_a_new_version(self):
  self.planner.reject_first=True;parent,_=self.start([task()]);self.wait(parent)
  self.assertEqual(parent['state'],'succeeded');self.assertEqual(len(parent['children']),2);first,second=[self.service.jobs[i] for i in parent['children']]
  self.assertEqual(first['review_state'],'rejected');self.assertEqual(second['attempt'],2);self.assertIn('Añade el detalle concreto',self.planner.documents[-1])
  self.assertNotEqual(first['result']['path'],second['result']['path']);self.assertTrue(Path(first['result']['path']).is_file())
 def test_review_rejection_never_replays_a_desktop_side_effect(self):
  self.planner.reject_first=True;parent,_=self.start([task(kind='desktop')]);self.wait(parent)
  self.assertEqual(parent['state'],'awaiting_user');self.assertEqual(self.runtime.calls.count('execute'),1);self.assertEqual(len(parent['children']),1)
 def test_dependency_receives_content_only_after_accepted_review(self):
  parent,_=self.start([task('t1'),task('t2',after=['t1'])]);self.wait(parent)
  self.assertEqual(parent['state'],'succeeded');self.assertIn('Contenido propio',json.dumps(self.planner.inputs[-1],ensure_ascii=False));self.assertEqual(self.planner.inputs[0],None)
 def test_team_waits_for_intervention_and_continues_without_replaying_steps(self):
  original=self.planner.generate
  seen=[]
  def generate(prompt,data,**options):
   if 'completed_steps' not in data:return original(prompt,data,**options)
   seen.append(len(data['completed_steps']))
   if len(seen)==2:return {'needs_user':'Cierra el cuadro y pulsa Continuar.'}
   return original(prompt,data,**options)
  self.planner.generate=generate
  parent,_=self.start([task(kind='desktop'),task('t2',after=['t1'])])
  deadline=time.monotonic()+5
  while not parent.get('continuation_id') and time.monotonic()<deadline:time.sleep(.025)
  identifier=parent['continuation_id']
  self.assertTrue(self.service.jobs[identifier]['finished'].wait(2))
  self.assertEqual(self.planner.documents,[])
  self.assertTrue(self.service.native_lane.acquire(timeout=1))
  self.service.native_lane.release()
  self.service.continue_assistant_job(identifier)
  self.wait(parent)
  self.assertEqual(parent['state'],'succeeded')
  self.assertEqual(seen,[0,1,1])
  self.assertEqual(self.runtime.calls.count('execute'),1)
  self.assertEqual(self.runtime.calls.count('observe'),3)
  self.assertEqual(len(self.planner.documents),1)
  with self.assertRaises(ValueError):self.service.continue_assistant_job(identifier)
 def test_cycle_is_rejected_before_any_specialist_runs(self):
  parent,_=self.start([task('t1',after=['t2']),task('t2',after=['t1'])]);self.wait(parent)
  self.assertEqual(parent['state'],'failed');self.assertEqual(self.planner.documents,[]);self.assertEqual([j for j in self.service.jobs.values() if j.get('parent_id')],[])
 def test_chat_remains_available_and_cancelling_parent_cancels_running_children(self):
  entered=threading.Event();tools=Tools([task(kind='image')]);tools.image_hook=lambda cancel:(entered.set(),cancel.wait(8))
  self.service.orchestrator.tools=tools;job=self.service.enqueue('orchestrator','Muestra propia',self.token);parent=self.service.jobs[job['id']];self.assertTrue(entered.wait(3))
  self.service.chat=lambda value,cancelled:iter([{'type':'delta','text':'Conversación simulada disponible'}])
  self.assertEqual(list(self.service.chat_turn(ConversationRequest(text='Hola',consent=True),None))[0]['text'],'Conversación simulada disponible')
  self.service.cancel(parent['id']);self.wait(parent);self.assertEqual(parent['state'],'cancelled');self.assertTrue(all(self.service.jobs[i]['cancelled'].is_set() for i in parent['children']))
 def test_retry_budget_stops_after_second_rejected_version(self):
  original=self.planner.generate
  def generate(prompt,data,**options):
   result=original(prompt,data,**options)
   if 'Eres Melodi revisando' in prompt:result['accepted']=False;result['correction']='Corrige el detalle pendiente';result['checks'][0]['passed']=False
   return result
  self.planner.generate=generate;parent,_=self.start([task()]);self.wait(parent);self.assertEqual(parent['state'],'awaiting_user');self.assertEqual(len(parent['children']),2)
 def test_uncertain_review_is_not_approved_or_automatically_retried(self):
  original=self.planner.generate
  def generate(prompt,data,**options):return {'accepted':True} if 'Eres Melodi revisando' in prompt else original(prompt,data,**options)
  self.planner.generate=generate;parent,_=self.start([task()]);self.wait(parent);self.assertEqual(parent['state'],'awaiting_user');self.assertEqual(len(parent['children']),1)
 def test_team_and_criteria_are_bounded(self):
  for values in [[task()]*2,[task('t'+str(i)) for i in range(1,8)],[{**task(),'criteria':['x'*241]}],[{**task(),'kind':'orchestrator'}]]:
   with self.assertRaises(ValueError):validate_team(values)
 def test_child_cannot_replace_the_original_user_authorization(self):
  parent,_=self.start([{**task(),'instruction':'Instrucción derivada distinta'}]);self.wait(parent)
  child=self.service.jobs[parent['children'][0]]
  # Original content is kept only in memory while running, then removed by
  # ComputerService. Inspect the request that actually reached the planner.
  self.assertEqual(self.planner.documents,['Instrucción derivada distinta'])
  self.assertEqual(self.planner.authorizations,['Petición propia de prueba'])
  self.assertNotIn('Instrucción derivada distinta',json.dumps(child.get('review',{}),ensure_ascii=False))
  self.assertTrue(parent['result']['verified'])
 def test_team_budget_is_shared_across_coordinator_and_agents(self):
  parent,_=self.start([task()]);self.wait(parent);child=self.service.jobs[parent['children'][0]]
  parent['external_calls']=8;child['external_calls']=10
  for _ in range(3):
   identifier=str(uuid4());self.service.jobs[identifier]={**child,'id':identifier,'external_calls':10};parent['children'].append(identifier)
  with self.assertRaisesRegex(ValueError,'presupuesto'):self.service.charge_external(child)
 def test_reviewed_search_returns_answer_and_sources_in_team_result(self):
  parent_tools=Tools([task(kind='research')])
  def research(goal,directory,identifier,cancelled,charge):
   charge()
   directory.mkdir(exist_ok=True)
   path=directory/(identifier+'.md')
   path.write_text('Respuesta pública de prueba con fuente.',encoding='utf-8')
   return {'path':str(path),'verified':True,'web_search_verified':True,
           'message':'Respuesta pública de prueba.',
           'sources':[{'url':'https://example.com/source','title':'Fuente pública'}],
           '_search_evidence':[{'url':'https://example.com/source','snippet':'Fragmento temporal de revisión'}]}
  parent_tools.research=research
  self.service.orchestrator.tools=parent_tools
  parent=self.service.jobs[self.service.enqueue('orchestrator','Consulta propia de prueba',self.token)['id']]
  self.wait(parent)
  self.assertEqual(parent['state'],'succeeded')
  self.assertEqual(parent['result']['message'],'Respuesta pública de prueba.')
  self.assertEqual(parent['result']['sources'][0]['url'],'https://example.com/source')
  packet=research_output(parent['result'])
  self.assertNotIn('path',packet)
  self.assertTrue(packet['web_search_verified'])
  self.assertEqual(self.planner.reviews[0]['evidence']['retrieved_source_excerpts'][0]['snippet'],'Fragmento temporal de revisión')
  saved=(self.service.receipts/(parent['children'][0]+'.json')).read_text(encoding='utf-8')
  self.assertNotIn('Fragmento temporal de revisión',saved)
 def test_research_delivery_rejects_private_or_unverified_citations(self):
  result={'verified':True,'web_search_verified':True,'message':'Prueba',
          'sources':[{'url':'https://127.1/'},{'url':'https://user:pass@example.com/'},
                     {'url':'file:///C:/local'},{'url':'https://example.com/source'}]}
  self.assertEqual(research_output(result)['sources'],[{'url':'https://example.com/source','title':'example.com'}])
  result['web_search_verified']=False
  self.assertEqual(research_output(result),{})
 def test_chat_answer_hides_citations_without_discarding_provenance(self):
  self.assertEqual(answer_without_citations('Respuesta [1]. Consulta [el manual](https://example.com/manual).'), 'Respuesta. Consulta el manual.')
  packet=research_output({'verified':True,'web_search_verified':True,'message':'Respuesta [1].','sources':[],'provider':'Meta web search'})
  self.assertEqual(packet['message'],'Respuesta.');self.assertEqual(packet['sources'],[]);self.assertEqual(packet['provider'],'Meta web search')
 def test_quick_search_uses_one_provider_request_without_planning_or_native_input(self):
  calls=[]
  class Lookup:
   def lookup(inner,goal,cancelled,charge):
    charge();calls.append(goal)
    return {'verified':True,'web_search_verified':True,'message':'Respuesta de prueba sin citas.','sources':[],'provider':'Meta web search'}
  self.service.orchestrator.tools=Lookup()
  with patch.object(self.planner,'route',side_effect=AssertionError('No classifier')):
   events=list(self.service.turn(ConversationRequest(text='Puedes comprobar el clima hoy en Las Terrenas?',consent=True),self.token))
  job=self.service.jobs[next(row['job']['id'] for row in events if row['type']=='computer_task')];self.wait(job)
  self.assertEqual(job['state'],'succeeded');self.assertEqual(len(calls),1);self.assertEqual(job['external_calls'],1)
  self.assertEqual(self.planner.reviews,[]);self.assertEqual(self.runtime.calls,[])
  self.assertEqual(research_output(job['result'])['message'],'Respuesta de prueba sin citas.')
 def test_single_search_keeps_original_relative_date_before_provider_execution(self):
  parent={'goal':'Consulta el clima','user_request':'¿Qué tiempo hará hoy en Las Terrenas?','cancelled':threading.Event()}
  planned={**task(kind='research'),'instruction':'Consulta el día equivocado añadido por el modelo',
           'criteria':['Debe usar una fecha inventada.']}
  self.service.orchestrator.tools=Tools([planned])
  self.service.orchestrator.charge=lambda job:None
  prepared=self.service.orchestrator.prepare_plan(parent)
  self.assertEqual(prepared[0].instruction,parent['user_request'])
  self.assertNotIn('fecha inventada',str(prepared[0].criteria))

class MetaTransport(unittest.TestCase):
 def test_quick_lookup_requires_completed_search_but_not_citation_annotations(self):
  value={'status':'completed','output':[{'type':'web_search_call','status':'completed','results':[{'url':'https://example.com/source','title':'Fuente'}]},{'type':'message','content':[{'type':'output_text','text':'Resultado de prueba.'}]}]}
  captured=self.call(value,lambda tools:self.assertEqual(tools.lookup('Consulta de prueba',threading.Event(),lambda:None)['sources'][0]['url'],'https://example.com/source'))
  body=captured[0][1];self.assertEqual(body['reasoning'],{'effort':'minimal'});self.assertEqual(body['max_tool_calls'],1)
  value['output'].pop(0)
  with self.assertRaises(ValueError):self.call(value,lambda tools:tools.lookup('Consulta de prueba',threading.Event(),lambda:None))
 def test_supervisor_uses_a_complete_structured_meta_tool_result(self):
  captured=[];decision={'accepted':True,'checks':[{'index':0,'passed':True,'evidence':'Contenido de muestra comprobado'}],'correction':''}
  class Opener:
   def open(self,request,timeout):captured.append(json.loads(request.data));return BytesIO(json.dumps({'choices':[{'finish_reason':'tool_calls','message':{'tool_calls':[{'function':{'name':'evaluate_agent','arguments':json.dumps(decision)}}]}}]}).encode())
  with patch.dict(os.environ,{'BRIVANY_META_API_KEY':'own-fixture-not-a-key','BRIVANY_META_MODEL':'muse-spark-1.3'}):
   value=MetaPlanner(Opener()).generate('Fixture review',{},response_schema={'type':'object'})
  self.assertEqual(value,decision);self.assertFalse(captured[0]['parallel_tool_calls']);self.assertEqual(captured[0]['tools'][0]['function']['name'],'evaluate_agent')
 def call(self,value,callback):
  captured=[]
  class Reply(BytesIO):
   def __enter__(self):return self
   def __exit__(self,*args):self.close()
  class Opener:
   def open(self,request,timeout):captured.append((request.full_url,json.loads(request.data)));return Reply(json.dumps(value).encode())
  with patch.dict(os.environ,{'BRIVANY_META_API_KEY':'own-fixture-not-a-real-key','BRIVANY_META_MODEL':'muse-spark-1.3'}):callback(MetaTools(Opener(),page_reader=lambda *args:None))
  return captured
 def test_parallel_tool_arguments_are_complete_and_unknown_tools_are_rejected(self):
  calls=[{'type':'function','function':{'name':'assign_agent','arguments':json.dumps(task(key))}} for key in ['t1','t2']]
  result={'choices':[{'finish_reason':'tool_calls','message':{'tool_calls':calls}}]};charged=[]
  captured=self.call(result,lambda tools:self.assertEqual(len(tools.plan('Own fixture',[],threading.Event(),lambda:charged.append(1))),2))
  self.assertTrue(captured[0][1]['parallel_tool_calls']);self.assertEqual(charged,[1]);calls[0]['function']['name']='run_arbitrary_shell'
  with self.assertRaises(ValueError):self.call(result,lambda tools:tools.plan('fixture',[],threading.Event(),lambda:None))
 def test_image_bytes_are_decoded_and_existing_files_are_never_overwritten(self):
  buffer=BytesIO();Image.new('RGB',(256,256),'blue').save(buffer,'PNG');data={'data':[{'b64_json':base64.b64encode(buffer.getvalue()).decode()}]}
  with tempfile.TemporaryDirectory() as temp:
   captured=self.call(data,lambda tools:self.assertTrue(Path(tools.image('Own image',Path(temp),'fixture',threading.Event(),lambda:None)['path']).is_file()))
   self.assertTrue(captured[0][0].endswith('/images/generations'));self.assertEqual(captured[0][1]['model'],'muse-image-1.0')
   with self.assertRaises(FileExistsError):self.call(data,lambda tools:tools.image('Own image',Path(temp),'fixture',threading.Event(),lambda:None))
 def test_research_requires_actual_search_and_citations(self):
  value={'status':'completed','output':[{'type':'web_search_call','status':'completed'},{'type':'message','content':[{'type':'output_text','text':'Own fixture summary','annotations':[{'type':'url_citation','url':'https://example.com/manual','title':'Own source'}]}]}]}
  with tempfile.TemporaryDirectory() as temp:
   def run(tools):
    result=tools.research('Own question',Path(temp),'fixture',threading.Event(),lambda:None)
    self.assertTrue(result['web_search_verified'])
    self.assertEqual(result['message'],'Own fixture summary')
    self.assertEqual(result['sources'][0]['url'],'https://example.com/manual')
   captured=self.call(value,run)
   self.assertEqual(captured[0][1]['tools'][0]['type'],'web_search')
   self.assertFalse(captured[0][1]['store'])
   value['output'].pop(0)
   attempts=[]
   with self.assertRaisesRegex(ValueError,'sin realizar una búsqueda'):
    self.call(value,lambda tools:tools.research('Own question',Path(temp),'second',threading.Event(),lambda:attempts.append(1)))
   self.assertEqual(attempts,[1,1])
   self.assertFalse((Path(temp)/'second.md').exists())
 def test_research_retries_an_incomplete_answer_and_only_uses_final_citations(self):
  search={'type':'web_search_call','status':'completed'}
  def message(text,*urls):
   return {'type':'message','role':'assistant','status':'completed','content':[{
    'type':'output_text','text':text,'annotations':[{'type':'url_citation','url':url} for url in urls]}]}
  incomplete={'status':'incomplete','output':[search,message('Parcial','https://example.com/partial')]}
  complete={'status':'completed','output':[search,message('Anterior','https://example.com/progress'),
      message('Respuesta final','https://127.0.0.1/private','https://example.com/final')]}
  tools=MetaTools(page_reader=lambda *args:None)
  with tempfile.TemporaryDirectory() as temp,patch.object(tools,'post',side_effect=[incomplete,complete]) as post:
   result=tools.research('Consulta de prueba',Path(temp),'retry',threading.Event(),lambda:None)
   self.assertEqual(result['message'],'Respuesta final')
   self.assertEqual(result['sources'],[{'title':'example.com','url':'https://example.com/final'}])
   self.assertEqual(post.call_count,2)
   self.assertGreater(post.call_args_list[1].args[1]['max_output_tokens'],post.call_args_list[0].args[1]['max_output_tokens'])
 def test_research_can_synthesize_from_actual_hits_when_provider_omits_citations(self):
  retrieved={'status':'completed','output':[{'type':'web_search_call','status':'completed','results':[
   {'type':'text_result','title':'Fuente recuperada','url':'https://example.com/manual','snippet':'La función obtiene un rectángulo.'},
   {'type':'text_result','url':'https://127.1/private','snippet':'No debe usarse.'}
  ]}]}
  final={'choices':[{'finish_reason':'tool_calls','message':{'tool_calls':[{'function':{
      'name':'deliver_search_answer','arguments':json.dumps({'message':'Obtiene un rectángulo.','source_indices':[0]})
  }}]}}]}
  tools=MetaTools(page_reader=lambda *args:None)
  with tempfile.TemporaryDirectory() as temp,patch.object(tools,'post',side_effect=[retrieved,final]) as post:
   result=tools.research('Consulta propia',Path(temp),'grounded',threading.Event(),lambda:None)
   self.assertTrue(result['web_search_verified'])
   self.assertEqual(result['sources'][0]['url'],'https://example.com/manual')
   self.assertEqual(result['_search_evidence'][0]['snippet'],'La función obtiene un rectángulo.')
   supplied=json.loads(post.call_args_list[1].args[1]['messages'][1]['content'])
   self.assertEqual(len(supplied['retrieved_sources']),1)
  bad={'choices':[{'finish_reason':'tool_calls','message':{'tool_calls':[{'function':{
      'name':'deliver_search_answer','arguments':json.dumps({'message':'Dato inventado','source_indices':[8]})
  }}]}}]}
  with tempfile.TemporaryDirectory() as temp,patch.object(tools,'post',side_effect=[retrieved,bad]):
   with self.assertRaisesRegex(ValueError,'fuentes que no se recuperaron'):
    tools.research('Consulta propia',Path(temp),'rejected',threading.Event(),lambda:None)
   self.assertFalse((Path(temp)/'rejected.md').exists())
 def test_cited_page_reader_rejects_private_resolution_and_private_redirects(self):
  from services.orchestration.web_read import read_cited_page
  from urllib.error import HTTPError
  cancel=threading.Event()
  source={'url':'https://example.com/source','title':'Fuente'}
  with patch('services.orchestration.web_read.socket.getaddrinfo',return_value=[
       (2,1,6,'',('127.0.0.1',443))]),patch('services.orchestration.web_read.build_opener') as opener:
   charged=[]
   self.assertIsNone(read_cited_page(source,'Pregunta',cancel,lambda:charged.append(1)))
   opener.return_value.open.assert_not_called()
   self.assertEqual(charged,[])
  with patch('services.orchestration.web_read.socket.getaddrinfo',return_value=[
       (2,1,6,'',('8.8.8.8',443))]),patch('services.orchestration.web_read.build_opener') as opener:
   opener.return_value.open.side_effect=HTTPError(source['url'],302,'redirect',
       {'Location':'http://127.0.0.1/private'},None)
   charged=[]
   self.assertIsNone(read_cited_page(source,'Pregunta',cancel,lambda:charged.append(1)))
   self.assertEqual(opener.return_value.open.call_count,1)
   self.assertEqual(charged,[1])

class Results(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.workspace=Path(self.temp.name)/'workspace';self.workspace.mkdir();self.service=SimpleNamespace(workspace=self.workspace,jobs={});self.reader=ResultViewer(self.service)
 def tearDown(self):self.temp.cleanup()
 def job(self,kind,result,state='succeeded'):
  identifier=str(uuid4());self.service.jobs[identifier]={'id':identifier,'kind':kind,'state':state,'result':result,'title':'Resultado de prueba'};return identifier
 def test_document_is_plain_text_without_an_executable_iframe(self):
  path=self.workspace/'own.txt';path.write_text('Título\n\n<script>no se ejecuta</script>\n'+('texto '*200),encoding='utf-8');value=self.reader.describe(self.job('document',{'path':str(path),'title':'Título'}));self.assertEqual(value['type'],'text');self.assertIn('<script>',value['text']);self.assertNotIn('url',value)
 def test_image_is_decoded_and_returned_without_exposing_a_filesystem_url(self):
  path=self.workspace/'own.png';Image.new('RGB',(256,256),'blue').save(path);value=self.reader.describe(self.job('image',{'path':str(path)}));self.assertEqual(value['type'],'image');self.assertTrue(value['src'].startswith('data:image/jpeg;base64,'));self.assertNotIn('path',value)
 def test_media_ticket_is_scoped_single_use_and_has_no_system_control_grant(self):
  path=self.workspace/'own.wav';path.write_bytes(b'RIFF'+bytes(100));identifier=self.job('media',{'path':str(path),'verified':True});value=self.reader.describe(identifier);self.assertNotIn('grant',value);self.assertEqual(self.reader.media(identifier,value['media_ticket'])[0],path)
  with self.assertRaises(ValueError):self.reader.media(identifier,value['media_ticket'])
 def test_outside_paths_and_unfinished_results_cannot_be_read(self):
  path=Path(self.temp.name)/'outside.txt';path.write_text('Own fixture')
  with self.assertRaises(ValueError):self.reader.describe(self.job('document',{'path':str(path)}))
  with self.assertRaises(ValueError):self.reader.describe(self.job('document',{},state='reviewing'))
 def test_rejected_but_existing_artifact_can_be_opened_for_user_review(self):
  path=self.workspace/'own.txt';path.write_text('Needs revision');value=self.reader.describe(self.job('document',{'path':str(path)},state='awaiting_user'));self.assertEqual(value['text'],'Needs revision')

if __name__=='__main__':unittest.main()
