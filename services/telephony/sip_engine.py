"""Isolated PJSUA2 worker for Telnyx SIP. Credentials enter through stdin; no native logs/audio files.

The worker never opens a physical microphone or speaker. PJSIP supplies SIP,
RTP, codecs and the jitter buffer; the app supplies live PCM through AudioMediaPort.
Destinations are dialed as E.164 SIP URIs (sip:+18095550100@sip.telnyx.com), the
format Telnyx accepts on credential connections.
"""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH
from .safety import MAX_CALL_SECONDS
import base64
from collections import deque
import json
import os
from pathlib import Path
import queue
import re
import sys
import threading
import time


def load_engine():
    try:
        import pjsua2
    except ImportError:
        location = DATA_ROOT / '.local/tools/pjsua2-runtime'
        if not location.is_dir():
            raise RuntimeError('sip_runtime_missing') from None
        sys.path.insert(0,str(location))
        import pjsua2
    return pjsua2


def response_diagnostic(message):
    """Extract protocol codes only. Never expose whole SIP packets or headers."""
    if not isinstance(message,str) or len(message)>65536:return None
    response=re.match(r'^SIP/2\.0 ([1-6][0-9]{2})\b',message)
    if not response:return None
    sequence=re.search(r'^CSeq:\s*[0-9]+\s+(INVITE|BYE|CANCEL)\s*$',message,re.M|re.I)
    if not sequence:return None
    result={'sip_status':int(response[1]),'method':sequence[1].upper()}
    reason=re.search(r'^Reason:\s*(Q\.850|SIP)\s*;\s*cause\s*=\s*([0-9]{1,3})\b',message,re.M|re.I)
    if reason:result.update(reason_protocol=reason[1].upper(),reason_cause=int(reason[2]))
    warning=re.search(r'^Warning:\s*([0-9]{3})\s',message,re.M|re.I)
    if warning:result['warning_code']=int(warning[1])
    return result


def config(value):
    if not isinstance(value,dict) or set(value)-{'server','port','transport','username','password','register','bind','local_port','allow','peer'}:
        raise ValueError('configuration')
    server=value.get('server','')
    if not isinstance(server,str) or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?',server):
        raise ValueError('server')
    if type(value.get('port')) is not int or not 1<=value['port']<=65535 or value.get('transport') not in ('udp','tcp','tls'):
        raise ValueError('transport')
    user,password=value.get('username'),value.get('password')
    if not isinstance(user,str) or not re.fullmatch(r'[A-Za-z0-9_.+-]{1,64}',user):
        raise ValueError('username')
    if not isinstance(password,str) or len(password)>256 or any(ord(c)<32 or ord(c)>126 for c in password):
        raise ValueError('password')
    register=value.get('register',True)
    if type(register) is not bool or register and not password:
        raise ValueError('registration')
    bind=value.get('bind','0.0.0.0')
    local_port=value.get('local_port',0)
    if bind not in ('0.0.0.0','127.0.0.1') or type(local_port) is not int or not 0<=local_port<=65535:
        raise ValueError('binding')
    allow=value.get('allow',[])
    if not isinstance(allow,list) or len(allow)>30 or any(not isinstance(n,str) or not re.fullmatch(r'\+[1-9][0-9]{7,14}',n) for n in allow):
        raise ValueError('destinations')
    peer=value.get('peer',False)
    if type(peer) is not bool or peer and (bind!='127.0.0.1' or register or server!='127.0.0.1'):
        raise ValueError('peer')
    return {**value,'bind':bind,'local_port':local_port,'register':register,'allow':allow,'peer':peer}


def target(server,port,transport,user=''):
    """SIP URI for the registrar or an E.164 destination on the same server."""
    scheme='sips:' if transport=='tls' else 'sip:'
    suffix=';transport=tcp' if transport=='tcp' else ''
    return scheme+(user+'@' if user else '')+server+':'+str(port)+suffix


class PCMBuffer:
    """One second maximum. Marks mean submitted to the RTP clock, not heard remotely."""
    def __init__(self):
        self.lock=threading.Lock();self.items=deque();self.size=0
    def write(self,data):
        if not data or len(data)>9600 or len(data)%2:
            raise ValueError('audio')
        with self.lock:
            if self.size+len(data)>48000:
                raise ValueError('audio_backlog')
            self.items.append(data);self.size+=len(data)
    def mark(self,name):
        if not isinstance(name,str) or not re.fullmatch(r'[a-f0-9]{32}',name):
            raise ValueError('mark')
        with self.lock:
            if len(self.items)>100:
                raise ValueError('mark_backlog')
            self.items.append(name)
    def clear(self):
        with self.lock:
            self.items.clear();self.size=0
    def read(self,size):
        data=bytearray();marks=[]
        with self.lock:
            while self.items and len(data)<size:
                item=self.items.popleft()
                if isinstance(item,str):marks.append(item);continue
                count=min(size-len(data),len(item));data.extend(item[:count]);self.size-=count
                if count<len(item):self.items.appendleft(item[count:])
            while self.items and isinstance(self.items[0],str):marks.append(self.items.popleft())
        data.extend(b'\0'*(size-len(data)))
        return bytes(data),marks


def main():
    # C stdio from native PJSIP must not mix SIP credentials/headers with IPC.
    wire=os.fdopen(os.dup(sys.stdout.fileno()),'w',encoding='utf-8',buffering=1)
    sink=os.open(os.devnull,os.O_WRONLY)
    os.dup2(sink,sys.stdout.fileno());os.dup2(sink,sys.stderr.fileno());os.close(sink)
    output=queue.Queue(maxsize=128);commands=queue.Queue(maxsize=32)
    ended=threading.Event();overflow=threading.Event()
    def emit(value):
        try:output.put_nowait(value)
        except queue.Full:overflow.set()
    def writer():
        try:
            while True:
                value=output.get()
                if value is None:return
                wire.write(json.dumps(value,separators=(',',':'))+'\n');wire.flush()
        except (OSError,ValueError):ended.set()
    threading.Thread(target=writer,daemon=True,name='sip-ipc-output').start()
    endpoint=account=call=port=None
    try:
        raw=sys.stdin.buffer.readline(8193)
        if len(raw)>8192 or not raw.endswith(b'\n'):raise ValueError('configuration')
        settings=config(json.loads(raw))
        pj=load_engine()
        def reader():
            try:
                while True:
                    raw=sys.stdin.buffer.readline(16385)
                    if not raw:break
                    if len(raw)>16384 or not raw.endswith(b'\n'):raise ValueError('command')
                    commands.put(json.loads(raw),timeout=1)
            except Exception:pass
            finally:ended.set()
        threading.Thread(target=reader,daemon=True,name='sip-ipc-input').start()

        class Port(pj.AudioMediaPort):
            def __init__(self,identifier):
                super().__init__();self.identifier=identifier;self.buffer=PCMBuffer();self.active=True
                fmt=pj.MediaFormatAudio();fmt.init(pj.PJMEDIA_FORMAT_PCM,24000,1,20000,16)
                self.createPort('brivany-pcm',fmt)
            def onFrameRequested(self,frame):
                try:
                    size=frame.size if 0<frame.size<=9600 and frame.size%2==0 else 960
                    data,marks=self.buffer.read(size)
                    frame.buf=pj.ByteVector(data);frame.size=len(data);frame.type=pj.PJMEDIA_FRAME_TYPE_AUDIO
                    for name in marks:emit({'type':'mark','id':self.identifier,'name':name,'boundary':'rtp_submitted'})
                except Exception:overflow.set()
            def onFrameReceived(self,frame):
                if self.active and frame.type==pj.PJMEDIA_FRAME_TYPE_AUDIO and frame.size:
                    data=bytes(frame.buf)
                    if len(data)<=9600 and len(data)%2==0:
                        emit({'type':'audio','id':self.identifier,'pcm':base64.b64encode(data).decode('ascii')})

        class Call(pj.Call):
            def __init__(self,account,identifier,call_id=pj.PJSUA_INVALID_ID):
                super().__init__(account,call_id);self.identifier=identifier;self.audio=None;self.port=None;self.finished=False
                self.started=time.monotonic();self.connected=False;self.cancelled=False
            def diagnostic(self,event):
                try:
                    if event.type==pj.PJSIP_EVENT_RX_MSG:
                        message=event.body.rxMsg.rdata.wholeMsg
                    elif event.type==pj.PJSIP_EVENT_TSX_STATE and event.body.tsxState.type==pj.PJSIP_EVENT_RX_MSG:
                        message=event.body.tsxState.src.rdata.wholeMsg
                    else:return
                    diagnostic=response_diagnostic(message)
                    if diagnostic:emit({'type':'sip_response','id':self.identifier,**diagnostic})
                except Exception:pass
            def onCallTsxState(self,prm):
                self.diagnostic(prm.e)
            def onCallState(self,prm):
                self.diagnostic(prm.e)
                info=self.getInfo();code=info.lastStatusCode
                if info.state==pj.PJSIP_INV_STATE_DISCONNECTED:
                    self.finished=True
                    if self.port:self.port.active=False
                    state='canceled' if self.cancelled else 'completed' if self.connected else 'busy' if code in (486,600) else 'no-answer' if code in (408,480) else 'failed'
                elif info.state==pj.PJSIP_INV_STATE_CONFIRMED:
                    self.connected=True;state='in-progress'
                elif info.state==pj.PJSIP_INV_STATE_EARLY:state='ringing' if code==180 else 'dialing'
                else:state='dialing'
                reason=re.sub(r'(?:sips?:|https?://)\S+|[\w.+-]+@[\w.-]+|\+?[0-9]{5,}','[redacted]',str(info.lastReason))[:180]
                emit({'type':'call','id':self.identifier,'state':state,'sip_status':int(code),'sip_reason':reason})
            def onCallMediaState(self,_):
                try:
                    info=self.getInfo()
                    emit({'type':'media_state','id':self.identifier,'tracks':[
                        {'kind':int(item.type),'state':int(item.status)} for item in info.media]})
                    for media in info.media:
                        if media.type==pj.PJMEDIA_TYPE_AUDIO and media.status==pj.PJSUA_CALL_MEDIA_ACTIVE:
                            if self.port is not None:return
                            self.port=Port(self.identifier);self.audio=self.getAudioMedia(media.index)
                            self.port.startTransmit(self.audio);self.audio.startTransmit(self.port)
                            emit({'type':'media_ready','id':self.identifier,'format':'pcm_s16le','rate':24000})
                            return
                except Exception:
                    emit({'type':'error','id':self.identifier,'code':'media_unavailable'})
                    overflow.set()
            def onDtmfDigit(self,prm):
                emit({'type':'dtmf','id':self.identifier,'digit':prm.digit})
            def onCallRedirected(self,_):return pj.PJSIP_REDIRECT_REJECT
            def stop(self):
                if not self.finished:
                    self.cancelled=not self.connected
                    prm=pj.CallOpParam();prm.statusCode=603 if not self.connected else 0
                    try:self.hangup(prm)
                    except Exception:pass
            def destroy_media(self):
                if self.audio and self.port:
                    try:self.audio.stopTransmit(self.port);self.port.stopTransmit(self.audio)
                    except Exception:pass
                self.audio=None
                if self.port:self.port.active=False
                self.port=None

        class Account(pj.Account):
            def onRegState(self,_):
                info=self.getInfo()
                emit({'type':'registration','state':'registered' if info.regIsActive else 'unregistered',
                      'sip_status':int(info.regStatus),'expires':int(info.regExpiresSec)})
            def onIncomingCall(self,prm):
                nonlocal call
                incoming=Call(self,'peer',prm.callId)
                if settings['peer'] and call is None:
                    call=incoming;params=pj.CallOpParam();params.statusCode=200;call.answer(params)
                else:
                    params=pj.CallOpParam();params.statusCode=486;incoming.answer(params)
                    rejected.append(incoming)

        endpoint=pj.Endpoint();endpoint.libCreate()
        ep_config=pj.EpConfig();ep_config.uaConfig.threadCnt=0;ep_config.uaConfig.mainThreadOnly=True
        ep_config.logConfig.level=ep_config.logConfig.consoleLevel=0
        ep_config.medConfig.clockRate=24000;ep_config.medConfig.sndClockRate=24000
        ep_config.medConfig.channelCount=1;ep_config.medConfig.audioFramePtime=20
        ep_config.medConfig.ecTailLen=0;ep_config.medConfig.quality=5
        endpoint.libInit(ep_config)
        transport=pj.TransportConfig();transport.port=settings['local_port'];transport.boundAddress=settings['bind']
        transport_id=endpoint.transportCreate({'udp':pj.PJSIP_TRANSPORT_UDP,'tcp':pj.PJSIP_TRANSPORT_TCP,
                                               'tls':pj.PJSIP_TRANSPORT_TLS}[settings['transport']],transport)
        endpoint.libStart();endpoint.audDevManager().setNullDev()
        for codec in endpoint.codecEnum2():
            endpoint.codecSetPriority(codec.codecId,255 if codec.codecId.startswith('PCMU/') else
                                      254 if codec.codecId.startswith('PCMA/') else 0)
        ac=pj.AccountConfig();ac.idUri='sip:'+settings['username']+'@'+settings['server']
        ac.sipConfig.transportId=transport_id
        ac.mediaConfig.transportConfig.port=0;ac.mediaConfig.transportConfig.boundAddress=settings['bind']
        ac.regConfig.registerOnAdd=settings['register'];ac.regConfig.timeoutSec=300
        if settings['register']:
            ac.regConfig.registrarUri=target(settings['server'],settings['port'],settings['transport'])
            ac.sipConfig.authCreds.append(pj.AuthCredInfo('digest','*',settings['username'],0,settings['password']))
        ac.natConfig.contactRewriteUse=1;ac.natConfig.viaRewriteUse=1;ac.natConfig.sdpNatRewriteUse=1
        ac.natConfig.udpKaIntervalSec=15
        account=Account();rejected=[];account.create(ac,True)
        settings['password']=''
        info=endpoint.transportGetInfo(transport_id)
        emit({'type':'ready','port':int(info.localAddress.rsplit(':',1)[1]),'engine':endpoint.libVersion().full})
        while not ended.is_set():
            endpoint.libHandleEvents(20)
            if overflow.is_set():
                emit({'type':'error','code':'audio_backlog'});break
            # Hard upper bound applies even if the parent/voice worker stalls.
            if call and time.monotonic()-call.started >= MAX_CALL_SECONDS:call.stop()
            elif call and not call.connected and time.monotonic()-call.started>60:call.stop()
            if call and call.finished:
                call.destroy_media();call=None
            rejected[:]=[item for item in rejected if not item.finished]
            for _ in range(12):
                try:command=commands.get_nowait()
                except queue.Empty:break
                kind=command.get('type') if isinstance(command,dict) else None
                if kind=='stop':ended.set();break
                if kind=='dial':
                    identifier=command.get('id','');destination=command.get('destination')
                    if call or not re.fullmatch(r'[a-f0-9-]{36}',identifier) or destination not in settings['allow']:
                        emit({'type':'error','code':'dial_not_allowed'});continue
                    call=Call(account,identifier)
                    uri=target(settings['server'],settings['port'],settings['transport'],destination)
                    prm=pj.CallOpParam(True);prm.opt.audioCount=1;prm.opt.videoCount=0
                    call.makeCall(uri,prm)
                elif kind=='local_dial' and settings['peer']:
                    peer_port=command.get('port')
                    if call or type(peer_port) is not int or not 1<=peer_port<=65535:raise ValueError('local_peer')
                    call=Call(account,command.get('id','peer'));prm=pj.CallOpParam(True);prm.opt.audioCount=1;prm.opt.videoCount=0
                    call.makeCall('sip:peer@127.0.0.1:'+str(peer_port),prm)
                elif kind=='hangup' and call and command.get('id')==call.identifier:call.stop()
                elif call and call.port and command.get('id')==call.identifier:
                    if kind=='audio':call.port.buffer.write(base64.b64decode(command.get('pcm',''),validate=True))
                    elif kind=='mark':call.port.buffer.mark(command.get('name'))
                    elif kind=='clear':call.port.buffer.clear()
    except Exception:
        emit({'type':'error','code':'sip_worker_failed'})
    finally:
        if call:
            call.stop()
            if endpoint:
                for _ in range(8):endpoint.libHandleEvents(20)
            call.destroy_media();call=None
        if account:
            try:account.shutdown()
            except Exception:pass
            account=None
        if endpoint:
            try:endpoint.libDestroy()
            except Exception:pass
        emit({'type':'stopped'})
        try:output.put(None,timeout=1)
        except queue.Full:pass
        wire.flush()


if __name__=='__main__':main()
