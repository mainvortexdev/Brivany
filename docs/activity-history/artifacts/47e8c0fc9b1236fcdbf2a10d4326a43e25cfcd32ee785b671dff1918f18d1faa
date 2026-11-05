"""One chat/Live owner. WorkSpace views only receive bounded local UI state."""
import json
import math
import threading
import time
import sys
import webbrowser
from urllib.parse import urlsplit
from functools import wraps
from uuid import UUID, uuid4
from services.orchestration.research_delivery import clean_sources
from .scripts import post_script


def serialized(method):
    @wraps(method)
    def invoke(self,*args,**kwargs):
        with self._companion_lock:return method(self,*args,**kwargs)
    return invoke


class CompanionBridge:
    _companion_lock=threading.RLock()
    def open_research_source(self,url):
        self._trusted()
        sources=clean_sources([{'url':url}])
        if not sources:raise ValueError('La fuente no es una dirección web pública válida.')
        return {'ok':bool(webbrowser.open(sources[0]['url']))}

    def _companion_snapshot(self):
        return getattr(self,'_workspace_chat',{'messages':[],'pending':False,'starting':False,'listening':False,'speaking':False,'error':'','level':0,'samples':[]})

    @serialized
    def workspace_chat_publish(self,value):
        self._trusted()
        if not isinstance(value,dict):raise ValueError('Estado de conversación inválido.')
        messages=value.get('messages',[])
        if not isinstance(messages,list) or len(messages)>80:raise ValueError('Conversación fuera de límites.')
        clean=[]
        for item in messages:
            if not isinstance(item,dict) or item.get('role') not in ('user','assistant') or not isinstance(item.get('text'),str) or len(item['text'])>16000:raise ValueError('Mensaje inválido.')
            clean.append({'role':item['role'],'text':item['text']})
            if item['role']=='assistant' and item.get('showSources') is True and item.get('sources'):
                sources=clean_sources(item['sources'])
                if sources:clean[-1].update(sources=sources,showSources=True)
            continuation=item.get('continuation')
            if item['role']=='assistant' and isinstance(continuation,str) and len(continuation)==36:
                try:clean[-1]['continuation']=str(UUID(continuation))
                except ValueError:pass
        state={**self._companion_snapshot(),'messages':clean,'error':str(value.get('error',''))[:400]}
        for key in ('pending','starting','listening','speaking'):
            if type(value.get(key,False)) is not bool:raise ValueError('Estado Live inválido.')
            state[key]=value.get(key,False)
        dictation=value.get('dictation',{'phase':'idle','draft':'','revision':0})
        if (not isinstance(dictation,dict) or dictation.get('phase') not in ('idle','starting','recording','finishing')
            or not isinstance(dictation.get('draft'),str) or len(dictation['draft'])>1200
            or type(dictation.get('revision')) is not int or not 0<=dictation['revision']<=2147483647):raise ValueError('Estado de dictado inválido.')
        state['dictation']={key:dictation[key] for key in ('phase','draft','revision')}
        before=self._companion_snapshot().get('listening',False)
        previous=self._companion_snapshot();now=time.monotonic()
        if state['pending'] and not previous.get('pending'):
            self._workspace_notify_until=now+1800;self._workspace_reply_deadline=0
        if clean and clean[-1]['role']=='user' and (not previous.get('messages') or clean[-1]!=previous['messages'][-1]):
            self._workspace_notify_until=now+1800;self._workspace_reply_deadline=0
        old=previous.get('messages',[])
        changed=clean and clean[-1]['role']=='assistant' and clean[-1]['text'].strip() and (not old or len(clean)!=len(old) or clean[-1]['text']!=old[-1]['text'])
        error=state['error'] and state['error']!=previous.get('error')
        if (changed or error) and now<getattr(self,'_workspace_notify_until',0):
            self._workspace_reply_text=(state['error'] if error else clean[-1]['text'])[:400]
            self._workspace_reply_deadline=now+min(16,max(8,len(self._workspace_reply_text)/25))
            timer=getattr(self,'_workspace_reply_timer',None)
            if timer:timer.cancel()
            deadline=self._workspace_reply_deadline
            def expire():
                self._expire_workspace_reply(deadline)
            self._workspace_reply_timer=threading.Timer(max(.05,deadline-time.monotonic()),expire);self._workspace_reply_timer.daemon=True;self._workspace_reply_timer.start()
        self._workspace_chat=state
        host=getattr(self,'_island_host',None)
        if before!=state.get('listening') and host and host.value['expanded'] and host.value['panel']=='chat':
            self.work_island_layout(True,host.value['size'],'chat',False,False,host.value.get('anchor_x'))
        self._publish_companion(state);return {'ok':True}

    @serialized
    def workspace_live_signal(self,value):
        self._trusted()
        if not isinstance(value,dict):raise ValueError('Señal inválida.')
        samples=value.get('samples',[]);level=value.get('level',0)
        if not isinstance(samples,list) or len(samples)>64 or any(type(n) not in (int,float) or not math.isfinite(n) or not 0<=n<=1 for n in samples):raise ValueError('Onda inválida.')
        if type(level) not in (int,float) or not math.isfinite(level) or not 0<=level<=1:raise ValueError('Nivel inválido.')
        state={**self._companion_snapshot(),'samples':samples,'level':level}
        self._workspace_chat=state;self._publish_companion(state,signal=True);return {'ok':True}

    def _publish_companion(self,state,signal=False):
        panel=getattr(self,'_island_host',None)
        visible=bool(getattr(self,'_workspace_reply_text','') and time.monotonic()<getattr(self,'_workspace_reply_deadline',0) and not (panel and panel.value['expanded']))
        payload={key:state.get(key) for key in ('listening','speaking','starting','level','samples')} if signal else dict(state)
        payload.update(reply_visible=visible,reply_text=getattr(self,'_workspace_reply_text','') if visible else '')
        script='window.BrivanyWorkspace?.receive('+json.dumps(payload,ensure_ascii=True)+')'
        for window in (getattr(self,'_bar_window',None),getattr(self,'_work_window',None),getattr(self,'_voice_window',None)):
            if window:
                try:post_script(window,script,'live-signal' if signal else 'chat-state')
                except Exception:pass
        host=getattr(self,'_voice_host',None)
        if host and host.window:
            wave_active=(state.get('listening') and not state.get('speaking')
                         and max(state.get('level',0)*9,*state.get('samples',[]),0)>.015
                         and not (panel and panel.value['expanded']))
            mode='reply' if visible else 'live-wave' if wave_active else None
            fullscreen=getattr(getattr(self,'_dock_host',None),'fullscreen',False)
            if mode and not fullscreen:
                anchor=getattr(self,'_workspace_companion_anchor',host.screen.width/2)
                if getattr(self,'_workspace_overlay_mode',None)!=mode:
                    host.hide();host.glass_mode(False);host.offset=getattr(self,'_workspace_offset',40)
                    host.layout(True,'normal',mode,animate=False,anchor_x=anchor)
                    if mode=='reply':host.glass_mode(True)
                elif abs(host.value.get('anchor_x',anchor)-anchor)>2:host.layout(True,'normal',mode,animate=False,anchor_x=anchor)
                self._workspace_overlay_mode=mode
                post_script(host.window,'window.BrivanyWorkspace?.overlayLayout('+json.dumps(host.status())+')','companion-overlay-layout');host.show()
            else:
                self._workspace_overlay_mode=None
                if host._visible:host.hide()

    @serialized
    def _expire_workspace_reply(self,deadline):
        if getattr(self,'_workspace_reply_deadline',0)==deadline:self._publish_companion(self._companion_snapshot(),signal=True)

    @serialized
    def workspace_companion_anchor(self,x):
        self._trusted();host=getattr(self,'_voice_host',None)
        if type(x) not in (int,float) or not math.isfinite(x) or not host or not 0<=x<=host.screen.width:raise ValueError('Posición de Melodi inválida.')
        self._workspace_companion_anchor=x
        if getattr(self,'_workspace_overlay_mode',None)=='reply':self._publish_companion(self._companion_snapshot(),signal=True)
        return {'ok':True}

    def workspace_chat_command(self,action,text=''):
        self._trusted()
        if action not in ('send','start','stop','dictate_start','dictate_cancel','dictate_stop','dictate_send') or not isinstance(text,str) or len(text)>1200 or action=='send' and not text.strip():raise ValueError('Acción de conversación inválida.')
        request={'id':uuid4().hex,'action':action,'text':text.strip()}
        if action=='send':self._workspace_notify_until=time.monotonic()+1800;self._workspace_reply_deadline=0
        if action=='stop':self._workspace_reply_deadline=0
        if action in {'stop','dictate_cancel','dictate_stop','dictate_send'}:self._workspace_microphone_until=0
        if action in {'start','dictate_start'}:
            self._window.evaluate_js("window.BrivanyNavigate?.('/app')")
            threading.Thread(target=self._start_workspace_live,args=(request,),daemon=True,name='melodi-live-start').start()
            return {'accepted':True,'id':request['id']}
        # All content is JSON data. Only our fixed controller is invoked.
        script='''(()=>{const request=REQUEST;window.BrivanyNavigate?.('/app');let attempts=0;
const dispatch=()=>{const chat=document.querySelector('#module-frame')?.contentWindow?.BrivanyChat;
if(chat?.workspaceCommand){chat.workspaceCommand(request);return;}
if(++attempts<80)setTimeout(dispatch,75);else window.pywebview?.api?.workspace_chat_publish?.({messages:window.BrivanyChatSession?.messages||[],error:'No se pudo abrir la conversación de Melodi.',pending:false,starting:false,listening:false,speaking:false});};dispatch();return true;})();'''.replace('REQUEST',json.dumps(request,ensure_ascii=True))
        self._window.evaluate_js(script)
        if action in {'send','stop'}:self._publish_companion(self._companion_snapshot(),signal=True)
        return {'accepted':True,'id':request['id']}

    def _workspace_microphone_allowed(self,uri):
        if time.monotonic()>getattr(self,'_workspace_microphone_until',0):return False
        requested=urlsplit(str(uri));base=urlsplit(self._base)
        return ((requested.scheme,requested.hostname,requested.port)==(base.scheme,base.hostname,base.port)
                and requested.path in ('','/','/app','/app/') and not requested.username and not requested.password)

    def _workspace_gesture(self,script):
        if sys.platform=='win32' and getattr(self._window,'native',None):
            from System import Action
            native=self._window.native
            def execute():
                from Microsoft.Web.WebView2.Core import CoreWebView2PermissionKind,CoreWebView2PermissionState
                core=native.webview.CoreWebView2
                if not getattr(self,'_workspace_microphone_handler',None):
                    def permission(sender,args):
                        if args.PermissionKind==CoreWebView2PermissionKind.Microphone and self._workspace_microphone_allowed(args.Uri):
                            # The explicit WorkSpace mic click authorizes this
                            # request only. Never persist an all-sites grant.
                            args.State=CoreWebView2PermissionState.Allow
                            args.SavesInProfile=False
                            args.Handled=True
                    self._workspace_microphone_handler=permission;core.PermissionRequested+=permission
                self._workspace_microphone_until=time.monotonic()+12
                core.CallDevToolsProtocolMethodAsync('Runtime.evaluate',json.dumps({'expression':script,'userGesture':True,'allowUnsafeEvalBlockedByCSP':False}))
            if native.InvokeRequired:native.Invoke(Action(execute))
            else:execute()
        else:self._window.evaluate_js(script)

    def _start_workspace_live(self,request):
        try:
            deadline=time.monotonic()+7
            while time.monotonic()<deadline:
                if self._window.evaluate_js("Boolean(document.querySelector('#module-frame')?.contentWindow?.BrivanyChat?.workspaceCommand)"):
                    self._workspace_gesture("document.querySelector('#module-frame').contentWindow.BrivanyChat.workspaceCommand("+json.dumps(request,ensure_ascii=True)+")");return
                time.sleep(.1)
            raise ValueError()
        except Exception:
            state={**self._companion_snapshot(),'starting':False,'listening':False,'dictation':{'phase':'idle','draft':request.get('text',''),'revision':self._companion_snapshot().get('dictation',{}).get('revision',0)+1},'error':'No se pudo iniciar el micrófono. Vuelve a intentarlo.'}
            self._workspace_chat=state;self._publish_companion(state)

    def workspace_chat_state(self):self._trusted();return self._companion_snapshot()
