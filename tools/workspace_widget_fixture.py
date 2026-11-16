"""Private stdio fixture, production state and bridge, substituted native windows.

Protocol payloads stay on the pipe; the browser verifier emits only metadata.
"""
import json
from pathlib import Path
import sys
import tempfile
import threading

from desktop.experience.desktop_widgets import DesktopWidgets, DesktopWidgetsBridge


class FixtureHost:
    def __init__(self,dispatcher,model,changed,appearance):
        self.error='';self.windows=set();self.changed=changed
    def metadata(self):return {'windows':sorted(self.windows)}
    def open(self,kind):self.windows.add(kind);self.changed();return {'queued':True}
    def receive(self,*_):pass
    def close_all(self,permanent=False):self.windows.clear();self.changed()


def main():
    output_lock=threading.Lock()
    def emit(value):
        with output_lock:sys.stdout.write(json.dumps(value,ensure_ascii=True)+'\n');sys.stdout.flush()
    def publish(value):
        emit({'event':'state','views':{editor:DesktopWidgets.for_editor(value,editor) for editor in ('workspace-bar','workspace-panel')}})
    with tempfile.TemporaryDirectory(prefix='brivany-widget-ui-') as directory:
        service=DesktopWidgets(Path(directory)/'state.json',dispatcher=lambda:object(),publish=publish,host_factory=FixtureHost)
        bridge=DesktopWidgetsBridge();bridge._trusted=lambda:None;bridge._desktop_widget_service=service
        methods={name:getattr(bridge,name) for name in dir(bridge) if name.startswith('workspace_desktop_')}
        emit({'ready':True})
        try:
            for line in sys.stdin:
                message=json.loads(line);identity=message['id'];method=message['method']
                try:
                    if method=='stop':emit({'id':identity,'value':True});break
                    if method=='inspect':value=service.snapshot()
                    elif method=='native_edit':value=service.model.update_note(message['args'][0],message['args'][1],'native-notes')
                    elif method=='native_timer':value=service.model.timer_action(*message['args'])
                    else:value=methods[method](*message.get('args',[]))
                    emit({'id':identity,'value':value})
                except (KeyError,ValueError,OSError) as error:
                    emit({'id':identity,'error':str(error)})
        finally:service.close()


if __name__=='__main__':main()
