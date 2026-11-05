"""Local substitutes only: no paid providers or user media."""
import threading
import time
import unittest
from packages.providers.caption_prefetch import CaptionPrefetch,signature


def offer(text='Hola, no son 15.',source='youtube:abcdefghijk',epoch=7):
    return {'type':'caption-lookahead','epoch':epoch,'source':source,'position':4.,'cues':[{'start':5.,'end':7.,'text':text,'speaker':'hint only'}]}


class CaptionTests(unittest.TestCase):
    def wait(self,check):
        until=time.monotonic()+2
        while not check() and time.monotonic()<until:time.sleep(.005)
        self.assertTrue(check())
    def prefetch(self,**options):
        owner=self;self.calls=[];self.gate=threading.Event();self.gate.set();self.closed=False
        class Translator:
            usage={'tokens':5}
            def stream(self,text,target,history):
                owner.calls.append((text,target,history));owner.gate.wait(2)
                if owner.closed:return
                yield 'Hello, not 15.'
            def close(self):owner.closed=True;owner.gate.set()
        instance=CaptionPrefetch('en',translator_factory=Translator,epoch=7,**options);self.addCleanup(instance.close);return instance
    def test_pending_never_blocks_and_exact_asr_match_reuses_one_translation(self):
        p=self.prefetch();self.gate.clear();self.assertTrue(p.offer(offer()));self.wait(lambda:len(self.calls)==1)
        started=time.monotonic();self.assertIsNone(p.lookup('Hola, no son 15.'));self.assertLess(time.monotonic()-started,.05)
        p.offer(offer());self.gate.set();self.wait(lambda:p.status()['prepared']==1)
        self.assertEqual(p.lookup('HOLA no son 15!')['text'],'Hello, not 15.')
        self.assertIsNone(p.lookup('Hola son 15.'));self.assertIsNone(p.lookup('Hola, no son 51.'))
        self.assertEqual(len(self.calls),1);self.assertEqual(self.calls[0][1:],('en',[]))
    def test_old_source_cannot_publish_late_output_and_close_erases_text(self):
        p=self.prefetch();self.gate.clear();p.offer(offer());self.wait(lambda:len(self.calls)==1)
        p.offer(offer('Otro video.',source='youtube:11111111111'));self.gate.set();self.wait(lambda:p.status()['discarded']==1)
        self.assertIsNone(p.lookup('Hola, no son 15.'));p.close();self.assertIsNone(p.lookup('Otro video.'));self.assertEqual(p.status()['cached'],0)
        self.assertFalse(p.offer(offer()))
    def test_expiry_queue_limits_and_untrusted_control_validation(self):
        now=[100.];p=self.prefetch(clock=lambda:now[0]);self.gate.clear()
        for value in [offer(epoch=8),{**offer(),'position':float('nan')},{**offer(),'source':'https://evil.example'}, {**offer(),'cues':[{'start':1,'end':2,'text':'past','speaker':None}]}]:self.assertFalse(p.offer(value))
        for index in range(20):p.offer(offer(f'Frase {index}.'))
        self.assertLessEqual(p.status()['queued'],3);self.assertLessEqual(p.status()['cached'],4)
        now[0]+=46;self.assertIsNone(p.lookup('Frase 0.'));self.assertEqual(p.status()['cached'],0)
    def test_fragment_join_preserves_speaker_boundary_and_no_fuzzy_match(self):
        p=self.prefetch();message=offer();message['cues']=[{'start':5,'end':6,'text':'Hola,','speaker':'A'},{'start':6,'end':7,'text':'no son 15.','speaker':'A'},{'start':8,'end':9,'text':'Adiós.','speaker':'B'}]
        p.offer(message);self.wait(lambda:p.status()['prepared']==2)
        self.assertEqual([c[0] for c in self.calls],['Hola, no son 15.','Adiós.']);self.assertIsNotNone(p.lookup('Hola, no son 15.'))
        self.assertNotEqual(signature('1.5'),signature('15'))
        self.assertNotEqual(signature('-5'),signature('5'))
        self.assertNotEqual(signature('5%'),signature('5'))
    def test_speculative_provider_failure_leaves_foreground_available(self):
        class Broken:
            def stream(self,*_):raise RuntimeError('synthetic outage')
            def close(self):pass
        p=CaptionPrefetch('en',translator_factory=Broken,epoch=7);self.addCleanup(p.close)
        p.offer(offer());self.wait(lambda:p.status()['failed']==1);self.assertIsNone(p.lookup('Hola, no son 15.'))
        p.offer(offer());time.sleep(.02);self.assertEqual(p.status()['failed'],1,'no repeated failed speculation')
