"""Opt-in instrumentation of this application's own startup, not UI automation.

Only fixed read-only DOM metadata is inspected. No clicks, navigation, input,
provider calls, project titles, files, conversations or private content are read.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import threading
import time

SNAPSHOT="""(()=>{const canvas=document.querySelector('#spatial-canvas');return {
  documentReady:document.readyState==='complete',
  bridgeAvailable:typeof window.pywebview?.api?.status==='function',
  nativeControlsVisible:document.querySelector('#desktop-project-actions')?.hidden===false,
  sceneReady:canvas?.dataset.ready==='true',
  drawCalls:Number(canvas?.dataset.drawCalls || 0),
  objects:Number(canvas?.dataset.objects || 0),
  portableProject:document.querySelector('#save-state')?.textContent==='Carpeta del ordenador',
  viewportWidth:innerWidth,viewportHeight:innerHeight,
  canvasPresent:Boolean(canvas?.querySelector('canvas'))
};})()"""


class StartupProbe:
    def __init__(self,window,destination,*,timeout=35):
        self.window=window;self.path=Path(destination).absolute();self.timeout=timeout;self.event=threading.Event()
        if self.path.resolve()!=self.path or self.path.exists() or not self.path.parent.is_dir():
            raise ValueError('El diagnóstico necesita un archivo nuevo en una carpeta existente.')

    def loaded(self,*_):self.event.set()

    def run(self):
        started=time.monotonic();snapshot={};error=None
        try:
            if not self.event.wait(self.timeout):raise RuntimeError('startup_load_timeout')
            while time.monotonic()-started<self.timeout:
                value=self.window.evaluate_js(SNAPSHOT)
                if not isinstance(value,dict):raise ValueError('startup_metadata')
                snapshot=value
                if snapshot.get('sceneReady') and snapshot.get('nativeControlsVisible') and snapshot.get('drawCalls',0)>0:break
                time.sleep(.2)
        except Exception:error='startup_metadata_unavailable'
        passed=bool(snapshot.get('sceneReady') and snapshot.get('bridgeAvailable') and snapshot.get('nativeControlsVisible') and snapshot.get('drawCalls',0)>0)
        report={'checked_at':datetime.now(timezone.utc).isoformat(),'status':'passed' if passed else 'incomplete',
            'scope':'Read-only startup instrumentation inside the actual Brivany pywebview window.',
            'snapshot':snapshot,'error_code':error,'elapsed_seconds':round(time.monotonic()-started,3),
            'native_window_started':True,'native_render_verified':passed,'native_editing_verified':False,
            'native_picker_verified':False,'native_reopen_verified':False,'physical_gpu_measured':False,
            'external_model_calls_triggered':0,'ui_actions_automated':0,'macos_verified':False}
        with self.path.open('x',encoding='utf-8') as output:json.dump(report,output,ensure_ascii=False,indent=2)
