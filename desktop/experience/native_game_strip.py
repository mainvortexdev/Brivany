"""Lightweight WinForms game strip on the existing desktop dispatcher."""
import ctypes
from ctypes import wintypes as W
import threading

from .native_widgets import native_types


class NativeGameStrip:
    def __init__(self, dispatcher):
        self.dispatcher = dispatcher
        self.net = native_types()
        self.user = ctypes.WinDLL('user32', use_last_error=True)
        self.user.GetForegroundWindow.restype = W.HWND
        self.user.GetWindowThreadProcessId.argtypes = (W.HWND, ctypes.POINTER(W.DWORD))
        self.user.GetWindowLongW.argtypes = (W.HWND, ctypes.c_int)
        self.user.GetWindowLongW.restype = ctypes.c_long
        self.lock = threading.Lock()
        self.form = self.font = self.region = None
        self.labels = []
        self.pending = self.closed = False
        self.latest = None
        self.error = ''

    def _post(self, action):
        if self.dispatcher.IsDisposed:
            return
        if self.dispatcher.InvokeRequired:
            self.dispatcher.BeginInvoke(self.net.Action(action))
        else:
            action()

    def update(self, snapshot, target):
        with self.lock:
            if self.closed:
                return
            self.latest = snapshot, target
            if self.pending:
                return
            self.pending = True
        try:
            self._post(self._flush)
        except Exception:
            with self.lock:
                self.pending = False

    def _flush(self):
        with self.lock:
            self.pending = False
            if self.closed:
                return
            snapshot, target = self.latest
        if self.error and snapshot['state'] == 'running':
            return
        try:
            self._render(snapshot, target)
            self.error = ''
        except Exception as error:
            self.error = type(getattr(error, 'InnerException', None) or error).__name__
            self._destroy()

    def _create(self):
        n = self.net
        self.form = form = n.Activator.CreateInstance(n.PassiveOverlay)
        form.Text = 'Brivany · Juego'
        form.FormBorderStyle = getattr(n.FormBorderStyle, 'None')
        form.StartPosition = n.FormStartPosition.Manual
        form.AutoScaleMode = getattr(n.AutoScaleMode, 'None')
        form.ShowInTaskbar = False
        form.TopMost = True
        form.Opacity = .97
        form.BackColor = n.Color.FromArgb(14, 15, 18)
        from .typography import brand_font
        self.font = brand_font(9,500)
        for index in range(5):
            label = n.Label()
            label.Font = self.font
            label.TextAlign = n.ContentAlignment.MiddleCenter
            label.ForeColor = n.Color.FromArgb(*(158, 200, 255) if index == 0 else (231, 235, 241))
            form.Controls.Add(label)
            self.labels.append(label)

    def _render(self, snapshot, target):
        n = self.net
        if snapshot['state'] != 'running':
            self._destroy()
            return
        screen = n.Screen.PrimaryScreen
        if target:
            active = self.user.GetForegroundWindow()
            pid = W.DWORD()
            if active:
                self.user.GetWindowThreadProcessId(active, ctypes.byref(pid))
            if pid.value != target['pid']:
                if self.form and self.form.Visible:
                    self.form.Hide()
                return
            from System import IntPtr
            screen = n.Screen.FromHandle(IntPtr(int(active)))
        if not self.form:
            self._create()
        form = self.form
        scale = max(1, float(form.DeviceDpi) / 96)
        width, height = round(340 * scale), round(28 * scale)
        if form.ClientSize.Width != width or form.ClientSize.Height != height:
            form.ClientSize = n.Size(width, height)
            if self.region:
                self.region.Dispose()
            path = n.GraphicsPath()
            path.AddArc(0, 0, height, height, 90, 180)
            path.AddArc(width - height - 1, 0, height, height, 270, 180)
            path.CloseFigure()
            self.region = n.Region(path)
            form.Region = self.region
            path.Dispose()
            for index, label in enumerate(self.labels):
                label.SetBounds(round(index * 68 * scale), 0, round(68 * scale), height)
        bounds = screen.WorkingArea
        point = n.Point(bounds.Left + (bounds.Width - width) // 2, bounds.Top + round(46 * scale))
        if form.Location != point:
            form.Location = point
        texts = []
        for name in ('fps', 'cpu', 'gpu', 'ram'):
            value = snapshot[name]
            formatted = '—' if value is None else f'{value}{"" if name == "fps" else "%"}'
            texts.append(f'{name.upper()} {formatted}')
        texts.append(str(n.DateTime.Now.ToString('HH:mm')))
        for label, title in zip(self.labels, texts):
            if label.Text != title:
                label.Text = title
        if not form.Visible:
            form.Show()

    def _destroy(self):
        if self.form:
            self.form.Dispose()
        for item in (self.font, self.region):
            if item:
                item.Dispose()
        self.form = self.font = self.region = None
        self.labels.clear()

    def close(self):
        with self.lock:
            self.closed = True
            self.latest = None
        try:
            self._post(self._destroy)
        except Exception:
            pass
