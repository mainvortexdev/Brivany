"""Measured dialogue timing and a locally generated telephone ringback.

Speech and laughter use Cartesia. Spoken PCM retains its native tempo; the
timeline adapts around it. A ringback is an effect, never a telephony request.
"""
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import wave

RATE=24000


def write_ringback(path,duration):
    samples=array('h')
    for n in range(round(duration*RATE)):
        t=n/RATE;phase=t%6
        # North-American ringback: 440+480 Hz, two seconds on/four off.
        gate=max(0,min(1,phase/.015,(2-phase)/.03,(duration-t)/.05))
        samples.append(round(2600*gate*(math.sin(2*math.pi*440*t)+math.sin(2*math.pi*480*t))))
    with wave.open(str(path),'wb') as out:
        out.setparams((1,2,RATE,0,'NONE','not compressed'));out.writeframes(samples.tobytes())
    return Path(path)


def finish_call_duration(folder,duration,fps,*,command,cancelled):
    """Keep the container length at the audio sample boundary, not a ceil frame.

    A fractional final video frame otherwise rounds the requested runtime up.
    The independent AAC edit list retains exactly the requested PCM sample count.
    The original render remains available for inspection.
    """
    video=folder/'call-picture.mp4';sound=folder/'call-sound.m4a';final=folder/'call-final.mp4'
    command('trim_picture','ffmpeg',['-nostdin','-v','error','-y','-i',folder/'Brivany.mp4','-map','0:v:0','-an','-c:v','copy','-frames:v',math.floor(duration*fps),video],folder,cancelled)
    samples=round(duration*44100)
    command('fit_duration','ffmpeg',['-nostdin','-v','error','-y','-i',folder/'assets/mix.wav','-vn','-af',f'aresample=44100,apad=whole_len={samples},atrim=end_sample={samples}',
            '-c:a','aac','-b:a','192k','-ar','44100',sound],folder,cancelled)
    command('mux_call','ffmpeg',['-nostdin','-v','error','-y','-i',video,'-i',sound,'-map','0:v:0','-map','1:a:0','-c','copy','-movie_timescale','44100','-movflags','+faststart',final],folder,cancelled)
    os.replace(folder/'Brivany.mp4',folder/'call-render.mp4')
    os.replace(final,folder/'Brivany.mp4')


def soften_laughter(pcm):
    """Keep one complete short chuckle at low gain, without changing its rate."""
    data=array('h',pcm);limit=round(1.6*RATE)
    if len(data)>limit:
        # Finish in a quiet inter-breath valley, before a long laugh's next burst.
        candidates=range(round(1.05*RATE),limit,240)
        end=min(candidates,key=lambda n:sum(v*v for v in data[n-480:n+480])/960+(.1*(n/RATE-1.35))**2)
        data=data[:end]
    edge=min(480,len(data)//4)
    return array('h',(round(v*.4*min(1,i/max(1,edge),(len(data)-1-i)/max(1,edge))) for i,v in enumerate(data))).tobytes()


def reference_voices(plan,folder,*,command,cancelled,require,progress,parent=None):
    from packages.providers.cartesia_melodi import character_voice_id,open_character_speech
    from packages.providers.dubbing_audio import trim_synthesis_padding
    from .call_visuals import pcm_energy
    segments=[];clock=0;plan['timing']='dialogue'
    usage_path=folder/'voice-usage.json'
    usage=json.loads(usage_path.read_text(encoding='utf-8')) if usage_path.is_file() else {'provider':'Cartesia','requests_started':0,'requests_completed':0,'characters':0,'amount':None}
    def source_pcm(raw,text,role,gender):
        nonlocal usage
        require()
        if cancelled.is_set():raise ValueError('Locución cancelada.')
        voice_id=character_voice_id(role,gender=gender);metadata=raw.with_suffix('.json')
        identity={'voice_id':voice_id,'text_sha256':hashlib.sha256(text.encode()).hexdigest()};calls=0
        cached=parent/'assets'/raw.name if parent else None
        if not raw.exists() and cached and cached.is_file() and not cached.is_symlink() and cached.with_suffix('.json').is_file() and json.loads(cached.with_suffix('.json').read_text(encoding='utf-8'))==identity:
            shutil.copyfile(cached,raw);shutil.copyfile(cached.with_suffix('.json'),metadata)
        if raw.exists():
            if raw.is_symlink() or not metadata.is_file() or json.loads(metadata.read_text(encoding='utf-8'))!=identity:raise ValueError('La caché de voz no corresponde al personaje o al texto.')
        else:
            usage['requests_started']+=1;usage['characters']+=len(text);usage_path.write_text(json.dumps(usage),encoding='utf-8')
            pcm=bytearray()
            with open_character_speech(text,role,'es',1,gender=gender) as stream:
                while block:=stream.read1(8192):
                    if cancelled.is_set():raise ValueError('Locución cancelada.')
                    pcm.extend(block)
            if not pcm:raise ValueError('Cartesia no produjo un fragmento completo.')
            trimmed,_,_=trim_synthesis_padding(bytes(pcm))
            with wave.open(str(raw),'wb') as out:out.setparams((1,2,RATE,0,'NONE','not compressed'));out.writeframes(trimmed)
            metadata.write_text(json.dumps(identity),encoding='utf-8');calls=1
            usage['requests_completed']+=1;usage_path.write_text(json.dumps(usage),encoding='utf-8')
        with wave.open(str(raw),'rb') as source:
            if source.getnchannels()!=1 or source.getsampwidth()!=2 or source.getframerate()!=RATE:raise ValueError('La caché de voz no es PCM16 mono de 24 kHz.')
            return source.readframes(source.getnframes()),calls

    for scene in plan['scenes']:
        if not scene['narration'].strip():clock+=scene['duration'];continue
        role=scene['speaker'];person=next(p for p in plan['participants'] if p['id']==role)
        voice_id=character_voice_id(role,gender=person.get('gender'))
        cues=scene.get('speech_cues',[{'start':0,'duration':scene.get('speech_duration',scene['duration']),'text':scene['narration']}])
        joined=bytearray();calls=0;chars=0;native=[];updated=[];laugh=b''
        if scene.get('laughter'):
            raw=folder/'assets'/('voice-laughter-'+role+'-source.wav')
            pcm,new=source_pcm(raw,'[laughter]',role,person.get('gender'));calls+=new;chars+=new*len('[laughter]');laugh=soften_laughter(pcm)
        if scene.get('laughter')=='before':joined.extend(laugh+b'\0\0'*round(.08*RATE))
        for i,cue in enumerate(cues):
            require()
            if cancelled.is_set():raise ValueError('Locución cancelada.')
            progress('Preparando '+person['name']+' · '+scene['id']+f' ({i+1}/{len(cues)})')
            if i:
                gap=max(0,min(.22,cue['start']-cues[i-1]['start']-cues[i-1]['duration']))
                joined.extend(b'\0\0'*round(gap*RATE))
            raw=folder/'assets'/('voice-'+scene['id']+'-'+str(i)+'-source.wav')
            pcm,new=source_pcm(raw,cue['text'],role,person.get('gender'));calls+=new;chars+=new*len(cue['text'])
            start=len(joined)/(RATE*2);seconds=len(pcm)/(RATE*2)
            joined.extend(pcm);updated.append({'start':start,'duration':seconds,'text':cue['text']})
            native.append({'path':str(raw),'start':start,'duration':seconds,'pcm_sha256':hashlib.sha256(pcm).hexdigest(),'tempo':1})
        if scene.get('laughter')=='after':joined.extend(b'\0\0'*round(.08*RATE)+laugh)
        scene.update(speech_duration=len(joined)/(RATE*2),speech_cues=updated)
        path=folder/'assets'/('voice-'+scene['id']+'.wav')
        with wave.open(str(path),'wb') as out:out.setparams((1,2,RATE,0,'NONE','not compressed'));out.writeframes(joined)
        segments.append({'path':str(path),'scene_id':scene['id'],'start':clock+scene.get('speech_offset',0),'duration':len(joined)/(RATE*2),
                         'text':scene['narration'],'speaker':role,'voice_id':voice_id,'energy':pcm_energy(path),'reused':not calls,
                         'synthesis_calls':calls,'synthesis_characters':chars,'tempo_ratios':[1]*len(cues),'native_sources':native,
                         'laughter_seconds':len(laugh)/(RATE*2),'voice_time_stretched':False})
        clock+=scene['duration']
    return segments
