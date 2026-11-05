"""Bounded, explicit Melodi narration. No fallback voice, retries or user audio."""
from array import array
import math
from pathlib import Path
import sys
import wave
from packages.providers.cartesia_melodi import open_cartesia_speech, SAMPLE_RATE, MODEL, VOICES


def make_narration(folder, texts, duration, cancelled, require=lambda:None, opener=None):
    if not isinstance(texts,list) or len(texts)!=4 or any(not isinstance(t,str) or not 1<=len(t)<=180 for t in texts):
        raise ValueError('La locución necesita cuatro frases de hasta 180 caracteres.')
    opener=opener or open_cartesia_speech
    starts=[duration*x for x in (.017,.24,.485,.74)]
    mixed=array('h',[0])*round(duration*SAMPLE_RATE);segments=[]
    for index,text in enumerate(texts):
        require()
        if cancelled.is_set():raise ValueError('Locución cancelada.')
        pcm=bytearray()
        with opener(text,'es',1.05) as stream:
            while True:
                if cancelled.is_set():raise ValueError('Locución cancelada.')
                chunk=stream.read1(8192)
                if not chunk:break
                pcm.extend(chunk)
        samples=array('h');samples.frombytes(pcm)
        if sys.byteorder!='little':samples.byteswap()
        length=len(samples)/SAMPLE_RATE
        end=starts[index+1]-.25 if index<3 else duration-.7
        if not samples or starts[index]+length>end:
            raise ValueError('La frase no cabe en su plano; se conserva el audio sin truncar ni acelerar.')
        offset=round(starts[index]*SAMPLE_RATE);fade=round(.008*SAMPLE_RATE)
        for j,value in enumerate(samples):
            gain=min(1,j/fade,(len(samples)-1-j)/fade)
            mixed[offset+j]=round(value*gain)
        segments.append({'start':round(starts[index],3),'duration':round(length,3),'characters':len(text)})
    levels=[]
    for start in range(0,len(mixed),600):
        part=mixed[start:start+600];rms=math.sqrt(sum(v*v for v in part)/max(1,len(part)))/32768
        levels.append(round(min(1,rms*9),4))
    peak=max(abs(v) for v in mixed)/32768
    if peak<=.001:raise ValueError('La voz devuelta está vacía o es inaudible.')
    path=Path(folder)/'assets/melodi.wav'
    output=array('h',mixed)
    if sys.byteorder!='little':output.byteswap()
    with wave.open(str(path),'wb') as target:
        target.setnchannels(1);target.setsampwidth(2);target.setframerate(SAMPLE_RATE);target.writeframes(output.tobytes())
    return {'path':'assets/melodi.wav','provider':'Cartesia','model':MODEL,'voice_id':VOICES['es'],
            'language':'es','segments':segments,'sample_rate':SAMPLE_RATE,'duration':duration,
            'levels':levels,'levels_hz':40,'external_calls':4,'peak':round(peak,5),'billing_amount':None}
