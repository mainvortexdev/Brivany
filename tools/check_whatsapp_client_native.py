"""Actual UI Automation on an owned synthetic window; no WhatsApp or calls."""
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
from uuid import uuid4

from services.telephony.whatsapp_client_ui import WindowsControls, OfficialWhatsAppClient, com_thread
from services.telephony.common import TelephonyError

ROOT = Path(__file__).resolve().parents[1]


def main():
    token = uuid4().hex
    process = subprocess.Popen([sys.executable, '-X', 'utf8', '-B', '-m', 'tools.whatsapp_client_ui_fixture', token],
        cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8',
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    metadata = queue.Queue()
    threading.Thread(target=lambda: metadata.put(process.stdout.readline()), daemon=True).start()
    try:
        line = metadata.get(timeout=12)
        if not line:
            raise RuntimeError(process.stderr.read(3000))
        owner = json.loads(line)
        if owner['token'] != token:
            raise RuntimeError('Synthetic window ownership changed')
        with com_thread():
            from services.telephony.whatsapp_client_ui import desktop_reference
            desktop_reference('UIAutomationClient'); desktop_reference('UIAutomationTypes')
            from System import IntPtr
            from System.Windows.Automation import AutomationElement
            backend = WindowsControls({'recipient':'wa-recipient','state':'wa-state','call':'wa-call','hangup':'wa-hangup'})
            backend.root = AutomationElement.FromHandle(IntPtr(owner['handle']))
            if (backend.root.Current.ProcessId != owner['pid'] or
                    backend.root.Current.Name != 'Brivany synthetic WhatsApp controls ' + token):
                raise RuntimeError('Synthetic UI window identity changed')
            backend.process_id = owner['pid']
            backend.attach = lambda: None  # Only attachment is substituted, to our owned window.
            opened = []
            client = OfficialWhatsAppClient(backend.controls, backend=backend, opener=opened.append)
            client.prepare('+18295550101', threading.Event())
            if client.state() != 'preparing':
                raise RuntimeError('Native state was not read')
            client.dial('+18295550101')
            if client.state() != 'in-progress':
                raise RuntimeError('Native Invoke did not change call state')
            try:
                client.dial('+18295550101')
            except TelephonyError:
                pass
            else:
                raise RuntimeError('An existing call was not rejected')
            client.hangup()
            if client.state() != 'completed' or opened != ['whatsapp://send?phone=18295550101']:
                raise RuntimeError('Native hangup/navigation route failed')
            backend.controls['recipient'] = 'missing-id'
            try:
                backend.text('recipient')
            except TelephonyError:
                pass
            else:
                raise RuntimeError('Missing control was not rejected')
        print(json.dumps({'passed':True,'mode':'owned_WPF_UI_Automation_fixture',
            'checks':['read exact recipient','invoke call','read connected timer','invoke hangup','reject missing control'],
            'public_calls':0,'real_whatsapp_session':False,'physical_audio_used':False,'external_calls':0}, ensure_ascii=False))
    finally:
        if process.poll() is None:
            process.stdin.write('stop ' + token + '\n'); process.stdin.flush()
            try:
                process.wait(4)
            except subprocess.TimeoutExpired:
                pass
        if process.poll() is None:
            process.terminate()
        process.wait(4)
        for stream in (process.stdin, process.stdout, process.stderr):
            stream.close()


if __name__ == '__main__':
    main()
