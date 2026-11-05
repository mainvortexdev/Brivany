"""Resolve only artifacts produced by a completed terminal task."""
from pathlib import Path
from .evidence import desktop_directory
from .policy import TerminalError,scoped


def artifact_path(result,kind,root):
    if kind not in {'capture','notes','folder'}:raise TerminalError('Tipo de evidencia inválido.')
    value=result.get('evidence_folder') if kind=='folder' else result.get(kind,{}).get('path')
    if not isinstance(value,str):raise TerminalError('No hay esa evidencia en el resultado.')
    path=scoped(value,[Path(root).resolve()/'projects',desktop_directory()/'Evidencia Melodi'],existing=True)
    if kind=='folder':
        if not path.is_dir():raise TerminalError('La carpeta de evidencia no está disponible.')
    elif not path.is_file() or path.suffix.lower()!=('.png' if kind=='capture' else '.txt'):raise TerminalError('Archivo de evidencia no válido.')
    return path
