"""Launch the Brivany experience shell in a native cross-platform window."""
import argparse
import os
from pathlib import Path
import sys
import threading
from urllib.parse import urlsplit

from desktop.bridge import DesktopBridge, DesktopError
from desktop.launcher import LocalDesktopServer, dependency_status
from services.h1.server import Handler, STATIC
from services.projects import SpatialProjectSource
from desktop.experience.work import WorkBridge
from desktop.experience.music import MusicBridge
from desktop.experience.account import AccountBridge

ROOT = Path(__file__).resolve().parents[2]
EXPERIENCE = Path(__file__).resolve().parent
NATIVE_PAGES={'/brivany-shell','/work-widget','/work-capture','/work-voice','/spotify-player'}
ASSETS = {"shell.css": (EXPERIENCE / "shell.css", "text/css; charset=utf-8"),
          "windowbar.css": (EXPERIENCE / "windowbar.css", "text/css; charset=utf-8"),
          "shell.js": (EXPERIENCE / "shell.js", "text/javascript; charset=utf-8")}
for name in ('volume-ducking.js','workspace-tools.css','icons.js','module.css', 'module.js', 'services.js', 'computer.js', 'computer.css','references.js','references.css','agents.js','minimal.css','chat.js','chat.css','preferences.js','settings.js','settings.css','work.js','work.css','island.js','island.css','workspace-music.css','character.css','music-motion.js','spotify-player.js','spotify-connections.js','spotify-connections.css'):
    ASSETS[name] = (EXPERIENCE / name, 'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('file-approvals.js','file-approvals.css'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('account.js','account.css','workspace-agents.js','workspace-agents.css','workspace-results.js','workspace-results.css','glisse.css'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('workspace-companion.js','workspace-companion.css','workspace-translation.js','workspace-translation.css','research-citations.js'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
for name in ('sync-connections.js','sync-connections.css'):
    ASSETS[name]=(EXPERIENCE/name,'text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')
MODULE_ROUTES = {'/', '/app', '/app/', '/spaces', '/spaces/', '/viewer', '/human-skills',
                 '/human-skills/', '/practice', '/dubbing', '/dubbing/', '/translate', '/translate/',
                 '/connections', '/activity', '/activity/', '/sous', '/desktop-services','/computer','/settings'}


def experience_handler(base_handler):
    class ExperienceHandler(base_handler):
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
            if route in {'/work-widget','/work-capture','/work-voice'}:
                if not self.local_request():return
                self.send_bytes(200,(EXPERIENCE/('work-widget.html' if route=='/work-widget' else 'work-voice.html' if route=='/work-voice' else 'work-capture.html')).read_bytes(),'text/html; charset=utf-8');return
            if route.startswith('/api/computer/'):
                from services.computer.http import get
                get(self);return
            if route == '/api/desktop/services':
                if not self.local_request(): return
                from packages.providers.live_voice import voice_status
                from packages.providers.meta import provider_status
                from packages.providers.river_translation import river_status
                voice, meta, translation = voice_status(), provider_status(), river_status()
                self.send_json(200, {'local': True, 'remote_access_verified': False, 'services': [
                    {'name': 'Conversación Meta', 'configured': bool(meta.get('configured')), 'route': '/app'},
                    {'name': 'Escucha Muse live', 'configured': bool(voice.get('asr', {}).get('configured')), 'route': '/app'},
                    {'name': 'Voz Melodi · Cartesia', 'configured': bool(voice.get('tts', {}).get('configured')), 'route': '/app'},
                    {'name': 'Traducción · Muse / Meta / Cartesia', 'configured': bool(translation.get('configured')), 'route': '/dubbing'},
                ]})
                return
            if route in MODULE_ROUTES:
                if not self.local_request(): return
                if route in {'/app','/app/','/settings','/desktop-services','/computer'}:
                    name={'/app':'chat.html','/app/':'chat.html','/settings':'settings.html','/desktop-services':'services.html','/computer':'computer.html'}[route]
                    page = (EXPERIENCE / name).read_text(encoding='utf-8')
                else:
                    page = (ROOT / 'web' / STATIC[route][0]).read_text(encoding='utf-8')
                if route=='/connections':page=page.replace('</head>','<link rel="stylesheet" href="/desktop-shell/spotify-connections.css"><script src="/desktop-shell/spotify-connections.js" defer></script><link rel="stylesheet" href="/desktop-shell/sync-connections.css"><script src="/desktop-shell/sync-connections.js" defer></script></head>')
                if route=='/settings':page=page.replace('</head>','<link rel="stylesheet" href="/desktop-shell/account.css"><script src="/desktop-shell/account.js" defer></script></head>')
                framing='' if route in {'/app','/app/','/settings'} else '<link rel="stylesheet" href="/desktop-shell/module.css">'
                page = page.replace('</head>', framing+'<script src="/desktop-shell/icons.js"></script><script src="/desktop-shell/module.js"></script><link rel="stylesheet" href="/desktop-shell/computer.css"><link rel="stylesheet" href="/desktop-shell/references.css"><script src="/desktop-shell/computer.js" defer></script><script src="/desktop-shell/references.js" defer></script></head>')
                self.send_bytes(200, page.encode('utf-8'), 'text/html; charset=utf-8')
                return
            if route == "/brivany-shell":
                if not self.local_request(): return
                self.send_bytes(200, (EXPERIENCE / "index.html").read_bytes(), "text/html; charset=utf-8")
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


class ExperienceBridge(AccountBridge,MusicBridge,WorkBridge,DesktopBridge):
    """Keep existing native project actions scoped to this local shell origin."""
    def _trusted(self):
        if self._window is None:
            raise DesktopError("desktop_window", "La ventana todavía no está preparada.", 403)
        value = self._window.get_current_url()
        parsed = urlsplit(value or "")
        base = urlsplit(self._base)
        if ((parsed.scheme, parsed.hostname, parsed.port) != (base.scheme, base.hostname, base.port)
                or parsed.path not in {"/brivany-shell", "/spaces", "/spaces/", "/viewer"}
                or parsed.username or parsed.password):
            raise DesktopError("desktop_origin", "El puente nativo sólo está disponible en la ventana local de Brivany.", 403)

    def minimize_window(self):
        self._trusted()
        return self.start_work()

    def set_window_maximized(self, maximized):
        self._trusted()
        if type(maximized) is not bool:
            raise DesktopError("desktop_window_state", "Estado de ventana inválido.", 422)
        if maximized:
            self._window.maximize()
        else:
            self._window.restore()
        return {"ok": True, "maximized": maximized}

    def close_window(self):
        self._trusted()
        if hasattr(self,'_work_factory') and self._work().active:
            self._window.hide()
            if getattr(self,'_work_window',None):self._show_island()
            return {'ok':True,'background':True}
        self._close_spotify_player()
        self._window.destroy()
        return {"ok": True}

    def authorize_computer(self):
        self._trusted()
        current=self._computer_factory()
        return {'ok':True,**({'token':current.grant,**current.status()} if current.authorized(current.grant) else current.arm())}

    def assistant_status(self):self._trusted();return self._computer_factory().status()
    def configure_computer_access(self,mode):
        self._trusted();return self._computer_factory().configure_access(mode)
    def approve_file_action(self,identifier,approval_id,accepted):
        self._trusted();return {'job':self._computer_factory().approve_file_action(identifier,approval_id,accepted)}
    def open_terminal_evidence(self,identifier,kind):
        self._trusted()
        from services.terminal.artifacts import artifact_path
        from services.computer.runtime import ROOT
        from uuid import UUID
        if not isinstance(identifier,str) or str(UUID(identifier))!=identifier:raise ValueError('Tarea inválida.')
        job=self._computer_factory().jobs.get(identifier)
        if not job or job['kind']!='terminal' or job['state'] not in {'succeeded','awaiting_user'}:raise ValueError('La evidencia de terminal todavía no está disponible.')
        path=artifact_path(job.get('result') or {},kind,ROOT/'.local/terminal')
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
        result=OfficeInstaller(TerminalExecutor(ROOT/'.local/terminal')).request_elevation(identifier)
        return {'ok':True,**result}
    def stop_assistant_tasks(self):self._trusted();return self._computer_factory().disarm()
    def cancel_assistant_job(self,identifier):self._trusted();return self._computer_factory().cancel(identifier)
    def continue_assistant_job(self,identifier):self._trusted();return self._computer_factory().continue_assistant_job(identifier)
    def cancel_assistant_event(self,identifier):self._trusted();return self._computer_factory().events.cancel(identifier)

    def choose_computer_folder(self):
        self._trusted()
        selected=self._choose(self._folder_dialog)
        return {'ok':True,'cancelled':True} if selected is None else {'ok':True,**self._computer_factory().grant_folder(selected)}

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
        if not isinstance(identifier,str) or str(UUID(identifier))!=identifier or kind not in {'file','folder'}:raise ValueError('Resultado inválido.')
        job=self._computer_factory().jobs.get(identifier)
        result=job.get('result') if job else None
        if not job or job['kind']!='media' or job['state']!='succeeded' or not result or not result.get('verified') or not result.get('path'):raise ValueError('El medio todavía no está disponible.')
        path=Path(result['path']).absolute()
        scoped(path,[path.parent],existing=True)
        if not path.is_file() or path.suffix.lower() not in {'.wav','.mp3','.m4a','.mkv'}:raise ValueError('El archivo no es un resultado de medios admitido.')
        target=path if kind=='file' else path.parent
        if os.name=='nt':os.startfile(str(target))
        else:
            import subprocess,sys
            subprocess.Popen(['/usr/bin/open' if sys.platform=='darwin' else 'xdg-open',str(target)])
        return {'ok':True,'opened':True}

    def open_motion_result(self,identifier,kind):
        self._trusted()
        from uuid import UUID
        from services.terminal.policy import scoped
        if not isinstance(identifier,str) or str(UUID(identifier))!=identifier or kind not in {'video','project','folder'}:raise ValueError('Animación inválida.')
        computer=self._computer_factory();job=computer.jobs.get(identifier)
        if not job or job['kind']!='motion' or job['state'] not in {'succeeded','awaiting_user'} or not (job.get('result') or {}).get('verified'):raise ValueError('El video todavía no está disponible.')
        folder=scoped(computer.workspace/'motion'/identifier,[computer.workspace],existing=True)
        target=folder if kind=='folder' else scoped(folder/('Brivany.mp4' if kind=='video' else 'exports/Brivany-animation.html'),[folder],existing=True)
        if os.name=='nt':os.startfile(str(target))
        else:
            import subprocess,sys
            subprocess.Popen(['/usr/bin/open' if sys.platform=='darwin' else 'xdg-open',str(target)])
        return {'ok':True,'opened':True}

    def check_driver_installation(self,identifier):
        self._trusted()
        from uuid import UUID
        from services.support.drivers import DriverService
        if not isinstance(identifier,str) or str(UUID(identifier))!=identifier:raise ValueError('Tarea inválida.')
        computer=self._computer_factory();job=computer.jobs.get(identifier)
        if not job or job['kind']!='support' or not (job.get('result') or {}).get('driver_proposal_id'):raise ValueError('La tarea no corresponde a una instalación de controlador.')
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
            if not instance.activate(workspace=island_preview):raise RuntimeError('Brivany ya está abierto, pero no respondió a la activación.')
            return
        return _launch(island_preview=island_preview,instance=instance)


def _launch(*,island_preview=False,instance):
    status = dependency_status()
    if not status["pywebview_available"]:
        raise RuntimeError("Instala requirements-desktop.txt para abrir la ventana nativa.")
    if sys.platform == "win32" and not status.get("edgechromium_available"):
        raise RuntimeError("Faltan .NET o Edge WebView2; no se usará MSHTML.")
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
            return SpatialProjectSource(spatial.root if spatial is not None else ROOT / '.local' / 'spatial')
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
                            if not hasattr(server.http,'spatial'):server.http.spatial=SpatialService(ROOT/'.local/spatial')
                            return server.http.spatial
                    from services.connections import service as connections_service
                    from types import SimpleNamespace
                    def human_source():
                        from services.h1.human_skills import HumanSkillService
                        from services.h1.server import HUMAN_SERVICE_LOCK
                        with HUMAN_SERVICE_LOCK:
                            if not hasattr(server.http,'human_skills'):server.http.human_skills=HumanSkillService(ROOT/'.local/human-skills')
                            return server.http.human_skills
                    def sous_source():
                        from services.sous import SousService
                        from services.h1.server import HUMAN_SERVICE_LOCK
                        with HUMAN_SERVICE_LOCK:
                            if not hasattr(server.http,'sous'):server.http.sous=SousService(ROOT/'.local/sous')
                            return server.http.sous
                    server.http.computer=ComputerService(server.base_url,spatial_source,native=True,
                        connections_factory=lambda:connections_service(SimpleNamespace(server=server.http)),human_factory=human_source,sous_factory=sous_source)
                    server.http.computer.activity_callback=bridge._publish_computer_activity
                return server.http.computer
        bridge._computer_factory=computer_factory
        def account_factory():
            from services.brivany_account import DesktopAccount
            with server.http.computer_lock:
                if not hasattr(server.http,'brivany_account'):
                    server.http.brivany_account=DesktopAccount(ROOT/'.local/account',computer_factory)
                return server.http.brivany_account
        bridge._account_factory=account_factory
        account=account_factory()
        original_computer_factory=bridge._computer_factory
        def account_computer_factory():
            computer=original_computer_factory();computer.remote_account=account;return computer
        bridge._computer_factory=account_computer_factory
        account.computer_factory=account_computer_factory
        def work_factory():
            from services.work.session import WorkSession
            with server.http.computer_lock:
                if not hasattr(server.http,'work'):server.http.work=WorkSession(ROOT/'.local/work')
                return server.http.work
        bridge._work_factory=work_factory
        from services.work.live_translation import WorkLiveTranslation
        from services.work.selected_video import SelectedVideoHub,SelectedVideoCoordinator
        from services.work.system_translation_audio import SystemAudioRoute
        video_hub=SelectedVideoHub(preferences=lambda:bridge._translation_preferences().status());bridge._selected_video_hub=video_hub
        from packages.providers.river_translation import RiverBridge
        def voice_agent_options():
            settings=getattr(bridge,'_translation_voice_settings',{})
            if not settings.get('enabled'):return {}
            from services.work.voice_agents import TranslationVoiceAgents
            language=settings['language']
            return {'voice_agents_factory':lambda:TranslationVoiceAgents(language=language,authorized=True)}
        def workspace_translation_factory():
            def build(http_port,**options):
                selected=getattr(translation.route,'video',None)
                instance=RiverBridge(http_port,**options,**voice_agent_options(),caption_source=selected.lookahead if selected else None)
                shared=getattr(server.http,'river_bridge',None)
                if shared:instance.lock=shared.lock
                return instance
            translation=WorkLiveTranslation(bridge_factory=build,route_factory=lambda:video_hub.route() if video_hub.selected() else SystemAudioRoute())
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
            from packages.providers.audio_content import SingingFilter
            from packages.providers.prefix_translation import prepare_prefix
            import threading
            catalog=ROOT/'.local/translation/meta-audio-access.json'
            def warm_song_filter():
                try:SingingFilter()
                except (ImportError,OSError,ValueError,RuntimeError):pass # Actual startup reports this error if needed.
                from packages.providers.robust_voice_timbre import warm_timbre
                warm_timbre()
            threading.Thread(target=warm_song_filter,daemon=True,name='brivany-translation-audio-warmup').start()
            # Availability is refreshed outside capture/MT/TTS. A stale or
            # rejected model keeps the optional advisory neutral for this cue.
            def prosody_factory():
                return MetaProsodySession(verified_models=verified_audio_models(catalog))
            shared=getattr(server.http,'river_bridge',None)
            def build():
                threading.Thread(target=refresh_audio_catalog,args=(catalog,),daemon=True,name='brivany-meta-catalog-refresh').start()
                return RiverBridge(0,allow_synchronized=True,prosody_factory=prosody_factory,**voice_agent_options())
            def inline_settings():
                owner=bridge._audio_translation()
                return {'target':owner.target,'voice':owner.voice}
            return SyncRelay(port=BRIVANY_EXTENSION_PORT,automatic_origin=BRIVANY_EXTENSION_ORIGIN,video_hub=video_hub,shared_lock=shared.lock if shared else None,bridge_factory=build,inline_settings=inline_settings,
                prefix_factory=lambda raw,*,cancelled:prepare_prefix(raw,cancelled=cancelled,prosody_factory=prosody_factory))
        bridge._sync_translation_factory=sync_translation_factory
        def spotify_factory():
            from services.spotify import SpotifyService
            with server.http.computer_lock:
                if not hasattr(server.http,'spotify'):server.http.spotify=SpotifyService(ROOT/'.local/spotify')
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
        ui_session.bind_window(window,server.base_url)
        from .tray import SystemTray
        from .music_ducking import MusicDucking
        def apply_music_duck(active):
            host=getattr(bridge,'_spotify_player_host',None)
            if host:host.set_ducked(active)
        bridge._audio_ducker=MusicDucking(ROOT/'.local/audio-ducking/settings.json',apply_music_duck)
        server.http.music_ducking=bridge._audio_ducker;server.http.desktop_bridge=bridge
        window.events.loaded+=bridge._audio_ducker.start
        exit_requested=threading.Event()
        exit_lock=threading.Lock()
        def prepare_exit():
            with exit_lock:
                if exit_requested.is_set():return False
                exit_requested.set();bridge._exit_requested=True
            bridge._close_island_windows()
            bridge._close_work_translation()
            bridge._close_sync_translation()
            bridge._audio_ducker.close()
            tray.close()
            work=getattr(server.http,'work',None)
            if work:work.close()
            bridge._close_spotify_player()
            return True
        def exit_application():
            if not prepare_exit():return
            for owned in list(webview.windows):
                try:owned.destroy()
                except Exception:pass
        def close_from_window():
            if exit_requested.is_set():return None
            # pywebview invokes closing on the native UI thread. Do the cleanup
            # off that thread so WebView disposal can still complete.
            threading.Thread(target=exit_application,name='brivany-exit').start()
            return False
        tray=SystemTray(window,ROOT/'desktop/assets/brivany.ico',on_open=bridge.return_to_chat,on_workspace=bridge.start_work,on_exit=exit_application)
        bridge._tray_host=tray
        server.http.desktop_tray=tray
        window.events.loaded+=tray.start
        window.events.loaded+=account.start
        def warm_desktop():
            def prepare():
                try:
                    runtime=computer_factory().runtime
                    if runtime.availability()['available']:runtime.call('warm_up',timeout=25)
                except Exception:pass # A later explicit action can retry startup.
            threading.Thread(target=prepare,daemon=True,name='melodi-desktop-warmup').start()
        window.events.loaded+=warm_desktop
        def prepare_browser_translation():
            def prepare():
                try:bridge._sync_translation()
                except OSError:bridge._sync_translation_start_error='El puerto de traducción del navegador está ocupado.'
            threading.Thread(target=prepare,daemon=True,name='brivany-browser-ready').start()
        window.events.loaded+=prepare_browser_translation
        window.events.loaded+=lambda:instance.listen(lambda workspace:bridge.start_work() if workspace else bridge.return_to_chat())
        window.events.closing+=close_from_window
        window.events.minimized+=lambda:bridge.start_work()
        if island_preview:
            def show_island():
                if not getattr(bridge,'_work_window',None):bridge.start_work()
            window.events.loaded+=show_island
        gui = {"win32": "edgechromium", "darwin": "cocoa", "linux": "gtk"}.get(sys.platform)
        try:
            webview.start(gui=gui, debug=False, private_mode=True, http_server=False)
        finally:
            account.close()
            bridge._close_work_translation()
            bridge._close_sync_translation()
            bridge._audio_ducker.close()
            tray.close()
            work=getattr(server.http,'work',None)
            if work:work.close()
            bridge._close_island_windows()
            spotify=getattr(server.http,'spotify',None)
            bridge._close_spotify_player()
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
