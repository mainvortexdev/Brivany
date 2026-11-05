"""User-selected input and literal destination folders; never overwrite originals."""
import ctypes
import os
from pathlib import Path,PureWindowsPath
import re
import unicodedata
import uuid
from services.terminal.policy import scoped
from services.terminal.evidence import desktop_directory


def documents_directory():
    if os.name!='nt':return Path.home()/'Documents'
    class GUID(ctypes.Structure):_fields_=[('data',ctypes.c_ubyte*16)]
    guid=GUID((ctypes.c_ubyte*16).from_buffer_copy(uuid.UUID('FDD39AD0-238F-46AF-ADB4-6C85480369C7').bytes_le))
    value=ctypes.c_wchar_p();shell=ctypes.WinDLL('shell32');ole=ctypes.WinDLL('ole32')
    shell.SHGetKnownFolderPath.argtypes=[ctypes.POINTER(GUID),ctypes.c_ulong,ctypes.c_void_p,ctypes.POINTER(ctypes.c_wchar_p)];shell.SHGetKnownFolderPath.restype=ctypes.c_long
    if shell.SHGetKnownFolderPath(ctypes.byref(guid),0,None,ctypes.byref(value))<0:raise ValueError('No se encontró Documentos.')
    try:return Path(value.value)
    finally:ole.CoTaskMemFree(ctypes.cast(value,ctypes.c_void_p))


def normalized(value):return unicodedata.normalize('NFKC',value).casefold().replace('\\','/')


def destination(value,goal,*,folders=None):
    if not isinstance(value,dict) or set(value)!={'area','folder'}:raise ValueError('Indica la carpeta de destino.')
    area,folder=value['area'],value['folder'];text=normalized(goal)
    if area not in {'documents','desktop'} or not isinstance(folder,str):raise ValueError('Elige Documentos o Escritorio.')
    markers={'documents':r'\b(documentos|documents)\b','desktop':r'\b(escritorio|desktop)\b'}
    if not re.search(markers[area],text):raise ValueError('No se indicó ese destino en la petición.')
    # Drive-qualified and UNC paths are never accepted as relative folder names.
    parts=folder.replace('\\','/').split('/') if folder else []
    if len(parts)>8 or PureWindowsPath(folder).drive or any(not p or p in {'.','..'} or p[-1:] in {'.',' '} or re.search(r'[<>:"|?*\x00-\x1f]',p) or re.fullmatch(r'(?i)(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?',p) for p in parts):raise ValueError('La carpeta debe ser una ruta relativa válida, sin enlaces.')
    if folder and normalized(folder) not in text:raise ValueError('El nombre de la carpeta debe aparecer en tu petición.')
    root=Path((folders or {'documents':documents_directory(),'desktop':desktop_directory()})[area]).absolute()
    target=scoped(root.joinpath(*parts),[root]);target.mkdir(parents=True,exist_ok=True)
    return scoped(target,[root],existing=True)


def publish(stage,folder,stem,extension):
    """Atomic link in the same filesystem: existing destinations are never replaced."""
    stage=Path(stage);folder=Path(folder)
    if stage.parent!=folder or not stage.is_file() or stage.is_symlink():raise ValueError('Archivo temporal inválido.')
    stem=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',stem).strip(' .')[:120] or 'Melodi'
    if re.fullmatch(r'(?i)(?:con|prn|aux|nul|com[1-9]|lpt[1-9])',stem):stem='Melodi-'+stem
    for index in range(1,1001):
        candidate=folder/(stem+('' if index==1 else f' ({index})')+extension)
        scoped(candidate,[folder])
        try:os.link(stage,candidate)
        except FileExistsError:continue
        stage.unlink();return candidate
    raise ValueError('Hay demasiados archivos con ese nombre; elige otra carpeta.')
