"""Explicit real checks using only a generated image, never the user's image."""
import argparse
import base64
from io import BytesIO
import json
from pathlib import Path
import threading
import time
from uuid import uuid4
from PIL import Image,ImageDraw
from services.computer.service import ComputerService
from services.computer.planner import MetaPlanner
from services.computer.runtime import NativeRuntime
from services.spatial.jobs import SpatialService
from services.h1.server import load_local_config
from packages.providers.conversation import ConversationRequest
from services.computer.references import ImageTurnRequest

ROOT=Path(__file__).resolve().parents[1]


class CountedPlanner(MetaPlanner):
    def __init__(self):super().__init__();self.calls=0;self.visual_calls=0
    def generate(self,*args,**kw):
        if self.calls>=3:raise ValueError('Límite de tres solicitudes reales.')
        self.calls+=1;self.visual_calls+=bool(kw.get('images') or kw.get('image'))
        return super().generate(*args,**kw)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--paint',action='store_true');parser.add_argument('--allow-paid',action='store_true');args=parser.parse_args()
    if not args.paint and not args.allow_paid:parser.error('La prueba visual necesita --allow-paid; Paint usa --paint sin inferencia.')
    directory=ROOT/'tmp/computer-reference-real'/('fixture-'+uuid4().hex[:8]);directory.mkdir(parents=True)
    image=Image.new('RGB',(64,64),'white');draw=ImageDraw.Draw(image);draw.rectangle((6,12,28,52),fill='#df7c24');draw.ellipse((38,20,60,42),fill='#2269be')
    output=BytesIO();image.save(output,format='PNG');(directory/'synthetic-reference.png').write_bytes(output.getvalue())
    data='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()
    report={'scope':'real native Paint reference' if args.paint else 'real Meta image and conceptual geometry','synthetic_only':True,'external_cost_amount':None,'physical_audio_verified':False}
    if args.paint:
        runtime=NativeRuntime(directory/'workspace',proxy='http://127.0.0.1:1/no-provider',token=uuid4().hex,diagnostics=True)
        cancelled=threading.Event()
        try:
            runtime.call('begin_task',cancelled=cancelled,timeout=25)
            result=runtime.call('execute',step={'action':'draw_paint','params':{'instruction':'Reproduce la referencia sintética con las herramientas de Paint.'}},reference_image=data,cancelled=cancelled,timeout=900)
            report.update(status='passed' if result.get('openedInPaint') and result.get('verification',{}).get('success') else 'failed',result=result,external_calls=0,limits=['Pixel comparison is against the quantized drawing plan, not artistic quality.','Only the generated synthetic image was drawn.'])
        except Exception as exc:report.update(status='failed',error=str(exc),external_calls=0)
        finally:
            try:runtime.call('end_task',timeout=5)
            except Exception:pass
            runtime.close()
    else:
        load_local_config();planner=CountedPlanner();spatial=SpatialService(directory/'spatial',start_worker=False,seed_demo=False)
        current=ComputerService('http://127.0.0.1:1',lambda:spatial,root=directory/'computer',planner=planner,native=True)
        try:
            key=current.references.add(data)['id']
            events=list(current.image_turn(ImageTurnRequest(text='Describe las formas visibles, sus colores y su posición relativa.',consent=True,reference_ids=[key]),None))
            reply=next((event['text'] for event in events if event['type']=='done'),None)
            if not reply:raise ValueError('No hubo descripción visual.')
            token=current.arm()['token'];job=current.enqueue('model','Crea un diseño 3D conceptual con las dos formas de la referencia, conservando colores y disposición. No añadas objetos.',token,references=current.references.get_many([key]))
            deadline=time.monotonic()+90
            while current.jobs[job['id']]['state'] in {'queued','planning','running'} and time.monotonic()<deadline:time.sleep(.1)
            value=current.public(current.jobs[job['id']]);report.update(status='passed' if value['state']=='succeeded' else 'failed',visual_reply=reply,model=value,requests_attempted=planner.calls,visual_requests_attempted=planner.visual_calls,external_calls=planner.calls,limits=['No automatic semantic or geometric fidelity certification.','Conceptual geometry, unverified scale.','Invoice amount unknown; no task retries.'])
        except Exception as exc:report.update(status='failed',error=str(exc),requests_attempted=planner.calls,visual_requests_attempted=planner.visual_calls,external_calls=planner.calls)
        finally:current.close();spatial.close()
    (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'report':str(directory/'report.json'),**report},ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1

if __name__=='__main__':raise SystemExit(main())
