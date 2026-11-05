import * as THREE from '/vendor/three/three.module.js';
import {EffectComposer} from '/vendor/three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from '/vendor/three/addons/postprocessing/RenderPass.js';
import {SSAOPass} from '/vendor/three/addons/postprocessing/SSAOPass.js';
import {OutputPass} from '/vendor/three/addons/postprocessing/OutputPass.js';
const PROFILES={economy:{pixelRatio:1,shadow:1024,ao:false},balanced:{pixelRatio:1.5,shadow:2048,ao:false},high:{pixelRatio:1.75,shadow:2048,ao:true}};
const percentile=(values,fraction)=>values.length?values.slice().sort((a,b)=>a-b)[Math.floor((values.length-1)*fraction)]:null;

/** Timings measure CPU submission, never GPU completion or a device guarantee. */
export class SpatialRender {
  constructor(renderer,scene,camera,container){
    Object.assign(this,{renderer,scene,camera,container});renderer.info.autoReset=false;this.samples=[];this.profile='balanced';this.requested='auto';this.daylight=1;this.shadowDirty=true;
    this.sun=new THREE.DirectionalLight(0xfff1dc,3);this.sun.position.set(4,9,6);this.sun.castShadow=true;
    Object.assign(this.sun.shadow.camera,{left:-9,right:9,top:9,bottom:-9,near:.5,far:30});
    this.sun.shadow.normalBias=.025;this.sun.shadow.bias=-.0001;this.sun.shadow.radius=3;
    this.fill=new THREE.HemisphereLight(0xfff7eb,0x9a8d77,1.1);this.ambient=new THREE.AmbientLight(0xffffff,.12);
    scene.add(this.sun,this.sun.target,this.fill,this.ambient);renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const room=new THREE.Scene();room.background=new THREE.Color(0x8c8982);
    room.add(new THREE.Mesh(new THREE.BoxGeometry(12,8,12),new THREE.MeshBasicMaterial({color:0xbdb5a5,side:THREE.BackSide})));
    for(const [position,scale,color] of [[[4,2,0],[.1,4,6],0xffffff],[[-2,3,1],[4,.1,5],0xa39b8d],[[0,0,5],[5,3,.1],0xeee5d4]]){
      const panel=new THREE.Mesh(new THREE.BoxGeometry(...scale),new THREE.MeshBasicMaterial({color}));panel.position.fromArray(position);room.add(panel);
    }
    const generator=new THREE.PMREMGenerator(renderer);this.environment=generator.fromScene(room,.04,.1,40);generator.dispose();
    room.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});scene.environment=this.environment.texture;scene.environmentIntensity=.32;
    this.configure({});this.setQuality('auto');
  }
  configure(config={}){
    const previous=this.capturedColors;this.capturedColors=config.capturedColors===true;
    this.renderer.toneMapping=this.capturedColors?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;
    this.sun.visible=this.fill.visible=this.ambient.visible=!this.capturedColors;
    this.renderer.shadowMap.enabled=!this.capturedColors;this.scene.environment=this.capturedColors?null:this.environment.texture;
    this.container.dataset.colorMode=this.capturedColors?'captured-unlit':'pbr-preview';
    this.config=config;this.baseIntensity=Number.isFinite(config.sun?.intensity)?Math.min(6,Math.max(.1,config.sun.intensity)):2.3;
    if(Array.isArray(config.sun?.position))this.sun.position.fromArray(config.sun.position);else this.sun.position.set(4,9,6);
    if(Array.isArray(config.sun?.target))this.sun.target.position.fromArray(config.sun.target);else this.sun.target.position.set(0,0,0);
    this.sun.color.set(/^#[a-f0-9]{6}$/i.test(config.sun?.color || '')?config.sun.color:0xfff1dc);
    this.renderer.toneMappingExposure=Number.isFinite(config.exposure)?Math.min(2,Math.max(.4,config.exposure)):.9;
    this.scene.background=new THREE.Color(/^#[a-f0-9]{6}$/i.test(config.background || '')?config.background:0xf5f5f7);
    this.fill.intensity=config.version?.includes('reference')?1.15:1.8;this.sun.intensity=this.baseIntensity*this.daylight;this.shadowDirty=true;
    if(previous!==undefined && previous!==this.capturedColors)this.setQuality(this.requested);
  }
  disposeComposer(){if(!this.composer)return;for(const pass of this.composer.passes){pass.dispose?.();if(pass===this.ao){pass.ssaoMaterial?.dispose();pass.noiseTexture?.dispose();}}this.composer.dispose();this.composer=null;this.ao=null;}
  setQuality(requested){
    if(!['auto',...Object.keys(PROFILES)].includes(requested))throw Error('Perfil de render desconocido.');
    this.requested=requested;this.profile=requested==='auto'?(innerWidth<700?'economy':'balanced'):requested;this.disposeComposer();
    const profile=PROFILES[this.profile];this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1,profile.pixelRatio));
    const size=Math.min(profile.shadow,this.renderer.capabilities.maxTextureSize);this.sun.shadow.mapSize.set(size,size);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;
    if(profile.ao && !this.capturedColors){this.composer=new EffectComposer(this.renderer);this.composer.addPass(new RenderPass(this.scene,this.camera));this.ao=new SSAOPass(this.scene,this.camera,1,1,16);this.ao.kernelRadius=.26;this.ao.minDistance=.001;this.ao.maxDistance=.12;this.composer.addPass(new OutputPass());}
    this.resize(this.container.clientWidth,this.container.clientHeight);this.shadowDirty=true;this.container.dataset.quality=this.profile;
  }
  resize(width,height){if(!width || !height)return;this.renderer.setSize(width,height,false);if(this.composer){this.composer.setPixelRatio(this.renderer.getPixelRatio());this.composer.setSize(width,height);this.ao.setSize(Math.max(1,Math.floor(width*.5)),Math.max(1,Math.floor(height*.5)));}}
  setDaylight(value){if(typeof value!=='number' || !Number.isFinite(value) || value<.2 || value>2)throw Error('Luz fuera de límites.');this.daylight=value;this.sun.intensity=this.baseIntensity*value;this.shadowDirty=true;}
  draw(){const start=performance.now();this.renderer.info.reset();this.renderer.shadowMap.needsUpdate=this.shadowDirty;if(this.composer)this.composer.render();else this.renderer.render(this.scene,this.camera);this.shadowDirty=false;this.samples.push(performance.now()-start);if(this.samples.length>180)this.samples.shift();this.container.dataset.triangles=String(this.renderer.info.render.triangles);this.container.dataset.renderedQuality=this.profile;this.container.dataset.ambientOcclusion=String(Boolean(this.composer));}
  stats(){return {profile:this.profile,requested:this.requested,renderer:'WebGL2 raster',ambientOcclusion:Boolean(this.composer),shadowMapSize:this.sun.shadow.mapSize.x,pixelRatio:this.renderer.getPixelRatio(),width:this.container.clientWidth,height:this.container.clientHeight,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures,cpuSubmissionP50Ms:percentile(this.samples,.5),cpuSubmissionP95Ms:percentile(this.samples,.95),sampleCount:this.samples.length,gpuTimeMeasured:false,geometryFidelityVerified:false,metricScaleVerified:false};}
  dispose(){this.disposeComposer();this.environment.dispose();this.sun.shadow.map?.dispose();this.scene.remove(this.sun,this.sun.target,this.fill,this.ambient);this.scene.environment=null;}
}
