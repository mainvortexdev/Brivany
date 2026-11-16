"""Pure geometry/pixels and native-only path ingress with a simulated relay."""
import unittest
from unittest.mock import Mock
from desktop.experience.drop_edge import nearest_edge,aura_pixels
from desktop.experience.workspace_phone import WorkspacePhoneBridge
from desktop.experience.workspace_files import WorkspaceFilesBridge
from tests import test_drop_transfer as fixtures


class EdgeGeometryTests(unittest.TestCase):
 def test_edges_support_negative_monitor_origins_and_do_not_match_interior(self):
  bounds=(-1920,-80,1920,1080)
  self.assertEqual(nearest_edge(bounds,-1918,400),'left')
  self.assertEqual(nearest_edge(bounds,-2,400),'right')
  self.assertEqual(nearest_edge(bounds,-900,-79),'top')
  self.assertEqual(nearest_edge(bounds,-900,999),'bottom')
  self.assertIsNone(nearest_edge(bounds,-900,400));self.assertIsNone(nearest_edge(bounds,0,400))
 def test_aura_is_premultiplied_and_target_has_no_opaque_rectangle(self):
  for edge in ['left','right','top','bottom']:
   pixels=aura_pixels(70,80,edge)
   self.assertEqual(len(pixels),70*80*4)
   self.assertTrue(all(max(pixels[index:index+3])<=pixels[index+3] for index in range(0,len(pixels),4)))
   self.assertGreater(max(pixels[3::4]),50);self.assertLess(max(pixels[3::4]),255)
  invisible=aura_pixels(10,20,'right',False);self.assertEqual(set(invisible[3::4]),{1})


class EdgeBridgeTests(unittest.TestCase):
 setUp=fixtures.DropTests.setUp
 source=fixtures.DropTests.source
 def test_native_batch_validates_paths_without_copying_to_shelf(self):
  class Bridge(WorkspacePhoneBridge,WorkspaceFilesBridge):
   def _trusted(self):pass
  bridge=Bridge();bridge._workspace_file_transfer=self.drop
  _,item=self.source(1024);session=self.drop.share_path()['session']['id'];self.drop.update(session,{'state':'connected'})
  value=bridge._queue_phone_paths([str(item['path']),str(item['path'])]);self.assertEqual(value['queued'],2)
  self.assertEqual(bridge._file_shelf().snapshot()['items'],[]);self.drop.clear_outbox(session)
  directory=self.root/'carpeta';directory.mkdir()
  with self.assertRaises(ValueError):bridge._queue_phone_paths([str(item['path']),str(directory)])
  self.assertIsNone(self.drop.source)
 def test_remote_edge_requires_live_session_and_known_states(self):
  class Bridge(WorkspacePhoneBridge):
   def _trusted(self):pass
  bridge=Bridge();bridge._workspace_file_transfer=self.drop;bridge._phone_edge_host=Mock()
  session=self.drop.share_path()['session']['id'];self.drop.update(session,{'state':'connected'})
  bridge.workspace_phone_edge(session,{'state':'preview','edge':'right'});bridge._phone_edge_host.receive.assert_called_once_with('preview','right')
  with self.assertRaises(ValueError):bridge.workspace_phone_edge('stale',{'state':'preview'})
  with self.assertRaises(ValueError):bridge.workspace_phone_edge(session,{'state':'run command'})


if __name__=='__main__':unittest.main()
