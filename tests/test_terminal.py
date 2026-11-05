"""Local terminal policy/gate tests. These do not certify catalog executions."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import sys
import unittest
from unittest.mock import patch
from services.terminal.policy import TerminalError, scoped, validate_program, repository_url, child_environment
from services.terminal.executor import TerminalExecutor
from services.terminal.checklist import CommandChecklist,SEED
from services.terminal.catalog import CommandCatalog
from services.terminal.service import TerminalService
from services.terminal.repair import repair_one,syntax_errors
from services.terminal.recipes import command
from services.terminal.artifacts import artifact_path
from services.terminal.programs import launch_program
from services.terminal.temporary import TemporaryCleanup
from services.terminal.editors import archive_target,discover_windows_editors,discover_macos_editors,select_editor,open_project_editor,prepare_editor_run
from services.computer.planner import MetaPlanner
from packages.providers.conversation import ConversationRequest


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        self.addCleanup(self.temp.cleanup)
        self.executor=TerminalExecutor(self.root)
    def tearDown(self):self.executor.close()

    def test_registry_vectors_rejected(self):
        for binary,args in [('reg.exe',['query','HKCU']),('regedit.exe',[]),('powershell.exe',['-Command','Set-ItemProperty HKLM:\\Software']),('python.exe',['-c','import winreg']),('powershell.exe',['-Command','[Microsoft.Win32.Registry]::LocalMachine']),('regini.exe',['input.txt'])]:
            with self.subTest(binary=binary,args=args),self.assertRaises(TerminalError):validate_program(binary,args)

    def test_no_destructive_system_tools(self):
        for name in ('diskpart.exe','format.exe','bcdedit.exe','sc.exe','rundll32.exe'):
            with self.subTest(name=name),self.assertRaises(TerminalError):validate_program(name,[])

    def test_path_escape_rejected(self):
        for candidate in (self.root/'..'/'outside.txt',self.root.parent/'outside.txt'):
            with self.assertRaises(TerminalError):scoped(candidate,[self.root])
        self.assertEqual(scoped(self.root/'new.txt',[self.root]),self.root/'new.txt')

    def test_repository_has_no_embedded_auth_or_command(self):
        self.assertEqual(repository_url('https://github.com/owner/project'),'https://github.com/owner/project')
        for url in ('file:///C:/source','https://token@github.com/a/b','https://github.com/a/b?token=x','https://github.com/a/b;calc'):
            with self.assertRaises(TerminalError):repository_url(url)

    def test_child_does_not_inherit_provider_credentials(self):
        with patch.dict(os.environ,{'BRIVANY_META_API_KEY':'test-only','AWS_SECRET_ACCESS_KEY':'test-only','BINANCE_API_KEY':'test-only','ELECTRON_RUN_AS_NODE':'1'}):
            environment=child_environment(self.root/'env')
        self.assertNotIn('BRIVANY_META_API_KEY',environment);self.assertNotIn('AWS_SECRET_ACCESS_KEY',environment)
        self.assertNotIn('BINANCE_API_KEY',environment);self.assertNotIn('ELECTRON_RUN_AS_NODE',environment)

    def test_git_cannot_push(self):
        with self.assertRaises(TerminalError):self.executor.git(['push','origin','main'],cwd=self.root)

    def test_catalog_documentation_not_execution(self):
        catalog=CommandCatalog();windows=[r for r in catalog.items.values() if r['platform']=='windows' and r.get('kind')!='shortcut']
        self.assertGreater(len(windows),50)
        self.assertTrue(any(r.get('name')=='Get-Content' for r in windows))
        self.assertTrue(any(r.get('name')=='ping' for r in windows))
        self.assertFalse(any(r.get('module') in {'ADCSAdministration','ADFS','ActiveDirectory'} for r in windows))
        self.assertTrue(all(r.get('source','').startswith('https://') for r in windows))
        checklist=CommandChecklist(self.executor)
        self.addCleanup(checklist.close)
        self.assertEqual(checklist.next()['position'],1)
        self.assertNotIn('approved',checklist.status()['counts'])

    def synthetic_receipt(self,position=1,output='"2026-11-01T00:00:00-04:00"',exit_code=0):
        identifier='synthetic-receipt'
        receipt={'id':identifier,'operation':'checklist.Get-Date','cwd':str(self.root),'pid':123,'output':output,'exit_code':exit_code,'interrupted':False}
        (self.executor.receipts/(identifier+'.json')).write_text(json.dumps(receipt),encoding='utf-8')
        c=CommandChecklist(self.executor)
        c.connection.execute("UPDATE items SET state='needs_review',receipt=? WHERE position=?",(identifier,position));c.connection.commit()
        return c,receipt

    def test_no_next_execution_until_reviewed(self):
        c,r=self.synthetic_receipt();self.addCleanup(c.close)
        with self.assertRaises(TerminalError):c.execute_next()
        with self.assertRaises(TerminalError):c.review('another-id',True,'Wrong receipt must never approve this item.')
        self.assertEqual(c.next()['position'],1)
        c.review(r['id'],True,'Synthetic ISO-date criterion inspected in unit test.')
        self.assertEqual(c.next()['position'],2)

    def test_failed_command_cannot_be_approved(self):
        c,r=self.synthetic_receipt(output='not a date',exit_code=1);self.addCleanup(c.close)
        with self.assertRaises(TerminalError):c.review(r['id'],True,'Cannot certify failed command with an approval.')
        c.review(r['id'],False,'Synthetic failure retained; next item must stay gated.')
        self.assertEqual(c.next()['position'],1)

    def test_choice_success_is_index_one_not_interruption_zero(self):
        from services.terminal.native_recipes import success_exit,verify
        receipt={'operation':'checklist.choice','argv':['choice.exe','/c','Y','/n','/t','0','/d','Y','/m','Melodi'],'cwd':str(self.root),'output':'Melodi Y\r\n','exit_code':1,'interrupted':False}
        self.assertTrue(success_exit('choice',1));self.assertTrue(verify('choice',receipt))
        self.assertFalse(success_exit('choice',0));self.assertFalse(success_exit('choice',255))
        self.assertFalse(verify('choice',{**receipt,'exit_code':0}))
        self.assertFalse(verify('choice',{**receipt,'output':'MelodiY'}))
        c=CommandChecklist(self.executor);self.addCleanup(c.close)
        entry=next(e for e in c.catalog.items.values() if e.get('name')=='choice')
        self.assertTrue(all(c.criteria({'id':entry['id']},receipt).values()))
        self.assertFalse(all(c.criteria({'id':entry['id']},{**receipt,'exit_code':0}).values()))

    def test_lost_file_effect_fails_review_without_crashing(self):
        c,r=self.synthetic_receipt(output='',exit_code=0);self.addCleanup(c.close)
        r.update(operation='checklist.Copy-Item')
        identifier=next(row['id'] for row in c.catalog.items.values() if row.get('name')=='Copy-Item' and row.get('module','').startswith('Microsoft.PowerShell'))
        checks=c.criteria({'id':identifier},r)
        self.assertFalse(checks['semantic_result_verified'])

    def test_generated_help_is_not_proof_of_target_command(self):
        c,r=self.synthetic_receipt(output='"Get-Date help text"');self.addCleanup(c.close)
        self.assertFalse(c.criteria(c.next(),r)['semantic_result_verified'])

    def test_router_accepts_typed_terminal_specialist(self):
        planner=MetaPlanner()
        with patch.object(planner,'generate',return_value={'kind':'terminal','goal':'Clonar proyecto'}):
            self.assertEqual(planner.route(ConversationRequest(text='Clonar proyecto',consent=True))['kind'],'terminal')

    def test_artifact_opening_cannot_launch_other_files(self):
        projects=self.root/'projects';projects.mkdir();image=projects/'capture.png';image.write_bytes(b'fixture')
        self.assertEqual(artifact_path({'capture':{'path':str(image)}},'capture',self.root),image)
        exe=projects/'program.exe';exe.write_bytes(b'fixture')
        with self.assertRaises(TerminalError):artifact_path({'capture':{'path':str(exe)}},'capture',self.root)
        outside=self.root/'outside.png';outside.write_bytes(b'fixture')
        with self.assertRaises(TerminalError):artifact_path({'capture':{'path':str(outside)}},'capture',self.root)

    @unittest.skipUnless(os.name=='nt','Windows elevation transport')
    def test_elevation_uses_runas_and_never_certifies_uac(self):
        from types import SimpleNamespace
        programs=SimpleNamespace(detect_editors=lambda:{'installed':[]})
        with patch('services.terminal.programs.os.startfile') as launch:
            result=launch_program(programs,self.root,'bloc de notas',elevated=True)
        self.assertEqual(launch.call_args.kwargs,{'operation':'runas'})
        self.assertFalse(result['elevation_verified']);self.assertTrue(result['requires_user'])

    def test_project_request_cannot_succeed_as_environment_inspection(self):
        service=TerminalService(self.root/'service')
        self.addCleanup(service.close)
        with self.assertRaises(TerminalError) as caught:
            service.run('Clona https://github.com/owner/project y arranca el servidor',decide=lambda *a:{'operation':'inspect_environment'},identifier='test',cancelled=threading.Event(),progress=lambda *a:None)
        self.assertEqual(caught.exception.code,'terminal_incomplete_plan')

    def test_scope_removes_enterprise_without_losing_approved_receipt(self):
        from tools.curate_terminal_catalog import curated
        entry={'id':'server-entry','name':'Add-CAAuthorityInformationAccess','module':'ADCSAdministration','kind':'powershell'}
        self.assertFalse(any(row['id']=='server-entry' for row in curated([entry])))
        c,r=self.synthetic_receipt();self.addCleanup(c.close)
        c.review(r['id'],True,'Synthetic date inspected before authorized scope change.')
        before=c.connection.execute("SELECT id,receipt,review FROM items WHERE state='approved'").fetchone()
        c.connection.execute("INSERT INTO items VALUES (?,?,?,?,?)",(999999,'server-entry','blocked',None,None));c.connection.commit()
        result=c.synchronize_desktop_scope()
        self.assertEqual(result['approved_preserved'],1);self.assertEqual(result['removed'],1)
        self.assertEqual(c.connection.execute("SELECT id,receipt,review FROM items WHERE state='approved'").fetchone(),before)

    def test_temporary_cleanup_only_old_regular_files_and_can_restore(self):
        import time
        temporary=self.root/'test-temp';temporary.mkdir();old=temporary/'old.tmp';old.write_text('disposable fixture')
        recent=temporary/'recent.tmp';recent.write_text('keep');nested=temporary/'folder';nested.mkdir();(nested/'inside.tmp').write_text('keep')
        now=time.time();os.utime(old,(now-8*86400,now-8*86400))
        cleanup=TemporaryCleanup(self.root/'cleanup',temporary=temporary,now=lambda:now)
        preview=cleanup.preview();self.assertEqual([r['name'] for r in preview['files']],['old.tmp'])
        result=cleanup.execute(preview['id']);self.assertEqual(result['moved_files'],1);self.assertFalse(old.exists());self.assertTrue(recent.exists());self.assertTrue((nested/'inside.tmp').exists())
        self.assertFalse(result['purged']);self.assertEqual(cleanup.restore(preview['id'])['restored'],['old.tmp']);self.assertEqual(old.read_text(),'disposable fixture')

    def test_cleanup_skips_changed_file_and_rejects_repeating(self):
        import time
        temporary=self.root/'test-temp';temporary.mkdir();old=temporary/'old.tmp';old.write_text('fixture')
        now=time.time();os.utime(old,(now-8*86400,now-8*86400))
        cleanup=TemporaryCleanup(self.root/'cleanup',temporary=temporary,now=lambda:now);preview=cleanup.preview();old.write_text('changed')
        result=cleanup.execute(preview['id']);self.assertEqual(result['moved_files'],0);self.assertEqual(result['skipped_files'],1);self.assertEqual(old.read_text(),'changed')
        with self.assertRaises(TerminalError):cleanup.execute(preview['id'])

    def test_editor_zip_rejects_escape_and_links(self):
        import zipfile
        for name in ('../Code.exe','C:/Windows/Code.exe','folder\\Code.exe','/Code.exe'):
            with self.subTest(name=name),self.assertRaises(TerminalError):archive_target(zipfile.ZipInfo(name),self.root)
        link=zipfile.ZipInfo('linked');link.external_attr=0o120777<<16
        with self.assertRaises(TerminalError):archive_target(link,self.root)
        self.assertEqual(archive_target(zipfile.ZipInfo('resources/app/file.json'),self.root),self.root/'resources/app/file.json')

    def test_antigravity_manager_is_not_the_ide(self):
        manager=self.root/'antigravity/Antigravity.exe';manager.parent.mkdir();manager.touch()
        result=discover_windows_editors([self.root])
        self.assertEqual(result['installed'],[])
        self.assertFalse(result['companion_apps'][0]['usable_as_ide'])
        ide=self.root/'Antigravity IDE/Antigravity IDE.exe';ide.parent.mkdir();ide.touch()
        code=self.root/'Microsoft VS Code/Code.exe';code.parent.mkdir();code.touch()
        result=discover_windows_editors([self.root,self.root])
        self.assertEqual(len(result['installed']),2)
        self.assertEqual(select_editor(result['installed'],'Abre la copia en Antigravity')['path'],str(ide))
        self.assertEqual(select_editor(result['installed'],'Abre un editor')['path'],str(code))
        self.assertEqual(select_editor(result['installed'],'Abre el editor sin mover el cursor del ratón')['path'],str(code))
        self.assertEqual(select_editor(result['installed'],'No uses Antigravity; abre el proyecto en VS Code')['path'],str(code))
        with self.assertRaises(TerminalError):select_editor(result['installed'],'Abre la copia en Cursor')

    def test_classic_antigravity_editor_is_still_detected(self):
        binary=self.root/'antigravity/Antigravity.exe';binary.parent.mkdir();binary.touch()
        metadata=binary.parent/'resources/app/product.json';metadata.parent.mkdir(parents=True);metadata.write_text('{}')
        result=discover_windows_editors([self.root])
        self.assertEqual(result['installed'],[{'name':'Antigravity','path':str(binary)}])
        self.assertEqual(result['companion_apps'],[])

    def test_macos_editor_discovery_with_directory_fixtures_not_a_mac_execution(self):
        manager=self.root/'Antigravity.app';manager.mkdir();ide=self.root/'Antigravity IDE.app';ide.mkdir()
        result=discover_macos_editors([self.root,self.root]);self.assertEqual(result['installed'],[{'name':'Antigravity','path':str(ide)}]);self.assertEqual(len(result['companion_apps']),1)

    def test_editor_launch_is_bound_to_working_copy_and_not_a_success_claim(self):
        work=self.root/'projects/fixture/work';work.mkdir(parents=True)
        binary=self.root/'Antigravity IDE.exe';binary.touch()
        with patch('services.terminal.editors.subprocess.Popen') as start,patch('services.terminal.editors.sys.platform','win32'):
            start.return_value.pid=123
            result=open_project_editor(self.executor,{'work':str(work)},{'name':'Antigravity','path':str(binary)})
        self.assertEqual(start.call_args.args[0],[str(binary),'--new-window',str(work)])
        self.assertEqual(start.call_args.kwargs['cwd'],work)
        self.assertNotIn('ELECTRON_RUN_AS_NODE',start.call_args.kwargs['env'])
        self.assertFalse(result['project_open_verified'])
        with self.assertRaises(TerminalError):open_project_editor(self.executor,{'work':str(work.parent)},{'name':'Antigravity','path':str(binary)})

    @unittest.skipUnless(os.name=='nt','Windows IDE launch configuration; not macOS certification')
    def test_ide_configuration_is_separate_and_has_no_automatic_task(self):
        work=self.root/'projects/fixture/work';(work/'web').mkdir(parents=True);(work/'web/server.py').write_text('# owned fixture')
        environment=work.parent/'python-env';(environment/'Scripts').mkdir(parents=True);(environment/'Scripts/python.exe').touch();(environment/'Lib/site-packages').mkdir(parents=True)
        project={'work':str(work)}
        node=self.root/'node.exe';node.write_bytes(b'owned fixture')
        with patch.object(self.executor,'binary',return_value=str(node)):prepared=prepare_editor_run(self.executor,project)
        workspace=json.loads(Path(prepared['workspace']).read_text(encoding='utf-8'));launch=workspace['launch']['configurations'][0]
        self.assertEqual(workspace['folders'][0]['path'],str(work));self.assertEqual(launch['console'],'internalConsole')
        self.assertNotIn('tasks',workspace);self.assertNotIn('preLaunchTask',launch);self.assertFalse(prepared['auto_run']);self.assertFalse(prepared['launched'])
        self.assertFalse((work/'.vscode').exists());self.assertEqual((work/'web/server.py').read_text(),'# owned fixture')
        self.assertTrue(Path(prepared['workspace']).is_relative_to(work.parent/'ide'))

    def test_ide_run_rejects_negated_and_hypothetical_requests_before_opening(self):
        service=TerminalService(self.root);self.addCleanup(service.close)
        plan={'operation':'project_run_editor','project':'not-opened'}
        with patch('services.terminal.editors.open_project_editor') as opened:
            for goal in ['Abre el proyecto en el IDE, no lo ejecutes','Abre Antigravity: por ejemplo ejecuta el proyecto','¿Abre el IDE e inicia el servidor?']:
                with self.subTest(goal=goal),self.assertRaises(TerminalError):service.run(goal,decide=lambda *args:plan,identifier='fixture',cancelled=threading.Event(),progress=lambda text:None,runtime=object())
            opened.assert_not_called()

    @unittest.skipUnless(os.name=='nt','Native Windows process-tree cancellation')
    def test_cancelling_owned_process_also_stops_its_child(self):
        marker=self.root/'child-finished.txt';child=self.root/'child.py';parent=self.root/'parent.py';started=self.root/'child-started.txt'
        child.write_text('import time\nfrom pathlib import Path\ntime.sleep(2)\nPath('+repr(str(marker))+').write_text("should not happen")\n',encoding='utf-8')
        parent.write_text('import subprocess,sys,time\nfrom pathlib import Path\np=subprocess.Popen([sys.executable,'+repr(str(child))+'])\nPath('+repr(str(started))+').write_text(str(p.pid))\ntime.sleep(30)\n',encoding='utf-8')
        cancelled=threading.Event()
        def cancel_when_started():
            until=time.monotonic()+5
            while not started.exists() and time.monotonic()<until:time.sleep(.02)
            cancelled.set()
        thread=threading.Thread(target=cancel_when_started,daemon=True);thread.start()
        receipt=self.executor.run('test.owned_process_tree',getattr(sys,'_base_executable',sys.executable),['-I',str(parent)],cwd=self.root,cancelled=cancelled,timeout=10)
        thread.join(timeout=1);self.assertTrue(receipt['interrupted']);self.assertTrue(started.exists())
        time.sleep(2.2);self.assertFalse(marker.exists(),'An owned child continued after cancellation')

    def repair_fixture(self,content):
        work=self.root/'work';source=self.root/'source';work.mkdir();source.mkdir()
        (work/'main.py').write_text(content,encoding='utf-8');(source/'main.py').write_text(content,encoding='utf-8')
        return {'work':str(work),'source':str(source)}

    def test_syntax_repair_is_scoped_and_preserves_original(self):
        project=self.repair_fixture('def greet()\n    return "hello"\n')
        self.assertEqual(len(syntax_errors(project['work'])),1)
        def decide(prompt,data):return {'path':data['error']['path'],'source_sha256':data['source_sha256'],'replacements':[{'line':1,'old':'def greet()','new':'def greet():'}]}
        receipt=repair_one(project,decide)
        self.assertTrue(receipt['syntax_verified']);self.assertEqual(syntax_errors(project['work']),[])
        self.assertEqual((Path(project['source'])/'main.py').read_text(),'def greet()\n    return "hello"\n')

    def test_syntax_repair_cannot_add_a_system_operation(self):
        project=self.repair_fixture('def greet()\n    return "hello"\n')
        def decide(prompt,data):return {'path':data['error']['path'],'source_sha256':data['source_sha256'],'replacements':[{'line':1,'old':'def greet()','new':'import winreg; def greet():'}]}
        with self.assertRaises(TerminalError):repair_one(project,decide)

    def test_repair_never_sends_credentials_to_model(self):
        project=self.repair_fixture('api_key="fixture-not-a-real-key"\ndef greet()\n    return 1\n')
        def decide(*args):self.fail('Sensitive source must not be sent to model')
        with self.assertRaises(TerminalError):repair_one(project,decide)

    @unittest.skipUnless(os.name=='nt','Real serializer regression requires Windows PowerShell')
    def test_get_content_serializes_only_file_text(self):
        (self.root/'seed.txt').write_bytes(SEED)
        receipt=self.executor.run('regression.Get-Content',str(Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',command('Get-Content',self.root)],cwd=self.root,timeout=15)
        self.assertEqual(receipt['exit_code'],0);self.assertFalse(receipt['interrupted'])
        self.assertEqual(json.loads(receipt['output']),['melodi','terminal']);self.assertLess(len(receipt['output']),100)


if __name__=='__main__':unittest.main()
