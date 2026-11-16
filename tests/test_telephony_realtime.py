"""Live phone session over PCM 24 kHz with synthetic audio and substituted paid providers."""
import base64
import json
import math
import queue
import struct
import threading
import time
import unittest

from services.telephony.realtime import LivePhoneSession, PCMCodec, Playback, Turn, pcm_rms

STREAM='sip-00000000-0000-4000-8000-000000000000'


def pcm(seconds=.08, amplitude=8000):
    return b''.join(struct.pack('<h',round(amplitude*math.sin(2*math.pi*440*i/24000)))
                    for i in range(round(24000*seconds)))


class SyntheticSpeech:
    def __init__(self, owner):
        self.owner=owner;self.done=False;self.closed=threading.Event();self.index=0
    def read1(self, _):
        if self.closed.is_set():return b''
        self.index+=1
        if self.index==1:return pcm()
        while self.owner.block_tts and not self.closed.wait(.01):
            pass
        if self.closed.is_set():return b''
        self.done=True;return b''
    def close(self):self.closed.set()
    def __enter__(self):return self
    def __exit__(self,*_):self.close()


class SyntheticMuse:
    def __init__(self):
        self.events=queue.Queue();self.closed=threading.Event();self.audio=[]
    def recv(self,timeout=.25):
        if self.closed.is_set():raise RuntimeError('closed fixture')
        try:return self.events.get(timeout=timeout)
        except queue.Empty:raise TimeoutError()
    def send(self,data):self.audio.append(data)
    def close(self):self.closed.set()
    def utterance(self,number,text):
        self.events.put(json.dumps({'type':'speechStart','turnId':number}))
        self.events.put(json.dumps({'type':'speechComplete','turnId':number,'transcript':text}))


class SyntheticProviders:
    def __init__(self):
        self.muse=SyntheticMuse();self.listens=0;self.spoken=[];self.block_tts=False
        self.model_finish=threading.Event();self.model_ended=False
    def listen(self):self.listens+=1;return self.muse
    def speak(self,text):self.spoken.append(text);return SyntheticSpeech(self)
    def sentences(self,objective,history,text,cancelled):
        yield 'Primera frase sintética.'
        while not self.model_finish.wait(.01):
            if cancelled.is_set():return
        self.model_ended=True
        yield 'Segunda frase sintética.'


class Transport:
    """In-memory stand-in for NativeSIP: same JSON events, acknowledges every mark."""
    def __init__(self):
        self.queue=queue.Queue();self.sequence=0;self.closed=False;self.sent=[]
    def event(self,kind,**fields):
        self.sequence+=1;self.queue.put(json.dumps({'event':kind,'sequenceNumber':str(self.sequence),'streamSid':STREAM,**fields}))
    def send(self,raw):
        value=json.loads(raw);self.sent.append(value)
        if value['event']=='mark':self.event('mark',mark=value['mark'])
    def recv(self,timeout=.25):
        try:return self.queue.get(timeout=timeout)
        except queue.Empty:raise TimeoutError()
    def close(self):self.closed=True
    def media(self,data):self.event('media',media={'track':'inbound','payload':base64.b64encode(data).decode()})


def wait(predicate,seconds=3):
    until=time.monotonic()+seconds
    while not predicate() and time.monotonic()<until:time.sleep(.005)
    if not predicate():raise AssertionError('Synthetic phone fixture timed out')


class SessionTests(unittest.TestCase):
    def start(self,providers,**options):
        transport=Transport()
        session=LivePhoneSession(transport,STREAM,'Prueba sintética.',threading.Event(),providers,
                                 max_seconds=None,max_turns=None,**options)
        worker=threading.Thread(target=session.run,daemon=True);worker.start()
        self.addCleanup(lambda:(session.close(),worker.join(3)))
        wait(lambda:providers.spoken and session.current is None)
        return transport,session,worker

    def test_pcm_is_the_default_format_and_acknowledges_rtp_submission(self):
        providers=SyntheticProviders();providers.model_finish.set()
        _,session,_=self.start(providers)
        self.assertIsInstance(session.codec,PCMCodec)
        self.assertEqual(session.metrics['audio_ack_boundary'],'rtp_submitted')
        with self.assertRaises(Exception):
            LivePhoneSession(Transport(),STREAM,'x',threading.Event(),providers,audio_format='mulaw_8000')

    def test_reply_audio_is_sent_before_the_model_finishes_and_dtmf_zero_hangs_up(self):
        providers=SyntheticProviders()
        transport,session,worker=self.start(providers)
        transport.sent.clear()
        providers.muse.utterance(1,'Mensaje sintético de la prueba.')
        wait(lambda:any(item['event']=='media' for item in transport.sent))
        self.assertFalse(providers.model_ended)
        payload=base64.b64decode(next(item for item in transport.sent if item['event']=='media')['media']['payload'])
        self.assertTrue(0<len(payload)<=3840 and len(payload)%2==0)
        providers.model_finish.set()
        wait(lambda:session.metrics['completed_turns']==1)
        self.assertTrue(providers.model_ended)
        transport.event('dtmf',dtmf={'digit':'0'})
        worker.join(3)
        self.assertFalse(worker.is_alive());self.assertTrue(transport.closed);self.assertTrue(providers.muse.closed.is_set())

    def test_sustained_caller_voice_interrupts_melodi_and_cleared_text_is_not_remembered(self):
        providers=SyntheticProviders()
        transport,session,_=self.start(providers)
        providers.block_tts=True
        providers.muse.utterance(1,'Primera intervención sintética.')
        wait(lambda:session.current is not None and session.current.first_audio)
        for _ in range(4):transport.media(pcm(.08))
        wait(lambda:session.metrics['interrupted']==1)
        self.assertTrue(any(item['event']=='clear' for item in transport.sent))
        wait(lambda:session.current is None)
        self.assertFalse(session.metrics['failed'])
        self.assertFalse(any(role=='assistant' for role,_ in session.history))
        self.assertTrue(providers.muse.audio)

    def test_inbound_audio_reaches_recognition_unchanged(self):
        providers=SyntheticProviders();providers.model_finish.set()
        transport,_,_=self.start(providers)
        block=pcm(.08);transport.media(block)
        wait(lambda:block in providers.muse.audio)


class CodecAndPlaybackTests(unittest.TestCase):
    def test_unlimited_session_continues_after_ninth_turn_and_remote_stop_ends_it(self):
        providers=SyntheticProviders();providers.model_finish.set();socket=Transport();lifetime=threading.Event()
        session=LivePhoneSession(socket,STREAM,'Prueba sintética de continuidad.',lifetime,providers,max_seconds=None,max_turns=None)
        worker=threading.Thread(target=session.run,daemon=True);worker.start()
        def wait(predicate):
            until=time.monotonic()+3
            while not predicate() and time.monotonic()<until:time.sleep(.005)
            self.assertTrue(predicate())
        try:
            wait(lambda:providers.spoken and session.current is None)
            for index in range(1,11):
                providers.muse.utterance(index,'Intervención sintética.')
                wait(lambda:session.metrics['completed_turns']==index)
                self.assertFalse(session.stopped())
            self.assertTrue(worker.is_alive());self.assertLessEqual(len(session.history),10)
            socket.event('stop');worker.join(3);self.assertFalse(worker.is_alive());self.assertTrue(socket.closed);self.assertFalse(session.metrics['failed'])
        finally:session.close();worker.join(3)
    def test_pcm_codec_keeps_samples_and_measures_level_like_audioop(self):
        source=pcm(.08)
        codec=PCMCodec()
        decoded,rms=codec.decode(source)
        self.assertEqual(decoded,source);self.assertEqual(codec.encode(source),source)
        self.assertLess(abs(rms/(8000/math.sqrt(2))-1),.02)
        self.assertEqual(pcm_rms(b''),0)
        try:
            import audioop
        except ImportError:
            pass
        else:
            self.assertEqual(rms,audioop.rms(source,2))
        with self.assertRaises(Exception):codec.decode(b'\x00')

    def test_cleared_marks_are_ignored_and_unacknowledged_audio_is_bounded(self):
        class Socket:
            def __init__(self):self.items=[]
            def send(self,value):self.items.append(json.loads(value))
        socket=Socket();turn=Turn('fixture')
        playback=Playback(socket,STREAM,lambda:False)
        playback.audio(b'\xff'*3840,turn)
        playback.sentence(turn,'Frase sintética no confirmada.')
        names=list(playback.pending)
        playback.clear()
        for name in names:playback.acknowledge(name)
        self.assertEqual(turn.acknowledged,[])
        self.assertEqual(playback.seconds,0)
        turn.cancelled.set()
        self.assertFalse(playback.audio(b'\xff'*96000,turn))


if __name__=='__main__':unittest.main()
