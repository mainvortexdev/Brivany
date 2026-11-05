"""Windows notification area adapter, owned by the desktop GUI lifecycle."""
import sys
import threading


def set_app_identity():
    if sys.platform!='win32':return
    import ctypes
    shell=ctypes.WinDLL('shell32')
    shell.SetCurrentProcessExplicitAppUserModelID.argtypes=[ctypes.c_wchar_p]
    shell.SetCurrentProcessExplicitAppUserModelID.restype=ctypes.c_long
    if shell.SetCurrentProcessExplicitAppUserModelID('ProjectFixture.Brivany.Desktop')!=0:
        raise OSError('No se pudo identificar Brivany en Windows.')


class SystemTray:
    def __init__(self,window,icon_path,*,on_open,on_workspace,on_exit):
        self.window=window;self.icon_path=str(icon_path)
        self.callbacks={'open':on_open,'workspace':on_workspace,'exit':on_exit}
        self.icon=None;self.menu=None;self.image=None;self.handlers=[];self.items={}
        self.closed=False;self.active=False;self.lock=threading.RLock()

    def _ui(self,callback):
        from System import Action
        native=self.window.native
        if native.IsDisposed:return
        if native.InvokeRequired:native.Invoke(Action(callback))
        else:callback()

    def dispatch(self,action):
        if self.closed:return
        callback=self.callbacks[action]
        # WorkSpace/pywebview methods may synchronously marshal onto the GUI.
        # Never wait for them from a NotifyIcon event on that same GUI thread.
        threading.Thread(target=callback,name='brivany-tray-'+action,daemon=True).start()

    def start(self):
        if sys.platform!='win32' or self.closed:return False
        def create():
            from System.Drawing import Icon
            from System.Windows.Forms import NotifyIcon,ContextMenuStrip,ToolStripMenuItem,ToolStripSeparator
            with self.lock:
                if self.active or self.closed:return
                self.image=Icon(self.icon_path);self.menu=ContextMenuStrip()
                for action,title in [('open','Abrir Brivany'),('workspace','Melodi WorkSpace'),('exit','Salir de Brivany')]:
                    if action=='exit':self.menu.Items.Add(ToolStripSeparator())
                    item=ToolStripMenuItem(title)
                    def clicked(sender,event,action=action):self.dispatch(action)
                    self.handlers.append(clicked);item.Click+=clicked;self.items[action]=item;self.menu.Items.Add(item)
                self.icon=NotifyIcon();self.icon.Icon=self.image;self.icon.Text='Brivany';self.icon.ContextMenuStrip=self.menu
                def opened(sender,event):self.dispatch('open')
                self.handlers.append(opened);self.icon.DoubleClick+=opened
                self.window.native.Icon=self.image
                self.icon.Visible=True;self.active=True
        self._ui(create)
        return self.active

    def status(self):
        return {'supported':sys.platform=='win32','active':self.active,'closed':self.closed,'name':'Brivany','actions':list(self.callbacks)}

    def close(self):
        def dispose():
            with self.lock:
                if self.closed:return
                self.closed=True;self.active=False
                if self.icon:self.icon.Visible=False;self.icon.Dispose();self.icon=None
                if self.menu:self.menu.Dispose();self.menu=None
                if self.image:self.image.Dispose();self.image=None
                self.handlers.clear();self.items.clear()
        if not self.active:dispose();return
        self._ui(dispose)
