"""Opt-in owned WinForms tray fixture; no account, capture, audio or model calls."""
import argparse
import json
from pathlib import Path
import threading
import time
import sys
from desktop.experience.tray import SystemTray,set_app_identity


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true',required=True);parser.parse_args()
    if sys.platform!='win32':raise RuntimeError('La comprobación nativa requiere Windows.')
    import webview
    set_app_identity();loaded=threading.Event();opened=threading.Event();workspace=threading.Event();exited=threading.Event()
    report={'status':'failed','scope':'owned native WinForms NotifyIcon and pywebview window; menu events through component API','external_calls':0,'screen_capture':False,'audio_capture':False}
    window=webview.create_window('Brivany · prueba de bandeja',html='<html><body>Comprobación local de Brivany.</body></html>',width=400,height=240,hidden=True)
    window.events.loaded+=loaded.set
    def show():window.show();window.restore();opened.set()
    def work():window.hide();workspace.set()
    def stop():tray.close();exited.set();window.destroy()
    tray=SystemTray(window,Path('desktop/assets/brivany.ico').resolve(),on_open=show,on_workspace=work,on_exit=stop)
    def run():
        try:
            if not loaded.wait(15):raise RuntimeError('La ventana de prueba no cargó.')
            if not tray.start():raise RuntimeError('No se registró el icono.')
            report['registered']=tray.status()['active'];report['icon_size']=[tray.image.Width,tray.image.Height]
            report['menu_labels']=[str(tray.items[key].Text) for key in ('open','workspace','exit')]
            tray._ui(lambda:tray.items['open'].PerformClick())
            if not opened.wait(8):raise RuntimeError('Abrir no respondió.')
            visible=[];tray._ui(lambda:visible.append(bool(window.native.Visible)))
            if visible!=[True]:raise RuntimeError('La ventana no se mostró.')
            tray._ui(lambda:tray.items['workspace'].PerformClick())
            if not workspace.wait(8):raise RuntimeError('WorkSpace no respondió.')
            visible=[];tray._ui(lambda:visible.append(bool(window.native.Visible)))
            if visible!=[False]:raise RuntimeError('La ventana no volvió al segundo plano.')
            tray._ui(lambda:tray.items['exit'].PerformClick())
            if not exited.wait(8) or tray.active:raise RuntimeError('Salir no retiró el icono.')
            report.update(status='passed',open_restores_window=True,workspace_returns_to_background=True,exit_removes_tray=True)
        except Exception as error:
            report['error_type']=type(error).__name__
            try:tray.close();window.destroy()
            except Exception:pass
        finally:
            folder=Path('tmp/tray-native');folder.mkdir(parents=True,exist_ok=True)
            (folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    webview.start(run,gui='edgechromium',debug=False,private_mode=True,http_server=False)
    print(json.dumps(report,ensure_ascii=False))
    return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
