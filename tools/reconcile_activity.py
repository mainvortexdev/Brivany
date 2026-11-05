"""Append reviewed historical references via tools.activity; never rewrite history.

Only metadata from existing reports is recovered. Media, conversations, provider
responses and error bodies are deliberately not copied into ledger evidence.
"""
import argparse
from collections import defaultdict
from contextlib import closing
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import subprocess
import sys
from services.activity import ROOT

DOC_GROUPS=[
 ('Bases del producto y contratos iniciales',[f'docs/{n}' for n in ['00-idea-completa.md','01-objetivo-y-capacidades.md','02-arquitectura.md','03-skills-y-aprendizaje.md','04-melodi-y-modelos.md','05-conectores.md','06-datos-api-eventos.md','07-operacion.md']], 'Visión, capacidades por etapas, arquitectura, skills, modelos, conectores, contratos y operación. Referencias históricas: no aprueban todas las capacidades propuestas ni sustituyen PLAN_PLATAFORMA.'),
 ('Plan inicial, supuestos y alternativas de doblaje',[f'docs/{n}' for n in ['08-plan.md','09-decisiones.md','10-fuentes-y-supuestos.md','11-h1-oratoria-y-meta-glasses.md','12-asistencia-contextual.md','19-doblaje-apis.md']], 'Plan H1, decisiones, fuentes, contexto y alternativas de voz/doblaje. Los requisitos no medidos, hardware y objetivos de latencia conservan su estado pendiente; no son pruebas nuevas.'),
 ('Revisiones históricas de voz, traducción y latencia',[f'docs/{n}' for n in ['18-traduccion-video-live.md','24-voz-a-voz-nativa.md','26-retraso-audible.md','workspace-traduccion-auditiva.md']], 'Se incorporan versiones con correcciones y límites posteriores de voz y traducción. Los ensayos fallidos de 500 ms, diferencias entre inferencia y latencia audible y evaluaciones físicas pendientes se conservan.'),
 ('Control del ordenador y checklist de terminal',[f'docs/{n}' for n in ['control-ordenador-melodi.md','terminal-melodi.md','terminal-checklist.md']], 'Control de Paint/archivos/aplicaciones, correcciones de IDE y catálogo de comandos. Sólo los elementos con su recibo conservan aprobación; los comandos pendientes y macOS no se dan por ejecutados. El usuario cerró la ampliación de terminal.'),
 ('Evolución visual de Mini Melodi a WorkSpace',[f'docs/{n}' for n in ['mini-melodi-isla.md','melodi-workspace.md','melodi-workspace-premium.md','melodi-workspace-compacto.md']], 'Se adjuntan revisiones de isla, AppBar, paneles, transparencia, herramientas y rostro. Se mantienen los límites de cada entrega, fallos conservados y separación entre fixtures de UI y pruebas nativas.'),
 ('Spotify, retorno HTTPS, biblioteca y conversación',[f'docs/{n}' for n in ['spotify-retorno-https.md','spotify-biblioteca-letras.md','workspace-chat-live-y-spotify.md']], 'Retorno HTTPS/PKCE, SDK nativo, biblioteca, letras, recuperación y ducking. Los resultados pertenecen a la versión y fecha documentadas; esta incorporación no prueba una cuenta conectada o escucha física actuales.'),
 ('Infraestructura, accesos y diseño de iPhone',[f'docs/{n}' for n in ['30-accesos-pendientes.md','31-infraestructura-y-visor.md','iphone-diseno-en-curso.md']], 'Referencias actualizadas de infraestructura, visor y diseño iPhone. Se conservan accesos pendientes, falta de certificación geométrica y base SwiftUI sin compilar/IPA no generado.'),
 ('Medios, documentación, web y Motion',[f'docs/{n}' for n in ['melodi-medios-documentacion-y-web.md','melodi-bang-motion.md']], 'Se incorpora el documento Motion que faltaba adjuntar y la actualización de medios/web. Las escenas conceptuales, nuevas instalaciones de drivers y plataformas no ensayadas conservan sus límites. No se renderiza ni instala nada en esta reconciliación.'),
]


def record(kind,status,title,summary,evidence):
    args=[sys.executable,'-X','utf8','-B','-m','tools.activity',kind,'--status',status,'--title',title,'--summary',summary]
    for path in evidence:args+=['--evidence',str(path)]
    result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',check=True)
    return json.loads(result.stdout)['id']


def family(path):
    name=path.lower()
    for tokens,label in [
      (('selected-video','extension-sync','workspace-translation','workspace-voices','youtube-','palabra-'),'Traducción y fuentes de video'),
      (('account-','connections','google-setup','personal-','chat-requests','social-','work-events'),'Cuentas, conectores y eventos'),
      (('computer-','paint-','background-launch'),'Ordenador, Paint y archivos'),
      (('terminal-',),'Terminal e IDE'),(('motion-','render-check'),'Motion y render'),
      (('sous-',),'Sous'),(('spatial-','floorplan','portable-','room-ingest','ingest-ui','presentation-ui'),'Espacios y presentaciones'),
      (('search-','weather-'),'Búsqueda web'),(('media-ui',),'Medios'),
      (('workspace-chat',),'Chat de WorkSpace'),
      (('spotify-','workspace-','island-','ui-cleanup','desktop-ui'),'WorkSpace y música')]:
        if any(token in name for token in tokens):return label
    return 'Otras comprobaciones locales'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if not args.apply:parser.error('Use --apply after reviewing tmp/bitacora-audit-before.json and the report inventory.')
    folder=ROOT/'tmp/activity-reconciliation';folder.mkdir(exist_ok=True);known_paths={};known_hashes=set()
    with closing(sqlite3.connect((ROOT/'.local/activity/activity.sqlite3').as_uri()+'?mode=ro',uri=True)) as db:
        for row in db.execute('SELECT payload FROM entries'):
            for item in json.loads(row[0])['evidence']:known_paths.setdefault(item['label'],set()).add(item['sha256']);known_hashes.add(item['sha256'])
    index=folder/'index.json'
    result=json.loads(index.read_text(encoding='utf-8')) if index.exists() else {'type':'append_only_retrospective_reconciliation','new_test_execution':False,'document_records':[],'report_records':[],'recovered_reports':[]}
    previous_counts={key:len(result[key]) for key in ('document_records','report_records','recovered_reports')}
    for title,paths,summary in DOC_GROUPS:
        changed=[p for p in paths if hashlib.sha256((ROOT/p).read_bytes()).hexdigest() not in known_paths.get(p,set())]
        if not changed:continue
        identifier=record('decision','implemented','Reconciliación documental · '+title,'Retrospectiva: '+summary+' Se completa su referencia en bitácora; no se reescribe ningún registro anterior.',changed)
        result['document_records'].append({'id':identifier,'title':title,'documents':changed})
    inventory=json.loads((ROOT/'tmp/bitacora-report-inventory.json').read_text(encoding='utf-8'));groups=defaultdict(list)
    for original in inventory['reports']:
        source=(ROOT/original['path']).resolve();source.relative_to(ROOT/'tmp')
        raw=source.read_bytes();digest=hashlib.sha256(raw).hexdigest()
        if digest in known_hashes:continue
        data=json.loads(raw);declared=data.get('passed',data.get('status'))
        status='passed' if declared is True or isinstance(declared,str) and declared.lower().startswith('passed') else 'failed' if declared is False or isinstance(declared,str) and declared.lower().startswith('failed') else 'pending'
        metadata={'type':'retrospective_existing_report_metadata','original_report':original['path'],'original_sha256':digest,'new_test_execution':False,'reported_result':status,'semantic_quality_verified_by_reconciliation':False,
          'reported_flags':{k:v for k,v in data.items() if type(v) is bool},'reported_measurements':{}}
        for key in ('external_calls','provider_calls','provider_requests','model_calls','paid_asr_sessions','paid_translation_requests','meta_calls','elapsed_seconds','billing_amount','billing_usd','actual_billed_usd'):
            value=data.get(key)
            if value is None or type(value) in (int,float) and math.isfinite(value):metadata['reported_measurements'][key]=value
        target=folder/(digest+'.json');target.write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
        if hashlib.sha256(target.read_bytes()).hexdigest() in known_paths.get(target.relative_to(ROOT).as_posix(),set()):continue
        groups[(family(original['path']),status)].append((target.relative_to(ROOT).as_posix(),original['path'],digest))
    for (label,status),items in sorted(groups.items()):
        for offset in range(0,len(items),8):
            batch=items[offset:offset+8];identifier=record('test',status,f'Retrospectiva · {label} · {status} · lote {offset//8+1}',f'Recuperación de {len(batch)} informes preexistentes cuyo resultado declarado era {status}. No se ejecutaron de nuevo ni se certifica su calidad por un hash. Se adjuntan metadatos depurados y referencia/huella del original, sin conversaciones, respuestas de proveedor, claves ni medios. El consumo global o importe no conocidos siguen sin cuantificar.',[r[0] for r in batch])
            result['report_records'].append({'id':identifier,'area':label,'reported_result':status,'reports':len(batch)})
            for metadata,original,digest in batch:result['recovered_reports'].append({'original':original,'sha256':digest,'metadata':metadata,'record_id':identifier,'reported_result':status})
    path=folder/'index.json';path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'added':{key:len(result[key])-previous_counts[key] for key in previous_counts},'document_records':len(result['document_records']),'documents':sum(len(r['documents']) for r in result['document_records']),'report_records':len(result['report_records']),'recovered_reports':len(result['recovered_reports']),'index':str(path.relative_to(ROOT))}))


if __name__=='__main__':main()
