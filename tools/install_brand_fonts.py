"""Install only the three supplied fonts for the current Windows user.

No elevation to administrator and no system-wide font replacement. Existing
different files with the same names are refused instead of overwritten.
"""
from pathlib import Path
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
import shutil
from services.brand import FONT_ROOT,FONT_FACES

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if os.name!='nt':raise SystemExit('Windows current-user installation only.')
    import winreg
    folder=(Path(os.environ['LOCALAPPDATA'])/'Microsoft/Windows/Fonts').absolute()
    plan=[]
    for style,_ in FONT_FACES:
        source=FONT_ROOT/('BrivanyEditorial-'+style+'.ttf');target=folder/source.name
        if target.exists() and hashlib.sha256(target.read_bytes()).digest()!=hashlib.sha256(source.read_bytes()).digest():raise SystemExit('A different font already uses the destination filename; no replacement was made.')
        plan.append((source,target,'Brivany Editorial '+style+' (TrueType)'))
    installed=[]
    if args.apply:
        folder.mkdir(parents=True,exist_ok=True)
        gdi=ctypes.WinDLL('gdi32',use_last_error=True);gdi.AddFontResourceExW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.LPVOID];gdi.AddFontResourceExW.restype=ctypes.c_int
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows NT\CurrentVersion\Fonts',0,winreg.KEY_SET_VALUE|winreg.KEY_QUERY_VALUE) as key:
            for source,target,label in plan:
                try:previous,_=winreg.QueryValueEx(key,label)
                except FileNotFoundError:previous=None
                if previous is not None and Path(previous).absolute()!=target:raise SystemExit('An existing font registration points elsewhere; no registration was replaced.')
                if not target.exists():shutil.copyfile(source,target)
                winreg.SetValueEx(key,label,0,winreg.REG_SZ,str(target))
                if not gdi.AddFontResourceExW(str(target),0,None):raise SystemExit('Windows could not load the supplied face.')
                installed.append(source.name)
        # Notify applications about the new faces without moving focus or windows.
        result=ctypes.c_size_t();user=ctypes.WinDLL('user32',use_last_error=True)
        user.SendMessageTimeoutW(wintypes.HWND(0xffff),wintypes.UINT(0x001d),0,0,2,1000,ctypes.byref(result))
    report={'mode':'current_user_windows_fonts','applied':args.apply,'faces':installed if args.apply else [s.name for s,_,_ in plan],'system_wide_changes':False,'other_font_files_replaced':False}
    if args.apply:(Path(__file__).resolve().parents[1]/'tmp/brand-fonts-install-20261115.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))

if __name__=='__main__':main()
