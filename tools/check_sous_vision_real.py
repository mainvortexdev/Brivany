"""One paid Meta compatibility probe, exclusively on a synthetic non-food card.

Outside tools.verify: this really contacts Meta, once, without retries. It does
not evaluate kitchen recognition, freshness, cooking safety or general quality.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
from unittest.mock import patch

from PIL import Image, ImageDraw
from packages.providers import sous_vision
from packages.providers.meta import MetaProviderError
from services.activity import ActivityStore,ROOT
from services.h1.server import load_local_config


def main(argv=None):
    parser=argparse.ArgumentParser(description='Una consulta real Meta de compatibilidad visual con fixture sintética, sin reintentos')
    parser.add_argument('--allow-paid',action='store_true');args=parser.parse_args(argv)
    if not args.allow_paid:parser.error('Esta comprobación requiere --allow-paid; puede consumir créditos Meta.')
    load_local_config();status=sous_vision.vision_provider_status()
    if not status['configured']:parser.error('La visión Meta no está configurada; no se envió ninguna solicitud.')
    image=Image.new('RGB',(640,320),(240,242,245));draw=ImageDraw.Draw(image)
    draw.rectangle((35,35,605,285),outline=(0,100,210),width=4)
    draw.text((65,95),'BRIVANY SYNTHETIC TEST',fill=(20,30,45),font_size=28)
    draw.text((65,155),'NO FOOD IN THIS IMAGE',fill=(20,30,45),font_size=26)
    raw=BytesIO();image.save(raw,format='PNG');fixture=raw.getvalue()
    folder=ROOT/'tmp/sous-vision-real';folder.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S');path=folder/(stamp+'.json')
    fixture_path=folder/('synthetic-no-food-'+hashlib.sha256(fixture).hexdigest()[:12]+'.png')
    if not fixture_path.exists():fixture_path.write_bytes(fixture)
    calls=0;original=sous_vision._post_json
    def counted(*values):
        nonlocal calls
        calls+=1
        if calls>1:raise RuntimeError('A second provider request is forbidden')
        return original(*values)
    report={'purpose':'Verify actual Meta image input + Responses structured JSON compatibility with the selected Sous model.',
        'checked_at':datetime.now(timezone.utc).isoformat(),'fixture_sha256':hashlib.sha256(fixture).hexdigest(),
        'fixture':'generated_non_food_text_card','model':status['model'],'automatic_retries':0,
        'actual_cost_usd':None,'cost_known':False,'kitchen_recognition_quality_verified':False,'latency_target_verified':False}
    try:
        with patch.object(sous_vision,'_post_json',side_effect=counted):result=sous_vision.analyze_inventory(fixture,'image/png')
        report.update(status='passed' if result['observation']['items']==[] else 'failed',
            structured_response_valid=True,expected_no_food_candidates=result['observation']['items']==[],
            candidate_count=len(result['observation']['items']),metadata=result['metadata'])
    except MetaProviderError as error:report.update(status='failed',error_code=error.code,structured_response_valid=False)
    report['external_request_attempts']=calls
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    ActivityStore().add({'kind':'test','status':report['status'],'title':'Meta real · compatibilidad visual Sous',
        'summary':'Una solicitud como máximo, sin reintentos, con tarjeta sintética sin alimentos. Comprueba protocolo/contrato y respuesta vacía esperada; no calidad de cocina ni seguridad. Consumo monetario y GPU del proveedor desconocidos.',
        'external_calls':calls},[path])
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
