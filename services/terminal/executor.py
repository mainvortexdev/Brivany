"""Shell-free process transport and durable local receipts for trusted operations."""
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
from uuid import uuid4
from .policy import TerminalError,child_environment,scoped,validate_program
from .process_job import ProcessJob


class TerminalExecutor:
    def __init__(self,root):
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True)
        self.receipts=self.root/'receipts';self.receipts.mkdir(exist_ok=True);self.processes={};self.lock=threading.RLock()

    def binary(self,name):
        names=[name+'.exe',name] if os.name=='nt' and not name.endswith('.exe') else [name]
        for candidate in names:
            value=shutil.which(candidate)
            if value and Path(value).suffix.lower() not in {'.cmd','.bat','.ps1'}:return str(Path(value).resolve())
        raise TerminalError('No se encontró '+name+' en este equipo.','terminal_missing_program')

    def run(self,operation,binary,args,*,cwd,cancelled=None,timeout=180,_system_capability=None,output_encoding='utf-8'):
        # Only trusted dispatcher code calls this transport; models select an
        # operation ID, never a binary, command string or generated script.
        if _system_capability=='graceful_poweroff':
            expected=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/shutdown.exe'
            if os.name!='nt' or Path(binary).resolve()!=expected.resolve() or args!=['/s','/t','0'] or operation!='power.shutdown_request':raise ValueError('Capacidad de apagado inválida.')
        elif _system_capability is not None:raise ValueError('Capacidad del sistema inválida.')
        else:validate_program(binary,args)
        cwd=scoped(cwd,[self.root],existing=True)
        identifier=str(uuid4());started=datetime.now(timezone.utc).isoformat()
        environment=child_environment(self.root/'environment')
        job=ProcessJob()
        try:
            process=subprocess.Popen([binary,*args],cwd=cwd,env=environment,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            try:job.assign(process)
            except OSError:
                if process.poll() is None:process.terminate();process.wait(timeout=5)
                process.stdout.close();raise
        except BaseException:job.close();raise
        chunks=[];total=0;limit_reached=threading.Event()
        def drain():
            nonlocal total
            while True:
                value=process.stdout.read(4096)
                if not value:break
                if total+len(value)>200000:limit_reached.set()
                if total<200000:chunks.append(value[:200000-total]);total+=len(value)
        reader=threading.Thread(target=drain,daemon=True);reader.start();deadline=time.monotonic()+timeout;interrupted=False
        while process.poll() is None:
            if cancelled and cancelled.is_set() or time.monotonic()>deadline or limit_reached.is_set():
                interrupted=True
                if job.assigned:job.close()
                else:process.terminate()
                break
            time.sleep(.05)
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3)
        job.close();reader.join(timeout=3)
        if not reader.is_alive():process.stdout.close()
        output=b''.join(chunks).decode(output_encoding,errors='replace')
        receipt={'id':identifier,'operation':operation,'pid':process.pid,'started_at':started,'finished_at':datetime.now(timezone.utc).isoformat(),'argv':[str(binary),*args],'cwd':str(cwd),'exit_code':process.returncode,'interrupted':interrupted,'output':output,'output_encoding':output_encoding,'output_truncated':limit_reached.is_set(),'output_sha256':hashlib.sha256(output.encode()).hexdigest(),'reviewed':False}
        (self.receipts/(identifier+'.json')).write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        return receipt

    def git(self,args,*,cwd,cancelled=None,timeout=180):
        if not args or args[0] not in {'clone','status','rev-parse','remote','diff','show','archive','ls-remote'}:raise TerminalError('Operación Git no admitida; no se permite publicar cambios.')
        hooks=self.root/'empty-git-hooks';hooks.mkdir(exist_ok=True)
        return self.run('git.'+args[0],self.binary('git'),['-c','core.hooksPath='+str(hooks),'-c','protocol.file.allow=never','-c','protocol.ext.allow=never',*args],cwd=cwd,cancelled=cancelled,timeout=timeout)

    def require_success(self,receipt):
        if receipt['interrupted'] or receipt['exit_code']!=0:raise TerminalError('El comando no terminó correctamente. Revisa su recibo.','terminal_command_failed')
        return receipt

    def request_poweroff(self):
        binary=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/shutdown.exe'
        return self.run('power.shutdown_request',str(binary),['/s','/t','0'],cwd=self.root,timeout=10,_system_capability='graceful_poweroff')

    def start_server(self,binary,args,*,cwd,port):
        validate_program(binary,args);cwd=scoped(cwd,[self.root],existing=True)
        identifier=str(uuid4());log=self.receipts/(identifier+'.server.log')
        stream=log.open('wb');process=subprocess.Popen([binary,*args],cwd=cwd,env=child_environment(self.root/'environment'),stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        stream.close()
        with self.lock:self.processes[identifier]=process
        value={'id':identifier,'operation':'server.start','pid':process.pid,'argv':[binary,*args],'cwd':str(cwd),'url':'http://127.0.0.1:'+str(port),'log':str(log),'started_at':datetime.now(timezone.utc).isoformat(),'reviewed':False}
        (self.receipts/(identifier+'.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');return value

    def stop_server(self,identifier):
        with self.lock:process=self.processes.pop(identifier,None)
        if process and process.poll() is None:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3)

    def close(self):
        with self.lock:identifiers=list(self.processes)
        for identifier in identifiers:self.stop_server(identifier)
