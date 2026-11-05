"""Headless native-window substitute and real portable-project HTTP checks."""
from copy import deepcopy
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch,Mock
from uuid import uuid4
from zipfile import ZipFile

from desktop.bridge import DesktopBridge,DesktopError,ProjectSession,PROJECT_PREFIX
from desktop.launcher import LocalDesktopServer,dependency_status,launch,_windows_runtime_status
from services.projects import create_project,open_project
from services.spatial.demo import DEMO_ID
from services.spatial.jobs import SpatialService


class FakeWindow:
    def __init__(self,url,choices=()):self.url=url;self.choices=list(choices);self.dialogs=[];self.after_dialog=None
    def get_current_url(self):return self.url
    def create_file_dialog(self,kind,**options):
        self.dialogs.append((kind,options))
        if self.after_dialog:self.after_dialog()
        return self.choices.pop(0) if self.choices else None


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)
        self.source=self.root/'application-data';self.spatial=SpatialService(self.source,start_worker=False);self.addCleanup(self.spatial.close)
        self.portable=self.root/'portable';create_project(self.spatial,DEMO_ID,self.portable)
        self.session=ProjectSession();self.window=FakeWindow('http://127.0.0.1:9876/spaces')
        self.bridge=DesktopBridge('http://127.0.0.1:9876',self.session,lambda:self.spatial);self.bridge._bind_window(self.window)

    def test_dependency_inspection_does_not_import_gui_or_launch_server(self):
        with patch('desktop.launcher.LocalDesktopServer') as server:
            result=dependency_status();self.assertFalse(result['native_launch_verified']);self.assertFalse(result['macos_packaging_verified']);server.assert_not_called()
        with patch('desktop.launcher.dependency_status',return_value={'pywebview_available':False,'pywebview_version':None}):
            with self.assertRaises(DesktopError) as error:launch()
            self.assertEqual(error.exception.code,'desktop_dependency')

    def test_windows_runtime_probe_never_constructs_a_window_and_missing_runtime_stops_launch(self):
        completed=type('Result',(),{'returncode':0,'stdout':json.dumps({'winforms_assembly_loaded':True,
            'webview2_assemblies_loaded':True,'webview2_browser_version':'156.0.4314.50'}).encode()})()
        with patch('desktop.launcher.subprocess.run',return_value=completed) as run:
            status=_windows_runtime_status()
            if status['applicable']:
                command=run.call_args.args[0];self.assertIn('GetAvailableBrowserVersionString',command[-1])
                self.assertNotIn('create_window',command[-1]);self.assertFalse(status['native_window_started'])
        with patch('desktop.launcher.dependency_status',return_value={'pywebview_available':True,
            'pywebview_version':'6.2.1','edgechromium_available':False}),patch('desktop.launcher.sys.platform','win32'):
            with self.assertRaises(DesktopError) as error:launch()
            self.assertEqual(error.exception.code,'desktop_runtime')

    def test_bridge_origin_exact_host_port_scheme_and_allowed_viewer_paths(self):
        for url in ('https://127.0.0.1:9876/spaces','http://localhost:9876/spaces','http://127.0.0.1:9999/spaces',
            'http://127.0.0.1:9876.evil.invalid/spaces','http://user@127.0.0.1:9876/spaces',
            'file:///C:/private.html','https://example.org','http://127.0.0.1:9876/app'):
            self.window.url=url;result=self.bridge.pick_project_folder();self.assertFalse(result['ok'],url)
        self.assertEqual(self.window.dialogs,[])

    def test_native_cancel_and_open_only_selected_complete_folder(self):
        self.window.choices=[None,(str(self.portable),)]
        self.assertTrue(self.bridge.pick_project_folder()['cancelled'])
        result=self.bridge.pick_project_folder();self.assertTrue(result['ok']);self.assertFalse(result['cancelled'])
        payload=result['project'];self.assertEqual(payload['source'],'portable_project');self.assertEqual(payload['project']['revision'],1)
        self.assertFalse(payload['automatic_execution']);self.assertTrue(payload['project']['portable'])
        self.assertNotIn(str(self.root),json.dumps(payload));self.assertTrue(all(url.startswith(PROJECT_PREFIX) for url in payload['asset_urls'].values()))

    def test_navigation_during_native_dialog_does_not_open_selected_folder(self):
        self.window.choices=[(str(self.portable),)];self.window.after_dialog=lambda:setattr(self.window,'url','https://example.org')
        result=self.bridge.pick_project_folder();self.assertFalse(result['ok']);self.assertEqual(result['error']['code'],'desktop_origin');self.assertIsNone(self.session.current())

    def test_browser_payload_cannot_choose_arbitrary_path_or_export_without_native_picker(self):
        public={name for name in dir(self.bridge) if not name.startswith('_') and callable(getattr(self.bridge,name))}
        self.assertEqual(public,{'status','pick_project_folder','save_current_project','save_open_project','export_open_project','get_floorplan','save_floorplan','get_presentation','save_presentation'})
        result=self.bridge.save_current_project('../../.env');self.assertFalse(result['ok']);self.assertEqual(self.window.dialogs,[])
        self.window.choices=[(str(self.root/'not-a-project'),)]
        self.assertFalse(self.bridge.pick_project_folder()['ok']);self.assertIsNone(self.session.current())

    def test_save_current_creates_new_child_and_portable_reopen_does_not_read_appdata(self):
        self.window.choices=[(str(self.root),)]
        result=self.bridge.save_current_project(DEMO_ID);self.assertTrue(result['ok']);payload=result['project']
        folder=self.root/payload['project']['folder_name'];self.assertNotEqual(folder,self.portable);self.assertTrue((folder/'manifest.json').is_file())
        self.assertFalse(open_project(folder)['project']['flags']['reference_originals_included'])
        new_session=ProjectSession()
        with patch('services.projects.SpatialProjectSource',side_effect=AssertionError('application data forbidden')):
            reopened=new_session.open(folder);asset_id=next(iter(reopened['asset_urls']));url=reopened['asset_urls'][asset_id]
            token=url.removeprefix(PROJECT_PREFIX).split('/')[0];raw,mime=new_session.asset(token,asset_id)
        declared=next(asset for asset in reopened['scene']['assets'] if asset['id']==asset_id)
        self.assertEqual(hashlib.sha256(raw).hexdigest(),declared['sha256']);self.assertEqual(mime,'model/gltf-binary')

    def test_save_open_project_validates_revision_and_locked_environment(self):
        self.session.open(self.portable)
        result=self.bridge.save_open_project(1,[{'id':'chair','transform':{'position':[1.,0.,0.]}}]);self.assertTrue(result['ok']);self.assertEqual(result['project']['revision'],2)
        stale=self.bridge.save_open_project(1,[]);self.assertFalse(stale['ok']);self.assertEqual(stale['error']['code'],'project_conflict');self.assertEqual(stale['error']['status'],409)
        locked=self.bridge.save_open_project(2,[{'id':'room','transform':{'position':[1.,0.,0.]}}]);self.assertFalse(locked['ok']);self.assertEqual(open_project(self.portable)['revision'],2)

    def test_native_zip_export_does_not_overwrite_or_publish_project_secrets(self):
        self.session.open(self.portable);destination=self.root/'portable-export.zip';self.window.choices=[(str(destination),)]
        result=self.bridge.export_open_project();self.assertTrue(result['ok']);self.assertTrue(destination.is_file())
        self.window.choices=[(str(destination),)];self.assertFalse(self.bridge.export_open_project()['ok'])
        self.assertEqual(self.window.dialogs[0][0],30);self.assertFalse(result['export']['automatic_execution'])

    def test_owned_loopback_server_serves_exact_manifest_asset_rejects_token_host_and_tamper(self):
        payload=self.session.open(self.portable);asset_id=next(iter(payload['asset_urls']));url=payload['asset_urls'][asset_id]
        with LocalDesktopServer(session=self.session) as server:
            self.assertEqual(server.http.server_address[0],'127.0.0.1');self.assertNotEqual(server.http.server_port,0)
            connection=http.client.HTTPConnection('127.0.0.1',server.http.server_port,timeout=3)
            def get(route,headers=None):
                connection.request('GET',route,headers=headers or {});response=connection.getresponse();return response.status,response.getheader('Content-Type'),response.read()
            status,mime,raw=get(url);self.assertEqual(status,200);self.assertEqual(mime,'model/gltf-binary')
            asset=next(value for value in payload['scene']['assets'] if value['id']==asset_id);self.assertEqual(hashlib.sha256(raw).hexdigest(),asset['sha256'])
            self.assertEqual(get(url,{'Host':'evil.invalid'})[0],403)
            self.assertEqual(get(url.replace(url.split('/')[4],'A'*32))[0],403)
            self.assertEqual(get(url+'/../../manifest.json')[0],404)
            self.assertEqual(get(url+'?path=.env')[0],404)
            (self.portable/asset['relative_path']).write_bytes(b'corrupt')
            self.assertNotEqual(get(url)[0],200);connection.close()
        self.assertIsNone(server.thread)

    def test_opening_another_project_invalidates_previous_asset_grant(self):
        first=self.session.open(self.portable);url=next(iter(first['asset_urls'].values()));token=url.removeprefix(PROJECT_PREFIX).split('/')[0]
        second=self.session.open(self.portable);self.assertNotEqual(next(iter(second['asset_urls'].values())),url)
        with self.assertRaises(DesktopError):self.session.asset(token,first['scene']['assets'][0]['id'])

    def test_startup_diagnostic_only_reads_fixed_metadata_and_preserves_existing_files(self):
        from desktop.diagnostics import StartupProbe,SNAPSHOT
        target=self.root/'startup.json';window=Mock()
        window.evaluate_js.return_value={'sceneReady':True,'bridgeAvailable':True,'nativeControlsVisible':True,'drawCalls':4}
        probe=StartupProbe(window,target);probe.loaded();probe.run()
        result=json.loads(target.read_text(encoding='utf-8'));self.assertEqual(result['status'],'passed')
        window.evaluate_js.assert_called_once_with(SNAPSHOT);self.assertFalse(result['native_editing_verified'])
        self.assertEqual(result['ui_actions_automated'],0)
        with self.assertRaises(ValueError):StartupProbe(window,target)

    def test_live_desktop_starts_and_closes_only_local_bridge_factories(self):
        names=['MuseBridge','RiverBridge']
        from contextlib import ExitStack
        with ExitStack() as stack:
            load=stack.enter_context(patch('services.h1.server.load_local_config'))
            factories=[stack.enter_context(patch('services.h1.server.'+name)) for name in names]
            retired=[stack.enter_context(patch('services.h1.server.'+name)) for name in ['TranslationBridge','ElevenBridge','ModularBridge','GeminiBridge','OpenAITranslationBridge']]
            with LocalDesktopServer(session=self.session,live=True) as server:
                self.assertEqual(len(server.bridges),2);load.assert_called_once()
                self.assertIs(server.http.river_bridge,factories[1].return_value.start.return_value)
                for factory in factories:factory.assert_called_once_with(server.http.server_port);factory.return_value.start.assert_called_once()
            for factory in factories:factory.return_value.start.return_value.close.assert_called_once()
            for factory in retired:factory.assert_not_called()

    def test_portable_floorplan_projects_verified_assets_and_declared_scale_read_only(self):
        from services.spatial.plan_settings import DEFAULT
        self.session.open(self.portable);before=open_project(self.portable)
        config=deepcopy(DEFAULT);config['references']=[{'id':'ref-one','points':[[0.,0.],[2.,0.]],'measured_m':3.,'method':'laser','note':'Synthetic declaration'}]
        result=self.bridge.get_floorplan(1,config);self.assertTrue(result['ok'])
        plan=result['floorplan'];self.assertEqual(plan['source'],'portable_project')
        self.assertEqual(plan['scene_revision'],1);self.assertEqual(plan['scale']['meters_per_unit'],1.5)
        self.assertFalse(plan['scale']['metric_scale_verified']);self.assertFalse(plan['architectural_accuracy_verified'])
        self.assertTrue(plan['preview_only']);self.assertGreater(len(plan['objects']),0)
        self.assertEqual(open_project(self.portable),before);self.assertEqual(self.window.dialogs,[])
        self.assertNotIn(str(self.root),json.dumps(result))

    def test_portable_floorplan_save_reopen_and_numeric_edit_keep_versioned_config(self):
        from services.spatial.plan_settings import DEFAULT
        self.session.open(self.portable);before=open_project(self.portable)
        config=deepcopy(DEFAULT);config['references']=[{'id':'ref-one','points':[[0.,0.],[2.,0.]],'measured_m':3.,'method':'other','note':'Synthetic declaration'}]
        saved=self.bridge.save_floorplan(1,config);self.assertTrue(saved['ok'])
        self.assertEqual(saved['project']['revision'],2);self.assertEqual(saved['project']['scene_revision'],before['scene_revision'])
        self.assertEqual(saved['project']['plan_config'],saved['floorplan']['config'])
        self.assertTrue(saved['floorplan']['settings_persisted']);self.assertEqual(saved['floorplan']['settings_revision'],2)
        reopened=ProjectSession();payload=reopened.open(self.portable)
        self.assertEqual(reopened.floorplan(2)['config'],payload['plan_config'])
        result=reopened.save(expected_revision=2,objects=[{'id':'chair','transform':{'position':[1.8,0.,0.]}}])
        self.assertEqual(result['revision'],3);self.assertEqual(result['plan_config'],payload['plan_config'])
        self.assertEqual(reopened.floorplan(3)['config'],payload['plan_config'])
        stale=self.bridge.save_floorplan(2,config);self.assertFalse(stale['ok']);self.assertEqual(stale['error']['status'],409)
        self.assertEqual(open_project(self.portable)['revision'],3)

    def test_portable_floorplan_rejects_invalid_params_origin_stale_and_tampered_assets(self):
        from services.spatial.plan_settings import DEFAULT
        missing=self.bridge.get_floorplan(1);self.assertFalse(missing['ok'])
        self.session.open(self.portable)
        invalid=self.bridge.get_floorplan(1,{**DEFAULT,'path':'C:/private'})
        self.assertFalse(invalid['ok']);self.assertEqual(invalid['error']['code'],'plan_config')
        stale=self.bridge.get_floorplan(0);self.assertFalse(stale['ok']);self.assertEqual(stale['error']['status'],409)
        self.window.url='https://example.invalid'
        self.assertEqual(self.bridge.get_floorplan(1)['error']['status'],403)
        self.window.url='http://127.0.0.1:9876/spaces'
        current=open_project(self.portable);asset=current['scene']['assets'][0]
        (self.portable/asset['relative_path']).write_bytes(b'changed')
        corrupted=self.bridge.get_floorplan(1);self.assertFalse(corrupted['ok']);self.assertEqual(corrupted['error']['code'],'project_integrity')

    def test_portable_floorplan_detects_committed_edit_during_geometry_extraction(self):
        self.session.open(self.portable)
        from desktop.bridge import build_floorplan
        def changed(*args,**kwargs):
            result=build_floorplan(*args,**kwargs)
            from services.projects import save_project
            save_project(self.portable,expected_revision=1,title='Changed concurrently')
            return result
        with patch('desktop.bridge.build_floorplan',side_effect=changed):result=self.bridge.get_floorplan(1)
        self.assertFalse(result['ok']);self.assertEqual(result['error']['status'],409)

    def presentation_config(self):
        return {'title':'Visita sintética portátil','points':[{'id':str(uuid4()),'label':'Sillón','note':'Punto declarado.',
            'object_id':'chair','camera':{'position':[4.,2.,5.],'target':[0.,1.,0.],'fov':38.}}]}

    def test_export_presentation_pins_readonly_application_snapshot_without_worker_or_metadata_write(self):
        from services.spatial.presentation import PresentationService
        from services.projects import SpatialProjectSource
        config=self.presentation_config();PresentationService(self.spatial).save(DEMO_ID,{'expected_revision':0,'expected_scene_revision':1,'config':config})
        target=self.root/'with-tour'
        with patch('services.spatial.presentation.PresentationService.db',side_effect=AssertionError('readonly snapshot cannot start a write')):
            created=create_project(SpatialProjectSource(self.source),DEMO_ID,target)
        self.assertEqual(created['presentation_config'],config);self.assertEqual(created['presentation_source_scene_revision'],1)
        source=PresentationService(self.spatial).get(DEMO_ID);self.assertEqual(source['revision'],1)
        self.assertEqual(self.spatial.scene(DEMO_ID)['revision'],1)

    def test_portable_presentation_save_reopen_export_and_edit_preserve_view_with_revision_warning(self):
        self.session.open(self.portable);config=self.presentation_config();before=open_project(self.portable)
        saved=self.bridge.save_presentation(1,config);self.assertTrue(saved['ok'])
        self.assertEqual(saved['project']['revision'],2);self.assertEqual(saved['project']['scene_revision'],before['scene_revision'])
        self.assertEqual(saved['presentation']['config'],config);self.assertFalse(saved['presentation']['needs_scene_review'])
        self.assertEqual(saved['project']['history'],self.session.current()['history'])
        reopened=ProjectSession();reopened.open(self.portable);self.assertEqual(reopened.presentation(2)['config'],config)
        moved=reopened.save(expected_revision=2,objects=[{'id':'chair','transform':{'position':[1.8,0.,0.]}}]);self.assertEqual(moved['scene_revision'],2)
        plan=reopened.presentation(3);self.assertEqual(plan['config'],config);self.assertTrue(plan['needs_scene_review']);self.assertEqual(plan['source_scene_revision'],1)
        reviewed=reopened.save_presentation(3,config);self.assertEqual(reviewed['project']['revision'],4);self.assertFalse(reviewed['presentation']['needs_scene_review'])
        self.assertEqual(reviewed['presentation']['source_scene_revision'],2);self.assertEqual(reviewed['project']['scene_revision'],2)
        archive=self.root/'tour.zip';reopened.export(archive)
        with ZipFile(archive) as package:self.assertEqual(json.loads(package.read('versions/revision-000004.json'))['presentation_config'],config)

    def test_portable_presentation_rejects_missing_origin_paths_unknown_objects_stale_and_tamper(self):
        self.assertFalse(self.bridge.get_presentation(1)['ok']);self.session.open(self.portable)
        config=self.presentation_config();invalid=deepcopy(config);invalid['points'][0]['object_id']='missing'
        result=self.bridge.save_presentation(1,invalid);self.assertFalse(result['ok']);self.assertEqual(open_project(self.portable)['revision'],1)
        self.assertFalse(self.bridge.save_presentation(1,{**config,'path':'C:/private'})['ok'])
        self.assertFalse(self.bridge.get_presentation(True)['ok']);self.assertEqual(self.bridge.get_presentation(0)['error']['status'],409)
        self.window.url='https://example.invalid';self.assertEqual(self.bridge.save_presentation(1,config)['error']['status'],403)
        self.window.url='http://127.0.0.1:9876/spaces';asset=open_project(self.portable)['scene']['assets'][0]
        (self.portable/asset['relative_path']).write_bytes(b'changed');self.assertEqual(self.bridge.get_presentation(1)['error']['code'],'project_integrity')

    def test_legacy_portable_versions_without_presentation_still_open_with_empty_route(self):
        version_path=self.portable/'versions/revision-000001.json';document=json.loads(version_path.read_bytes())
        document.pop('presentation_config');document.pop('presentation_source_scene_revision');raw=json.dumps(document,ensure_ascii=False).encode();version_path.write_bytes(raw)
        manifest_path=self.portable/'manifest.json';manifest=json.loads(manifest_path.read_bytes());digest=hashlib.sha256(raw).hexdigest()
        for entry in manifest['files']:
            if entry['path']=='versions/revision-000001.json':entry.update(sha256=digest,size_bytes=len(raw))
        manifest['versions'][0]['sha256']=digest;manifest_path.write_text(json.dumps(manifest),encoding='utf-8')
        value=self.session.open(self.portable);self.assertEqual(value['presentation_config']['points'],[])
        self.assertIsNone(value['presentation_source_scene_revision']);route=self.session.presentation(1)
        self.assertFalse(route['needs_scene_review']);self.assertEqual(route['config']['points'],[])


if __name__=='__main__':unittest.main()
