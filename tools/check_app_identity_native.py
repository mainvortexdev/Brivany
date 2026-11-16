"""Read Brivany's own window metadata; no screenshots, focus or OS input."""
import ctypes
from ctypes import wintypes as w
import json
from pathlib import Path
import sys
from PIL import Image,ImageChops,ImageStat
from desktop.management import request,read_control

def main():
    if sys.platform!='win32':raise SystemExit('Windows required.')
    root=Path.cwd();control=read_control(root);state=request(folder=root)
    if not state.get('ready'):raise SystemExit('Brivany is not ready.')
    user=ctypes.WinDLL('user32',use_last_error=True)
    callback=ctypes.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
    user.EnumWindows.argtypes=[callback,w.LPARAM];user.EnumWindows.restype=w.BOOL
    user.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
    user.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,ctypes.c_int]
    user.SendMessageTimeoutW.argtypes=[w.HWND,w.UINT,w.WPARAM,w.LPARAM,w.UINT,w.UINT,ctypes.POINTER(ctypes.c_size_t)]
    user.SendMessageTimeoutW.restype=w.LPARAM
    windows=[]
    @callback
    def visit(hwnd,_):
        pid=w.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
        if pid.value==control['pid']:
            title=ctypes.create_unicode_buffer(100);user.GetWindowTextW(hwnd,title,100)
            if title.value=='Brivany':windows.append(hwnd)
        return True
    user.EnumWindows(visit,0)
    if len(windows)!=1:raise AssertionError('Expected one Brivany main window.')
    handle=ctypes.c_size_t()
    if not user.SendMessageTimeoutW(windows[0],0x007f,1,0,2,1000,ctypes.byref(handle)) or not handle.value:raise AssertionError('Main window has no icon.')
    import clr
    clr.AddReference('System.Drawing')
    from System import IntPtr
    from System.Drawing import Icon
    from System.Drawing.Imaging import ImageFormat
    out=root/'tmp/app-identity-native';out.mkdir(parents=True,exist_ok=True)
    icon=Icon.FromHandle(IntPtr(handle.value)).Clone();bitmap=icon.ToBitmap()
    try:bitmap.Save(str(out/'window-icon.png'),ImageFormat.Png)
    finally:bitmap.Dispose();icon.Dispose()
    with Image.open(out/'window-icon.png') as observed,Image.open(root/'desktop/assets/brivany.ico') as expected:
        expected=expected.ico.getimage(observed.size).convert('RGBA');observed=observed.convert('RGBA')
        def composite(image):
            bg=Image.new('RGBA',image.size,'white');bg.alpha_composite(image);return bg.convert('RGB')
        error=max(ImageStat.Stat(ImageChops.difference(composite(expected),composite(observed))).mean)
        if error>5:raise AssertionError('Native icon differs from Brivany branding.')
    report={'passed':True,'mode':'read_only_own_native_window_metadata','ready':True,'window_title':'Brivany','icon_matches_brand':True,'mean_channel_error':error,'external_calls':0,'screen_capture':False,'os_input':False}
    (out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))

if __name__=='__main__':main()
