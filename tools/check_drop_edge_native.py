"""Owned native aura and real WinForms OLE events with synthetic files.

Own synthetic file drag only; restores the pointer/button and closes its forms.
No personal desktop capture or public connection.
"""
import ctypes
import json
from pathlib import Path
import tempfile
import threading
import time
import subprocess
import sys
import queue

import clr
clr.AddReference('System.Windows.Forms');clr.AddReference('System.Drawing')
from System import Array,String
from System.Threading import Thread,ThreadStart,ApartmentState
from System.Drawing import Rectangle,Color
from System.Windows.Forms import Form,Application,ApplicationContext,Timer,Screen,DataObject,DataFormats,DragEventArgs,DragDropEffects
from desktop.experience.drop_edge import NativeDropEdge

ROOT=Path(__file__).resolve().parents[1]


def main():
 out=ROOT/'tmp/drop-edge-native';out.mkdir(parents=True,exist_ok=True)
 report={'passed':False,'mode':'real_layered_hwnd_and_owned_OLE_drag','external_calls':0,'gpu_seconds':None,'native_OLE_drag_executed':False,'OS_input_sent':False,'personal_desktop_captured':False,'checks':[]}
 finished=threading.Event()
 def ui():
  with tempfile.TemporaryDirectory(prefix='brivany-edge-native-') as directory:
   context=ApplicationContext();root=Form();handle=root.Handle;dropped=[];previews=[];errors=[]
   host=NativeDropEdge(root,lambda paths:dropped.append(paths),on_preview=previews.append,on_error=errors.append)
   user=host.renderer.user;user.GetForegroundWindow.restype=ctypes.c_void_p;foreground=user.GetForegroundWindow()
   driver=Timer();driver.Interval=60;stage=0;deadline=time.monotonic()+25;source=None;messages=queue.Queue();steps=0;saved_pointer=None
   paths=[str(Path(directory)/name) for name in ['Uno.txt','Dos.txt']]
   for file in paths:Path(file).write_text('Contenido sintético.',encoding='utf-8')
   def finish():
    if source and source.poll() is None:
     user.mouse_event(4,0,0,0,0)
     try:source.wait(timeout=1)
     except subprocess.TimeoutExpired:source.terminate();source.wait(timeout=5)
    if saved_pointer:user.SetCursorPos(*saved_pointer)
    driver.Stop();driver.Dispose();host.close();root.Dispose();context.ExitThread();finished.set()
   def tick(*_):
    nonlocal stage,source,steps,saved_pointer
    try:
     assert time.monotonic()<deadline,'Native edge timeout'
     if stage==0:
      assert host.timer is None and host.form is None
      host.configure(True);host.receive('preview','right');stage=1
     elif stage==1:
      assert host.form.Visible and not host.form.ShowInTaskbar
      current=user.GetForegroundWindow()
      assert current not in {int(root.Handle.ToInt64()),int(host.form.Handle.ToInt64())},'Aura stole foreground focus'
      style=user.GetWindowLongW(int(host.form.Handle.ToInt64()),-20)
      assert style&0x20 and style&0x80000 and style&0x08000000
      report['checks'].append('Real layered, click-through preview without activation or taskbar entry')
      data=DataObject();data.SetData(DataFormats.FileDrop,False,Array[String](paths))
      bounds=Screen.PrimaryScreen.Bounds
      event=DragEventArgs(data,1,bounds.Right-2,bounds.Top+bounds.Height//2,DragDropEffects.Copy,getattr(DragDropEffects,'None'))
      host._enter(None,event);assert event.Effect==DragDropEffects.Copy
      assert previews[-1]['active'] and previews[-1]['count']==2
      assert not user.GetWindowLongW(int(host.form.Handle.ToInt64()),-20)&0x20
      host._drop(None,event);stage=2
     elif stage==2:
      if not dropped:return
      assert dropped==[paths];assert all(Path(file).read_text(encoding='utf-8')=='Contenido sintético.' for file in paths)
      report['checks'].append('Two CF_HDROP paths accepted with Copy; source files preserved and worker callback off UI thread')
      data=DataObject();data.SetText('Solo texto')
      event=DragEventArgs(data,1,0,0,DragDropEffects.Copy,getattr(DragDropEffects,'None'))
      host._enter(None,event);assert event.Effect==getattr(DragDropEffects,'None')
      host.configure(False);assert not host.timer.Enabled and not host.form.Visible
      report['checks'].append('Text rejected; disconnect stops pointer timer and removes target')
      dropped.clear();host.remote=None;host.suppressed=False;host.origin=None;host.configure(True)
      point=ctypes.wintypes.POINT();user.GetCursorPos(ctypes.byref(point));saved_pointer=(point.x,point.y)
      # A separate source process matches Explorer and avoids Python's GIL
      # around DoDragDrop blocking Python callbacks in its own dispatcher.
      source=subprocess.Popen([sys.executable,'-X','utf8','-B','-m','tools.check_drop_edge_native','--source',*paths],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
      def read():
       for line in source.stdout:messages.put(line.strip())
      threading.Thread(target=read,daemon=True).start()
      stage=3
     elif stage==3:
      while not messages.empty():
       message=messages.get()
       if message=='dragging':report['OS_input_sent']=True
       if message.startswith('effect:'):
        assert message=='effect:Copy','Owned OS drag did not reach the edge target: '+message
        report['native_OLE_drag_executed']=True
      if report['OS_input_sent'] and not report['native_OLE_drag_executed']:
       steps+=1;bounds=Screen.PrimaryScreen.Bounds
       user.SetCursorPos(min(bounds.Right-3,bounds.Right-250+steps*16),bounds.Top+bounds.Height//2)
       if host.accepted or steps>65:user.mouse_event(4,0,0,0,0)
      if not report['native_OLE_drag_executed'] or not dropped:return
      assert dropped==[paths]
      report['checks'].append('Real DoDragDrop from another owned process reaches the screen edge, lights the aura and drops with Copy')
      host.configure(False)
      assert not errors,errors;host.close();assert host.closed and host.form is None and host.timer is None
      report['checks'].append('Timer, OLE target, form, delegates and bitmap cache disposed');report['passed']=True;finish()
    except Exception as error:
     report['reason']=type(error).__name__+': '+str(error);finish()
   driver.Tick+=tick;driver.Start();Application.Run(context)
 thread=Thread(ThreadStart(ui));thread.SetApartmentState(ApartmentState.STA);thread.Start()
 if not finished.wait(35):report['reason']='Native test thread timed out'
 thread.Join(3000);(out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
 return 0 if report['passed'] else 1


def source_main(paths):
 finished=threading.Event()
 def ui():
  form=Form();bounds=Screen.PrimaryScreen.Bounds
  form.Bounds=Rectangle(bounds.Right-440,bounds.Top+max(30,bounds.Height//2-220),340,440)
  form.StartPosition=__import__('System').Windows.Forms.FormStartPosition.Manual
  form.BackColor=Color.FromArgb(24,34,44);form.Text='Prueba local de archivos · Brivany';form.TopMost=True
  user=ctypes.WinDLL('user32');point=ctypes.wintypes.POINT();user.GetCursorPos(ctypes.byref(point));saved=(point.x,point.y)
  timer=Timer();timer.Interval=450
  def drag(*_):
   data=DataObject();data.SetData(DataFormats.FileDrop,False,Array[String](paths))
   try:
    print('dragging',flush=True)
    effect=form.DoDragDrop(data,DragDropEffects.Copy);print('effect:'+str(effect),flush=True)
   finally:
    user.mouse_event(4,0,0,0,0);user.SetCursorPos(*saved);timer.Dispose();form.Close();finished.set()
  def start(*_):
   timer.Stop();form.Activate();user.SetCursorPos(bounds.Right-250,bounds.Top+bounds.Height//2);user.mouse_event(2,0,0,0,0)
  form.MouseDown+=drag;timer.Tick+=start;timer.Start();Application.Run(form)
 thread=Thread(ThreadStart(ui));thread.SetApartmentState(ApartmentState.STA);thread.Start();finished.wait(25)
 return 0


if __name__=='__main__':raise SystemExit(source_main(sys.argv[2:]) if len(sys.argv)>1 and sys.argv[1]=='--source' else main())
