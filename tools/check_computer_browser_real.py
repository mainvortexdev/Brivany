"""Read, click and navigate a new Chrome test profile/window. No AI calls."""
import argparse
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import base64
import os
from pathlib import Path
import subprocess
import threading
import time
from uuid import uuid4
from services.computer.runtime import NativeRuntime,ROOT


class Pages(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def handle(self):
        try:super().handle()
        except (ConnectionResetError,BrokenPipeError):pass
    def do_GET(self):
        if self.path=='/clicked':
            self.server.clicks+=1;self.send_response(204);self.end_headers();return
        name='B' if self.path=='/b' else 'C' if self.path=='/linked' else 'N' if self.path=='/linked-new' else 'A'
        extended='<p><a href="/linked">Abrir informe de prueba</a></p><p><a href="/linked-new" target="_blank">Abrir informe en otra pestaña</a></p><p><a href="javascript:void(0)">Enlace de prueba sin destino HTTP</a></p><div style="height:4000px">Área de desplazamiento sintética</div><h2>Final del documento</h2>' if getattr(self.server,'page_controls',False) else ''
        raw=('<!doctype html><html lang="es"><meta charset="utf-8"><title>Melodi browser fixture '+self.server.fixture_id+' '+name+'</title>'
             '<body><h1>Fixture local '+name+'</h1><p>Contenido sintético sin cuentas ni información personal.</p>'
             '<button onclick="this.textContent=\'Estado cambiado\';fetch(\'/clicked\')">Cambiar estado de prueba</button>'+extended+'</body></html>').encode()
        self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--web-search',action='store_true');parser.add_argument('--page-controls',action='store_true');args=parser.parse_args()
    directory=ROOT/'tmp/computer-browser-real';directory.mkdir(parents=True,exist_ok=True)
    workspace=directory/('fixture-'+uuid4().hex[:8]);workspace.mkdir()
    server=ThreadingHTTPServer(('127.0.0.1',0),Pages);server.fixture_id=uuid4().hex[:8];server.clicks=0;server.page_controls=args.page_controls;threading.Thread(target=server.serve_forever,daemon=True).start()
    base='http://127.0.0.1:'+str(server.server_port)
    edge=Path(os.environ.get('PROGRAMFILES',r'C:\Program Files'))/'Google/Chrome/Application/chrome.exe'
    runtime=NativeRuntime(workspace,proxy='http://127.0.0.1:1',token='fixture-'+uuid4().hex,diagnostics=True)
    report={'scope':'new isolated Chrome profile; local synthetic pages'+('; real Google search and GitHub login handoff' if args.web_search else ''),'provider_calls':0,'browser_background_network_unknown':True,'checks':[]}
    child=None
    try:
        if not edge.is_file():raise ValueError('No se encontró Chrome para la fixture.')
        child=subprocess.Popen([str(edge),'--user-data-dir='+str(workspace/'edge-profile'),'--no-first-run','--no-default-browser-check','--disable-background-networking','--force-renderer-accessibility','--new-window',base+'/a'],creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        runtime.call('begin_task',roots=[str(workspace)],timeout=25)
        deadline=time.monotonic()+25;window=None
        while time.monotonic()<deadline:
            observed=runtime.call('observe',timeout=20)
            matches=[w for w in observed['windows'] if 'Melodi browser fixture '+server.fixture_id+' A' in w.get('title','')]
            if len(matches)==1:window=matches[0];break
            time.sleep(.3)
        if not window:raise ValueError('No se confirmó la ventana aislada del navegador.')
        identity={'handle':str(window['handle']),'process_id':window['processId']}
        def execute(action,params=None):return runtime.call('execute',step={'action':action,'params':{**identity,**(params or {})}},timeout=35)
        first=execute('browser_observe');report['checks'].append('observed browser window and tabs')
        if args.page_controls:
            page=execute('browser_read');report['page_control_shape']={'scrollables':page.get('scrollables',[]),'links':[{k:c.get(k) for k in ('name','role','destination_origin','destination_observed')} for c in page['items'] if c['role']=='ControlType.Hyperlink'],'bounds':page.get('bounds')}
            scroll=next(c for c in page['scrollables'] if c['id']==page['documentId'])
            params={'tab_id':page['tab_id'],'document_id':page['documentId'],'scroll_id':scroll['id']}
            boundary=execute('browser_scroll',{**params,'direction':'up'});assert boundary['at_boundary'] and boundary['input_count']==0
            down=execute('browser_scroll',{**params,'direction':'down'});assert down['verified'] and down['after_percent']>down['before_percent']
            up=execute('browser_scroll',{**params,'direction':'up'});assert up['verified'] and up['after_percent']<up['before_percent']
            report['scroll_results']={name:{k:value for k,value in result.items() if k!='page'} for name,result in [('boundary',boundary),('down',down),('up',up)]}
            report['checks'].append('observed document scrolled down and up; boundary produced no input')
        execute('focus_window');observed=runtime.call('observe',timeout=20)
        controls=[c for c in observed['controls'] if c.get('name')=='Cambiar estado de prueba']
        if len(controls)!=1:raise ValueError('No se observó un único botón de la fixture.')
        report['button_point']=controls[0].get('point')
        report['click_receipt']=execute('click_control',{'control_id':controls[0]['id']})
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            observed=runtime.call('observe',timeout=20)
            if server.clicks>=1:break
        else:
            report['foreground_after_click']={'same_window':observed['foreground'] and observed['foreground']['windowHandle']==identity['handle'],'process':observed['foreground'] and observed['foreground']['processName']}
            report['page_requests']=server.clicks
            report['controls_after']=[c['name'] for c in observed['controls'] if c['name'] in {'Cambiar estado de prueba','Estado cambiado'}]
            report['foreground_is_other_fixture']=observed['foreground'] and observed['foreground'].get('title','').startswith('Melodi browser fixture ')
            raise ValueError('El clic no cambió el estado del botón observado.')
        report['checks'].append('real observed control click changed local page state')
        report['local_button_events']=server.clicks
        result=execute('browser_new_tab',{'url':base+'/b'})
        after=execute('browser_observe');assert len(after['tabs'])==len(first['tabs'])+1
        assert result.get('verified'), 'La URL final no pudo verificarse.'
        report['checks'].append('new local URL verified without replacing original tab')
        if args.page_controls:
            page=execute('browser_read');link=next(c for c in page['items'] if c['name']=='Abrir informe de prueba')
            followed=execute('browser_open_link',{'tab_id':page['tab_id'],'document_id':page['documentId'],'control_id':link['id']})
            assert followed['verified'] and followed['tabs_preserved'] and not followed['new_tab'];report['followed_link']=followed
            page=execute('browser_read');link=next(c for c in page['items'] if c['name']=='Abrir informe en otra pestaña')
            opened=execute('browser_open_link',{'tab_id':page['tab_id'],'document_id':page['documentId'],'control_id':link['id']})
            assert opened['verified'] and opened['tabs_preserved'] and opened['new_tab'];report['new_tab_link']=opened
            report['checks'].append('observed link destinations verified once in same/new tab while preserving original tabs')
            after=execute('browser_observe')
        original=next(tab for tab in after['tabs'] if server.fixture_id+' A' in tab.get('name',''))
        selected=execute('browser_select_tab',{'tab_id':original['id']});assert selected['verified'] and selected['tabs_preserved']
        report['checks'].append('original observed tab restored and tab count preserved')
        if args.web_search:
            search=execute('browser_search',{'query':'NASA sistema solar sitio oficial'})
            assert search['verified'];report['search_navigation']={'verified':search['verified'],'navigation_input_count':search['navigation_input_count']}
            page=execute('browser_read')
            report['search_page_shape']={key:len(value) for key,value in page.items() if isinstance(value,(list,str))}
            if not any('NASA' in str(value) for value in page.values()):raise ValueError('La página no expuso contenido de la búsqueda sintética.')
            report['checks'].append('real Google query URL and visible NASA result content observed')
        handoff=execute('browser_open_login',{'url':'https://github.com/login' if args.web_search else base+'/login-fixture'})
        assert handoff['requires_user'] and handoff['verified'];report['checks'].append('login page handoff returns to user; no credentials or submissions')
        report['status']='passed'
    except Exception as error:report.update(status='failed',failure=str(error))
    finally:
        report['navigation_diagnostics']=[event for event in runtime.diagnostic_events if event.get('phase')=='browser-navigation'][-12:]
        try:runtime.call('end_task',timeout=5)
        except Exception:runtime.cancel()
        runtime.close();server.shutdown();server.server_close()
        if child and child.poll() is None:child.terminate()
        (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
