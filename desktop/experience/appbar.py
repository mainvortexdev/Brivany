"""An owned Windows AppBar reservation. Never rewrites the global work-area setting."""
import ctypes
import sys
import threading


class Rect(ctypes.Structure):
    _fields_=[('left',ctypes.c_long),('top',ctypes.c_long),('right',ctypes.c_long),('bottom',ctypes.c_long)]


class AppBarData(ctypes.Structure):
    _fields_=[('cbSize',ctypes.c_uint32),('hWnd',ctypes.c_void_p),('uCallbackMessage',ctypes.c_uint32),('uEdge',ctypes.c_uint32),('rc',Rect),('lParam',ctypes.c_ssize_t)]


class MonitorInfo(ctypes.Structure):
    _fields_=[('cbSize',ctypes.c_uint32),('monitor',Rect),('work',Rect),('flags',ctypes.c_uint32)]


def rect_value(rect):return {'left':rect.left,'top':rect.top,'right':rect.right,'bottom':rect.bottom}


class WindowsAppBar:
    def __init__(self,handle,*,height,scale=1,on_position=lambda value:None,on_fullscreen=lambda active:None):
        if sys.platform!='win32':raise OSError('La reserva AppBar requiere Windows.')
        self.handle=handle;self.height=height;self.scale=scale;self.on_position=on_position;self.on_fullscreen=on_fullscreen
        self.registered=False;self.closed=False;self.setting=False;self.notifying=False;self.pending=False;self.rect=None;self.lock=threading.RLock()
        self.user=ctypes.WinDLL('user32',use_last_error=True);self.shell=ctypes.WinDLL('shell32',use_last_error=True)
        self.shell.SHAppBarMessage.argtypes=[ctypes.c_uint32,ctypes.POINTER(AppBarData)];self.shell.SHAppBarMessage.restype=ctypes.c_size_t
        self.user.MonitorFromWindow.argtypes=[ctypes.c_void_p,ctypes.c_uint32];self.user.MonitorFromWindow.restype=ctypes.c_void_p
        self.user.GetMonitorInfoW.argtypes=[ctypes.c_void_p,ctypes.POINTER(MonitorInfo)];self.user.GetMonitorInfoW.restype=ctypes.c_bool
        self.user.RegisterWindowMessageW.argtypes=[ctypes.c_wchar_p];self.user.RegisterWindowMessageW.restype=ctypes.c_uint
        self.user.CallWindowProcW.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_uint,ctypes.c_size_t,ctypes.c_ssize_t];self.user.CallWindowProcW.restype=ctypes.c_ssize_t
        self.user.SetWindowLongPtrW.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p];self.user.SetWindowLongPtrW.restype=ctypes.c_void_p
        self.user.MoveWindow.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_bool];self.user.MoveWindow.restype=ctypes.c_bool
        self.user.SetWindowPos.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_uint];self.user.SetWindowPos.restype=ctypes.c_bool
        self.user.IsWindow.argtypes=[ctypes.c_void_p];self.user.IsWindow.restype=ctypes.c_bool
        if hasattr(self.user,'GetDpiForWindow'):
            self.user.GetDpiForWindow.argtypes=[ctypes.c_void_p];self.user.GetDpiForWindow.restype=ctypes.c_uint
        self.callback_message=self.user.RegisterWindowMessageW('Brivany.MelodiWorkSpace.AppBar')
        self.taskbar_message=self.user.RegisterWindowMessageW('TaskbarCreated')
        self.callback_type=ctypes.WINFUNCTYPE(ctypes.c_ssize_t,ctypes.c_void_p,ctypes.c_uint,ctypes.c_size_t,ctypes.c_ssize_t)
        self.callback=self.callback_type(self._procedure);self.previous=None
    def monitor(self):
        info=MonitorInfo();info.cbSize=ctypes.sizeof(info)
        if not self.user.GetMonitorInfoW(self.user.MonitorFromWindow(self.handle,2),ctypes.byref(info)):raise OSError('No se pudo consultar el monitor de WorkSpace.')
        return info
    def _message(self,message,*,rect=None,param=0):
        data=AppBarData();data.cbSize=ctypes.sizeof(data);data.hWnd=self.handle;data.uCallbackMessage=self.callback_message;data.uEdge=1;data.lParam=param
        if rect:data.rc=rect
        result=self.shell.SHAppBarMessage(message,ctypes.byref(data))
        return result,data
    def start(self):
        if self.closed:raise ValueError('La barra ya se cerró.')
        self.previous=self.user.SetWindowLongPtrW(self.handle,-4,ctypes.cast(self.callback,ctypes.c_void_p))
        if not self.previous:raise OSError('No se pudo preparar la barra del escritorio.')
        try:
            if not self._message(0)[0]:raise OSError('Windows no autorizó la reserva superior.')
            self.registered=True;self.position()
        except Exception:self.close();raise
    def position(self):
        with self.lock:
            if self.closed or not self.registered or self.setting:return
            self.setting=True
        try:
            monitor=self.monitor().monitor
            if callable(getattr(self.user,'GetDpiForWindow',None)):
                dpi=self.user.GetDpiForWindow(self.handle)
                if dpi:self.scale=dpi/96
            height=max(24,round(self.height*self.scale))
            wanted=Rect(monitor.left,monitor.top,monitor.right,monitor.top+height)
            _,query=self._message(2,rect=wanted);query.rc.bottom=query.rc.top+height
            result,placed=self._message(3,rect=query.rc)
            if not result or placed.rc.right<=placed.rc.left or placed.rc.bottom<=placed.rc.top:raise OSError('No se confirmó el espacio de la barra.')
            r=placed.rc;self.rect=Rect(r.left,r.top,r.right,r.bottom)
            if not self.user.MoveWindow(self.handle,r.left,r.top,r.right-r.left,r.bottom-r.top,True):raise OSError('No se pudo colocar la barra.')
            self.on_position({**rect_value(r),'scale':self.scale,'monitor':rect_value(monitor)})
        finally:
            with self.lock:self.setting=False
    def _later(self,restart=False):
        if self.closed or self.pending:return
        self.pending=True
        def run():
            try:
                if restart and not self.closed:
                    registered=bool(self._message(0)[0])
                    with self.lock:
                        closed=self.closed
                        if not closed:self.registered=registered
                    if closed and registered:self._message(1)
                self.position()
            except OSError:pass
            finally:self.pending=False
        timer=threading.Timer(.08,run);timer.daemon=True;timer.start()
    def _procedure(self,handle,message,wparam,lparam):
        try:
            if message==self.callback_message:
                if wparam==1 and not self.setting:self._later()
                elif wparam==2:
                    active=bool(lparam);self.user.SetWindowPos(self.handle,ctypes.c_void_p(1 if active else -1),0,0,0,0,0x0013);self.on_fullscreen(active)
                return 0
            if message==self.taskbar_message:self._later(restart=True)
            elif message in (0x007e,0x02e0):self._later()
            elif message==0x0006 and self.registered and not self.closed:self._message(6,param=bool(wparam&0xffff))
            elif message==0x0047 and self.registered and not self.closed and not self.setting and not self.notifying:
                self.notifying=True
                try:self._message(9)
                finally:self.notifying=False
            elif message==0x0082 and self.registered:self._message(1);self.registered=False
        except Exception:pass
        return self.user.CallWindowProcW(self.previous,handle,message,wparam,lparam) if self.previous else 0
    def status(self):
        info=self.monitor()
        return {'reserved':self.registered,'rect':rect_value(self.rect) if self.rect else None,'work_area':rect_value(info.work),'monitor':rect_value(info.monitor)}
    def close(self):
        with self.lock:
            if self.closed:return
            self.closed=True
            if self.registered:
                self._message(1);self.registered=False
            if self.previous and self.user.IsWindow(self.handle):self.user.SetWindowLongPtrW(self.handle,-4,self.previous)
