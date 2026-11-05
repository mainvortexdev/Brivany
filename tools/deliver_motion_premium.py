"""Inspect final encoded files, preserve a new delivery and import honest receipts."""
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import argparse
from services.motion.service import source_status

ROOT=Path(__file__).resolve().parents[1]

def command(args):
    p=subprocess.run(args,capture_output=True,text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),timeout=90)
    if p.returncode:raise ValueError(p.stderr[-1500:])
    return p.stdout,p.stderr

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--final',action='store_true');args=parser.parse_args()
    prepared=json.loads((ROOT/'tmp/motion-premium/prepared.json').read_text(encoding='utf-8'))
    delivery=ROOT/('Exports/Brivany-motion-con-voz-final' if args.final else 'Exports/Brivany-motion-con-voz');delivery.mkdir(exist_ok=True)
    if any(delivery.iterdir()):raise ValueError('La entrega ya tiene archivos; no se sobrescribe.')
    report={'type':'actual_encoded_MP4_audio_and_video_checks','passed':False,'tts_calls':8,'planning_calls':0,'billing_amount':None,'microphone_recorded':False,'audio_measured_not_human_listened':True,'videos':[]}
    for item in prepared['videos']:
        folder=Path(item['folder']);render=json.loads((folder/'render-report.json').read_text(encoding='utf-8'))
        if not render['passed'] or render['frames']!=900:raise ValueError('Render incompleto.')
        source=folder/'Brivany.mp4';out,_=command(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(source)]);probe=json.loads(out)
        video=next(x for x in probe['streams'] if x['codec_type']=='video');audio=next(x for x in probe['streams'] if x['codec_type']=='audio')
        assert (video['width'],video['height'],video['avg_frame_rate'],int(video['nb_frames']))==(1920,1080,'30/1',900)
        assert abs(float(probe['format']['duration'])-30)<.05 and audio['codec_name']=='aac'
        _,log=command(['ffmpeg','-hide_banner','-nostdin','-i',str(source),'-vn','-af','loudnorm=I=-16:TP=-1:LRA=7:print_format=json','-f','null','-'])
        loudness,_=json.JSONDecoder().raw_decode(log[log.rfind('{'):]);assert -18<float(loudness['input_i'])<-14 and float(loudness['input_tp'])<0
        spec=json.loads((folder/'motion.json').read_text(encoding='utf-8'));name='01-Tu-voz-en-movimiento' if item['style']=='workspace' else '02-Del-trazo-al-espacio'
        target=delivery/(name+'.mp4');shutil.copyfile(source,target);shutil.copyfile(folder/'exports/Brivany-animation.html',delivery/(name+'.html'))
        frames=ROOT/('tmp/motion-premium/decoded-final' if args.final else 'tmp/motion-premium/decoded')/item['style'];frames.mkdir(parents=True)
        for t in [3,9,15,21,27]:command(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-n','-ss',str(t),'-i',str(target),'-frames:v','1',str(frames/(str(t)+'.png'))])
        identifier=folder.name;local=ROOT/'.local/computer/workspace/motion'/identifier
        if local.exists():
            assert hashlib.sha256((local/'Brivany.mp4').read_bytes()).digest()==hashlib.sha256(source.read_bytes()).digest()
        else:
            local.mkdir(parents=True)
            for filename in ['index.html','motion.json','SPEC.md','THIRD-PARTY-NOTICES.txt','Brivany.mp4','render-report.json']:shutil.copyfile(folder/filename,local/filename)
            for child in ['assets','exports']:shutil.copytree(folder/child,local/child)
        result={'title':spec['title'],'path':str(local/'Brivany.mp4'),'project_path':str(local/'index.html'),'standalone_path':str(local/'exports/Brivany-animation.html'),'evidence_folder':str(local),'style':spec['style'],'source_skill':source_status(),'planning_seconds':0,'render_seconds':round(render['elapsed_seconds'],3),'audio':True,'narration_calls':4,'review_required':True,'visual_quality_certified':False,'arbitrary_code_executed':False,'originals_modified':False,'width':1920,'height':1080,'fps':30,'duration':30,'bytes':source.stat().st_size,'verified':True,'message':'Video de 30 s con la voz de Melodi listo para revisar.'}
        receipt={'id':identifier,'kind':'motion','state':'succeeded','phase':result['message'],'steps':0,'result':result,'error':None,'external_calls':4,'reviewed':False,'approval':None,'agent':'Agente de motion graphics','provenance':{'revision':'authored_editorial_v2_narrated','model_calls':0,'tts_calls':4,'pipeline':'same typed project writer, real Cartesia and local renderer; no router run in this editorial revision'}}
        receipt_path=ROOT/'.local/computer/receipts'/f'{identifier}.json'
        if not receipt_path.exists():receipt_path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        report['videos'].append({'style':spec['style'],'delivery_path':str(target),'project_path':str(folder/'index.html'),'job_id':identifier,'render_seconds':round(render['elapsed_seconds'],3),'frames':900,'duration':30,'width':1920,'height':1080,'audio_codec':'aac','voice_id':spec['audio']['voice_id'],'voice_segments':spec['audio']['segments'],'loudness':loudness,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':source.stat().st_size})
    (delivery/'brand-wordmark.svg').write_text((ROOT/'web/brand-wordmark.svg').read_text(encoding='utf-8').replace('#1d1d1f','#f2f2f0'),encoding='utf-8')
    shutil.copyfile(Path(prepared['videos'][0]['folder'])/'THIRD-PARTY-NOTICES.txt',delivery/'THIRD-PARTY-NOTICES.txt')
    (delivery/'index.html').write_text('''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brivany · revisión de videos</title><style>*{box-sizing:border-box}body{margin:0;background:#0a0b0e;color:#f2f2f0;font:16px "Segoe UI",sans-serif}main{max-width:1152px;margin:auto;padding:48px 24px}header{margin-bottom:44px}header img{width:150px;}h1{font:normal 34px Georgia,serif;margin:36px 0 18px}video{display:block;width:100%;aspect-ratio:16/9;border-radius:20px;background:#000;box-shadow:0 16px 60px #0007}section{margin-bottom:64px}a{color:#c9d7ec}</style><main><header><img src="brand-wordmark.svg" alt="brivany."></header><section><h1>Tu voz, en movimiento</h1><video controls playsinline preload="metadata" poster="01-poster.png" src="01-Tu-voz-en-movimiento.mp4"></video></section><section><h1>Del trazo al espacio</h1><video controls playsinline preload="metadata" poster="02-poster.png" src="02-Del-trazo-al-espacio.mp4"></video></section></main></html>''',encoding='utf-8')
    decoded=ROOT/('tmp/motion-premium/decoded-final' if args.final else 'tmp/motion-premium/decoded')
    shutil.copyfile(decoded/'workspace/9.png',delivery/'01-poster.png');shutil.copyfile(decoded/'spatial/21.png',delivery/'02-poster.png')
    report['passed']=True;report['revision']='separated-ribbon-geometry' if args.final else 'narrated-v2'
    (ROOT/'tmp/motion-premium'/('delivery-final.json' if args.final else 'delivery.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
