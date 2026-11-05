"""Post UI notifications without waiting on WebView2's STA message pump."""
import json
import sys
import threading

_lock=threading.Lock()
_pending={}

def post_script(window,script,key='state'):
    native=getattr(window,'native',None)
    if sys.platform!='win32' or native is None or not hasattr(native,'BeginInvoke'):
        window.evaluate_js(script);return True
    from System import Action
    identity=(id(window),key)
    with _lock:
        scheduled=identity in _pending;_pending[identity]=script
    if scheduled:return True
    def run():
        with _lock:value=_pending.pop(identity,None)
        if value is not None:
            try:native.webview.ExecuteScriptAsync(value)
            except Exception:pass
    try:native.BeginInvoke(Action(run));return True
    except Exception:
        with _lock:_pending.pop(identity,None)
        return False

def evaluate_script(window,script,timeout=1.2):
    """Only paint acknowledgments need a result; never wait indefinitely."""
    native=getattr(window,'native',None)
    if sys.platform!='win32' or native is None or not hasattr(native,'BeginInvoke'):return window.evaluate_js(script)
    if not native.InvokeRequired:return None
    from System import Action,String
    from System.Threading.Tasks import Task
    done=threading.Event();result=[None]
    def completed(task):
        try:result[0]=json.loads(task.Result)
        except Exception:pass
        finally:done.set()
    def run():
        if done.is_set():return
        try:native.webview.ExecuteScriptAsync(script).ContinueWith(Action[Task[String]](completed))
        except Exception:done.set()
    try:native.BeginInvoke(Action(run))
    except Exception:return None
    if not done.wait(timeout):done.set();return None
    return result[0]
