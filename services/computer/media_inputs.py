"""Bounded local file uploads from a user's selection or drop; never execute."""
from pathlib import Path, PureWindowsPath
from urllib.parse import unquote
from uuid import UUID, uuid4

EXTENSIONS={'.mp4','.mov','.mkv','.webm','.m4v','.avi','.mpg','.mpeg','.wav','.mp3','.m4a','.flac','.ogg'}
MAX_BYTES=250*1024*1024

def receive(handler,current):
    if not current.native:raise PermissionError('Adjunta archivos desde Brivany Desktop.')
    length=int(handler.headers.get('Content-Length','0'))
    name=unquote(handler.headers.get('X-Brivany-Media-Name',''))
    if not name or len(name)>240 or any(c in name for c in '/\\<>:"|?*') or any(ord(c)<32 for c in name) or name.endswith((' ','.')) or PureWindowsPath(name).is_reserved() or Path(name).suffix.lower() not in EXTENSIONS:raise ValueError('Nombre o formato de video o audio no admitido.')
    if not 0<length<=MAX_BYTES or handler.headers.get('Transfer-Encoding'):raise ValueError('El archivo debe ocupar entre 1 byte y 250 MB.')
    if handler.headers.get_content_type()!='application/octet-stream':raise ValueError('Carga de archivo no válida.')
    cache=current.root/'chat-inputs';cache.mkdir(exist_ok=True)
    if cache.resolve()!=cache.absolute() or cache.is_symlink() or getattr(cache,'is_junction',lambda:False)():raise ValueError('Carpeta de adjuntos no válida.')
    if sum(p.stat().st_size for p in cache.glob('*/*') if p.is_file())+length>1024**3:raise ValueError('La carpeta temporal de adjuntos alcanzó 1 GB.')
    with current.lock:
        if len(current.edits_inputs)>=8:raise ValueError('Puedes adjuntar hasta ocho archivos.')
    folder=cache/str(uuid4());folder.mkdir();path=folder/name
    try:
        with path.open('xb') as output:
            remaining=length
            while remaining:
                chunk=handler.rfile.read(min(1024*1024,remaining))
                if not chunk:raise ValueError('La transferencia se interrumpió; vuelve a adjuntar el archivo.')
                output.write(chunk);remaining-=len(chunk)
        with current.lock:
            value=current.select_edits_inputs([*current.edits_inputs,str(path)])
            identifier=folder.name
            current.media_inputs[identifier]=str(path)
            return {**value,'attachment':{'id':identifier,'name':name,'size':length,'kind':'video' if path.suffix.lower() in {'.mp4','.mov','.mkv','.webm','.m4v','.avi','.mpg','.mpeg'} else 'audio'}}
    except Exception:
        path.unlink(missing_ok=True);raise


def take_selection(current,ids):
    """Freeze this message's files; removing the draft never removes job inputs."""
    with current.lock:
        if ids is None:return tuple(current.edits_inputs)
        if len(set(ids))!=len(ids):raise ValueError('Hay adjuntos duplicados.')
        paths=[]
        for identifier in ids:
            if str(UUID(identifier))!=identifier or identifier not in current.media_inputs:raise ValueError('Vuelve a adjuntar el archivo; su selección ya no está disponible.')
            paths.append(current.media_inputs[identifier])
        current.edits_inputs=[path for path in current.edits_inputs if path not in paths]
        return tuple(paths)
