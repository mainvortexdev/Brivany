"""Geometry and an owned-window region for Melodi's top-edge island.

The Windows host stays large enough to morph; its native region excludes every
pixel outside the island, so the invisible area cannot intercept desktop clicks.
Other backends resize the actual window to the visible island's bounds.
"""
import ctypes
import sys
import threading
import time

SIZES={'compact':276,'normal':336,'large':408}
PANELS={'notice':144,'home':188,'tasks':348,'voice':388,'settings':300,'screen':188,'spaces':204,'skills':250,'video':212,'connections':204,'translation':272,'music':252,'music-player':272,'music-library':444,'music-lyrics':444,'music-devices':416,'more':372}
PANEL_WIDTHS={'notice':336,'home':336,'screen':336,'spaces':336,'skills':336,'video':336,'connections':336,'settings':352,'translation':336,'music':336,'music-player':720,'music-library':720,'music-lyrics':720,'music-devices':720,'more':368}
PANELS.update(melodi=144,chat=456,**{'live-wave':112})
PANELS.update(auditory=360)
PANEL_WIDTHS.update(melodi=250,chat=388,**{'live-wave':560})
PANEL_WIDTHS.update(auditory=400)
PANELS.update(agent=284)
PANEL_WIDTHS.update(agent=336)
PANELS.update(team=396)
PANEL_WIDTHS.update(team=500)
PANELS.update(result=380)
PANEL_WIDTHS.update(result=520)
PANELS.update(files=182,widgets=192)
PANEL_WIDTHS.update(files=376,widgets=360)
PANELS.update(reply=120);PANEL_WIDTHS.update(reply=420)
BAR_HEIGHT=40
PANEL_GAP=6
CHAT_MIN_HEIGHT=148
CHAT_MAX_HEIGHT=404
TOOL_MIN_HEIGHT=100
TOOL_MAX_HEIGHT=344
TOOL_PANELS={'files','widgets'}


def pointer_presence(screen,width,height,x,y):
    """Hysteresis area only; no screen coordinates leave the native host."""
    scale=float(getattr(screen,'scale',1)) or 1
    dx=x/scale-int(getattr(screen,'x',0))-screen.width/2
    dy=y/scale-int(getattr(screen,'y',0))
    return {'inside':abs(dx)<=width/2 and 0<=dy<=height,'near':abs(dx)<=width/2+16 and -8<=dy<=height+16}


def geometry(screen,expanded=False,size='normal',panel='home',*,docked=False,offset=None,anchor_x=None,chat_height=CHAT_MIN_HEIGHT,tool_height=None):
    if type(expanded) is not bool or size not in SIZES or panel not in PANELS:raise ValueError('Diseño de isla inválido.')
    if type(chat_height) is not int or not CHAT_MIN_HEIGHT<=chat_height<=CHAT_MAX_HEIGHT:raise ValueError('Altura de conversación inválida.')
    if tool_height is not None and (panel not in TOOL_PANELS or type(tool_height) is not int or not TOOL_MIN_HEIGHT<=tool_height<=TOOL_MAX_HEIGHT):
        raise ValueError('Altura de herramienta inválida.')
    sw=max(240,int(screen.width));sh=max(150,int(screen.height));sx=int(getattr(screen,'x',0));sy=int(getattr(screen,'y',0))
    host_width=min(780,sw-16);host_height=min(404,sh-16)
    preferred=round(PANEL_WIDTHS.get(panel,384)*{'compact':.92,'normal':1,'large':1.08}[size])
    width=min(preferred if expanded else SIZES[size],host_width)
    if docked:host_height=min(host_height,sh-(BAR_HEIGHT if offset is None else offset)-PANEL_GAP-8)
    if expanded and panel.startswith('music-') and width<500:preferred_height=350 if panel!='music-player' else 326
    elif expanded and panel=='auditory' and width<350:preferred_height=400
    else:preferred_height=PANELS[panel]
    if panel=='chat':preferred_height=chat_height+BAR_HEIGHT
    if tool_height is not None:preferred_height=tool_height+BAR_HEIGHT
    height=min(preferred_height-(BAR_HEIGHT if docked else 0) if expanded else (0 if docked else 48),host_height)
    if anchor_x is not None and (type(anchor_x) not in (int,float) or not 0<=anchor_x<=sw):raise ValueError('Anclaje inválido.')
    anchor=sw/2 if anchor_x is None else anchor_x
    px=max(8,min(sw-width-8,round(anchor-width/2)))
    hx=max(0,min(sw-host_width,px-(host_width-width)//2))
    if panel in {'reply','result'}:
        # DWM backdrops can cover the whole HWND, including pixels outside its
        # region. Glass surfaces therefore own a physically compact window.
        host_width=width;host_height=max(1,height);hx=px
    sy=sy+(BAR_HEIGHT if offset is None else offset)+PANEL_GAP if docked else sy
    return {'expanded':expanded,'size':size,'panel':panel,'width':width,'height':height,
            'host_width':host_width,'host_height':host_height,'host_x':sx+hx,'x':sx+px,'clip_left':px-hx,'anchor_x':anchor,'y':sy,'docked':docked}


class IslandHost:
    def __init__(self,screen,*,expanded=False,docked=False):
        self.screen=screen;self.window=None;self.region=None;self.generation=0;self.lock=threading.Lock()
        self.docked=docked;self.offset=BAR_HEIGHT
        self.chat_height=CHAT_MIN_HEIGHT
        self.tool_heights={}
        self._visible=False;self._presentation=0;self._animate_open=False;self.dark_surface=False
        self.value=geometry(screen,expanded,docked=docked);self.current=(self.value['width'],self.value['height']);self.transparency=0;self.transparency_applied=False;self.taskbar_hidden=False
    def bind(self,window):
        self.window=window
        if sys.platform=='win32':
            try:
                native=window.native
                # Transparent WebView2 otherwise exposes WinForms' light Control
                # background during its first composition / native region change.
                from System import Action
                from System.Drawing import Color
                def darken():
                    native.BackColor=Color.FromArgb(255,0,0,0)
                    native.webview.DefaultBackgroundColor=Color.FromArgb(255,0,0,0)
                if native.InvokeRequired:native.Invoke(Action(darken))
                else:darken()
                self.dark_surface=True
                if hasattr(native,'ShowInTaskbar'):
                    from System import Action
                    hide=lambda:setattr(native,'ShowInTaskbar',False)
                    if native.InvokeRequired:native.Invoke(Action(hide))
                    else:hide()
                    self.taskbar_hidden=not native.ShowInTaskbar
                handle=int(window.native.Handle.ToInt64())
                user=ctypes.WinDLL('user32',use_last_error=True);gdi=ctypes.WinDLL('gdi32',use_last_error=True)
                user.GetWindowLongW.argtypes=[ctypes.c_void_p,ctypes.c_int];user.GetWindowLongW.restype=ctypes.c_long
                user.SetWindowLongW.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_long];user.SetWindowLongW.restype=ctypes.c_long
                style=user.GetWindowLongW(handle,-20)
                user.SetWindowLongW(handle,-20,(style|0x00000080)&~0x00040000)
                self.taskbar_hidden=bool(user.GetWindowLongW(handle,-20)&0x00000080) and not bool(user.GetWindowLongW(handle,-20)&0x00040000)
                user.SetWindowRgn.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_bool];user.SetWindowRgn.restype=ctypes.c_int
                user.GetClientRect.argtypes=[ctypes.c_void_p,ctypes.c_void_p];user.GetClientRect.restype=ctypes.c_int
                gdi.CreateRoundRectRgn.argtypes=[ctypes.c_int]*6;gdi.CreateRoundRectRgn.restype=ctypes.c_void_p
                gdi.DeleteObject.argtypes=[ctypes.c_void_p]
                self.region=(handle,user,gdi)
                if not self._clip(*self.current):self.region=None
            except (AttributeError,ValueError,OSError):self.region=None
        if self.region is None:self._resize()
        elif self.docked:window.move(self.value['host_x'],self.value['y'])
        self.opacity(self.transparency)
    def _clip(self,width,height):
        if not self.region:return False
        handle,user,gdi=self.region
        class Rect(ctypes.Structure):_fields_=[('left',ctypes.c_long),('top',ctypes.c_long),('right',ctypes.c_long),('bottom',ctypes.c_long)]
        rect=Rect()
        if not user.GetClientRect(handle,ctypes.byref(rect)):return False
        scale=rect.right/self.value['host_width'];w=round(width*scale);h=round(height*scale);left=round(self.value['clip_left']*scale);r=round((22 if height>60 else 17)*scale)
        if self.value['panel']=='melodi' and height>60:
            inset=max(1,round(4*scale));gap=round(8*scale);pill=max(1,(h-inset*2-gap)//2)
            region=gdi.CreateRoundRectRgn(left+inset,inset,left+w-inset,inset+pill,pill,pill)
            second=gdi.CreateRoundRectRgn(left+inset,inset+pill+gap,left+w-inset,h-inset,pill,pill)
            gdi.CombineRgn.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int];gdi.CombineRgn.restype=ctypes.c_int
            if region and second:gdi.CombineRgn(region,region,second,2)
            if second:gdi.DeleteObject(second)
        else:region=gdi.CreateRoundRectRgn(left,0,left+w+1,h+1,r*2,r*2)
        if not region:return False
        if not user.SetWindowRgn(handle,region,True):gdi.DeleteObject(region);return False
        return True # The window system owns a successfully assigned region.
    def glass_mode(self,enabled):
        if getattr(self,'glass_enabled',False)==enabled:return getattr(self,'glass_applied',False)
        self.glass_enabled=enabled;self.glass_applied=False
        if sys.platform!='win32' or not self.region or not self.window:return False
        try:
            from System import Action
            from System.Drawing import Color
            native=self.window.native
            def color():native.webview.DefaultBackgroundColor=Color.FromArgb(0 if enabled else 255,0,0,0)
            if native.InvokeRequired:native.Invoke(Action(color))
            else:color()
            handle,user,_=self.region;dwm=ctypes.WinDLL('dwmapi',use_last_error=True)
            class Margins(ctypes.Structure):_fields_=[('left',ctypes.c_int),('right',ctypes.c_int),('top',ctypes.c_int),('bottom',ctypes.c_int)]
            margin=Margins(*([-1]*4 if enabled else [0]*4));dwm.DwmExtendFrameIntoClientArea.argtypes=[ctypes.c_void_p,ctypes.c_void_p];dwm.DwmExtendFrameIntoClientArea(handle,ctypes.byref(margin))
            if sys.getwindowsversion().build>=22621:
                value=ctypes.c_int(3 if enabled else 1);dwm.DwmSetWindowAttribute.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_void_p,ctypes.c_uint]
                self.glass_applied=dwm.DwmSetWindowAttribute(handle,38,ctypes.byref(value),ctypes.sizeof(value))==0
            else:
                class Accent(ctypes.Structure):_fields_=[('state',ctypes.c_int),('flags',ctypes.c_int),('color',ctypes.c_uint),('animation',ctypes.c_int)]
                class Composition(ctypes.Structure):_fields_=[('attribute',ctypes.c_int),('data',ctypes.c_void_p),('size',ctypes.c_size_t)]
                accent=Accent(4 if enabled else 0,2,0x70191C18,0);data=Composition(19,ctypes.addressof(accent),ctypes.sizeof(accent))
                setter=user.SetWindowCompositionAttribute;setter.argtypes=[ctypes.c_void_p,ctypes.c_void_p];setter.restype=ctypes.c_bool
                self.glass_applied=bool(setter(handle,ctypes.byref(data)))
        except Exception:pass # Optional compositor capability; keep the readable CSS surface.
        return self.glass_applied
    def _resize(self):
        if self.window:self.window.resize(self.value['width'],self.value['height']);self.window.move(self.value['x'],self.value['y'])
    def layout(self,expanded,size='normal',panel='home',*,animate=True,anchor_x=None,chat_height=None,tool_height=None):
        if anchor_x is None:anchor_x=self.value.get('anchor_x')
        requested=self.chat_height if chat_height is None else chat_height
        height=self.tool_heights.get(panel) if tool_height is None else tool_height
        value=geometry(self.screen,expanded,size,panel,docked=self.docked,offset=self.offset,anchor_x=anchor_x,chat_height=requested,tool_height=height)
        old_host=(self.value['host_width'],self.value['host_height'])
        if panel=='chat':self.chat_height=requested
        with self.lock:
            if tool_height is not None:self.tool_heights[panel]=tool_height
            self.generation+=1;generation=self.generation;start=self.current;self.value=value
            self._animate_open=animate and self.docked
        target=(value['width'],value['height'])
        if not expanded and panel=='chat' and animate and self.window and self.region:
            def finish_close():
                if generation==self.generation:
                    self.current=target;self._clip(*target)
            timer=threading.Timer(.2,finish_close);timer.daemon=True;timer.start()
            return self.status()
        if self.window and self.region:
            if old_host!=(value['host_width'],value['host_height']):self.window.resize(value['host_width'],value['host_height'])
            self.window.move(value['host_x'],value['y'])
        if self.window and self.region and self.docked:
            # Content surfaces use their final bounds before exposure. A native
            # size morph looks like a provisional/loading player or cuts pills.
            with self.lock:self.current=target
            self._clip(*target)
        elif self.window and self.region:
            def run():
                began=time.monotonic()
                while True:
                    t=min(1,(time.monotonic()-began)/.26) if animate else 1;ease=1-(1-t)**4
                    current=tuple(a+(b-a)*ease for a,b in zip(start,target))
                    with self.lock:
                        if generation!=self.generation:return
                        self.current=current
                    if not self._clip(*current):return
                    if t>=1:return
                    time.sleep(1/60)
            threading.Thread(target=run,daemon=True,name='melodi-island-morph').start()
        else:
            self.current=target;self._resize()
        return self.status()
    def status(self):return {**self.value,'revision':self.generation,'native_clip':self.region is not None,'transparency':self.transparency,'transparency_applied':self.transparency_applied,'taskbar_hidden':self.taskbar_hidden,'dark_surface':self.dark_surface,'glass_applied':getattr(self,'glass_applied',False)}
    @staticmethod
    def _pointer():
        if sys.platform!='win32':return None
        class Point(ctypes.Structure):_fields_=[('x',ctypes.c_long),('y',ctypes.c_long)]
        point=Point();user=ctypes.WinDLL('user32',use_last_error=True)
        user.GetCursorPos.argtypes=[ctypes.c_void_p];user.GetCursorPos.restype=ctypes.c_bool
        return (point.x,point.y) if user.GetCursorPos(ctypes.byref(point)) else None
    def pointer(self):
        point=self._pointer()
        if point is None:return None
        if not self.docked:return pointer_presence(self.screen,*self.current,*point)
        scale=float(getattr(self.screen,'scale',1)) or 1;dx=point[0]/scale-int(getattr(self.screen,'x',0));dy=point[1]/scale-int(getattr(self.screen,'y',0))
        bar_inside=0<=dx<=self.screen.width and self.offset-BAR_HEIGHT<=dy<=self.offset
        width,height=self.current;distance=abs(dx-(self.value['x']-int(getattr(self.screen,'x',0))+width/2))
        panel_top=self.value['y']-int(getattr(self.screen,'y',0))
        panel_inside=self.value['expanded'] and distance<=width/2 and panel_top<=dy<=panel_top+height
        near_bar=-12<=dx<=self.screen.width+12 and self.offset-BAR_HEIGHT-8<=dy<=self.offset+12
        near_panel=self.value['expanded'] and distance<=width/2+16 and panel_top-8<=dy<=panel_top+height+16
        value={'inside':bool(bar_inside or panel_inside),'near':bool(near_bar or near_panel),'over_bar':bool(bar_inside)}
        if near_bar:value['anchor_x']=round(max(0,min(self.screen.width,dx)))
        return value
    def opacity(self,transparency):
        if type(transparency) is not int or not 0<=transparency<=40:raise ValueError('Transparencia inválida.')
        self.transparency=transparency;self.transparency_applied=False
        if self.window:
            try:
                if sys.platform=='win32':
                    handle=int(self.window.native.Handle.ToInt64());user=ctypes.WinDLL('user32',use_last_error=True)
                    user.GetWindowLongW.argtypes=[ctypes.c_void_p,ctypes.c_int];user.GetWindowLongW.restype=ctypes.c_long
                    user.SetWindowLongW.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_long];user.SetWindowLongW.restype=ctypes.c_long
                    user.SetLayeredWindowAttributes.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_ubyte,ctypes.c_ulong];user.SetLayeredWindowAttributes.restype=ctypes.c_bool
                    style=user.GetWindowLongW(handle,-20);user.SetWindowLongW(handle,-20,style|0x00080000)
                    self.transparency_applied=bool(user.SetLayeredWindowAttributes(handle,0,round(255*(1-transparency/100)),self._layer_flags()))
                else:
                    native=self.window.native
                    setter=next((getattr(native,name) for name in ('set_opacity','setWindowOpacity','setAlphaValue_') if callable(getattr(native,name,None))),None)
                    if setter:setter(1-transparency/100);self.transparency_applied=True
            except (AttributeError,ValueError,OSError):pass
        return {'transparency':self.transparency,'applied':self.transparency_applied}
    def gaze(self,eye_x=None):
        """Read a coarse local direction only; no pixel capture or input injection."""
        if eye_x is not None and (type(eye_x) not in (int,float) or not 0<=eye_x<=self.screen.width):raise ValueError('Posición del rostro inválida.')
        point=self._pointer()
        if point is None:return None
        scale=float(getattr(self.screen,'scale',1)) or 1
        x=point[0]/scale-int(getattr(self.screen,'x',0))-(self.screen.width/2 if eye_x is None else eye_x)
        y=point[1]/scale-int(getattr(self.screen,'y',0))-(self.offset-BAR_HEIGHT+20 if self.docked else 24)
        return {'x':max(-1,min(1,x/350)),'y':max(-1,min(1,y/300))}
    def click_through(self):
        if self.region:
            handle,user,_=self.region
            style=user.GetWindowLongW(handle,-20)
            user.SetWindowLongW(handle,-20,style|0x20|0x08000000)
    def show(self):
        if not self.window:return
        if self._visible:return
        self._visible=True;self._presentation+=1;presentation=self._presentation
        fade=self._animate_open and self.region is not None
        if fade:self._alpha(0)
        # Suppress activation only while appearing. A deliberate click must still
        # be able to focus the island for Tab/Escape and other keyboard controls.
        if self.region:
            handle,user,_=self.region
            user.GetWindowLongW.argtypes=[ctypes.c_void_p,ctypes.c_int];user.GetWindowLongW.restype=ctypes.c_long
            user.SetWindowLongW.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_long];user.SetWindowLongW.restype=ctypes.c_long
            previous=user.GetWindowLongW(handle,-20);user.SetWindowLongW(handle,-20,previous|0x08000000)
            try:self.window.show()
            finally:user.SetWindowLongW(handle,-20,previous&~0x08000000)
        else:self.window.show()
        if fade:
            def reveal():
                began=time.monotonic()
                while True:
                    t=min(1,(time.monotonic()-began)/.18)
                    with self.lock:
                        if presentation!=self._presentation or not self._visible or not self.window:return
                        alpha=round(255*(1-self.transparency/100)*(1-(1-t)**3))
                    self._alpha(alpha)
                    if t>=1:return
                    time.sleep(1/60)
            threading.Thread(target=reveal,daemon=True,name='melodi-panel-reveal').start()
        elif self.region:self._alpha(round(255*(1-self.transparency/100)))
    def _alpha(self,value):
        if self.region:
            handle,user,_=self.region
            user.SetLayeredWindowAttributes.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_ubyte,ctypes.c_ulong]
            user.SetLayeredWindowAttributes(handle,0,value,self._layer_flags())
    def _layer_flags(self):
        # The WebView's solid black backing is the transparent color for
        # waveform pixels only. Glass replies keep their normal compositor.
        return 3 if self.value.get('panel')=='live-wave' else 2
    def hide(self):
        with self.lock:self._presentation+=1;self._visible=False;window=self.window
        if window:window.hide()
    def close(self):
        with self.lock:self.generation+=1;self._presentation+=1;self._visible=False;self.window=None;self.region=None


class DockHost(IslandHost):
    """Full-width tool window; only this fixed strip reserves desktop space."""
    def __init__(self,screen,*,on_position=lambda value:None,on_fullscreen=lambda active:None):
        super().__init__(screen);self.reservation=None;self.fullscreen=False;self.on_position=on_position;self.on_fullscreen=on_fullscreen
        self.value.update(width=screen.width,height=BAR_HEIGHT,host_width=screen.width,host_height=BAR_HEIGHT,host_x=int(getattr(screen,'x',0)),x=int(getattr(screen,'x',0)))
        self.current=(screen.width,BAR_HEIGHT)
    def _clip(self,width,height):
        if not self.region:return False
        handle,user,gdi=self.region
        class R(ctypes.Structure):_fields_=[('left',ctypes.c_long),('top',ctypes.c_long),('right',ctypes.c_long),('bottom',ctypes.c_long)]
        rect=R()
        if not user.GetClientRect(handle,ctypes.byref(rect)):return False
        region=gdi.CreateRoundRectRgn(0,0,rect.right+1,rect.bottom+1,0,0)
        if not region:return False
        if not user.SetWindowRgn(handle,region,True):gdi.DeleteObject(region);return False
        return True
    def bind(self,window):
        super().bind(window)
        if sys.platform=='win32' and self.region:
            from .appbar import WindowsAppBar
            def position(rect):
                scale=rect.get('scale',1);monitor=rect.get('monitor')
                if monitor:
                    self.screen.scale=scale;self.screen.x=round(monitor['left']/scale);self.screen.y=round(monitor['top']/scale)
                    self.screen.width=round((monitor['right']-monitor['left'])/scale);self.screen.height=round((monitor['bottom']-monitor['top'])/scale)
                    self.value.update(width=self.screen.width,host_width=self.screen.width,x=self.screen.x,host_x=self.screen.x,y=round(rect['top']/scale))
                self._clip(*self.current);self.on_position(rect)
            def fullscreen(active):self.fullscreen=active;self.on_fullscreen(active)
            self.reservation=WindowsAppBar(self.region[0],height=BAR_HEIGHT,scale=float(getattr(self.screen,'scale',1)) or 1,on_position=position,on_fullscreen=fullscreen)
            self.reservation.start()
    def show(self):
        if not self.fullscreen:super().show()
    def status(self):
        value=super().status();value.update(reserved=bool(self.reservation and self.reservation.registered),bar_height=BAR_HEIGHT,fullscreen=self.fullscreen)
        return value
    def close(self):
        if self.reservation:self.reservation.close()
        super().close()
