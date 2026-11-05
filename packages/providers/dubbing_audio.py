"""Remove bounded exterior padding from complete 24 kHz PCM16 synthesis."""
from array import array
import sys


SAMPLE_RATE = 24000
EDGE_SCAN_SAMPLES = SAMPLE_RATE // 5
KEEP_SAMPLES = 30 * SAMPLE_RATE // 1000
QUIET_PEAK = 4


def trim_synthesis_padding(pcm):
    """Keep the waveform and pauses between words byte for byte.

    Inspect at most 200 ms at either edge. Only trim a near-digital-silent
    edge whose transition into the waveform is visible inside that window.
    Keep 30 ms beside each transition, and leave silent-only audio unchanged.
    Four PCM16 units are about -78 dBFS, below the measured generated edges.
    """
    if not isinstance(pcm, bytes) or len(pcm) % 2:
        raise ValueError('Expected complete mono PCM16 bytes.')
    samples = array('h', pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    scan = min(EDGE_SCAN_SAMPLES, len(samples))
    leading = 0
    while leading < scan and abs(samples[leading]) <= QUIET_PEAK:
        leading += 1
    trailing = 0
    while trailing < scan and abs(samples[len(samples) - 1 - trailing]) <= QUIET_PEAK:
        trailing += 1
    head = max(0, leading - KEEP_SAMPLES) if leading < scan else 0
    tail = max(0, trailing - KEEP_SAMPLES) if trailing < scan else 0
    end = len(pcm) - tail * 2
    return pcm[head * 2:end], head * 1000 / SAMPLE_RATE, tail * 1000 / SAMPLE_RATE
