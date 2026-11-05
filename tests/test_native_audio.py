"""Local PCM fixtures and fake output devices; no real speaker or paid API."""
import ctypes
import math
import os
import struct
import threading
import time
import unittest
from unittest.mock import patch

from packages.providers import native_audio
from packages.providers.native_audio import NativeAudioError,NativeMixer,FRAME_BYTES,SAMPLE_RATE


def pcm(value,count=480):return struct.pack('<'+'h'*count,*([value]*count))


class Driver:
    def __init__(self,fail=False):self.chunks=[];self.closed=False;self.fail=fail;self.written=threading.Event();self.drained=False
    def write(self,raw):
        if self.fail:raise OSError('device detail must never leak')
        if self.closed:raise RuntimeError('closed')
        self.chunks.append(raw);self.written.set()
    def drain(self,timeout):self.drained=True;return True
    def close(self):self.closed=True


class NativeAudioTests(unittest.TestCase):
    def test_burst_larger_than_old_queue_is_paced_in_order_without_raising_its_limit(self):
        mixer,driver=self.mixer(original=0,translation=1)
        stopped=threading.Event()
        # Four seconds delivered immediately in two provider packets used to
        # overflow the three-second queue before the device could consume it.
        first=pcm(1200,SAMPLE_RATE*2);second=pcm(-900,SAMPLE_RATE*2)
        self.assertTrue(mixer.push_translation_paced(first,stopped=stopped))
        self.assertTrue(mixer.push_translation_paced(second,stopped=stopped))
        self.assertTrue(mixer.finish())
        self.assertEqual(b''.join(driver.chunks),first+second)
        stats=mixer.stats()
        self.assertLessEqual(stats['maximum_queued_ms']['translation'],240)
        self.assertEqual(stats['rejected_pushes']['translation'],0)
        self.assertEqual(native_audio.LIMITS['translation'],SAMPLE_RATE*2*3)

    def test_paced_producer_stop_interrupts_backpressure_without_waiting_for_timeout(self):
        entered,release=threading.Event(),threading.Event()
        class BlockedDriver(Driver):
            def write(self,raw):entered.set();release.wait(2);super().write(raw)
        mixer,driver=self.mixer(driver=BlockedDriver())
        stopped=threading.Event();result=[]
        def send():result.append(mixer.push_translation_paced(pcm(1,SAMPLE_RATE*2),stopped=stopped))
        producer=threading.Thread(target=send);producer.start()
        try:
            self.assertTrue(entered.wait(1));stopped.set();producer.join(.4)
            self.assertFalse(producer.is_alive());self.assertEqual(result,[False])
        finally:release.set();producer.join(2)

    def test_paced_producer_rejects_stalled_output_with_bounded_wait(self):
        entered,release=threading.Event(),threading.Event()
        class BlockedDriver(Driver):
            def write(self,raw):entered.set();release.wait(2);super().write(raw)
        mixer,driver=self.mixer(driver=BlockedDriver());errors=[]
        def send():
            try:mixer.push_translation_paced(pcm(1,SAMPLE_RATE*2),stopped=threading.Event(),timeout=.15)
            except NativeAudioError as error:errors.append(error.code)
        producer=threading.Thread(target=send);producer.start()
        try:
            self.assertTrue(entered.wait(1));producer.join(.5)
            self.assertFalse(producer.is_alive());self.assertEqual(errors,['native_audio_stalled'])
        finally:release.set();producer.join(2)

    def mixer(self,**options):
        driver=options.pop('driver',Driver());mixer=NativeMixer(driver,**options);self.addCleanup(mixer.close);return mixer,driver

    def test_passive_status_never_constructs_mixer_or_opens_output(self):
        with patch.object(native_audio,'NativeMixer') as factory:
            result=native_audio.status();factory.assert_not_called()
        self.assertIs(result['physical_output_verified'],False);self.assertEqual(result['output_location'],'server_computer')
        self.assertEqual(result['submitted_audio_max_ms'],80);self.assertEqual(result['flush_translation_scope'],'queued_pcm_only_excludes_inflight_and_device_buffers')
        with patch.object(native_audio.os,'name','posix'):
            self.assertFalse(native_audio.status()['available'])
            with self.assertRaises(NativeAudioError):native_audio.open_native_audio()

    def test_idle_thread_never_writes_and_close_is_idempotent(self):
        mixer,driver=self.mixer();time.sleep(.04);self.assertEqual(driver.chunks,[])
        mixer.close();mixer.close();self.assertTrue(driver.closed);self.assertFalse(mixer._thread.is_alive())
        with self.assertRaises(NativeAudioError):mixer.push_original(pcm(1))

    def test_delivery_observer_distinguishes_a_buffered_burst_from_a_real_gap_without_exposing_pcm(self):
        clock=[10.];events=[]
        class Paced(Driver):
            paced_output=True
            def write(self,raw):
                clock[0]=[10.,10.,10.5,10.5][len(self.chunks)];super().write(raw)
        driver=Paced()
        with patch.object(native_audio.time,'monotonic',lambda:clock[0]):
            mixer=NativeMixer(driver,original=0,translation=1,observer=events.append)
            try:
                mixer.push_translation(pcm(100,480*4));self.assertTrue(mixer.finish())
                stats=mixer.stats()['translation_delivery']
                self.assertEqual(stats['gap_count'],1);self.assertAlmostEqual(stats['gap_max_ms'],460)
                self.assertEqual(stats['delivered_pcm_ms'],80);self.assertEqual(stats['observer_errors'],0)
                self.assertEqual(len(events),4);self.assertEqual(events[1]['translation_gap'],0)
                self.assertTrue(all(set(event)=={'at','estimated_start','duration','translation_duration','translation_gap'} for event in events))
                self.assertTrue(all(isinstance(value,(int,float)) for event in events for value in event.values()))
            finally:mixer.close()

    def test_failing_diagnostic_observer_cannot_interrupt_audio_delivery(self):
        def observer(event):raise RuntimeError('Diagnostic consumer failed')
        mixer,driver=self.mixer(original=0,translation=1,observer=observer)
        mixer.push_translation(pcm(100));self.assertTrue(mixer.finish())
        self.assertEqual(driver.chunks,[pcm(100)]);self.assertIsNone(mixer.stats()['error_code'])
        self.assertEqual(mixer.stats()['translation_delivery']['observer_errors'],1)

    def test_pcm_mixes_both_channels_clips_and_preserves_signed_little_endian(self):
        mixer,driver=self.mixer(original=1,translation=1)
        with mixer._condition:
            mixer.push_original(pcm(30000));mixer.push_translation(pcm(10000))
        self.assertTrue(mixer.finish());self.assertEqual(len(driver.chunks),1)
        self.assertEqual(struct.unpack('<480h',driver.chunks[0]),(32767,)*480)
        mixer.set_levels(original=.5,translation=.25)
        with mixer._condition:
            mixer.push_original(pcm(-20000));mixer.push_translation(pcm(-10000))
        self.assertTrue(mixer.finish());self.assertEqual(struct.unpack('<480h',driver.chunks[1]),(-12500,)*480)

    def test_stream_order_and_short_tail_are_preserved_without_extra_silence_writes(self):
        mixer,driver=self.mixer(original=1,translation=0)
        raw=pcm(-1,900)+pcm(42,102)
        mixer.push_original(raw);self.assertTrue(mixer.finish())
        self.assertEqual(b''.join(driver.chunks),raw);self.assertEqual([len(chunk) for chunk in driver.chunks],[960,960,84])
        count=len(driver.chunks);time.sleep(.04);self.assertEqual(len(driver.chunks),count);self.assertTrue(driver.drained)

    def test_pending_original_and_translation_queues_are_bounded_before_copy_or_drop(self):
        mixer,driver=self.mixer()
        with mixer._condition:
            mixer.push_original(pcm(10,SAMPLE_RATE));mixer.push_translation(pcm(20,SAMPLE_RATE*3))
            for kind,method in (('original',mixer.push_original),('translation',mixer.push_translation)):
                with self.assertRaises(NativeAudioError) as error:method(pcm(1,1))
                self.assertEqual(error.exception.code,'native_audio_'+kind+'_backlog')
            self.assertEqual(mixer._sizes,{'original':48000,'translation':144000})
            stats=mixer.stats();self.assertEqual(stats['maximum_queued_ms'],{'original':1000.,'translation':3000.})
            self.assertEqual(stats['rejected_pushes'],{'original':1,'translation':1})
            mixer.flush_translation();self.assertEqual(mixer._sizes,{'original':48000,'translation':0})
        mixer.close();self.assertEqual(mixer._sizes,{'original':0,'translation':0})

    def test_translation_flush_preserves_original_and_future_audio(self):
        mixer,driver=self.mixer(original=1,translation=1)
        with mixer._condition:
            mixer.push_original(pcm(100));mixer.push_translation(pcm(10000));mixer.flush_translation()
        self.assertTrue(mixer.finish());self.assertEqual(driver.chunks,[pcm(100)])
        mixer.push_translation(pcm(123));self.assertTrue(mixer.finish());self.assertEqual(driver.chunks[-1],pcm(123))

    def test_device_failure_is_safe_and_reported_by_check_error_and_finish(self):
        mixer,driver=self.mixer(driver=Driver(fail=True));mixer.push_translation(pcm(1))
        mixer._thread.join(timeout=.5);self.assertFalse(mixer._thread.is_alive())
        for action in (mixer.check_error,lambda:mixer.finish(),lambda:mixer.push_original(pcm(2))):
            with self.assertRaises(NativeAudioError) as error:action()
            self.assertEqual(error.exception.code,'native_audio_output');self.assertNotIn('device detail',str(error.exception))

    def test_invalid_pcm_volume_or_timeout_never_reaches_driver(self):
        mixer,driver=self.mixer()
        for raw in (b'',b'1',bytearray(b'12'),'text',None):
            with self.assertRaises(NativeAudioError):mixer.push_translation(raw)
        for level in (True,-.1,1.1,math.inf,math.nan,'1'):
            with self.assertRaises(NativeAudioError):mixer.set_levels(original=level)
        for timeout in (True,-1,11,math.inf,'3'):
            with self.assertRaises(NativeAudioError):mixer.finish(timeout)
        self.assertEqual(driver.chunks,[])

    def test_finish_timeout_does_not_reset_or_discard_pending_pcm(self):
        class Blocking(Driver):
            def __init__(self):super().__init__();self.release=threading.Event()
            def write(self,raw):self.written.set();self.release.wait(1);super().write(raw)
            def close(self):self.release.set();super().close()
        driver=Blocking();mixer=NativeMixer(driver);self.addCleanup(mixer.close)
        mixer.push_translation(pcm(1,960));self.assertTrue(driver.written.wait(.5))
        self.assertFalse(mixer.finish(.01));self.assertGreater(mixer._sizes['translation'],0)
        driver.release.set();self.assertTrue(mixer.finish());self.assertEqual(b''.join(driver.chunks),pcm(round(.85),960))

    def test_winmm_structures_use_pointer_sized_handles_and_prepare_write_unprepare_close(self):
        calls=[];headers=[];live_headers=[];maximum_pending=0
        class Function:
            def __init__(self,name):self.name=name;self.argtypes=None;self.restype=None
            def __call__(self,*args):
                nonlocal maximum_pending
                calls.append(self.name)
                if self.name=='CreateEventW':return 0x111222333 if ctypes.sizeof(ctypes.c_void_p)==8 else 0x11122
                if self.name=='waveOutOpen':
                    self.format=bytes(ctypes.string_at(args[2],18));args[0]._obj.value=0x123456789 if ctypes.sizeof(ctypes.c_void_p)==8 else 0x12345
                    self.callback=args[3];self.flags=args[5]
                if self.name=='waveOutWrite':
                    header=args[1]._obj;headers.append((header.dwBufferLength,bytes(ctypes.string_at(header.lpData,header.dwBufferLength)),ctypes.sizeof(header)));live_headers.append(header)
                    maximum_pending=max(maximum_pending,sum(not item.dwFlags&1 for item in live_headers))
                if self.name=='WaitForSingleObject':
                    for header in live_headers:header.dwFlags|=1
                return 0
        class Library:
            def __getattr__(self,name):value=Function(name);setattr(self,name,value);return value
        library=Library()
        with patch.object(native_audio.os,'name','nt'),patch.object(native_audio.ctypes,'WinDLL',return_value=library,create=True):
            driver=native_audio._WaveOutDriver()
            for _ in range(5):driver.write(pcm(-123))
            progress=driver.stats();self.assertEqual(progress['submitted_bytes'],5*FRAME_BYTES)
            self.assertEqual(progress['submitted_frames'],5);self.assertEqual(progress['position_bytes'],0)
            self.assertEqual(progress['position_reported_by'],'winmm_TIME_BYTES')
            self.assertTrue(driver.drain(.1));driver.close();driver.close()
        self.assertEqual(headers[0][0],FRAME_BYTES);self.assertEqual(headers[0][1],pcm(-123))
        self.assertEqual(headers[0][2],48 if ctypes.sizeof(ctypes.c_void_p)==8 else 32)
        self.assertEqual(struct.unpack('<HHIIHHH',library.waveOutOpen.format),(1,1,24000,48000,2,16,0))
        self.assertEqual(calls.count('waveOutOpen'),1);self.assertEqual(calls.count('waveOutClose'),1)
        self.assertIn('waveOutUnprepareHeader',calls);self.assertLess(calls.index('waveOutReset'),calls.index('waveOutClose'))
        self.assertEqual(calls.count('timeBeginPeriod'),1);self.assertEqual(calls.count('timeEndPeriod'),1)
        self.assertEqual(calls.count('CreateEventW'),1);self.assertEqual(calls.count('CloseHandle'),1)
        self.assertEqual(maximum_pending,4);self.assertGreaterEqual(calls.count('WaitForSingleObject'),2)
        self.assertEqual(library.waveOutOpen.flags,0x00050000);self.assertTrue(library.waveOutOpen.callback)
        self.assertLess(calls.index('timeBeginPeriod'),calls.index('waveOutWrite'));self.assertLess(calls.index('waveOutClose'),calls.index('timeEndPeriod'))


if __name__=='__main__':unittest.main()
