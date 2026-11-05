"""Persistent, single-worker local spatial preparation. Remote dispatch is disabled.

Only owned UUID directories are created/removed. Procedural previews and capture
packages remain distinct, and local work never implies a reconstructed space.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import UUID, uuid4

from pydantic import ValidationError
from contracts.spatial import CaptureManifest, SceneManifest, Transform
from services.spatial.capture import MAX_BYTES, CaptureError, prepare_capture, probe_video, extract_frame
from services.spatial.demo import DEMO_ID, DEMO_VERSION, scene_document
from services.spatial.history import SceneHistoryMixin

PIPELINE_VERSION = "capture-uniform-6-signals-v2"
TERMINAL = {"succeeded", "cancelled", "failed", "interrupted"}


class SpatialServiceError(ValueError):
    def __init__(self, code, message, status=422):
        self.code,self.status=code,status
        super().__init__(message)


def now(): return datetime.now(timezone.utc).isoformat()


def identifier(value):
    try:
        if not isinstance(value,str) or str(UUID(value))!=value:raise ValueError()
    except ValueError:raise SpatialServiceError("spatial_not_found","No se encontró ese espacio o trabajo.",404) from None
    return value


class _StopJob(Exception):
    def __init__(self,reason):self.reason=reason


class SpatialService(SceneHistoryMixin):
    def __init__(self, root, *, job_timeout_seconds=120, start_worker=True, seed_demo=True):
        root=Path(root).absolute()
        if root.resolve()!=root:raise SpatialServiceError("spatial_storage","La carpeta espacial no puede estar redirigida.")
        if not 0<job_timeout_seconds<=300:raise ValueError("Invalid local job timeout")
        root.mkdir(parents=True,exist_ok=True)
        self.root=root;self.db=root/"spatial.sqlite3";self.lock=threading.RLock()
        self.wake=threading.Event();self.stopping=threading.Event();self.timeout=job_timeout_seconds
        self.thread=None;self._closed=False
        for name in ("scenes","captures","uploads"):(root/name).mkdir(exist_ok=True)
        with self._connect() as db:
            db.executescript("""CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY,title TEXT,status TEXT,origin TEXT,scene_id TEXT,capture_id TEXT,created_at TEXT,updated_at TEXT);
            CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,document TEXT,baseline TEXT,revision INTEGER);
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,space_id TEXT,kind TEXT,state TEXT,progress INTEGER,stage TEXT,error_code TEXT,created_at TEXT,updated_at TEXT,cache_key TEXT,payload TEXT);
            CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,kind TEXT,result_id TEXT);
            """)
            self._history_schema(db)
            # A restarted process never silently restarts a paid/local job.
            affected=[row[0] for row in db.execute("SELECT space_id FROM jobs WHERE state IN ('queued','running','cancelling')")]
            db.execute("UPDATE jobs SET state='interrupted',stage='interrupted',error_code='process_restarted',updated_at=? WHERE state IN ('queued','running','cancelling')",(now(),))
            for space in affected:db.execute("UPDATE spaces SET status='failed',updated_at=? WHERE id=?",(now(),space))
        self._clean_uploads()
        self._clean_incomplete_artifacts()
        if seed_demo:self._seed()
        if start_worker:
            self.thread=threading.Thread(target=self._loop,name="brivany-spatial-local",daemon=True);self.thread.start()

    @contextmanager
    def _connect(self):
        db=sqlite3.connect(self.db,timeout=10);db.row_factory=sqlite3.Row
        try:
            with db:yield db
        finally:db.close()

    def _owned(self,category,item,*parts):
        identifier(item);base=self.root/category/item
        target=base.joinpath(*parts)
        if target.resolve()!=target.absolute() or not target.is_relative_to(self.root/category):
            raise SpatialServiceError("spatial_storage","La ruta de artefacto no es válida.",409)
        return target

    def _remove_owned(self,category,item):
        target=self._owned(category,item)
        if target.exists():shutil.rmtree(target)

    def _clean_uploads(self):
        for path in (self.root/"uploads").iterdir():
            if path.is_dir() and re.fullmatch(r"[0-9a-f-]{36}",path.name):self._remove_owned("uploads",path.name)

    def _clean_incomplete_artifacts(self):
        with self._connect() as db:
            scenes={row[0] for row in db.execute("SELECT id FROM scenes")}
            captures={row[0] for row in db.execute("SELECT capture_id FROM spaces WHERE capture_id IS NOT NULL")}
        for category,retained in (("scenes",scenes),("captures",captures)):
            for path in (self.root/category).iterdir():
                if path.is_dir() and re.fullmatch(r"[0-9a-f-]{36}",path.name) and path.name not in retained:
                    self._remove_owned(category,path.name)

    def _valid_capture_cache(self,capture_id,key):
        try:
            manifest=CaptureManifest.model_validate_json(self._owned("captures",capture_id,"capture.json").read_text(encoding="utf-8"))
            expected=hashlib.sha256((PIPELINE_VERSION+":"+manifest.source.sha256).encode()).hexdigest()
            if str(manifest.capture_id)!=capture_id or expected!=key:return False
            for frame in manifest.frames:
                path=self._owned("captures",capture_id,*frame.relative_path.split("/"))
                if not path.is_file() or path.stat().st_size>2*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=frame.sha256:return False
            notes=json.loads(self._owned("captures",capture_id,"preflight.json").read_text(encoding="utf-8"))
            return notes.get("status")=="prepared_not_reconstructed"
        except (OSError,ValueError,SpatialServiceError):return False

    def _copy_demo_cache(self,previous,new_id,title):
        try:
            with self._connect() as db:row=db.execute("SELECT baseline FROM scenes WHERE id=?",(previous,)).fetchone()
            if not row:return None
            scene=SceneManifest.model_validate_json(row[0])
            if scene.origin!="generated_demo":return None
            data=[]
            for asset in scene.assets:
                raw=self.asset(previous,asset.id)[0];data.append((asset.relative_path,raw))
            document=scene.model_dump(mode="json");document.update(scene_id=new_id,title=title)
            document=SceneManifest.model_validate_json(json.dumps(document)).model_dump(mode="json")
            directory=self._owned("scenes",new_id);(directory/"assets").mkdir(parents=True,exist_ok=True)
            for relative,raw in data:self._owned("scenes",new_id,*relative.split("/")).write_bytes(raw)
            return document
        except (OSError,ValueError,SpatialServiceError):return None

    def _seed(self):
        with self.lock,self._connect() as db:
            exists=db.execute("SELECT id FROM spaces WHERE id=?",(DEMO_ID,)).fetchone()
            if exists:return
            document=self._write_demo(DEMO_ID,"Estudio de luz")
            stamp=now()
            db.execute("INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)",(DEMO_ID,"Estudio de luz","ready","generated_demo",DEMO_ID,None,stamp,stamp))
            encoded=json.dumps(document,ensure_ascii=False)
            db.execute("INSERT INTO scenes VALUES(?,?,?,1)",(DEMO_ID,encoded,encoded))

    def _write_demo(self,scene_id,title):
        scene,assets=scene_document(scene_id,title)
        directory=self._owned("scenes",scene_id);(directory/"assets").mkdir(parents=True,exist_ok=True)
        for name,data in assets.items():(directory/"assets"/(name+".glb")).write_bytes(data)
        return scene.model_dump(mode="json")

    @staticmethod
    def capabilities():
        return {"cloud_dispatch":False,"gpu_inference":False,"external_api_calls":0,"mode":"local_preparation",
            "remote_blockers":["modal_account","model_checkpoints_and_licenses","reserved_gpu_budget"],
            "max_upload_bytes":MAX_BYTES,"max_video_seconds":60,"max_parallel_jobs":1,"automatic_retries":0,
            "retention":"local_until_explicit_removal","original_video_retention":"removed_after_preparation_or_cancel"}

    def _space(self,row,db):
        value=dict(row)
        value["frames"]=[]
        value["object_count"]=0
        if value["scene_id"]:
            record=db.execute("SELECT document FROM scenes WHERE id=?",(value["scene_id"],)).fetchone()
            if record:value["object_count"]=sum(obj.get("role")!="environment" for obj in json.loads(record[0])["objects"])
        value["job"]=self._job(db.execute("SELECT * FROM jobs WHERE space_id=? ORDER BY created_at DESC LIMIT 1",(value["id"],)).fetchone())
        return value

    @staticmethod
    def _job(row):
        if row is None:return None
        value={key:row[key] for key in ("id","space_id","kind","state","progress","stage","error_code","created_at","updated_at")}
        value.update(external_calls=0,gpu_seconds=0,execution_target="local",retry_count=0)
        return value

    def library(self):
        with self.lock,self._connect() as db:
            return {"spaces":[self._space(row,db) for row in db.execute("SELECT * FROM spaces ORDER BY created_at DESC LIMIT 100")],
                "jobs":[self._job(row) for row in db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50")],"capabilities":self.capabilities()}

    def get_space(self,space_id):
        identifier(space_id)
        with self.lock,self._connect() as db:
            row=db.execute("SELECT * FROM spaces WHERE id=?",(space_id,)).fetchone()
            if row is None:raise SpatialServiceError("space_not_found","No se encontró ese espacio.",404)
            result=self._space(row,db)
        if result["capture_id"]:
            path=self._owned("captures",result["capture_id"],"capture.json")
            manifest=CaptureManifest.model_validate_json(path.read_text(encoding="utf-8"))
            result["capture"]=manifest.model_dump(mode="json")
            result["frames"]=[{key:value for key,value in frame.model_dump(mode="json").items() if key!="relative_path"} for frame in manifest.frames]
            result["preflight"]=json.loads(self._owned("captures",result["capture_id"],"preflight.json").read_text(encoding="utf-8"))
        return result

    def scene(self,scene_id):
        identifier(scene_id)
        with self.lock,self._connect() as db:
            row=db.execute("SELECT * FROM scenes WHERE id=?",(scene_id,)).fetchone()
            if row is None:raise SpatialServiceError("scene_unavailable","Este espacio aún no tiene una escena 3D.",404)
            scene=SceneManifest.model_validate_json(row["document"]).model_dump(mode="json")
            result={"scene":scene,"revision":row["revision"],"space_id":scene_id,"asset_urls":{},
                    "history":self._history_dto(db,row),"layouts":self._layouts(db,scene_id)}
        config=self._owned('scenes',scene_id,'render.json')
        if config.is_file() and config.stat().st_size<=65536:result['render_config']=json.loads(config.read_text(encoding='utf-8'))
        return result

    def create_reference_interpretation(self,reference_set_id,title='Interior de referencia'):
        from services.spatial.references import ReferenceSetService
        from services.spatial.reference_scene import scene_document as interpret
        identifier(reference_set_id)
        ReferenceSetService(self.root).get(reference_set_id)
        if not isinstance(title,str) or not 1<=len(title.strip())<=120 or any(ord(char)<32 for char in title):
            raise SpatialServiceError('space_title','Escribe un nombre de hasta 120 caracteres.')
        scene_id=str(uuid4());directory=self._owned('scenes',scene_id)
        with self.lock:
            if self._closed:raise SpatialServiceError('service_closed','El servicio está cerrado.',503)
            with self._connect() as db:
                if db.execute('SELECT count(*) FROM spaces').fetchone()[0]>=100:raise SpatialServiceError('spatial_library_full','La biblioteca local está llena.',429)
                try:
                    document,assets,render_config=interpret(scene_id,title.strip(),reference_set_id)
                    scene=SceneManifest.model_validate_json(json.dumps(document)).model_dump(mode='json')
                    (directory/'assets').mkdir(parents=True)
                    for asset in scene['assets']:
                        raw=assets[asset['id']]
                        if len(raw)>30*1024*1024 or hashlib.sha256(raw).hexdigest()!=asset['sha256']:raise ValueError('asset integrity')
                        self._owned('scenes',scene_id,*asset['relative_path'].split('/')).write_bytes(raw)
                    (directory/'render.json').write_text(json.dumps(render_config,ensure_ascii=False),encoding='utf-8')
                    stamp=now();encoded=json.dumps(scene,ensure_ascii=False)
                    db.execute('INSERT INTO scenes VALUES(?,?,?,1)',(scene_id,encoded,encoded))
                    db.execute('INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)',(scene_id,title.strip(),'ready','reference_interpretation',scene_id,None,stamp,stamp))
                except Exception:
                    self._remove_owned('scenes',scene_id);raise
        return {'space':self.get_space(scene_id),'scene':self.scene(scene_id)}

    def asset(self,scene_id,asset_id):
        manifest=self.scene(scene_id)["scene"]
        found=next((item for item in manifest["assets"] if item["id"]==asset_id),None)
        if not found:raise SpatialServiceError("asset_not_found","Artefacto no disponible.",404)
        path=self._owned("scenes",scene_id,*found["relative_path"].split("/"));data=path.read_bytes()
        if hashlib.sha256(data).hexdigest()!=found["sha256"]:raise SpatialServiceError("asset_integrity","El artefacto cambió; no se servirá.",409)
        return data,"model/gltf-binary",path.name

    def frame(self,capture_id,frame_id):
        identifier(capture_id)
        if not isinstance(frame_id,str) or not re.fullmatch(r"frame-\d{4}",frame_id):raise SpatialServiceError("frame_not_found","Fotograma no disponible.",404)
        manifest=CaptureManifest.model_validate_json(self._owned("captures",capture_id,"capture.json").read_text(encoding="utf-8"))
        frame=next((frame for frame in manifest.frames if frame.id==frame_id),None)
        if not frame:raise SpatialServiceError("frame_not_found","Fotograma no disponible.",404)
        path=self._owned("captures",capture_id,*frame.relative_path.split("/"));data=path.read_bytes()
        if hashlib.sha256(data).hexdigest()!=frame.sha256:raise SpatialServiceError("frame_integrity","El fotograma cambió; no se servirá.",409)
        return data,"image/jpeg",path.name

    def _enqueue(self,title,kind,key,payload):
        if not isinstance(title,str) or not 1<=len(title.strip())<=120 or any(ord(char)<32 for char in title):raise SpatialServiceError("space_title","Escribe un nombre de hasta 120 caracteres.")
        title=title.strip()
        with self.lock,self._connect() as db:
            if self._closed:raise SpatialServiceError("service_closed","El servicio está cerrado.",503)
            if db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','running','cancelling')").fetchone()[0]>=10:
                raise SpatialServiceError("spatial_queue_full","La cola local está llena.",429)
            if db.execute("SELECT count(*) FROM spaces").fetchone()[0]>=100:raise SpatialServiceError("spatial_library_full","La biblioteca local alcanzó su límite.",429)
            space,job=str(uuid4()),str(uuid4());stamp=now()
            db.execute("INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)",(space,title,"preparing","generated_demo" if kind=="demo" else "capture",None,None,stamp,stamp))
            db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)",(job,space,kind,"queued",0,"queued",None,stamp,stamp,key,json.dumps(payload)))
        self.wake.set()
        return {"space":self.get_space(space),"job":self.get_job(job)}

    def create_demo(self,title="Nuevo estudio"):
        return self._enqueue(title,"demo",hashlib.sha256(DEMO_VERSION.encode()).hexdigest(),{})

    def queue_capture(self,filename,content):
        if (not isinstance(filename,str) or len(filename)>180 or not filename.lower().endswith(".mp4") or
            any(char in filename for char in ('/','\\',':')) or any(ord(char)<32 for char in filename)):
            raise SpatialServiceError("capture_filename","Elige un MP4 con nombre válido.")
        if not isinstance(content,bytes) or not 16<=len(content)<=MAX_BYTES or content[4:8]!=b"ftyp":
            raise SpatialServiceError("capture_format","La captura debe ser MP4 de hasta 25 MiB.")
        upload=str(uuid4())
        try:
            directory=self._owned("uploads",upload);directory.mkdir()
            path=directory/filename;path.write_bytes(content)
            key=hashlib.sha256((PIPELINE_VERSION+":"+hashlib.sha256(content).hexdigest()).encode()).hexdigest()
            return self._enqueue(Path(filename).stem[:120] or "Captura","capture",key,{"upload":upload,"filename":filename})
        except Exception:self._remove_owned("uploads",upload);raise

    def get_job(self,job_id):
        identifier(job_id)
        with self.lock,self._connect() as db:
            row=db.execute("SELECT * FROM jobs WHERE id=?",(job_id,)).fetchone()
            if row is None:raise SpatialServiceError("job_not_found","No se encontró ese trabajo.",404)
            return self._job(row)

    def cancel_job(self,job_id):
        identifier(job_id)
        with self.lock,self._connect() as db:
            row=db.execute("SELECT * FROM jobs WHERE id=?",(job_id,)).fetchone()
            if row is None:raise SpatialServiceError("job_not_found","No se encontró ese trabajo.",404)
            if row["state"] not in TERMINAL:
                state="cancelled" if row["state"]=="queued" else "cancelling"
                db.execute("UPDATE jobs SET state=?,stage=?,updated_at=? WHERE id=?",(state,state,now(),job_id))
                if state=="cancelled":
                    db.execute("UPDATE spaces SET status='cancelled',updated_at=? WHERE id=?",(now(),row["space_id"]))
                    payload=json.loads(row["payload"])
                    if payload.get("upload"):self._remove_owned("uploads",payload["upload"])
        self.wake.set();return self.get_job(job_id)

    def update_transforms(self,scene_id,payload):
        if not isinstance(payload,dict) or set(payload)!={"expected_revision","objects"}:raise SpatialServiceError("scene_patch","La edición no es válida.")
        revision,objects=payload["expected_revision"],payload["objects"]
        if type(revision) is not int or not isinstance(objects,list) or not 1<=len(objects)<=100:raise SpatialServiceError("scene_patch","La edición no es válida.")
        with self.lock,self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            identifier(scene_id);row=db.execute("SELECT * FROM scenes WHERE id=?",(scene_id,)).fetchone()
            if not row:raise SpatialServiceError("scene_unavailable","Escena no disponible.",404)
            if row["revision"]!=revision:raise SpatialServiceError("scene_conflict","La escena cambió. Recarga antes de guardar.",409)
            document=json.loads(row["document"]);by_id={item["id"]:item for item in document["objects"]};seen=set()
            try:
                for patch in objects:
                    if not isinstance(patch,dict) or set(patch)!={"id","transform"} or patch["id"] in seen:raise ValueError()
                    item=by_id.get(patch["id"])
                    if not item or not item["editable"] or item["role"]=="environment":raise ValueError()
                    transform=Transform.model_validate(patch["transform"])
                    if any(abs(x)>50 for x in transform.position) or any(x<.05 or x>10 for x in transform.scale):raise ValueError()
                    item["transform"]=transform.model_dump(mode="json");seen.add(patch["id"])
                validated=SceneManifest.model_validate_json(json.dumps(document))
            except (ValueError,TypeError,ValidationError):raise SpatialServiceError("scene_patch","Solo puedes editar objetos con transformaciones válidas.") from None
            self._history_record(db,row,validated.model_dump(mode='json'),'Editar objetos')
            db.execute("UPDATE scenes SET document=?,revision=revision+1 WHERE id=?",(validated.model_dump_json(),scene_id))
            db.execute("UPDATE spaces SET updated_at=? WHERE scene_id=?",(now(),scene_id))
        return self.scene(scene_id)

    def reset_scene(self,scene_id,expected_revision):
        identifier(scene_id)
        with self.lock,self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute("SELECT * FROM scenes WHERE id=?",(scene_id,)).fetchone()
            if not row:raise SpatialServiceError("scene_unavailable","Escena no disponible.",404)
            if type(expected_revision) is not int or row["revision"]!=expected_revision:raise SpatialServiceError("scene_conflict","La escena cambió. Recarga antes de restaurar.",409)
            self._history_record(db,row,json.loads(row['baseline']),'Restaurar distribución inicial')
            db.execute("UPDATE scenes SET document=baseline,revision=revision+1 WHERE id=?",(scene_id,))
            db.execute("UPDATE spaces SET updated_at=? WHERE scene_id=?",(now(),scene_id))
        return self.scene(scene_id)

    def _checkpoint(self,job_id,deadline,progress=None,stage=None):
        with self.lock,self._connect() as db:
            state=db.execute("SELECT state FROM jobs WHERE id=?",(job_id,)).fetchone()[0]
            if self.stopping.is_set() or state in {"cancelling","cancelled","interrupted"}:raise _StopJob("cancelled" if not self.stopping.is_set() else "interrupted")
            if time.monotonic()>deadline:raise _StopJob("timeout")
            if progress is not None:db.execute("UPDATE jobs SET progress=?,stage=?,updated_at=? WHERE id=?",(progress,stage,now(),job_id))

    def _loop(self):
        while not self.stopping.is_set():
            with self.lock,self._connect() as db:
                row=db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at LIMIT 1").fetchone()
                if row:db.execute("UPDATE jobs SET state='running',stage='starting',updated_at=? WHERE id=?",(now(),row["id"]))
            if not row:self.wake.wait(.5);self.wake.clear();continue
            self._execute(dict(row))

    def _execute(self,job):
        deadline=time.monotonic()+self.timeout;payload=json.loads(job["payload"]);capture_id=None;scene_id=None;cached=False
        try:
            self._checkpoint(job["id"],deadline,5,"preflight")
            if job["kind"]=="demo":
                scene_id=job["space_id"]
                with self.lock,self._connect() as db:cache=db.execute("SELECT result_id FROM cache WHERE key=?",(job["cache_key"],)).fetchone()
                title=self.get_space(job["space_id"])["title"]
                document=self._copy_demo_cache(cache[0],scene_id,title) if cache else None
                cached=document is not None
                if not cached:document=self._write_demo(scene_id,title)
                self._checkpoint(job["id"],deadline,90,"validating_scene")
            else:
                with self.lock,self._connect() as db:cache=db.execute("SELECT result_id FROM cache WHERE key=?",(job["cache_key"],)).fetchone()
                if cache and self._valid_capture_cache(cache[0],job["cache_key"]):
                    capture_id=cache[0];cached=True
                    CaptureManifest.model_validate_json(self._owned("captures",capture_id,"capture.json").read_text(encoding="utf-8"))
                else:
                    capture_id=str(uuid4());directory=self._owned("captures",capture_id)
                    source=self._owned("uploads",payload["upload"],payload["filename"])
                    count=[0]
                    def probe(path):self._checkpoint(job["id"],deadline,10,"checking_video");return probe_video(path)
                    def extract(source,at,target):
                        self._checkpoint(job["id"],deadline,15+count[0]*12,"extracting_frames")
                        observation=extract_frame(source,at,target);count[0]+=1
                        self._checkpoint(job["id"],deadline)
                        return observation
                    prepare_capture(source,directory,frames=6,probe=probe,extract=extract)
                    # Capture IDs are generated by the existing preparer; make
                    # its identity the directory key before publishing.
                    manifest=CaptureManifest.model_validate_json((directory/"capture.json").read_text(encoding="utf-8"))
                    actual=str(manifest.capture_id);directory.rename(self._owned("captures",actual));capture_id=actual
                self._checkpoint(job["id"],deadline,95,"validating_capture")
            if payload.get("upload"):self._remove_owned("uploads",payload["upload"])
            with self.lock,self._connect() as db:
                self._checkpoint(job["id"],deadline)
                if scene_id:
                    encoded=json.dumps(document,ensure_ascii=False)
                    db.execute("INSERT INTO scenes VALUES(?,?,?,1)",(scene_id,encoded,encoded))
                db.execute("UPDATE spaces SET status=?,scene_id=?,capture_id=?,updated_at=? WHERE id=?",("ready" if scene_id else "capture_prepared",scene_id,capture_id,now(),job["space_id"]))
                db.execute("INSERT OR REPLACE INTO cache VALUES(?,?,?)",(job["cache_key"],job["kind"],scene_id or capture_id))
                db.execute("UPDATE jobs SET state='succeeded',progress=100,stage=?,updated_at=? WHERE id=?",("cache_hit" if cached else "ready" if scene_id else "prepared_not_reconstructed",now(),job["id"]))
        except Exception as exc:
            if isinstance(exc,_StopJob):state="failed" if exc.reason=="timeout" else exc.reason;code="job_timeout" if exc.reason=="timeout" else exc.reason
            elif time.monotonic()>deadline:state="failed";code="job_timeout"
            else:state="failed";code="capture_invalid" if isinstance(exc,(CaptureError,ValidationError)) else "local_job_failed"
            cleanup_failed=False
            for category,item in (("scenes",scene_id),("captures",capture_id if not cached else None),("uploads",payload.get("upload"))):
                if item:
                    try:self._remove_owned(category,item)
                    except (OSError,SpatialServiceError):cleanup_failed=True
            if cleanup_failed:state="failed";code="cleanup_failed"
            with self.lock,self._connect() as db:
                db.execute("UPDATE jobs SET state=?,stage=?,error_code=?,updated_at=? WHERE id=?",(state,state,code,now(),job["id"]))
                db.execute("UPDATE spaces SET status=?,updated_at=? WHERE id=?",("cancelled" if state=="cancelled" else "failed",now(),job["space_id"]))
        finally:
            if payload.get("upload"):
                try:self._remove_owned("uploads",payload["upload"])
                except (OSError,SpatialServiceError):pass  # Explicit cleanup_failed is retained above.

    def close(self):
        with self.lock:
            self._closed=True;self.stopping.set();self.wake.set()
        if self.thread:self.thread.join(timeout=18)
        with self.lock,self._connect() as db:
            pending=db.execute("SELECT * FROM jobs WHERE state='queued'").fetchall()
            for row in pending:
                db.execute("UPDATE jobs SET state='interrupted',stage='interrupted',error_code='service_closed',updated_at=? WHERE id=?",(now(),row["id"]))
                db.execute("UPDATE spaces SET status='failed',updated_at=? WHERE id=?",(now(),row["space_id"]))
                upload=json.loads(row["payload"]).get("upload")
                if upload:self._remove_owned("uploads",upload)
