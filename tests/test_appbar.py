"""AppBar protocol with substituted shell; no changes to the desktop work area."""
from types import SimpleNamespace
import threading
import unittest
from desktop.experience.appbar import WindowsAppBar,Rect,rect_value


class AppBarTests(unittest.TestCase):
    def fixture(self):
        obj=WindowsAppBar.__new__(WindowsAppBar);obj.handle=77;obj.height=40;obj.scale=1;obj.lock=threading.RLock();obj.closed=False;obj.registered=True;obj.setting=False;obj.previous=123;obj.calls=[];obj.positions=[]
        obj.monitor=lambda:SimpleNamespace(monitor=Rect(0,0,1000,700));obj.on_position=obj.positions.append
        obj.user=SimpleNamespace(MoveWindow=lambda *args:obj.calls.append(('move',args)) or True,IsWindow=lambda handle:True,SetWindowLongPtrW=lambda *args:obj.calls.append(('restore',args)))
        def message(kind,*,rect=None,param=0):
            obj.calls.append(('message',kind));value=Rect(rect.left,rect.top,rect.right,rect.bottom) if rect else Rect()
            if kind==2:value.top=40
            return 1,SimpleNamespace(rc=value)
        obj._message=message;return obj
    def test_query_then_set_respects_another_top_bar_and_uses_fixed_height(self):
        obj=self.fixture();obj.position()
        self.assertEqual([value for kind,value in obj.calls if kind=='message'],[2,3]);self.assertEqual(rect_value(obj.rect),{'left':0,'top':40,'right':1000,'bottom':80});self.assertEqual(obj.calls[-1],('move',(77,0,40,1000,40,True)));self.assertFalse(obj.setting)
    def test_remove_and_restore_owned_window_proc_are_idempotent(self):
        obj=self.fixture();obj.close();obj.close();self.assertEqual(obj.calls,[('message',1),('restore',(77,-4,123))]);self.assertFalse(obj.registered)
    def test_position_after_close_cannot_reregister_or_move_any_window(self):
        obj=self.fixture();obj.close();obj.calls=[];obj.position();self.assertEqual(obj.calls,[])
    def test_logical_bar_height_tracks_window_dpi(self):
        obj=self.fixture();obj.user.GetDpiForWindow=lambda handle:144;obj.position();self.assertEqual(obj.rect.bottom-obj.rect.top,60);self.assertEqual(obj.positions[0]['scale'],1.5)
    def test_native_callback_can_reenter_state_without_a_cross_thread_mutex_cycle(self):
        obj=self.fixture();acquired=[]
        def move(*args):
            def callback():
                ok=obj.lock.acquire(timeout=.2);acquired.append(ok)
                if ok:obj.lock.release()
            thread=threading.Thread(target=callback);thread.start();thread.join(1);return True
        obj.user.MoveWindow=move;obj.position();self.assertEqual(acquired,[True])


if __name__=='__main__':unittest.main()
