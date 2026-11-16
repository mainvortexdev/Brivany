"""Non-configurable upper bounds for every user's phone calls."""
import threading
import time

MAX_CALL_SECONDS = 90
USER_SILENCE_SECONDS = 15
COMMUNICATION_SECONDS = 15


class CallSafety:
    def __init__(self, *, clock=time.monotonic, max_seconds=MAX_CALL_SECONDS):
        self.clock = clock
        self.limit = min(MAX_CALL_SECONDS, max_seconds) if max_seconds is not None else MAX_CALL_SECONDS
        self.created = clock()
        self.answered = self.last_user_voice = None
        self.input_ready = self.output_ready = False
        self.lock = threading.Lock()

    def connected(self):
        with self.lock:
            if self.answered is None:
                self.answered = self.last_user_voice = self.clock()

    def user_voice(self):
        with self.lock:
            if self.answered is not None:
                self.last_user_voice = self.clock()

    def ready(self, *, input=False, output=False):
        with self.lock:
            self.input_ready |= input
            self.output_ready |= output

    def reason(self):
        with self.lock:
            now = self.clock()
            if now - self.created >= self.limit:
                return 'maximum_duration'
            if self.answered is not None:
                if not (self.input_ready and self.output_ready) and now - self.answered >= COMMUNICATION_SECONDS:
                    return 'communication_timeout'
                if now - self.last_user_voice >= USER_SILENCE_SECONDS:
                    return 'user_silence'
            return None


def limits():
    return {'maximum_call_seconds': MAX_CALL_SECONDS, 'user_silence_seconds': USER_SILENCE_SECONDS,
            'communication_timeout_seconds': COMMUNICATION_SECONDS}
