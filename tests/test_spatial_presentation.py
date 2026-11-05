"""Persistent authored views on synthetic geometry; no public sharing or models."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from services.spatial.demo import DEMO_ID
from services.spatial.jobs import SpatialService,SpatialServiceError
from services.spatial.presentation import PresentationService,PresentationError,validate_camera,validate_presentation_config,DEFAULT


class PresentationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.spatial=SpatialService(self.root/'spatial',start_worker=False);self.addCleanup(self.spatial.close)
        self.service=PresentationService(self.spatial)

    def point(self,**changes):
        return {'id':str(uuid4()),'label':'Vista del sillón','note':'Descripción declarada de prueba.',
            'camera':{'position':[4.,2.,5.],'target':[0.,1.,0.],'fov':38.},'object_id':'chair',**changes}

    def config(self):return {'title':'Visita sintética','points':[self.point()]}
    def save(self,config=None,service=None,revision=0,scene_revision=1):
        return (service or self.service).save(DEMO_ID,{'expected_revision':revision,'expected_scene_revision':scene_revision,'config':config or self.config()})

    def test_passive_initial_read_does_not_create_database(self):
        result=self.service.get(DEMO_ID);self.assertEqual(result['revision'],0);self.assertEqual(result['config'],DEFAULT)
        self.assertFalse(self.service.database.exists());self.assertFalse(result['shared']);self.assertFalse(result['public_link_implemented'])

    def test_save_reopen_does_not_mutate_geometry_and_binds_revision(self):
        before=self.spatial.scene(DEMO_ID);saved=self.save();reopened=PresentationService(self.spatial).get(DEMO_ID)
        self.assertEqual(saved,reopened);self.assertEqual(saved['source_scene_revision'],1);self.assertFalse(saved['needs_scene_review'])
        self.assertEqual(self.spatial.scene(DEMO_ID),before);self.assertFalse(saved['reconstruction_fidelity_verified'])

    def test_concurrent_writers_claim_one_revision(self):
        other=SpatialService(self.spatial.root,start_worker=False);self.addCleanup(other.close)
        def write(spatial):
            try:return self.save(service=PresentationService(spatial))['revision']
            except PresentationError as exc:return exc.status
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(write,[self.spatial,other]))
        self.assertEqual(results.count(1),1);self.assertEqual(results.count(409),1)

    def test_cross_instance_scene_lock_rejects_stale_geometry(self):
        self.save();self.spatial.update_transforms(DEMO_ID,{'expected_revision':1,'objects':[{'id':'chair','transform':{'position':[1.,0.,0.]}}]})
        self.assertTrue(self.service.get(DEMO_ID)['needs_scene_review'])
        with self.assertRaises(PresentationError) as error:self.save(revision=1)
        self.assertEqual(error.exception.status,409)
        updated=self.save(revision=1,scene_revision=2);self.assertEqual(updated['revision'],2);self.assertFalse(updated['needs_scene_review'])

    def test_reorder_rename_replace_camera_remove_and_clear_persist(self):
        first,second=self.point(),self.point(label='Segunda vista',object_id=None)
        saved=self.save({'title':'Recorrido','points':[first,second]})
        changed=deepcopy(first);changed.update(label='Vista nueva',note='',camera={'position':[-3.,3.,2.],'target':[0.,0.,0.],'fov':50.})
        updated=self.save({'title':'Renombrado','points':[second,changed]},revision=1)
        self.assertEqual([item['id'] for item in updated['config']['points']],[second['id'],first['id']])
        removed=self.save({'title':'Renombrado','points':[changed]},revision=2);self.assertEqual(len(removed['config']['points']),1)
        cleared=self.save({'title':'Vacío','points':[]},revision=3);self.assertEqual(cleared['config']['points'],[])

    def test_points_limit_duplicate_unknown_object_and_text_links_reject_without_write(self):
        invalids=[{'title':'Muchos','points':[self.point() for _ in range(13)]},
            {'title':'Duplicados','points':[self.point(id='22222222-2222-4222-8222-222222222222')]*2},
            {'title':'Objeto','points':[self.point(object_id='missing')]},
            {'title':'Enlace','points':[self.point(note='https://example.com/private')]},
            {'title':'Datos','points':[self.point(note='data:image/jpeg;base64,private')]},
            {'title':'HTML','points':[self.point(label='<b>Vista</b>')]}]
        for config in invalids:
            with self.subTest(config=config),self.assertRaises(PresentationError):self.save(config)
        self.assertEqual(self.service.get(DEMO_ID)['revision'],0)

    def test_camera_bounds_booleans_nonfinite_and_degenerate_are_rejected(self):
        good=self.point()['camera']
        for changed in ({'position':[math.nan,1.,2.]},{'position':[True,1.,2.]},{'position':[100001,1.,2.]},
            {'target':good['position']},{'fov':True},{'fov':101},{'fov':14},{'target':[1.,2.]},{'fov':math.inf}):
            with self.subTest(changed=changed),self.assertRaises(PresentationError):validate_camera({**good,**changed})
        self.assertEqual(validate_camera(good),good)

    def test_unknown_scene_and_extra_payload_fields_cannot_persist(self):
        with self.assertRaises(SpatialServiceError):self.service.get(str(uuid4()))
        payload={'expected_revision':0,'expected_scene_revision':1,'config':self.config(),'url':'https://bad.invalid'}
        with self.assertRaises(PresentationError):self.service.save(DEMO_ID,payload)
        for name in ('expected_revision','expected_scene_revision'):
            with self.assertRaises(PresentationError):self.service.save(DEMO_ID,{**payload,name:True})
        self.assertFalse(self.service.database.exists())

    def test_backup_roundtrip_retains_private_camera_route_and_stale_revision_warning(self):
        from services.spatial.backup import create_backup,restore_backup
        config=self.config();self.save(config)
        self.spatial.update_transforms(DEMO_ID,{'expected_revision':1,'objects':[{'id':'chair','transform':{'position':[1.,0.,0.]}}]})
        archive=self.root/'tour-backup.zip';destination=self.root/'restored'
        with patch('services.spatial.backup._server_listening',return_value=False):
            create_backup(self.spatial.root,archive,offline=True);restore_backup(archive,destination,offline=True)
        restored=SpatialService(destination,start_worker=False);self.addCleanup(restored.close)
        current=PresentationService(restored).get(DEMO_ID);self.assertEqual(current['config'],config)
        self.assertEqual(current['source_scene_revision'],1);self.assertEqual(current['scene_revision'],2);self.assertTrue(current['needs_scene_review'])
        self.assertFalse(current['shared']);self.assertIsNone(restored.thread)

    def test_backup_rejects_route_without_scene_future_source_invalid_camera_or_undeclared_schema(self):
        from services.spatial.backup import BackupError,create_backup
        self.save()
        changes=[('scene_id',str(uuid4())),('source_scene_revision',2),('document','{"title":"Bad","points":{}}')]
        for index,(field,value) in enumerate(changes):
            with self.service.db() as db:
                previous=db.execute('SELECT '+field+' FROM presentations').fetchone()[0]
                db.execute('UPDATE presentations SET '+field+'=?',(value,))
            with self.subTest(field=field),patch('services.spatial.backup._server_listening',return_value=False),self.assertRaises(BackupError):
                create_backup(self.spatial.root,self.root/('rejected-'+str(index)+'.zip'),offline=True)
            with self.service.db() as db:db.execute('UPDATE presentations SET '+field+'=?',(previous,))
        with self.service.db() as db:db.execute('CREATE TABLE private_unlisted(secret TEXT)')
        with patch('services.spatial.backup._server_listening',return_value=False),self.assertRaises(BackupError):
            create_backup(self.spatial.root,self.root/'rejected-schema.zip',offline=True)


if __name__=='__main__':unittest.main()
