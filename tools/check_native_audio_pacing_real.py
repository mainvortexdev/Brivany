"""Diagnose PCM mixer pacing with digital silence, without a provider API.

--allow-local-device opens Windows output with synthetic zero PCM only. Reports
contain aggregate durations and counters; no WAV or original media is saved.
"""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import statistics
import threading
import time
from packages.providers.native_audio import NativeMixer,_WaveOutDriver


def distribution(values):
    ordered=sorted(values)
    return {'count':len(values),'mean_ms':round(statistics.mean(values),3) if values else None,
        'p95_ms':round(ordered[min(len(ordered)-1,int(len(ordered)*.95))],3) if values else None,
        'max_ms':round(max(values),3) if values else None}


class ImmediateDriver:
    def write(self,raw):pass
    def drain(self,timeout):return True
    def close(self):pass


class ObservedDriver:
    def __init__(self,driver):self.driver=driver;self.durations=[];self.bytes=0;self.paced_output=getattr(driver,'paced_output',False)
    def write(self,raw):
        start=time.monotonic();self.driver.write(raw);self.durations.append((time.monotonic()-start)*1000);self.bytes+=len(raw)
    def drain(self,timeout):return self.driver.drain(timeout)
    def close(self):self.driver.close()


def run(seconds,backend):
    driver=ObservedDriver(_WaveOutDriver() if backend=='windows_winmm' else ImmediateDriver())
    mixer=NativeMixer(driver,original=.12,translation=.85);errors=[];lags={'original':[],'translation':[]};start=time.monotonic()+.05
    silence=bytes(1920);stop=threading.Event()
    def producer(kind,delay):
        index=0
        try:
            while True:
                deadline=start+delay+index*.04
                if deadline>=start+seconds or stop.is_set():return
                if stop.wait(max(0,deadline-time.monotonic())):return
                lags[kind].append(max(0,(time.monotonic()-deadline)*1000))
                getattr(mixer,'push_'+kind)(silence);index+=1
        except Exception as error:
            errors.append({'kind':kind,'code':getattr(error,'code','unexpected'),'message':str(error),'after_seconds':round(time.monotonic()-start,3)});stop.set()
    threads=[threading.Thread(target=producer,args=('original',0)),threading.Thread(target=producer,args=('translation',min(8,seconds/3)))]
    for thread in threads:thread.start()
    try:
        for thread in threads:thread.join(seconds+2)
        complete=not any(thread.is_alive() for thread in threads)
        drained=mixer.finish(timeout=4) if complete and not errors else False
        report={'backend':backend,'seconds_requested':seconds,'elapsed_seconds':round(time.monotonic()-start,3),
            'producer_completed':complete,'drained':drained,'mixer':mixer.stats(),'driver_write':distribution(driver.durations),
            'timer_1ms_requested':getattr(driver.driver,'_period_active',False),
            'driver_bytes':driver.bytes,'producer_lag':{key:distribution(values) for key,values in lags.items()},'errors':errors}
    except Exception as error:
        report={'backend':backend,'seconds_requested':seconds,'mixer':mixer.stats(),'errors':errors+[{'code':getattr(error,'code','unexpected'),'message':str(error)}]}
    finally:
        stop.set()
        try:mixer.close()
        except Exception as error:report.setdefault('errors',[]).append({'phase':'close','code':getattr(error,'code','unexpected'),'message':str(error)})
        for thread in threads:thread.join(timeout=1)
    return report


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--allow-local-device',action='store_true')
    parser.add_argument('--seconds',type=int,default=24);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--backend',choices=['both','immediate_fake','windows_winmm'],default='both')
    args=parser.parse_args(argv)
    if not args.allow_local_device:parser.error('Explicit --allow-local-device required to open Windows output with digital silence.')
    if not 6<=args.seconds<=30:parser.error('--seconds must be from 6 to 30.')
    output=args.output.absolute();output.parent.mkdir(parents=True,exist_ok=True)
    reports=[]
    for backend in (('immediate_fake','windows_winmm') if args.backend=='both' else (args.backend,)):
        try:reports.append(run(args.seconds,backend))
        except Exception as error:reports.append({'backend':backend,'errors':[{'code':getattr(error,'code','unexpected'),'message':str(error)}]})
    report={'format':'brivany-native-audio-pacing-1','recorded_at':datetime.now(timezone.utc).isoformat(),
        'fixture':'digital_zero_pcm16_mono_24000_no_audio_file','external_calls':0,'gpu_seconds':0,
        'physical_output_verified':False,'latency_scope':'local_mixer_and_driver_schedule_not_audible_translation','reports':reports}
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
    return 0 if all(not item.get('errors') and item.get('drained') for item in reports) else 1


if __name__=='__main__':raise SystemExit(main())
