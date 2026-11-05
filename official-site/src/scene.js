import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const smooth=(a,b,d)=>a+(b-a)*d;
function material(color,metalness=0,roughness=.5){return new T.MeshStandardMaterial({color,metalness,roughness});}
function box(w,h,d,mat,r=.05){const mesh=new T.Mesh(new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/3,h/3,d/3)),mat);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;}
function place(mesh,x,y,z,parent){mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
function roundedPath(x,y,w,h,r){const s=new T.Shape();s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
function texture(width,height,draw){const c=document.createElement('canvas');c.width=width;c.height=height;const context=c.getContext('2d');draw(context,width,height);const result=new T.CanvasTexture(c);result.colorSpace=T.SRGBColorSpace;return result;}
function roundRect(ctx,x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}

function desktopTexture(mode='chat'){
 return texture(1280,800,(c,w,h)=>{
  c.fillStyle='#f8faf7';c.fillRect(0,0,w,h);c.fillStyle='#e8ede7';c.fillRect(0,0,230,h);
  c.fillStyle='#16251d';c.font='bold 45px Segoe UI';c.fillText('brivany',30,70);c.fillStyle='#0071e3';c.fillText('.',173,70);
  c.font='24px Segoe UI';c.fillStyle='#405749';['Melodi','Espacios','Videos','Ajustes'].forEach((s,i)=>{if(i===0)roundRect(c,15,110,200,54,12,'#d7e3d7');c.fillStyle='#405749';c.fillText(s,35,148+i*82);});
  c.fillStyle='#233d2e';c.font='42px Georgia';c.textAlign='center';c.fillText(mode==='chat'?'¿Qué creamos hoy?':'Tu archivo, preparado.',750,232);
  roundRect(c,378,320,736,184,23,'#fff');c.strokeStyle='#e0e6dd';c.lineWidth=2;c.strokeRect(401,340,690,143);
  c.textAlign='left';c.font='26px Segoe UI';c.fillStyle='#687d6b';c.fillText(mode==='chat'?'Extrae el audio de este video.':'Audio extraído del video.',425,386);
  c.font='22px Segoe UI';c.fillStyle='#849184';c.fillText(mode==='chat'?'Guárdalo en Documentos / Entrevistas.':'Guardado en Documentos / Entrevistas.',425,436);
  roundRect(c,1100,645,65,65,18,'#365944');c.font='34px Segoe UI';c.fillStyle='white';c.fillText('↑',1122,690);
  c.fillStyle='#101a14';c.fillRect(0,0,w,22);roundRect(c,619,0,43,20,11,'#eaf4e9');c.fillStyle='#385440';c.fillRect(631,8,3,5);c.fillRect(643,8,3,5);
 });
}

function phoneTexture(plan=false){return texture(600,1200,(c,w,h)=>{
 c.fillStyle='#f4f5ef';c.fillRect(0,0,w,h);c.fillStyle='#1f362a';c.font='bold 40px Segoe UI';c.fillText('brivany',42,120);c.fillStyle='#0071e3';c.fillText('.',176,120);
 c.font='44px Georgia';c.fillStyle='#263e30';c.fillText(plan?'Tu espacio 3D':'Captura tu espacio',40,225);
 roundRect(c,32,285,536,560,28,'#e2e6dc');
 if(plan){c.strokeStyle='#627f67';c.lineWidth=10;c.strokeRect(95,360,390,400);c.lineWidth=4;c.strokeRect(135,420,170,120);c.strokeRect(350,600,75,85);c.beginPath();c.arc(420,420,30,0,Math.PI*2);c.stroke();c.font='22px Segoe UI';c.fillStyle='#526f57';c.fillText('Escena de demostración',103,810);}
 else{roundRect(c,85,370,430,300,4,'#d0d6c8');roundRect(c,160,460,185,90,4,'#9cae91');roundRect(c,380,500,55,115,6,'#6d8776');c.fillStyle='#aa9a7f';c.beginPath();c.moveTo(80,670);c.lineTo(520,670);c.lineTo(565,800);c.lineTo(35,800);c.fill();c.strokeStyle='#5a7f5f';c.lineWidth=3;c.strokeRect(62,315,476,498);}
 roundRect(c,43,930,514,92,30,'#2a4737');c.fillStyle='white';c.textAlign='center';c.font='26px Segoe UI';c.fillText(plan?'Explorar escena':'Preparar captura',300,987);
 c.fillStyle='#98a591';c.font='20px Segoe UI';c.fillText('Concepto de Brivany en móvil',300,1090);
 });}

function createLaptop(){
 const group=new T.Group(),silver=material('#bfc6c2',.88,.28),dark=material('#1a211f',.2,.35),key=material('#202725',.05,.55);
 place(box(3.45,.12,2.16,silver,.05),0,-.52,.33,group);place(box(1.04,.008,.56,material('#aeb8b2',.75,.45),.07),0,-.454,.92,group);
 for(let row=0;row<5;row++)for(let col=0;col<14;col++)place(box(.185,.018,.14,key,.014),-1.37+col*.21,-.444,-.28+row*.192,group);
 place(box(1.16,.018,.14,key,.012),0,-.444,.49,group);
 const hinge=new T.Group();hinge.position.set(0,-.48,-.67);hinge.rotation.x=-.14;group.add(hinge);
 place(box(3.36,2.16,.095,silver,.06),0,1.08,0,hinge);place(box(3.19,1.98,.027,dark,.04),0,1.09,.055,hinge);
 const screen=new T.Mesh(new T.PlaneGeometry(3.08,1.89),new T.MeshBasicMaterial({map:desktopTexture()}));place(screen,0,1.1,.075,hinge);
 const webcam=new T.Mesh(new T.SphereGeometry(.014,12,8),dark);place(webcam,0,2.097,.08,hinge);
 return {group,hinge,screen,closed:false};
}
function createPhone(){
 const group=new T.Group(),body=material('#67756e',.9,.28),glass=material('#111b16',.25,.22);
 place(box(1.38,2.79,.15,body,.07),0,0,0,group);place(box(1.32,2.72,.035,glass,.06),0,0,.085,group);
 const screen=new T.Mesh(new T.PlaneGeometry(1.23,2.58),new T.MeshBasicMaterial({map:phoneTexture()}));place(screen,0,0,.107,group);
 place(box(.44,.085,.014,material('#101913'),.03),0,1.196,.12,group);
 place(box(.025,.28,.065,body,.01),-.705,.52,0,group);place(box(.025,.37,.065,body,.01),.705,.42,0,group);
 place(box(.34,.026,.017,material('#263b2e'),.01),0,-1.2,.125,group);
 return {group,screen,plan:false};
}
function createGlasses(){
 const group=new T.Group(),frame=new T.MeshPhysicalMaterial({color:'#18251f',roughness:.22,metalness:.2,clearcoat:1,clearcoatRoughness:.1});
 const lens=new T.MeshPhysicalMaterial({color:'#a7c9b8',transparent:true,opacity:.28,roughness:.08,metalness:0,clearcoat:1,side:T.DoubleSide});
 for(const x of [-.49,.49]){
  const shape=roundedPath(-.43,-.28,.86,.56,.15),hole=roundedPath(-.355,-.21,.71,.42,.12);shape.holes.push(new T.Path(hole.getPoints(24).reverse()));
  const geometry=new T.ExtrudeGeometry(shape,{depth:.065,bevelEnabled:true,bevelSize:.015,bevelThickness:.012,bevelSegments:3,curveSegments:20});
  const mesh=new T.Mesh(geometry,frame);mesh.castShadow=true;place(mesh,x,0,0,group);
  const pane=new T.Mesh(new T.ShapeGeometry(roundedPath(-.355,-.21,.71,.42,.12)),lens);place(pane,x,0,.032,group);
 }
 const bridge=new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(-.095,.08,.02),new T.Vector3(0,.12,.04),new T.Vector3(.095,.08,.02)]),18,.035,8,false),frame);group.add(bridge);
 const arms=[];for(const sign of [-1,1]){const arm=new T.Group();arm.position.set(sign*.91,.08,.015);group.add(arm);const shape=new T.CatmullRomCurve3([new T.Vector3(0,0,0),new T.Vector3(sign*.045,0,-.65),new T.Vector3(sign*.04,-.03,-1.05),new T.Vector3(sign*.015,-.19,-1.18)]);const temple=new T.Mesh(new T.TubeGeometry(shape,32,.036,10,false),frame);temple.castShadow=true;arm.add(temple);const pin=new T.Mesh(new T.SphereGeometry(.045,12,8),material('#b8bfb7',.9,.24));arm.add(pin);arms.push(arm);}
 return {group,arms,opened:true};
}
function createRoom(){
 const group=new T.Group(),warm=material('#e4dfd2'),wood=material('#aa8d64'),green=material('#819782'),metal=material('#35493d',.35,.35);
 place(box(3.4,.08,2.6,material('#c2b399'),.01),0,-1.05,0,group);place(box(3.4,2.25,.045,warm,.01),0,.04,-1.28,group);place(box(.045,2.25,2.6,warm,.01),-1.68,.04,0,group);
 const table=new T.Group();place(box(1.2,.095,.7,wood,.035),0,.85,0,table);for(const x of [-.49,.49])for(const z of [-.25,.25])place(box(.06,.84,.06,wood,.01),x,.4,z,table);table.position.set(.35,-1,.0);group.add(table);table.userData.name='Mesa';
 const chair=new T.Group();place(box(.45,.08,.43,green,.04),0,.45,0,chair);place(box(.45,.44,.065,green,.03),0,.72,-.19,chair);for(const x of [-.16,.16])for(const z of [-.14,.14])place(box(.035,.42,.035,metal,.01),x,.2,z,chair);chair.position.set(-.75,-1,.56);group.add(chair);chair.userData.name='Silla';
 const lamp=new T.Group(),pole=new T.Mesh(new T.CylinderGeometry(.018,.018,1.55,12),metal);place(pole,0,.775,0,lamp);const shade=new T.Mesh(new T.ConeGeometry(.22,.32,32,1,true),material('#f0e9d7'));shade.rotation.x=Math.PI;place(shade,0,1.55,0,lamp);const base=new T.Mesh(new T.CylinderGeometry(.14,.14,.035,32),metal);place(base,0,.02,0,lamp);lamp.position.set(1.19,-1,-.75);group.add(lamp);lamp.userData.name='Lámpara';const light=new T.PointLight('#ffe0a9',2,3);place(light,0,1.47,0,lamp);
 group.visible=false;return {group,chair,table,lamp,light};
}

export class ProductScene{
 constructor(canvas,{onSelect=()=>{},onObject=()=>{}}={}){
  this.canvas=canvas;this.onObject=onObject;this.mode='overview';this.entered=false;this.targetCamera=new T.Vector3();this.targetLook=new T.Vector3();this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.cameraAnimating=true;
  const renderer=this.renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor('#f8f8f5',0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  this.scene=new T.Scene();this.camera=new T.PerspectiveCamera(35,1,.1,100);this.camera.position.set(4.3,2.6,8.8);
  const generator=new T.PMREMGenerator(renderer),environment=new RoomEnvironment();this.environment=generator.fromScene(environment,.03);this.scene.environment=this.environment.texture;environment.dispose();generator.dispose();this.scene.environmentIntensity=.8;
  this.scene.add(new T.HemisphereLight('#ffffff','#b8c5b2',2.6));const light=new T.DirectionalLight('#fffaf2',4.6);light.position.set(1.8,5.5,4);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-5;light.shadow.camera.right=5;light.shadow.camera.top=5;light.shadow.camera.bottom=-5;light.shadow.bias=-.0003;this.scene.add(light);
  const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.ShadowMaterial({opacity:.13}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.5;floor.receiveShadow=true;this.scene.add(floor);
  this.laptop=createLaptop();this.phone=createPhone();this.glasses=createGlasses();this.room=createRoom();this.items={desktop:this.laptop,phone:this.phone,glasses:this.glasses};for(const item of Object.values(this.items)){item.targetPosition=new T.Vector3();item.targetRotation=new T.Vector3();item.targetScale=1;this.scene.add(item.group);}this.scene.add(this.room.group);
  this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.enablePan=false;this.controls.minDistance=4;this.controls.maxDistance=15;this.controls.minPolarAngle=.35;this.controls.maxPolarAngle=1.6;this.controls.addEventListener('start',()=>this.cameraAnimating=false);
  this.pointer=new T.Vector2();this.ray=new T.Raycaster();let start;
  canvas.addEventListener('pointerdown',e=>start={x:e.clientX,y:e.clientY});canvas.addEventListener('pointerup',e=>{if(!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)>8)return;const r=canvas.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);
   if(this.entered){const hit=this.ray.intersectObjects([this.room.chair,this.room.table,this.room.lamp],true)[0];if(hit){let item=hit.object;while(item.parent&&item.parent!==this.room.group)item=item.parent;this.selectObject(item);}}
   else{const hits=this.ray.intersectObjects(Object.values(this.items).map(i=>i.group),true);if(hits[0]){let obj=hits[0].object;while(obj.parent&&obj.parent!==this.scene)obj=obj.parent;const id=Object.keys(this.items).find(k=>this.items[k].group===obj);if(id)onSelect(id);}}
  });
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);this.visible=true;this.observer=new IntersectionObserver(e=>this.visible=e[0].isIntersecting);this.observer.observe(canvas);this.setMode('overview');this.resize();this.last=performance.now();renderer.setAnimationLoop(now=>this.frame(now));
 }
 resize(){const rect=this.canvas.parentElement.getBoundingClientRect();this.renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false);this.camera.aspect=Math.max(.4,rect.width/rect.height);this.camera.updateProjectionMatrix();this.setTargets();}
 setMode(mode){if(!this.items[mode]&&mode!=='overview')return;this.mode=mode;this.entered=false;this.room.group.visible=false;this.clearSelection();this.cameraAnimating=true;this.setTargets();}
 setTargets(){
  const narrow=this.camera.aspect<1.25,overview=this.mode==='overview';
  const positions=narrow?{desktop:[-.25,.25,-.35],phone:[1.18,-.23,.85],glasses:[-1.25,-.94,1.25]}:{desktop:[-.28,.02,-.2],phone:[2.15,-.22,.9],glasses:[-2.0,-1.03,1.25]};
  for(const [key,item] of Object.entries(this.items)){
   const shown=overview||this.mode===key;item.targetPosition.set(...(overview?positions[key]:this.entered&&key==='glasses'?[0,1.05,1.1]:shown?[0,key==='desktop'?.02:0,0]:[key==='phone'?6:-6,-2,-2]));
   item.targetScale=overview?(narrow?(key==='desktop'?.77:.73):1):shown?(key==='glasses'?(this.entered?1:1.8):key==='phone'?1.08:1.05):.001;
   item.targetRotation.set(key==='glasses'?-.12:0,overview?(key==='desktop'?-.12:key==='phone'?-.45:.3):key==='phone'?-.25:key==='glasses'?.12:0,overview?(key==='phone'?-.06:key==='glasses'?.03:0):0);
  }
  const camera=overview?(narrow?[3.4,2.4,10]:[4.1,2.45,8.2]):this.entered?[4.2,2.8,6.5]:this.mode==='desktop'?[3.1,1.8,6.4]:this.mode==='phone'?[1.7,.75,5.8]:[.8,.6,5.3];this.targetCamera.set(...camera);
  if(narrow&&!overview&&!this.entered)this.targetCamera.multiplyScalar(this.mode==='desktop'?1.12:1.05);
  this.targetLook.set(0,this.entered?-.05:.13,0);this.cameraAnimating=true;
 }
 frame(now){const dt=Math.min(.05,Math.max(.001,(now-this.last)/1000));this.last=now;if(!this.visible||document.hidden)return;const d=this.reduced?1:1-Math.exp(-dt*6);
  for(const item of Object.values(this.items)){item.group.position.lerp(item.targetPosition,d);item.group.rotation.x=smooth(item.group.rotation.x,item.targetRotation.x,d);item.group.rotation.y=smooth(item.group.rotation.y,item.targetRotation.y,d);item.group.rotation.z=smooth(item.group.rotation.z,item.targetRotation.z,d);const s=smooth(item.group.scale.x,item.targetScale,d);item.group.scale.setScalar(s);item.group.visible=s>.006;}
  this.laptop.hinge.rotation.x=smooth(this.laptop.hinge.rotation.x,this.laptop.closed?Math.PI/2:-.14,d);this.glasses.arms.forEach((a,i)=>a.rotation.y=smooth(a.rotation.y,this.glasses.opened?0:(i===0?-1.35:1.35),d));
  if(this.cameraAnimating){this.camera.position.lerp(this.targetCamera,d);this.controls.target.lerp(this.targetLook,d);if(this.camera.position.distanceTo(this.targetCamera)<.004)this.cameraAnimating=false;}
  this.controls.update();this.selection?.update();this.renderer.render(this.scene,this.camera);
 }
 toggleLaptop(){this.laptop.closed=!this.laptop.closed;return this.laptop.closed;}
 desktopMode(mode){this.laptop.screen.material.map.dispose();this.laptop.screen.material.map=desktopTexture(mode);this.laptop.screen.material.needsUpdate=true;}
 togglePhone(){this.phone.plan=!this.phone.plan;this.phone.screen.material.map.dispose();this.phone.screen.material.map=phoneTexture(this.phone.plan);return this.phone.plan;}
 toggleGlasses(){this.glasses.opened=!this.glasses.opened;return this.glasses.opened;}
 enterRoom(){this.entered=!this.entered;this.room.group.visible=this.entered;this.clearSelection();this.setTargets();if(this.entered)this.selectObject(this.room.chair);return this.entered;}
 clearSelection(){if(this.selection){this.scene.remove(this.selection);this.selection.geometry.dispose();this.selection.material.dispose();this.selection=null;}this.selected=null;}
 selectObject(item){this.clearSelection();this.selected=item;this.selection=new T.BoxHelper(item,'#648f70');this.scene.add(this.selection);this.onObject(item.userData.name);}
 selectChair(){if(this.entered)this.selectObject(this.room.chair);}
 moveChair(){if(!this.entered)return false;const chair=this.room.chair,before=chair.position.x;chair.position.x=Math.min(.95,before+.18);chair.updateMatrixWorld(true);const test=new T.Box3().setFromObject(chair),table=new T.Box3().setFromObject(this.room.table);if(test.intersectsBox(table)){chair.position.x=before;return false;}this.selectObject(chair);return true;}
 save(){this.renderer.render(this.scene,this.camera);return this.canvas.toDataURL('image/png');}
 dispose(){this.renderer.setAnimationLoop(null);this.controls.dispose();this.resizeObserver.disconnect();this.observer.disconnect();this.environment.dispose();this.scene.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}});this.renderer.dispose();}
}
