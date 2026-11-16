"""Native-window entrypoint with an owned ephemeral loopback HTTP server."""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH
import argparse
from http.server import ThreadingHTTPServer
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import re
import sys
import subprocess
import threading
from urllib.parse import urlsplit

from desktop.bridge import DesktopBridge,DesktopError,ProjectSession,PROJECT_PREFIX
from services.projects import ProjectError,SpatialProjectSource

PYWEBVIEW_VERSION='6.2.1'
ROOT=Path(__file__).resolve().parents[1]


def _windows_runtime_status():
    result={'applicable':sys.platform=='win32','dotnet_framework_release':None,'dotnet_framework_version':None,
        'winforms_assembly_loaded':False,'webview2_assemblies_loaded':False,'webview2_browser_version':None,
        'edgechromium_available':False,'native_window_started':False}
    if sys.platform!='win32':return result
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full') as key:
            release=winreg.QueryValueEx(key,'Release')[0];version=winreg.QueryValueEx(key,'Version')[0]
            result['dotnet_framework_release']=release if type(release) is int else None
            result['dotnet_framework_version']=version if isinstance(version,str) and re.fullmatch(r'[0-9.]{1,40}',version) else None
    except (OSError,ImportError):pass
    # Import only CLR and the packaged assemblies in an isolated child. Do not
    # import pywebview's winforms platform module: its fallback can configure the
    # deprecated MSHTML backend. No Form/WebView instance or GUI loop is created.
    script="""import json
try:
 import clr
 clr.AddReference('System.Windows.Forms')
 from webview.util import interop_dll_path
 clr.AddReference(interop_dll_path('Microsoft.Web.WebView2.Core.dll'))
 clr.AddReference(interop_dll_path('Microsoft.Web.WebView2.WinForms.dll'))
 from Microsoft.Web.WebView2.Core import CoreWebView2Environment
 version=str(CoreWebView2Environment.GetAvailableBrowserVersionString(None))
 print(json.dumps({'winforms_assembly_loaded':True,'webview2_assemblies_loaded':True,'webview2_browser_version':version}))
except Exception:
 print(json.dumps({'winforms_assembly_loaded':False,'webview2_assemblies_loaded':False,'webview2_browser_version':None}))
"""
    try:
        completed=subprocess.run([sys.executable,'-X','utf8','-B','-c',script],capture_output=True,timeout=15,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if completed.returncode==0 and len(completed.stdout)<=1024:
            value=json.loads(completed.stdout)
            for key in ('winforms_assembly_loaded','webview2_assemblies_loaded'):result[key]=value.get(key) is True
            version=value.get('webview2_browser_version')
            if isinstance(version,str) and re.fullmatch(r'[0-9.]{1,40}',version):result['webview2_browser_version']=version
    except (OSError,ValueError,subprocess.TimeoutExpired):pass
    result['edgechromium_available']=bool(result['dotnet_framework_release'] and result['dotnet_framework_release']>=394802 and result['winforms_assembly_loaded'] and result['webview2_assemblies_loaded'] and result['webview2_browser_version'])
    return result


def dependency_status():
    available=importlib.util.find_spec('webview') is not None
    try:version=importlib.metadata.version('pywebview') if available else None
    except importlib.metadata.PackageNotFoundError:version=None
    packages={}
    for name in ('pywebview','pythonnet','clr_loader','bottle','proxy_tools'):
        try:packages[name]=importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:packages[name]=None
    runtime=_windows_runtime_status() if available and sys.platform=='win32' else {'applicable':sys.platform=='win32','edgechromium_available':False,'native_window_started':False}
    return {'pywebview_available':available,'pywebview_version':version,'required_pywebview_version':PYWEBVIEW_VERSION,
        'packages':packages,'windows_runtime':runtime,'edgechromium_available':bool(available and version==PYWEBVIEW_VERSION and runtime['edgechromium_available']),
        'platform':sys.platform,'native_launch_verified':False,'macos_packaging_verified':False}


def project_handler(base_handler):
    class DesktopHandler(base_handler):
        def do_GET(self):
            route=urlsplit(self.path).path
            if route.startswith(PROJECT_PREFIX):
                if not self.local_request():return
                match=re.fullmatch(re.escape(PROJECT_PREFIX)+r'([A-Za-z0-9_-]{32})/assets/([a-z][a-z0-9_-]{0,79})',route)
                if not match or urlsplit(self.path).query:
                    self.error(404,'desktop_asset_missing','Artefacto no disponible.');return
                try:
                    raw,mime=self.server.desktop_projects.asset(*match.groups());self.send_bytes(200,raw,mime)
                except (DesktopError,ProjectError) as exc:self.error(exc.status,exc.code,str(exc))
                except (OSError,ValueError,KeyError):self.error(503,'desktop_storage','No se pudo leer el proyecto.')
                return
            super().do_GET()
    return DesktopHandler


class LocalDesktopServer:
    def __init__(self,*,handler=None,session=None,live=False):
        if handler is None:
            from services.h1.server import Handler
            handler=Handler
        self.session=session or ProjectSession();self.http=ThreadingHTTPServer(('127.0.0.1',0),project_handler(handler))
        self.http.daemon_threads=True;self.http.desktop_projects=self.session;self.thread=None;self.live=live;self.bridges=[]
        self.base_url='http://127.0.0.1:'+str(self.http.server_port)

    def start(self):
        if self.thread is None:
            if self.live:
                from services.h1.server import load_local_config,start_application_bridges
                load_local_config()
                try:
                    self.bridges=start_application_bridges(self.http)
                except Exception:
                    for bridge in reversed(self.bridges):bridge.close()
                    self.bridges=[];self.http.server_close();raise
            self.thread=threading.Thread(target=self.http.serve_forever,name='brivany-desktop-http',daemon=True);self.thread.start()
        return self

    def close(self):
        if self.thread is not None:self.http.shutdown();self.thread.join(timeout=5)
        for bridge in reversed(self.bridges):bridge.close()
        self.bridges=[]
        for name in ('spatial','human_skills'):
            service=getattr(self.http,name,None)
            if service is not None and hasattr(service,'close'):service.close()
        self.http.server_close();self.thread=None

    def __enter__(self):return self.start()
    def __exit__(self,*_):self.close()


def launch(*,project=None,startup_report=None):
    status=dependency_status()
    if not status['pywebview_available'] or status['pywebview_version']!=PYWEBVIEW_VERSION:
        raise DesktopError('desktop_dependency','Instala requirements-desktop.txt para abrir la ventana nativa.',503)
    if sys.platform=='win32' and not status.get('edgechromium_available'):
        raise DesktopError('desktop_runtime','Faltan .NET o WebView2 disponibles para EdgeChromium; no se usará el motor MSHTML.',503)
    if sys.platform not in {'win32','darwin'}:raise DesktopError('desktop_platform','El empaquetado de esta plataforma sigue pendiente.',503)
    import webview
    if sys.platform=='win32':
        from desktop.experience.tray import set_app_identity
        set_app_identity()
    # Disable file navigation/download helpers. Assets are served only through
    # the owned manifest-scoped HTTP handler, not pywebview's file server.
    webview.settings['ALLOW_FILE_URLS']=False;webview.settings['ALLOW_DOWNLOADS']=False
    webview.settings['OPEN_DEVTOOLS_IN_DEBUG']=False
    session=ProjectSession()
    if project is not None:session.open(project)
    with LocalDesktopServer(session=session,live=True) as server:
        def source():
            spatial=getattr(server.http,'spatial',None)
            return SpatialProjectSource(spatial.root if spatial is not None else DATA_ROOT/'.local'/'spatial')
        bridge=DesktopBridge(server.base_url,session,source,folder_dialog=webview.FileDialog.FOLDER,save_dialog=webview.FileDialog.SAVE)
        window=webview.create_window('Brivany',server.base_url+'/spaces',js_api=bridge,width=1440,height=950,min_size=(900,650),background_color='#ffffff',confirm_close=False)
        bridge._bind_window(window)
        probe=None
        if startup_report is not None:
            from desktop.diagnostics import StartupProbe
            probe=StartupProbe(window,startup_report);window.events.loaded+=probe.loaded
        webview.start(func=probe.run if probe else None,gui='edgechromium' if sys.platform=='win32' else None,debug=False,private_mode=True,http_server=False,icon=str(ROOT/'desktop/assets/brivany.ico'))


def main(argv=None):
    parser=argparse.ArgumentParser(description='Abrir Brivany como aplicación de escritorio local')
    parser.add_argument('--project',type=Path,help='Carpeta portátil seleccionada explícitamente al lanzar')
    parser.add_argument('--check',action='store_true',help='Comprobar dependencias sin abrir ventana ni servidor')
    parser.add_argument('--startup-report',type=Path,help='Guardar diagnóstico opcional de carga y render, sin automatizar controles')
    args=parser.parse_args(argv)
    if args.check:
        print(json.dumps(dependency_status(),ensure_ascii=False,indent=2));return 0
    try:launch(project=args.project,startup_report=args.startup_report);return 0
    except (DesktopError,ProjectError) as exc:print(str(exc),file=sys.stderr);return 2
    except (OSError,RuntimeError,ImportError):print('No se pudo iniciar la ventana nativa. Revisa pywebview y el runtime del sistema.',file=sys.stderr);return 2


if __name__=='__main__':sys.exit(main())
