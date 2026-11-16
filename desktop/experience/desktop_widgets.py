"""Native widget bridge; only the shared model is allocated until explicit Pin."""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH
import atexit
import json
import os
from pathlib import Path
import threading

from .scripts import post_script
from .widget_state import WidgetState, KINDS, source

ROOT = Path(__file__).resolve().parents[2]


def appearance(value):
    if not isinstance(value, dict):
        raise ValueError('Aspecto de widget no válido.')
    result = {'theme':'dark','accent':'blue','size':'normal','motion':True,'economy':True}
    for name, choices in {'theme':{'dark','soft'},'accent':{'blue','mint','amber','rose'},'size':{'compact','normal','large'}}.items():
        selected = value.get(name,result[name])
        if not isinstance(selected,str) or selected not in choices:
            raise ValueError('Aspecto de widget no válido.')
        result[name]=selected
    for name in ('motion','economy'):
        selected=value.get(name,True)
        if type(selected) is not bool:
            raise ValueError('Preferencia de widget no válida.')
        result[name]=selected
    return result


class DesktopWidgets:
    def __init__(self, path=None, *, dispatcher=None, publish=None, host_factory=None):
        self.lock=threading.RLock();self.closed=False;self.host=None
        self.dispatcher=dispatcher or (lambda:None)
        self.publish=publish or (lambda value:None)
        self.host_factory=host_factory
        self.appearance=appearance({})
        self.model=WidgetState(path or DATA_ROOT/'.local'/'widgets'/'state.json',publish=self._changed)

    def available(self):
        return bool(os.name=='nt' and self.dispatcher() is not None)

    def snapshot(self, value=None):
        result=value or self.model.snapshot()
        result={**result,'native_available':self.available(),'windows':self.host.metadata()['windows'] if self.host else []}
        if self.host and self.host.error:result['error']=self.host.error
        return result

    @staticmethod
    def for_editor(value, editor):
        source(editor);result=dict(value)
        result['drafts']={editor:value['drafts'][editor]} if editor in value['drafts'] else {}
        result.pop('positions',None)
        return result

    def _changed(self, value=None):
        with self.lock:
            if self.closed:return
            state=self.snapshot(value);host=self.host
        if host:host.receive(state,self.appearance)
        try:self.publish(state)
        except Exception:pass

    def connect(self, legacy, preferences, editor):
        source(editor);self.preferences(preferences)
        return self.for_editor(self.snapshot(self.model.connect(legacy)),editor)

    def preferences(self, value):
        selected=appearance(value)
        with self.lock:
            if self.closed:raise ValueError('Los widgets se están cerrando.')
            changed=selected!=self.appearance;self.appearance=selected
        if changed:self._changed()
        return {'ok':True}

    def open(self, kind):
        if not isinstance(kind,str) or kind not in KINDS:
            raise ValueError('Ese widget no se puede separar.')
        with self.lock:
            if self.closed:raise ValueError('Los widgets se están cerrando.')
            if not self.available():raise ValueError('Los widgets de escritorio necesitan Brivany en Windows.')
            if not self.model.snapshot()['initialized']:raise ValueError('Abre primero las herramientas de WorkSpace.')
            if self.host is None:
                factory=self.host_factory
                if factory is None:
                    from .native_widgets import NativeWidgets
                    factory=NativeWidgets
                self.host=factory(self.dispatcher(),self.model,changed=self._changed,appearance=self.appearance)
            return self.host.open(kind)

    def close_windows(self):
        with self.lock:
            if self.host:self.host.close_all()
        return {'ok':True}

    def settings(self, topmost=None):
        value=self.model.settings(topmost)
        return {'native_available':self.available(),'topmost':value['topmost'],
                'windows':self.host.metadata()['windows'] if self.host else []}

    def close(self):
        with self.lock:
            if self.closed:return
            self.closed=True
            if self.host:self.host.close_all(permanent=True)
        self.model.close()


class DesktopWidgetsBridge:
    _desktop_widgets_lock=threading.RLock()

    def _desktop_widgets(self):
        with self._desktop_widgets_lock:
            if getattr(self,'_exit_requested',False):raise ValueError('Brivany se está cerrando.')
            if not getattr(self,'_desktop_widget_service',None):
                self._desktop_widget_service=DesktopWidgets(
                    dispatcher=lambda:getattr(getattr(self,'_window',None),'native',None),publish=self._publish_desktop_widgets)
                atexit.register(self._desktop_widget_service.close)
            return self._desktop_widget_service

    def _publish_desktop_widgets(self, value):
        for name,editor in (('_bar_window','workspace-bar'),('_work_window','workspace-panel')):
            window=getattr(self,name,None)
            if window:
                data=DesktopWidgets.for_editor(value,editor)
                post_script(window,'window.BrivanyDesktopWidgets?.receive('+json.dumps(data,ensure_ascii=True)+')','desktop-widgets')

    def _close_desktop_widgets(self):
        value=getattr(self,'_desktop_widget_service',None)
        if value:value.close()

    def workspace_desktop_widgets_connect(self, legacy, preferences, editor):
        self._trusted();return self._desktop_widgets().connect(legacy,preferences,editor)

    def workspace_desktop_widget_open(self, kind):
        self._trusted();return self._desktop_widgets().open(kind)

    def workspace_desktop_widget_timer(self, action, duration, editor):
        self._trusted();source(editor)
        value=self._desktop_widgets();return value.for_editor(value.snapshot(value.model.timer_action(action,duration)),editor)

    def workspace_desktop_widget_note(self, value, expected, editor, force=False):
        self._trusted();source(editor);service=self._desktop_widgets()
        result=service.model.update_note(value,expected,editor,force)
        return {**result,'state':service.for_editor(service.snapshot(result['state']),editor)}

    def workspace_desktop_widget_discard(self, editor):
        self._trusted();source(editor);service=self._desktop_widgets()
        return service.for_editor(service.snapshot(service.model.discard_draft(editor)),editor)

    def workspace_desktop_widgets_preferences(self, value):
        self._trusted();return self._desktop_widgets().preferences(value)

    def workspace_desktop_widgets_settings(self, topmost=None):
        self._trusted();return self._desktop_widgets().settings(topmost)

    def workspace_desktop_widgets_close(self):
        self._trusted();return self._desktop_widgets().close_windows()
