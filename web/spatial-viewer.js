import * as THREE from '/vendor/three/three.module.js';
import {OrbitControls} from '/vendor/three/addons/controls/OrbitControls.js';
import {TransformControls} from '/vendor/three/addons/controls/TransformControls.js';
import {GLTFLoader} from '/vendor/three/addons/loaders/GLTFLoader.js';
import {SpatialRender} from './spatial-render.js';
import {roomCameraPresets,capturedRoomColors} from './room-view.js';
import {readBoundedAsset,verifyAssetHash,orderedAssets,ASSET_BYTE_LIMIT,SCENE_BYTE_LIMIT} from './spatial-load.js';

/** Local scene viewer. Geometry display and editing do not certify physical scale. */
export class SpatialViewer {
  constructor(container,{onSelect=()=>{},onTransform=()=>{},onError=()=>{},onProgress=()=>{}}={}) {
    this.container=container;this.onSelect=onSelect;this.onTransform=onTransform;this.onError=onError;this.onProgress=onProgress;
    this.entries=new Map();this.templates=new Set();this.selection=null;this.mode='explore';this.loadGeneration=0;this.disposed=false;this.saving=false;this.loading=false;this.renderCount=0;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xf5f5f7);
    this.camera=new THREE.PerspectiveCamera(38,1,.01,500);this.camera.position.set(7,5.8,8);
    try {this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch {throw new Error('Este navegador no pudo activar WebGL. Prueba con aceleración gráfica habilitada en un navegador compatible.');}
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.9;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden','true');container.replaceChildren(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.09;
    this.dirty=true;this.controls.addEventListener('change',()=>{this.dirty=true;});
    this.controls.minDistance=.25;this.controls.maxDistance=60;this.controls.maxPolarAngle=Math.PI*.48;this.controls.target.set(0,.7,0);
    this.renderKit=new SpatialRender(this.renderer,this.scene,this.camera,container);
    this.content=new THREE.Group();this.scene.add(this.content);
    this.transform=new TransformControls(this.camera,this.renderer.domElement);this.transform.setSize(.8);
    this.transform.addEventListener('change',()=>{this.dirty=true;});
    this.transform.setTranslationSnap(.05);this.transform.setRotationSnap(THREE.MathUtils.degToRad(5));
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed',event=>{this.controls.enabled=!event.value;this.dragging=event.value;});
    this.transform.addEventListener('mouseUp',()=>{if(this.selection && !this.saving)this.onTransform(this.selection,this.transformOf(this.selection));});
    this.transform.addEventListener('objectChange',()=>{this.renderKit.shadowDirty=true;this.updateHighlight();this.container.dispatchEvent(new CustomEvent('spatial-object-change',{detail:{id:this.selection,transform:this.transformOf(this.selection)}}));});
    this.highlight=null;this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    this.pointerDown=event=>{this.pointerStart={x:event.clientX,y:event.clientY};};
    this.pointerUp=event=>{
      if(this.dragging || this.transform.axis || !this.pointerStart || Math.hypot(event.clientX-this.pointerStart.x,event.clientY-this.pointerStart.y)>5)return;
      const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      this.raycaster.setFromCamera(this.pointer,this.camera);
      const hit=this.raycaster.intersectObjects(Array.from(this.entries.values(),entry=>entry.group),true).find(item=>item.object.visible);
      let object=hit?.object;while(object && !object.userData.spatialId)object=object.parent;
      this.select(object?.userData.spatialId || null);
    };
    this.contextLost=event=>{event.preventDefault();this.contextUnavailable=true;this.cancelLoad();this.setSaving(true);this.onError('Se perdió el contexto gráfico. Vuelve a cargar el visor para recuperar la escena guardada.');};
    this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
    this.animate=()=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);if(document.hidden || this.contextUnavailable)return;const now=performance.now();if(this.physics?.running){const snapshot=this.physics.step(Math.min(.1,(now-(this.lastPhysicsTime || now))/1000));this.applyPhysics(snapshot);this.container.dispatchEvent(new CustomEvent('spatial-physics-tick',{detail:snapshot.telemetry}));}this.lastPhysicsTime=now;this.controls.update();if(this.dirty)this.renderNow();};this.animate();
  }
  renderNow(){this.renderKit.draw();this.dirty=false;this.container.dataset.drawCalls=String(this.renderer.info.render.calls);this.container.dataset.geometries=String(this.renderer.info.memory.geometries);this.container.dataset.renderCount=String(++this.renderCount);}
  resize(){const width=this.container.clientWidth,height=this.container.clientHeight;if(!width || !height)return;const old=this.camera.aspect;this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderKit.resize(width,height);this.dirty=true;if(this.entries.size && Math.abs(old-this.camera.aspect)>.02)this.fit(new THREE.Box3().setFromObject(this.content),this.camera.position.clone().sub(this.controls.target));}
  safeURL(value) {const url=new URL(value,location.origin);if(url.origin!==location.origin || url.username || url.password || !url.pathname.startsWith('/api/spatial/'))throw Error('El artefacto no tiene una dirección local admitida.');return url.href;}
  async load(payload) {
    if(this.disposed || this.contextUnavailable)throw Error('Recarga el visor para recuperar el contexto gráfico.');
    this.cancelLoad();const generation=++this.loadGeneration,controller=new AbortController();this.abort=controller;this.loading=true;
    const active=()=>generation===this.loadGeneration && !controller.signal.aborted && !this.disposed && !this.contextUnavailable;
    const manifest=payload.scene,urls=new Map((payload.assets || []).map(asset=>[asset.id,asset.url]));
    for(const [id,url] of Object.entries(payload.asset_urls || {}))urls.set(id,url);
    const loader=new GLTFLoader(),started=performance.now(),capturedColors=capturedRoomColors(manifest);
    const report={phase:'loading',loadedAssets:0,totalAssets:0,loadedObjects:0,totalObjects:manifest?.objects?.length || 0,receivedBytes:0,estimatedBytes:null,firstVisibleMs:null,elapsedMs:0,timingScope:'local_render_submission_not_gpu_completion'};
    const progress=phase=>{if(!active())return;Object.assign(report,{phase,loadedObjects:this.entries.size,elapsedMs:performance.now()-started});this.loadReport={...report};
      Object.assign(this.container.dataset,{loading:String(this.loading),loadedAssets:String(report.loadedAssets),totalAssets:String(report.totalAssets),objects:String(report.loadedObjects)});this.onProgress({...report});};
    try {
      if(!manifest || !Array.isArray(manifest.objects) || !manifest.objects.length || manifest.objects.length>100 || !Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length>100 || new Set(manifest.assets.map(asset=>asset.id)).size!==manifest.assets.length || new Set(manifest.objects.map(object=>object.id)).size!==manifest.objects.length || manifest.objects.some(object=>!manifest.assets.some(asset=>asset.id===object.asset_id)))throw Error('El contrato de escena no es compatible con este visor.');
      const assets=orderedAssets(manifest);report.totalAssets=assets.length;
      this.manifest=manifest;this.renderConfig={...(payload.render_config || {}),capturedColors};
      const sourceCameras=roomCameraPresets(manifest);if(sourceCameras.length)this.renderConfig.camera_presets=sourceCameras;
      this.renderKit.configure(this.renderConfig);progress('loading');
      for(const asset of assets) {
        if(!active())return {cancelled:true};
        if(asset.kind!=='mesh')throw Error('Este primer visor admite mallas GLB. La visualización de splats está pendiente.');
        const url=this.safeURL(urls.get(asset.id));
        const response=await fetch(url,{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Error(response.status===403?'El enlace del artefacto venció. Vuelve a cargar el espacio.':'No se pudo leer uno de los artefactos del espacio.');
        const bytes=await readBoundedAsset(response,{signal:controller.signal,maxBytes:Math.min(ASSET_BYTE_LIMIT,SCENE_BYTE_LIMIT-report.receivedBytes),onChunk:count=>{if(!active())throw new DOMException('Carga cancelada.','AbortError');report.receivedBytes+=count;progress(report.loadedAssets?'partial':'loading');}});
        await verifyAssetHash(bytes,asset.sha256);if(!active())return {cancelled:true};
        const gltf=await loader.parseAsync(bytes,new URL('.',url).href);
        if(!active()){this.disposeObject(gltf.scene);return {cancelled:true};}
        if(capturedColors){const before=this.resourceSets([gltf.scene]),converted=new Map();gltf.scene.traverse(node=>{if(!node.isMesh)return;
          const unlit=material=>{if(!converted.has(material)){const value=new THREE.MeshBasicMaterial({color:material.color?.clone() || 0xffffff,vertexColors:material.vertexColors,map:material.map,side:material.side,transparent:material.transparent,opacity:material.opacity});value.toneMapped=false;converted.set(material,value);}return converted.get(material);};
          node.material=Array.isArray(node.material)?node.material.map(unlit):unlit(node.material);
        });const retained=this.resourceSets([gltf.scene]).textures;for(const original of converted.keys())original.dispose();for(const texture of before.textures)if(!retained.has(texture)){texture.dispose();if(texture.image?.close && ![...retained].some(value=>value.image===texture.image))texture.image.close();}}
        this.templates.add(gltf.scene);
        for(const object of manifest.objects.filter(object=>object.asset_id===asset.id)) {
        const group=gltf.scene.clone(true);group.userData.spatialId=object.id;
        group.traverse(node=>{if(node.isMesh){node.castShadow=!capturedColors;node.receiveShadow=!capturedColors;for(const material of Array.isArray(node.material)?node.material:[node.material])for(const texture of [material.map,material.normalMap,material.roughnessMap])if(texture)texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());}});
        this.applyTransform(group,object.transform);this.entries.set(object.id,{group,object});this.content.add(group);
        }
        report.loadedAssets++;
        if(!capturedColors && this.renderConfig.camera_presets?.length && report.loadedAssets===1)this.setCameraPreset(this.renderConfig.camera_presets[0].id);
        else if(capturedColors || !this.renderConfig.camera_presets?.length)this.fitAll();
        this.renderKit.shadowDirty=true;this.renderNow();if(report.firstVisibleMs===null)report.firstVisibleMs=performance.now()-started;
        progress(report.loadedAssets===assets.length?'loading':'partial');
        // Yield between GLBs so a partial scene can be painted and navigated.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(!active())return {cancelled:true};this.loading=false;this.container.dataset.ready='true';this.updateTransformMode();progress('ready');return {cancelled:false,...report};
    }catch(error){if(!active())return {cancelled:true};this._clearContent();this.loading=false;progress('error');throw error;}
  }
  applyTransform(group,value){group.position.fromArray(value.position);group.quaternion.fromArray(value.rotation_xyzw);group.scale.fromArray(value.scale);group.updateMatrixWorld(true);}
  transformOf(id){const group=this.entries.get(id)?.group;if(!group)return null;return {position:group.position.toArray(),rotation_xyzw:group.quaternion.toArray(),scale:group.scale.toArray()};}
  setTransform(id,value){const entry=this.entries.get(id);if(!entry)return;this.applyTransform(entry.group,value);this.renderKit.shadowDirty=true;this.dirty=true;this.updateHighlight();}
  select(id){if(id && !this.entries.has(id))return;this.selection=id;this.updateTransformMode();this.updateHighlight();this.onSelect(id,this.entries.get(id)?.object || null);}
  updateTransformMode(){this.transform.detach();const entry=this.entries.get(this.selection);if(this.mode!=='explore' && entry && entry.object.editable===true && !this.saving && !this.loading){this.transform.setMode(this.mode==='move'?'translate':'rotate');this.transform.attach(entry.group);}}
  setMode(mode){if(!['explore','move','rotate'].includes(mode))return;this.mode=mode;this.updateTransformMode();}
  setSaving(value){this.saving=value;this.updateTransformMode();}
  updateHighlight(){this.dirty=true;const entry=this.entries.get(this.selection);if(!entry){if(this.highlight){this.scene.remove(this.highlight);this.highlight.geometry.dispose();this.highlight.material.dispose();this.highlight=null;}return;}if(!this.highlight){this.highlight=new THREE.BoxHelper(entry.group,0x0071e3);this.highlight.material.transparent=true;this.highlight.material.opacity=.65;this.highlight.material.depthTest=false;this.highlight.renderOrder=2;this.scene.add(this.highlight);}this.highlight.setFromObject(entry.group);}
  fit(bounds,direction=new THREE.Vector3(1,.78,1.15)) {
    if(bounds.isEmpty())return;const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const radius=Math.max(.25,size.length()*.5),vertical=THREE.MathUtils.degToRad(this.camera.fov/2),horizontal=Math.atan(Math.tan(vertical)*this.camera.aspect);
    const distance=radius/Math.sin(Math.min(vertical,horizontal))*1.1;
    this.controls.target.copy(center);this.camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    this.camera.near=Math.max(.005,distance/1000);this.camera.far=Math.max(100,distance*20);this.camera.updateProjectionMatrix();this.controls.update();
  }
  fitAll(){this.fit(new THREE.Box3().setFromObject(this.content));}
  focusSelected(){const entry=this.entries.get(this.selection);if(entry)this.fit(new THREE.Box3().setFromObject(entry.group),this.camera.position.clone().sub(this.controls.target));}
  zoom(factor){this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target);this.controls.update();}
  setQuality(profile){this.renderKit.setQuality(profile);this.dirty=true;}
  setDaylight(value){this.renderKit.setDaylight(value);this.dirty=true;}
  renderStats(){return {...this.renderKit.stats(),load:this.loadReport?{...this.loadReport}:null,resources:this.resourceStats()};}
  setCameraPreset(id){const preset=this.renderConfig?.camera_presets?.find(value=>value.id===id);if(!preset){if(id==='')this.fitAll();return;}this.setCameraPose(preset);}
  cameraPose(){return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),fov:this.camera.fov};}
  setCameraPose(pose){
    if(!pose || !['position','target'].every(key=>Array.isArray(pose[key]) && pose[key].length===3 && pose[key].every(value=>Number.isFinite(value) && Math.abs(value)<=100000)))throw Error('La vista del recorrido no es válida.');
    const distance=new THREE.Vector3().fromArray(pose.position).distanceTo(new THREE.Vector3().fromArray(pose.target));
    if(distance<.01 || distance>200000 || !Number.isFinite(pose.fov) || pose.fov<15 || pose.fov>100)throw Error('Revisa la cámara del recorrido.');
    this.camera.position.fromArray(pose.position);this.controls.target.fromArray(pose.target);this.camera.fov=pose.fov;
    this.camera.near=Math.max(.005,distance/1000);this.camera.far=Math.max(100,distance*20);this.controls.maxDistance=Math.max(60,distance*1.1);
    this.camera.updateProjectionMatrix();this.controls.update();this.dirty=true;
  }
  physicsSpec(id,massKg=1,friction=.6,restitution=.05){
    const selected=this.entries.get(id);if(!selected || selected.object.editable!==true)throw Error('Elige un objeto editable.');
    this.physicsOffsets=new Map();this.physicsOriginals=new Map();const boxes=[];
    for(const [key,entry] of this.entries){if(entry.object.role==='environment' || key==='rug')continue;
      const transform=this.transformOf(key),group=entry.group;this.physicsOriginals.set(key,transform);
      const saved={p:group.position.clone(),q:group.quaternion.clone()};group.position.set(0,0,0);group.quaternion.identity();group.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(group),center=bounds.getCenter(new THREE.Vector3()),half=bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);group.position.copy(saved.p);group.quaternion.copy(saved.q);group.updateMatrixWorld(true);
      const worldCenter=center.clone().applyQuaternion(saved.q).add(saved.p);this.physicsOffsets.set(key,center);
      boxes.push({id:key,position:worldCenter.toArray(),rotation:saved.q.toArray(),halfExtents:half.toArray().map(value=>Math.max(.01,value)),massKg,friction,restitution});
    }
    const environment=(this.renderConfig?.environmentBoxes || [{id:'floor',position:[0,-.1,0],halfExtents:[9,.1,9]}]).map(box=>({...box}));
    return {mode:'assumed_demo_units',bodies:boxes.filter(box=>box.id===id),environmentBoxes:[...environment,...boxes.filter(box=>box.id!==id)]};
  }
  applyPhysics(snapshot){for(const state of snapshot.transforms){const entry=this.entries.get(state.id);if(!entry)continue;const rotation=new THREE.Quaternion().fromArray(state.rotation),offset=this.physicsOffsets.get(state.id).clone().applyQuaternion(rotation),position=new THREE.Vector3().fromArray(state.position).sub(offset);entry.group.position.copy(position);entry.group.quaternion.copy(rotation);entry.group.updateMatrixWorld(true);}this.renderKit.shadowDirty=true;this.updateHighlight();}
  resetPhysics(){this.physics?.dispose();this.physics=null;for(const [id,transform] of this.physicsOriginals || [])this.setTransform(id,transform);this.physicsOriginals=null;this.physicsOffsets=null;this.lastPhysicsTime=null;}
  resourceSets(objects=[this.content,...this.templates]){const geometries=new Set(),materials=new Set(),textures=new Set();for(const object of objects)object.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[])materials.add(material);});for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);return {geometries,materials,textures};}
  resourceStats(){const {geometries,textures}=this.resourceSets(),buffers=new Set();for(const geometry of geometries)for(const attribute of [...Object.values(geometry.attributes),geometry.index].filter(Boolean)){const buffer=(attribute.array || attribute.data?.array)?.buffer;if(buffer)buffers.add(buffer);}return {geometryArrayBufferBytes:[...buffers].reduce((total,buffer)=>total+buffer.byteLength,0),geometries:geometries.size,textures:textures.size,gpuMemoryMeasured:false,scope:'retained_geometry_arrays_only_excludes_textures_renderer_and_driver'};}
  disposeObject(object){this.disposeObjects([object]);}
  disposeObjects(objects){const {geometries,materials,textures}=this.resourceSets(objects),images=new Set();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of textures){texture.dispose();if(texture.image?.close)images.add(texture.image);}for(const image of images)image.close();}
  _clearContent(){this.resetPhysics();this.dirty=true;this.transform.detach();this.selection=null;if(this.highlight){this.scene.remove(this.highlight);this.highlight.geometry.dispose();this.highlight.material.dispose();this.highlight=null;}this.disposeObjects([this.content,...this.templates]);this.templates.clear();this.content.clear();this.entries.clear();this.container.dataset.ready='false';this.container.dataset.objects='0';}
  cancelLoad(){const wasLoading=this.loading;++this.loadGeneration;this.abort?.abort();this.abort=null;this.loading=false;this._clearContent();Object.assign(this.container.dataset,{loading:'false',loadedAssets:'0',totalAssets:'0'});if(wasLoading)this.onProgress({...this.loadReport,phase:'cancelled',loadedAssets:0,loadedObjects:0});}
  clear(){this.cancelLoad();}
  dispose(){if(this.disposed)return;this.disposed=true;++this.loadGeneration;this.abort?.abort();cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();this.transform.dispose();this.clear();this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);this.renderer.domElement.removeEventListener('pointerup',this.pointerUp);this.renderer.domElement.removeEventListener('webglcontextlost',this.contextLost);this.renderKit.dispose();this.renderer.dispose();this.container.replaceChildren();}
}
