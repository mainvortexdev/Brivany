"""Conservative temporary-file cleanup, with a recoverable local quarantine."""
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import uuid
from .policy import TerminalError,scoped


class TemporaryCleanup:
    def __init__(self,root,*,temporary=None,now=time.time):
        self.root=Path(root).resolve();self.directory=self.root/'temporary-cleanup';self.directory.mkdir(parents=True,exist_ok=True)
        self.temporary=Path(temporary or tempfile.gettempdir()).resolve();self.now=now

    def preview(self):
        # Only old, top-level regular files. Never recurse through application
        # caches, mounted folders, links, directories or Windows system folders.
        scoped(self.temporary,[self.temporary],existing=True)
        entries=[];total=0
        for file in self.temporary.iterdir():
            if len(entries)>=100:break
            try:
                scoped(file,[self.temporary],existing=True)
                if not file.is_file():continue
                stat=file.stat()
                if stat.st_mtime>self.now()-7*86400 or stat.st_size>32*1024*1024 or total+stat.st_size>128*1024*1024:continue
                # Metadata and digest bind the later move to this exact preview.
                entries.append({'name':file.name,'size':stat.st_size,'mtime_ns':stat.st_mtime_ns,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()});total+=stat.st_size
            except (OSError,TerminalError):continue
        identifier=str(uuid.uuid4());value={'id':identifier,'temporary_root':str(self.temporary),'files':entries,'bytes':total,'oldest_age_days':7,'recursive':False,'recoverable':True,'created_at':datetime.now(timezone.utc).isoformat()}
        (self.directory/(identifier+'.preview.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');return value

    def execute(self,identifier,cancelled=None):
        if not isinstance(identifier,str) or str(uuid.UUID(identifier))!=identifier:raise TerminalError('Vista de temporales inválida.')
        preview=json.loads((self.directory/(identifier+'.preview.json')).read_text(encoding='utf-8'))
        if preview['temporary_root']!=str(self.temporary):raise TerminalError('La carpeta temporal cambió.')
        target=self.directory/identifier
        if target.exists():raise TerminalError('Esta limpieza ya se intentó; no se repetirá.')
        target.mkdir();moved=[];skipped=[]
        manifest={'id':identifier,'moved':moved,'skipped':skipped,'purged':False,'method':'recoverable-quarantine','temporary_root':str(self.temporary)}
        manifest_path=target/'manifest.json'
        for item in preview['files']:
            if cancelled is not None and cancelled.is_set():break
            file=scoped(self.temporary/item['name'],[self.temporary]);destination=scoped(target/item['name'],[target])
            try:
                stat=file.stat()
                if not file.is_file() or stat.st_mtime_ns!=item['mtime_ns'] or stat.st_size!=item['size'] or hashlib.sha256(file.read_bytes()).hexdigest()!=item['sha256']:raise OSError('Changed since preview')
                shutil.move(str(file),str(destination));moved.append(item)
            except OSError:skipped.append(item['name'])
            manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        return {'title':'Temporales retirados','cleanup_id':identifier,'moved_files':len(moved),'skipped_files':len(skipped),'bytes_moved':sum(r['size'] for r in moved),'recoverable':True,'purged':False,'message':str(len(moved))+' temporales antiguos retirados de la carpeta temporal; se conserva recuperación local.'}

    def restore(self,identifier):
        if not isinstance(identifier,str) or str(uuid.UUID(identifier))!=identifier:raise TerminalError('Limpieza inválida.')
        target=scoped(self.directory/identifier,[self.directory],existing=True)
        manifest=json.loads((target/'manifest.json').read_text(encoding='utf-8'))
        if manifest['temporary_root']!=str(self.temporary):raise TerminalError('La carpeta temporal cambió.')
        restored=[]
        for item in manifest['moved']:
            file=scoped(target/item['name'],[target]);destination=scoped(self.temporary/item['name'],[self.temporary])
            if file.is_file() and not destination.exists() and hashlib.sha256(file.read_bytes()).hexdigest()==item['sha256']:
                shutil.move(str(file),str(destination));restored.append(item['name'])
        return {'restored':restored,'overwritten':False}
