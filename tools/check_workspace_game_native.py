"""Owned WinForms strip with real Windows counters. No game, input or screen capture."""
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import threading
import time

import clr

from desktop.experience.native_game_strip import NativeGameStrip
from desktop.experience.presentmon import PresentMonPackage
from desktop.experience.workspace_game import GameMonitor

clr.AddReference('System.Windows.Forms')
from System.Threading import ApartmentState, Thread, ThreadStart
from System.Windows.Forms import Application, ApplicationContext, Form, Screen, Timer


def main():
    report = {'passed': False, 'scope': 'owned WinForms form with real Windows counters', 'fps_capture': False}
    done = threading.Event()

    def run():
        context = ApplicationContext()
        dispatcher = Form()
        dispatcher.Handle  # Create a handle without showing the dispatcher.
        strip = NativeGameStrip(dispatcher)
        monitor = GameMonitor(PresentMonPackage(Path('.local/tools')), publish=strip.update, interval=.45)
        timer = Timer()
        timer.Interval = 80
        user = ctypes.WinDLL('user32')
        user.GetForegroundWindow.restype = wintypes.HWND
        deadline = time.monotonic() + 12
        stage = 0
        revision = 0

        def finish():
            timer.Stop()
            monitor.close()
            strip.close()
            timer.Dispose()
            dispatcher.Dispose()
            context.ExitThread()
            done.set()

        def tick(*_):
            nonlocal stage, revision
            try:
                assert not strip.error, f'Native render failed with {strip.error}'
                assert time.monotonic() < deadline, f'Timed out in stage {stage}'
                if stage == 0:
                    assert monitor.worker is None and strip.form is None, 'idle allocated a worker or a form'
                    monitor.start('')
                    stage = 1
                elif stage == 1:
                    sample = monitor.snapshot()
                    if sample['cpu'] is None or not strip.form or not strip.form.Visible:
                        return
                    form = strip.form
                    assert not form.ShowInTaskbar and form.TopMost, 'unexpected taskbar or z-order state'
                    assert Screen.FromControl(form).WorkingArea.Contains(form.Bounds), 'strip clipped by work area'
                    assert user.GetForegroundWindow() != int(form.Handle.ToInt64()), 'strip took foreground focus'
                    style = strip.user.GetWindowLongW(int(form.Handle.ToInt64()), -20)
                    assert style & 0x080800A0 == 0x080800A0, f'window styles: {style:x}'
                    assert 'FPS —' in [label.Text for label in strip.labels], 'unknown FPS not shown'
                    assert all(sample[key] is None or 0 <= sample[key] <= 100 for key in ('cpu', 'gpu', 'ram')), 'invalid counter scale'
                    assert sample['ram'] is not None, 'RAM counter missing'
                    report['real_counters'] = {key: sample[key] for key in ('cpu', 'gpu', 'ram')}
                    monitor.stop(wait=True)
                    revision = monitor.snapshot()['revision']
                    stage = 2
                elif strip.form is None:
                    assert monitor.worker is None and monitor.snapshot()['revision'] == revision, 'sampler still active'
                    report['passed'] = True
                    report['notes'] = 'Only system metrics; no FPS capture, foreground input or WebView.'
                    finish()
            except Exception as error:
                report['error'] = f'{type(error).__name__}: {error}'
                finish()

        timer.Tick += tick
        timer.Start()
        Application.Run(context)

    thread = Thread(ThreadStart(run))
    thread.SetApartmentState(ApartmentState.STA)
    thread.IsBackground = True
    thread.Start()
    if not done.wait(18):
        report['error'] = 'Owned WinForms dispatcher did not finish.'
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
