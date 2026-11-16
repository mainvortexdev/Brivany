"""Temporary independent extension ASR service. No translation, TTS or recording."""
from pathlib import Path
import json,os,sys,threading
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
os.environ.setdefault('BRIVANY_DATA_DIR',str(Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data'))
from services.h1.server import load_local_config
from services.work.selected_video import SelectedVideoHub
from services.work.sync_relay import SyncRelay
from services.work.extension_identity import BRIVANY_EXTENSION_ORIGIN

def unavailable():raise ValueError('Este enlace solo permite transcripción.')

if __name__=='__main__':
 load_local_config()
 hub=SelectedVideoHub(preferences=lambda:{'show_transcript':True})
 relay=SyncRelay(port=48218,automatic_origin=BRIVANY_EXTENSION_ORIGIN,video_hub=hub,bridge_factory=unavailable).start()
 print(json.dumps({'port':48218,'mode':'transcription_only','translation':False,'tts':False,'audio_persisted':False}),flush=True)
 try:threading.Event().wait()
 except KeyboardInterrupt:pass
 finally:relay.close();hub.close()
