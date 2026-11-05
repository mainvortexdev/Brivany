"""Automatic, local application recipes; observed selectors, never executable code."""
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit
from uuid import UUID,uuid4

ROLES={'ControlType.Button','ControlType.MenuItem','ControlType.Edit','ControlType.ComboBox','ControlType.TabItem','ControlType.TreeItem','ControlType.CheckBox'}
SENSITIVE=re.compile(r'password|contrase|token|secret|credential|api.?key|\b(pin|cvv|iban)\b',re.I)
RISKY=re.compile(r'eliminar|borrar|sobrescribir|reemplazar|enviar|publicar|comprar|pagar|transferir|instalar|delete|remove|overwrite|replace|send|publish|purchase|payment|install|permis|seguridad',re.I)

def identity(observation):
    foreground=observation.get('foreground') or {};process=str(foreground.get('processName','')).casefold().removesuffix('.exe')
    if not re.fullmatch(r'[a-z0-9_.-]{1,80}',process) or process in {'chrome','msedge','brave','firefox','regedit','consent','powershell','cmd','pwsh'}:return None
    value={'process':process,'class':str(foreground.get('className',''))[:80],'version':str(foreground.get('version') or 'unreported')[:50]}
    return {**value,'key':hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()}

def selector(control):
    name=control.get('name','');role=control.get('role')
    if not isinstance(name,str) or not 1<=len(name)<=80 or role not in ROLES or SENSITIVE.search(name) or re.search(r'[\d@\r\n]|https?://',name):return None
    return {'name':name,'role':role}

class ApplicationMemory:
    def _write(self,value):
        temp=self.root/(value['id']+'.'+uuid4().hex+'.tmp')
        try:
            temp.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');os.replace(temp,self.root/(value['id']+'.json'))
        finally:temp.unlink(missing_ok=True)
    @staticmethod
    def metrics(record):
        raw=record.get('performance',{});raw=raw if isinstance(raw,dict) else {}
        return {key:value if type(value) is int and 0<=value<=1000000000 else default for key,default in {'successful_runs':1,'consecutive_successes':1,'failed_reuses':0,'reused_runs':0,'saved_decisions':0,'execution_ms':0}.items() for value in [raw.get(key,default)]}
    def __init__(self,directory):
        self.root=Path(directory).resolve();self.root.mkdir(parents=True,exist_ok=True);self.lock=threading.RLock();self.records={}
        for path in sorted(self.root.glob('*.json'),key=lambda p:p.stat().st_mtime)[-100:]:
            try:
                if path.is_symlink() or getattr(path,'is_junction',lambda:False)():continue
                if path.stat().st_size>40000:continue
                value=json.loads(path.read_text(encoding='utf-8'));app=value.get('application') or {};steps=value.get('steps',[])
                valid=value.get('schema')==1 and value.get('verified') is True and str(UUID(value.get('id','')))==path.stem and re.fullmatch(r'[a-f0-9]{64}',app.get('key','')) and re.fullmatch(r'[a-z0-9_.-]{1,80}',app.get('process','')) and isinstance(value.get('title'),str) and isinstance(value.get('sources'),list) and 1<=len(steps)<=12
                if valid and all(s.get('action') in {'click_control','type_text'} and selector(s.get('selector',{}))==s.get('selector') and set(s)<={'action','selector','input'} and s.get('input','user_value')=='user_value' for s in steps):self.records[value['id']]=value
            except (OSError,ValueError,TypeError,AttributeError):continue
    def lookup(self,observation):
        app=identity(observation)
        if not app:return []
        visible=[selector(c) for c in observation.get('controls',[])];found=[]
        with self.lock:
            for record in reversed(list(self.records.values())):
                if record['application']['key']!=app['key'] or record['steps'][0]['selector'] not in visible:continue
                metrics=self.metrics(record)
                safe=2<=len(record['steps'])<=10 and not any(RISKY.search(s['selector']['name']) for s in record['steps'])
                found.append({**{k:record[k] for k in ('id','title','application','steps','sources','verification')},'performance':metrics,'shortcut_ready':safe and metrics['consecutive_successes']>=2})
                if len(found)==3:break
        return found
    def catalog(self):
        with self.lock:return [{'id':r['id'],'application':r['application']['process'],'title':r['title'],'steps':len(r['steps']),'verification':r['verification'],'performance':self.metrics(r)} for r in list(self.records.values())[-20:]]
    def bind(self,choice,observation):
        if not isinstance(choice,dict) or set(choice)!={'id','values'}:raise ValueError('Procedimiento no válido.')
        record=next((r for r in self.lookup(observation) if r['id']==choice['id'] and r['shortcut_ready']),None)
        if not record:raise ValueError('El procedimiento necesita más verificaciones o ya no coincide.')
        indices={str(i) for i,s in enumerate(record['steps']) if s['action']=='type_text'};values=choice['values']
        if not isinstance(values,dict) or set(values)!=indices or any(not isinstance(v,str) or not 0<len(v)<=4000 for v in values.values()):raise ValueError('Faltan datos actuales del procedimiento.')
        return {'record':record,'values':dict(values),'index':0}
    def next_step(self,program,observation):
        record=program['record'];app=identity(observation)
        if not app or app['key']!=record['application']['key']:return None
        index=program['index'];step=record['steps'][index]
        found=[c for c in observation.get('controls',[]) if selector(c)==step['selector'] and c.get('enabled',True) is not False and c.get('isEnabled',True) is not False]
        if len(found)!=1:return None
        foreground=observation.get('foreground') or {};windows=observation.get('windows',[])
        target=foreground if foreground.get('windowHandle') else (windows[0] if len(windows)==1 else {})
        handle=target.get('windowHandle',target.get('handle'));pid=target.get('processId',target.get('process_id'))
        if handle and pid is None:
            current=[w for w in windows if str(w.get('handle',w.get('windowHandle','')))==str(handle)]
            if len(current)==1:pid=current[0].get('processId',current[0].get('process_id'))
        if not str(handle or '').isdigit() or type(pid) is not int or pid<=0:return None
        params={'handle':str(handle),'process_id':pid,'control_id':found[0]['id']}
        if step['action']=='type_text':params['text']=program['values'][str(index)]
        return {'action':step['action'],'params':params}
    def penalize(self,identifier):
        with self.lock:
            record=self.records.get(identifier)
            if not record:return
            performance=self.metrics(record);performance['failed_reuses']+=1;performance['consecutive_successes']=0
            record['performance']=performance;self._write(record)
    def observe_step(self,job,observation,step,result):
        app=identity(observation);action=step.get('action');params=step.get('params',{})
        if not app or action not in {'type_text','click_control'} or result.get('requires_user'):return
        if action=='type_text' and result.get('text_value_verified') is not True:return
        if action=='click_control' and not (result.get('input_sent') or result.get('verified')):return
        controls=[c for c in observation.get('controls',[]) if c.get('id')==params.get('control_id')]
        if len(controls)!=1:return
        target=selector(controls[0])
        if not target:return
        rows=job.setdefault('_application_steps',[])
        if len(rows)>=12:return
        rows.append({'application':app,'step':{'action':action,'selector':target,**({'input':'user_value'} if action=='type_text' else {})}})
    def remember(self,job,sources=()):
        if job.get('state')!='succeeded' or job.get('review_state')!='accepted':return []
        rows=job.get('_application_steps',[]);groups={}
        for row in rows:groups.setdefault(row['application']['key'],[]).append(row)
        saved=[]
        for entries in groups.values():
            app=entries[0]['application'];steps=[r['step'] for r in entries]
            # Opening/typing alone does not prove a reusable application workflow.
            if not any(s['action']=='click_control' for s in steps):continue
            urls=[]
            for source in sources:
                url=source.get('url','') if isinstance(source,dict) else ''
                try:parsed=urlsplit(url)
                except ValueError:continue
                if parsed.scheme=='https' and parsed.hostname and not parsed.username and not parsed.password and not parsed.query:urls.append(url[:1000])
            value={'schema':1,'id':str(uuid4()),'job_id':job['id'],'created_at':datetime.now(timezone.utc).isoformat(),'application':app,'title':app['process']+' · '+next(s['selector']['name'] for s in reversed(steps) if s['action']=='click_control'),'steps':steps,'sources':list(dict.fromkeys(urls))[:6],'verified':True,'verification':'observed_controls_and_model_review','limitations':'Recipe guidance only. Reobserve controls and use current user values; no executable code, credentials, values or old runtime IDs.'}
            with self.lock:
                prior=next((r for r in self.records.values() if r['application']['key']==app['key'] and (r['job_id']==job['id'] or r['steps']==steps)),None)
                elapsed=max(0,min(1800000,int(1000*(job.get('execution_finished_at',0)-job.get('execution_started_at',0)))))
                if prior:
                    if job['id'] in {prior['job_id'],prior.get('last_job_id')}:continue
                    performance=self.metrics(prior);performance['successful_runs']+=1;performance['consecutive_successes']+=1;performance['execution_ms']+=elapsed
                    if job.get('_recipe_id')==prior['id'] and not job.get('_recipe_invalidated'):
                        performance['reused_runs']+=1;performance['saved_decisions']+=max(0,len(steps)-1)
                    prior.update(performance=performance,last_job_id=job['id'],last_verified_at=datetime.now(timezone.utc).isoformat());self._write(prior);saved.append(prior['id']);continue
                value['performance']={**self.metrics(value),'execution_ms':elapsed}
                with (self.root/(value['id']+'.json')).open('x',encoding='utf-8') as stream:json.dump(value,stream,ensure_ascii=False)
                self.records[value['id']]=value
                while len(self.records)>100:self.records.pop(next(iter(self.records)))
            saved.append(value['id'])
        return saved
