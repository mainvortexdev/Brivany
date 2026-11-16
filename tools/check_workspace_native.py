"""Owned native WebView2 integration; synthetic conversation, no input injection/mic."""
import json
import os
import sys
from pathlib import Path
import tempfile
import threading
import time
from unittest.mock import patch
from types import SimpleNamespace
import webview
from desktop.launcher import LocalDesktopServer
from desktop.experience.launcher import ExperienceBridge,experience_handler,NATIVE_PAGES,MODULE_ROUTES
from desktop.experience.ui_session import DesktopUISession
from desktop.experience.island import IslandHost,DockHost
from desktop.experience.desktop_widgets import DesktopWidgets
from desktop.experience.workspace_preferences import WorkspacePreferences
from services.h1.server import Handler
from services.work.session import WorkSession
from services.computer.service import ComputerService
from tests.test_computer_control import Runtime,Planner
from tests.test_edits_mcp import EditorFixture

ROOT=Path(__file__).resolve().parents[1]

def main():
    microphone_trial='--microphone-input' in sys.argv
    runtime_trial='--workspace-runtime' in sys.argv
    files_trial='--workspace-files' in sys.argv
    locale_trial='--workspace-locale' in sys.argv
    if microphone_trial:os.environ.setdefault('BRIVANY_META_API_KEY','fixture-not-a-real-key')
    report={'type':'actual_owned_WebView2_windows_with_synthetic_conversation','passed':False,'external_calls':0,'microphone_used':False,'OS_input_sent':False,'appbar_reserved_by_test':False}
    with tempfile.TemporaryDirectory(prefix='brivany-workspace-native-') as temp,LocalDesktopServer(handler=experience_handler(Handler)) as server:
        if microphone_trial:server.http.voice_bridge=SimpleNamespace(port=1)
        session=DesktopUISession(NATIVE_PAGES|MODULE_ROUTES);server.http.desktop_ui_session=session;server.http.computer_lock=threading.RLock();server.http.computer_native=True
        server.http.workspace_preferences=WorkspacePreferences(Path(temp)/'preferences.json')
        if locale_trial:server.http.workspace_preferences.update({'interface':{'locale':'fr'}})
        editor=EditorFixture();computer=ComputerService(server.base_url,lambda:None,root=Path(temp)/'computer',runtime=Runtime(),planner=Planner(),native=True,edits_factory=lambda:editor)
        computer.chat_turn=lambda *a,**k:iter([{'type':'delta','text':'Respuesta sintética nativa.'},{'type':'sentence','text':'Respuesta sintética nativa.'},{'type':'done','text':'Respuesta sintética nativa.','await_user':True}])
        real_account=None
        if '--account-query' in sys.argv:
            from services.brivany_account import DesktopAccount,AccountHTTP
            class CountedHTTP(AccountHTTP):
                def __init__(self):super().__init__();self.calls=0
                def call(self,*a,**k):self.calls+=1;return super().call(*a,**k)
                def chat(self,*a,**k):
                    self.calls+=1
                    for event in super().chat(*a,**k):
                        if event.get('type')=='computer_job':self.last_command=event['command']['id']
                        yield event
            real_account=DesktopAccount(ROOT/'.local/account',lambda:computer,http=CountedHTTP());computer.chat_turn=lambda value,token=None,cancelled=None:real_account.chat_turn(value,cancelled)
        server.http.computer=computer
        bridge=ExperienceBridge(server.base_url,server.session,lambda:None);bridge._desktop_ui_session=session;bridge._computer_factory=lambda:computer
        if real_account:bridge._account_factory=lambda:real_account
        work=WorkSession(Path(temp)/'work');bridge._work_factory=lambda:work
        music_fixture={'connected':False,'configured':False,'persistent':True,'streaming_access':False}
        bridge.spotify_status=lambda:dict(music_fixture)
        bridge.spotify_playback=lambda:{**music_fixture,'playback':None,'devices':[]}
        # Geometry tests drive layout explicitly; the real cursor belongs to the
        # user and must not independently open/close this synthetic test panel.
        if not runtime_trial:bridge.work_island_pointer=lambda:None
        bridge.spotify_lyrics=lambda *args:{'track_id':'a'*22,'lines':[],'instrumental':True}
        class TranslationFixture:
            def __init__(self):self.value={'active':False,'state':'idle'};self.calls=[]
            def start(self,target,voice):self.calls.append((target,voice));self.value={'active':True,'state':'listening','target':target,'voice':voice};return self.status()
            def status(self):return dict(self.value)
            def set_voice(self,voice):self.value['voice']=voice;return self.status()
            def set_target(self,target):self.value['target']=target;return self.status()
            def close(self):self.value.update(active=False,state='stopped');return self.status()
        translation_fixture=TranslationFixture();bridge._work_translation_factory=lambda:translation_fixture
        class BrowserSelectionFixture:
            def __init__(self):self.requests=0
            def start(self):return self
            def status(self):return {'available':True,'active_sessions':0,'paired_browsers':1}
            def request_video(self):self.requests+=1
            def close(self):pass
        browser_selection=BrowserSelectionFixture();bridge._sync_translation_factory=lambda:browser_selection
        # No second AppBar registration and no focus changes to the user's apps.
        class TestDock(DockHost):
            def bind(self,window):IslandHost.bind(self,window)
        owned=webview.create_window('Brivany · Prueba local',session.entry(server.base_url,'/brivany-shell'),js_api=bridge,hidden=False,width=800,height=640,focus=False)
        bridge._desktop_widget_service=DesktopWidgets(Path(temp)/'widgets.json',dispatcher=lambda:owned.native,publish=bridge._publish_desktop_widgets)
        if runtime_trial:
            from tools.workspace_native_runtime import count_bridge_calls, measure_workspace
            bridge_counts=count_bridge_calls(bridge)
        bridge._bind_window(owned)
        session.bind_window(owned,server.base_url)
        def verify_result():
            report['phase']='glisse_result_without_big_app'
            from uuid import uuid4
            until=time.monotonic()+15
            while time.monotonic()<until:
                if bridge._work_window.evaluate_js('Boolean(window.BrivanyResultView)'):break
                time.sleep(.1)
            identifier=str(uuid4());path=computer.workspace/'documents'/(identifier+'.txt');path.parent.mkdir(exist_ok=True)
            path.write_text('Documento de prueba\n\n'+('Contenido propio para comprobar el visor compacto.\n'*60),encoding='utf-8')
            computer.jobs[identifier]={'id':identifier,'kind':'document','state':'succeeded','title':'Documento de prueba','phase':'Revisado','result':{'title':'Documento de prueba','path':str(path)},'reviewed':False,'steps':0,'error':None,'external_calls':0,'cancelled':threading.Event(),'finished':threading.Event()}
            bridge.return_to_chat=lambda:(_ for _ in ()).throw(AssertionError('Result opened the main app'))
            bridge.work_agent_review(identifier);host=bridge._island_host
            assert host.current==(520,340),host.current
            result_dom=bridge._work_window.evaluate_js("(()=>{const e=document.querySelector('.result-scroll'),g=document.querySelector('.result-glass');return {glisse:!!document.querySelector('#glisse-styles'),height:g.offsetHeight,width:g.offsetWidth,vertical:e.scrollHeight>e.clientHeight,horizontal:e.scrollWidth>e.clientWidth,bar:getComputedStyle(e).scrollbarWidth,backdrop:getComputedStyle(g).backdropFilter};})()")
            assert result_dom['glisse'] and result_dom['height']==340 and result_dom['width']==520 and result_dom['vertical'] and not result_dom['horizontal'] and result_dom['bar']=='none',result_dom
            from System import Action
            panel=bridge._work_window.native;colors={}
            def read():colors['webview']=[int(getattr(panel.webview.DefaultBackgroundColor,k)) for k in ('A','R','G','B')]
            panel.Invoke(Action(read));assert colors['webview']==[0,0,0,0],colors
            assert host.taskbar_hidden and computer.jobs[identifier]['reviewed']
            report.update(glisse_result_native=result_dom,native_backdrop_applied=host.glass_applied,result_rgba=dict(colors),result_does_not_open_big_app=True,result_region_final_before_show=True)
            bridge.work_island_layout(True,'normal','melodi',False,False,400)
            panel.Invoke(Action(read));assert colors['webview']==[255,0,0,0],colors
            report['opaque_surface_restored_after_result']=True
        def test():
            try:
                report['phase']='load_chat_controller'
                until=time.monotonic()+20
                while time.monotonic()<until:
                    if owned.evaluate_js("Boolean(document.querySelector('#module-frame')?.contentWindow?.BrivanyChat?.workspaceCommand)"):break
                    time.sleep(.15)
                else:raise ValueError('El controlador de conversación no cargó en WebView2.')
                report['phase']='create_workspace_views'
                with patch('desktop.experience.work.DockHost',TestDock):bridge.start_work()
                until=time.monotonic()+15
                while time.monotonic()<until:
                    if bridge._island_host.window and bridge._island_host.region and bridge._bar_window:break
                    time.sleep(.15)
                else:raise ValueError('No se enlazaron las superficies nativas.')
                assert getattr(bridge,'_voice_window',None) is None, 'Idle startup allocated the voice WebView.'
                report['voice_webview_deferred_on_startup']=True
                if runtime_trial:
                    report['phase']='workspace_runtime'
                    measure_workspace(bridge,owned,bridge_counts,report)
                    report['passed']=True
                    return
                if files_trial:
                    report['phase']='workspace_file_roundtrip'
                    verify_files(bridge, Path(temp), report)
                    report['passed']=True
                    return
                if locale_trial:
                    report['phase']='workspace_locale'
                    verify_locale(bridge, owned, server.http.workspace_preferences, report)
                    report['passed']=True
                    return
                if microphone_trial:
                    report['phase']='native_microphone_input'
                    # Real getUserMedia/AudioContext/analyser, no ASR, network or
                    # saved audio. The only override disables transcription.
                    owned.evaluate_js("(()=>{const w=document.querySelector('#module-frame').contentWindow,p=w.BrivanyVoice.Microphone.prototype,start=p.start;p.start=function(options){w.__nativeMic=this;return start.call(this,{...options,transcribe:false});};})()")
                    owned.hide();bridge.work_island_layout(True,'normal','chat',False,False,400)
                    until=time.monotonic()+5
                    while time.monotonic()<until:
                        if bridge._work_window.evaluate_js("Boolean(window.BrivanyWorkspace)&&document.body.dataset.panel==='chat'&&document.body.dataset.expanded==='true'"):break
                        time.sleep(.1)
                    bridge._work_window.evaluate_js("document.querySelector('#workspace-chat-mic').click()")
                    until=time.monotonic()+16
                    while time.monotonic()<until:
                        snapshot=bridge.workspace_chat_state()
                        if snapshot.get('dictation',{}).get('phase')=='recording':break
                        if snapshot.get('error'):raise ValueError(snapshot['error'])
                        time.sleep(.1)
                    else:
                        report['capture_debug']=owned.evaluate_js("(()=>{const w=document.querySelector('#module-frame').contentWindow,m=w.__nativeMic;return {controller:!!w.BrivanyChat,active:m?.active,context:m?.audio?.state,status:w.document.querySelector('#chat-state')?.textContent};})()")
                        report['popup_debug']=bridge._work_window.evaluate_js("({phase:document.body.dataset.dictationPhase,error:document.querySelector('#workspace-chat-status').textContent})")
                        raise ValueError('Native microphone did not start within 16 seconds.')
                    time.sleep(.6)
                    capture=owned.evaluate_js("(()=>{const m=document.querySelector('#module-frame').contentWindow.__nativeMic;return {active:m.active,tracks:m.stream.getAudioTracks().map(t=>t.readyState),context:m.audio.state,fft:m.analyser.fftSize};})()")
                    assert capture['active'] and capture['tracks']==['live'] and capture['context']=='running',capture
                    report.update(microphone_used=True,real_capture=capture,samples=len(bridge.workspace_chat_state().get('samples',[])),main_window_hidden=True,transcription_disabled=True,audio_persisted=False)
                    bridge.workspace_chat_command('dictate_cancel');until=time.monotonic()+3
                    while time.monotonic()<until:
                        if bridge.workspace_chat_state().get('dictation',{}).get('phase')=='idle':break
                        time.sleep(.1)
                    assert owned.evaluate_js("document.querySelector('#module-frame').contentWindow.__nativeMic.stream===null")
                    report.update(passed=True,microphone_released_on_cancel=True);return
                if '--results-only' in sys.argv:
                    verify_result();report['passed']=True;return
                if real_account:
                    import re
                    bridge.work_island_layout(True,'normal','chat',False,False,400)
                    adaptive='--adaptive' in sys.argv
                    question='¿Cuántos servicios con inicio automático están detenidos ahora?' if adaptive else 'Cuántos procesos hay?'
                    bridge.workspace_chat_command('send',question);until=time.monotonic()+40;answer=None
                    if '--closed-reply' in sys.argv:bridge.work_island_layout(False,'normal','chat',False,True,400)
                    while time.monotonic()<until:
                        texts=[m['text'] for m in bridge.workspace_chat_state().get('messages',[]) if m['role']=='assistant']
                        answer=next((text for text in texts if re.fullmatch(r'Ahora hay \d+ procesos en ejecución en tu PC\.',text)),None) if not adaptive else next((text for text in texts if 'servicio' in text.lower() and re.search(r'\d',text)),None)
                        if answer:break
                        time.sleep(.15)
                    assert answer,'The real account task result did not reach native chat.'
                    if '--closed-reply' in sys.argv:
                        until=time.monotonic()+5
                        while bridge._voice_window.evaluate_js("document.body.dataset.replyVisible")!='true' and time.monotonic()<until:time.sleep(.1)
                        assert bridge._voice_host.current==(420,80),bridge._voice_host.current
                        assert bridge._voice_window.evaluate_js('innerWidth===420&&innerHeight===80'),'The physical reply WebView is larger than the card.'
                        assert bridge._voice_window.evaluate_js("document.body.dataset.replyVisible==='true'&&document.querySelector('#workspace-reply-text').textContent.length>0")
                        handle,user,_=bridge._voice_host.region;style=user.GetWindowLongW(handle,-20);assert style&0x20 and style&0x80 and not style&0x40000
                        report.update(closed_reply_glass=True,reply_height=80,reply_click_through=True,reply_native_glass=bridge._voice_host.glass_applied,physical_reply_viewport=[420,80],backdrop_window_matches_card=True)
                        bridge.work_island_layout(True,'normal','chat',False,False,400)
                    assert bridge._work_window.evaluate_js("[...document.querySelectorAll('.workspace-bubble')].some(e=>/\\d/.test(e.textContent)&&/procesos|servicios/.test(e.textContent))")
                    extra={}
                    if adaptive:
                        command=real_account.command_status(real_account.http.last_command)['command'];output=command['result']['output'];facts=output['facts']
                        assert facts['source']=='services' and str(facts['aggregate']['value']) in answer
                        extra={'source_command':facts['source_command'],'aggregate_value':facts['aggregate']['value'],'local_model_requests':command['result']['external_calls']}
                    report.update(passed=True,type='real account read-only query through owned native chat to running desktop',phase='real_account_adaptive_diagnostic_visible' if adaptive else 'real_account_query_result_visible',real_account_result_delivered=True,observed_number=int(re.search(r'\d+',answer)[0]),old_fixed_phrase_absent=all('Claro, lo haré.' not in t for t in texts),external_calls=real_account.http.calls,inference_requests=3 if adaptive else 0,conversation_saved=False,**extra)
                    return
                report['phase']='native_auditory_start'
                bridge._bar_window.evaluate_js("document.querySelector('#workspace-audio').click()")
                until=time.monotonic()+5
                while not browser_selection.requests and time.monotonic()<until:time.sleep(.05)
                assert browser_selection.requests==1 and not translation_fixture.calls
                assert bridge._island_host.value['panel']=='auditory'
                # The substituted browser reports an explicit selection. The
                # toolbar click itself must only request it.
                bridge.work_audio_translation_start('en','auto')
                assert translation_fixture.calls==[('en','auto')],translation_fixture.calls
                assert '/app' in owned.evaluate_js("document.querySelector('#module-frame').src")
                until=time.monotonic()+3
                while bridge._work_window.evaluate_js("document.querySelector('#auditory-toggle').textContent")!='Detener' and time.monotonic()<until:time.sleep(.05)
                bridge._work_window.evaluate_js("document.querySelector('#auditory-toggle').click()")
                until=time.monotonic()+3
                while translation_fixture.status()['active'] and time.monotonic()<until:time.sleep(.05)
                assert not translation_fixture.status()['active']
                report['auditory_selection_and_stop_without_navigation']=True
                report['phase']='translation_native_stress'
                from desktop.experience.scripts import evaluate_script
                stress_errors=[]
                def resize_while_updating():
                    try:
                        for i in range(12):
                            bridge._dock_position({'bottom':40})
                            bridge.work_island_layout(True,'normal','auditory',False,False,300+i*7)
                    except Exception as error:stress_errors.append(type(error).__name__)
                resizer=threading.Thread(target=resize_while_updating,daemon=True);resizer.start()
                for i in range(12):
                    bridge.work_audio_translation_start('en','auto')
                    bridge.work_audio_translation_target(('en','es','fr')[i%3])
                    assert evaluate_script(bridge._work_window,'document.querySelectorAll("[data-auditory-target]").length')==3
                    bridge.work_audio_translation_stop()
                resizer.join(timeout=6);assert not resizer.is_alive() and not stress_errors,stress_errors
                report['translation_stress_cycles']=12;report['bounded_native_script_responses']=True
                bridge.work_island_layout(False,'normal','auditory',False,True,400)
                report['phase']='dark_surface_and_selector_entry'
                from System import Action
                panel_native=bridge._work_window.native;colors={}
                def read_colors():
                    for name,color in [('form',panel_native.BackColor),('webview',panel_native.webview.DefaultBackgroundColor)]:colors[name]=[int(color.A),int(color.R),int(color.G),int(color.B)]
                panel_native.Invoke(Action(read_colors))
                assert colors=={'form':[255,0,0,0],'webview':[255,0,0,0]},colors
                host=bridge._island_host;levels=[];original_alpha=host._alpha
                def record_alpha(value):levels.append(value);return original_alpha(value)
                host._alpha=record_alpha
                for _ in range(3):
                    levels.clear();bridge.work_island_layout(True,'normal','melodi',True,False,400)
                    assert host.current==(250,104),'Selector must be clipped to its complete shape before showing'
                    deadline=time.monotonic()+2
                    while time.monotonic()<deadline and (not levels or levels[-1]!=255):time.sleep(.02)
                    assert len(levels)>2 and levels[0]==0 and levels[-1]==255 and levels==sorted(levels),levels
                    bridge.work_island_layout(False,'normal','melodi',False,True,400)
                # Reduced-motion entry is immediate and cannot leave an old fade.
                levels.clear();bridge.work_island_layout(True,'normal','melodi',False,False,400)
                assert levels==[255],levels
                bridge.work_island_layout(False,'normal','melodi',False,True,400)
                host._alpha=original_alpha
                report.update(native_surfaces_rgba=colors,selector_fade_cycles=3,selector_full_region_before_show=True,reduced_motion_entry_immediate=True)
                report['phase']='music_initial_dimensions'
                connected={'connected':True,'configured':True,'persistent':True,'streaming_access':False}
                music_fixture.update(connected)
                bridge._spotify_factory=lambda:SimpleNamespace(status=lambda:connected)
                first=bridge.work_island_layout(True,'normal','music',True,False,400)
                assert first['panel']=='music-player' and host.current==(720,232),(first,host.current)
                first_dom=bridge._work_window.evaluate_js("(()=>{const e=document.querySelector('#island-content');return {width:e.offsetWidth,height:e.offsetHeight,playerVisible:!document.querySelector('#spotify-player').hidden,panel:document.body.dataset.panel,surface:document.body.dataset.surface,style:document.documentElement.style.cssText};})()")
                assert first_dom['width']==720 and first_dom['height']==232 and first_dom['playerVisible'],first_dom
                bridge.work_island_layout(False,'normal','music-player',False,True,400)
                library=bridge.work_island_layout(True,'normal','music-library',True,False,400)
                assert host.current==(720,404),library
                bridge.work_island_layout(False,'normal','music-library',False,True,400)
                report.update(music_initial_geometry=[first['width'],first['height']],music_library_initial_geometry=[library['width'],library['height']],music_connection_rendered_before_show=True)
                del bridge._spotify_factory
                music_fixture.update(connected=False,configured=False)
                # Reproduce pywebview's per-new-view cookie deletion and verify
                # UI navigations still authenticate at the native request layer.
                bridge.work_island_layout(True,'normal','chat',False,False,400)
                assert bridge._island_host.current==(388,148),bridge._island_host.current
                report['phase']='clear_cookies_and_reload_panel'
                from System import Action
                native=owned.native
                native.Invoke(Action(lambda:native.webview.CoreWebView2.CookieManager.DeleteAllCookies()))
                response=[];done=threading.Event()
                def received(value):response.append(value);done.set()
                bridge._work_window.evaluate_js("fetch('/work-widget?surface=panel',{cache:'no-store'}).then(async r=>({status:r.status,html:(await r.text()).includes('workspace-chat-form')}))",received)
                if not done.wait(8):raise ValueError('La petición nativa no terminó.')
                verified=response[0]
                if not isinstance(verified,dict) or verified.get('status')!=200 or not verified.get('html'):raise ValueError('El panel perdió su acceso después de borrar cookies.')
                report['phase']='native_chat_roundtrip'
                bridge.work_island_layout(True,'normal','chat',False,False,400)
                bridge.workspace_chat_command('send','Mensaje sintético de integración')
                until=time.monotonic()+15
                while time.monotonic()<until:
                    messages=bridge.workspace_chat_state().get('messages',[])
                    if any(m['role']=='assistant' and m['text']=='Respuesta sintética nativa.' for m in messages):break
                    time.sleep(.15)
                else:raise ValueError('La respuesta no regresó al chat compacto por el puente nativo.')
                until=time.monotonic()+4
                while bridge._work_window.evaluate_js("document.querySelectorAll('.workspace-bubble').length")<2 and time.monotonic()<until:time.sleep(.1)
                assert bridge._work_window.evaluate_js("document.querySelectorAll('.workspace-bubble').length")>=2
                until=time.monotonic()+4
                while bridge._island_host.current[1]<=148 and time.monotonic()<until:time.sleep(.1)
                assert 148<bridge._island_host.current[1]<=404,bridge._island_host.current
                report['chat_compact_then_grows_with_messages']=True
                bridge.work_island_layout(False,'normal','chat',False,True,400);bridge.work_island_layout(True,'normal','chat',False,False,400)
                assert bridge._work_window.evaluate_js("document.querySelectorAll('.workspace-bubble').length")>=2
                bridge.work_island_layout(True,'normal','melodi',False,False,400)
                report['phase']='rounded_chooser'
                assert bridge._work_window.evaluate_js("getComputedStyle(document.querySelector('.panel-top')).display")=='none'
                assert bridge._work_window.evaluate_js("getComputedStyle(document.querySelector('#companion-write')).borderRadius")=='999px'
                bridge.work_island_layout(True,'normal','chat',False,False,400)
                # Verify the native user-activation dispatch without opening a mic.
                owned.evaluate_js("(()=>{const c=document.querySelector('#module-frame').contentWindow.BrivanyChat,original=c.workspaceCommand;c.workspaceCommand=r=>{if(r.action==='start'){window.__nativeLiveDispatch=true;return;}return original(r);};})()")
                bridge.workspace_chat_command('start')
                report['phase']='native_live_dispatch'
                until=time.monotonic()+5
                while time.monotonic()<until:
                    if owned.evaluate_js('window.__nativeLiveDispatch===true'):break
                    time.sleep(.1)
                else:raise ValueError('Live no recibió el gesto nativo de inicio.')
                snapshot=bridge.workspace_chat_state();bridge.workspace_chat_publish({**snapshot,'listening':True});bridge.workspace_live_signal({'level':.08,'samples':[.15]*48})
                until=time.monotonic()+15
                while time.monotonic()<until:
                    if bridge._voice_host.window and bridge._voice_host.region and bridge._voice_window.evaluate_js('Boolean(window.BrivanyWorkspace)'):break
                    time.sleep(.1)
                else:raise ValueError('La ventana de voz diferida no se enlazó al primer uso.')
                assert bridge._island_host.value['y']>=118
                assert not bridge._voice_host._visible,'The waveform overlay must stay hidden behind the chat.'
                bridge._workspace_reply_deadline=0
                bridge.work_island_layout(False,'normal','chat',False,False,400)
                report['phase']='voice_canvas'
                assert bridge._workspace_overlay_mode=='live-wave',bridge._workspace_overlay_mode
                assert bridge._voice_window.evaluate_js("document.body.dataset.liveListening")=='true'
                time.sleep(.3)
                assert bridge._voice_window.evaluate_js("(()=>{const c=document.querySelector('#voice-wave');return c.width>0&&c.height>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(n=>n>0)})()")
                handle,user,_=bridge._voice_host.region
                style=user.GetWindowLongW(handle,-20)
                assert style&0x20 and style&0x80 and not style&0x40000
                import ctypes
                key,alpha,flags=ctypes.c_ulong(),ctypes.c_ubyte(),ctypes.c_ulong()
                user.GetLayeredWindowAttributes.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p]
                assert user.GetLayeredWindowAttributes(handle,ctypes.byref(key),ctypes.byref(alpha),ctypes.byref(flags))
                assert bridge._voice_host._visible and key.value==0 and flags.value&1
                assert bridge._voice_window.evaluate_js("getComputedStyle(document.querySelector('#voice-stage')).backgroundColor")=='rgba(0, 0, 0, 0)'
                bridge.workspace_live_signal({'level':0,'samples':[]})
                assert not bridge._voice_host._visible,'Silence must hide the native waveform overlay.'
                report.update(waveform_chroma_key=True,waveform_hidden_during_chat_and_silence=True)
                bridge.workspace_chat_publish({**snapshot,'listening':False,'speaking':True})
                assert bridge._bar_window.evaluate_js("document.body.dataset.liveSpeaking")=='true'
                bridge._broadcast_spotify({'connected':True,'playback_revision':9999,'playback':{'id':'a'*22,'type':'track','playing':True,'title':'Synthetic','artist':'Fixture','duration_ms':180000,'progress_ms':1000,'device':'fixture'},'devices':[{'id':'fixture','name':'Fixture'}]})
                report['phase']='music_waves'
                until=time.monotonic()+3
                while time.monotonic()<until:
                    if bridge._bar_window.evaluate_js("document.body.dataset.musicAmbience==='true'&&getComputedStyle(document.querySelector('.workspace-waves')).opacity==='1'"):break
                    time.sleep(.1)
                assert bridge._bar_window.evaluate_js("document.body.dataset.musicAmbience==='true'&&getComputedStyle(document.querySelector('.workspace-waves')).opacity==='1'")
                verify_result()
                report.update(passed=True,real_native_bridge_roundtrip=True,history_survives_close=True,rounded_chooser_without_header=True,voice_canvas_contains_pixels=True,music_waves_visible=True,voice_overlay_created_and_click_through=True,live_sample_visualization='synthetic, no capture',four_owned_views=True,UI_survives_cookie_deletion=True)
            except Exception as error:
                import traceback
                report['error']=repr(error);report['traceback']=traceback.format_exc()
                if real_account:report['native_chat_error']=bridge.workspace_chat_state().get('error','')
            finally:
                if real_account:report['external_calls']=real_account.http.calls
                try:
                    bridge._exit_requested=True;bridge._close_work_translation();bridge._close_sync_translation();work.close();bridge._close_island_windows();bridge._close_desktop_widgets();bridge._close_workspace_files();computer.close()
                    if real_account:real_account.close()
                finally:owned.destroy()
        thread=threading.Thread(target=test,daemon=True);owned.events.loaded+=thread.start
        webview.start(gui='edgechromium',debug=False,private_mode=True,http_server=False)
    variants={'--workspace-files':'workspace-files-native','--workspace-runtime':'workspace-runtime-native',
              '--workspace-locale':'workspace-locale-native','--microphone-input':'microphone-input-native',
              '--closed-reply':'closed-reply-native','--adaptive':'adaptive-query-native',
              '--account-query':'account-query-native','--results-only':'result-native'}
    name=next((prefix for flag,prefix in variants.items() if flag in sys.argv),'native')
    folder=ROOT/'tmp/workspace-chat-ui'
    folder.mkdir(exist_ok=True)
    (folder/(name+'-report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))
    return 0 if report['passed'] else 1


def verify_locale(bridge, root, store, report):
    from desktop.experience.scripts import evaluate_script, post_script
    from tools.workspace_native_runtime import wait_for

    panel, bar = bridge._work_window, bridge._bar_window
    bridge.work_island_layout(True, 'normal', 'widgets', False, False, 400)
    wait_for(lambda: evaluate_script(panel, """document.documentElement.lang==='fr' &&
        document.querySelector('#widget-timer-action')?.textContent==='Démarrer'"""))
    wait_for(lambda: evaluate_script(root, 'Boolean(window.BrivanyDesktopPreferenceStore)'))
    for code, button, tools in [('pt-BR','Iniciar','Ferramentas'),('en','Start','Tools'),
                                ('es','Iniciar','Herramientas'),('fr','Démarrer','Outils')]:
        post_script(root, "BrivanyDesktopPreferenceStore.update('interface',"+json.dumps({'locale':code})+")", 'locale-fixture')
        expected=json.dumps([code,button,tools])
        wait_for(lambda: evaluate_script(panel, """(()=>{
            const expected="""+expected+""";
            return document.documentElement.lang===expected[0] &&
             document.querySelector('#widget-timer-action')?.textContent===expected[1];
        })()"""))
        wait_for(lambda: evaluate_script(bar, """(()=>{
            const expected="""+expected+""";
            return document.documentElement.lang===expected[0] &&
             document.querySelector('#tools [data-panel=widgets] span')?.textContent===expected[2];
        })()"""))
    saved = WorkspacePreferences(store.path).snapshot()
    assert saved['interface']['locale'] == 'fr' and saved['general']['language'] == 'es-ES'
    report['type'] = 'owned_webview2_windows_with_real_locale_preference'
    report['checks'] = ['French boots from a saved catalog; Portuguese, English, Spanish and French switch live in both native windows and persist independently of voice.']


def verify_files(bridge, temporary, report):
    from base64 import b64encode
    from email import policy
    from email.parser import BytesParser
    from io import BytesIO
    from reportlab.pdfgen.canvas import Canvas
    from desktop.experience.scripts import evaluate_script
    from tests.test_workspace_files import word_fixture

    def wait_for(script):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if evaluate_script(panel, script):
                return
            time.sleep(.06)
        raise AssertionError('The native file action did not settle')

    report['type'] = 'owned_webview2_and_real_local_office_mime_paths'
    report['checks'] = []
    report['limitations'] = 'Owned synthetic file; save dialog and external mail client substituted. No account or send.'
    panel = bridge._work_window
    data = word_fixture('<p><r><t>Presupuesto de prueba: 42 unidades.</t></r></p>')
    bridge.work_island_layout(True,'normal','files',False,False,400)
    bridge.workspace_files_upload('Presupuesto.docx', b64encode(data).decode('ascii'))
    wait_for("document.querySelector('.shelf-copy strong')?.textContent==='Presupuesto.docx'")
    with patch.object(bridge, 'workspace_chat_command', side_effect=AssertionError('Implicit send')) as command:
        panel.evaluate_js("document.querySelector('.shelf-actions button').click()")
        wait_for("""document.body.dataset.panel==='chat' &&
          document.querySelector('#workspace-chat-input').value.includes('Presupuesto de prueba: 42 unidades.') &&
          document.activeElement.id==='workspace-chat-input'""")
        command.assert_not_called()
    report['checks'].append('Clicking Preguntar reads the local DOCX and focuses an editable chat draft without sending.')
    bridge.work_island_layout(True,'normal','files',False,False,400)
    path = temporary / 'owned-test-draft.eml'
    with patch.object(panel, 'create_file_dialog', return_value=str(path)) as picker, \
            patch('desktop.experience.workspace_files._open_file', side_effect=OSError) as opened:
        panel.evaluate_js("Array.from(document.querySelectorAll('.shelf-menu button')).find(button=>button.textContent==='Correo').click()")
        wait_for("document.querySelector('.shelf-status').textContent==='Correo guardado con el adjunto.'")
        picker.assert_called_once()
        opened.assert_called_once_with(path)
    message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
    attachment, = message.iter_attachments()
    assert attachment.get_payload(decode=True) == data and attachment.get_filename() == 'Presupuesto.docx'
    assert 'To' not in message and message['X-Unsent'] == '1'
    report['checks'].append('Clicking Correo writes the recipient-less EML and exact DOCX attachment to the selected path.')
    pdf = BytesIO()
    canvas = Canvas(pdf)
    canvas.drawString(30, 80, 'Contenido del PDF de prueba.')
    canvas.save()
    bridge.workspace_files_upload('Lectura.pdf', b64encode(pdf.getvalue()).decode('ascii'))
    wait_for("document.querySelectorAll('.shelf-file').length===2")
    panel.evaluate_js("""Array.from(document.querySelectorAll('.shelf-file'))
      .find(row=>row.querySelector('strong').textContent==='Lectura.pdf').querySelector('.shelf-actions button').click()""")
    wait_for("""document.body.dataset.panel==='chat' &&
      document.querySelector('#workspace-chat-input').value.includes('Página 1: Contenido del PDF de prueba.')""")
    report['checks'].append('A PDF click runs the local child parser and opens the extract in the same chat composer.')

if __name__=='__main__':raise SystemExit(main())
