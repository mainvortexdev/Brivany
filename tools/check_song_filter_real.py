"""Local classifier on a CC0 singing sample and own offline speech fixture."""
import hashlib
import json
import time
from pathlib import Path
import shutil
import subprocess
from urllib.parse import quote
from urllib.request import Request,urlopen
import numpy as np
from packages.providers.audio_content import SingingFilter,melody_features

ROOT=Path(__file__).resolve().parents[1]
SOURCE='https://commons.wikimedia.org/wiki/File:Twinkle_Twinkle_Little_Star_-_sung_with_full_lyrics.ogg'


def main():
    folder=ROOT/'tmp/song-filter';folder.mkdir(exist_ok=True)
    name='Twinkle_Twinkle_Little_Star_-_sung_with_full_lyrics.ogg';digest=hashlib.md5(name.encode()).hexdigest();song=folder/'cc0-singing.ogg'
    if not song.exists():
        url='https://upload.wikimedia.org/wikipedia/commons/'+digest[0]+'/'+digest[:2]+'/'+quote(name)
        with urlopen(Request(url,headers={'User-Agent':'Brivany-Audio-Test/1.0 (+https://brivany.example)'}),timeout=30) as response:raw=response.read(4000001)
        if not 10000<len(raw)<4000000:raise ValueError('Unexpected test fixture.')
        song.write_bytes(raw)
    ffmpeg=shutil.which('ffmpeg')
    if not ffmpeg:raise ValueError('ffmpeg required for the local fixture only.')
    def pcm(path,at=0):
        return subprocess.run([ffmpeg,'-nostdin','-v','error','-protocol_whitelist','file,pipe','-ss',str(at),'-i',str(path),'-t','3','-f','s16le','-ar','24000','-ac','1','pipe:1'],check=True,capture_output=True,timeout=15).stdout
    speech=pcm(ROOT/'tmp/dictation-capture/own-synthetic-fixture.wav');singing=pcm(song,5);singing_later=pcm(song,18)
    human=folder/'google-speech.wav'
    if not human.exists():
        with urlopen('https://storage.googleapis.com/mediapipe-assets/speech_16000_hz_mono.wav',timeout=30) as response:raw=response.read(2000001)
        if len(raw)>2000000:raise ValueError('Unexpected speech fixture.')
        human.write_bytes(raw)
    human_speech=pcm(human)
    mixed=np.clip(np.frombuffer(speech,dtype='<i2')*.8+np.frombuffer(singing,dtype='<i2')*.12,-32768,32767).astype('<i2').tobytes()
    model=SingingFilter();rows=[]
    for name,data,expected in [('speech',speech,False),('human_speech',human_speech,False),('singing',singing,True),('singing_later',singing_later,True),('dialogue_over_song',mixed,False)]:
        result=model.classify(data);rows.append({'case':name,'expected_skip':expected,'matched':result['skip']==expected,**result,'acoustics':melody_features(data)})
    report={'passed':all(row['matched'] for row in rows),'scope':'local real YAMNet inference on controlled audio fixtures','rows':rows,'music_sample_source':SOURCE,'music_sample_author':'Derrick Coetzee (Dcoetzee)','music_sample_license':'CC0','voice_cloning_used':False,'original_audio_attached':False,'paid_inference_requests':0,'billing_amount':None}
    (folder/('report-'+str(time.time_ns())+'.json')).write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report));return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
