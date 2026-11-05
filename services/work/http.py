"""Read only the current translated WAV through a private, expiring Work capability."""
import re
from urllib.parse import urlsplit,parse_qs


def serve_audio(handler):
    if not handler.local_request():return
    try:
        work=getattr(handler.server,'work',None)
        if work is None:raise PermissionError()
        key=parse_qs(urlsplit(handler.path).query).get('key',[''])[0];path=work.translation_file(key);size=path.stat().st_size;start=0;end=size-1;status=200
        requested=handler.headers.get('Range')
        if requested:
            match=re.fullmatch(r'bytes=(\d*)-(\d*)',requested)
            if not match or not any(match.groups()):raise ValueError()
            if match[1]:start=int(match[1]);end=min(end,int(match[2])) if match[2] else end
            else:start=max(0,size-int(match[2]))
            if start>end or start>=size:handler.send_response(416);handler.send_header('Content-Range','bytes */'+str(size));handler.send_header('Content-Length','0');handler.end_headers();return
            status=206
        handler.send_response(status);handler.send_header('Content-Type','audio/wav');handler.send_header('Content-Length',str(end-start+1));handler.send_header('Accept-Ranges','bytes');handler.send_header('Cache-Control','no-store');handler.send_header('Referrer-Policy','no-referrer');handler.send_header('X-Content-Type-Options','nosniff')
        if status==206:handler.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        handler.end_headers()
        with path.open('rb') as source:
            source.seek(start);remaining=end-start+1
            while remaining:
                chunk=source.read(min(65536,remaining))
                if not chunk:break
                handler.wfile.write(chunk);remaining-=len(chunk)
    except (ValueError,PermissionError,OSError):
        if not handler.wfile.closed:handler.error(403,'work_audio_private','El audio temporal ya no está disponible.')
