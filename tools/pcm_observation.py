"""Bounded PCM energy observations; no speech recognition or inference timing.

Arrival timestamps are supplied by the caller relative to its first input. A
window is observed when the chunk completing it arrives, even if that chunk
contains several windows. Only a pending window is retained in memory.
"""
from __future__ import annotations

import math
import struct


class PCMObservation:
    WINDOW_MS = 20
    THRESHOLD_RMS = 0.005
    MAX_SECONDS = 90

    def __init__(self):
        self._rate = None
        self._channels = None
        self._window_frames = None
        self._window_bytes = None
        self._pending = bytearray()
        self._received_bytes = 0
        self._analyzed_frames = 0
        self._above_frames = 0
        self._window_count = 0
        self._first_above_ms = None
        self._maximum_rms = 0.0
        self._last_arrival_ms = None
        self._closed = False

    def _arrival(self, at_ms):
        if type(at_ms) not in {int, float}:
            raise ValueError("El tiempo de llegada debe ser finito, no negativo y no decreciente.")
        try: arrival = float(at_ms)
        except (ValueError, OverflowError):
            raise ValueError("El tiempo de llegada debe ser finito, no negativo y no decreciente.") from None
        if (not math.isfinite(arrival) or arrival < 0 or
            (self._last_arrival_ms is not None and arrival < self._last_arrival_ms)):
            raise ValueError("El tiempo de llegada debe ser finito, no negativo y no decreciente.")
        return arrival

    def _observe(self, at_ms):
        # Called only for complete sample frames. Both stereo channels contribute
        # to the RMS; a signal in one channel is therefore not silently omitted.
        sample_count = len(self._pending)//2
        frames = sample_count//self._channels
        square_sum = sum(value[0]*value[0] for value in struct.iter_unpack("<h", self._pending))
        rms = math.sqrt(square_sum/sample_count)/32768
        self._maximum_rms = max(self._maximum_rms, rms)
        self._analyzed_frames += frames
        self._window_count += 1
        if rms > self.THRESHOLD_RMS:
            self._above_frames += frames
            if self._first_above_ms is None: self._first_above_ms = at_ms
        self._pending.clear()

    def feed(self, data, rate, channels, at_ms):
        """Accept PCM16 little-endian bytes; packets may split sample frames.

        Format is fixed by the first accepted call. No more than 90 seconds of
        input is accepted. Arrival time is not an acoustic position or the time
        the provider started/finished inference.
        """
        if self._closed: raise ValueError("La observación PCM está cerrada.")
        if not isinstance(data, (bytes, bytearray)):
            raise ValueError("El bloque PCM debe contener bytes.")
        if type(rate) is not int or not 8000 <= rate <= 96000 or type(channels) is not int or channels not in {1, 2}:
            raise ValueError("PCM admite entre 8 y 96 kHz y uno o dos canales.")
        if self._rate is not None and (rate, channels) != (self._rate, self._channels):
            raise ValueError("El formato PCM no puede cambiar durante la observación.")
        arrival = self._arrival(at_ms)
        if self._received_bytes+len(data) > rate*channels*2*self.MAX_SECONDS:
            raise ValueError("La observación PCM excede 90 segundos.")
        if self._rate is None:
            self._rate, self._channels = rate, channels
            self._window_frames = max(1, round(rate*self.WINDOW_MS/1000))
            self._window_bytes = self._window_frames*channels*2
        self._last_arrival_ms = arrival
        self._received_bytes += len(data)
        view = memoryview(data)
        offset = 0
        while offset < len(view):
            amount = min(self._window_bytes-len(self._pending), len(view)-offset)
            self._pending.extend(view[offset:offset+amount]); offset += amount
            if len(self._pending) == self._window_bytes: self._observe(arrival)

    def flush(self, at_ms=None):
        """Observe a final short window of complete frames, then seal the state.

        Without an explicit timestamp the latest chunk's arrival is used. An
        incomplete last sample frame is rejected rather than padded or counted.
        """
        arrival = self._last_arrival_ms if at_ms is None else self._arrival(at_ms)
        if self._closed: return self.summary()
        if self._pending and len(self._pending) % (self._channels*2):
            raise ValueError("El último bloque PCM contiene un frame incompleto.")
        if self._pending: self._observe(arrival)
        if arrival is not None: self._last_arrival_ms = arrival
        self._closed = True
        return self.summary()

    def summary(self):
        """Scalar metadata only; a threshold crossing does not identify speech."""
        bytes_per_frame = self._channels*2 if self._channels else None
        return {
            "measurement": "pcm_window_energy",
            "sample_format": "pcm_s16le",
            "sample_rate_hz": self._rate,
            "channels": self._channels,
            "requested_window_ms": self.WINDOW_MS,
            "window_frames": self._window_frames,
            "actual_window_ms": self._window_frames/self._rate*1000 if self._rate else None,
            "threshold_rms": self.THRESHOLD_RMS,
            "threshold_comparison": ">",
            "time_reference": "chunk_arrival_relative_to_first_input",
            "first_above_threshold_ms": self._first_above_ms,
            "received_pcm_bytes": self._received_bytes,
            "total_pcm_seconds": (self._received_bytes//bytes_per_frame)/self._rate if self._rate else 0.0,
            "above_threshold_seconds": self._above_frames/self._rate if self._rate else 0.0,
            "analyzed_pcm_seconds": self._analyzed_frames/self._rate if self._rate else 0.0,
            "analyzed_window_count": self._window_count,
            "maximum_window_rms": self._maximum_rms,
            "pending_bytes": len(self._pending),
            "closed": self._closed,
        }
