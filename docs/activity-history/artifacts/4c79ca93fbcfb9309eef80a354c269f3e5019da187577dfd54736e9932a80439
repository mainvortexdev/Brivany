"""Publish validated conceptual geometry into the existing local scene library."""
import base64
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
from uuid import uuid4
from contracts.spatial import SceneManifest
from services.spatial.jobs import now
from workers.spatial_runtime import validate_glb
from .backend import verify_source,child_environment

ROOT=Path(__file__).resolve().parents[2]


def compiler_command(source):
    source=Path(source);verify_source(source)
    env=child_environment();electron=source/'node_modules/electron/dist/electron.exe'
    if os.name=='nt' and electron.is_file():
        env['ELECTRON_RUN_AS_NODE']='1';executable=str(electron)
    else:
        executable=shutil.which('node')
        if not executable:raise ValueError('Falta el runtime local para compilar modelos.')
    return [executable,str(ROOT/'desktop/computer/compile.cjs'),str(source)],env


def run_compiler(command,env,payload,cancelled,*,timeout=30):
    if cancelled.is_set():raise ValueError('Modelo cancelado antes de compilar.')
    process=subprocess.Popen(command,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
        text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    # On Windows communicate() can block while writing stdin before its timeout
    # starts. Keep that pipe work off the cancellation/deadline thread.
    outcomes=queue.Queue(maxsize=1)
    def communicate():
        try:outcomes.put(process.communicate(input=payload))
        except Exception as error:outcomes.put(error)
    reader=threading.Thread(target=communicate,daemon=True,name='melodi-model-compiler');reader.start()
    deadline=time.monotonic()+timeout
    try:
        while True:
            if cancelled.is_set():raise ValueError('Modelo cancelado durante la compilación.')
            remaining=deadline-time.monotonic()
            if remaining<=0:raise ValueError('La compilación agotó el tiempo; no se repetirá.')
            try:
                outcome=outcomes.get(timeout=min(.1,remaining))
                if isinstance(outcome,Exception):raise outcome
                stdout,stderr=outcome
                return subprocess.CompletedProcess(command,process.returncode,stdout,stderr)
            except queue.Empty:continue
    finally:
        if process.poll() is None:
            process.terminate()
            try:process.wait(timeout=2)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=2)
        reader.join(timeout=2)


def publish_model(plan, spatial, source, cancelled):
    command,env=compiler_command(source)
    result=run_compiler(command,env,json.dumps(plan),cancelled)
    if cancelled.is_set():raise ValueError('Modelo cancelado antes de publicar.')
    if result.returncode or len(result.stdout)>12000000:raise ValueError('No se pudo compilar el modelo conceptual.')
    compiled=json.loads(result.stdout);scene=compiled['scene'];identifier=str(uuid4());assets=[];objects=[];payloads={}
    for item,geometry in zip(scene['objects'],compiled['assets'],strict=True):
        raw=base64.b64decode(geometry['base64'],validate=True);validate_glb(raw)
        asset_id=item['id'];relative='assets/'+asset_id+'.glb';payloads[relative]=raw
        assets.append({'id':asset_id,'kind':'mesh','relative_path':relative,'sha256':hashlib.sha256(raw).hexdigest(),
                       'provenance':'generated','source_frame_ids':[], 'note':'Modelo conceptual generado desde texto. No procede de captura ni reconstrucción.'})
        objects.append({'id':asset_id,'label':item['name'],'asset_id':asset_id,
                        'transform':{'position':item['position'],'rotation_xyzw':geometry['rotation'],'scale':item['size']},
                        'editable':item['role'] not in {'wall','roof','floor'},'role':'environment' if item['role'] in {'wall','roof','floor'} else 'object'})
    document=SceneManifest.model_validate_json(json.dumps({'scene_id':identifier,'origin':'generated_demo','title':scene['title'],
        'units':'source_relative','assets':assets,'objects':objects,'limitations':[
        'Modelo conceptual generado por Melodi desde texto; no es una reconstrucción ni un plano constructivo.',
        'Unidades nominales y supuestos sin verificación métrica o física.',scene['assumptions'][:600] or 'Sin referencia visual.']})).model_dump(mode='json')
    directory=spatial.root/'scenes'/identifier;encoded=json.dumps(document,ensure_ascii=False);stamp=now()
    try:
        (directory/'assets').mkdir(parents=True)
        for relative,raw in payloads.items():(directory/relative).write_bytes(raw)
        (directory/'model-plan.json').write_text(json.dumps(plan,ensure_ascii=False),encoding='utf-8')
        if cancelled.is_set():raise ValueError('Modelo cancelado antes de publicar.')
        with spatial.lock,spatial._connect() as db:
            db.execute('INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)',(identifier,scene['title'],'ready','generated_demo',identifier,None,stamp,stamp))
            db.execute('INSERT INTO scenes VALUES(?,?,?,1)',(identifier,encoded,encoded))
    except Exception:
        # Own UUID staging folder, resolved and checked before recursive cleanup.
        if directory.resolve().parent==(spatial.root/'scenes').resolve():shutil.rmtree(directory,ignore_errors=True)
        raise
    return {'scene_id':identifier,'title':scene['title'],'object_count':len(objects),'conceptual':True,'url':'/spaces?space='+identifier}
