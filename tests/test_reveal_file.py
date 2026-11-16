import ctypes
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from desktop.experience.reveal_file import reveal_file


class Function:
 def __init__(self,callback):self.callback=callback;self.calls=[]
 def __call__(self,*args):self.calls.append(args);return self.callback(*args)


class RevealTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=Path(self.temp.name)/'Vídeo, prueba con espacios.mp4';self.path.write_bytes(b'fixture')
  def parse(name,context,out,flags,attrs):out._obj.value=1234;return 0
  self.ole=SimpleNamespace(CoInitializeEx=Function(lambda *a:0),CoTaskMemFree=Function(lambda *a:None),CoUninitialize=Function(lambda:None))
  self.shell=SimpleNamespace(SHParseDisplayName=Function(parse),SHOpenFolderAndSelectItems=Function(lambda *a:0))
 def call(self):
  with patch('desktop.experience.reveal_file.sys.platform','win32'),patch('ctypes.WinDLL',side_effect=lambda name:self.ole if name=='ole32' else self.shell):return reveal_file(self.path)
 def test_unicode_and_spaces_use_item_id_not_command_line(self):
  self.assertTrue(self.call()['selection_requested']);self.assertEqual(self.shell.SHParseDisplayName.calls[0][0],str(self.path));self.assertEqual(self.shell.SHOpenFolderAndSelectItems.calls[0][1:],(0,None,0));self.assertEqual(len(self.ole.CoTaskMemFree.calls),1);self.assertEqual(len(self.ole.CoUninitialize.calls),1)
 def test_failure_releases_pidl_and_reports_no_success(self):
  self.shell.SHOpenFolderAndSelectItems.callback=lambda *a:-2147467259
  with self.assertRaises(OSError):self.call()
  self.assertEqual(len(self.ole.CoTaskMemFree.calls),1);self.assertEqual(len(self.ole.CoUninitialize.calls),1)
 def test_existing_mta_is_not_uninitialized(self):
  self.ole.CoInitializeEx.callback=lambda *a:-2147417850;self.assertTrue(self.call()['ok']);self.assertEqual(self.ole.CoUninitialize.calls,[])
 def test_parse_failure_never_opens_explorer(self):
  self.shell.SHParseDisplayName.callback=lambda *a:-2147467259
  with self.assertRaises(OSError):self.call()
  self.assertEqual(self.shell.SHOpenFolderAndSelectItems.calls,[]);self.assertEqual(len(self.ole.CoUninitialize.calls),1)
 def test_nonexistent_file_is_rejected_before_native_action(self):
  self.path.unlink()
  with self.assertRaises(ValueError):self.call()
  self.assertEqual(self.ole.CoInitializeEx.calls,[])
