"""Small native chooser bridge and a portable project asset session.

No bridge method accepts a filesystem path from JavaScript. File access is scoped
to the folder selected in the native dialog and the verified project manifest.
This is a same-origin application boundary, not protection from malicious local
code or a compromised application page.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import secrets
import threading
from urllib.parse import urlsplit
from uuid import UUID,uuid4

from services import projects
from services.spatial.floorplan import FloorPlanError,build_floorplan
from services.spatial.plan_settings import DEFAULT,validate_plan_config
from services.spatial.presentation import PresentationError,validate_presentation_config

PROJECT_PREFIX='/api/spatial/desktop-project/'


class DesktopError(ValueError):
    def __init__(self,code,message,status=409):self.code,self.status=code,status;super().__init__(message)


class ProjectSession:
    """One portable folder, no import/copy into Brivany's application data."""
    def __init__(self):self._path=None;self._token=None;self._lock=threading.RLock()

    def open(self,path):
        verified=projects.open_project(path)
        with self._lock:
            self._path=Path(path).absolute();self._token=secrets.token_urlsafe(24)
            return self._viewer(verified)

    def _viewer(self,verified):
        value=deepcopy(verified);manifest=value['project'];scene=value['scene'];states=value['history']['states'];cursor=value['history']['cursor']
        urls={asset['id']:PROJECT_PREFIX+self._token+'/assets/'+asset['id'] for asset in scene['assets']}
        return {'scene':scene,'revision':value['revision'],'scene_revision':value['scene_revision'],
            'project':{'id':manifest['project_id'],'title':manifest['title'],'revision':manifest['revision'],
                'format':manifest['format'],'portable':True,'folder_name':self._path.name},
            'asset_urls':urls,'assets':[{'id':key,'url':url} for key,url in urls.items()],
            'history':{'can_undo':False,'can_redo':False,'undo_steps':cursor,'redo_steps':len(states)-1-cursor,
                'portable_history_preserved':True,'editing_history_controls_pending':True},
            'layouts':value['layouts'],'render_config':value['render_config'],'references':value['references'],
            'plan_config':value['plan_config'],
            'presentation_config':value['presentation_config'],'presentation_source_scene_revision':value['presentation_source_scene_revision'],
            'source':'portable_project','automatic_execution':False}

    def current(self):
        with self._lock:
            if self._path is None:return None
            return self._viewer(projects.open_project(self._path))

    def save(self,*,expected_revision,objects=None,title=None):
        with self._lock:
            if self._path is None:raise DesktopError('desktop_project_missing','Abre primero una carpeta de proyecto.')
            return self._viewer(projects.save_project(self._path,expected_revision=expected_revision,objects=objects,title=title))

    def export(self,destination):
        with self._lock:
            if self._path is None:raise DesktopError('desktop_project_missing','Abre primero una carpeta de proyecto.')
            return projects.export_project(self._path,destination)

    def floorplan(self,expected_revision,parameters=None):
        """Project-local geometry only; no application-data or client file paths."""
        with self._lock:
            if self._path is None:raise DesktopError('desktop_project_missing','Abre primero una carpeta de proyecto.')
            _root,manifest,payloads,versions=projects._load(self._path)
            if type(expected_revision) is not int or expected_revision!=manifest['revision']:
                raise DesktopError('project_conflict','El proyecto cambió. Abre su revisión actual antes de generar el plano.',409)
            document=versions[-1];config=validate_plan_config(parameters if parameters is not None else document.get('plan_config',deepcopy(DEFAULT)))
            assets={asset['id']:payloads[asset['relative_path']] for asset in document['scene']['assets']}
            result=build_floorplan(document['scene'],assets,revision=manifest['revision'],**config)
            # The session lock protects this window; detect another writer's
            # committed revision during extraction before returning stale data.
            if projects.open_project(self._path)['revision']!=expected_revision:
                raise DesktopError('project_conflict','El proyecto cambió mientras se generaba el plano.',409)
            return {**result,'source':'portable_project','settings_revision':manifest['revision'],
                'settings_persisted':'plan_config' in document,'config':config,'preview_only':parameters is not None}

    def save_floorplan(self,expected_revision,parameters):
        with self._lock:
            if self._path is None:raise DesktopError('desktop_project_missing','Abre primero una carpeta de proyecto.')
            config=validate_plan_config(parameters)
            value=projects.save_project(self._path,expected_revision=expected_revision,plan_config=config)
            return {'project':self._viewer(value),'floorplan':self.floorplan(value['revision'])}

    def presentation(self,expected_revision):
        with self._lock:
            if self._path is None:raise DesktopError('desktop_project_missing','Abre primero una carpeta de proyecto.')
            value=projects.open_project(self._path)
            if type(expected_revision) is not int or expected_revision!=value['revision']:
                raise DesktopError('project_conflict','El proyecto cambió. Abre su revisión actual antes de revisar el recorrido.',409)
            config=validate_presentation_config(value['presentation_config'],object_ids={item['id'] for item in value['scene']['objects']})
            source=value['presentation_source_scene_revision']
            return {'scene_id':value['project']['source_scene_id'],'scene_revision':value['scene_revision'],'revision':value['revision'],
                'source_scene_revision':source,'config':config,'persisted':True,'needs_scene_review':source is not None and source!=value['scene_revision'],
                'source':'portable_project','shared':False,'public_link_implemented':False,'reconstruction_fidelity_verified':False}

    def save_presentation(self,expected_revision,parameters):
        with self._lock:
            if self._path is None:raise DesktopError('desktop_project_missing','Abre primero una carpeta de proyecto.')
            value=projects.save_project(self._path,expected_revision=expected_revision,presentation_config=parameters)
            return {'project':self._viewer(value),'presentation':self.presentation(value['revision'])}

    def asset(self,token,asset_id):
        with self._lock:
            if self._path is None or not isinstance(token,str) or not re.fullmatch('[A-Za-z0-9_-]{32}',token) or not secrets.compare_digest(token,self._token):
                raise DesktopError('desktop_media_denied','El proyecto ya no está abierto en esta ventana.',403)
            if not isinstance(asset_id,str) or not re.fullmatch('[a-z][a-z0-9_-]{0,79}',asset_id):raise DesktopError('desktop_asset_missing','Artefacto no disponible.',404)
            # Revalidate the complete manifest and all files before serving an
            # asset: a modified portable folder cannot bypass the loader hashes.
            _root,manifest,payloads,versions=projects._load(self._path)
            asset=next((item for item in versions[-1]['scene']['assets'] if item['id']==asset_id),None)
            if asset is None:raise DesktopError('desktop_asset_missing','Artefacto no disponible.',404)
            if asset['kind']!='mesh' or not asset['relative_path'].endswith('.glb'):raise DesktopError('desktop_asset_kind','Este visor de escritorio admite GLB.',422)
            return payloads[asset['relative_path']],'model/gltf-binary'


class DesktopBridge:
    def __init__(self,base_url,session,source_factory,*,folder_dialog=20,save_dialog=30):
        parsed=urlsplit(base_url)
        if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or not parsed.port or parsed.path not in {'','/'} or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise DesktopError('desktop_origin','El escritorio necesita su servidor loopback propio.')
        self._base=base_url.rstrip('/');self._session=session;self._source_factory=source_factory;self._window=None
        self._folder_dialog=folder_dialog;self._save_dialog=save_dialog;self._lock=threading.Lock()

    def _bind_window(self,window):self._window=window

    def _trusted(self):
        if self._window is None:raise DesktopError('desktop_window','La ventana aún no está preparada.',403)
        value=self._window.get_current_url()
        if not isinstance(value,str):raise DesktopError('desktop_origin','Abre el proyecto desde la interfaz de Brivany.',403)
        parsed=urlsplit(value);base=urlsplit(self._base)
        if (parsed.scheme,parsed.hostname,parsed.port)!=(base.scheme,base.hostname,base.port) or parsed.username or parsed.password or parsed.path not in {'/spaces','/spaces/','/viewer'}:
            raise DesktopError('desktop_origin','El puente sólo está disponible en el visor local.',403)

    def _choose(self,kind,**kwargs):
        self._trusted();selected=self._window.create_file_dialog(kind,allow_multiple=False,**kwargs);self._trusted()
        if not selected:return None
        if not isinstance(selected,(tuple,list)) or len(selected)!=1 or not isinstance(selected[0],str):raise DesktopError('desktop_dialog','El selector no devolvió una carpeta válida.')
        path=Path(selected[0]).absolute()
        if path.resolve()!=path:raise DesktopError('desktop_path','Elige una ruta local sin redirecciones.')
        return path

    def _run(self,function):
        if not self._lock.acquire(blocking=False):return {'ok':False,'error':{'code':'desktop_busy','status':409,'message':'Ya hay una operación de proyecto en curso.'}}
        try:self._trusted();return {'ok':True,**function()}
        except (DesktopError,projects.ProjectError,FloorPlanError,PresentationError) as exc:return {'ok':False,'error':{'code':exc.code,'status':exc.status,'message':str(exc)}}
        except (OSError,ValueError,TypeError,KeyError):return {'ok':False,'error':{'code':'desktop_project_failed','status':422,'message':'No se pudo abrir o guardar el proyecto local.'}}
        finally:self._lock.release()

    def status(self):
        return self._run(lambda:{'desktop':True,'wrapper':'pywebview','project':self._session.current(),
            'native_dialogs':True,'arbitrary_file_access':False,'automatic_capture':False})

    def pick_project_folder(self):
        def open_selected():
            selected=self._choose(self._folder_dialog)
            return {'cancelled':True} if selected is None else {'cancelled':False,'project':self._session.open(selected)}
        return self._run(open_selected)

    def save_current_project(self,scene_id):
        def create_selected():
            if not isinstance(scene_id,str) or str(UUID(scene_id))!=scene_id:raise DesktopError('desktop_scene','Elige una escena local válida.')
            parent=self._choose(self._folder_dialog)
            if parent is None:return {'cancelled':True}
            if not parent.is_dir():raise DesktopError('desktop_path','Selecciona una carpeta de destino existente.')
            target=parent/('Brivany-'+uuid4().hex[:12])
            projects.create_project(self._source_factory(),scene_id,target,include_references=True,include_originals=False)
            return {'cancelled':False,'project':self._session.open(target)}
        return self._run(create_selected)

    def save_open_project(self,expected_revision,objects=None,title=None):
        return self._run(lambda:{'project':self._session.save(expected_revision=expected_revision,objects=objects,title=title)})

    def get_floorplan(self,expected_revision,parameters=None):
        return self._run(lambda:{'floorplan':self._session.floorplan(expected_revision,parameters)})

    def save_floorplan(self,expected_revision,parameters):
        return self._run(lambda:self._session.save_floorplan(expected_revision,parameters))

    def get_presentation(self,expected_revision):
        return self._run(lambda:{'presentation':self._session.presentation(expected_revision)})

    def save_presentation(self,expected_revision,parameters):
        return self._run(lambda:self._session.save_presentation(expected_revision,parameters))

    def export_open_project(self):
        def export_selected():
            current=self._session.current()
            if current is None:raise DesktopError('desktop_project_missing','Abre primero una carpeta de proyecto.')
            destination=self._choose(self._save_dialog,save_filename='Brivany-'+current['project']['id'][:8]+'.zip',file_types=('Proyecto Brivany (*.zip)',))
            if destination is None:return {'cancelled':True}
            if destination.suffix.lower()!='.zip':raise DesktopError('desktop_archive','Elige un archivo ZIP nuevo.')
            return {'cancelled':False,'export':self._session.export(destination)}
        return self._run(export_selected)
