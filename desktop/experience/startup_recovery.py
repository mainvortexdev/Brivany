"""Recover one incomplete native shell load before any chat has initialized."""
import threading
import time
from urllib.parse import urlsplit

PROBE="""(()=>{const frame=document.getElementById('module-frame');let chat=false;try{chat=!!frame?.contentWindow?.BrivanyChat}catch{}return {origin:location.origin,path:location.pathname,complete:document.readyState==='complete',shell:!!frame,boot:!!window.BrivanyShellBoot,navigation:typeof window.BrivanyNavigate==='function',chat,frame_started:!!frame?.getAttribute('src')}})()"""


class StartupRecovery:
    def __init__(self,window,base,*,delay=2,timeout=16):
        # Assigning the identical WinForms WebView2 Source does not reload it.
        # A fresh non-secret marker guarantees navigation and bridge reinjection.
        self.window=window;self.origin=urlsplit(base);self.entry=base.rstrip('/')+'/brivany-shell?startup-retry='+str(time.monotonic_ns());self.delay=delay;self.timeout=timeout
        self.stopped=threading.Event();self.lock=threading.RLock();self.started=False;self.retries=0;self.state='waiting'
    def snapshot(self):
        with self.lock:return {'state':self.state,'retries':self.retries}
    def start(self):
        with self.lock:
            if self.started or self.stopped.is_set():return
            self.started=True
        threading.Thread(target=self._run,name='brivany-shell-recovery',daemon=True).start()
    def _run(self):
        begun=time.monotonic();deadline=begun+self.timeout
        try:
            while not self.stopped.is_set() and time.monotonic()<deadline:
                # WebView2 can retain the pre-redirect URL in its native cache.
                # Read the document's own origin before considering a reload;
                # the probe contains no capability, token or conversation text.
                try:value=self.window.evaluate_js(PROBE)
                except Exception:
                    if self.retries and not self.stopped.wait(.25):continue
                    raise
                if not isinstance(value,dict):return
                current=urlsplit(value.get('origin',''))
                if (current.scheme,current.hostname,current.port)!=(self.origin.scheme,self.origin.hostname,self.origin.port) or value.get('path')!='/brivany-shell':
                    self.state='left_shell';return
                if value.get('chat'):
                    self.state='recovered' if self.retries else 'ready';return
                # Reload only the inert shell observed in the reported failure.
                # Once navigation, boot code or an iframe has started, its own
                # retry UI owns recovery and any in-memory conversation state.
                inert=value.get('complete') and value.get('shell') and not any(value.get(key) for key in ('boot','navigation','frame_started'))
                if inert and not self.retries and time.monotonic()-begun>=self.delay:
                    self.retries=1;self.state='retrying';self.window.load_url(self.entry);deadline=time.monotonic()+self.timeout
                if self.stopped.wait(.25):return
            self.state='page_recovery' if not self.retries else 'failed'
        except Exception:self.state='unavailable'
    def close(self):self.stopped.set()
