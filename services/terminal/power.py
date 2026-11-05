"""Persistent, cancellable shutdown waits. Tests inject a harmless action."""
from datetime import datetime,timezone
import json
import os
import math
from pathlib import Path
import re
import threading
import time
import uuid
from .policy import TerminalError


def delay_from_request(text):
    if not isinstance(text,str) or not re.search(r'\b(?:apaga|apagar|programa\s+(?:el\s+)?apagado)\b',text,re.I) or re.search(r'\b(?:si|ejemplo|cosas como|podr[ií]a|cómo|nunca|explica|expl[ií]came|ense[nñ]a|saber)\b',text,re.I) or re.search(r'\bno\s+(?:apaga\w*|program\w*|quiero\s+apaga\w*)',text,re.I):return None
    text=text.casefold()
    text=re.sub(r'\b(?:una?|1) hora y media\b','1 hora y 30 minutos',text)
    text=re.sub(r'\bun cuarto de hora\b','15 minutos',text)
    text=re.sub(r'\bmedia hora\b','30 minutos',text)
    numbers={'un':1,'una':1,'uno':1,'dos':2,'tres':3,'cuatro':4,'cinco':5,'seis':6,'siete':7,'ocho':8,'nueve':9,'diez':10,'quince':15,'veinte':20,'treinta':30,'cuarenta':40,'cincuenta':50,'sesenta':60}
    text=re.sub(r'\b('+ '|'.join(numbers)+r')\b',lambda match:str(numbers[match[0]]),text)
    match=re.search(r'\ben\s+(?:(\d{1,5})\s*(?:horas?|h)\s*(?:(?:y\s*)?(\d{1,5})\s*(?:minutos?|min))?|(\d{1,5})\s*(?:minutos?|min)|(\d{1,6})\s*(?:segundos?|s))\b',text,re.I)
    if not match:return None
    hours,minutes,m,s=match.groups();delay=int(hours or 0)*3600+int(minutes or m or 0)*60+int(s or 0)
    if not 60<=delay<=7*86400:raise TerminalError('El apagado programado admite entre un minuto y siete días.')
    return delay


class PowerScheduler:
    def __init__(self,root,action,*,clock=time.time,start_worker=True):
        self.directory=Path(root).resolve()/'power';self.directory.mkdir(parents=True,exist_ok=True)
        self.action=action;self.clock=clock;self.lock=threading.RLock();self.stop=threading.Event();self.thread=None
        # Never surprise the user with an overdue shutdown after Brivany starts.
        for path in self.directory.glob('*.json'):
            try:
                value=json.loads(path.read_text(encoding='utf-8'))
                if value['id']==path.stem and value['state']=='pending' and value['due']<=clock():value['state']='missed_while_closed';self.save(value)
            except (OSError,ValueError,KeyError,TypeError):continue
        if start_worker:self.thread=threading.Thread(target=self._worker,daemon=True,name='melodi-power-wait');self.thread.start()

    def save(self,value):
        if str(uuid.UUID(value['id']))!=value['id'] or not isinstance(value.get('due'),(int,float)) or not math.isfinite(value['due']):raise TerminalError('Registro de apagado inválido.')
        destination=self.directory/(value['id']+'.json');temporary=destination.with_suffix('.new')
        temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');temporary.replace(destination)

    def pending(self):
        values=[]
        for path in self.directory.glob('*.json'):
            try:
                value=json.loads(path.read_text(encoding='utf-8'))
                if value.get('state')=='pending' and str(uuid.UUID(value['id']))==path.stem and isinstance(value.get('due'),(int,float)) and math.isfinite(value['due']):values.append(value)
            except (OSError,ValueError,KeyError,TypeError):continue
        return values

    def schedule(self,seconds,consent_id):
        if type(seconds) is not int or not 60<=seconds<=7*86400 or not isinstance(consent_id,str):raise TerminalError('Espera de apagado inválida.')
        with self.lock:
            if self.pending():raise TerminalError('Ya hay un apagado pendiente; cancélalo antes de programar otro.')
            now=self.clock();value={'id':str(uuid.uuid4()),'created':now,'due':now+seconds,'delay_seconds':seconds,'state':'pending','consent_id':consent_id,'force_apps_closed':False,'requires_brivany_running':True}
            self.save(value)
        return {'title':'Apagado programado','power_id':value['id'],'due_utc':datetime.fromtimestamp(value['due'],timezone.utc).isoformat(),'scheduled':True,'executed':False,'verified':True,'requires_brivany_running':True,'message':f'Apagado programado dentro de {seconds//60} minutos. Brivany debe permanecer abierta. Puedes pedirme cancelar el apagado; no se forzará el cierre de aplicaciones.'}

    def cancel(self):
        with self.lock:
            pending=self.pending()
            if not pending:return {'verified':True,'cancelled':False,'message':'No hay un apagado pendiente de Melodi.'}
            for value in pending:value['state']='cancelled';self.save(value)
            return {'verified':True,'cancelled':True,'message':'Apagado programado cancelado.'}

    def tick(self):
        with self.lock:
            for value in self.pending():
                if value['due']>self.clock():continue
                try:
                    claim=os.open(self.directory/(value['id']+'.claim'),os.O_CREAT|os.O_EXCL|os.O_WRONLY)
                    os.close(claim)
                except FileExistsError:continue
                value['state']='requesting';self.save(value)
                try:
                    receipt=self.action();value['receipt_id']=receipt.get('id')
                    value['state']='shutdown_requested' if receipt.get('exit_code')==0 and not receipt.get('interrupted') else 'request_failed'
                except Exception:value['state']='request_failed'
                self.save(value)

    def _worker(self):
        while not self.stop.wait(.5):self.tick()

    def close(self):
        self.stop.set()
        if self.thread:self.thread.join(timeout=2)
