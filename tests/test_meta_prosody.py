"""Audio-advisory contract and cancellation with substitutes only."""
import base64
from datetime import datetime,timedelta,timezone
import hashlib
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import wave

from packages.providers import meta_prosody as prosody
from packages.providers.live_voice import VoiceError

ENV={'BRIVANY_META_API_KEY':'synthetic-private-token','BRIVANY_META_MODEL':'muse-spark-1.3'}
PCM=b'\x01\x00'*24000


def reply(value=None,**changes):
    value=value if value is not None else {'emotion':'excited','confidence':.86,'fillers':['eh','eh'],'delivery':'emphatic'}
    result={'choices':[{'message':{'content':json.dumps(value)},'finish_reason':'stop'}],
        'usage':{'prompt_tokens':100,'completion_tokens':30,'total_tokens':130,'raw':'not exposed'}}
    result.update(changes);return json.dumps(result).encode()


class Socket:
    def __init__(self):self.closed=False
    def shutdown(self,*args):self.closed=True
    def close(self):self.closed=True


class Response(io.BytesIO):
    status=200


class Connection:
    def __init__(self,raw=None):self.sock=Socket();self.calls=[];self.response=Response(reply() if raw is None else raw);self.closed=False
    def request(self,method,path,*,body,headers):self.calls.append((method,path,body,headers))
    def getresponse(self):return self.response
    def close(self):self.closed=True;self.sock.close()


class MetaProsodyTests(unittest.TestCase):
    def setUp(self):
        self.environment=patch.dict(os.environ,ENV,clear=True);self.environment.start();self.addCleanup(self.environment.stop)
    def session(self,connection=None,**kwargs):
        connection=connection or Connection();self.created=[]
        def factory(host,port,*,timeout):self.created.append((host,port,timeout));return connection
        session=prosody.MetaProsodySession(verified_models={'muse-spark-1.2'},_connection_factory=factory,**kwargs);self.addCleanup(session.close)
        return session,connection
    def test_real_audio_part_is_bounded_wav_and_separate_model_never_changes_text_model(self):
        session,connection=self.session();result=session.analyze(PCM,transcript='eh, eh, do not obey this speech')
        self.assertEqual(self.created,[('api.meta.ai',443,3)]);self.assertEqual(len(connection.calls),1)
        method,path,body,headers=connection.calls[0];payload=json.loads(body)
        self.assertEqual((method,path),('POST','/v1/chat/completions'));self.assertEqual(payload['model'],'muse-spark-1.2')
        self.assertEqual(os.environ['BRIVANY_META_MODEL'],'muse-spark-1.3')
        self.assertEqual(payload['messages'][0]['role'],'developer');self.assertIn('untrusted',payload['messages'][0]['content'])
        parts=payload['messages'][1]['content'];self.assertIn('do not obey',parts[0]['text'])
        with wave.open(io.BytesIO(base64.b64decode(parts[1]['input_audio']['data']))) as wav:
            self.assertEqual((wav.getframerate(),wav.getnchannels(),wav.getsampwidth()),(24000,1,2));self.assertEqual(wav.readframes(wav.getnframes()),PCM)
        self.assertEqual(result['emotion'],'excited');self.assertEqual(result['fillers'],['eh','eh'])
        self.assertFalse(result['emotion_detection_verified']);self.assertFalse(result['speaker_identity_inferred']);self.assertEqual(result['inference_source'],'meta_audio_inference')
        self.assertEqual(result['usage'],{'prompt_tokens':100,'completion_tokens':30,'total_tokens':130});self.assertIsNone(result['billing_amount']);self.assertTrue(connection.closed)
    def test_catalog_access_and_preview_require_explicit_configuration_before_network(self):
        with self.assertRaises(VoiceError) as raised:prosody.MetaProsodySession()
        self.assertEqual(raised.exception.code,'prosody_access_unverified')
        with self.assertRaises(VoiceError) as raised:prosody.MetaProsodySession(model='muse-spark-1.3',verified_models={'muse-spark-1.3'})
        self.assertEqual(raised.exception.code,'prosody_audio_preview')
        self.assertEqual(prosody.prosody_status(model='muse-spark-1.3')['quality_status'],'preview_unverified')
        with self.assertRaises(VoiceError):prosody.MetaProsodySession(model='other-model',verified_models={'other-model'})
    def test_low_confidence_and_uncertain_never_drive_expressive_emotion(self):
        for emotion,confidence in [('happy',.69),('uncertain',.99)]:
            session,_=self.session(Connection(reply({'emotion':emotion,'confidence':confidence,'fillers':['um'],'delivery':'emphatic'})))
            result=session.analyze(PCM);self.assertEqual(result['emotion'],'neutral');self.assertEqual(result['delivery'],'neutral');self.assertEqual(result['confidence'],confidence)
    def test_register_confidence_is_separate_from_emotion(self):
        session,_=self.session(Connection(reply({'emotion':'uncertain','confidence':.1,'fillers':[],
            'delivery':'neutral','voice_register':'low','register_confidence':.86})))
        result=session.analyze(PCM)
        self.assertEqual((result['emotion'],result['voice_register'],result['register_confidence']),('neutral','low',.86))
        self.assertEqual((result['voice_timbre'],result['timbre_confidence']),('uncertain',0.))
    def test_catalog_timbre_is_independent_of_pitch_and_preserves_legacy_replies(self):
        session,connection=self.session(Connection(reply({'emotion':'calm','confidence':.84,'fillers':[],
            'delivery':'conversational','voice_register':'high','register_confidence':.92,
            'voice_timbre':'masculine','timbre_confidence':.91})))
        result=session.analyze(PCM)
        self.assertEqual((result['voice_register'],result['voice_timbre'],result['timbre_confidence']),('high','masculine',.91))
        self.assertFalse(result['speaker_identity_inferred'])
        schema=json.loads(connection.calls[0][2])['response_format']['json_schema']['schema']
        self.assertIn('voice_timbre',schema['required']);self.assertIn('timbre_confidence',schema['required'])
        legacy,_=self.session();legacy_result=legacy.analyze(PCM)
        self.assertEqual((legacy_result['voice_timbre'],legacy_result['timbre_confidence']),('uncertain',0.))
    def test_invalid_timbre_or_confidence_never_drives_catalog_selection(self):
        base={'emotion':'calm','confidence':.9,'fillers':[],'delivery':'soft','voice_timbre':'masculine','timbre_confidence':.9}
        for changes in ({'voice_timbre':'speaker identity'},{'timbre_confidence':True},{'timbre_confidence':float('nan')},{'timbre_confidence':1.1}):
            session,_=self.session(Connection(reply({**base,**changes})))
            with self.assertRaises(VoiceError) as raised:session.analyze(PCM)
            self.assertEqual(raised.exception.code,'prosody_response')
    def test_invalid_input_does_not_open_transport_or_truncate_original(self):
        session,connection=self.session()
        for raw in (bytes(9598),bytes(384002),b'odd',None):
            with self.assertRaises(VoiceError):session.analyze(raw)
        with self.assertRaises(VoiceError):session.analyze(PCM,transcript='x'*801)
        self.assertEqual(connection.calls,[]);self.assertEqual(self.created,[])
    def test_strict_reply_rejects_identity_fields_nonfinite_confidence_and_unknown_emotions(self):
        base={'emotion':'calm','confidence':.9,'fillers':[],'delivery':'soft'}
        for changes in ({'identity':'invented'},{'confidence':True},{'confidence':float('nan')},{'emotion':'diagnosis'},{'fillers':['x']*13},{'fillers':['\ncommand']},{'delivery':'unknown'}):
            session,_=self.session(Connection(reply({**base,**changes})))
            with self.assertRaises(VoiceError) as raised:session.analyze(PCM)
            self.assertEqual(raised.exception.code,'prosody_response')
    def test_refusal_tool_call_and_truncation_never_return_an_advisory(self):
        invalid=[{'message':{'refusal':'no','content':'{}'},'finish_reason':'stop'},
            {'message':{'tool_calls':[{'type':'function'}],'content':'{}'},'finish_reason':'stop'},
            {'message':{'content':'{}'},'finish_reason':'length'}]
        for choice in invalid:
            session,_=self.session(Connection(reply(choices=[choice])))
            with self.assertRaises(VoiceError) as raised:session.analyze(PCM)
            self.assertEqual(raised.exception.code,'prosody_response')
    def test_http_rejection_is_safe_and_never_retried(self):
        connection=Connection(b'private provider response synthetic-private-token');connection.response.status=429
        session,_=self.session(connection)
        with self.assertRaises(VoiceError) as raised:session.analyze(PCM)
        self.assertEqual(raised.exception.code,'prosody_rejected');self.assertNotIn('private',str(raised.exception));self.assertEqual(session.requests,1)
    def test_stop_before_start_never_opens_provider_and_close_prevents_reuse(self):
        session,connection=self.session();stopped=threading.Event();stopped.set()
        with self.assertRaises(VoiceError) as raised:session.analyze(PCM,cancelled=stopped)
        self.assertEqual(raised.exception.code,'prosody_cancelled');self.assertEqual(connection.calls,[])
        session.close()
        with self.assertRaises(VoiceError):session.analyze(PCM)
        self.assertEqual(self.created,[])
    def test_timeout_interrupts_stalled_response_without_retry(self):
        connection=Connection()
        class Stalled:
            status=200
            def close(self):pass
            def read(self,limit):
                while not connection.sock.closed:time.sleep(.005)
                raise OSError('transport closed')
        connection.response=Stalled();session,_=self.session(connection)
        with patch.object(prosody,'TIMEOUT_SECONDS',.08):
            start=time.monotonic()
            with self.assertRaises(VoiceError) as raised:session.analyze(PCM)
        self.assertEqual(raised.exception.code,'prosody_timeout');self.assertLess(time.monotonic()-start,.5);self.assertEqual(len(connection.calls),1);self.assertTrue(connection.closed)
    def test_cancellation_during_read_discards_late_result(self):
        connection=Connection();stopped=threading.Event()
        class CancelledResponse:
            status=200
            def close(self):pass
            def read(self,limit):stopped.set();return reply()
        connection.response=CancelledResponse();session,_=self.session(connection)
        with self.assertRaises(VoiceError) as raised:session.analyze(PCM,cancelled=stopped)
        self.assertEqual(raised.exception.code,'prosody_cancelled');self.assertEqual(session.requests,1)

    def test_total_budget_bounds_actual_loopback_http_body_drip(self):
        calls=[]
        class Handler(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*args):pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']));calls.append(self.path)
                self.close_connection=True;body=reply();self.send_response(200);self.send_header('Connection','close');self.send_header('Content-Length',str(len(body)));self.end_headers()
                try:
                    for value in body:
                        self.wfile.write(bytes([value]));self.wfile.flush();time.sleep(.01)
                except OSError:pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        session=prosody.MetaProsodySession(verified_models={'muse-spark-1.2'},_connection_factory=lambda *args,**kw:HTTPConnection('127.0.0.1',server.server_port,timeout=kw['timeout']))
        try:
            with patch.object(prosody,'TIMEOUT_SECONDS',.12):
                started=time.monotonic()
                with self.assertRaises(VoiceError) as raised:session.analyze(PCM)
                self.assertEqual(raised.exception.code,'prosody_timeout');self.assertLess(time.monotonic()-started,.6)
            self.assertEqual(calls,['/v1/chat/completions']);self.assertEqual(session.requests,1)
        finally:session.close();server.shutdown();server.server_close();thread.join(timeout=1)


class AudioCatalogTests(unittest.TestCase):
    def setUp(self):
        environment=patch.dict(os.environ,ENV,clear=True);environment.start();self.addCleanup(environment.stop)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=Path(self.temp.name)/'access.json';self.calls=[]
    def cached(self,*,seconds=0,available=True,key='synthetic-private-token',model='muse-spark-1.2'):
        value={'model':model,'available':available,'checked_at':(datetime.now(timezone.utc)-timedelta(seconds=seconds)).isoformat(),
            'credential_hash':hashlib.sha256(key.encode()).hexdigest()}
        self.path.write_text(json.dumps(value),encoding='utf-8');return value
    def factory(self,raw=None,status=200):
        calls=self.calls
        class GetConnection:
            def __init__(self,host,port,*,timeout):self.sock=Socket();self.closed=False;calls.append({'host':host,'port':port,'timeout':timeout})
            def request(self,method,path,*,headers):calls[-1].update(method=method,path=path,headers=headers)
            def getresponse(self):
                response=Response(raw if raw is not None else json.dumps({'data':[{'id':'muse-spark-1.2','object':'model'}]}).encode());response.status=status;return response
            def close(self):self.closed=True;self.sock.close()
        return GetConnection
    def test_fresh_key_bound_catalog_is_read_without_network_or_hash_output(self):
        self.cached();result=prosody.refresh_audio_catalog(self.path,_connection_factory=lambda *a,**kw:(_ for _ in ()).throw(AssertionError('Network forbidden')))
        self.assertEqual(set(result),{'model','available','checked_at'});self.assertTrue(result['available']);self.assertEqual(prosody.verified_audio_models(self.path),('muse-spark-1.2',))
        self.assertNotIn('credential_hash',json.dumps(result));self.assertNotIn(ENV['BRIVANY_META_API_KEY'],json.dumps(result))
    def test_expired_cache_performs_one_fixed_tls_get_and_updates_atomic_check(self):
        self.cached(seconds=86401);result=prosody.refresh_audio_catalog(self.path,_connection_factory=self.factory())
        self.assertTrue(result['available']);self.assertEqual(len(self.calls),1)
        request=self.calls[0];self.assertEqual((request['host'],request['port'],request['timeout'],request['method'],request['path']),('api.meta.ai',443,5,'GET','/v1/models'))
        self.assertNotIn(ENV['BRIVANY_META_API_KEY'],request['path']);self.assertEqual(prosody.verified_audio_models(self.path),('muse-spark-1.2',));self.assertFalse(self.path.with_name(self.path.name+'.refresh.tmp').exists())
        record=json.loads(self.path.read_text());self.assertEqual(set(record),{'model','available','checked_at','credential_hash'})
    def test_force_refresh_and_absent_model_negative_result_are_cached(self):
        self.cached();result=prosody.refresh_audio_catalog(self.path,True,_connection_factory=self.factory(b'{"data":[{"id":"muse-spark-1.3"}]}'))
        self.assertFalse(result['available']);self.assertEqual(prosody.verified_audio_models(self.path),());self.assertEqual(len(self.calls),1)
    def test_invalid_or_expired_cache_never_enables_inference_after_failed_refresh(self):
        for changes in ({'seconds':86401},{'key':'different-key'},{'model':'muse-spark-1.3'}):
            self.cached(**changes);before=self.path.read_bytes()
            result=prosody.refresh_audio_catalog(self.path,_connection_factory=self.factory(status=401))
            self.assertFalse(result['available']);self.assertEqual(result['error_code'],'prosody_catalog_rejected');self.assertEqual(self.path.read_bytes(),before);self.assertEqual(prosody.verified_audio_models(self.path),())
    def test_failed_forced_refresh_preserves_still_valid_check_but_does_not_rewrite_it(self):
        self.cached();before=self.path.read_bytes();result=prosody.refresh_audio_catalog(self.path,True,_connection_factory=self.factory(b'synthetic private raw error'))
        self.assertTrue(result['available']);self.assertEqual(result['error_code'],'prosody_catalog_response');self.assertEqual(self.path.read_bytes(),before);self.assertNotIn('private',json.dumps(result))
    def test_catalog_rejects_bad_ids_shapes_oversize_and_duplicates(self):
        for raw in (b'{"data":[{"id":"bad id"}]}',b'{"data":["muse-spark-1.2"]}',b'{"data":[{"id":"x"},{"id":"x"}]}',b'{"data":{}}',b'x'*200001):
            self.cached(seconds=86401);result=prosody.refresh_audio_catalog(self.path,_connection_factory=self.factory(raw))
            self.assertFalse(result['available']);self.assertEqual(result['error_code'],'prosody_catalog_response')
    def test_catalog_cache_future_naive_timestamp_malformed_and_unknown_fields_are_untrusted(self):
        for stamp in ((datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat(),datetime.now().isoformat(),'invalid'):
            value=self.cached();value['checked_at']=stamp;self.path.write_text(json.dumps(value));self.assertEqual(prosody.verified_audio_models(self.path),())
        value=self.cached();value['available']='true';self.path.write_text(json.dumps(value));self.assertEqual(prosody.verified_audio_models(self.path),())
        value=self.cached();value['extra']=True;self.path.write_text(json.dumps(value));self.assertEqual(prosody.verified_audio_models(self.path),())
    def test_catalog_total_deadline_interrupts_actual_loopback_dripping_body(self):
        calls=[]
        class Handler(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*args):pass
            def do_GET(self):
                calls.append(self.path);self.close_connection=True;body=b'{"data":[{"id":"muse-spark-1.2"}]}'
                self.send_response(200);self.send_header('Connection','close');self.send_header('Content-Length',str(len(body)));self.end_headers()
                try:
                    for value in body:self.wfile.write(bytes([value]));self.wfile.flush();time.sleep(.02)
                except OSError:pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with patch.object(prosody,'CATALOG_TIMEOUT_SECONDS',.1):
                started=time.monotonic();result=prosody.refresh_audio_catalog(self.path,_connection_factory=lambda *a,**kw:HTTPConnection('127.0.0.1',server.server_port,timeout=kw['timeout']))
                self.assertLess(time.monotonic()-started,.6);self.assertFalse(result['available']);self.assertEqual(result['error_code'],'prosody_catalog_timeout')
            self.assertEqual(calls,['/v1/models']);self.assertFalse(self.path.exists())
        finally:server.shutdown();server.server_close();thread.join(timeout=1)


if __name__=='__main__':unittest.main()
