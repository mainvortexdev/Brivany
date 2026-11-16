"""Owned SIP/RTP peer test on loopback, no operator/account/microphone or AI."""
import base64
import json
import math
from pathlib import Path
import queue
import struct
import subprocess
import sys
import threading
import time
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]


class Peer:
    def __init__(self,name):
        self.process=subprocess.Popen([sys.executable,'-X','utf8','-B','-m','services.telephony.sip_engine'],
            cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
            text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.events=queue.Queue();self.lock=threading.Lock()
        def read():
            for line in self.process.stdout:
                try:self.events.put(json.loads(line))
                except ValueError:pass
        self.reader=threading.Thread(target=read,daemon=True);self.reader.start()
        self.send({'server':'127.0.0.1','port':5060,'transport':'udp','username':name,'password':'',
                   'register':False,'bind':'127.0.0.1','peer':True})
        self.port=self.wait('ready')['port']

    def send(self,value):
        with self.lock:
            self.process.stdin.write(json.dumps(value)+'\n');self.process.stdin.flush()

    def wait(self,kind,*,timeout=8,condition=lambda _:True):
        deadline=time.monotonic()+timeout
        observed=[]
        while time.monotonic()<deadline:
            try:event=self.events.get(timeout=.2)
            except queue.Empty:
                if self.process.poll() is not None:raise RuntimeError('Native SIP peer stopped')
                continue
            if event.get('type')=='error':raise RuntimeError('Native SIP failed: '+event.get('code','unknown'))
            if event.get('type')==kind and condition(event):return event
            if event.get('type')!='audio':observed.append((event.get('type'),event.get('state'),event.get('sip_status')))
        raise TimeoutError('Native SIP peer did not emit '+kind+'; states='+str(observed))

    def close(self):
        try:
            if self.process.poll() is None:self.send({'type':'stop'})
            self.process.wait(8)
        except (OSError,ValueError,subprocess.TimeoutExpired):
            self.process.kill();self.process.wait(3)
        for stream in (self.process.stdin,self.process.stdout):stream.close()
        self.reader.join(1)


def check():
    report={'mode':'native_pjsua2_loopback_sip_and_rtp','passed':False,'operator_requests':0,
            'ai_requests':0,'physical_audio_device':False,'original_media_used':False}
    a=b=None
    try:
        a=Peer('alice');b=Peer('bob');identifier=str(uuid4())
        a.send({'type':'local_dial','id':identifier,'port':b.port})
        a.wait('media_ready');b.wait('media_ready')
        tone=b''.join(struct.pack('<h',round(6000*math.sin(2*math.pi*1000*n/24000))) for n in range(480))
        def transfer(source,target,call_id):
            marker=uuid4().hex
            started=time.monotonic()
            for _ in range(8):source.send({'type':'audio','id':call_id,'pcm':base64.b64encode(tone).decode()})
            source.send({'type':'mark','id':call_id,'name':marker})
            event=target.wait('audio',condition=lambda value:any(base64.b64decode(value['pcm'])))
            first_signal_ms=round((time.monotonic()-started)*1000)
            data=base64.b64decode(event['pcm']);samples=struct.unpack('<'+'h'*(len(data)//2),data)
            rms=math.sqrt(sum(sample*sample for sample in samples)/len(samples))
            if rms<1000:raise RuntimeError('RTP test signal too weak')
            ack=source.wait('mark',condition=lambda value:value.get('name')==marker)
            if ack.get('boundary')!='rtp_submitted':raise RuntimeError('Unknown playback boundary')
            return {'first_signal_ms':first_signal_ms,'submitted_ms':round((time.monotonic()-started)*1000),
                    'pcm_bytes':len(data),'rms':round(rms)}
        report['caller_to_peer']=transfer(a,b,identifier)
        report['peer_to_caller']=transfer(b,a,'peer')
        marker=uuid4().hex
        a.send({'type':'audio','id':identifier,'pcm':base64.b64encode(tone*8).decode()})
        a.send({'type':'mark','id':identifier,'name':marker});a.send({'type':'clear','id':identifier})
        time.sleep(.22)
        pending=[]
        while not a.events.empty():pending.append(a.events.get_nowait())
        if any(event.get('type')=='mark' and event.get('name')==marker for event in pending):
            raise RuntimeError('Cleared audio was reported as submitted')
        a.send({'type':'hangup','id':identifier})
        a.wait('call',condition=lambda event:event.get('state')=='completed')
        b.wait('call',condition=lambda event:event.get('state')=='completed')
        report.update(passed=True,codec='PCMU/8000 with native resampling to PCM/24000',
                      clear_pending_audio=True,bidirectional_hangup=True,
                      scope='Native SIP/RTP on this computer only; not Telnyx registration, PSTN, NAT, latency of AI or human listening.')
    except Exception as error:
        report['error']=str(error)
    finally:
        if a:a.close()
        if b:b.close()
    from datetime import datetime, timezone
    output=ROOT/'tmp/verification'/('sip-native-loopback-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid4().hex[:8]+'.json')
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))
    print('Report: '+str(output.relative_to(ROOT)))
    return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(check())
