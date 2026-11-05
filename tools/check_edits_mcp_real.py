"""Real isolated Cognira Edits MCP and local render; synthetic media, no inference."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
from uuid import uuid4
from services.edits.client import EditsClient,editor_executable
from services.edits.agent import run_edit
from services.computer.backend import child_environment

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true',required=True);parser.parse_args()
    directory=ROOT/'tmp/edits-mcp-real'/('fixture-'+uuid4().hex[:8]);directory.mkdir(parents=True)
    profile=directory/'profile';binary=editor_executable();ffmpeg=shutil.which('ffmpeg');probe=shutil.which('ffprobe')
    if not binary or not ffmpeg or not probe:raise ValueError('Falta Edits o las herramientas locales de medios.')
    source=directory/'synthetic.mp4';flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
    subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-threads','2','-c:a','aac',str(source)],check=True,creationflags=flags)
    env=child_environment();env.update(COGNIRA_EDITS_TEST_PROFILE=str(profile),COGNIRA_EDITS_HEADLESS_TEST='1')
    process=subprocess.Popen([str(binary)],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
    client=EditsClient(profile/'automation/mcp.json',launch=False);report={'status':'failed','scope':'real isolated Edits MCP and FFmpeg; planner substituted','synthetic_only':True,'inference_calls':0,'background_network_consumption_known':False}
    try:
        deadline=time.monotonic()+60
        while not client.file.is_file() and time.monotonic()<deadline:
            if process.poll() is not None:raise ValueError('El editor de prueba terminó antes del MCP.')
            time.sleep(.2)
        tools=client.tools();client.call('project_create',{'name':'Melodi · prueba sintética','width':320,'height':180,'fps':30})
        imported=client.call('media_import',{'files':[str(source)],'analysisOnly':True});library=client.wait_job(imported['jobId'],timeout=90)
        asset=library['assets'][0];client.call('clip_add',{'assetId':asset['id'],'in':0,'out':2,'start':0});before=client.call('project_get');original=before['project']['sequenceId']
        decisions=[]
        def decide(prompt,data):
            done={item['tool'] for item in data['completed']}
            if 'sequence_duplicate' not in done:value={'tool':'sequence_duplicate','arguments':{'id':original,'name':'Melodi · copia de prueba'}}
            elif 'clip_update' not in done:
                video_tracks={t['id'] for t in data['observed']['project']['tracks'] if t['type']=='video'}
                clip=next(c for c in data['observed']['clips'] if c['trackId'] in video_tracks);value={'tool':'clip_update','arguments':{'id':clip['id'],'patch':{'contrast':1.08}}}
            elif 'export_start' not in done:value={'tool':'export_start','arguments':{'folder':data['output_folder'],'name':'Melodi-synthetic','settings':{'width':320,'height':180,'preset':'ultrafast'}}}
            else:value={'done':True}
            decisions.append(value['tool'] if 'tool' in value else 'done');return value
        result=run_edit(client,'Duplica la secuencia, ajusta contraste a 1.08 y exporta una prueba local.',job_id='real-check',workspace=directory/'workspace',roots=[str(directory)],selected=[str(source)],decide=decide,cancelled=threading.Event())
        state=client.call('project_get');old=next(s for s in state['project']['sequenceDocument']['sequences'] if s['id']==original)
        if old['clips']!=before['project']['clips']:raise ValueError('La secuencia original cambió.')
        metadata=json.loads(subprocess.check_output([probe,'-v','error','-show_streams','-show_format','-of','json',result['video_path']],creationflags=flags))
        video=next(s for s in metadata['streams'] if s['codec_type']=='video')
        if int(video['nb_frames'])!=60 or video['avg_frame_rate']!='30/1' or not any(s['codec_type']=='audio' for s in metadata['streams']):raise ValueError('La exportación no conservó cadencia, fotogramas y audio esperados.')
        report.update(status='passed',tool_count=len(tools),decisions=decisions,result=result,checks={'original_sequence_preserved':True,'saved_copy_exists':Path(result['project_path']).is_file(),'video_frames':60,'video_rate':'30/1','audio_present':True,'artistic_quality_verified':False})
    except Exception as error:report['error']=str(error)
    finally:
        if process.poll() is None:
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill()
        (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'report':str(directory/'report.json'),**report},ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1

if __name__=='__main__':raise SystemExit(main())
