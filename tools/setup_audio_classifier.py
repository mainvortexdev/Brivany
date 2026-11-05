"""Install the fixed official Google YAMNet asset; never uploads user audio."""
import hashlib
import json
from pathlib import Path
from urllib.request import Request,build_opener
import zipfile
from packages.providers.live_voice import NoRedirect

ROOT=Path(__file__).resolve().parents[1]
URL='https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite'


def main():
    folder=ROOT/'desktop/assets/audio';folder.mkdir(parents=True,exist_ok=True);path=folder/'yamnet.tflite'
    if not path.exists():
        with build_opener(NoRedirect()).open(Request(URL,headers={'User-Agent':'Brivany-Model-Setup/1.0'}),timeout=40) as reply:raw=reply.read(20000001)
        if not 1000000<len(raw)<=20000000 or raw[4:8]!=b'TFL3':raise ValueError('Unexpected model asset.')
        with path.open('xb') as output:output.write(raw)
    raw=path.read_bytes()
    with zipfile.ZipFile(path) as archive:
        labels=next(name for name in archive.namelist() if name.endswith('.txt'))
        data=archive.read(labels).decode('utf-8');(folder/'yamnet-labels.txt').write_text(data,encoding='utf-8')
    manifest={'model':'Google YAMNet AudioSet','source':URL,'sha256':hashlib.sha256(raw).hexdigest(),'size_bytes':len(raw),'license':'Apache-2.0','labels':len(data.splitlines())}
    (folder/'yamnet-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8');print(json.dumps(manifest))


if __name__=='__main__':main()
