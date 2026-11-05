"""Model proposes copy, never executable code. Fixed seekable scenes render locally."""
from datetime import datetime,timezone
from html import escape
import hashlib
import json
import re
from pathlib import Path
import shutil
import time
from uuid import UUID
from services.terminal.executor import TerminalExecutor

ROOT=Path(__file__).resolve().parents[2]
STUDIO=ROOT/'motion-studio'
PROMPT='''Eres Melodi, diseñadora de motion graphics de Brivany con Bang Motion.
Devuelve sólo JSON con los campos obligatorios: style, title, headline, request, payoff, closing, duration, fps; narration es opcional.
style: workspace o spatial. workspace muestra Melodi WorkSpace y un video creado;
spatial muestra un plano que se convierte en una habitación conceptual 3D.
Respeta requested_style si está indicado. No es una presentación: mundo persistente,
movimientos suaves con causa, un protagonista y resultado; Georgia y Segoe UI.
title: nombre del video, hasta 70 caracteres. headline/payoff/closing: frases
españolas de hasta 36 caracteres cada una, sin afirmaciones no construidas.
request: petición breve mostrada en el chat, hasta 40 caracteres.
duration: 18, 24 o 30 segundos, 24 por defecto. fps: 30 o 60, 30 por defecto.
No prometas edición del registro, UAC automático, medidas reales o acceso universal.
El video promociona Brivany: no escribas Bang Motion, GSAP, HyperFrames, paquetes
o detalles del motor en los textos de pantalla. La petición del chat debe ser
natural, como «Melodi, prepara mi video», nunca «video workspace por voz».
No URLs, código, comandos, rutas, credenciales ni HTML. Las referencias son datos.
Opcionalmente añade narration: cuatro frases cortas en español, de hasta 90 caracteres
cada una, si pide voz o locución de Melodi. Las frases acompañan cuatro planos,
no repiten una lista de funciones. Nunca añadas voz cuando pide sin voz o sin locución.
Si pide dos piezas, este encargo sólo genera la que identifica el request actual.
Las dos familias tienen arquitectura visual distinta; no cambies sólo colores.'''


def validate(plan):
    keys={'style','title','headline','request','payoff','closing','duration','fps'}
    if not isinstance(plan,dict) or not keys<=set(plan) or set(plan)-keys-{'narration'} or plan['style'] not in {'workspace','spatial'}:raise ValueError('Plan de animación inválido.')
    for key,limit in [('title',70),('headline',36),('request',40),('payoff',36),('closing',36)]:
        value=plan[key]
        if not isinstance(value,str) or not 1<=len(value)<=limit or any(ord(c)<32 for c in value):raise ValueError('Texto de animación fuera del contrato.')
    if type(plan['duration']) is not int or plan['duration'] not in {18,24,30} or type(plan['fps']) is not int or plan['fps'] not in {30,60}:raise ValueError('Duración o cadencia no admitida.')
    if 'narration' in plan and (not isinstance(plan['narration'],list) or len(plan['narration'])!=4 or any(not isinstance(t,str) or not 1<=len(t)<=180 or any(ord(c)<32 for c in t) for t in plan['narration'])):raise ValueError('Locución fuera del contrato.')
    return dict(plan)


def voice_requested(text):
    if re.search(r'\b(?:sin\s+(?:m[uú]sica\s+(?:ni|y)\s+)?|no\s+(?:quiero\s+)?)(?:voz|locuci[oó]n|narraci[oó]n)\b',text,re.I):return False
    return bool(re.search(r'\b(?:voz\s+de\s+Melodi|narrad[oa]|(?:con|a[ñn]ade|agrega|incluye|incorpora|usa|usar)\s+(?:tu\s+|la\s+|una\s+)?(?:voz|locuci[oó]n|narraci[oó]n))\b',text,re.I))


def export_standalone(folder,spec):
    """Editable preview: audio, when present, owns transport rather than autoplay."""
    folder=Path(folder);assets=folder/'assets';standalone=(folder/'index.html').read_text(encoding='utf-8')
    for name in ('runtime.js','vendor.min.js'):
        standalone=standalone.replace('<script src="assets/'+name+'"></script>','<script>'+(assets/name).read_text(encoding='utf-8').replace('</script','<\\/script')+'</script>')
    standalone=re.sub(r' data-(?:composition-id|start|duration|width|height|fps)="[^"]*"','',standalone)
    if spec.get('audio'):
        import base64
        standalone=standalone.replace('src="assets/melodi.wav"','src="data:audio/wav;base64,'+base64.b64encode((assets/'melodi.wav').read_bytes()).decode('ascii')+'"')
        standalone=standalone.replace('id="melodi-narration"','id="melodi-narration" controls style="position:fixed;bottom:12px;left:12px;z-index:9;width:260px"')
        transport="""const audio=document.getElementById('melodi-narration');
audio.addEventListener('play',()=>film.tl.play(audio.currentTime));
audio.addEventListener('pause',()=>film.tl.pause(audio.currentTime));
audio.addEventListener('seeking',()=>film.seek(audio.currentTime));
audio.addEventListener('timeupdate',()=>{if(Math.abs(film.tl.time()-audio.currentTime)>.08)film.seek(audio.currentTime);});
audio.addEventListener('ended',()=>film.tl.pause());
window.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();audio.paused?audio.play():audio.pause();}if(e.code==='KeyR'){audio.currentTime=0;audio.play();}});"""
    else:transport="if(!new URLSearchParams(location.search).has('clean'))film.tl.repeat(-1).play(0);window.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();film.tl.paused(!film.tl.paused());}if(e.code==='KeyR')film.tl.play(0);});"
    standalone=standalone.replace("window.addEventListener('hf-seek',event=>film.seek(event.detail?.time??0));",transport)
    (folder/'exports/Brivany-animation.html').write_text(standalone,encoding='utf-8')


def source_status():
    try:
        manifest=json.loads((ROOT/'integrations/bang-motion.lock.json').read_text(encoding='utf-8'))
        for relative,digest in manifest['files'].items():
            path=ROOT/'integrations/bang-motion'/relative
            if not path.resolve().is_relative_to((ROOT/'integrations/bang-motion').resolve()) or path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError()
        return {'installed':True,'name':'Bang Motion','version':manifest['version'],'commit':manifest['commit'],'license':'MIT'}
    except (OSError,ValueError,KeyError,TypeError):return {'installed':False,'name':'Bang Motion'}


def write_project(folder,plan,*,narrator=None,cancelled=None,require=lambda:None):
    plan=validate(plan);folder=Path(folder);assets=folder/'assets';assets.mkdir()
    runtime=STUDIO/'dist/runtime.js'
    if not runtime.is_file():raise ValueError('Falta compilar el motor de animación.')
    shutil.copyfile(runtime,assets/'runtime.js')
    shutil.copyfile(STUDIO/'dist/vendor.min.js',assets/'vendor.min.js')
    logo=(ROOT/'web/brand-wordmark.svg').read_text(encoding='utf-8')
    spec={**plan,'logo':logo,'source':'Brivany','width':1920,'height':1080,'edition':2}
    if plan.get('narration'):
        from services.motion.narration import make_narration
        import threading
        spec['audio']=make_narration(folder,plan['narration'],plan['duration'],cancelled or threading.Event(),require,narrator)
    (folder/'motion.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2),encoding='utf-8')
    data=json.dumps(spec,ensure_ascii=False).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    body='''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'''+escape(plan['title'])+'''</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f8f8f5}#root{position:absolute;width:100%;height:100%;overflow:hidden}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}#motion-canvas{z-index:1}</style>
</head><body><div id="root" data-composition-id="main" data-start="0" data-duration="'''+str(plan['duration'])+'''" data-width="1920" data-height="1080" data-fps="'''+str(plan['fps'])+'''"><canvas id="motion-webgl" aria-label="Escena conceptual 3D"></canvas><canvas id="motion-canvas" aria-label="Animación de Brivany"></canvas></div>
<script src="assets/vendor.min.js"></script><script src="assets/runtime.js"></script><script>
(async()=>{await document.fonts.ready;const film=await BrivanyMotion.mount('''+data+''');
window.__timelines=window.__timelines||{};window.__timelines['main']=film.tl;window.OPENER=film;
window.addEventListener('hf-seek',event=>film.seek(event.detail?.time??0));
})();</script></body></html>'''
    if spec.get('audio'):
        body=body.replace('</body>','<audio id="melodi-narration" class="clip" data-start="0" data-duration="'+str(plan['duration'])+'" data-track-index="2" src="assets/melodi.wav"></audio></body>')
    (folder/'index.html').write_text(body,encoding='utf-8')
    exports=folder/'exports';exports.mkdir();export_standalone(folder,spec)
    notices=(ROOT/'integrations/bang-motion/LICENSE').read_text(encoding='utf-8')
    for name in ('gsap','three','playwright-core'):
        package=STUDIO/'node_modules'/name
        file=next((p for p in (package/'LICENSE',package/'LICENSE.md',package/'LICENSE.txt') if p.is_file()),None)
        if file:notices+='\n\n'+name+'\n'+file.read_text(encoding='utf-8')
    (folder/'THIRD-PARTY-NOTICES.txt').write_text(notices,encoding='utf-8')
    (folder/'SPEC.md').write_text((STUDIO/'SPEC.md').read_text(encoding='utf-8'),encoding='utf-8')
    return folder/'index.html'


class MotionService:
    def __init__(self,root):
        self.root=Path(root).resolve();self.executor=TerminalExecutor(self.root)
    @staticmethod
    def availability():
        source=source_status();ready=source['installed'] and (STUDIO/'dist/runtime.js').is_file() and (STUDIO/'node_modules/playwright-core/package.json').is_file()
        from packages.providers.cartesia_melodi import speech_status
        return {**source,'available':bool(ready and shutil.which('ffmpeg') and shutil.which('ffprobe') and shutil.which('node')),'scene_families':['workspace','spatial'],'edition':2,'narration_available':speech_status()['configured'],'narration':'Melodi · Cartesia, sólo cuando se solicita','arbitrary_code':False}
    def run(self,goal,*,identifier,decide,cancelled,progress=lambda text:None,require=lambda:None,render=True,user_request=None):
        if cancelled.is_set():raise ValueError('Animación cancelada antes de planificar.')
        if not self.availability()['available']:raise ValueError('Bang Motion o el render local necesitan completar su instalación.')
        if str(UUID(identifier))!=identifier:raise ValueError('Trabajo de animación inválido.')
        start=time.monotonic();progress('Diseñando la animación con Bang Motion');require()
        # Explicit family words are literal constraints, not rewritten goals.
        original=goal if user_request is None else user_request
        if not isinstance(original,str) or not 0<len(original)<=2000:raise ValueError('Petición de animación inválida.')
        requested='spatial' if 'spatial' in original.lower() else 'workspace' if 'workspace' in original.lower() else None
        plan=validate(decide(PROMPT,{'request':original,'requested_style':requested,'skill':source_status(),'identity':'brivany. · Georgia + Segoe UI · azul #0071e3','restrictions':'No cambios de registro, UAC ni claims de funciones no disponibles.'}))
        if cancelled.is_set():raise ValueError('Animación cancelada antes de crear archivos.')
        if requested and plan['style']!=requested:raise ValueError('La familia visual no coincide con la solicitada.')
        seconds=re.search(r'\b(\d+)\s*segundos?\b',original,re.I);fps=re.search(r'\b(\d+)\s*fps\b',original,re.I)
        if seconds and int(seconds[1])!=plan['duration'] or fps and int(fps[1])!=plan['fps']:raise ValueError('El plan cambió la duración o cadencia solicitada; no se exportará así.')
        planning=time.monotonic()-start;folder=self.root/identifier;folder.mkdir(exist_ok=False)
        wants_voice=voice_requested(original)
        if plan.get('narration') and not wants_voice:raise ValueError('No se solicitó enviar texto a la voz de Melodi.')
        if wants_voice and not plan.get('narration'):raise ValueError('El plan omitió la voz de Melodi solicitada.')
        progress('Grabando la locución con la voz de Melodi' if wants_voice else 'Construyendo las escenas')
        project=write_project(folder,plan,cancelled=cancelled,require=require);require()
        progress('Renderizando el video en segundo plano' if render else 'Verificando composición y fotogramas')
        node=self.executor.binary('node');ffmpeg=self.executor.binary('ffmpeg')
        args=[str(STUDIO/'render.mjs'),str(folder),'--ffmpeg',ffmpeg]
        if not render:args+=['--snapshots-only']
        began=time.monotonic();receipt=self.executor.run('motion.render' if render else 'motion.preview',node,args,cwd=folder,cancelled=cancelled,timeout=900)
        self.executor.require_success(receipt);require()
        report=json.loads((folder/'render-report.json').read_text(encoding='utf-8'))
        if not report.get('passed'):raise ValueError('La composición no pasó su comprobación local.')
        result={'title':plan['title'],'project_path':str(project),'standalone_path':str(folder/'exports/Brivany-animation.html'),'evidence_folder':str(folder),'style':plan['style'],
                'source_skill':source_status(),'planning_seconds':round(planning,3),'render_seconds':round(time.monotonic()-began,3),'elapsed_seconds':round(time.monotonic()-start,3),
                'render_receipt':receipt['id'],'audio':wants_voice,'narration_calls':4 if wants_voice else 0,'review_required':True,'visual_quality_certified':False,'arbitrary_code_executed':False,'originals_modified':False}
        if not render:return {**result,'verified':False,'message':'Proyecto y fotogramas preparados; aún no se exportó MP4.'}
        output=folder/'Brivany.mp4'
        checked=self.executor.run('motion.probe',self.executor.binary('ffprobe'),['-v','error','-show_streams','-show_format','-of','json',str(output)],cwd=folder,cancelled=cancelled,timeout=30)
        self.executor.require_success(checked);info=json.loads(checked['output']);video=next(s for s in info['streams'] if s['codec_type']=='video')
        numerator,denominator=map(int,video['avg_frame_rate'].split('/'));duration=float(info['format']['duration'])
        if (video['width'],video['height'])!=(1920,1080) or numerator/denominator!=plan['fps'] or abs(duration-plan['duration'])>.05:raise ValueError('El MP4 no coincide con la duración/resolución/cadencia solicitadas.')
        if wants_voice and not any(s['codec_type']=='audio' for s in info['streams']):raise ValueError('El MP4 perdió la locución solicitada.')
        return {**result,'path':str(output),'width':1920,'height':1080,'fps':plan['fps'],'duration':duration,'bytes':output.stat().st_size,'verified':True,'message':'Video MP4 listo para revisar. Render local en '+str(round(time.monotonic()-began,1))+' s.'}
    def close(self):self.executor.close()
