"""Opt-in Melodi routing, queue and providers on an owned short video fixture."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import wave
from PIL import Image,ImageDraw,ImageFont
from services.computer.runtime import ROOT
from services.computer.service import ComputerService
from services.h1.server import load_local_config
from packages.providers.conversation import ConversationRequest
from services.terminal.recipes import literal


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');parser.add_argument('--translation',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('La prueba usa proveedores reales; requiere --run.')
    load_local_config();folder=ROOT/'tmp/media-real';folder.mkdir(exist_ok=True)
    source=folder/'Prueba-Melodi.mp4';speech=folder/'speech.wav'
    if not source.exists():
        command="Add-Type -AssemblyName System.Speech; $s=[System.Speech.Synthesis.SpeechSynthesizer]::new(); $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet,[System.Speech.Synthesis.VoiceAge]::NotSet,0,[Globalization.CultureInfo]::GetCultureInfo('en-US')); $s.SetOutputToWaveFile("+literal(speech)+"); $s.Speak('The red square is on the right. This is a test video.'); $s.Dispose()"
        subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
        with wave.open(str(speech)) as wav:duration=wav.getnframes()/wav.getframerate()
        image=Image.new('RGB',(640,360),'white');draw=ImageDraw.Draw(image);font=ImageFont.truetype('C:/Windows/Fonts/georgia.ttf',28)
        draw.text((24,28),'Prueba de video de Melodi',fill='black',font=font);draw.rectangle((440,140,550,250),fill='red');image.save(folder/'scene.png')
        subprocess.run([shutil.which('ffmpeg'),'-nostdin','-v','error','-n','-loop','1','-i',str(folder/'scene.png'),'-i',str(speech),'-t',str(duration),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',str(source)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    service=ComputerService('http://127.0.0.1:1',lambda:None,root=ROOT/'.local/media-real',native=True)
    report={'type':'real_melodi_media_owned_fixture','provider_cost':'unknown','started_at':datetime.now(timezone.utc).isoformat(),'jobs':[],'source_original_modified':False}
    goals=['De este video extrae el audio en WAV y déjalo en la carpeta Evidencia Melodi Medios en Documentos','Describe lo que se ve en el video adjunto, incluido el color y posición del cuadrado.']
    if args.translation:goals.append('Traduce el video adjunto al español y deja el video traducido en la carpeta Evidencia Melodi Medios en Documentos.')
    try:
        service.select_edits_inputs([str(source)]);token=service.arm()['token']
        for goal in goals:
            route=service.planner.route(ConversationRequest(text=goal,consent=True))
            if route['kind']!='media':raise ValueError('Enrutador eligió '+route['kind'])
            job=service.enqueue('media',goal,token);value=service.jobs[job['id']];last=None;deadline=time.monotonic()+240
            while time.monotonic()<deadline:
                if value['phase']!=last:print(value['phase'],flush=True);last=value['phase']
                if value['finished'].wait(.5):break
            report['jobs'].append(service.public(value))
            if value['state']!='succeeded':raise ValueError('Trabajo incompleto: '+str(value.get('error') or value['phase']))
        report['source_original_modified']=hashlib.sha256(source.read_bytes()).hexdigest()!=digest
        report['success']=not report['source_original_modified']
    except Exception as error:report.update(success=False,error_type=type(error).__name__,error=str(error));raise
    finally:
        (folder/'latest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False,indent=2),flush=True);service.close()


if __name__=='__main__':main()
