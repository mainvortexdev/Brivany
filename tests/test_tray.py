"""Tray ownership contract with substituted .NET components, no OS interaction."""
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from desktop.experience.tray import SystemTray


class Event:
    def __init__(self):self.handlers=[]
    def __iadd__(self,handler):self.handlers.append(handler);return self


class Component:
    def __init__(self,*args):self.args=args;self.disposed=0
    def Dispose(self):self.disposed+=1


class Menu(Component):
    def __init__(self):super().__init__();self.values=[];self.Items=SimpleNamespace(Add=self.values.append)


class Item(Component):
    def __init__(self,*args):super().__init__(*args);self.Click=Event()


class Icon(Component):
    def __init__(self):super().__init__();self.DoubleClick=Event();self.Visible=False


class TrayTests(unittest.TestCase):
    def test_single_icon_owns_menu_dispatch_and_cleanup_and_never_runs_closed_actions(self):
        native=SimpleNamespace(IsDisposed=False,InvokeRequired=False)
        opened=threading.Event();tray=SystemTray(SimpleNamespace(native=native),'fixture.ico',on_open=opened.set,on_workspace=lambda:None,on_exit=lambda:None)
        modules={'System':SimpleNamespace(Action=lambda value:value),'System.Drawing':SimpleNamespace(Icon=Component),
                 'System.Windows.Forms':SimpleNamespace(NotifyIcon=Icon,ContextMenuStrip=Menu,ToolStripMenuItem=Item,ToolStripSeparator=Component)}
        with patch.object(sys,'platform','win32'),patch.dict(sys.modules,modules):
            self.assertTrue(tray.start());icon=tray.icon;menu=tray.menu;image=tray.image
            self.assertEqual(icon.Text,'Brivany');self.assertTrue(icon.Visible);self.assertIs(native.Icon,image)
            self.assertTrue(tray.start());self.assertIs(tray.icon,icon);self.assertEqual(len(menu.values),4)
            tray.dispatch('open');self.assertTrue(opened.wait(2))
            tray.close();self.assertFalse(icon.Visible);self.assertFalse(tray.active)
            self.assertEqual([icon.disposed,menu.disposed,image.disposed],[1,1,1])
            tray.close();self.assertEqual(icon.disposed,1)
            opened.clear();tray.dispatch('open');self.assertFalse(opened.wait(.02))

    def test_unsupported_platform_does_not_import_windows_or_activate_a_tray(self):
        tray=SystemTray(None,'fixture.ico',on_open=lambda:None,on_workspace=lambda:None,on_exit=lambda:None)
        with patch.object(sys,'platform','linux'):
            self.assertFalse(tray.start());self.assertFalse(tray.status()['active']);tray.close()
