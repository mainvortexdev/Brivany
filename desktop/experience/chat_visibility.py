"""Chat dismissal policy; observe only that typing occurred, never its content."""
import ctypes
import json
import os
from pathlib import Path
import sys
import threading
from uuid import uuid4


class ExternalTypingMonitor:
    def __init__(self):
        self.supported=sys.platform=='win32';self.lock=threading.RLock()
        self.thread=None;self.thread_id=None;self.hook=None;self.callback=None
        self.active=False;self.pending=False;self.ready=threading.Event();self.stopped=threading.Event()

    @staticmethod
    def text_key(key,modifiers=False):
        return not modifiers and (key in {8,13,32,46,0xE7} or 0x30<=key<=0x5A or 0x60<=key<=0x6F or 0xBA<=key<=0xE2)

    def record(self,key,foreground_pid,modifiers=False):
        if foreground_pid and foreground_pid!=os.getpid() and self.text_key(key,modifiers):
            with self.lock:
                if self.active:self.pending=True

    def consume(self):
        with self.lock:value=self.pending;self.pending=False;return value

    def enable(self,active):
        with self.lock:
            if self.active!=active:self.pending=False
            self.active=active
            if active and self.supported and (not self.thread or not self.thread.is_alive()):
                self.ready.clear();self.stopped.clear();self.thread=threading.Thread(target=self._run,daemon=True,name='melodi-chat-visibility');self.thread.start()

    def _run(self):
        from ctypes import wintypes as w
        user=ctypes.WinDLL('user32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        proc=ctypes.WINFUNCTYPE(ctypes.c_ssize_t,ctypes.c_int,w.WPARAM,w.LPARAM)
        class Key(ctypes.Structure):
            _fields_=[('vkCode',w.DWORD),('scanCode',w.DWORD),('flags',w.DWORD),('time',w.DWORD),('extra',ctypes.c_size_t)]
        user.SetWindowsHookExW.argtypes=[ctypes.c_int,proc,w.HINSTANCE,w.DWORD];user.SetWindowsHookExW.restype=w.HHOOK
        user.CallNextHookEx.argtypes=[w.HHOOK,ctypes.c_int,w.WPARAM,w.LPARAM];user.CallNextHookEx.restype=ctypes.c_ssize_t
        user.GetForegroundWindow.restype=w.HWND;user.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
        user.GetAsyncKeyState.argtypes=[ctypes.c_int];user.GetAsyncKeyState.restype=ctypes.c_short
        user.GetMessageW.argtypes=[ctypes.POINTER(w.MSG),w.HWND,w.UINT,w.UINT]
        user.PeekMessageW.argtypes=[ctypes.POINTER(w.MSG),w.HWND,w.UINT,w.UINT,w.UINT]
        user.UnhookWindowsHookEx.argtypes=[w.HHOOK];kernel.GetModuleHandleW.restype=w.HMODULE
        def keyboard(code,message,data):
            try:
                if code>=0 and message in {0x100,0x104} and self.active:
                    key=ctypes.cast(data,ctypes.POINTER(Key)).contents.vkCode
                    modifiers=any(user.GetAsyncKeyState(k)&0x8000 for k in (0x11,0x12,0x5B,0x5C))
                    if self.text_key(key,modifiers):
                        pid=w.DWORD();user.GetWindowThreadProcessId(user.GetForegroundWindow(),ctypes.byref(pid));self.record(key,pid.value)
            except Exception:pass
            return user.CallNextHookEx(self.hook,code,message,data)
        self.callback=proc(keyboard);self.thread_id=kernel.GetCurrentThreadId()
        self.hook=user.SetWindowsHookExW(13,self.callback,kernel.GetModuleHandleW(None),0)
        if not self.hook:self.supported=False;self.ready.set();return
        message=w.MSG();user.PeekMessageW(ctypes.byref(message),None,0,0,0);self.ready.set()
        try:
            while not self.stopped.is_set() and user.GetMessageW(ctypes.byref(message),None,0,0)>0:
                user.TranslateMessage(ctypes.byref(message));user.DispatchMessageW(ctypes.byref(message))
        finally:
            user.UnhookWindowsHookEx(self.hook);self.hook=None;self.callback=None

    def close(self):
        self.enable(False);self.stopped.set()
        if self.supported and self.thread_id:
            ctypes.WinDLL('user32').PostThreadMessageW(self.thread_id,0x12,0,0)
        if self.thread and self.thread is not threading.current_thread():self.thread.join(timeout=1)


class ChatVisibility:
    def __init__(self,path,monitor=None):
        self.path=Path(path);self.monitor=monitor or ExternalTypingMonitor();self.mode='auto';self.opened=False;self.lock=threading.RLock()
        try:
            value=json.loads(self.path.read_text(encoding='utf-8'))
            if value.get('mode') in {'auto','manual'}:self.mode=value['mode']
        except (OSError,ValueError,AttributeError):pass

    def status(self):return {'mode':self.mode,'supported':self.monitor.supported}

    def configure(self,mode):
        if mode not in {'auto','manual'}:raise ValueError('Modo de cierre no válido.')
        with self.lock:
            self.path.parent.mkdir(parents=True,exist_ok=True);temp=self.path.with_name(self.path.name+'.'+uuid4().hex+'.tmp')
            try:
                temp.write_text(json.dumps({'mode':mode}),encoding='utf-8');os.replace(temp,self.path)
            finally:temp.unlink(missing_ok=True)
            self.mode=mode;self.monitor.enable(self.opened and mode=='auto')
            return self.status()

    def opened_chat(self,opened):
        with self.lock:self.opened=opened;self.monitor.enable(opened and self.mode=='auto')

    def should_hide(self):
        with self.lock:return self.opened and self.mode=='auto' and self.monitor.consume()

    def close(self):self.monitor.close()
