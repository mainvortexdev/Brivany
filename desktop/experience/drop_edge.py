"""Paired-only Windows edge drop target and passive, per-pixel aura.

No desktop/file enumeration, input hook, WebView, or extra process. A small
WinForms timer watches button/position only while paired. A target exists only
during a drag near an edge; OLE FileDrop decides whether the aura lights up.
"""
import colorsys
import ctypes
from ctypes import wintypes
import math
import threading
import time


def nearest_edge(bounds, x, y, margin=56):
    left, top, width, height = bounds
    if not (left <= x < left + width and top <= y < top + height):
        return None
    distances = {'left': x-left, 'right': left+width-1-x,
                 'top': y-top, 'bottom': top+height-1-y}
    edge = min(distances, key=distances.get)
    return edge if distances[edge] < margin else None


def aura_pixels(width, height, edge, lit=True):
    """Premultiplied BGRA, with alpha=1 as an OLE hit surface during a drag."""
    if not lit:return b'\0\0\0\1'*(width*height)
    vertical = edge in {'left', 'right'}
    depth, length = (width, height) if vertical else (height, width)
    output = bytearray(width * height * 4)
    for along in range(length):
        position = (along - length/2) / max(1, min(length*.46, 380))
        envelope = math.exp(-position*position*2)
        red, green, blue = colorsys.hsv_to_rgb((.56 + along/max(1, length)*.65) % 1, .67, 1)
        for inward in range(depth):
            ring = 12 + 18 * max(0, 1-position*position)
            strength = envelope * (125*math.exp(-((inward-ring)/24)**2)
                                   + 115*math.exp(-((inward-ring)/3.2)**2)) if lit else 0
            alpha = max(1, min(245, round(strength)))
            cross = depth-1-inward if edge in {'right', 'bottom'} else inward
            x, y = (cross, along) if vertical else (along, cross)
            index = (y*width+x)*4
            output[index:index+4] = bytes((int(blue*alpha), int(green*alpha), int(red*alpha), alpha))
    return bytes(output)


class LayeredAura:
    """Bounded GDI allocations; every bitmap/DC is released after composition."""
    def __init__(self):
        self.user = ctypes.WinDLL('user32', use_last_error=True)
        self.gdi = ctypes.WinDLL('gdi32', use_last_error=True)
        self.user.GetDC.argtypes=[ctypes.c_void_p];self.user.GetDC.restype=ctypes.c_void_p
        self.user.ReleaseDC.argtypes=[ctypes.c_void_p,ctypes.c_void_p]
        self.user.GetWindowLongW.argtypes=[ctypes.c_void_p,ctypes.c_int];self.user.GetWindowLongW.restype=ctypes.c_long
        self.user.SetWindowLongW.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_long];self.user.SetWindowLongW.restype=ctypes.c_long
        self.gdi.CreateCompatibleDC.argtypes=[ctypes.c_void_p];self.gdi.CreateCompatibleDC.restype=ctypes.c_void_p
        self.gdi.CreateDIBSection.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_uint,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_uint];self.gdi.CreateDIBSection.restype=ctypes.c_void_p
        self.gdi.SelectObject.argtypes=[ctypes.c_void_p,ctypes.c_void_p];self.gdi.SelectObject.restype=ctypes.c_void_p
        self.gdi.DeleteObject.argtypes=[ctypes.c_void_p];self.gdi.DeleteDC.argtypes=[ctypes.c_void_p]
        self.user.UpdateLayeredWindow.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD]
        self.user.UpdateLayeredWindow.restype=wintypes.BOOL
        self.cache={}

    def paint(self, form, edge, lit, passive):
        width, height = form.Width, form.Height
        key=(width,height,edge,lit)
        if key not in self.cache:
            if len(self.cache)>=8:self.cache.clear()
            self.cache[key]=aura_pixels(width,height,edge,lit)
        handle=int(form.Handle.ToInt64())
        style=self.user.GetWindowLongW(handle,-20)|0x08080080  # layered/tool/noactivate
        style=style|0x20 if passive else style&~0x20
        self.user.SetWindowLongW(handle,-20,style&~0x40000)
        class Header(ctypes.Structure):
            _fields_=[('size',wintypes.DWORD),('width',wintypes.LONG),('height',wintypes.LONG),('planes',wintypes.WORD),('bits',wintypes.WORD),('compression',wintypes.DWORD),('bytes',wintypes.DWORD),('xp',wintypes.LONG),('yp',wintypes.LONG),('used',wintypes.DWORD),('important',wintypes.DWORD)]
        class Size(ctypes.Structure):
            _fields_=[('width',wintypes.LONG),('height',wintypes.LONG)]
        class Blend(ctypes.Structure):
            _fields_=[('operation',ctypes.c_ubyte),('flags',ctypes.c_ubyte),('alpha',ctypes.c_ubyte),('format',ctypes.c_ubyte)]
        dc=self.user.GetDC(None);memory=self.gdi.CreateCompatibleDC(dc);bitmap=None;previous=None
        try:
            header=Header(ctypes.sizeof(Header),width,-height,1,32,0,0,0,0,0,0)
            info=ctypes.create_string_buffer(ctypes.string_at(ctypes.byref(header),ctypes.sizeof(header))+bytes(12));bits=ctypes.c_void_p()
            bitmap=self.gdi.CreateDIBSection(dc,info,0,ctypes.byref(bits),None,0)
            if not bitmap or not bits:raise OSError('No se pudo dibujar el borde.')
            ctypes.memmove(bits,self.cache[key],width*height*4);previous=self.gdi.SelectObject(memory,bitmap)
            destination=wintypes.POINT(form.Left,form.Top);source=wintypes.POINT(0,0);size=Size(width,height);blend=Blend(0,0,255,1)
            if not self.user.UpdateLayeredWindow(handle,dc,ctypes.byref(destination),ctypes.byref(size),memory,ctypes.byref(source),0,ctypes.byref(blend),2):raise OSError('No se pudo mostrar el borde.')
        finally:
            if previous:self.gdi.SelectObject(memory,previous)
            if bitmap:self.gdi.DeleteObject(bitmap)
            if memory:self.gdi.DeleteDC(memory)
            if dc:self.user.ReleaseDC(None,dc)


class NativeDropEdge:
    def __init__(self, dispatcher, on_drop, *, on_preview=None, on_error=None):
        from .native_widgets import native_types
        from System.Windows.Forms import DataFormats, DragDropEffects, Cursor
        self.net=native_types();self.formats=DataFormats;self.effects=DragDropEffects;self.cursor=Cursor
        self.dispatcher=dispatcher;self.on_drop=on_drop;self.on_preview=on_preview or (lambda value:None);self.on_error=on_error or (lambda message:None)
        self.renderer=LayeredAura();self.timer=None;self.form=None;self.events=[]
        self.enabled=False;self.busy=False;self.closed=False;self.origin=None;self.suppressed=False
        self.remote=None;self.remote_until=0;self.local=False;self.accepted=False;self.edge=None;self.visual=None

    def _post(self, callback):
        if self.closed:return
        def guarded():
            if self.closed:return
            try:callback()
            except Exception:
                self._hide();self.on_error('No se pudo preparar el borde de transferencia.')
        if self.dispatcher.InvokeRequired:self.dispatcher.BeginInvoke(self.net.Action(guarded))
        else:guarded()

    def configure(self, enabled, busy=False):
        def apply():
            self.enabled=bool(enabled);self.busy=bool(busy)
            if not self.enabled:
                if self.timer:self.timer.Stop()
                self.origin=None;self.remote=None;self._hide();return
            if self.timer is None:
                self.timer=self.net.Timer();self.timer.Interval=50;self.timer.Tick+=self._tick
            self.timer.Start()
            if self.busy and self.local:self._hide()
        self._post(apply)

    def receive(self, state, edge='right'):
        def apply():
            self.remote=(state,edge) if state!='idle' else None
            self.remote_until=time.monotonic()+(3 if state=='preview' else 8)
            if not self.local:self._display_remote()
        self._post(apply)

    def _display_remote(self):
        if self.remote and self.enabled and time.monotonic()<self.remote_until:
            bounds=self.net.Screen.PrimaryScreen.Bounds
            self._show(bounds,self.remote[1],True,True)
        elif not self.local:self._hide()

    def _build(self):
        n=self.net;form=n.Activator.CreateInstance(n.QuietForm)
        form.Text='Brivany · Transferir archivos';form.AccessibleName=form.Text
        form.FormBorderStyle=getattr(n.FormBorderStyle,'None');form.StartPosition=n.FormStartPosition.Manual
        form.AutoScaleMode=getattr(n.AutoScaleMode,'None');form.ShowInTaskbar=False;form.TopMost=True;form.AllowDrop=True
        for name,fn in [('DragEnter',self._enter),('DragOver',self._over),('DragLeave',self._leave),('DragDrop',self._drop)]:
            event=getattr(form,name);event+=fn;self.events.append((name,fn))
        self.form=form

    def _show(self,bounds,edge,lit,passive):
        if self.form is None:self._build()
        depth=max(64,min(112,round(bounds.Width*.055)))
        x,y,width,height=bounds.X,bounds.Y,bounds.Width,bounds.Height
        if edge in {'left','right'}:
            width=depth
            if edge=='right':x=bounds.Right-depth
        else:
            height=depth
            if edge=='bottom':y=bounds.Bottom-depth
        signature=(x,y,width,height,edge,lit,passive)
        self.edge=edge
        if signature==self.visual and self.form.Visible:return
        self.form.Location=self.net.Point(x,y);self.form.ClientSize=self.net.Size(width,height)
        # Set the extended style before Show as well, so passive previews never
        # have an input-intercepting frame during a remote gesture.
        handle=int(self.form.Handle.ToInt64());user=self.renderer.user
        style=user.GetWindowLongW(handle,-20)|0x08080080
        user.SetWindowLongW(handle,-20,(style|0x20 if passive else style&~0x20)&~0x40000)
        self.form.Show();self.renderer.paint(self.form,edge,lit,passive);self.visual=signature

    def _hide(self):
        if self.form:self.form.Hide()
        if self.accepted:self.on_preview({'active':False,'count':0,'edge':self.edge or 'right'})
        self.visual=None;self.local=False;self.accepted=False

    def _tick(self,sender=None,event=None):
        if self.closed or not self.enabled:return
        user=self.renderer.user;down=bool(user.GetAsyncKeyState(1)&0x8000)
        if not down or user.GetAsyncKeyState(27)&0x8000:
            self.origin=None;self.suppressed=down
            if self.local:self._hide()
            self._display_remote();return
        point=self.cursor.Position
        if self.origin is None:self.origin=(point.X,point.Y);return
        if self.busy or self.suppressed:return
        if abs(point.X-self.origin[0])+abs(point.Y-self.origin[1])<10:return
        bounds=self.net.Screen.FromPoint(point).Bounds
        edge=nearest_edge((bounds.X,bounds.Y,bounds.Width,bounds.Height),point.X,point.Y,margin=56)
        if edge:
            self.local=True;self._show(bounds,edge,self.accepted,False)
        elif self.local:self._hide();self._display_remote()

    def _paths(self,event):
        if not self.enabled or self.busy or not (int(event.AllowedEffect)&1):return []
        try:
            if not event.Data.GetDataPresent(self.formats.FileDrop,False):return []
            paths=list(event.Data.GetData(self.formats.FileDrop,False))
            return [str(path) for path in paths] if 1<=len(paths)<=8 else []
        except Exception:return []

    def _enter(self,sender,event):
        paths=self._paths(event)
        if not paths:
            event.Effect=getattr(self.effects,'None');self.suppressed=True;self._hide();return
        self.accepted=True;self.local=True;event.Effect=self.effects.Copy
        self.on_preview({'active':True,'count':len(paths),'edge':self.edge})
        self._show(self.net.Screen.FromPoint(self.cursor.Position).Bounds,self.edge,True,False)

    def _over(self,sender,event):
        event.Effect=self.effects.Copy if self.enabled and not self.busy and self.accepted else getattr(self.effects,'None')

    def _leave(self,sender,event):
        self._hide()

    def _drop(self,sender,event):
        paths=self._paths(event);event.Effect=self.effects.Copy if paths else getattr(self.effects,'None')
        self.suppressed=True;self._hide()
        if paths:
            def enqueue():
                try:self.on_drop(paths)
                except (ValueError,OSError) as error:self.on_error(str(error) if isinstance(error,ValueError) else 'No se pudieron preparar los archivos.')
            threading.Thread(target=enqueue,name='brivany-edge-drop',daemon=True).start()

    def close(self):
        def dispose():
            if self.timer:self.timer.Stop();self.timer.Tick-=self._tick;self.timer.Dispose();self.timer=None
            self._hide()
            if self.form:
                for name,fn in self.events:
                    event=getattr(self.form,name);event-=fn
                self.form.AllowDrop=False;self.form.Dispose();self.form=None
            self.renderer.cache.clear();self.closed=True
        self._post(dispose)
