"""Select one actual file in the OS file manager without command-line parsing."""
from pathlib import Path
import sys


def reveal_file(value):
 target=Path(value)
 if not target.is_absolute() or not target.is_file():raise ValueError('El archivo no está disponible.')
 if sys.platform!='win32':
  import subprocess
  subprocess.Popen(['/usr/bin/open','-R',str(target)] if sys.platform=='darwin' else ['xdg-open',str(target.parent)])
  return {'ok':True,'opened':True,'selection_requested':sys.platform=='darwin'}
 import ctypes
 from ctypes import wintypes as w
 ole=ctypes.WinDLL('ole32');shell=ctypes.WinDLL('shell32')
 ole.CoInitializeEx.argtypes=[w.LPVOID,w.DWORD];ole.CoInitializeEx.restype=ctypes.c_long
 ole.CoTaskMemFree.argtypes=[w.LPVOID];ole.CoTaskMemFree.restype=None
 ole.CoUninitialize.argtypes=[];ole.CoUninitialize.restype=None
 shell.SHParseDisplayName.argtypes=[w.LPCWSTR,w.LPVOID,ctypes.POINTER(w.LPVOID),w.ULONG,ctypes.POINTER(w.ULONG)];shell.SHParseDisplayName.restype=ctypes.c_long
 shell.SHOpenFolderAndSelectItems.argtypes=[w.LPVOID,w.UINT,w.LPVOID,w.DWORD];shell.SHOpenFolderAndSelectItems.restype=ctypes.c_long
 initialized=False;pidl=w.LPVOID()
 try:
  status=ole.CoInitializeEx(None,2);initialized=status>=0
  # An existing MTA is also a valid initialized COM apartment.
  if status<0 and status!=-2147417850:raise OSError('Windows no pudo preparar el Explorador.')
  if shell.SHParseDisplayName(str(target),None,ctypes.byref(pidl),0,None)<0:raise OSError('Windows no pudo localizar el archivo.')
  if not pidl:raise ValueError('Windows no pudo localizar el archivo.')
  # cidl=0 asks Shell to open the parent and select this fully qualified item.
  if shell.SHOpenFolderAndSelectItems(pidl,0,None,0)<0:raise OSError('Windows no pudo seleccionar el archivo en el Explorador.')
 finally:
  if pidl:ole.CoTaskMemFree(pidl)
  if initialized:ole.CoUninitialize()
 return {'ok':True,'opened':True,'selection_requested':True}
