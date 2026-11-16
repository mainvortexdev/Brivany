"""Scoped Windows UI Automation for an explicitly calibrated WhatsApp client.

No coordinate clicks, keyboard shortcuts, message sending or account migration.
Missing/ambiguous controls and a destination mismatch stop before Invoke().
"""
from contextlib import contextmanager
from functools import lru_cache
import ctypes
import os
from pathlib import Path
import re
import sys
import time

from .common import TelephonyError, number


@lru_cache(maxsize=8)
def desktop_reference(name):
    import clr
    from System.Runtime.InteropServices import RuntimeEnvironment
    # .NET Framework's WPF assemblies are not always in pythonnet's search path.
    assembly = Path(str(RuntimeEnvironment.GetRuntimeDirectory())) / 'WPF' / (name + '.dll')
    clr.AddReference(str(assembly) if assembly.is_file() else name)


def displayed_number(value):
    if not isinstance(value, str) or not re.fullmatch(r'\+?[0-9 ()\-.]{7,35}', value.strip()):
        return None
    digits = re.sub(r'\D', '', value)
    return '+' + digits if 7 <= len(digits) <= 15 else None


class MissingClientControl(TelephonyError):
    pass


@contextmanager
def com_thread():
    initialized = False
    if sys.platform == 'win32':
        initialized = ctypes.windll.ole32.CoInitializeEx(None, 0) in (0, 1)
    try:
        yield
    finally:
        if initialized:
            ctypes.windll.ole32.CoUninitialize()


class WindowsControls:
    def __init__(self, controls):
        self.controls = controls
        self.root = None
        self.global_root = None
        self.process_id = None

    def _types(self):
        desktop_reference('UIAutomationClient'); desktop_reference('UIAutomationTypes')
        from System.Diagnostics import Process
        from System.Windows.Automation import AutomationElement, PropertyCondition, TreeScope, InvokePattern, ValuePattern
        return Process, AutomationElement, PropertyCondition, TreeScope, InvokePattern, ValuePattern

    def attach(self):
        Process, Element, *_ = self._types()
        processes = [p for p in Process.GetProcessesByName('WhatsApp') if p.MainWindowHandle.ToInt64()]
        if len(processes) != 1:
            raise TelephonyError('Abre una única ventana del cliente oficial de WhatsApp.')
        self.process_id = processes[0].Id
        self.root = Element.FromHandle(processes[0].MainWindowHandle)
        self.global_root = Element.RootElement

    def _element(self, key):
        if self.root is None:
            raise TelephonyError('El cliente WhatsApp no está conectado.')
        _, Element, Condition, Scope, *_ = self._types()
        if self.root.Current.ProcessId != self.process_id:
            raise TelephonyError('Cambió la ventana de WhatsApp.')
        condition = Condition(Element.AutomationIdProperty, self.controls[key])
        root = self.root
        if self.global_root is not None:
            from System.Windows.Automation import AndCondition
            condition = AndCondition(condition, Condition(Element.ProcessIdProperty, self.process_id))
            root = self.global_root
        matches = root.FindAll(Scope.Descendants, condition)
        if matches.Count == 0:
            raise MissingClientControl('El control calibrado de WhatsApp no está disponible.')
        if matches.Count != 1 or matches[0].Current.ProcessId != self.process_id:
            raise TelephonyError('El control de WhatsApp cambió o no es único. Revisa su calibración.')
        return matches[0]

    def text(self, key):
        *_, Value = self._types()
        element = self._element(key)
        if element.Current.IsPassword:
            raise TelephonyError('El control de WhatsApp no corresponde al destinatario.')
        # Calibrated recipient/state fields may expose Value or accessible Name.
        try:
            pattern = element.GetCurrentPattern(Value.Pattern)
        except Exception:
            return str(element.Current.Name)
        if key == 'recipient' and not pattern.Current.IsReadOnly:
            raise TelephonyError('El destinatario debe leerse de un campo de solo lectura.')
        return str(pattern.Current.Value)

    def ready_for_call(self):
        try:
            if self._element('hangup').Current.IsEnabled:
                return False
        except MissingClientControl:
            pass
        return bool(self._element('call').Current.IsEnabled)

    def invoke(self, key):
        *_, Invoke, Value = self._types()
        from System.Windows.Automation import ControlType
        element = self._element(key)
        if not element.Current.IsEnabled or element.Current.ControlType != ControlType.Button:
            raise TelephonyError('El control de llamada no está disponible.')
        element.GetCurrentPattern(Invoke.Pattern).Invoke()


class OfficialWhatsAppClient:
    def __init__(self, controls, *, backend=None, opener=None):
        self.controls = controls
        self.backend = backend or WindowsControls(controls)
        self.opener = opener or getattr(os, 'startfile', None)
        self.owns_call = False
        self.destination = None
        self.was_connected = False

    @staticmethod
    def readiness(settings):
        if sys.platform != 'win32':
            return 'El cliente de llamadas requiere Windows.'
        if not all(settings['controls'].values()):
            return 'Falta calibrar los controles del cliente WhatsApp.'
        return ''

    def prepare(self, destination, stopped):
        destination = number(destination)
        if stopped.is_set():
            raise TelephonyError('Llamada cancelada.')
        self.backend.attach()
        if not self.opener:
            raise TelephonyError('No se puede abrir el cliente de WhatsApp.')
        self.opener('whatsapp://send?phone=' + destination[1:])
        deadline = time.monotonic() + 8
        while not stopped.is_set() and time.monotonic() < deadline:
            try:
                if displayed_number(self.backend.text('recipient')) == destination:
                    return
            except TelephonyError:
                pass  # The calibrated header may not exist while navigation loads.
            stopped.wait(.1)
        raise TelephonyError('WhatsApp no confirmó el número del destinatario. No se inició la llamada.')

    def dial(self, destination):
        # Recheck immediately at the side-effect boundary, not just navigation.
        if displayed_number(self.backend.text('recipient')) != number(destination):
            raise TelephonyError('Cambió el destinatario en WhatsApp. Revisa la llamada.')
        if hasattr(self.backend, 'ready_for_call') and not self.backend.ready_for_call():
            raise TelephonyError('El cliente WhatsApp ya tiene una llamada o no permite iniciar otra.')
        self.destination = destination
        self.owns_call = True  # Invoke outcome may be uncertain; never auto-retry.
        self.backend.invoke('call')

    def state(self):
        try:
            value = self.backend.text('state').strip().casefold()
        except MissingClientControl:
            if not self.was_connected and self.owns_call:
                return 'dialing'
            if (self.was_connected and self.backend.ready_for_call() and
                    displayed_number(self.backend.text('recipient')) == self.destination):
                return 'completed'
            raise
        if re.fullmatch(r'(?:[0-9]{1,2}:)?[0-9]{1,2}:[0-9]{2}', value):
            self.was_connected = True
            return 'in-progress'
        aliases = {'calling':'dialing', 'llamando':'dialing', 'ringing':'ringing', 'sonando':'ringing',
                   'connected':'in-progress', 'conectado':'in-progress', 'en llamada':'in-progress',
                   'ended':'completed', 'finalizada':'completed', 'llamada finalizada':'completed',
                   'busy':'busy', 'ocupado':'busy', 'no answer':'no-answer', 'sin respuesta':'no-answer',
                   'ready':'preparing', 'idle':'preparing', 'listo':'preparing'}
        if value not in aliases:
            raise TelephonyError('No se pudo verificar el estado de la llamada de WhatsApp.')
        state = aliases[value]
        if state == 'in-progress':
            self.was_connected = True
        if state == 'preparing' and self.owns_call:
            if (self.was_connected and self.backend.ready_for_call() and
                    displayed_number(self.backend.text('recipient')) == self.destination):
                return 'completed'
            return 'dialing'
        return state

    def hangup(self):
        if self.owns_call:
            if displayed_number(self.backend.text('recipient')) != self.destination:
                raise TelephonyError('No se pudo confirmar qué llamada está abierta en WhatsApp.')
            self.owns_call = False
            self.backend.invoke('hangup')
