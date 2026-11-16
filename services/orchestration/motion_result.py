"""Canonical outputs of one completed motion job, never model-supplied paths."""
from pathlib import Path
from uuid import UUID
from PIL import Image


def motion_artifact(workspace,identifier,result):
    if not isinstance(identifier,str) or str(UUID(identifier))!=identifier or not isinstance(result,dict) or result.get('verified') is not True:
        raise ValueError('El resultado creativo todavía no está confirmado.')
    raw=result.get('path')
    if not isinstance(raw,str):raise ValueError('No hay un archivo creativo confirmado.')
    path=Path(raw).absolute();folder=Path(workspace).resolve()/'motion'/identifier
    if path.parent!=folder or path.name not in {'Brivany.mp4','Brivany.png'} or path.resolve()!=path:
        raise ValueError('El archivo no corresponde a este proyecto creativo.')
    for parent in (path,*path.parents):
        if parent.is_symlink() or getattr(parent,'is_junction',lambda:False)():raise ValueError('No se admiten enlaces en resultados creativos.')
    limit=24*1024**2 if path.suffix=='.png' else 128*1024**2
    if not path.is_file() or not 0<path.stat().st_size<=limit:raise ValueError('El resultado creativo no está disponible o es demasiado grande.')
    if path.suffix=='.png':
        with Image.open(path) as picture:
            if picture.format!='PNG' or not 0<picture.width<=4096 or not 0<picture.height<=4096:raise ValueError('La ilustración no es un PNG admitido.')
            picture.verify()
    return path
