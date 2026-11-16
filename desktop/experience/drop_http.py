"""Private same-session binary blocks. No paths, CORS, public listeners or bulk buffers."""
import re
from urllib.parse import urlsplit,parse_qs
from .workspace_files import BLOCK_BYTES

def handle(handler,method):
    parsed=urlsplit(handler.path)
    if not parsed.path.startswith(('/api/desktop/drop/','/api/desktop/drop-import/')):return False
    if not handler.workspace_preferences_access():return True
    upload=re.fullmatch(r'/api/desktop/drop-import/([a-f0-9]{32})',parsed.path)
    if upload:
        try:
            shelf=getattr(getattr(handler.server,'desktop_bridge',None),'_workspace_file_shelf',None);query=parse_qs(parsed.query,keep_blank_values=True);length=int(handler.headers.get('Content-Length','0'))
            if method!='POST' or not shelf or set(query)!={'offset'} or len(query['offset'])!=1 or not re.fullmatch(r'\d{1,10}',query['offset'][0]) or not 1<=length<=BLOCK_BYTES or handler.headers.get('Transfer-Encoding') or handler.headers.get_content_type()!='application/octet-stream':raise ValueError()
            handler.connection.settimeout(15);data=handler.rfile.read(length)
            if len(data)!=length:raise ValueError()
            handler.send_json(200,shelf.write_upload_raw(upload[1],int(query['offset'][0]),data))
        except (ValueError,OSError,TypeError):handler.error(422,'drop_import','No se pudo copiar el bloque del archivo.')
        return True
    match=re.fullmatch(r'/api/desktop/drop/([A-Za-z0-9_-]{22})/(source|incoming)/([a-f0-9]{32})',parsed.path)
    service=getattr(getattr(handler.server,'desktop_bridge',None),'_workspace_file_transfer',None)
    token=(handler.headers.get('Authorization') or '').removeprefix('Bearer ')
    if not match or not service or not hasattr(service,'authenticate_local') or not service.authenticate_local(match[1],token):
        handler.reject_before_body(403,'drop_access','La transferencia ya no está disponible.');return True
    try:
        identifier,action,file_id=match.groups();query=parse_qs(parsed.query,keep_blank_values=True)
        expected={'offset','length'} if method=='GET' and action=='source' else {'offset'}
        if set(query)!=expected or any(len(v)!=1 or not re.fullmatch(r'\d{1,10}',v[0]) for v in query.values()):raise ValueError()
        offset=int(query['offset'][0])
        if method=='GET' and action=='source':
            data=service.read_raw(identifier,file_id,offset,int(query['length'][0]));handler.send_bytes(200,data,'application/octet-stream');return True
        if method!='POST' or action!='incoming':raise ValueError()
        length=int(handler.headers.get('Content-Length','0'))
        if not 1<=length<=BLOCK_BYTES or handler.headers.get('Transfer-Encoding') or handler.headers.get_content_type()!='application/octet-stream':raise ValueError()
        handler.connection.settimeout(15);data=handler.rfile.read(length)
        if len(data)!=length:raise ValueError()
        handler.send_json(200,service.write_receive_raw(identifier,file_id,offset,data,handler.headers.get('X-Brivany-Block-SHA256','')))
    except (ValueError,OSError,TypeError):handler.error(422,'drop_block','No se pudo leer o guardar el bloque. El archivo original se conserva.')
    return True
