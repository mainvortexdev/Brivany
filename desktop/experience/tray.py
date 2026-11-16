"""Windows notification area adapter, owned by the desktop GUI lifecycle."""
import sys
import threading

APP_USER_MODEL_ID='Brivany.Desktop'

def own_process_focused():
    import ctypes,os
    from ctypes import wintypes as w
    user=ctypes.WinDLL('user32',use_last_error=True)
    user.GetForegroundWindow.restype=w.HWND
    user.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
    pid=w.DWORD();user.GetWindowThreadProcessId(user.GetForegroundWindow(),ctypes.byref(pid))
    return pid.value==os.getpid()

def set_app_identity():
    if sys.platform!='win32':return
    import ctypes
    shell=ctypes.WinDLL('shell32')
    shell.SetCurrentProcessExplicitAppUserModelID.argtypes=[ctypes.c_wchar_p]
    shell.SetCurrentProcessExplicitAppUserModelID.restype=ctypes.c_long
    if shell.SetCurrentProcessExplicitAppUserModelID(APP_USER_MODEL_ID)!=0:
        raise OSError('No se pudo identificar Brivany en Windows.')


class SystemTray:
    def __init__(self,window,icon_path,*,on_open,on_workspace,on_exit,on_result=None,foreground=None):
        self.window=window;self.icon_path=str(icon_path)
        self.callbacks={'open':on_open,'workspace':on_workspace,'exit':on_exit}
        self.icon=None;self.menu=None;self.image=None;self.handlers=[];self.items={}
        self.closed=False;self.active=False;self.lock=threading.RLock()
        self.on_result=on_result;self.foreground=foreground or own_process_focused
        self.completed=set();self.last_completion=None

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
                def result_opened(sender,event):
                    if self.closed:return
                    if self.on_result and self.last_completion:
                        threading.Thread(target=self.on_result,args=(dict(self.last_completion),),name='brivany-notification-open',daemon=True).start()
                    else:self.dispatch('open')
                self.handlers.append(result_opened);self.icon.BalloonTipClicked+=result_opened
                self.window.native.Icon=self.image
                self.icon.Visible=True;self.active=True
        self._ui(create)
        return self.active

    def notify_completion(self,value):
        if not self.active or self.closed or not isinstance(value,dict) or not value.get('id'):return False
        shown=False
        def show():
            nonlocal shown
            from System.Windows.Forms import ToolTipIcon
            with self.lock:
                if self.closed or not self.icon or value['id'] in self.completed:return
                self.completed.add(value['id'])
                if len(self.completed)>1000:self.completed={value['id']}
                if self.foreground():return
                text={'image':'La imagen está lista. Abre Brivany para verla.',
                      'motion':'El video está listo. Abre Brivany para verlo.',
                      'document':'El documento está listo. Abre Brivany para revisarlo.',
                      'research':'La investigación terminó. Abre Brivany para ver el resultado.',
                      'orchestrator':'Los agentes terminaron tu tarea. Abre Brivany para ver el resultado.'}.get(value.get('kind'),'Tu tarea terminó. Abre Brivany para revisar el resultado.')
                if value.get('needs_review'):text='La tarea terminó y el resultado necesita revisión en Brivany.'
                self.last_completion={key:value.get(key) for key in ('id','kind','conversation_id')}
                self.icon.ShowBalloonTip(8000,'Melodi terminó',text,ToolTipIcon.Info);shown=True
        self._ui(show);return shown

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
