"""One 80 ms PCM clock for native senders and receive-time rate validation."""
import math


class PCMFrameClock:
    """Follow the audio cadence; never repay a scheduler pause with a burst.

    Small wake-up jitter keeps the phase, but missed periods start a new phase.
    Input stays in its owner's queue rather than being dropped or accelerated.
    """
    def __init__(self):self.next_at=None
    def reset(self):self.next_at=None
    def delay(self,now):return max(0,self.next_at-now) if self.next_at is not None else 0
    def sent(self,now):
        self.next_at=(self.next_at if self.next_at is not None and now-self.next_at<.08 else now)+.08


class PCMRateGate:
    """300 ms of burst credit, measured at ingress, never worker dequeue time."""
    def __init__(self,started,*,burst_seconds=.3):
        if type(burst_seconds) not in (int,float) or not math.isfinite(burst_seconds) or not .3<=burst_seconds<=.4:raise ValueError('Invalid PCM burst allowance')
        self.at=started;self.limit=burst_seconds;self.credit=burst_seconds
    def accept(self,size,arrived):
        if type(size) is not int or size!=3840 or type(arrived) not in (int,float) or not math.isfinite(arrived):raise ValueError('Invalid PCM arrival')
        self.credit=min(self.limit,self.credit+max(0,arrived-self.at));self.at=max(self.at,arrived)
        if size/48000>self.credit+.015:return False
        self.credit-=size/48000;return True

    def delay_for_frame(self):
        """Remaining budget after a rejected 80 ms frame."""
        return max(0,.08-self.credit)
