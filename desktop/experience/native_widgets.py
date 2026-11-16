"""Small WinForms widgets on the existing UI dispatcher; no WebView or process."""
import ctypes
from ctypes import wintypes
import math
import threading
import time

_types = None
_types_lock = threading.Lock()


def native_types():
    global _types
    with _types_lock:
        if _types is not None:
            return _types
        import clr
        clr.AddReference('System.Windows.Forms'); clr.AddReference('System.Drawing')
        from System import Action, Activator, AppDomain, Boolean, Int32, Type
        from System.Reflection import AssemblyName, MethodAttributes, TypeAttributes, BindingFlags
        from System.Reflection.Emit import AssemblyBuilderAccess, OpCodes
        from System.Drawing import Color, Font, FontStyle, Point, Size, Rectangle, Region, Pen, ContentAlignment
        from System.Drawing.Drawing2D import GraphicsPath, SmoothingMode
        from System.Globalization import CultureInfo
        from System import DateTime
        from System.Windows.Forms import Form, FormBorderStyle, FormStartPosition, AutoScaleMode, Button, Label, TextBox, BorderStyle, ScrollBars, FlatStyle, Timer, Screen, Keys, MouseButtons
        from types import SimpleNamespace
        # Python properties do not override this protected CLR virtual getter.
        # Emit the tiny true-returning override once, without a compiler/child.
        base = clr.GetClrType(Form)
        assembly = AppDomain.CurrentDomain.DefineDynamicAssembly(AssemblyName('Brivany.NativeWidgets'), AssemblyBuilderAccess.Run)
        module = assembly.DefineDynamicModule('Widgets')
        builder = module.DefineType('Brivany.NativeWidgets.QuietForm', TypeAttributes.Public, base)
        builder.DefineDefaultConstructor(MethodAttributes.Public)
        getter = builder.DefineMethod('get_ShowWithoutActivation', MethodAttributes.Family | MethodAttributes.Virtual | MethodAttributes.HideBySig | MethodAttributes.SpecialName, clr.GetClrType(Boolean), Type.EmptyTypes)
        code = getter.GetILGenerator(); code.Emit(OpCodes.Ldc_I4_1); code.Emit(OpCodes.Ret)
        builder.DefineMethodOverride(getter, base.GetProperty('ShowWithoutActivation', BindingFlags.Instance | BindingFlags.NonPublic).GetGetMethod(True))
        quiet_form = builder.CreateType()
        overlay = module.DefineType('Brivany.NativeWidgets.PassiveOverlay', TypeAttributes.Public, quiet_form)
        overlay.DefineDefaultConstructor(MethodAttributes.Public)
        create = base.GetProperty('CreateParams', BindingFlags.Instance | BindingFlags.NonPublic).GetGetMethod(True)
        style = create.ReturnType.GetProperty('ExStyle')
        getter = overlay.DefineMethod('get_CreateParams', MethodAttributes.Family | MethodAttributes.Virtual | MethodAttributes.HideBySig | MethodAttributes.SpecialName, create.ReturnType, Type.EmptyTypes)
        code = getter.GetILGenerator()
        code.Emit(OpCodes.Ldarg_0); code.Emit(OpCodes.Call, create)
        code.Emit(OpCodes.Dup); code.Emit(OpCodes.Dup)
        code.Emit(OpCodes.Callvirt, style.GetGetMethod())
        # TOOLWINDOW, LAYERED, TRANSPARENT, NOACTIVATE; remove APPWINDOW.
        code.Emit(OpCodes.Ldc_I4, Int32(0x080800A0)); code.Emit(OpCodes.Or)
        code.Emit(OpCodes.Ldc_I4, Int32(~0x40000)); code.Emit(OpCodes.And)
        code.Emit(OpCodes.Callvirt, style.GetSetMethod()); code.Emit(OpCodes.Ret)
        overlay.DefineMethodOverride(getter, create)
        _types = SimpleNamespace(**{name: value for name, value in locals().copy().items()
                                    if name in {'Action','Activator','Color','Font','FontStyle','Point','Size','Rectangle','Region','Pen','ContentAlignment','GraphicsPath','SmoothingMode','CultureInfo','DateTime','FormBorderStyle','FormStartPosition','AutoScaleMode','Button','Label','TextBox','BorderStyle','ScrollBars','FlatStyle','Timer','Screen','Keys','MouseButtons'}})
        _types.QuietForm = quiet_form
        _types.PassiveOverlay = overlay.CreateType()
        return _types


class NativeWidgets:
    def __init__(self, dispatcher, model, *, changed=None, appearance=None):
        self.dispatcher, self.model = dispatcher, model
        self.net = native_types()
        self.changed = changed or (lambda: None)
        self.appearance = appearance or {'theme':'dark','accent':'blue','size':'normal'}
        self.meta_lock = threading.RLock()
        self.records = {}; self.visible = set(); self.pending = set()
        self.closed = False; self.epoch = 0
        self.ticker = None; self.cadence = 'stopped'; self.render_ticks = 0
        self.latest = None; self.update_queued = False; self.error = ''

    def metadata(self):
        with self.meta_lock:
            return {'windows': sorted(self.visible), 'pending': sorted(self.pending),
                    'cadence': self.cadence, 'render_ticks': self.render_ticks}

    def _post(self, callback, closing=False):
        if self.closed and not closing:
            return False
        try:
            if self.dispatcher.IsDisposed:
                return False
            def guarded():
                try:callback()
                except Exception:
                    self.error = 'No se pudo preparar el widget de escritorio.'
                    for record in list(self.records.values()):
                        if record.get('constructing'):
                            try:self._closed(record);record['form'].Dispose()
                            except Exception:pass
                    try:self.changed()
                    except Exception:pass
            if self.dispatcher.InvokeRequired:
                self.dispatcher.BeginInvoke(self.net.Action(guarded))
            else:
                guarded()
            return True
        except Exception:
            return False

    def open(self, kind):
        with self.meta_lock:
            if self.closed:
                raise ValueError('Los widgets se están cerrando.')
            if kind in self.pending:
                return {'queued': True}
            self.pending.add(kind); epoch = self.epoch
        if not self._post(lambda: self._open(kind, epoch)):
            with self.meta_lock:self.pending.discard(kind)
            raise ValueError('La ventana nativa de Brivany no está disponible.')
        return {'queued': True}

    def _bind(self, record, control, event, callback):
        value = getattr(control, event); value += callback
        record['events'].append((control, event, callback))

    def _open(self, kind, epoch):
        with self.meta_lock:
            self.pending.discard(kind)
            if self.closed or epoch != self.epoch:
                return
        if kind in self.records:
            self.records[kind]['form'].Show()
            self.records[kind]['form'].BringToFront()
            return
        n = self.net
        form = n.Activator.CreateInstance(n.QuietForm)
        form.FormBorderStyle = getattr(n.FormBorderStyle,'None')
        form.StartPosition = n.FormStartPosition.Manual
        form.AutoScaleMode = getattr(n.AutoScaleMode,'None')
        form.ShowInTaskbar = False; form.KeyPreview = True
        title = {'timer':'Enfoque', 'clock':'Reloj', 'notes':'Notas'}[kind]
        form.Text = 'Brivany · ' + title; form.AccessibleName = form.Text
        record = {'form':form, 'kind':kind, 'events':[], 'fonts':[], 'pen':None,
                  'region':None, 'style':None, 'suppressed':False, 'note_revision':0,
                  'conflict':False, 'constructing':True}
        self.records[kind] = record
        def label(name, value):
            control = n.Label(); control.Text = value; control.AccessibleName = name
            form.Controls.Add(control); return control
        def button(name, value, callback):
            control = n.Button(); control.Text = value; control.AccessibleName = name
            control.FlatStyle = n.FlatStyle.Flat; control.FlatAppearance.BorderSize = 0
            control.UseVisualStyleBackColor = False
            form.Controls.Add(control); self._bind(record, control, 'Click', callback)
            return control
        record['title'] = label(title, title)
        record['close'] = button('Cerrar ' + title, '×', lambda *_: form.Close())
        if kind in {'timer','clock'}:
            record['value'] = label('Tiempo restante' if kind == 'timer' else 'Hora actual', '')
            if kind == 'timer':
                record['action'] = button('Controlar temporizador', 'Iniciar', lambda *_: self.model.timer_action('toggle'))
                record['reset'] = button('Restablecer temporizador', '↺', lambda *_: self.model.timer_action('reset'))
            else:
                record['date'] = label('Fecha actual', '')
        else:
            box = n.TextBox(); box.Multiline = True; box.BorderStyle = getattr(n.BorderStyle,'None')
            box.ScrollBars = getattr(n.ScrollBars,'None'); box.WordWrap = True; box.MaxLength = 4000
            box.AccessibleName = 'Nota de WorkSpace'; form.Controls.Add(box); record['note'] = box
            record['status'] = label('Estado de la nota', '')
            record['reload'] = button('Cargar nota actual', 'Cargar actual', lambda *_: self.model.discard_draft('native-notes'))
            record['save'] = button('Guardar esta edición', 'Guardar ésta', lambda *_: self.model.update_note(str(box.Text), self.model.snapshot()['note_revision'], 'native-notes', True))
            def edited(*_):
                if record['suppressed'] or self.closed:
                    return
                try:
                    self.model.update_note(str(box.Text), record['note_revision'], 'native-notes')
                except ValueError as error:
                    record['status'].Text = str(error); record['status'].Visible = True
            self._bind(record, box, 'TextChanged', edited)
        def drag(sender, event):
            if event.Button != n.MouseButtons.Left:
                return
            user = ctypes.WinDLL('user32', use_last_error=True)
            user.SendMessageW.argtypes = [wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM]
            user.SendMessageW.restype = wintypes.LPARAM
            user.ReleaseCapture(); user.SendMessageW(int(form.Handle.ToInt64()), 0x00A1, 2, 0)
        self._bind(record, record['title'], 'MouseDown', drag)
        self._bind(record, form, 'MouseDown', drag)
        self._bind(record, form, 'KeyDown', lambda _, event: form.Close() if event.KeyCode == n.Keys.Escape else None)
        self._bind(record, form, 'LocationChanged', lambda *_: self._position(record))
        self._bind(record, form, 'VisibleChanged', lambda *_: self._schedule())
        self._bind(record, form, 'Paint', lambda _, event: self._border(record, event.Graphics))
        self._bind(record, form, 'FormClosed', lambda *_: self._closed(record))
        self._style(record, self.model.snapshot())
        position = self.model.snapshot()['positions'].get(kind)
        area = n.Screen.PrimaryScreen.WorkingArea
        offset = {'clock':0,'timer':1,'notes':2}[kind]
        point = n.Point(position['x'], position['y']) if position else n.Point(area.Right - form.Width - 20, area.Top + 20 + offset * 190)
        area = n.Screen.FromPoint(point).WorkingArea
        form.Location = n.Point(max(area.Left,min(point.X,area.Right-form.Width)),max(area.Top,min(point.Y,area.Bottom-form.Height)))
        with self.meta_lock:
            if self.closed or epoch != self.epoch:
                self._closed(record); form.Dispose(); return
        handle = int(form.Handle.ToInt64())
        user = ctypes.WinDLL('user32', use_last_error=True)
        user.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]; user.GetWindowLongW.restype = ctypes.c_long
        user.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_long]; user.SetWindowLongW.restype = ctypes.c_long
        user.SetWindowLongW(handle, -20, (user.GetWindowLongW(handle,-20) | 0x80) & ~0x40000)
        self._render(record, self.model.snapshot())
        form.Show()
        record['constructing'] = False; self.error = ''
        with self.meta_lock:self.visible.add(kind)
        self._schedule(); self.changed()

    def _position(self, record):
        if record['constructing'] or self.closed:
            return
        try:self.model.position(record['kind'], {'x':int(record['form'].Left),'y':int(record['form'].Top)})
        except ValueError:pass

    def _style(self, record, state):
        signature = tuple(self.appearance.get(k) for k in ('theme','accent','size'))
        form = record['form']; n = self.net
        if record.get('topmost') != state['topmost']:
            form.TopMost = state['topmost']; record['topmost'] = state['topmost']
        if record['style'] == signature:
            return
        record['style'] = signature
        ratio = {'compact':.92,'normal':1,'large':1.08}.get(self.appearance.get('size'),1)
        scale = ratio * max(1, float(form.DeviceDpi)/96)
        def bounds(control,x,y,width,height):
            control.SetBounds(*[round(value*scale) for value in (x,y,width,height)])
        background = n.Color.FromArgb(*(23,24,27) if self.appearance.get('theme') == 'soft' else (13,14,17))
        ink = n.Color.FromArgb(241,243,247); muted = n.Color.FromArgb(170,178,193)
        accent = n.Color.FromArgb(*{'blue':(132,182,255),'mint':(164,232,206),'amber':(237,195,136),'rose':(239,170,190)}.get(self.appearance.get('accent'),(132,182,255)))
        for font in record['fonts']:font.Dispose()
        from .typography import brand_font
        fonts = [brand_font(size*ratio) for size in (10,32,11)]
        record['fonts'] = fonts
        kind = record['kind']; width,height = (300,238) if kind=='notes' else (280,175 if kind=='timer' else 156)
        form.ClientSize = n.Size(round(width*scale),round(height*scale)); form.BackColor = background
        if not record['constructing']:
            area = n.Screen.FromControl(form).WorkingArea
            form.Location = n.Point(max(area.Left,min(form.Left,area.Right-form.Width)),max(area.Top,min(form.Top,area.Bottom-form.Height)))
        for control in form.Controls:
            control.Font = fonts[0]; control.ForeColor = ink; control.BackColor = background
        bounds(record['title'],16,12,width-64,20); record['title'].ForeColor = muted
        bounds(record['close'],width-37,7,27,27); record['close'].ForeColor = muted
        if kind in {'clock','timer'}:
            bounds(record['value'],14,43,width-28,64); record['value'].Font = fonts[1]
            if kind=='timer':
                bounds(record['action'],16,126,204,31); bounds(record['reset'],230,126,32,31)
                record['action'].ForeColor = accent
            else:
                bounds(record['date'],18,111,width-36,21); record['date'].ForeColor = muted
        else:
            bounds(record['note'],16,43,width-32,178); record['note'].Font = fonts[2]
            bounds(record['status'],16,165,width-32,18); record['status'].ForeColor = accent
            bounds(record['reload'],16,190,116,29); bounds(record['save'],143,190,140,29)
            record['save'].ForeColor = accent
        if record['region']:record['region'].Dispose()
        path = n.GraphicsPath(); radius = round(16*scale)
        for x,y,start in ((0,0,180),(form.ClientSize.Width-radius-1,0,270),(form.ClientSize.Width-radius-1,form.ClientSize.Height-radius-1,0),(0,form.ClientSize.Height-radius-1,90)):
            path.AddArc(x,y,radius,radius,start,90)
        path.CloseFigure(); region = n.Region(path); form.Region = region
        record['region'] = region
        if record['pen']:record['pen'].Dispose()
        record['pen'] = n.Pen(n.Color.FromArgb(45,48,57),1)
        if record.get('path'):record['path'].Dispose()
        record['path'] = path
        form.Invalidate()

    def _border(self, record, graphics):
        if record.get('path') and record['pen']:
            graphics.SmoothingMode = self.net.SmoothingMode.AntiAlias
            graphics.DrawPath(record['pen'],record['path'])

    def _render(self, record, state):
        self._style(record,state); n = self.net; kind=record['kind']
        if kind=='notes':
            draft = state['drafts'].get('native-notes'); value = draft['text'] if draft else state['note']
            box = record['note']; record['suppressed'] = True
            try:
                if str(box.Text) != value:
                    selection = int(box.SelectionStart); box.Text = value
                    box.SelectionStart = min(selection,box.TextLength)
            finally:record['suppressed'] = False
            record['note_revision'] = state['note_revision']; record['conflict'] = bool(draft)
            record['status'].Visible = bool(draft); record['reload'].Visible = bool(draft); record['save'].Visible = bool(draft)
            record['status'].Text = 'Hay otra edición guardada.' if draft else ''
            ratio = {'compact':.92,'normal':1,'large':1.08}.get(self.appearance.get('size'),1)*max(1,float(record['form'].DeviceDpi)/96)
            box.Height = round((116 if draft else 178)*ratio)
            # Do not retain a bright native scrollbar for a short note.
            lines=box.GetLineFromCharIndex(box.TextLength)+1
            scroll=n.ScrollBars.Vertical if lines*box.Font.Height>box.ClientSize.Height else getattr(n.ScrollBars,'None')
            if box.ScrollBars!=scroll:box.ScrollBars=scroll
            return
        if kind=='clock':
            now = n.DateTime.Now
            value = now.ToString('HH:mm'); date = now.ToString('dddd, d MMMM',n.CultureInfo.GetCultureInfo('es'))
            if str(record['date'].Text)!=date:record['date'].Text=date
        else:
            timer = state['timer']; remaining = max(0,timer['deadline']-self.model.clock()) if timer['state']=='running' else timer['remaining']
            seconds = math.ceil(remaining/1000); value = f'{seconds//60:02d}:{seconds%60:02d}'
            action = 'Pausar' if timer['state']=='running' else 'Reanudar' if timer['state']=='paused' else 'Iniciar'
            if str(record['action'].Text)!=action:record['action'].Text=action
        if str(record['value'].Text)!=value:record['value'].Text=value

    def receive(self, state=None, appearance=None):
        with self.meta_lock:
            if self.closed:return
            if appearance:self.appearance=dict(appearance)
            if state is not None and (self.latest is None or state['revision']>=self.latest['revision']):self.latest=state
            if self.update_queued:return
            self.update_queued=True
        def update():
            with self.meta_lock:
                self.update_queued=False; value=self.latest
            if self.closed:return
            value=value or self.model.snapshot()
            for record in list(self.records.values()):self._render(record,value)
            self._schedule()
        self._post(update)

    def _schedule(self):
        if self.closed:
            if self.ticker:self.ticker.Stop();self.ticker.Dispose();self.ticker=None
            with self.meta_lock:self.cadence='stopped'
            return
        state = self.model.snapshot(); timer=state['timer']; now=self.model.clock()
        active = [record for record in self.records.values() if record['form'].Visible]
        running = any(record['kind']=='timer' for record in active) and timer['state']=='running'
        clock = any(record['kind']=='clock' for record in active)
        if not running and not clock:
            if self.ticker:self.ticker.Stop();self.ticker.Dispose();self.ticker=None
            with self.meta_lock:self.cadence='stopped'
            return
        delays=[]
        if running:delays.append(max(16, int(max(0,timer['deadline']-now)%1000) or 1000))
        if clock:delays.append(max(16,60000-int(now%60000)))
        if self.ticker is None:
            self.ticker=self.net.Timer();self.ticker.Tick+=self._tick
        self.ticker.Stop();self.ticker.Interval=min(delays);self.ticker.Start()
        with self.meta_lock:self.cadence='second' if running else 'minute'

    def _tick(self, *_):
        if self.closed:return
        with self.meta_lock:self.render_ticks+=1
        state=self.model.snapshot()
        for record in list(self.records.values()):
            if record['kind'] in {'timer','clock'} and record['form'].Visible:self._render(record,state)
        self._schedule()

    def _closed(self, record):
        if record.get('disposed'):return
        record['disposed']=True
        kind=record['kind']; self.records.pop(kind,None)
        with self.meta_lock:self.visible.discard(kind)
        for control,event,callback in record['events']:
            try:
                value=getattr(control,event);value-=callback
            except Exception:pass
        record['events'].clear()
        for value in [*record['fonts'],record.get('pen'),record.get('path'),record.get('region')]:
            if value:value.Dispose()
        self._schedule();self.changed()

    def close_all(self, permanent=False):
        with self.meta_lock:
            self.epoch+=1; self.pending.clear()
            if permanent:self.closed=True
        def close():
            for record in list(self.records.values()):record['form'].Close()
            if self.ticker:self.ticker.Stop();self.ticker.Dispose();self.ticker=None
            with self.meta_lock:self.cadence='stopped'
        self._post(close,closing=True)
