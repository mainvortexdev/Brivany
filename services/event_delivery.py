"""Only a reviewed rule can upload its sealed export and send its verified link."""
import hashlib
from pathlib import Path
import re
from urllib.parse import urlsplit
from uuid import UUID,uuid5


class EventDelivery:
    def __init__(self,edits_factory,connections_factory,workspace,store):self.edits_factory=edits_factory;self.connections_factory=connections_factory;self.workspace=Path(workspace).resolve();self.store=store
    def __call__(self,action,rule,pending):
        if not rule.get('approved_at'):raise ValueError('Revisa y activa la entrega diferida.')
        if action['type']=='drive_upload':
            client=self.edits_factory();client.start()
            if pending.get('state')=='waiting':
                if client.identity.pid!=pending['editor_pid']:raise ValueError('La sesión de transferencia cambió; comprueba Drive antes de repetir.')
                transfers=client.call('drive_transfers');transfer=next((item for item in transfers.get('items',[]) if item.get('id')==pending['transfer_id']),None)
                if not transfer:raise ValueError('La transferencia ya no se observó.')
                if transfer.get('status')=='done':
                    link=transfer.get('webViewLink') or transfer.get('url') or transfer.get('link')
                    if not transfer.get('fileId') or not transfer.get('size') or transfer.get('uploaded')!=transfer['size'] or not isinstance(link,str) or urlsplit(link).scheme!='https' or urlsplit(link).hostname!='drive.google.com':raise ValueError('No se verificó la carga y su enlace.')
                    return {'state':'done','drive_link':link,'file_id':transfer['fileId'],'uploaded_bytes':transfer['size']}
                if transfer.get('status') in {'failed','cancelled','paused'}:raise ValueError('La transferencia no terminó.')
                return pending
            artifact=self.store.get('artifact:'+str(rule['source_job_id']))
            if not artifact or artifact.get('state')!='succeeded':raise ValueError('Falta una exportación con recibo íntegro.')
            file=Path(artifact['path'])
            if file.resolve()!=file or not file.is_relative_to(self.workspace) or not file.is_file() or file.stat().st_size!=artifact['size']:raise ValueError('El artefacto ya no coincide.')
            digest=hashlib.sha256()
            with file.open('rb') as source:
                for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
            if digest.hexdigest()!=artifact['sha256']:raise ValueError('La exportación cambió desde que terminó.')
            folder=action.get('folder_id')
            if not folder:
                candidates=[];token=None
                for index in range(30):
                    page=client.call('drive_list',{'pageToken':token} if token else {})
                    candidates += [item['id'] for item in page.get('files',[]) if item.get('name')==action['folder_name'] and item.get('mimeType')=='application/vnd.google-apps.folder']
                    token=page.get('nextPageToken')
                    if not token:break
                if token or len(candidates)!=1:raise ValueError('El destino es ambiguo o no está autorizado. Indica el enlace de la carpeta.')
                folder=candidates[0]
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,180}',folder):raise ValueError('Carpeta de Drive inválida.')
            result=client.call('drive_upload',{'file':str(file),'folderId':folder})
            if not isinstance(result.get('id'),str):raise ValueError('No se confirmó la identidad de transferencia.')
            return {'state':'waiting','transfer_id':result['id'],'editor_pid':client.identity.pid}
        if action['type']=='whatsapp_self_link':
            links=[value['drive_link'] for value in rule['results'] if value.get('drive_link')]
            if not links or not self.connections_factory:raise ValueError('Falta el enlace o la conexión WhatsApp.')
            integration=self.connections_factory().refresh_settings();recipient=integration.config.get('self_recipient')
            parameters={'recipient':recipient,'text':'Tu video está listo: '+links[-1]}
            request_id=str(uuid5(UUID(rule['id']),'delivery:'+str(rule['index'])))
            proposal=integration.propose('whatsapp.send',parameters,origin='local_ui',request_id=request_id)
            approval=integration.approve(proposal['id'],proposal['action_sha256'])
            receipt=integration.execute(proposal['id'],proposal['parameters'],approval['approval_id'],execute=True)
            result=receipt.get('result',{})
            if receipt['state'] not in {'succeeded','succeeded_test_stub'} or not result.get('accepted'):raise ValueError('WhatsApp no confirmó aceptación.')
            return {'state':'done','whatsapp_accepted':True,'delivery_confirmed':bool(result.get('delivered')),'simulated':receipt['state']=='succeeded_test_stub'}
        raise ValueError('Acción de entrega no admitida.')
