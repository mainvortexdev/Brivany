"""Bounded delivery guidance for dense video speech, without altering text."""
import math
import re
from collections import deque
from statistics import median
import threading


MAX_DELIVERY_SPEED = 1.5


def spoken_word_count(text):
    return len(re.findall(r"\w+(?:['’]\w+)*", text, flags=re.UNICODE)) if isinstance(text,str) else 0


def _delivery_density(text,start_ms,end_ms):
    if not isinstance(text, str) or any(type(value) not in (int, float) or not math.isfinite(value)
                                      for value in (start_ms, end_ms)):
        return None
    duration=(end_ms-start_ms)/1000
    words=spoken_word_count(text)
    return words/duration if start_ms>=0 and .15<=duration<=30 and words>=3 else None


def delivery_speed(text, start_ms, end_ms):
    """Request natural faster delivery only when speech exceeds 180 words/min.

    Sonic interprets speed as guidance; playback still checks actual duration.
    Neither silence nor invalid/unknown timing can request a slower voice.
    """
    density=_delivery_density(text,start_ms,end_ms)
    return round(min(MAX_DELIVERY_SPEED,max(1.,density/3.)),3) if density is not None else 1.


class DeliveryPace:
    """Session-only duration guidance learned from completed TTS, not playback.

    The provider's speed is guidance rather than an exact multiplier. Four
    recent numeric observations per catalog voice estimate its unaccelerated
    word rate; the next dense request can compensate up to the documented 1.5
    guidance bound. No text, PCM, identity or cross-session profile is retained.
    A slow HTTP response does not enter this estimate: only produced samples do.
    """
    def __init__(self):
        self._voices={};self._lock=threading.Lock()

    def observe(self,voice,text,audio_ms,speed):
        words=spoken_word_count(text)
        if not isinstance(voice,str) or not 1<=len(voice)<=128 or words<3 or any(
            type(value) not in (int,float) or not math.isfinite(value) for value in (audio_ms,speed)):
            return False
        if not 150<=audio_ms<=30000 or not 1<=speed<=MAX_DELIVERY_SPEED:return False
        estimate=words/(audio_ms/1000)/speed
        if not .25<=estimate<=8:return False
        with self._lock:
            if voice not in self._voices:
                if len(self._voices)>=16:self._voices.pop(next(iter(self._voices)))
                self._voices[voice]=deque(maxlen=4)
            self._voices[voice].append(estimate)
        return True

    def speed(self,voice,text,start_ms,end_ms):
        density=_delivery_density(text,start_ms,end_ms)
        if density is None:return 1.
        with self._lock:observed=tuple(self._voices.get(voice,()))
        pace=min(3.,median(observed)) if observed else 3.
        return round(min(MAX_DELIVERY_SPEED,max(1.,density/pace)),3)
