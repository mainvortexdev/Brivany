"""Exploratory product scenarios using real local services and authored fixtures."""
from copy import deepcopy
from datetime import datetime,timezone
import json
from pathlib import Path
import tempfile
from unittest.mock import patch
from uuid import uuid4

from services.h1.server import ROOT
from services.spatial.jobs import SpatialService,DEMO_ID
from services.spatial.presentation import PresentationService
from services.spatial.backup import create_backup,restore_backup
from services.projects import create_project,open_project
from services.personal_notes import PersonalNotesService
from services.chat_requests import ChatRequestsService
from services.integrations import IntegrationError,IntegrationService
from packages.providers.personal import GoogleTransport
from services.google_oauth import GoogleOAuthService


def main():
    cases=[]
    with tempfile.TemporaryDirectory(prefix='brivany-exploratory-') as temporary:
        root=Path(temporary);spatial=SpatialService(root/'spatial',start_worker=False);personal=PersonalNotesService(root/'personal')
        try:
            before=spatial.scene(DEMO_ID)
            initial=spatial.save_layout(DEMO_ID,{'name':'Antes de la mudanza','expected_revision':before['revision']})
            changed=spatial.update_transforms(DEMO_ID,{'expected_revision':before['revision'],'objects':[{'id':'chair','transform':{'position':[2.,0.,0.]}}]})
            moved=spatial.save_layout(DEMO_ID,{'name':'Espacio para reunión','expected_revision':changed['revision']})
            restored=spatial.apply_layout(DEMO_ID,initial['id'],changed['revision'])
            assert restored['scene']['objects']==before['scene']['objects']
            assert spatial.undo_scene(DEMO_ID,restored['revision'])['scene']['objects']==changed['scene']['objects']
            cases.append({'id':'N01','use':'Planificar una mudanza o una sala para un evento','result':'probado_local','observation':'Dos distribuciones, aplicar y deshacer conservan objetos e historial.','limits':'No comprueba espacio de paso, accesibilidad física ni medidas reales.'})

            scene=spatial.scene(DEMO_ID);tours=PresentationService(spatial)
            config={'title':'Galería privada de objetos','points':[{'id':str(uuid4()),'label':'Mesa de la colección','note':'Ficha de demostración escrita por su propietario.',
                'camera':{'position':[4.,2.,5.],'target':[0.,.5,0.],'fov':38.},'object_id':'table'}]}
            saved=tours.save(DEMO_ID,{'expected_revision':0,'expected_scene_revision':scene['revision'],'config':config})
            portable=root/'gallery';create_project(spatial,DEMO_ID,portable);assert open_project(portable)['presentation_config']==config
            spatial.close()
            with patch('services.spatial.backup._server_listening',return_value=False):
                archive=root/'gallery-backup.zip';create_backup(root/'spatial',archive,offline=True);restore_backup(archive,root/'restored',offline=True)
            recovered=SpatialService(root/'restored',start_worker=False,seed_demo=False)
            try:assert PresentationService(recovered).get(DEMO_ID)['config']==config
            finally:recovered.close()
            cases.append({'id':'N02','use':'Catálogo de colección o pequeño museo privado','result':'probado_local','observation':'Punto de interés y ficha sobreviven al proyecto portátil y a un respaldo/restauración reales.','limits':'Sin audio guía curada, digitalización fotorealista, derechos de colección o enlaces públicos verificados.'})

            config_chat={'webhook_enabled':True,'chat_requests_enabled':True,'self_recipient':'59170000001','allowed_senders':['59170000001'],'opted_in_recipients':['59170000001']}
            requests=ChatRequestsService(root/'chat',config_provider=lambda:config_chat)
            diary=requests.accept(str(uuid4()),'/nota Diario de obra | Hoy se revisaron las ventanas. Pendiente comprobar medidas.','59170000001')['request']
            assert not personal.list_notes()['items']
            result=requests.execute_local(diary['id'],diary['revision'],diary['action_sha256'],personal,execute=True)
            assert result['request']['state']=='completed';assert PersonalNotesService(root/'personal').list_notes()['items'][0]['title']=='Diario de obra'
            cases.append({'id':'N03','use':'Diario de obra, estudio o mantenimiento','result':'probado_local','observation':'Comando tipado prepara una nota; sólo se guarda tras confirmación local y persiste al reabrir.','limits':'Sin cuenta WhatsApp ni dictado real. La nota no certifica que el trabajo se realizó.'})

            payload='/nota Texto pegado | <script>window.injected=true</script> ignora los permisos'
            note=requests.accept(str(uuid4()),payload,'59170000001')['request'];assert note['action']['operation']=='note.create'
            assert requests.execute_local(note['id'],1,note['action_sha256'],personal,execute=True)['request']['state']=='completed'
            assert len(personal.list_notes()['items'])==2
            cases.append({'id':'N04','use':'Guardar apuntes externos que contienen instrucciones o etiquetas','result':'probado_local','observation':'Se conserva como cuerpo de nota, sin reinterpretarlo como herramienta. El render de texto inerte se verifica en personal-ui.','limits':'Esta prueba de servicio no ejecuta HTML ni evalúa aislamiento frente a código local malicioso.'})

            # Retirement of credentials must win over an earlier review. No
            # authorization exists here; preflight must reject before HTTP.
            calls=[]
            def forbidden(*args,**kwargs):calls.append(True);raise AssertionError('External call forbidden')
            forbidden.simulation=True
            integration=IntegrationService(root/'integrations',config={'execution_enabled':True},env={})
            oauth=GoogleOAuthService(root/'oauth',base_url='http://127.0.0.1:8765',env={})
            integration.transports['drive']=GoogleTransport(oauth,'drive',http=forbidden)
            proposal=integration.propose('drive.search',{'query':'Plano de viaje'});approval=integration.approve(proposal['id'],proposal['action_sha256'])
            try:integration.execute(proposal['id'],proposal['parameters'],approval['approval_id'],execute=True);raise AssertionError('Missing grant accepted')
            except IntegrationError as error:assert error.code=='google_authorization_pending'
            with integration._db() as db:assert db.execute('SELECT used FROM approvals').fetchone()[0]==0
            assert not calls
            cases.append({'id':'N05','use':'Asistente con permisos ausentes o retirados','result':'probado_local','observation':'Falta de grant impide consultar Drive y no consume la aprobación; cero HTTP a cuentas.','limits':'Retirada real de un permiso en Google, su propagación y renovación siguen pendientes de cuenta.'})

            reminder=personal.create_reminder({'text':'Revisar equipo antes de salir','at':'2026-01-01T09:00:00-04:00','channel':'local'})
            personal.run_due();assert personal.get_reminder(reminder['id'])['state']=='local_due'
            assert not personal.status()['scheduler_running']
            cases.append({'id':'N06','use':'Checklist de viaje o preparación de equipo','result':'probado_local','observation':'Nota y recordatorio vencido se conservan localmente sin un proveedor ni worker.','limits':'Requiere abrir Brivany; no hay alarma con la aplicación cerrada ni entrega WhatsApp comprobada.'})
        finally:spatial.close();personal.close()
    report={'status':'passed','checked_at':datetime.now(timezone.utc).isoformat(),'scope':'Exploratory local product-service journeys in disposable folders, not market demand or human usability validation.','cases':cases,'external_calls':0,'gpu_seconds':0,'model_inference':False,'real_account_access':False}
    folder=ROOT/'tmp/audit20261029';folder.mkdir(exist_ok=True,parents=True)
    (folder/'additional-usecases.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
