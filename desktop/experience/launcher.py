"""Launch the Brivany experience shell in a native cross-platform window."""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH, LOCAL_ROOT
import argparse
import os
from pathlib import Path
import sys
import threading
import time
from urllib.parse import urlsplit

from desktop.bridge import DesktopBridge, DesktopError
from desktop.launcher import LocalDesktopServer, dependency_status
from services.h1.server import Handler, STATIC
from services.projects import SpatialProjectSource
from desktop.experience.work import WorkBridge
from desktop.experience.music import MusicBridge
from desktop.experience.account import AccountBridge
from desktop.experience.workspace_files import WorkspaceFilesBridge
from desktop.experience.workspace_controls import WorkspaceControlsBridge
from desktop.experience.workspace_daily import WorkspaceDailyBridge
from desktop.experience.workspace_recording import WorkspaceRecordingBridge
from desktop.experience.workspace_phone import WorkspacePhoneBridge
from desktop.experience.canvas_window import WorkspaceCanvasBridge
from desktop.experience.desktop_widgets import DesktopWidgetsBridge
from desktop.experience.workspace_call import WorkspaceCallBridge
from desktop.experience.telephony import TelephoneBridge
from desktop.experience.phone_control import WorkspacePhoneControlBridge
from desktop.experience.workspace_game import WorkspaceGameBridge
from desktop.experience.workspace_preferences import WORKSPACE_LOCALES

ROOT = Path(__file__).resolve().parents[2]
EXPERIENCE = Path(__file__).resolve().parent
NATIVE_PAGES={'/brivany-shell','/work-widget','/work-capture','/work-voice','/spotify-player','/workspace-canvas','/workspace-music-expansion'}


def local_music_playing(bridge):
    """Read already-published SDK state; do not create Spotify or call its API."""
    host=getattr(bridge,'_spotify_player_host',None)
    if not host or not getattr(host,'_window',None):return False
    music=getattr(host,'_music',None)
    snapshot=getattr(music,'sdk_snapshot',None)
    return (getattr(music,'local_player',{}).get('state')=='ready'
            and isinstance(snapshot,dict) and snapshot.get('playing') is True)


ASSETS = {"shell.css": (EXPERIENCE / "shell.css", "text/css; charset=utf-8"),
          "windowbar.css": (EXPERIENCE / "windowbar.css", "text/css; charset=utf-8"),
          "shell.js": (EXPERIENCE / "shell.js", "text/javascript; charset=utf-8"),
          "updates.js": (EXPERIENCE / "updates.js", "text/javascript; charset=utf-8")}
for name in ('volume-ducking.js','workspace-tools.css','icons.js','module.css', 'module.js', 'services.js', 'computer.js', 'computer.css','references.js','references.css','agents.js','minimal.css','chat.js','chat.css','preferences.js','settings.js','settings.css','work.js','work.css','island.js','island.css','workspace-music.css','character.css','music-motion.js','spotify-player.js','spotify-connections.js','spotify-connections.css'):
    ASSETS[name] = (EXPERIENCE / name, 'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('file-approvals.js','file-approvals.css'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('agent-avatars.js','agent-avatars.css','blobatar-motion.css','account.js','account.css','demo-account.js','demo-account.css','workspace-agents.js','workspace-agents.css','workspace-results.js','workspace-results.css','glisse.css'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('chat-media.js','chat-history.js','chat-activity.js','chat-activity.css','chat-text.js','chat-scroll.js','chat-agents.js','chat-agents.css','image-viewer.js','image-viewer.css','shell-boot.js'):
    ASSETS[name]=(ROOT/'desktop/experience'/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')

for name in ('workspace-companion.js','workspace-companion.css','workspace-translation.js','workspace-translation.css','research-citations.js'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('sync-connections.js','sync-connections.css'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('workspace-files.js','workspace-files.css','workspace-widgets.js','workspace-widgets.css','workspace-polish.js','workspace-polish.css','workspace-daily.js','workspace-daily.css','workspace-recording.js','workspace-recording.css','desktop-preference-store.js','workspace-preferences.js','workspace-settings.js','workspace-localization.js','workspace-phone.js','workspace-phone.css','workspace-phone-settings.js','drop-peer.js','workspace-drop.js','workspace-drop.css'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for locale in WORKSPACE_LOCALES:
    if locale != 'es':
        name=f'workspace-locales/{locale}.json'
        ASSETS[name]=(EXPERIENCE/name,'application/json; charset=utf-8')
MODULE_ROUTES = {'/', '/app', '/app/', '/spaces', '/spaces/', '/viewer', '/human-skills',
                 '/human-skills/', '/practice', '/dubbing', '/dubbing/', '/translate', '/translate/',
                 '/connections', '/activity', '/activity/', '/sous', '/desktop-services','/computer','/settings','/meetings'}
for name in ('team-companions.js','team-companions.css','music-expansion.js','music-expansion-core.js','music-expansion.css'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('moon.jpg','earth.jpg'):
    ASSETS['music-assets/'+name]=(EXPERIENCE/'music-assets'/name,'image/jpeg')
for name in ('canvas.js','canvas-core.js','canvas.css','workspace-canvas-launcher.js','workspace-desktop-widgets.js','workspace-desktop-widget-settings.js','workspace-call.js','workspace-telephony.js','workspace-telephony.css','workspace-phone-control.js','workspace-phone-control.css','workspace-game.js','workspace-game.css'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')


def experience_handler(base_handler):
    preferences_lock = threading.Lock()
    class ExperienceHandler(base_handler):
        def workspace_preferences(self):
            with preferences_lock:
                store = getattr(self.server, 'workspace_preferences', None)
                if store is None:
                    from .workspace_preferences import WorkspacePreferences
                    store = WorkspacePreferences(DATA_ROOT/'.local/workspace/preferences.json')
                    self.server.workspace_preferences = store
                return store

        def workspace_preferences_html(self, page, *, workspace=False):
            if not getattr(self.server, 'desktop_ui_session', None):
                return page
            import json
            from html import escape
            snapshot = self.workspace_preferences().snapshot()
            value = escape(json.dumps(snapshot, ensure_ascii=False), quote=True)
            catalog = ''
            locale = snapshot['interface']['locale']
            if workspace and locale != 'es':
                path, _ = ASSETS[f'workspace-locales/{locale}.json']
                try:
                    messages = escape(path.read_text(encoding='utf-8'), quote=True)
                    catalog = f'<meta name="brivany-workspace-catalog" data-locale="{locale}" content="{messages}">'
                except OSError:
                    pass  # The view can keep its default locale if the catalog is unavailable.
            return page.replace('<head>', '<head><meta name="brivany-workspace-preferences" content="'+value
                                +'">'+catalog+'<script src="/desktop-shell/desktop-preference-store.js" defer></script>', 1)

        def workspace_preferences_access(self):
            if not self.local_request():
                return False
            session = getattr(self.server, 'desktop_ui_session', None)
            if not session or not session.authorized(self):
                self.reject_before_body(403, 'desktop_preferences', 'Abre los ajustes desde Brivany Desktop.')
                return False
            return True

        def send_header(self, keyword, value):
            # Existing modules deny every iframe by default. In this desktop
            # shell, permit same-origin framing only for the known Brivany
            # pages loaded into its module pane.
            route = urlsplit(self.path).path
            if route=='/spotify-player' and keyword.lower()=='permissions-policy':value='camera=(), microphone=(), autoplay=(self "https://sdk.scdn.co"), encrypted-media=(self "https://sdk.scdn.co")'
            if keyword.lower() == "content-security-policy":
                if route in MODULE_ROUTES:
                    value = value.replace("frame-ancestors 'none'", "frame-ancestors 'self'")
                if route == '/brivany-shell':
                    value = value.replace("frame-src 'none'", "frame-src 'self'")
                if route == '/spotify-player':value="default-src 'none'; script-src 'self' https://sdk.scdn.co; connect-src 'self' https://*.spotify.com wss://*.spotify.com https://*.scdn.co; frame-src https://sdk.scdn.co; media-src https://*.scdn.co blob:; img-src 'self' https://i.scdn.co https://mosaic.scdn.co; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
                if route == '/work-widget':
                    value = value.replace("img-src 'self'", "img-src 'self' https://i.scdn.co https://mosaic.scdn.co")
                if route in {'/app','/app/','/computer'}:
                    value = value.replace("frame-src 'none'", "frame-src 'self'")
            super().send_header(keyword, value)

        def do_GET(self):
            route = urlsplit(self.path).path
            session=getattr(self.server,'desktop_ui_session',None)
            if session and session.handle(self):return
            from .lifecycle import handle as lifecycle_http
            if lifecycle_http(self,'GET'):return
            from .drop_http import handle as drop_http
            if drop_http(self,'GET'):return
            from .chat_http import handle as chat_http
            if chat_http(self,'GET'):return
            if route=='/api/desktop/updates':
                if not self.workspace_preferences_access():return
                updates=getattr(self.server,'updates',None)
                if not updates:self.send_json(200,{'state':'source','version':'desarrollo','message':'Instala Brivany para recibir actualizaciones.'});return
                self.send_json(200,updates.status());return
            if route=='/api/desktop/workspace-preferences':
                if not self.workspace_preferences_access():return
                self.send_json(200,self.workspace_preferences().snapshot());return
            if route=='/api/desktop/runtime':
                if not self.local_request():return
                tray=getattr(self.server,'desktop_tray',None)
                work=getattr(self.server,'work',None)
                music=getattr(self.server,'spotify',None)
                bridge=getattr(self.server,'desktop_bridge',None)
                visuals=bridge._music_ui_diagnostics() if bridge and urlsplit(self.path).query=='visuals=1' else None
                translator=getattr(bridge,'_work_translation',None) if bridge else None
                translation=translator.status() if translator else None
                if translation:
                    translation={k:translation.get(k) for k in ('state','active','target','voice','buffered_seconds','captured_seconds','submitted_seconds','original_gain','microphone_captured','feedback_isolated','first_audio_ms')}
                    translation['audio_output']=translator.audio_diagnostics()
                sync=getattr(bridge,'_sync_translation_relay',None) if bridge else None
                self.send_json(200,{'ui_mode':'desktop-only' if session else 'local-test','tray':tray.status() if tray else {'active':False},'workspace_active':bool(work and work.active),'music_ducking':getattr(self.server,'music_ducking',None).status() if getattr(self.server,'music_ducking',None) else None,'spotify_audio':music.audio_diagnostics() if music else None,'workspace_visuals':visuals,'work_audio_translation':translation,'browser_translation':sync.status() if sync else {'available':False,'active_sessions':0},'auditory_mode':getattr(bridge,'_auditory_mode','direct') if bridge else 'direct'});return
            if route=='/api/work/audio':
                from services.work.http import serve_audio
                serve_audio(self);return
            if route=='/spotify-player':
                if not self.local_request():return
                self.send_bytes(200,(EXPERIENCE/'spotify-player.html').read_bytes(),'text/html; charset=utf-8');return
            if route=='/workspace-canvas':
                if not self.local_request():return
                self.send_bytes(200,(EXPERIENCE/'canvas.html').read_bytes(),'text/html; charset=utf-8');return
            if route=='/workspace-music-expansion':
                if not self.local_request():return
                page=(EXPERIENCE/'music-expansion.html').read_text(encoding='utf-8')
                self.send_bytes(200,self.workspace_preferences_html(page).encode('utf-8'),'text/html; charset=utf-8');return
            if route in {'/work-widget','/work-capture','/work-voice'}:
                if not self.local_request():return
                page=(EXPERIENCE/('work-widget.html' if route=='/work-widget' else 'work-voice.html' if route=='/work-voice' else 'work-capture.html')).read_text(encoding='utf-8')
                self.send_bytes(200,self.workspace_preferences_html(page,workspace=route=='/work-widget').encode('utf-8'),'text/html; charset=utf-8');return
            if route.startswith('/api/computer/'):
                from services.computer.http import get
                get(self);return
            if route == '/api/desktop/services':
                if not self.local_request(): return
                from packages.providers.live_voice import voice_status
                from packages.providers.meta import provider_status
                from packages.providers.river_translation import river_status
                voice, meta, translation = voice_status(), provider_status(), river_status()
                from packages.providers.general_chat import status as general_chat_status
                general=general_chat_status()
                self.send_json(200, {'local': True, 'remote_access_verified': False, 'services': [
                    {'name': 'Chat de Melodi', 'configured': bool(general.get('enabled') or meta.get('configured')), 'route': '/app'},
                    {'name': 'Escucha Muse live', 'configured': bool(voice.get('asr', {}).get('configured')), 'route': '/app'},
                    {'name': 'Voz Melodi Â· Cartesia', 'configured': bool(voice.get('tts', {}).get('configured')), 'route': '/app'},
                    {'name': 'TraducciÃ³n Â· Muse / Meta / Cartesia', 'configured': bool(translation.get('configured')), 'route': '/dubbing'},
                ]})
                return
            if route in MODULE_ROUTES:
                if not self.local_request(): return
                if route in {'/app','/app/','/settings','/desktop-services','/computer'}:
                    name={'/app':'chat.html','/app/':'chat.html','/settings':'settings.html','/desktop-services':'services.html','/computer':'computer.html'}[route]
                    page = (EXPERIENCE / name).read_text(encoding='utf-8')
                    if route in {'/settings','/app','/app/'}:page=self.workspace_preferences_html(page)
                else:
                    page = (ROOT / 'web' / STATIC[route][0]).read_text(encoding='utf-8')
                if route=='/connections':page=page.replace('</head>','<link rel="stylesheet" href="/desktop-shell/spotify-connections.css"><script src="/desktop-shell/spotify-connections.js" defer></script><link rel="stylesheet" href="/desktop-shell/sync-connections.css"><script src="/desktop-shell/sync-connections.js" defer></script></head>')
                if route=='/settings':page=page.replace('</head>','<link rel="stylesheet" href="/desktop-shell/account.css"><script src="/desktop-shell/account.js" defer></script><link rel="stylesheet" href="/desktop-shell/demo-account.css"><script src="/desktop-shell/demo-account.js" defer></script></head>')
                framing='' if route in {'/app','/app/','/settings'} else '<link rel="stylesheet" href="/desktop-shell/module.css">'
                page = page.replace('</head>', framing+'<script src="/desktop-shell/icons.js"></script><script src="/desktop-shell/module.js"></script><link rel="stylesheet" href="/desktop-shell/computer.css"><link rel="stylesheet" href="/desktop-shell/references.css"><script src="/desktop-shell/computer.js" defer></script><script src="/desktop-shell/references.js" defer></script></head>')
                self.send_bytes(200, page.encode('utf-8'), 'text/html; charset=utf-8')
                return
            if route == "/brivany-shell":
                if not self.local_request(): return
                page=(EXPERIENCE / "index.html").read_text(encoding='utf-8')
                self.send_bytes(200, self.workspace_preferences_html(page).encode('utf-8'), "text/html; charset=utf-8")
                return
            if route.startswith("/desktop-shell/"):
                if not self.local_request(): return
                asset = ASSETS.get(route.removeprefix("/desktop-shell/"))
                if asset is None:
                    self.error(404, "desktop_asset_missing", "Recurso no disponible.")
                    return
                path, content_type = asset
                self.send_bytes(200, path.read_bytes(), content_type)
                return
            super().do_GET()

        def do_POST(self):
            from .lifecycle import handle as lifecycle_http
            if lifecycle_http(self,'POST'):return
            from .drop_http import handle as drop_http
            if drop_http(self,'POST'):return
            from .chat_http import handle as chat_http
            if chat_http(self,'POST'):return
            if urlsplit(self.path).path=='/api/desktop/updates':
                if not self.workspace_preferences_access():return
                import json
                updates=getattr(self.server,'updates',None)
                try:
                    size=int(self.headers.get('Content-Length','0'))
                    if not updates or not 0<size<=128 or self.headers.get_content_type()!='application/json' or self.headers.get('Transfer-Encoding'):raise ValueError()
                    value=json.loads(self.rfile.read(size))
                    if set(value)!={'action'} or value['action'] not in {'check','download','restart'}:raise ValueError()
                    if value['action']=='restart':
                        updates.restart()
                        threading.Thread(target=self.server.update_exit,name='brivany-update-exit',daemon=True).start()
                    else:
                        threading.Thread(target=updates.check if value['action']=='check' else updates.stage,name='brivany-update-request',daemon=True).start()
                    self.send_json(200,updates.status())
                except (ValueError,OSError):self.error(409,'update_action','No se pudo iniciar la actualización.')
                return
            if urlsplit(self.path).path=='/api/desktop/workspace-preferences':
                if not self.workspace_preferences_access():return
                import json
                try:
                    length=int(self.headers.get('Content-Length','0'))
                    if (not self.headers.get('Origin') or self.headers.get('Transfer-Encoding')
                            or len(self.headers.get_all('Content-Length',[]))!=1
                            or not 0<length<=4096 or self.headers.get_content_type()!='application/json'):
                        raise ValueError('request')
                    value=json.loads(self.rfile.read(length))
                    if not isinstance(value,dict) or set(value)-{'patch','initial'} or 'patch' not in value:
                        raise ValueError('request')
                    saved=self.workspace_preferences().update(value['patch'],value.get('initial'))
                    bridge=getattr(self.server,'desktop_bridge',None)
                    if bridge and 'music' in value['patch']:bridge._configure_music_expansion(saved['music']['expansion'])
                    self.send_json(200,saved)
                except (ValueError,TypeError,KeyError):self.error(422,'workspace_preferences','Revisa los ajustes de WorkSpace.')
                except OSError:self.error(503,'workspace_preferences','No se pudieron guardar los ajustes en este equipo.')
                return
            if urlsplit(self.path).path=='/api/desktop/credentials':
                if not self.local_request():return
                import json
                from services.computer.http import service
                from services.h1.server import save_local_secret
                try:
                    length=int(self.headers.get('Content-Length','0'))
                    if not service(self).native or not self.headers.get('Origin') or not 0<length<=4096 or self.headers.get_content_type()!='application/json' or self.headers.get('Transfer-Encoding'):raise ValueError()
                    value=json.loads(self.rfile.read(length));variables={'meta':'BRIVANY_META_API_KEY','muse':'BRIVANY_MUSE_API_KEY','cartesia':'BRIVANY_CARTESIA_API_KEY'}
                    if set(value)!={'provider','key'} or value['provider'] not in variables:raise ValueError()
                    save_local_secret(value['key'],variables[value['provider']]);self.send_json(200,{'saved':True});return
                except (ValueError,TypeError,KeyError):self.error(422,'desktop_credentials','Revisa la clave y el servicio.');return
                except OSError:self.error(503,'desktop_credentials','No se pudo guardar la clave.');return
            if urlsplit(self.path).path.startswith('/api/computer/'):
                from services.computer.http import post
                post(self);return
            super().do_POST()
    return ExperienceHandler


class ExperienceBridge(WorkspaceGameBridge,WorkspacePhoneControlBridge,TelephoneBridge,WorkspaceCallBridge,DesktopWidgetsBridge,WorkspaceCanvasBridge,WorkspacePhoneBridge,WorkspaceRecordingBridge,WorkspaceDailyBridge,WorkspaceControlsBridge,WorkspaceFilesBridge,AccountBridge,MusicBridge,WorkBridge,DesktopBridge):
    """Keep existing native project actions scoped to this local shell origin."""
    def _trusted(self):
        if self._window is None:
            raise DesktopError("desktop_window", "La ventana todavÃ­a no estÃ¡ preparada.", 403)
        value = self._window.get_current_url()
        parsed = urlsplit(value or "")
        base = urlsplit(self._base)
        if ((parsed.scheme, parsed.hostname, parsed.port) != (base.scheme, base.hostname, base.port)
                or parsed.path not in {"/brivany-shell", "/spaces", "/spaces/", "/viewer"}
                or parsed.username or parsed.password):
            raise DesktopError("desktop_origin", "El puente nativo sÃ³lo estÃ¡ disponible en la ventana local de Brivany.", 403)

    def minimize_window(self):
        self._trusted()
        self._window.minimize()
        return {'ok':True,'minimized':True,'background':True}

    def set_window_maximized(self, maximized):
        self._trusted()
        if type(maximized) is not bool:
            raise DesktopError("desktop_window_state", "Estado de ventana invÃ¡lido.", 422)
        from .window_bounds import set_maximized
        set_maximized(self._window,maximized)
        return {"ok": True, "maximized": maximized}

    def close_window(self):
        return self.minimize_window()

    def authorize_computer(self):
        self._trusted()
        current=self._computer_factory()
        return {'ok':True,**({'token':current.grant,**current.status()} if current.authorized(current.grant) else current.arm())}

    def assistant_status(self):self._trusted();return self._computer_factory().status()
    def configure_whatsapp_desktop(self,enabled):
        self._trusted();return self._whatsapp_desktop.configure(enabled)
    def whatsapp_desktop_status(self):
        self._trusted();return self._whatsapp_desktop.status()
    def configure_computer_access(self,mode):
        self._trusted();return self._computer_factory().configure_access(mode)
    def approve_file_action(self,identifier,approval_id,accepted):
        self._trusted();return {'job':self._computer_factory().approve_file_action(identifier,approval_id,accepted)}
    def open_terminal_evidence(self,identifier,kind):
        self._trusted()
        from services.terminal.artifacts import artifact_path
        from services.computer.runtime import ROOT
        from uuid import UUID
        if not isinstance(identifier,str) or str(UUID(identifier))!=identifier:raise ValueError('Tarea invÃ¡lida.')
        job=self._computer_factory().jobs.get(identifier)
        if not job or job['kind']!='terminal' or job['state'] not in {'succeeded','awaiting_user'}:raise ValueError('La evidencia de terminal todavÃ­a no estÃ¡ disponible.')
        path=artifact_path(job.get('result') or {},kind,DATA_ROOT/'.local/terminal')
        if os.name=='nt':os.startfile(str(path))
        else:
            import subprocess,sys
            subprocess.Popen(['/usr/bin/open' if sys.platform=='darwin' else 'xdg-open',str(path)])
        return {'ok':True,'opened':True}

    def continue_office_installation(self,identifier):
        self._trusted()
        from services.terminal.office import OfficeInstaller
        from services.terminal.executor import TerminalExecutor
        from services.computer.runtime import ROOT
        result=OfficeInstaller(TerminalExecutor(DATA_ROOT/'.local/terminal')).request_elevation(identifier)
        return {'ok':True,**result}
    def stop_assistant_tasks(self):self._trusted();return self._computer_factory().disarm()
    def cancel_assistant_job(self,identifier):self._trusted();return self._computer_factory().cancel(identifier)
    def continue_assistant_job(self,identifier):self._trusted();return self._computer_factory().continue_assistant_job(identifier)
    def cancel_assistant_event(self,identifier):self._trusted();return self._computer_factory().events.cancel(identifier)

    def choose_computer_folder(self):
        self._trusted()
        selected=self._choose(self._folder_dialog)
        return {'ok':True,'cancelled':True} if selected is None else {'ok':True,**self._computer_factory().grant_folder(selected)}

    def forget_computer_folder(self, directory):
        self._trusted()
        return {'ok':True,**self._computer_factory().revoke_folder(directory)}

    def computer_folder_settings(self):
        self._trusted()
        return self._computer_factory().folder_settings()

    def choose_edits_media(self):
        self._trusted()
        import webview
        files=self._window.create_file_dialog(webview.FileDialog.OPEN,allow_multiple=True,
            file_types=('Videos y proyectos (*.mp4;*.mov;*.mkv;*.webm;*.m4v;*.avi;*.mpg;*.mpeg;*.cognira-edits)','Medios (*.wav;*.mp3;*.m4a;*.flac;*.ogg;*.png;*.jpg;*.jpeg)'))
        return {'ok':True,'cancelled':True} if not files else {'ok':True,**self._computer_factory().select_edits_inputs(files)}

    def clear_selected_media(self):
        self._trusted();self._computer_factory().edits_inputs=[]
        return {'ok':True,'selected':[]}

    def open_media_result(self,identifier,kind):
        self._trusted()
        from uuid import UUID
        from services.terminal.policy import scoped
        if not isinstance(identifier,str) or str(UUID(identifier))!=identifier or kind not in {'file','folder'}:raise ValueError('Resultado invÃ¡lido.')
        job=self._computer_factory().jobs.get(identifier)
        result=job.get('result') if job else None
        if not job or job['kind']!='media' or job['state']!='succeeded' or not result or not result.get('verified') or not result.get('path'):raise ValueError('El medio todavÃ­a no estÃ¡ disponible.')
        path=Path(result['path']).absolute()
        scoped(path,[path.parent],existing=True)
        if not path.is_file() or path.suffix.lower() not in {'.wav','.mp3','.m4a','.mkv'}:raise ValueError('El archivo no es un resultado de medios admitido.')
        target=path if kind=='file' else path.parent
        if os.name=='nt':os.startfile(str(target))
        else:
            import subprocess,sys
            subprocess.Popen(['/usr/bin/open' if sys.platform=='darwin' else 'xdg-open',str(target)])
        return {'ok':True,'opened':True}

    def assistant_result_preview(self,identifier,index=None):
        self._trusted()
        return self._computer_factory().results.describe(identifier,index)

    def assistant_image_reference(self,identifier,index=0):
        self._trusted()
        from services.orchestration.image_studio import ImageStudio
        return ImageStudio(self._computer_factory()).reference(identifier,index)

    def assistant_image_edit(self,identifier,index,operation,data=None):
        self._trusted()
        from services.orchestration.image_studio import ImageStudio
        computer=self._computer_factory()
        if not computer.grant or not computer.authorized(computer.grant):computer.arm()
        return ImageStudio(computer).start(identifier,index,operation,data,computer.grant)

    def reveal_assistant_result(self,identifier,index=None):
        self._trusted()
        from uuid import UUID
        from services.orchestration.team import artifact
        if not isinstance(identifier,str) or str(UUID(identifier))!=identifier:raise ValueError('Resultado no válido.')
        computer=self._computer_factory();job=computer.jobs.get(identifier)
        if not job or job['state'] not in {'succeeded','awaiting_user'}:raise ValueError('El resultado todavía no está disponible.')
        if job['kind']=='motion':return self.open_motion_result(identifier,'reveal')
        delivered=computer.creations.export(identifier,index)
        target=delivered[0] if delivered else artifact((job.get('result') or {}).get('path',''),computer.workspace,128*1024**2)
        from .reveal_file import reveal_file
        return reveal_file(target)

    def open_motion_result(self,identifier,kind):
        self._trusted()
        from uuid import UUID
        from services.terminal.policy import scoped
        if not isinstance(identifier,str) or str(UUID(identifier))!=identifier or kind not in {'video','image','file','project','folder','reveal'}:raise ValueError('AnimaciÃ³n invÃ¡lida.')
        computer=self._computer_factory();job=computer.jobs.get(identifier)
        if not job or job['kind']!='motion' or job['state'] not in {'succeeded','awaiting_user'} or not (job.get('result') or {}).get('verified'):raise ValueError('El video todavÃ­a no estÃ¡ disponible.')
        folder=scoped(computer.workspace/'motion'/identifier,[computer.workspace],existing=True)
        from services.orchestration.motion_result import motion_artifact
        target=folder if kind=='folder' else motion_artifact(computer.workspace,identifier,job['result']) if kind in {'video','image','file','reveal'} else scoped(folder/'exports/Brivany-animation.html',[folder],existing=True)
        if kind=='reveal' and os.name=='nt':
            from .reveal_file import reveal_file
            return reveal_file(computer.creations.export(identifier)[0])
        if os.name=='nt':os.startfile(str(target))
        else:
            import subprocess,sys
            subprocess.Popen(['/usr/bin/open' if sys.platform=='darwin' else 'xdg-open',str(target)])
        return {'ok':True,'opened':True}

    def check_driver_installation(self,identifier):
        self._trusted()
        from uuid import UUID
        from services.support.drivers import DriverService
        if not isinstance(identifier,str) or str(UUID(identifier))!=identifier:raise ValueError('Tarea invÃ¡lida.')
        computer=self._computer_factory();job=computer.jobs.get(identifier)
        if not job or job['kind']!='support' or not (job.get('result') or {}).get('driver_proposal_id'):raise ValueError('La tarea no corresponde a una instalaciÃ³n de controlador.')
        drivers=DriverService(computer.workspace/'support/drivers')
        try:result=drivers.result(job['result']['driver_proposal_id'])
        finally:drivers.executor.close()
        if not result['pending']:
            job['result'].update(result,requires_user=not result['installed_verified'])
            job.update(state='succeeded' if result['installed_verified'] else 'awaiting_user',phase=result['message']);computer.save_receipt(job)
        return {'ok':True,**result}

    def open_edits(self):
        self._trusted()
        client=self._computer_factory().edits_factory();client.start()
        return {'ok':True,'connected':True,'tools':len(client.tools())}


def launch(*,island_preview=False):
    from .single_instance import DesktopInstance
    with DesktopInstance() as instance:
        if not instance.primary:
            if not instance.activate(workspace=island_preview):raise RuntimeError('Brivany ya estÃ¡ abierto, pero no respondiÃ³ a la activaciÃ³n.')
            return
        return _launch(island_preview=island_preview,instance=instance)


def _launch(*,island_preview=False,instance):
    status = dependency_status()
    if not status["pywebview_available"]:
        raise RuntimeError("Instala requirements-desktop.txt para abrir la ventana nativa.")
    if sys.platform == "win32" and not status.get("edgechromium_available"):
        raise RuntimeError("Faltan .NET o Edge WebView2; no se usarÃ¡ MSHTML.")
    import webview
    import os
    if sys.platform=='win32':
        from .tray import set_app_identity
        set_app_identity()
        flags=os.environ.get('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','')
        if '--autoplay-policy=' not in flags:os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']=flags+' --autoplay-policy=no-user-gesture-required'
    webview.settings["ALLOW_FILE_URLS"] = False
    # Export buttons generate local ZIP, SVG and JSON downloads. The native
    # host handles the destination dialog after the user's export action.
    webview.settings["ALLOW_DOWNLOADS"] = True
    webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False
    with LocalDesktopServer(handler=experience_handler(Handler), live=True) as server:
        from .ui_session import DesktopUISession
        ui_session=DesktopUISession({path for path,(_,mime) in STATIC.items() if mime.startswith('text/html')}|set(MODULE_ROUTES)|NATIVE_PAGES)
        server.http.desktop_ui_session=ui_session
        server.http.computer_lock=threading.RLock()
        server.http.computer_native=True
        session = server.session
        def source():
            spatial = getattr(server.http, 'spatial', None)
            return SpatialProjectSource(spatial.root if spatial is not None else DATA_ROOT / '.local' / 'spatial')
        bridge = ExperienceBridge(server.base_url, session, source,
                                  folder_dialog=webview.FileDialog.FOLDER,
                                  save_dialog=webview.FileDialog.SAVE)
        bridge._desktop_ui_session=ui_session
        def computer_factory():
            from services.computer.service import ComputerService
            with server.http.computer_lock:
                if not hasattr(server.http,'computer'):
                    # Use the same lazily constructed spatial service as HTTP.
                    def spatial_source():
                        from services.spatial.jobs import SpatialService
                        from services.h1.server import SPATIAL_SERVICE_LOCK
                        with SPATIAL_SERVICE_LOCK:
                            if not hasattr(server.http,'spatial'):server.http.spatial=SpatialService(DATA_ROOT/'.local/spatial')
                            return server.http.spatial
                    from services.connections import service as connections_service
                    from types import SimpleNamespace
                    def human_source():
                        from services.h1.human_skills import HumanSkillService
                        from services.h1.server import HUMAN_SERVICE_LOCK
                        with HUMAN_SERVICE_LOCK:
                            if not hasattr(server.http,'human_skills'):server.http.human_skills=HumanSkillService(DATA_ROOT/'.local/human-skills')
                            return server.http.human_skills
                    def sous_source():
                        from services.sous import SousService
                        from services.h1.server import HUMAN_SERVICE_LOCK
                        with HUMAN_SERVICE_LOCK:
                            if not hasattr(server.http,'sous'):server.http.sous=SousService(DATA_ROOT/'.local/sous')
                            return server.http.sous
                    server.http.computer=ComputerService(server.base_url,spatial_source,native=True,
                        connections_factory=lambda:connections_service(SimpleNamespace(server=server.http)),human_factory=human_source,sous_factory=sous_source)
                    server.http.computer.activity_callback=bridge._publish_computer_activity
                    server.http.computer.completion_callback=lambda value:getattr(bridge,'_tray_host',None) and bridge._tray_host.notify_completion(value)
                if getattr(server.http,'brivany_account',None):server.http.computer.remote_account=server.http.brivany_account
                return server.http.computer
        bridge._computer_factory=computer_factory
        def account_factory():
            from services.vetsa_account import VetsaAccount
            with server.http.computer_lock:
                if not hasattr(server.http,'brivany_account'):
                    from .account_window import open_account_window
                    server.http.brivany_account=VetsaAccount(DATA_ROOT/'.local/vetsa-account',open_window=open_account_window)
                return server.http.brivany_account
        bridge._account_factory=account_factory
        account=account_factory()
        original_computer_factory=bridge._computer_factory
        def account_computer_factory():
            computer=original_computer_factory();computer.remote_account=account;return computer
        bridge._computer_factory=account_computer_factory
        account.computer_factory=account_computer_factory
        from services.whatsapp_desktop import WhatsAppDesktop
        remote_desktop=WhatsAppDesktop(DATA_ROOT/'.local/whatsapp-desktop',account_computer_factory,account)
        bridge._whatsapp_desktop=remote_desktop;server.http.whatsapp_desktop=remote_desktop
        def work_factory():
            from services.work.session import WorkSession
            with server.http.computer_lock:
                if not hasattr(server.http,'work'):server.http.work=WorkSession(DATA_ROOT/'.local/work')
                return server.http.work
        bridge._work_factory=work_factory
        from services.work.live_translation import WorkLiveTranslation
        from services.work.selected_video import SelectedVideoHub,SelectedVideoCoordinator
        from services.work.system_translation_audio import SystemAudioRoute
        import services.work.selected_video as selected_video_module
        selected_video_module.EVENT_LOG=DATA_ROOT/'.local/translation/timeline-events.jsonl'
        video_hub=SelectedVideoHub(preferences=lambda:bridge._translation_preferences().status());bridge._selected_video_hub=video_hub
        from .workspace_preferences import WorkspacePreferences
        from services.work.music_presence import YouTubeMusicPresence
        if not getattr(server.http,'workspace_preferences',None):server.http.workspace_preferences=WorkspacePreferences(DATA_ROOT/'.local/workspace/preferences.json')
        bridge._youtube_music_presence=YouTubeMusicPresence(enabled=lambda:server.http.workspace_preferences.snapshot()['music']['expansion'])
        from packages.providers.river_translation import RiverBridge
        def voice_agent_options():
            settings=getattr(bridge,'_translation_voice_settings',{})
            if not settings.get('enabled'):return {}
            from services.work.voice_agents import TranslationVoiceAgents
            language=settings['language']
            return {'voice_agents_factory':lambda:TranslationVoiceAgents(language=language,authorized=True)}
        def workspace_translation_factory():
            # Direct capture transcribes with Cartesia Ink-2 (Cartesia + Meta
            # only). BRIVANY_DIRECT_ASR=muse restores the previous Muse path.
            import os
            from packages.providers.river_translation import river_status
            # Deepgram (Flux for English sources) when configured; Ink-2 otherwise.
            # BRIVANY_DIRECT_ASR=ink|muse|deepgram overrides.
            chosen=os.environ.get('BRIVANY_DIRECT_ASR','').strip().lower()
            direct_asr=chosen if chosen in ('muse','ink','deepgram') else 'deepgram' if os.environ.get('BRIVANY_DEEPGRAM_API_KEY','').strip() else 'ink'
            # Groq (Qwen) translates when its key exists: ~0.2 s versus 0.9-2 s
            # for Meta in the 2026-11-11 measurement. BRIVANY_DIRECT_MT=meta reverts.
            from packages.providers.meta_translation import groq_configuration
            direct_mt='meta' if os.environ.get('BRIVANY_DIRECT_MT','').strip().lower()=='meta' or not groq_configuration()[2] else 'groq'
            def build(http_port,**options):
                selected=getattr(translation.route,'video',None)
                # Cloning agents are owned by WorkLiveTranslation (below), so
                # they survive reconnects and can start mid-session.
                instance=RiverBridge(http_port,**options,caption_source=selected.lookahead if selected else None,asr_provider=direct_asr,translation_provider=direct_mt)
                shared=getattr(server.http,'river_bridge',None)
                if shared:instance.lock=shared.lock
                return instance
            def clone_agents(language):
                from services.work.voice_agents import TranslationVoiceAgents
                return TranslationVoiceAgents(language=language,authorized=True)
            def audio_route():
                # A silent (timeline-only) YouTube tab supplies captions and a
                # clock; Directa keeps capturing the system audio.
                selected=video_hub.selected()
                return video_hub.route() if selected and not getattr(selected,'timeline_only',False) else SystemAudioRoute()
            def timeline():
                selected=video_hub.selected()
                return selected.timeline() if selected and getattr(selected,'timeline_only',False) else None
            def caption_translator():
                from packages.providers.river_translation import MetaStream
                return MetaStream(inline_video=True,provider=direct_mt)
            def caption_synthesizer():
                from packages.providers.caption_dubbing import CartesiaSynthesizer
                return CartesiaSynthesizer()
            translation=WorkLiveTranslation(bridge_factory=build,route_factory=audio_route,timeline_source=timeline,
                caption_translator_factory=caption_translator,synthesizer_factory=caption_synthesizer,
                voice_agents_factory=clone_agents,cloning_settings=lambda:dict(getattr(bridge,'_translation_voice_settings',{})),
                configuration=lambda:river_status(asr=direct_asr,mt=direct_mt))
            return translation
        bridge._work_translation_factory=workspace_translation_factory
        def publish_selected_translation(value):
            bridge._auditory_mode='direct';bridge._publish_audio_translation(value)
        video_coordinator=SelectedVideoCoordinator(bridge._audio_translation,publish=publish_selected_translation)
        video_hub.on_translate=video_coordinator.request;video_hub.on_closed=video_coordinator.stop;video_hub.on_pause=video_coordinator.pause
        def sync_translation_factory():
            from services.work.sync_relay import SyncRelay
            from services.work.extension_identity import BRIVANY_EXTENSION_ORIGIN,BRIVANY_EXTENSION_PORT
            from packages.providers.meta_prosody import MetaProsodySession,refresh_audio_catalog,verified_audio_models
            from packages.providers.prefix_translation import prepare_prefix
            import threading
            catalog=DATA_ROOT/'.local/translation/meta-audio-access.json'
            # Keep the small extension listener available at startup. Local
            # audio models initialize on their first real classification,
            # through the existing lazy factories in prefix/River translation.
            # Availability is refreshed outside capture/MT/TTS. A stale or
            # rejected model keeps the optional advisory neutral for this cue.
            def prosody_factory():
                return MetaProsodySession(verified_models=verified_audio_models(catalog))
            shared=getattr(server.http,'river_bridge',None)
            def build():
                threading.Thread(target=refresh_audio_catalog,args=(catalog,),daemon=True,name='brivany-meta-catalog-refresh').start()
                import os
                from packages.providers.meta_translation import groq_configuration
                inline_mt='meta' if os.environ.get('BRIVANY_DIRECT_MT','').strip().lower()=='meta' or not groq_configuration()[2] else 'groq'
                return RiverBridge(0,allow_synchronized=True,prosody_factory=prosody_factory,translation_provider=inline_mt,**voice_agent_options())
            def prefix_translator():
                # Opening translated ahead into es+en with Groq (or Meta if
                # Groq is not configured / BRIVANY_DIRECT_MT=meta).
                import os
                from packages.providers.meta_translation import groq_configuration
                from packages.providers.river_translation import MetaStream
                provider='meta' if os.environ.get('BRIVANY_DIRECT_MT','').strip().lower()=='meta' or not groq_configuration()[2] else 'groq'
                return lambda:MetaStream(inline_video=True,provider=provider)
            def inline_settings():
                owner=bridge._audio_translation()
                return {'target':owner.target,'voice':owner.voice}
            relay=SyncRelay(port=BRIVANY_EXTENSION_PORT,automatic_origin=BRIVANY_EXTENSION_ORIGIN,video_hub=video_hub,shared_lock=shared.lock if shared else None,bridge_factory=build,inline_settings=inline_settings,
                prefix_factory=lambda raw,*,cancelled:prepare_prefix(raw,cancelled=cancelled,prosody_factory=prosody_factory,translator_factory=prefix_translator()))
            relay.music_presence=bridge._youtube_music_presence
            return relay
        bridge._sync_translation_factory=sync_translation_factory
        def spotify_factory():
            from services.spotify import SpotifyService
            with server.http.computer_lock:
                if not hasattr(server.http,'spotify'):server.http.spotify=SpotifyService(DATA_ROOT/'.local/spotify')
                return server.http.spotify
        bridge._spotify_factory=spotify_factory
        bridge._island_preview=island_preview
        screens = getattr(webview, "screens", [])
        screen = screens[0] if screens else None
        width = min(1120, int(screen.width * 0.90)) if screen else 1120
        height = min(760, int(screen.height * 0.86)) if screen else 760
        minimum = (min(640, width), min(480, height))
        window = webview.create_window("Brivany", bridge._desktop_url('/brivany-shell'),
                                       js_api=bridge, width=width, height=height, screen=screen,
                                       min_size=minimum, frameless=True, easy_drag=False, shadow=True,
                                       background_color="#f3f5f5", confirm_close=False)
        bridge._bind_window(window)
        if sys.platform=='win32':
            from .window_bounds import install as install_window_bounds
            window.events.loaded+=lambda:install_window_bounds(window)
        ui_session.bind_window(window,server.base_url)
        from .startup_recovery import StartupRecovery
        startup_recovery=StartupRecovery(window,server.base_url)
        window.events.loaded+=startup_recovery.start
        window.events.closed+=startup_recovery.close
        from .tray import SystemTray
        from .music_ducking import MusicDucking
        def apply_music_duck(active):
            host=getattr(bridge,'_spotify_player_host',None)
            if host:host.set_ducked(active)
        bridge._audio_ducker=MusicDucking(DATA_ROOT/'.local/audio-ducking/settings.json',apply_music_duck,
            should_monitor=lambda:local_music_playing(bridge))
        server.http.music_ducking=bridge._audio_ducker;server.http.desktop_bridge=bridge
        exit_requested=threading.Event()
        exit_lock=threading.Lock()
        def prepare_exit():
            with exit_lock:
                if exit_requested.is_set():return False
                exit_requested.set();bridge._exit_requested=True
            bridge._close_workspace_recording()
            bridge._close_workspace_phone()
            bridge._close_music_expansion()
            bridge._close_phone_control()
            bridge._close_telephone()
            bridge._close_canvas()
            bridge._close_desktop_widgets()
            bridge._close_island_windows()
            bridge._close_work_translation()
            bridge._close_sync_translation()
            bridge._audio_ducker.close()
            tray.close()
            work=getattr(server.http,'work',None)
            if work:work.close()
            bridge._close_spotify_player()
            bridge._close_workspace_files()
            return True
        def exit_application():
            if not exit_requested.is_set() and bridge._request_canvas_exit(exit_application):return
            if not prepare_exit():return
            for owned in list(webview.windows):
                try:owned.destroy()
                except Exception:pass
        def close_from_window():
            if exit_requested.is_set():return None
            # X/Alt+F4 leave the app in the taskbar. Explicit tray/lifecycle
            # exit still runs the complete save and cleanup path above.
            window.minimize()
            return False
        def open_completed_task(value):
            bridge.return_to_chat()
            if value.get('conversation_id'):
                import json
                from .scripts import post_script
                post_script(window,'window.BrivanyConversations?.select('+json.dumps(value['conversation_id'])+').catch(()=>{});','completed-task')
        tray=SystemTray(window,ROOT/'desktop/assets/brivany.ico',on_open=bridge.return_to_chat,on_workspace=bridge.start_work,on_exit=exit_application,on_result=open_completed_task)
        bridge._tray_host=tray
        def management_busy():
            result=[]
            computer=getattr(server.http,'computer',None)
            if computer and any(job.get('state') in {'queued','planning','running','reviewing','awaiting_approval'} for job in list(computer.jobs.values())):result.append('assistant_task')
            canvas=getattr(bridge,'_canvas_window',None)
            if canvas and canvas.dirty:result.append('unsaved_canvas')
            transfer=getattr(bridge,'_workspace_file_transfer',None)
            if transfer:
                value=transfer.snapshot();progress=value.get('progress') or {}
                if value.get('state') in {'sending','receiving'} or progress.get('done',0)<progress.get('size',0):result.append('file_transfer')
            recorder=getattr(bridge,'_workspace_recorder',None)
            if recorder and recorder.snapshot().get('state') in {'recording','starting','stopping','saving'}:result.append('recording')
            active=getattr(bridge,'_telephone_active_route',None)
            if active:
                try:
                    state=bridge._gateway_for_channel(active[1]).request('/v1/calls/'+active[0]).get('state')
                    if state not in {'completed','busy','no-answer','failed','canceled','cancelled','interrupted','not-found'}:result.append('call')
                except Exception:result.append('call_status_unknown')
            return result
        def management_save():
            window.evaluate_js("window.__brivanyRestartSave='saving';(async()=>{try{await document.querySelector('#module-frame')?.contentWindow?.BrivanyChat?.persist?.();await window.BrivanyConversations?.flush?.();window.__brivanyRestartSave='saved'}catch{window.__brivanyRestartSave='failed'}})();true")
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                value=window.evaluate_js('window.__brivanyRestartSave')
                if value in {'saved','failed'}:return value=='saved'
                time.sleep(.1)
            return False
        from .lifecycle import Lifecycle
        def management_update():
            service=getattr(server.http,'updates',None)
            if service and service.status().get('state')=='ready':service.restart();return True
            return False
        launch_command=[str(Path(os.environ['BRIVANY_INSTALL_DIR'])/'Brivany.exe')] if os.environ.get('BRIVANY_INSTALL_DIR') else [sys.executable,'-m','desktop.experience.launcher']
        lifecycle=Lifecycle(server.base_url,LOCAL_ROOT/'runtime',stop=exit_application,save=management_save,launch_command=launch_command,busy=management_busy,workspace=island_preview,prepare_update=management_update)
        server.http.desktop_lifecycle=lifecycle
        window.events.loaded+=lifecycle.ready
        if os.environ.get('BRIVANY_INSTALL_DIR'):
            from desktop.distribution.updater import UpdateService,mark_healthy
            updates=UpdateService();server.http.updates=updates;server.http.update_exit=exit_application
            def on_installed_loaded():
                report=os.environ.get('BRIVANY_SMOKE_REPORT')
                def verify_startup():
                    import json,time
                    from packages.runtime_paths import LOCAL_ROOT
                    data={'version':updates.status()['version'],'loaded':True,'document':{'shell_ready':False}}
                    try:
                        if report and sys.platform=='win32':
                            from .window_bounds import set_maximized,geometry
                            set_maximized(window,True);data['maximized_window']=geometry(window);set_maximized(window,False)
                        deadline=time.monotonic()+14
                        while not exit_requested.is_set() and time.monotonic()<deadline:
                            probe=window.evaluate_js("JSON.stringify((()=>{let frame,doc;try{frame=document.getElementById('module-frame')?.contentWindow;doc=frame?.document}catch{}const composer=doc?.getElementById('chat-composer');return {chat_ready:!!frame?.BrivanyChat,composer_visible:!!composer&&!composer.inert&&composer.getBoundingClientRect().height>0,history_count:window.BrivanyConversations?.list()?.length||0,chat_messages:doc?.querySelectorAll('.chat-message').length||0,players:doc?.querySelectorAll('video.execution-media').length||0,media_loading:doc?.querySelectorAll('.execution-loading').length||0,model_badges:doc?.querySelectorAll('.chat-provider').length||0}})())")
                            data['chat']=json.loads(probe);data['document']={'shell_ready':bool(window.evaluate_js("!!document.getElementById('module-frame')"))};data['boot']=window.evaluate_js("window.BrivanyShellBoot?.snapshot()||null");data['native_recovery']=startup_recovery.snapshot()
                            if data['chat']['chat_ready'] and data['chat']['composer_visible'] and (not report or not data['chat']['media_loading']):break
                            time.sleep(.2)
                        data['healthy']=bool(data.get('chat',{}).get('chat_ready') and data.get('chat',{}).get('composer_visible'))
                        image_test=os.environ.get('BRIVANY_SMOKE_IMAGE_ID') if report else None
                        if data['healthy'] and image_test:
                            from uuid import UUID
                            image_test=str(UUID(image_test));window.evaluate_js('window.BrivanyImageViewer.open('+json.dumps(image_test)+')')
                            image_deadline=time.monotonic()+12
                            while time.monotonic()<image_deadline:
                                data['image_preview']=window.evaluate_js("(()=>{const modal=document.querySelector('.image-workspace'),canvas=modal?.querySelector('canvas'),error=modal?.querySelector('.image-workspace-status')?.dataset.error==='true';return {open:!!modal?.open,decoded:!!modal?.open&&modal.getAttribute('aria-busy')==='false'&&canvas?.width>300&&!error,width:canvas?.width||0,height:canvas?.height||0,error}})()")
                                if data['image_preview']['decoded'] or data['image_preview']['error']:break
                                time.sleep(.15)
                        reveal_test=os.environ.get('BRIVANY_SMOKE_REVEAL_ID') if report else None
                        if data['healthy'] and reveal_test:data['file_reveal']=bridge.reveal_assistant_result(reveal_test)
                        if report:
                            transfer=bridge._file_transfer();configuration=transfer.configuration()
                            data['file_transfer']={key:configuration[key] for key in ('official_https','local_https','origin','configured')}
                            data['file_transfer']['local_listener']=getattr(transfer,'server',None) is not None
                            data['file_transfer'].update(max_file_bytes=configuration.get('max_file_bytes'),bidirectional=configuration.get('bidirectional',False))
                            data['private_restart']={'available':bool(getattr(server.http,'desktop_lifecycle',None)),'ready':lifecycle.status()['ready']}
                            if os.environ.get('BRIVANY_SMOKE_WORKSPACE'):
                                bridge.start_work();workspace_deadline=time.monotonic()+15
                                while time.monotonic()<workspace_deadline:
                                    panel=getattr(bridge,'_work_window',None);bar=getattr(bridge,'_bar_window',None)
                                    data['workspace_drop']={'panel_ready':bool(panel and panel.evaluate_js('!!window.BrivanyWorkspaceDrop')),'bar_owns_peer':bool(bar and bar.evaluate_js('!!window.BrivanyWorkspaceDrop'))}
                                    if data['workspace_drop']['panel_ready']:break
                                    time.sleep(.2)
                                data['healthy']=data['healthy'] and data['workspace_drop']['panel_ready'] and not data['workspace_drop']['bar_owns_peer']
                        if data['healthy']:mark_healthy()
                    except Exception:data['healthy']=False;data['diagnostic_error']=True
                    finally:
                        destination=Path(report) if report else LOCAL_ROOT/'logs/startup-last.json'
                        try:
                            destination.parent.mkdir(parents=True,exist_ok=True);temporary=destination.with_suffix('.tmp');temporary.write_text(json.dumps(data,indent=2),encoding='utf-8');temporary.replace(destination)
                        finally:
                            if report:exit_application()
                threading.Thread(target=verify_startup,name='brivany-startup-check',daemon=True).start()
            window.events.loaded+=on_installed_loaded
            def auto_updates():
                if exit_requested.wait(25):return
                while not exit_requested.is_set():
                    if updates.status()['state']!='ready':
                        if updates.check()['state']=='available':updates.stage()
                    if exit_requested.wait(6*3600):return
            threading.Thread(target=auto_updates,name='brivany-auto-updates',daemon=True).start()
        server.http.desktop_tray=tray
        window.events.loaded+=tray.start
        window.events.loaded+=account.start
        window.events.loaded+=remote_desktop.start
        window.events.loaded+=lambda:bridge._telephone_gateway()
        # NativeRuntime.start() already creates the Electron backend at the
        # first explicit native action. Do not retain another browser process
        # merely because the user opened Brivany.
        def prepare_browser_translation():
            def prepare():
                try:bridge._sync_translation()
                except OSError:bridge._sync_translation_start_error='El puerto de traducciÃ³n del navegador estÃ¡ ocupado.'
            threading.Thread(target=prepare,daemon=True,name='brivany-browser-ready').start()
        window.events.loaded+=prepare_browser_translation
        window.events.loaded+=lambda:bridge._configure_music_expansion(server.http.workspace_preferences.snapshot()['music']['expansion'])
        window.events.loaded+=lambda:instance.listen(lambda workspace:bridge.start_work() if workspace else bridge.return_to_chat())
        window.events.closing+=close_from_window
        if island_preview:
            def show_island():
                if not getattr(bridge,'_work_window',None):bridge.start_work()
            window.events.loaded+=show_island
        gui = {"win32": "edgechromium", "darwin": "cocoa", "linux": "gtk"}.get(sys.platform)
        try:
            webview.start(gui=gui, debug=False, private_mode=True, http_server=False,icon=str(ROOT/'desktop/assets/brivany.ico'))
        finally:
            lifecycle.close()
            remote_desktop.close()
            account.close()
            bridge._close_desktop_widgets()
            bridge._close_canvas()
            bridge._close_workspace_recording()
            bridge._close_workspace_phone()
            bridge._close_music_expansion()
            bridge._close_phone_control()
            bridge._close_telephone()
            bridge._close_work_translation()
            bridge._close_sync_translation()
            bridge._audio_ducker.close()
            tray.close()
            work=getattr(server.http,'work',None)
            if work:work.close()
            bridge._close_island_windows()
            spotify=getattr(server.http,'spotify',None)
            bridge._close_spotify_player()
            bridge._close_workspace_files()
            if spotify:spotify.close()
            computer=getattr(server.http,'computer',None)
            if computer:computer.close()


def main(argv=None):
    parser=argparse.ArgumentParser(description="Abrir la experiencia de Brivany en una ventana nativa")
    parser.add_argument('--island',action='store_true',help='Iniciar Melodi WorkSpace con la barra y los paneles cerrados.')
    args=parser.parse_args(argv)
    try:
        launch(island_preview=args.island)
        return 0
    except (OSError, RuntimeError, ImportError) as exc:
        print(f"No se pudo iniciar la ventana nativa de Brivany: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
