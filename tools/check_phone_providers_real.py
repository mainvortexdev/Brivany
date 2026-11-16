"""Explicit paid-provider preflight; synthetic words only, no PSTN or recordings."""
import json
import threading
import time
from services.h1.server import load_local_config
from services.telephony.realtime import LiveProviders
from packages.providers.live_voice import MuseEvents

def main():
    load_local_config();providers=LiveProviders();result={'mode':'real_provider_synthetic_audio_preflight','calls_placed':0,'audio_saved':False,'transcript_saved':False,'billed_amount':'unknown','asr':False,'model':False,'tts':False};phase='asr';socket=None
    try:
        socket=providers.listen();result['asr']=True;phase='model';started=time.monotonic()
        sentences=providers.sentences('Mantener una conversación de prueba en español.',[],'Hola, ¿podemos conversar?',threading.Event())
        sentence=next(sentences);result['model']=bool(sentence.strip());result['model_first_sentence_ms']=round((time.monotonic()-started)*1000);sentences.close()
        phase='tts';pcm=bytearray()
        with providers.speak('Hola, soy Melodi. ¿Cómo estás?') as speech:
            while chunk:=speech.read1(3840):pcm.extend(chunk)
            result['tts']=bool(pcm) and speech.done
        phase='asr_audio';events=MuseEvents();stop=threading.Event();recognized=threading.Event()
        def read():
            try:
                while not stop.is_set():
                    try:raw=socket.recv(timeout=.25)
                    except TimeoutError:continue
                    event=events.accept(json.loads(raw))
                    if event and event.get('final') and event.get('text','').strip():recognized.set()
            except Exception:pass
        worker=threading.Thread(target=read,daemon=True);worker.start();started=time.monotonic()
        audio=bytes(pcm)+b'\x00'*48000*2
        for offset in range(0,len(audio),3840):
            socket.send(audio[offset:offset+3840]);remaining=(offset+min(3840,len(audio)-offset))/48000-(time.monotonic()-started)
            if remaining>0:time.sleep(remaining)
        recognized.wait(4);result['asr_synthetic_speech_recognized']=recognized.is_set();stop.set();socket.close();worker.join(1);result['passed']=all(result[key] for key in ['asr','model','tts','asr_synthetic_speech_recognized'])
    except Exception as error:result.update(passed=False,failed_phase=phase,error_code=getattr(error,'code',type(error).__name__))
    finally:
        if socket:socket.close()
    print(json.dumps(result));return 0 if result.get('passed') else 1

if __name__=='__main__':raise SystemExit(main())
