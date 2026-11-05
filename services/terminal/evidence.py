"""Exact user-requested evidence directory, without registry operations."""
import ctypes
import os
from pathlib import Path
import uuid
from .policy import scoped,TerminalError


def desktop_directory():
    if os.name!='nt':return Path.home()/'Desktop'
    class GUID(ctypes.Structure):_fields_=[('data',ctypes.c_ubyte*16)]
    guid=GUID((ctypes.c_ubyte*16).from_buffer_copy(uuid.UUID('B4BFCC3A-DB2C-424C-B029-7FE99A87C641').bytes_le))
    value=ctypes.c_wchar_p();shell=ctypes.WinDLL('shell32');ole=ctypes.WinDLL('ole32')
    shell.SHGetKnownFolderPath.argtypes=[ctypes.POINTER(GUID),ctypes.c_ulong,ctypes.c_void_p,ctypes.POINTER(ctypes.c_wchar_p)];shell.SHGetKnownFolderPath.restype=ctypes.c_long
    if shell.SHGetKnownFolderPath(ctypes.byref(guid),0,None,ctypes.byref(value))<0:raise TerminalError('No se encontró el escritorio del usuario.')
    try:return Path(value.value)
    finally:ole.CoTaskMemFree(ctypes.cast(value,ctypes.c_void_p))


def evidence_directory():
    desktop=desktop_directory().resolve();path=scoped(desktop/'Evidencia Melodi',[desktop]);path.mkdir(exist_ok=True)
    return path
