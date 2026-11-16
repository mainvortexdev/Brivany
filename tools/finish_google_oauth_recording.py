"""Sanitize the existing native-window recording; no new Google interaction.

Keeps the real browser chrome/client ID. Opaque masks remove addresses and
the private loopback callback URL. Long unchanged sections are trimmed.
"""
from pathlib import Path
import json,re,subprocess
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
PRIVATE=ROOT/'.local/video-private/brivany-google-oauth-supplement-20261108'
OUT=ROOT/'Exports/Brivany-Google-Demo-20261108'
SANITIZED=PRIVATE/'sanitized-native';SANITIZED.mkdir(exist_ok=True)
OCR={x['file']:x for x in json.loads((PRIVATE/'consent-ocr-private.json').read_text(encoding='utf-8-sig'))}

def sanitize(index):
 name=f'frame-{index:04d}.png';im=Image.open(PRIVATE/'native-frames'/name).convert('RGB');draw=ImageDraw.Draw(im)
 if index<=153:
  shifted=148<=index<=152;top=360 if shifted else 460
  right=399 if 122<=index<=143 else 468
  draw.rectangle((265,top,right,top+25),fill=im.getpixel((470,top)))
  y=327 if shifted else 427
  draw.rectangle((895,y,1019,y+24),fill=im.getpixel((990,y-4)))
  for line in OCR[name]['lines']:
   for word in line['words']:
    if re.search(r'@|gmail[.,]com|vetsa[.,]es|felixdan',word['text'],re.I):
     x,y,w,h=(int(word[k]) for k in ('x','y','width','height'))
     # Manual regions above also cover partially occluded addresses.
     draw.rectangle((x-2,y-2,x+w+2,y+h+2),fill=im.getpixel((max(0,x-5),max(0,y-2))))
 if 154<=index<=171:draw.rounded_rectangle((253,103,1026,137),radius=15,fill=(48,48,48))
 im=im.crop((0,42,1280,884));path=SANITIZED/name;im.save(path);return path

# Each range retains the captured frames and 1.25-second acquisition cadence.
# Cuts remove waiting only; no consent screen or URL is reconstructed.
indices=[110,111,112,*range(122,127),*range(137,154),154,155,156,172]
paths=[sanitize(i) for i in indices]
playlist=PRIVATE/'native-redacted.ffconcat'
lines=['ffconcat version 1.0']
for i,p in enumerate(paths):
 lines.extend(["file '"+p.as_posix()+"'",'duration '+str(3 if i==len(paths)-1 else 1.25)])
lines.append("file '"+paths[-1].as_posix()+"'");playlist.write_text('\n'.join(lines)+'\n',encoding='utf-8')
video=OUT/'Brivany-Google-OAuth-Consentimiento.mp4'
subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(playlist),
 '-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-vf','scale=-2:1080:flags=lanczos,pad=1920:1080:(ow-iw)/2:0:color=0x111214,fps=30,format=yuv420p',
 '-c:v','libx264','-preset','fast','-crf','18','-c:a','aac','-b:a','96k','-shortest','-movflags','+faststart',str(video)],check=True)
info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(video)]))
subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(video),'-f','null','-'],check=True)
report={'file':video.name,'duration_seconds':float(info['format']['duration']),'source':'Existing real native-window recording','recorded_frames_used':len(paths),'browser_chrome_preserved':True,'client_id_bar_preserved':True,'email_redaction':'opaque; OCR plus manual masks','callback_url_redacted':True,'consent_language':'English','new_google_authorizations':0,'privacy_ocr':'pending'}
(OUT/'OAuth-Consentimiento-validacion.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
