"""Commit short pieces of a live ASR turn using cumulative partials."""
from dataclasses import dataclass
import re
import unicodedata


_CLAUSE_END = re.compile(r"""[.!?…;:]["'’”»)\]]*$""")
_EDGE_PUNCTUATION = """ .,!?:;…"'‘’“”«»¿¡()[]"""
_INTERNAL_APOSTROPHE = re.compile(r"(?<=\w)[’‘ʼ](?=\w)")
_MIN_OBSERVATION_MS = 2000
_MIN_PIECE_MS = 1800
_LOOKAHEAD_MS = 240
_FALLBACK_WORDS = 8
_AGED_REMAINDER_MS = 3000
_MIN_AGED_WORDS = 4
_TRAILING_WORDS = 3
_MAX_TURNS = 128
_MAX_SOURCE_CHARS = 800


@dataclass(frozen=True, slots=True)
class InlinePiece:
    chunk_id: str
    start_ms: float
    end_ms: float
    text: str
    timing_quality: str
    next_id: str | None = None
    skip_reason: str | None = None


@dataclass(slots=True)
class _Turn:
    start_ms: float
    index: int = 0
    committed: tuple[str, ...] = ()
    previous: tuple[str, ...] = ()
    observed_ms: float = -1
    closed: bool = False


def _timestamp(value):
    return type(value) in (int, float) and 0 <= value <= 2**53 - 1


def _words(text):
    words = unicodedata.normalize('NFC', text).split()
    # Punctuation or casing can be cleaned up at speechComplete. Preserve
    # signs, apostrophes, internal decimal marks, and the actual words.
    return words, tuple(_INTERNAL_APOSTROPHE.sub("'", word.strip(_EDGE_PUNCTUATION) or word).casefold() for word in words)


class InlineClauses:
    """Estimate intermediate boundaries from the observed text and ASR clock.

    Muse confirms the whole turn's timing. It provides neither word offsets
    nor exact boundaries for these earlier, progressively translated pieces.
    """
    def __init__(self):
        self.turns = {}

    def start(self, turn_id, start_ms):
        if not _timestamp(start_ms):
            return False
        key = str(turn_id)
        if key in self.turns:
            return not self.turns[key].closed
        if len(self.turns) >= _MAX_TURNS:
            oldest = next((identifier for identifier, turn in self.turns.items() if turn.closed), next(iter(self.turns)))
            del self.turns[oldest]
        self.turns[key] = _Turn(float(start_ms))
        return True

    def current(self, turn_id):
        key = str(turn_id)
        turn = self.turns.get(key)
        if turn is None or turn.closed:
            return None
        return (f'{key}:{turn.index}' if turn.index else key, turn.start_ms)

    def partial(self, turn_id, text, processed_ms):
        current = self.current(turn_id)
        if current is None or not isinstance(text, str) or not _timestamp(processed_ms):
            return None
        turn = self.turns[str(turn_id)]
        if processed_ms <= turn.observed_ms:
            return None
        words, keys = _words(text)
        previous, turn.previous = turn.previous, keys
        previous_ms, turn.observed_ms = turn.observed_ms, float(processed_ms)
        first = len(turn.committed)
        if (processed_ms - turn.start_ms < _MIN_OBSERVATION_MS or
                keys[:first] != turn.committed or previous[:first] != turn.committed):
            return None

        stable_end = first
        for before, now in zip(previous[first:], keys[first:]):
            if before != now:
                break
            stable_end += 1
        limit = min(stable_end, len(words) - _TRAILING_WORDS, first + 14)
        if limit < first + 4:
            return None
        elapsed = processed_ms - turn.start_ms
        latest = min(previous_ms, processed_ms - _LOOKAHEAD_MS)
        def estimated_end(index):
            return min(latest, turn.start_ms + elapsed * (index - first) / (len(words) - first))

        # A slowly growing remainder may never offer eight stable words plus
        # its three-word tail before the whole turn ends. Once that remainder
        # itself is three seconds old, allow a smaller stable prefix while
        # retaining the same two-observation, tail and audio-duration guards.
        fallback_words=min(_FALLBACK_WORDS,limit-first) if elapsed>=_AGED_REMAINDER_MS else _FALLBACK_WORDS
        endpoint = next((index for index in range(limit, first + 3, -1)
                         if _CLAUSE_END.search(words[index - 1]) and estimated_end(index) - turn.start_ms >= _MIN_PIECE_MS),
                        first + fallback_words)
        if endpoint > limit or endpoint-first<_MIN_AGED_WORDS:
            return None
        end = round(estimated_end(endpoint), 3)
        piece_text = ' '.join(words[first:endpoint])
        if end - turn.start_ms < _MIN_PIECE_MS or len(piece_text) > _MAX_SOURCE_CHARS:
            return None
        chunk_id, start_ms = current
        turn.index += 1
        turn.start_ms = end
        turn.committed = keys[:endpoint]
        return InlinePiece(chunk_id, start_ms, end, piece_text, 'asr_partial_estimate',
                           next_id=f'{turn_id}:{turn.index}')

    def final(self, turn_id, text, end_ms):
        current = self.current(turn_id)
        if current is None:
            return None
        chunk_id, start_ms = current
        turn = self.turns[str(turn_id)]
        turn.closed = True
        timing_quality = 'asr_partial_estimate' if turn.index else 'asr_turn'
        reason = None
        remainder = ''
        if not _timestamp(end_ms) or end_ms <= start_ms:
            end_ms = start_ms
            reason = 'sync_timing'
        elif not isinstance(text, str) or not text.strip():
            reason = 'empty_transcript'
        else:
            words, keys = _words(text)
            first = len(turn.committed)
            if keys[:first] != turn.committed:
                reason = 'asr_revision'
            else:
                remainder = ' '.join(words[first:])
                if not remainder:
                    reason = 'empty_transcript'
                elif len(remainder) > _MAX_SOURCE_CHARS:
                    reason = 'long_turn'
        return InlinePiece(chunk_id, start_ms, float(end_ms), remainder if reason is None else '',
                           timing_quality, skip_reason=reason)
