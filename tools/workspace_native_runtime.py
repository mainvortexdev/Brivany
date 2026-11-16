"""Measure the owned WorkSpace fixture, including its real WebView2 processes."""
from collections import Counter
import ctypes
from ctypes import wintypes
from functools import wraps
import threading
import time

from desktop.experience.scripts import evaluate_script


def count_bridge_calls(bridge):
    counts = Counter()
    lock = threading.Lock()

    def instrument(name, method):
        @wraps(method)
        def measured(*args, **kwargs):
            with lock:
                counts[name] += 1
            value = method(*args, **kwargs)
            # Read the real Windows pointer. Keep a user's physical movement
            # from changing the scenario being measured.
            if name == 'work_island_pointer' and value:
                value.update(near=False, over_bar=False)
            return value
        return measured

    for name in ('work_island_pointer', 'work_status', 'work_island_layout',
                 'work_island_gaze', 'spotify_status', 'spotify_playback',
                 'work_sync_translation_status'):
        setattr(bridge, name, instrument(name, getattr(bridge, name)))

    def snapshot():
        with lock:
            return counts.copy()
    return snapshot


def process_sample(windows):
    from System import Action
    from System.Diagnostics import Process

    identities = {}

    def collect():
        for window in windows:
            environment = window.native.webview.CoreWebView2.Environment
            for info in environment.GetProcessInfos():
                identities[int(info.ProcessId)] = str(info.Kind)

    windows[0].native.Invoke(Action(collect))
    with_process = Process.GetCurrentProcess()
    try:
        identities[int(with_process.Id)] = 'Python'
    finally:
        with_process.Dispose()
    assert 'Browser' in identities.values(), 'WebView2 process enumeration is empty'
    result = {}
    for pid, role in identities.items():
        process = Process.GetProcessById(pid)
        try:
            result[pid] = {
                'role': role,
                'cpu_seconds': float(process.TotalProcessorTime.TotalSeconds),
                'working_set_bytes': int(process.WorkingSet64),
                'private_bytes': int(process.PrivateMemorySize64),
            }
        finally:
            process.Dispose()
    return result


def region_size(host):
    handle, user, _ = host.region
    user.GetWindowRgnBox.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.GetWindowRgnBox.restype = ctypes.c_int
    bounds = wintypes.RECT()
    assert user.GetWindowRgnBox(handle, ctypes.byref(bounds))
    return bounds.right-bounds.left, bounds.bottom-bounds.top


def wait_for(check):
    deadline = time.monotonic()+8
    while time.monotonic() < deadline:
        if value := check():
            return value
        time.sleep(.06)
    raise AssertionError('The native WorkSpace state did not settle')


def measure_workspace(bridge, root, count, report):
    host = bridge._island_host
    panel = bridge._work_window
    windows = [root, bridge._bar_window, panel]
    for window in windows:
        wait_for(lambda: evaluate_script(window, 'Boolean(window.pywebview?.api)'))
    report['checks'] = []
    report['samples'] = []
    report['resource_scope'] = ('Owned Windows fixture, Python host and WebView2 processes for its three views. '
        'No external models, capture or physical input. Working sets may count shared pages twice; '
        'GPU time, crash handler and processes outside WebView2 environments are excluded.')

    def sample(name):
        time.sleep(2)
        previous = process_sample(windows)
        before = count()
        start = time.monotonic()
        time.sleep(8)
        after = count()
        current = process_sample(windows)
        elapsed = time.monotonic()-start
        stable = previous.keys() & current.keys()
        assert stable, 'No stable process remained between measurements'
        groups = {}
        for pid, row in current.items():
            role = row['role']
            group = groups.setdefault(role, {'count':0, 'cpu_seconds':0., 'working_set_bytes':0, 'private_bytes':0})
            group['count'] += 1
            group['working_set_bytes'] += row['working_set_bytes']
            group['private_bytes'] += row['private_bytes']
            if pid in stable:
                group['cpu_seconds'] += max(0., row['cpu_seconds']-previous[pid]['cpu_seconds'])
        cpu = sum(group['cpu_seconds'] for group in groups.values())
        report['samples'].append({'scenario':name, 'seconds':round(elapsed,3),
            'cpu_percent_one_core':round(cpu/elapsed*100,3), 'processes':groups,
            'processes_added':len(current.keys()-previous.keys()),'processes_removed':len(previous.keys()-current.keys()),
            'bridge_calls':dict(after-before)})

    sample('toolbar_idle')
    bridge.work_island_layout(True,'normal','widgets',False,False,400)
    def fitted():
        size = evaluate_script(panel, """(()=>{
            const panel=document.querySelector('#island-content'),button=document.querySelector('#widget-timer-action');
            return [panel.offsetWidth,panel.offsetHeight,button?.offsetHeight];
        })()""")
        if size and size[0] == 360 and 158 <= size[1] <= 175 and size[2] == 26 and host.value['height'] == size[1]:
            return size

    size = wait_for(fitted)
    pixels = region_size(host)
    assert abs(pixels[1]-size[1]*pixels[0]/size[0]) <= 2, (pixels,size)
    report['panel_css_pixels'] = size
    report['panel_region_pixels'] = pixels
    report['checks'].append('The real native region fits Enfoque and its compact controls.')
    panel.evaluate_js("document.querySelector('#widget-timer-action').click()")
    wait_for(lambda: evaluate_script(panel, "BrivanyWorkspaceWidgets.state().state==='running'"))
    sample('visible_timer_running')
    bridge.work_island_layout(False,'normal','widgets',False,True,400)
    handle, user, _ = host.region
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.IsWindowVisible.restype = wintypes.BOOL
    wait_for(lambda: not user.IsWindowVisible(handle))
    sample('hidden_timer_running')
    assert evaluate_script(bridge._bar_window, "BrivanyWorkspaceWidgets.state().state==='running'")
    assert getattr(bridge,'_voice_window',None) is None
    report['checks'].append('The timer keeps its native deadline while the panel is hidden, with no voice WebView allocated.')
    idle, visible, hidden = report['samples']
    assert not idle['bridge_calls'].get('work_island_pointer')
    assert visible['bridge_calls'].get('work_island_pointer', 0) > 0
    assert not hidden['bridge_calls'].get('work_island_pointer')
    report['checks'].append('Native proximity is sampled only while a panel is open.')
