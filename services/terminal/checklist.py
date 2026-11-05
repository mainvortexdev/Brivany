"""Serial verification gate: execute one item, inspect it, then explicitly review."""
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid
import zipfile
from contextlib import nullcontext
from .catalog import CommandCatalog
from .policy import TerminalError
from .recipes import command,RECIPES
from .native_recipes import NATIVE,invocation,verify as verify_native,success_exit

SEED=b'melodi\nterminal\n'


class CommandChecklist:
    def __init__(self,executor):
        self.executor=executor;self.catalog=CommandCatalog();self.directory=executor.root/'checklist';self.directory.mkdir(exist_ok=True)
        self.connection=sqlite3.connect(self.directory/'verification.sqlite3',check_same_thread=False)
        self.connection.execute('CREATE TABLE IF NOT EXISTS items (position INTEGER PRIMARY KEY, id TEXT UNIQUE, state TEXT NOT NULL, receipt TEXT, review TEXT)')
        self.connection.execute('CREATE TABLE IF NOT EXISTS elevations (position INTEGER PRIMARY KEY, request_id TEXT, state TEXT)')
        if not self.connection.execute('SELECT COUNT(*) FROM items').fetchone()[0]:
            values=list(self.catalog.items.values());ordered=[]
            for name in RECIPES:
                entry=next((r for r in values if r.get('name')==name and r.get('module','').startswith('Microsoft.PowerShell')),None)
                if entry:ordered.append(entry)
            ids={row['id'] for row in ordered};ordered += [row for row in values if row['id'] not in ids]
            self.connection.executemany('INSERT INTO items VALUES (?,?,?,?,?)',[(i,row['id'],'prohibited' if row.get('policy')=='registry_forbidden' else 'pending',None,None) for i,row in enumerate(ordered,1)]);self.connection.commit()

    def next(self):
        row=self.connection.execute("SELECT position,id,state,receipt,review FROM items WHERE state NOT IN ('approved','prohibited') ORDER BY position LIMIT 1").fetchone()
        return dict(zip(('position','id','state','receipt','review'),row)) if row else None

    def status(self):
        return {'counts':dict(self.connection.execute('SELECT state,COUNT(*) FROM items GROUP BY state')),'next':self.next(),'registry_edits_allowed':False,'review_required_before_next':True}

    def synchronize_desktop_scope(self):
        """Explicit scope migration; retain every approved execution by ID."""
        rows=[dict(zip(('position','id','state','receipt','review'),row)) for row in self.connection.execute('SELECT * FROM items ORDER BY position')]
        if any(row['state'] in {'needs_review','elevation_pending'} for row in rows):raise TerminalError('Termina y revisa la ejecución pendiente antes de cambiar el alcance.')
        if any(row['state']=='approved' and row['id'] not in self.catalog.items for row in rows):raise TerminalError('El cambio de alcance no puede descartar una ejecución aprobada.')
        stamp=datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]
        snapshot=self.directory/('scope-before-'+stamp+'.json');snapshot.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
        previous={r['id']:r for r in rows};approved=[r['id'] for r in rows if r['state']=='approved'];ordered=list(approved)
        for name in RECIPES:
            for entry in self.catalog.items.values():
                if entry.get('name')==name and entry.get('module','').startswith('Microsoft.PowerShell') and entry['id'] not in ordered:ordered.append(entry['id']);break
        ordered += [identifier for identifier in self.catalog.items if identifier not in ordered]
        with self.connection:
            self.connection.execute('DELETE FROM items')
            self.connection.executemany('INSERT INTO items VALUES (?,?,?,?,?)',[(i,identifier,previous.get(identifier,{}).get('state','pending'),previous.get(identifier,{}).get('receipt'),previous.get(identifier,{}).get('review')) for i,identifier in enumerate(ordered,1)])
        return {'previous_items':len(rows),'active_items':len(ordered),'removed':sum(r['id'] not in self.catalog.items for r in rows),'approved_preserved':len(approved),'history':str(snapshot),'authorization':'User removed server/enterprise commands; desktop commands and shortcuts only.'}

    def execute_next(self,cancelled=None):
        item=self.next()
        if not item:return {'complete':True}
        if item['state']=='needs_review':raise TerminalError('Revisa el recibo anterior antes de ejecutar otro comando.','terminal_review_required')
        if item['state']=='elevation_pending':raise TerminalError('Hay un diagnóstico elevado pendiente de recoger; no se repetirá.','terminal_elevation_pending')
        entry=self.catalog.items[item['id']];name=entry.get('name','')
        if entry['platform']!='windows' or name not in RECIPES and name not in NATIVE:
            self.connection.execute("UPDATE items SET state='blocked' WHERE position=?",(item['position'],));self.connection.commit()
            raise TerminalError('Este elemento todavía necesita un entorno o una receta verificada. No se aprobará consultando su ayuda.','terminal_test_not_available')
        directory=self.directory/('step-'+str(item['position']).zfill(4)+'-'+uuid.uuid4().hex[:8]);directory.mkdir()
        (directory/'seed.txt').write_bytes(SEED);(directory/'append.txt').write_text('alpha\n',encoding='utf-8');(directory/'input.csv').write_text('Probe,Number\nmelodi,2\n',encoding='utf-8')
        with zipfile.ZipFile(directory/'input.zip','w') as bundle:bundle.writestr('inside.txt','melodi archive fixture')
        binary=Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
        if not binary.exists():raise TerminalError('Este equipo no dispone del host Windows de esta receta.','terminal_platform_unavailable')
        if name in NATIVE:
            tool,args,encoding=invocation(name)
            receipt=self.executor.run('checklist.'+name,tool,args,cwd=directory,cancelled=cancelled,timeout=45,output_encoding=encoding)
        else:
            from .fixtures import download_server
            with download_server() if name in {'Start-BitsTransfer','Get-NetTCPConnection','Test-NetConnection'} else nullcontext(None) as fixture_url:
                receipt=self.executor.run('checklist.'+name,str(binary),['-NoLogo','-NoProfile','-NonInteractive','-Command',command(name,directory,fixture_url)],cwd=directory,cancelled=cancelled,timeout=45)
        self.connection.execute("UPDATE items SET state='needs_review',receipt=?,review=NULL WHERE position=?",(receipt['id'],item['position']));self.connection.commit()
        return {'position':item['position'],'entry':entry,'receipt':receipt,'criteria':self.criteria(item,receipt)}

    def request_elevated_next(self):
        from .elevation import ElevationRequests
        item=self.next()
        if not item or self.catalog.items[item['id']].get('name')!='chkdsk' or item['state'] not in {'failed','blocked'}:raise TerminalError('Sólo el CHKDSK pendiente y revisado admite este diagnóstico elevado.')
        requests=ElevationRequests(self.directory/'elevations');request=requests.prepare_chkdsk()
        self.connection.execute('INSERT OR REPLACE INTO elevations VALUES (?,?,?)',(item['position'],request['id'],'pending'))
        self.connection.execute("UPDATE items SET state='elevation_pending' WHERE position=?",(item['position'],));self.connection.commit()
        try:return requests.launch(request)
        except Exception:
            self.connection.execute("UPDATE elevations SET state='launch_failed' WHERE position=?",(item['position'],));self.connection.execute("UPDATE items SET state='failed' WHERE position=?",(item['position'],));self.connection.commit();raise

    def collect_elevated_next(self):
        from .elevation import ElevationRequests
        item=self.next()
        if not item or item['state']!='elevation_pending':raise TerminalError('No hay un diagnóstico elevado pendiente.')
        row=self.connection.execute('SELECT request_id FROM elevations WHERE position=? AND state=\'pending\'',(item['position'],)).fetchone()
        if not row:raise TerminalError('No se encontró la solicitud elevada.')
        requests=ElevationRequests(self.directory/'elevations');request=json.loads((requests.root/row[0]/'request.json').read_text(encoding='utf-8'))
        if not Path(request['result']).exists():return {'pending':True,'request_id':request['id'],'executed_verified':False}
        result=requests.result(request);identifier=str(uuid.uuid4());output=result['output']
        receipt={'id':identifier,'operation':'checklist.chkdsk','pid':result['pid'],'started_at':result['started_at'],'finished_at':result['finished_at'],'argv':[result['binary'],*result['arguments']],'cwd':result['cwd'],'exit_code':result['exit_code'],'interrupted':False,'output':output,'output_encoding':'captured-as-utf8-json','output_truncated':result['output_truncated'],'output_sha256':hashlib.sha256(output.encode()).hexdigest(),'reviewed':False,'admin_token_verified':True,'elevation_request_id':request['id'],'repair_requested':False}
        (self.executor.receipts/(identifier+'.json')).write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        self.connection.execute("UPDATE elevations SET state='collected' WHERE position=?",(item['position'],));self.connection.execute("UPDATE items SET state='needs_review',receipt=?,review=NULL WHERE position=?",(identifier,item['position']));self.connection.commit()
        return {'position':item['position'],'name':'chkdsk','receipt_id':identifier,'output':output[:4000],'criteria':self.criteria(item,receipt)}

    def criteria(self,item,receipt):
        name=self.catalog.items[item['id']].get('name');checks={'exit_code_zero':receipt['exit_code']==0,'not_interrupted':not receipt['interrupted'],'output_complete':not receipt.get('output_truncated',False)}
        if name in NATIVE:
            checks.pop('exit_code_zero')
            checks['exit_code_expected']=success_exit(name,receipt['exit_code'])
            checks['recipe_matches']=receipt['operation']=='checklist.'+name
            try:checks['native_result_verified']=verify_native(name,receipt)
            except (OSError,ValueError,TypeError,KeyError):checks['native_result_verified']=False
            return checks
        writes={'Set-Content','Add-Content','Copy-Item','Move-Item','Rename-Item','Remove-Item','Export-Csv','Out-File','Compress-Archive','Expand-Archive','Start-BitsTransfer'}
        try:actual=json.loads(receipt['output']) if receipt['output'].strip() else None;checks['recipe_matches']=receipt['operation']=='checklist.'+name;checks['structured_result']=actual is not None or name in writes
        except (ValueError,KeyError,TypeError):checks['structured_result']=False;return checks
        try:checks['semantic_result_verified']=self.semantic(name,actual,Path(receipt['cwd']),receipt)
        except (OSError,ValueError,TypeError,KeyError,AttributeError,zipfile.BadZipFile):checks['semantic_result_verified']=False
        return checks

    def semantic(self,name,actual,root,receipt):
        expected_hash=hashlib.sha256(SEED).hexdigest()
        if name=='Get-Date':
            try:datetime.fromisoformat(actual);ok=True
            except (ValueError,TypeError):ok=False
        elif name in {'Get-Location','Join-Path','Resolve-Path'}:ok=Path(actual)==(root if name=='Get-Location' else root/'seed.txt')
        elif name=='Test-Path':ok=actual is True
        elif name=='New-Item':ok=Path(actual)==root/'new-directory' and (root/'new-directory').is_dir()
        elif name=='Get-Item':ok=actual==len(SEED)
        elif name=='Get-ChildItem':ok='seed.txt' in actual
        elif name=='Split-Path':ok=actual=='seed.txt'
        elif name=='Get-FileHash':ok=actual.lower()==expected_hash
        elif name=='Copy-Item':ok=(root/'copy.txt').read_bytes()==SEED
        elif name=='Get-Content':ok=actual==['melodi','terminal']
        elif name=='Set-Content':ok=(root/'set.txt').read_text(encoding='utf-8-sig')=='alpha'
        elif name=='Add-Content':ok=(root/'append.txt').read_text(encoding='utf-8-sig').splitlines()==['alpha','beta']
        elif name in {'Move-Item','Rename-Item'}:ok=not (root/'seed.txt').exists() and (root/('moved.txt' if name=='Move-Item' else 'renamed.txt')).read_bytes()==SEED
        elif name=='Remove-Item':ok=not (root/'seed.txt').exists()
        elif name in {'Get-Command','Get-Help'}:ok=actual.lower()=='get-date'
        elif name=='Get-Module':ok='Microsoft.PowerShell.Utility' in actual
        elif name=='Get-PSProvider':ok=actual=='FileSystem'
        elif name=='Get-PSDrive':ok=root.drive.rstrip(':') in actual
        elif name=='Get-Process':ok=actual==receipt['pid'] and isinstance(actual,int) and actual>0
        elif name in {'Get-Culture','Get-UICulture'}:ok=isinstance(actual,str) and len(actual)>1
        elif name=='Measure-Object':ok=actual==4
        elif name=='Select-Object':ok=actual=={'Alpha':1}
        elif name=='Sort-Object':ok=actual==[1,2,3]
        elif name=='Where-Object':ok=actual==[3,4]
        elif name=='Group-Object':ok={r['Name']:r['Count'] for r in actual}=={'a':2,'b':1}
        elif name=='Compare-Object':ok={str(r['InputObject']):r['SideIndicator'] for r in actual}=={'1':'<=','3':'=>'}
        elif name=='ConvertTo-Json':ok=json.loads(actual)=={'probe':'melodi','n':2}
        elif name=='ConvertFrom-Json':ok=actual=={'probe':'melodi','n':2}
        elif name=='Export-Csv':ok='"melodi"' in (root/'export.csv').read_text(encoding='utf-8-sig')
        elif name=='Import-Csv':ok=actual=={'Probe':'melodi','Number':'2'}
        elif name=='Select-String':ok=actual=='terminal'
        elif name=='Out-File':ok=(root/'out.txt').read_text(encoding='utf-8-sig').strip()=='melodi'
        elif name=='Tee-Object':ok=actual=='melodi' and (root/'tee.txt').read_text(encoding='utf-16').strip()=='melodi'
        elif name=='Get-Variable':ok=actual=='PSVersionTable'
        elif name=='Compress-Archive':
            with zipfile.ZipFile(root/'compressed.zip') as bundle:ok=bundle.read('seed.txt')==SEED
        elif name=='Expand-Archive':ok=(root/'expanded/inside.txt').read_text()=='melodi archive fixture'
        elif name=='New-Guid':ok=str(uuid.UUID(actual))==actual
        elif name=='Get-Random':ok=type(actual) is int and 1<=actual<100
        elif name=='Get-Verb':ok='Open' in actual
        elif name=='Get-BitsTransfer':ok=type(actual) is int and actual>=0
        elif name=='Start-BitsTransfer':
            from .fixtures import DOWNLOAD
            ok=(root/'download.txt').read_bytes()==DOWNLOAD
        elif name=='Resolve-DnsName':ok=actual=='127.0.0.1' or isinstance(actual,list) and '127.0.0.1' in actual
        elif name in {'Get-NetAdapter','Get-NetIPConfiguration','Get-Disk','Get-Partition'}:ok=type(actual) is int and actual>0
        elif name=='Get-NetIPAddress':ok=actual=='127.0.0.1'
        elif name=='Get-NetRoute':ok=actual=='127.0.0.0/8' or isinstance(actual,list) and '127.0.0.0/8' in actual
        elif name=='Get-NetTCPConnection':
            import re
            expected=re.search(r'-LocalPort (\d+) -State Listen',receipt['argv'][-1])
            ok=expected is not None and actual==int(expected[1])
        elif name=='Test-NetConnection':ok=actual is True
        elif name=='Get-Volume':ok=actual==root.drive.rstrip(':')
        elif name=='Get-Alias':ok=actual=='Get-Content'
        else:ok=False
        return bool(ok)

    def review(self,identifier,approve,reason):
        item=self.next()
        if not item or item['state']!='needs_review' or item['receipt']!=identifier:raise TerminalError('No corresponde al recibo pendiente de revisión.')
        if type(approve) is not bool or not isinstance(reason,str) or not 8<=len(reason)<=600:raise TerminalError('La revisión necesita decisión y motivo.')
        raw=(self.executor.receipts/(identifier+'.json')).read_bytes();receipt=json.loads(raw);checks=self.criteria(item,receipt)
        if approve and not all(checks.values()):raise TerminalError('Los resultados no permiten aprobar el comando.')
        review={'receipt_id':identifier,'position':item['position'],'approved':approve,'reason':reason,'criteria':checks,'receipt_sha256':hashlib.sha256(raw).hexdigest(),'reviewed_at':datetime.now(timezone.utc).isoformat()}
        path=self.directory/(identifier+'.review.json');path.write_text(json.dumps(review,ensure_ascii=False,indent=2),encoding='utf-8')
        self.connection.execute('UPDATE items SET state=?,review=? WHERE position=?',('approved' if approve else 'failed',str(path),item['position']));self.connection.commit();return review

    def markdown(self,destination):
        lines=['# Checklist de terminal de Melodi','','Catálogo no equivale a ejecución. Solo [x] indica ejecución y revisión aprobadas.','']
        for position,identifier,state in self.connection.execute('SELECT position,id,state FROM items ORDER BY position'):
            entry=self.catalog.items[identifier];label=entry.get('name',entry.get('keys',''))
            lines.append(f"{position}. [{'x' if state=='approved' else ' '}] **{label}** · {entry['platform']} · {state} · [fuente]({entry['source']})")
        Path(destination).write_text('\n'.join(lines)+'\n',encoding='utf-8')

    def close(self):self.connection.close()
