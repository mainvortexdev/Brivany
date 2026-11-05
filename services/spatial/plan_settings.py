"""Versioned authored plan metadata; declarations never certify geometry."""
from copy import deepcopy
import json
import math

from services.spatial.floorplan import PlanReference,PlanAnnotation,UncertaintyZone,FloorPlanError,fit_scale

DEFAULT={'references':[],'annotations':[],'uncertainty_zones':[],'cut_height':1.0}


def validate_plan_config(value):
    if not isinstance(value,dict) or set(value)!=set(DEFAULT):raise FloorPlanError('plan_config','La configuración del plano no cumple el contrato.')
    result={}
    try:
        for name,model,limit in [('references',PlanReference,20),('annotations',PlanAnnotation,100),('uncertainty_zones',UncertaintyZone,100)]:
            if not isinstance(value[name],list) or len(value[name])>limit:raise ValueError()
            items=[model.model_validate(item).model_dump(mode='json') for item in value[name]]
            if len({item['id'] for item in items})!=len(items):raise ValueError()
            result[name]=items
        height=value['cut_height']
        if type(height) not in (int,float) or not math.isfinite(height) or not -1000<=height<=1000:raise ValueError()
        result['cut_height']=float(height)
        fit_scale(result['references'])
        if any(zone['id']=='geometry-unverified' for zone in result['uncertainty_zones']):raise ValueError()
        if len(json.dumps(result,ensure_ascii=False).encode())>60000:raise ValueError()
    except (ValueError,TypeError):raise FloorPlanError('plan_config','Revisa puntos, medidas, anotaciones y límites del plano.') from None
    return result


class PlanSettingsService:
    def __init__(self,spatial):self.spatial=spatial

    @staticmethod
    def _read(db,scene_id):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_plan_settings'").fetchone():return {'revision':0,'config':deepcopy(DEFAULT)}
        row=db.execute('SELECT revision,document FROM scene_plan_settings WHERE scene_id=?',(scene_id,)).fetchone()
        return {'revision':row['revision'],'config':validate_plan_config(json.loads(row['document']))} if row else {'revision':0,'config':deepcopy(DEFAULT)}

    def get(self,scene_id):
        scene=self.spatial.scene(scene_id)
        with self.spatial.lock,self.spatial._connect() as db:value=self._read(db,scene_id)
        return {**value,'scene_id':scene_id,'scene_revision':scene['revision'],'persisted':value['revision']>0,'metric_scale_verified':False}

    def save(self,scene_id,payload):
        if not isinstance(payload,dict) or set(payload)!={'expected_revision','expected_scene_revision','config'}:raise FloorPlanError('plan_config','Revisa las revisiones y la configuración del plano.')
        config=validate_plan_config(payload['config']);self.spatial.scene(scene_id)
        if any(type(payload[key]) is not int for key in ('expected_revision','expected_scene_revision')):raise FloorPlanError('plan_config','Las revisiones deben ser enteras.')
        with self.spatial.lock,self.spatial._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT revision FROM scenes WHERE id=?',(scene_id,)).fetchone()
            if not row or row[0]!=payload['expected_scene_revision']:raise FloorPlanError('floorplan_conflict','El espacio cambió. Actualiza antes de guardar el plano.',409)
            current=self._read(db,scene_id)
            if current['revision']!=payload['expected_revision']:raise FloorPlanError('plan_config_conflict','El plano cambió en otra ventana. Actualiza antes de guardar.',409)
            db.execute('CREATE TABLE IF NOT EXISTS scene_plan_settings(scene_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,document TEXT NOT NULL)')
            revision=current['revision']+1
            db.execute('INSERT OR REPLACE INTO scene_plan_settings VALUES(?,?,?)',(scene_id,revision,json.dumps(config,ensure_ascii=False,allow_nan=False)))
        return {'scene_id':scene_id,'scene_revision':payload['expected_scene_revision'],'revision':revision,'config':config,'persisted':True,'metric_scale_verified':False}
