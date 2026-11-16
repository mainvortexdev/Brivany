"""Local service/bridge lifecycle with a substituted native dispatcher/host."""
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from desktop.experience.desktop_widgets import DesktopWidgets, DesktopWidgetsBridge, appearance


class Host:
    def __init__(self, dispatcher, model, changed, appearance):
        self.model=model; self.changed=changed; self.error='';self.windows=set();self.closed=False;self.received=[]
    def open(self, kind): self.windows.add(kind);self.changed();return {'queued':True}
    def metadata(self):return {'windows':sorted(self.windows)}
    def receive(self, value, appearance):self.received.append((value,appearance))
    def close_all(self, permanent=False):self.windows.clear();self.closed=permanent


class ServiceTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.events=[]
        self.factory=Mock(side_effect=Host)
        self.service=DesktopWidgets(Path(temp.name)/'widgets.json',dispatcher=lambda:object(),publish=self.events.append,host_factory=self.factory)
        self.addCleanup(self.service.close)

    def connect(self, editor='workspace-panel'):
        return self.service.connect({'note':'Own synthetic note.','timer':None},{},editor)

    def test_native_host_is_lazy_and_reused_for_three_widgets(self):
        self.assertIsNone(self.service.host);self.connect();self.factory.assert_not_called()
        for kind in ('clock','notes','timer','notes'):self.service.open(kind)
        self.factory.assert_called_once();self.assertEqual(self.service.snapshot()['windows'],['clock','notes','timer'])
        self.service.close_windows();self.assertEqual(self.service.snapshot()['windows'],[])
        self.service.open('clock');self.factory.assert_called_once()

    def test_editor_only_receives_its_own_conflict_draft(self):
        first=self.connect();self.service.model.update_note('Own native note.',first['note_revision'],'native-notes')
        self.service.model.update_note('Own panel draft.',first['note_revision'],'workspace-panel')
        self.service.model.update_note('Own bar draft.',first['note_revision'],'workspace-bar')
        self.service.model.position('notes',{'x':12,'y':24})
        value=self.service.for_editor(self.service.snapshot(),'workspace-panel')
        self.assertEqual(list(value['drafts']),['workspace-panel']);self.assertNotIn('positions',value)
        self.assertEqual(self.service.for_editor(self.service.snapshot(),'native-notes')['drafts'],{})

    def test_settings_and_appearance_do_not_modify_note_or_deadline(self):
        self.connect();self.service.model.timer_action('start',2000);self.service.open('timer')
        before=self.service.snapshot();self.service.preferences({'theme':'soft','accent':'mint','size':'large'});self.service.settings(True)
        after=self.service.snapshot();self.assertEqual(after['note'],before['note']);self.assertEqual(after['timer'],before['timer'])
        self.assertTrue(after['topmost']);self.assertEqual(self.service.host.received[-1][1]['accent'],'mint')

    def test_close_stops_host_flushes_state_and_rejects_new_actions(self):
        self.connect();self.service.open('notes');host=self.service.host;self.service.close()
        self.assertTrue(host.closed);self.assertIsNone(self.service.model.alarm)
        self.assertTrue(self.service.model.path.is_file())
        with self.assertRaises(ValueError):self.service.open('clock')
        with self.assertRaises(ValueError):self.service.preferences({})

    def test_strict_appearance_kind_and_editor(self):
        for value in (None,{'theme':[]},{'accent':'url(bad)'},{'economy':1},{'size':'x'}):
            with self.assertRaises(ValueError):appearance(value)
        for kind in ('calculator','unknown',{}):
            with self.assertRaises(ValueError):self.service.open(kind)
        with self.assertRaises(ValueError):self.connect('unknown')
        self.factory.assert_not_called()

    def test_no_dispatcher_cannot_create_native_windows(self):
        self.service.dispatcher=lambda:None;self.connect()
        with self.assertRaises(ValueError):self.service.open('clock')
        self.assertFalse(self.service.settings()['native_available']);self.factory.assert_not_called()


class BridgeTests(unittest.TestCase):
    def test_every_entry_rejects_before_service_creation(self):
        bridge=DesktopWidgetsBridge();bridge._trusted=Mock(side_effect=ValueError('foreign origin'))
        for name,args in (
            ('workspace_desktop_widgets_connect',({}, {},'workspace-panel')),('workspace_desktop_widget_open',('clock',)),
            ('workspace_desktop_widget_timer',('start',1000,'workspace-bar')),('workspace_desktop_widget_note',('own',0,'native-notes')),
            ('workspace_desktop_widget_discard',('workspace-panel',)),('workspace_desktop_widgets_preferences',({},)),
            ('workspace_desktop_widgets_settings',()),('workspace_desktop_widgets_close',())):
            with self.subTest(method=name),self.assertRaises(ValueError):getattr(bridge,name)(*args)
        self.assertFalse(hasattr(bridge,'_desktop_widget_service'))

    def test_unopened_shutdown_is_noop_and_exit_cannot_reopen(self):
        bridge=DesktopWidgetsBridge();bridge._close_desktop_widgets();bridge._exit_requested=True
        with self.assertRaises(ValueError):bridge._desktop_widgets()
        self.assertFalse(hasattr(bridge,'_desktop_widget_service'))

    def test_publisher_filters_each_native_view(self):
        bridge=DesktopWidgetsBridge();bridge._bar_window=SimpleNamespace();bridge._work_window=SimpleNamespace()
        value={'drafts':{'workspace-bar':{'text':'own bar'},'workspace-panel':{'text':'own panel'}},'positions':{}}
        with patch('desktop.experience.desktop_widgets.post_script') as post:
            bridge._publish_desktop_widgets(value)
        self.assertEqual(post.call_count,2)
        self.assertNotIn('own panel',post.call_args_list[0].args[1]);self.assertNotIn('own bar',post.call_args_list[1].args[1])


if __name__=='__main__':unittest.main()
