"""Borderless maximization uses the current monitor's work area, in native pixels."""
import sys


def relative_work_area(bounds,work):
 return (work[0]-bounds[0],work[1]-bounds[1],work[2],work[3])


def install(window):
 if sys.platform!='win32':return False
 from System import Action
 from System.Drawing import Rectangle
 from System.Windows.Forms import Screen
 native=window.native
 def refresh(*_):
  screen=Screen.FromHandle(native.Handle);b=screen.Bounds;w=screen.WorkingArea
  x,y,width,height=relative_work_area((b.X,b.Y,b.Width,b.Height),(w.X,w.Y,w.Width,w.Height))
  target=Rectangle(x,y,width,height)
  if native.MaximizedBounds!=target:native.MaximizedBounds=target
 def apply():
  refresh()
  # Retain handlers with the owning window; no timer or global window hooks.
  native.LocationChanged+=refresh
  native.SizeChanged+=refresh
  window._work_area_handler=refresh
 native.Invoke(Action(apply))
 return True


def set_maximized(window,value):
 if sys.platform!='win32':
  (window.maximize if value else window.restore)();return
 from System import Action
 from System.Windows.Forms import FormWindowState
 if not hasattr(window,'_work_area_handler'):install(window)
 def apply():
  window._work_area_handler()
  window.native.WindowState=FormWindowState.Maximized if value else FormWindowState.Normal
 window.native.Invoke(Action(apply))


def geometry(window):
 """Own-window diagnostics used by the native release smoke test."""
 from System import Action
 from System.Windows.Forms import Screen
 value={}
 def read():
  native=window.native;bounds=native.Bounds;work=Screen.FromHandle(native.Handle).WorkingArea
  value.update(bounds=[bounds.X,bounds.Y,bounds.Width,bounds.Height],work_area=[work.X,work.Y,work.Width,work.Height],maximized=str(native.WindowState)=='Maximized')
  value['inside_work_area']=bounds.Left>=work.Left and bounds.Top>=work.Top and bounds.Right<=work.Right and bounds.Bottom<=work.Bottom
 window.native.Invoke(Action(read));return value
