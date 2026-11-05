"""Actual mesh projection and declared scale fitting, with no model/API/GPU."""
from copy import deepcopy
import hashlib
import json
import math
import struct
import unittest
from uuid import uuid4

from services.spatial.demo import make_glb,scene_document
from services.spatial.floorplan import (FloorPlanDocument,FloorPlanError,FloorPlanService,
                                      build_floorplan,fit_scale)


def _asset_scene(parts,role='object'):
    raw=make_glb(parts);scene,_=scene_document()
    value=scene.model_dump(mode='json');value['objects']=[value['objects'][1]]
    value['objects'][0].update(id='target',label='Objeto de prueba',asset_id='target',role=role,editable=role!='environment')
    value['objects'][0]['transform']={'position':[0.,0.,0.],'rotation_xyzw':[0.,0.,0.,1.],'scale':[1.,1.,1.]}
    value['assets']=[{**value['assets'][0],'id':'target','relative_path':'assets/target.glb','sha256':hashlib.sha256(raw).hexdigest()}]
    return value,{'target':raw}


def _rewrite(raw,change):
    size=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+size]);change(doc)
    data=json.dumps(doc,separators=(',',':')).encode();data+=b' '*((-len(data))%4)
    tail=raw[20+size:];chunks=struct.pack('<II',len(data),0x4e4f534a)+data+tail
    return struct.pack('<III',0x46546c67,2,len(chunks)+12)+chunks


class FloorPlanTests(unittest.TestCase):
    def test_current_transform_is_source_of_truth_not_authored_footprint_sizes(self):
        scene,assets=_asset_scene([(0,1,[0,1,0],[2,2,4])])
        before=deepcopy(scene);result=build_floorplan(scene,assets,revision=3)
        self.assertEqual(scene,before);self.assertEqual(result['scene_revision'],3)
        self.assertEqual(result['objects'][0]['polygon'],[[-1.,-2.],[1.,-2.],[1.,2.],[-1.,2.]])
        q=math.sqrt(.5);scene['objects'][0]['transform']={'position':[5.,0.,2.],'rotation_xyzw':[0.,q,0.,q],'scale':[2.,1.,1.]}
        changed=build_floorplan(scene,assets,revision=4)
        self.assertEqual(changed['objects'][0]['polygon'],[[3.,0.],[7.,0.],[7.,4.],[3.,4.]])
        self.assertFalse(changed['architectural_accuracy_verified']);self.assertFalse(changed['coverage_verified'])

    def test_real_architectural_section_preserves_a_door_gap(self):
        # Two actual wall meshes flank a two-unit opening. A floor and lintel
        # must not appear in the horizontal one-unit-height section.
        scene,assets=_asset_scene([(0,0,[-2,1.5,0],[2,3,.2]),(0,0,[2,1.5,0],[2,3,.2]),
                                  (0,0,[0,2.75,0],[2,.5,.2]),(0,6,[0,-.1,0],[6,.2,4])],role='environment')
        result=build_floorplan(scene,assets,cut_height=1.)
        self.assertTrue(result['architecture'])
        for segment in result['architecture']:
            self.assertFalse(any(-.999<p[0]<.999 for p in segment['points']))
        self.assertEqual(result['annotations'],[])
        self.assertEqual(len(result['uncertainty_zones']),1)
        self.assertEqual(result['uncertainty_zones'][0]['provenance'],'derived_unverified')

    def test_nested_node_matrices_are_applied_and_bad_graph_is_rejected(self):
        scene,assets=_asset_scene([(0,1,[0,0,0],[2,2,2])]);raw=assets['target']
        def nested(doc):
            doc['nodes'].append({'translation':[10,0,3],'children':[0]});doc['scenes'][0]['nodes']=[1]
        raw=_rewrite(raw,nested);assets['target']=raw;scene['assets'][0]['sha256']=hashlib.sha256(raw).hexdigest()
        result=build_floorplan(scene,assets);self.assertEqual(result['bounds'],[[9.,2.],[11.,4.]])
        raw=_rewrite(raw,lambda doc:doc['nodes'][0].update(children=[1]))
        assets['target']=raw;scene['assets'][0]['sha256']=hashlib.sha256(raw).hexdigest()
        with self.assertRaises(FloorPlanError):build_floorplan(scene,assets)

    def test_no_measured_dimensions_are_invented_for_relative_scene(self):
        scene,assets=scene_document();result=build_floorplan(scene,assets)
        self.assertEqual(result['scale']['status'],'source_relative');self.assertIsNone(result['scale']['meters_per_unit'])
        self.assertEqual(result['scale']['references'],[]);self.assertEqual(result['scale']['residuals'],[])
        self.assertFalse(result['scale']['metric_scale_verified']);self.assertIsNone(result['scale']['rms_residual_m'])
        self.assertEqual(FloorPlanDocument.model_validate(result).scene_origin,'generated_demo')
        self.assertNotIn('area_m2',result);self.assertFalse(result['model_executed'])

    def reference(self,number,points,length):
        return {'id':'ref-'+str(number),'points':points,'measured_m':length,'method':'tape_measure','note':'Medición introducida por la persona.'}

    def test_single_reference_fits_but_cannot_report_accuracy_or_verify_scale(self):
        result=fit_scale([self.reference(1,[[0.,0.],[2.,0.]],3.)])
        self.assertEqual(result['meters_per_unit'],1.5);self.assertEqual(result['status'],'user_declared_fit')
        self.assertEqual(result['residuals'],[]);self.assertIsNone(result['rms_residual_m'])
        self.assertFalse(result['independent_validation']);self.assertFalse(result['metric_scale_verified'])

    def test_multiple_references_report_fit_residual_not_professional_accuracy(self):
        result=fit_scale([self.reference(1,[[0.,0.],[2.,0.]],3.),self.reference(2,[[0.,0.],[0.,4.]],5.)])
        self.assertAlmostEqual(result['meters_per_unit'],1.3);self.assertEqual(len(result['residuals']),2)
        self.assertAlmostEqual(result['residuals'][0]['residual_m'],-.4);self.assertAlmostEqual(result['residuals'][1]['residual_m'],.2)
        self.assertAlmostEqual(result['rms_residual_m'],math.sqrt(.1));self.assertAlmostEqual(result['max_abs_residual_m'],.4)
        self.assertFalse(result['measurement_accuracy_verified'])

    def test_invalid_or_repeated_reference_cannot_create_misleading_fit(self):
        reference=self.reference(1,[[0.,0.],[2.,0.]],3.)
        for changed in ({**reference,'measured_m':0.},{**reference,'points':[[0.,0.],[0.,0.]]},
                        {**reference,'points':[[float('nan'),0.],[1.,0.]]},{**reference,'provenance':'verified'}):
            with self.assertRaises(FloorPlanError):fit_scale([changed])
        with self.assertRaises(FloorPlanError):fit_scale([reference,{**reference,'id':'ref-2','points':list(reversed(reference['points']))}])

    def test_annotations_and_uncertain_zones_require_explicit_provenance(self):
        scene,assets=scene_document();note={'id':'door-1','kind':'door','points':[[0.,0.],[1.,0.]],'label':'Puerta declarada',
            'provenance':'user_declared','note':'Ubicación indicada manualmente, pendiente de captura.'}
        zone={'id':'hidden-room','polygon':[[0.,0.],[1.,0.],[1.,1.]],'reason':'Superficie no observada.',
              'provenance':'user_declared'}
        result=build_floorplan(scene,assets,annotations=[note],uncertainty_zones=[zone])
        self.assertEqual(result['annotations'][0],note);self.assertEqual(len(result['uncertainty_zones']),2)
        with self.assertRaises(FloorPlanError):build_floorplan(scene,assets,annotations=[{**note,'provenance':'observed_by_ai'}])
        with self.assertRaises(FloorPlanError):build_floorplan(scene,assets,uncertainty_zones=[{**zone,'verified':True}])

    def test_hash_mismatch_rejected_before_a_geometry_result(self):
        scene,assets=scene_document();assets['chair']+=b'changed'
        with self.assertRaises(FloorPlanError) as error:build_floorplan(scene,assets)
        self.assertEqual(error.exception.code,'floorplan_assets')

    def test_service_tracks_current_revision_and_rejects_edit_during_projection(self):
        scene,assets=scene_document();payload={'scene':scene.model_dump(mode='json'),'revision':2}
        class Source:
            def scene(self,_):return deepcopy(payload)
            def asset(self,_,identifier):return assets[identifier],'model/gltf-binary'
        service=FloorPlanService(Source());result=service.get(str(scene.scene_id),expected_revision=2)
        self.assertEqual(result['scene_revision'],2)
        with self.assertRaises(FloorPlanError) as error:service.get(str(scene.scene_id),expected_revision=1)
        self.assertEqual(error.exception.status,409)
        class Changing(Source):
            def asset(self,*args):payload['revision']+=1;return super().asset(*args)
        with self.assertRaises(FloorPlanError):FloorPlanService(Changing()).get(str(scene.scene_id))

    def test_reference_interior_uses_actual_meshes_and_marks_manual_origin(self):
        from services.spatial.reference_scene import scene_document as interior
        scene,assets,_=interior(str(uuid4()),'Interior de prueba',str(uuid4()))
        result=build_floorplan(scene,assets,revision=1)
        self.assertEqual(len(result['objects']),22);self.assertTrue(result['architecture'])
        self.assertEqual(result['scene_origin'],'reference_interpretation');self.assertEqual(result['source_units'],'source_relative')
        self.assertFalse(result['scale']['metric_scale_verified'])
        self.assertTrue(all(obj['asset_sha256']==scene['assets'][next(i for i,a in enumerate(scene['assets']) if a['id']==obj['asset_id'])]['sha256'] for obj in result['objects']))


if __name__=='__main__':unittest.main()
