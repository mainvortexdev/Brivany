"""Local classifier policy and background agents; no real voice cloning."""
import json
import os
import threading
import time
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from packages.providers.audio_content import frame_kind
from packages.providers.voice_clone import CartesiaVoiceCloner
from packages.providers.river_translation import SpeakerTracker
from services.work.voice_agents import TranslationVoiceAgents
from services.work.voice_cleanup import VoiceCleanupJournal


class ContentTests(unittest.TestCase):
    def test_background_music_keeps_speech_and_singing_is_excluded(self):
        self.assertEqual(frame_kind({'Speech':.9,'Music':.98,'Singing':.5})['kind'],'speech')
        self.assertEqual(frame_kind({'Speech':.08,'Music':.9,'Singing':.8})['kind'],'singing')
        self.assertEqual(frame_kind({'Speech':.03,'Music':.9})['kind'],'music')
        self.assertEqual(frame_kind({})['kind'],'unknown')


class AgentsTests(unittest.TestCase):
    def setUp(self):
        self.calls=[];self.deleted=[];self.allow=threading.Event();self.allow.set();self.pools=[]
    def tearDown(self):
        self.allow.set()
        for pool in self.pools:
            pool.close()
            for thread in pool.threads:thread.join(3)
    def pool(self,quality=None):
        owner=self
        class Cloner:
            def clone(self,pcm,**options):owner.calls.append(options);owner.allow.wait(2);return {'id':str(uuid4()),'language':'es','access':'private'}
            def delete(self,identifier):owner.deleted.append(identifier)
        class Classifier:
            def classify(self,pcm):return quality or {'kind':'speech','speech_score':.95,'singing_score':0.,'music_score':0.}
        pool=TranslationVoiceAgents(authorized=True,cloner_factory=Cloner,classifier_factory=Classifier);self.pools.append(pool);return pool
    def wait(self,predicate):
        end=time.monotonic()+3
        while time.monotonic()<end:
            if predicate():return
            time.sleep(.01)
        self.fail('Background condition did not finish')
    def speech(self,pool,turn,label,start=0):pool.observe(turn,label,b'\x01\x02'*144000,start,start+6)
    def test_explicit_consent_is_required_before_any_worker(self):
        with self.assertRaises(ValueError):TranslationVoiceAgents(authorized=False)
    def test_clones_once_and_reuses_the_voice_for_only_that_speaker(self):
        pool=self.pool();self.speech(pool,'1','A');self.speech(pool,'2','A',6)
        self.wait(lambda:pool.voice_for('A'));identifier=pool.voice_for('A')
        for n in range(3,8):self.speech(pool,str(n),'A',n*6)
        time.sleep(.1);self.assertEqual(len(self.calls),1);self.assertEqual(pool.voice_for('A'),identifier);self.assertIsNone(pool.voice_for('B'))
        pool.close();self.wait(lambda:identifier in self.deleted);self.assertIsNone(pool.voice_for('A'));self.assertFalse(pool.status()['audio_persisted'])
    def test_speaker_agent_keeps_working_while_clone_request_is_pending(self):
        self.allow.clear();pool=self.pool();self.speech(pool,'1','A');self.speech(pool,'2','A',6);self.wait(lambda:len(self.calls)==1)
        self.speech(pool,'3','B',20);self.speech(pool,'4','B',26)
        self.wait(lambda:len(pool.speakers)==2 and pool.speakers['B']['attempted'])
        self.assertIsNone(pool.voice_for('A'));self.allow.set();self.wait(lambda:pool.voice_for('A') and pool.voice_for('B'));self.assertNotEqual(pool.voice_for('A'),pool.voice_for('B'))
    def test_music_and_overlapping_speakers_never_form_a_clone(self):
        pool=self.pool({'kind':'singing','speech_score':.1,'singing_score':.9,'music_score':.8});self.speech(pool,'1','A');self.speech(pool,'2','A',6)
        self.wait(lambda:pool.speakers.get('A',{}).get('state')=='needs_clean_audio');self.assertEqual(self.calls,[])
        mixed=self.pool();self.speech(mixed,'a','A');self.speech(mixed,'b','B',3);self.wait(lambda:mixed.speakers.get('B',{}).get('tainted'))
        self.assertTrue(mixed.speakers['A']['tainted']);self.assertEqual(mixed.speakers['A']['parts'],[])
    def test_late_clone_is_discarded_and_deleted_when_stopped(self):
        self.allow.clear();pool=self.pool();self.speech(pool,'1','A');self.speech(pool,'2','A',6);self.wait(lambda:self.calls)
        pool.close();self.allow.set();self.wait(lambda:self.deleted);self.assertIsNone(pool.voice_for('A'))
        self.assertFalse(any(j['state'] in ('running','queued','succeeded') for j in pool.status()['agents']))
    def test_clone_failure_keeps_catalog_voice_and_does_not_retry(self):
        pool=self.pool()
        def fail(pcm,**options):self.calls.append(options);raise ValueError('fixture unavailable')
        pool.cloner_factory=lambda:type('Failure',(),{'clone':staticmethod(fail),'delete':lambda _,identifier:None})()
        self.speech(pool,'1','A');self.speech(pool,'2','A',6);self.wait(lambda:pool.speakers.get('A',{}).get('state')=='failed')
        self.speech(pool,'3','A',12);time.sleep(.1)
        self.assertEqual(len(self.calls),1);self.assertIsNone(pool.voice_for('A'));self.assertTrue(pool.status()['active'])
    def test_clone_switch_is_at_the_next_voice_request_and_manual_selection_wins(self):
        ready={};tracker=SpeakerTracker(lambda label:ready.get(label));stop=threading.Event();tracker.observe('1','A')
        with patch('packages.providers.river_translation.pitch_style',return_value='low'):
            before=tracker.voice('1',b'fixture','auto',stopped=stop);ready['A']=str(uuid4());after=tracker.voice('1',b'fixture','auto',stopped=stop)
            manual=tracker.voice('1',b'fixture','feminine',stopped=stop)
        self.assertFalse(before['cloned']);self.assertTrue(after['cloned']);self.assertEqual(after['voice_id'],ready['A']);self.assertFalse(manual['cloned'])


class CloneTransportTests(unittest.TestCase):
    def test_fixed_private_multipart_and_no_upload_without_consent(self):
        calls=[];identifier=str(uuid4())
        class Reply:
            status=200
            def read(self,limit):return json.dumps({'id':identifier,'language':'es','access':'private'}).encode()
        class Connection:
            def __init__(self,host,port,timeout):calls.append((host,port,timeout))
            def request(self,*args,**kwargs):calls.append((args,kwargs))
            def getresponse(self):return Reply()
            def close(self):pass
        class Journal:
            def remember(self,identifier):pass
            def forget(self,identifier):pass
        with patch.dict(os.environ,{'BRIVANY_CARTESIA_API_KEY':'own-fixture'}):client=CartesiaVoiceCloner(connection_factory=Connection,journal=Journal())
        with self.assertRaises(ValueError):client.clone(bytes(480000),language='es',name='Hablante 1',authorized=False)
        self.assertEqual(calls,[])
        result=client.clone(bytes(480000),language='es',name='Hablante 1',authorized=True)
        self.assertEqual(result['id'],identifier);self.assertEqual(calls[0][0],'api.cartesia.ai');self.assertIn(b'private',calls[1][1]['body']);self.assertIn(b'RIFF',calls[1][1]['body']);self.assertEqual(calls[1][0],('POST','/voices/clone'))
    def test_cleanup_journal_is_bound_to_the_key_and_keeps_no_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'voices.json';journal=VoiceCleanupJournal('own-fixture-key',path);identifier=str(uuid4());journal.remember(identifier)
            raw=path.read_text();self.assertNotIn('own-fixture-key',raw);self.assertNotIn('pcm',raw)
            self.assertEqual(journal.expired(),[])
            with patch('services.work.voice_cleanup.time.time',return_value=time.time()+1801):
                self.assertEqual(journal.expired(),[identifier]);self.assertEqual(VoiceCleanupJournal('other-key',path).expired(),[])
            journal.forget(identifier);self.assertEqual(json.loads(path.read_text()),[])
    def test_active_voice_lease_is_renewed_without_creating_a_second_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            journal=VoiceCleanupJournal('own-fixture-key',Path(directory)/'voices.json');identifier=str(uuid4());now=time.time()
            with patch('services.work.voice_cleanup.time.time',return_value=now):journal.remember(identifier)
            with patch('services.work.voice_cleanup.time.time',return_value=now+1700):journal.remember(identifier)
            with patch('services.work.voice_cleanup.time.time',return_value=now+1801):self.assertEqual(journal.expired(),[])
            self.assertEqual(len(json.loads(journal.path.read_text())),1)
    def test_remote_voice_is_removed_if_cleanup_record_cannot_be_saved(self):
        calls=[];identifier=str(uuid4())
        journal=type('Journal',(),{'remember':lambda _,key:(_ for _ in ()).throw(OSError('fixture disk failure'))})()
        with patch.dict(os.environ,{'BRIVANY_CARTESIA_API_KEY':'own-fixture'}):client=CartesiaVoiceCloner(journal=journal)
        def request(method,path,*args):calls.append((method,path));return {'id':identifier,'language':'es','access':'private'}
        client._request=request
        with self.assertRaisesRegex(ValueError,'limpieza'):client.clone(bytes(480000),language='es',name='Hablante 1',authorized=True)
        self.assertEqual(calls,[('POST','/voices/clone'),('DELETE','/voices/'+identifier)])
