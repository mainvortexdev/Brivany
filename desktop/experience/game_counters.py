"""On-demand local system counters for the WorkSpace game strip."""
import ctypes
from ctypes import wintypes as W
import math
import re


class MemoryStatus(ctypes.Structure):
    _fields_ = [('length', W.DWORD), ('load', W.DWORD),
                *((name, ctypes.c_ulonglong) for name in (
                    'total', 'available', 'page_total', 'page_available',
                    'virtual_total', 'virtual_available', 'virtual_extended'))]


class CounterValue(ctypes.Structure):
    _fields_ = [('status', W.DWORD), ('value', ctypes.c_double)]


class CounterItem(ctypes.Structure):
    _fields_ = [('name', W.LPWSTR), ('result', CounterValue)]


ENGINE = re.compile(r'^pid_\d+_(luid_0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+_eng_\d+)_engtype_', re.I)
MORE_DATA = 0x800007D2


def busiest_engine(samples):
    totals = {}
    for name, value in samples:
        match = ENGINE.match(name or '')
        if match and math.isfinite(value) and value >= 0:
            key = match[1].lower()
            totals[key] = totals.get(key, 0) + value
    return round(min(100, max(totals.values()))) if totals else None


class GpuCounters:
    def __init__(self):
        self.pdh = ctypes.WinDLL('pdh')
        self.query = W.HANDLE()
        self.counter = W.HANDLE()
        self.buffer = None
        for name, args in (
            ('PdhOpenQueryW', (W.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(W.HANDLE))),
            ('PdhAddEnglishCounterW', (W.HANDLE, W.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(W.HANDLE))),
            ('PdhCollectQueryData', (W.HANDLE,)),
            ('PdhGetFormattedCounterArrayW', (W.HANDLE, W.DWORD, ctypes.POINTER(W.DWORD),
                                             ctypes.POINTER(W.DWORD), ctypes.c_void_p)),
            ('PdhCloseQuery', (W.HANDLE,)),
        ):
            method = getattr(self.pdh, name)
            method.argtypes, method.restype = args, W.DWORD
        if self.pdh.PdhOpenQueryW(None, 0, ctypes.byref(self.query)):
            return
        if self.pdh.PdhAddEnglishCounterW(self.query, r'\GPU Engine(*)\Utilization Percentage',
                                         0, ctypes.byref(self.counter)):
            self.close()

    def sample(self):
        if not self.query or self.pdh.PdhCollectQueryData(self.query):
            return None
        size = W.DWORD(len(self.buffer) if self.buffer else 0)
        count = W.DWORD()
        read = self.pdh.PdhGetFormattedCounterArrayW
        status = read(self.counter, 0x200, ctypes.byref(size), ctypes.byref(count), self.buffer)
        if status == MORE_DATA and 0 < size.value <= 4 * 1024 * 1024:
            self.buffer = ctypes.create_string_buffer(size.value)
            status = read(self.counter, 0x200, ctypes.byref(size), ctypes.byref(count), self.buffer)
        if status or not self.buffer or count.value * ctypes.sizeof(CounterItem) > len(self.buffer):
            return None
        items = (CounterItem * count.value).from_buffer(self.buffer)
        return busiest_engine((item.name, item.result.value) for item in items if item.result.status in (0, 1))

    def close(self):
        if self.query:
            self.pdh.PdhCloseQuery(self.query)
            self.query = W.HANDLE()
        self.buffer = None


class SystemCounters:
    def __init__(self):
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.times = kernel.GetSystemTimes
        self.times.argtypes = [ctypes.POINTER(W.FILETIME)] * 3
        self.times.restype = W.BOOL
        self.memory = kernel.GlobalMemoryStatusEx
        self.memory.argtypes = [ctypes.POINTER(MemoryStatus)]
        self.memory.restype = W.BOOL
        self.previous = None
        try:
            self.gpu = GpuCounters()
        except OSError:
            self.gpu = None

    def _cpu(self):
        values = [W.FILETIME() for _ in range(3)]
        if not self.times(*(ctypes.byref(value) for value in values)):
            self.previous = None
            return None
        idle, kernel, user = (value.dwHighDateTime << 32 | value.dwLowDateTime for value in values)
        current = idle, kernel + user
        previous, self.previous = self.previous, current
        if previous:
            elapsed = current[1] - previous[1]
            free = idle - previous[0]
            if elapsed > 0 and 0 <= free <= elapsed:
                return round(100 * (elapsed - free) / elapsed)
        return None

    def sample(self):
        memory = MemoryStatus(length=ctypes.sizeof(MemoryStatus))
        ram = int(memory.load) if self.memory(ctypes.byref(memory)) else None
        return {'cpu': self._cpu(), 'gpu': self.gpu.sample() if self.gpu else None, 'ram': ram}

    def close(self):
        if self.gpu:
            self.gpu.close()
