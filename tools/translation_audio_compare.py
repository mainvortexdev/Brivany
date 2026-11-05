"""Loopback-only A/B playback of matching diagnostic excerpts held in memory."""
import argparse
import base64
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import re
import threading
import wave


MAX_WAVE_BYTES = 24_000 * 2 * 15 + 4096
MAX_BODY_BYTES = MAX_WAVE_BYTES * 4 // 3 + 1024
ROLE_LABELS = {'original': 'Original', 'translated': 'Doblaje de Brivany'}

PAGE = """<!doctype html><html lang=es><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Brivany · Comparación de voces</title>
<style>
:root{color-scheme:dark;font-family:'Segoe UI',sans-serif;background:#111315;color:#f3f3f3}
body{max-width:960px;margin:0 auto;padding:32px 20px}h1{font-size:32px;letter-spacing:-.04em;margin:16px 0}
p,small{color:#b5bac3;line-height:1.5}.brand{font-weight:800;letter-spacing:-.06em;font-size:22px}
.brand span{color:#89bfff}.pair{border:1px solid #33383e;border-radius:10px;margin-top:20px;padding:20px}
.clips{display:grid;grid-template-columns:1fr 1fr;gap:24px}h2{font-size:18px}h3{font-size:14px}
audio{width:100%}.status{color:#b7ed85}.pending{color:#efc095}@media(max-width:640px){.clips{grid-template-columns:1fr}}
</style><header class=brand>brivany<span>.</span></header>
<h1>Comparación de voces</h1>
<p>Escucha el original y el doblaje del mismo intervalo del video. Cada reproductor muestra la duración real del extracto.</p>
<div id=pairs aria-live=polite><p>Esperando los extractos de diagnóstico.</p></div>
<script>
const names={opening:'Inicio del video',presenter:'Presentador · segundos 24 a 31',control:'Control del presentador'};
const roles={original:'Original',translated:'Doblaje de Brivany'};
const mounted=new Set();
async function refresh(){
try{
 const state=await(await fetch('/api/status',{cache:'no-store'})).json();
 const root=document.getElementById('pairs');
 if(state.pairs.length&&!mounted.size)root.replaceChildren();
 for(const pair of state.pairs){
  let section=document.getElementById('pair-'+pair.id);
  if(!section){
   section=document.createElement('section');section.className='pair';section.id='pair-'+pair.id;
   const title=document.createElement('h2');title.textContent=names[pair.id]||'Extracto '+pair.id;
   const status=document.createElement('p');status.className='pending';status.dataset.state='';
   const grid=document.createElement('div');grid.className='clips';section.append(title,status,grid);root.append(section);
  }
  const status=section.querySelector('[data-state]');
  status.textContent=(pair.matched?'Mismo intervalo. ':'Esperando el extracto correspondiente. ')+
    (pair.source_start_ms/1000).toLocaleString('es')+'–'+(pair.source_end_ms/1000).toLocaleString('es')+' s del video.';
  status.className=pair.matched?'status':'pending';
  for(const role of ['original','translated']){
   const clip=pair.clips[role],key=pair.id+'-'+role;if(!clip||mounted.has(key))continue;
   const cell=document.createElement('div'),label=document.createElement('h3'),audio=document.createElement('audio'),details=document.createElement('small');
   label.textContent=roles[role];audio.controls=true;audio.preload='metadata';audio.src=clip.url;audio.setAttribute('aria-label',roles[role]+' del '+(names[pair.id]||pair.id));
   details.textContent=clip.duration_seconds.toLocaleString('es',{maximumFractionDigits:2})+' s · '+clip.sample_rate+' Hz · reproducción a 1×';
   cell.append(label,audio,details);section.querySelector('.clips').append(cell);mounted.add(key);
  }
 }
}catch{}setTimeout(refresh,1500);
}refresh();
</script></html>"""


class Store:
    def __init__(self):
        self.lock = threading.Lock()
        self.pairs = {}

    def put(self, data):
        if not isinstance(data, dict) or set(data) != {'id', 'role', 'source_start_ms', 'source_end_ms', 'wav_base64'}:
            raise ValueError('Campos de extracto no válidos.')
        identifier, role = data['id'], data['role']
        start, end = data['source_start_ms'], data['source_end_ms']
        if (not isinstance(identifier, str) or not re.fullmatch(r'[a-z0-9-]{1,32}', identifier) or role not in ROLE_LABELS or
                type(start) is not int or type(end) is not int or not 0 <= start < end <= 3_600_000 or end-start > 15_000):
            raise ValueError('Intervalo de extracto no válido.')
        raw = base64.b64decode(data['wav_base64'], validate=True)
        if not 44 <= len(raw) <= MAX_WAVE_BYTES:
            raise ValueError('El extracto supera los límites de audio.')
        with wave.open(BytesIO(raw), 'rb') as reader:
            if reader.getnchannels() != 1 or reader.getsampwidth() != 2 or reader.getframerate() != 24_000 or reader.getcomptype() != 'NONE':
                raise ValueError('El extracto requiere WAV PCM16 mono a 24 kHz.')
            duration = reader.getnframes() / reader.getframerate()
        if not 0 < duration <= 15:
            raise ValueError('Duración de extracto no válida.')
        clip = {'raw':raw, 'duration_seconds':duration, 'sample_rate':24_000}
        with self.lock:
            pair = self.pairs.get(identifier)
            if pair is None:
                if len(self.pairs) >= 4:
                    raise ValueError('El banco ya contiene cuatro comparaciones.')
                pair = {'id':identifier, 'source_start_ms':start, 'source_end_ms':end, 'clips':{}}
                self.pairs[identifier] = pair
            if abs(pair['source_start_ms']-start) > 20 or abs(pair['source_end_ms']-end) > 20:
                raise ValueError('Los extractos no corresponden al mismo intervalo.')
            if role in pair['clips']:
                return False
            pair['clips'][role] = clip
        return True

    def status(self):
        with self.lock:
            return {'type':'private_in_memory_voice_comparison', 'provider_sessions_started':0,
                    'pairs':[{'id':pair['id'], 'source_start_ms':pair['source_start_ms'], 'source_end_ms':pair['source_end_ms'],
                              'matched':len(pair['clips']) == 2,
                              'clips':{role:{'url':f'/audio/{pair["id"]}/{role}.wav', 'duration_seconds':clip['duration_seconds'],
                                             'sample_rate':clip['sample_rate']} for role,clip in pair['clips'].items()}}
                             for pair in self.pairs.values()]}

    def audio(self, identifier, role):
        with self.lock:
            return self.pairs.get(identifier, {}).get('clips', {}).get(role, {}).get('raw')


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_):
        pass

    def local(self):
        return self.client_address[0] == '127.0.0.1' and self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

    def send(self, status, data, mime='application/json; charset=utf-8'):
        raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if not self.local():
            return self.send(403, {'error':'Se requiere el banco local.'})
        if self.path == '/':
            return self.send(200, PAGE.encode('utf-8'), 'text/html; charset=utf-8')
        if self.path == '/api/status':
            return self.send(200, self.server.store.status())
        path = re.fullmatch(r'/audio/([a-z0-9-]{1,32})/(original|translated)\.wav', self.path)
        if path:
            raw = self.server.store.audio(path[1], path[2])
            if raw:
                return self.send(200, raw, 'audio/wav')
        self.send(404, {'error':'Extracto no disponible.'})

    def do_POST(self):
        if not self.local() or self.headers.get('Origin') != f'http://127.0.0.1:{self.server.server_port}':
            return self.send(403, {'error':'Se requiere el origen de este banco local.'})
        if self.path != '/api/clip':
            return self.send(404, {'error':'Ruta no disponible.'})
        try:
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                raise ValueError('Codificación de extracto no válida.')
            length = int(self.headers['Content-Length'])
            if not 0 < length <= MAX_BODY_BYTES:
                raise ValueError('Tamaño de extracto no válido.')
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('Se requiere un extracto JSON.')
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError('Extracto incompleto.')
            stored = self.server.store.put(json.loads(raw))
        except (ValueError, TypeError, OSError, wave.Error):
            return self.send(400, {'error':'No se pudo aceptar el extracto y su intervalo.'})
        self.send(200 if stored else 409, {'stored':stored})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=49193)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('Puerto local no válido.')
    with ThreadingHTTPServer(('127.0.0.1', args.port), Handler) as server:
        server.store = Store()
        print(f'http://127.0.0.1:{server.server_port}/', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
