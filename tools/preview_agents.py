"""Isolated native preview: real chat/avatar UI, synthetic jobs, no providers."""
import argparse,json,mimetypes,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from uuid import UUID
from services.computer.progress import media_progress

ROOT=Path(__file__).resolve().parents[1]
KINDS=[('research','Investigación'),('image','Diseño'),('motion','Video'),('document','Redacción')]

class Preview:
    def __init__(self):self.step=0;self.paused=False;self._window=None
    def jobs(self):
        jobs=[]
        phases=['Preparando el encargo de ejemplo','Analizando referencias de ejemplo','Preparando recursos de ejemplo','Generando imagen o renderizando video de ejemplo','Revisando el resultado de ejemplo']
        for i,(kind,name) in enumerate(KINDS):
            stage=min(4,max(0,self.step-(i%2)));state='planning' if stage==0 else 'reviewing' if stage==4 else 'running'
            job={'id':str(UUID(int=9000+i)),'kind':kind,'state':state,'phase':phases[stage],'agent':name,'title':name+' · Simulación',
                 'agent_key':'preview:'+kind,'attempt':1,'steps':stage,'external_calls':0,'result':None,'error':None,'reviewed':False,'simulation':True}
            job['progress']=media_progress(job);jobs.append(job)
        return jobs
    def assistant_status(self):return {'jobs':self.jobs(),'schedules':[],'simulation':True}
    def workspace_chat_publish(self,*_):return {'simulation':True}
    def music_voice_active(self,*_):return {'simulation':True}
    def stop_assistant_tasks(self):self.paused=True;return {'simulation':True}
    def preview_status(self):return {'jobs':self.jobs(),'paused':self.paused,'step':self.step}
    def preview_advance(self):self.step=min(4,self.step+1);return self.preview_status()
    def preview_pause(self):self.paused=not self.paused;return self.preview_status()
    def close_preview(self):
        if self._window:self._window.destroy()
        return {'closed':True}

def server_for(preview):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def send(self,data,mime='application/json; charset=utf-8',status=200):
            if not isinstance(data,bytes):data=json.dumps(data,ensure_ascii=False).encode()
            self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def do_GET(self):
            from urllib.parse import urlsplit
            route=urlsplit(self.path).path
            if route=='/api/demo':self.send(preview.preview_status());return
            if route=='/api/status':self.send({'voice':{'asr':{'available':False},'tts':{'configured':False}}});return
            if route.startswith('/api/'):
                self.send({'jobs':preview.jobs(),'services':[],'messages':[],'simulation':True});return
            if route=='/voice-engine.js':
                self.send(b'window.BrivanyVoice={VoiceOutput:class{constructor(){this.speaking=false}cancel(){}},Microphone:class{stop(){}suspend(){}}};','text/javascript');return
            if route in {'/','/preview.js','/preview.css'}:file=ROOT/'tools/agent-preview'/({'/':'index.html','/preview.js':'preview.js','/preview.css':'preview.css'}[route])
            elif route=='/app':file=ROOT/'desktop/experience/chat.html'
            elif route.startswith('/desktop-shell/') and '/' not in route.removeprefix('/desktop-shell/'):file=ROOT/'desktop/experience'/route.removeprefix('/desktop-shell/')
            elif route.count('/')==1 and route.endswith(('.js','.css','.woff2')):file=ROOT/'web'/route[1:]
            else:self.send({},status=404);return
            if not file.is_file() or file.is_symlink():self.send({},status=404);return
            data=file.read_bytes()
            if route=='/app':data=data.replace(b'</head>',b'<script src="/desktop-shell/icons.js"></script></head>')
            self.send(data,(mimetypes.guess_type(file)[0] or 'application/octet-stream')+'; charset=utf-8')
        def do_POST(self):
            length=int(self.headers.get('Content-Length',0))
            if not 0<=length<=60000:self.send({},status=413);return
            self.rfile.read(length)
            if self.path=='/api/demo/next':self.send(preview.preview_advance());return
            if self.path=='/api/demo/reset':preview.step=0;preview.paused=False;self.send(preview.preview_status());return
            if self.path=='/api/demo/pause':self.send(preview.preview_pause());return
            if self.path=='/api/voice/turn':
                self.send_response(200);self.send_header('Content-Type','application/x-ndjson; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers()
                try:
                    time.sleep(1.3)
                    for event in [{'type':'delta','text':'Esta es una simulación visual del equipo. Puedes observar los agentes mientras preparo un video de ejemplo.'},
                                  {'type':'computer_task','job':preview.jobs()[2]},{'type':'done'}]:
                        self.wfile.write((json.dumps(event,ensure_ascii=False)+'\n').encode());self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError):pass
                return
            self.send({'simulation':True})
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True;return server

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--serve-only',action='store_true');args=parser.parse_args()
    preview=Preview();server=server_for(preview);threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}'
    print(json.dumps({'url':url,'simulation':True,'providers':False}),flush=True)
    try:
        if args.serve_only:
            while True:time.sleep(1)
        else:
            import webview
            preview._window=webview.create_window('Brivany · Simulación de agentes',url,js_api=preview,width=1120,height=820,min_size=(760,580),background_color='#ffffff')
            webview.start(gui='edgechromium',private_mode=True)
    finally:server.shutdown();server.server_close()

if __name__=='__main__':main()
