/* Edition 2. Two continuous, authored worlds. Narration PCM is the motion clock. */
const {THREE,RoundedBoxGeometry,RoomEnvironment}=globalThis.BrivanyMotionLibraries;
const W=1920,H=1080,PI=Math.PI,clamp=v=>Math.max(0,Math.min(1,v));
const ease=v=>{v=clamp(v);return v*v*v*(v*(v*6-15)+10);};
const at=(t,a,b)=>ease((t-a)/(b-a)),mix=(a,b,p)=>a+(b-a)*p;
const rgba=(hex,a)=>hex+Math.round(clamp(a)*255).toString(16).padStart(2,'0');
function text(c,s,x,y,size=80,color='#fff',align='left',font='Georgia'){
 c.fillStyle=color;c.font=`${font==='Georgia'?400:500} ${size}px ${font}`;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);
}
function alpha(c,a,fn){c.save();c.globalAlpha*=clamp(a);fn();c.restore();}
function pill(c,x,y,w,h,r,fill){c.fillStyle=fill;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
function split(c,s,x,y,size,progress,color='#f4f7fa'){
 const words=s.split(' '),gap=size*.26;c.font=`400 ${size}px Georgia`;let cursor=x;
 for(let i=0;i<words.length;i++){
  const p=clamp(progress*1.5-i*.1);c.save();c.beginPath();c.rect(cursor-4,y-size*1.2,size*words[i].length,y*0+size*1.5);c.clip();
  text(c,words[i],cursor,y+(1-ease(p))*size*1.1,size,color);c.restore();cursor+=c.measureText(words[i]).width+gap;
 }
}
function setup(canvas,dark){
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setSize(W,H,false);renderer.setPixelRatio(1);
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=dark?1.08:.87;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const scene=new THREE.Scene();scene.background=new THREE.Color(dark?'#07090f':'#edece8');
 const pmrem=new THREE.PMREMGenerator(renderer),env=new RoomEnvironment();scene.environment=pmrem.fromScene(env,.04).texture;env.dispose();pmrem.dispose();scene.environmentIntensity=dark?.55:.7;
 const camera=new THREE.PerspectiveCamera(36,W/H,.1,180);
 scene.add(new THREE.HemisphereLight(dark?0xa6bbff:0xf8e5cb,dark?0x080b18:0xa7a59f,dark?1.3:.75));
 const key=new THREE.DirectionalLight(dark?0xe4eeff:0xffefd8,dark?4.5:3.2);key.position.set(-5,12,9);key.castShadow=true;key.shadow.mapSize.set(1536,1536);
 Object.assign(key.shadow.camera,{left:-12,right:12,top:12,bottom:-12,far:65});key.shadow.normalBias=.035;key.shadow.bias=-.0002;scene.add(key);
 const rim=new THREE.DirectionalLight(dark?0x385fff:0xc8dfff,dark?5:1.6);rim.position.set(7,7,-7);scene.add(rim);
 const warm=new THREE.PointLight(dark?0x82ffe6:0xffc27c,dark?50:5,30,2);warm.position.set(3,3,4);scene.add(warm);
 return {renderer,scene,camera,key,rim,warm};
}
function mat(color,roughness=.5,metalness=.05){return new THREE.MeshStandardMaterial({color,roughness,metalness});}
function box(parent,x,y,z,w,h,d,material,r=.08){const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,Math.min(r,w*.2,h*.2,d*.2)),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function cylinder(parent,x,y,z,r,h,material,top=r){const m=new THREE.Mesh(new THREE.CylinderGeometry(top,r,h,40),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function gradient(c,dark){const g=c.createLinearGradient(0,0,W,0);g.addColorStop(0,dark?'#07090f80':'#edece870');g.addColorStop(.30,'#00000000');g.addColorStop(1,'#00000000');c.fillStyle=g;c.fillRect(0,0,W,H);}
function endCard(c,u,spec,logo,light){const p=at(u,22.4,23.65);if(!p)return;
 c.fillStyle=rgba(light?'#f3f1eb':'#07090f',p);c.fillRect(0,0,W,H);
 alpha(c,at(u,23,24.5),()=>{
  const slide=(1-at(u,23,24.5))*170;c.save();c.beginPath();c.rect(570,360,800,220);c.clip();c.drawImage(logo,620,400+slide,680,680*62/200);c.restore();
  text(c,spec.closing,960,688,57,light?'#454a48':'#b7c8dc','center');
  text(c,'brivany.example',960,794,33,light?'#65716b':'#93a7c0','center','Segoe UI');
 });
}
function level(spec,t){const a=spec.audio;if(!a?.levels)return 0;const n=Math.floor(t*a.levels_hz);let sum=0;for(let i=-2;i<=2;i++)sum+=a.levels[Math.min(a.levels.length-1,Math.max(0,n+i))];return sum/5;}

function ribbonsWorld(canvas){
 const base=setup(canvas,true),{scene}=base,group=new THREE.Group();scene.add(group);
 const materials=[mat('#3e75ff',.24,.65),mat('#b8d6ff',.27,.85),mat('#65e6d0',.31,.65)];
 const ribbons=[];
 for(let j=0;j<3;j++){
  const n=160,positions=new Float32Array((n+1)*2*3),indices=[];
  for(let i=0;i<n;i++){const q=i*2;indices.push(q,q+1,q+2,q+1,q+3,q+2);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
  materials[j].side=THREE.DoubleSide;const mesh=new THREE.Mesh(geo,materials[j]);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);ribbons.push(mesh);
 }
 const frames=[],frameMat=mat('#244eae',.35,.6),backMat=mat('#0c162b',.28,.4);
 for(let i=0;i<9;i++){
  const g=new THREE.Group();group.add(g);box(g,0,0,0,2.95,1.85,.12,frameMat,.1);box(g,0,0,.08,2.8,1.7,.02,backMat,.08);
  const art=new THREE.Group();g.add(art);
  const shape=i%3===0?new THREE.TorusKnotGeometry(.42,.095,72,10):i%3===1?new THREE.IcosahedronGeometry(.55,0):new THREE.TorusGeometry(.52,.09,12,64);
  const hoop=new THREE.Mesh(shape,materials[i%3]);hoop.position.z=.16;art.add(hoop);
  const orb=new THREE.Mesh(new THREE.SphereGeometry(.24,24,20),materials[(i+1)%3]);orb.position.set(.65,0,.2);art.add(orb);
  frames.push({g,art,orb,hoop});
 }
 return {...base,group,ribbons,frames};
}
function drawRibbons(world,u,energy){
 const {ribbons,frames,group,camera}=world;const coil=at(u,5.5,9),unfold=at(u,10.2,14),returning=at(u,18.5,21.5);
 group.visible=u<23.7;group.position.set(1.3*(1-at(u,10,14)),.05,0);group.scale.setScalar(mix(1,.22,returning));
 for(let j=0;j<3;j++){
  const mesh=ribbons[j],positions=mesh.geometry.attributes.position;
  const radius=2.7+j*.43;
  for(let i=0;i<=160;i++){
   const p=i/160,a=p*PI*2,phase=u*.68+j*1.3;
   const waveX=(p-.5)*14,waveY=Math.sin(p*PI*3.5-phase)*(1.05+energy*.45),waveZ=Math.cos(p*PI*2.2+phase)*.7+j*.18;
   const ringPhase=u*.36,ringX=Math.cos(a+ringPhase*.2)*(radius+Math.sin(a*3+ringPhase)*.16),ringY=Math.sin(a+ringPhase*.2)*radius,ringZ=Math.sin(a*3+ringPhase)*.8+(j-1)*.34;
   const x=mix(waveX,ringX,coil),y=mix(waveY,ringY,coil),z=mix(waveZ,ringZ,coil);
   const width=(.12+Math.sin(p*PI)*.31)*(1-coil*.52)*(1-unfold),twist=a*2+mix(phase,ringPhase,coil);
   for(let side=0;side<2;side++){const sign=side?1:-1;positions.setXYZ(i*2+side,x,y+Math.cos(twist)*width*sign,z+Math.sin(twist)*width*sign);}
  }
  mesh.geometry.computeVertexNormals();positions.needsUpdate=true;mesh.visible=unfold<.999;
 }
 for(let i=0;i<frames.length;i++){
  const {g,art,orb,hoop}=frames[i],p=i/8,arrival=at(u,9.8+i*.09,11.8+i*.09),spread=at(u,13.3,16);
  const a=p*PI*2+u*.12;
  g.visible=arrival>.001&&returning<.99;
  g.scale.setScalar(arrival*mix(.22,.9,spread));
  g.position.set(mix(Math.cos(a)*2.3,(i-4)*3.12,spread),mix(Math.sin(a)*2.3,0,spread),mix(Math.sin(a)*1.2,Math.abs(i-4)*-.5,spread));
  g.rotation.set(mix(p*.4,0,spread),mix(-a,-.16,spread),mix(p*.5,0,spread));
  art.rotation.z=u*.25+i*.3;hoop.rotation.x=.5+Math.sin(u*.3+i)*.5;orb.position.y=Math.sin(u*.8+i)*.45;
 }
 const travel=at(u,14,19),x=mix(0,3.2,travel);
 camera.position.set(x, mix(.8,1.5,coil),mix(15,12,coil)+unfold*3-at(u,17,19)*2);camera.lookAt(.3,0,0);world.warm.position.x=Math.sin(u*.3)*7;
 world.renderer.render(world.scene,camera);
}
function voiceFilm(c,t,spec,world,logo){
 const u=t/spec.duration*30,energy=level(spec,t);drawRibbons(world,u,energy);c.clearRect(0,0,W,H);gradient(c,true);
 const a=1-at(u,5.5,6.3);alpha(c,a,()=>{
  split(c,'Tu voz.',135,325,150,at(u,-.7,.8));text(c,'El principio de todo.',144,417,38,'#a9b8ce','left','Segoe UI');
 });
 alpha(c,at(u,6.1,6.6)*(1-at(u,11.4,12)),()=>{
  split(c,'En movimiento.',135,286,112,at(u,6.2,7.5));
  text(c,'Forma. Ritmo. Color.',142,380,38,'#a9b8ce','left','Segoe UI');
 });
 // An authored strip becomes a result; lettering stays stationary after arrival.
 alpha(c,at(u,13.5,14.3)*(1-at(u,18.8,19.4)),()=>{
  text(c,spec.payoff,960,225,82,'#f4f7fa','center');
  const p=at(u,14.5,18);pill(c,540,850,840,3,2,'#283344');pill(c,540,850,840*p,3,2,'#8ec9ff');
 });
 // Same result returns to the real WorkSpace tool names; no invented dashboard.
 const bar=at(u,19.3,20.3)*(1-at(u,22.3,23));alpha(c,bar,()=>{
  const y=mix(790,310,at(u,19.3,20.5));pill(c,144,y,1632,94,35,'#020306');
  c.drawImage(logo,180,y+20,185,57.35);
  for(const [label,x] of [['Traducción auditiva',525],['Selección de área',855],['Música',1265],['Abrir app',1520]])text(c,label,x,y+57,28,'#d5dfec','center','Segoe UI');
  text(c,'Tú sigues. Melodi crea.',960,640,84,'#f4f7fa','center');
 });
 endCard(c,u,spec,logo,false);
}

function architectureWorld(canvas){
 const base=setup(canvas,false),{scene}=base,root=new THREE.Group();scene.add(root);
 const plaster=mat('#e2dfd3',.85),wood=mat('#a57952',.6),oak=mat('#c5a57b',.75),linen=mat('#e5d8bd',.97),blue=mat('#667d8a',.86),black=mat('#252b2b',.45,.6),stone=mat('#c8c3b6',.78),green=mat('#4a6450',.8);
 box(scene,0,-.48,0,200,.2,200,mat('#edece8',.95));
 const slab=box(root,0,-.17,0,8.2,.28,6.4,stone),floor=new THREE.Group();root.add(floor);
 const plankGeo=new RoundedBoxGeometry(.48,.045,1.56,1,.01),planks=new THREE.InstancedMesh(plankGeo,oak,16*4);let count=0;const transform=new THREE.Object3D();
 for(let x=0;x<16;x++)for(let z=0;z<4;z++){transform.position.set(-3.75+x*.5,.007,-2.35+z*1.57);transform.updateMatrix();planks.setMatrixAt(count++,transform.matrix);}planks.receiveShadow=true;floor.add(planks);
 const walls=new THREE.Group();root.add(walls);
 box(walls,0,1.68,-3.12,8.15,3.4,.16,plaster,.015);
 // Actual aperture in the left wall, with jambs, lintel and slender mullions.
 box(walls,-4.02,1.68,-2.59,.16,3.4,1,plaster,.015);box(walls,-4.02,1.68,2.6,.16,3.4,1,plaster,.015);box(walls,-4.02,3.1,0,.16,.56,4.2,plaster,.015);box(walls,-4.02,.34,0,.16,.7,4.2,plaster,.015);
 for(const z of [-2.07,-.7,.7,2.07])box(walls,-3.99,1.7,z,.08,2.45,.045,black,.006);
 for(const y of [.48,2.91])box(walls,-3.99,y,0,.08,.045,4.18,black,.006);
 const glass=new THREE.MeshPhysicalMaterial({color:'#cce3e5',transparent:true,opacity:.14,roughness:.08,metalness:.1,side:THREE.DoubleSide});box(walls,-4,1.7,0,.015,2.4,4.1,glass,.002).castShadow=false;
 const slats=new THREE.Group();walls.add(slats);for(let i=0;i<24;i++)box(slats,2.76+i*.047,1.5,-2.99,.022,2.85,.06,wood,.003);
 const furniture=[],addGroup=()=>{const g=new THREE.Group();root.add(g);furniture.push(g);return g;};
 const rug=addGroup();box(rug,.1,.055,.55,4.8,.035,3.6,mat('#b8b2a3',1),.02);for(let i=0;i<35;i++)box(rug,-2.2+i*.13,.077,.55,.006,.004,3.5,mat('#c7c2b6',1),.001);
 const sofa=addGroup();box(sofa,-.75,.43,-1.9,3.8,.54,1.2,linen,.18);box(sofa,-.75,.91,-2.35,3.8,.95,.33,linen,.14);
 for(const x of [-2.52,1.02])box(sofa,x,.7,-1.95,.3,.85,1.22,linen,.12);
 for(let i=0;i<3;i++){box(sofa,-1.95+i*1.2,.79,-1.85,1.12,.2,.94,linen,.12);const cushion=box(sofa,-1.95+i*1.2,1.1,-2.15,.99,.6,.24,i===1?blue:linen,.12);cushion.rotation.x=-.18;}
 for(const x of [-2.3,.8])for(const z of [-2.35,-1.55])cylinder(sofa,x,.15,z,.045,.3,black);
 const table=addGroup();cylinder(table,-.4,.5,.65,1.05,.12,wood);cylinder(table,-.4,.23,.65,.33,.46,wood);box(table,-.75,.58,.55,.55,.06,.4,linen,.008);box(table,-.72,.62,.56,.48,.025,.36,blue,.005);
 cylinder(table,.07,.67,.75,.12,.22,mat('#f3eee4',.25));
 const chair=addGroup();box(chair,2.57,.53,.9,1.15,.25,1.15,blue,.15);const cb=box(chair,2.57,1,.47,1.15,.83,.23,blue,.15);cb.rotation.x=-.14;for(const x of [2.13,3.01])for(const z of [.53,1.32])cylinder(chair,x,.23,z,.035,.46,black);
 const lamp=addGroup();cylinder(lamp,2.48,.055,-1.87,.38,.09,black);cylinder(lamp,2.48,1.25,-1.87,.025,2.5,black);const shade=new THREE.Mesh(new THREE.ConeGeometry(.58,.47,64,1,true),linen);shade.position.set(2.48,2.43,-1.87);lamp.add(shade);const lampLight=new THREE.PointLight(0xffb86b,8,5,2);lampLight.position.set(2.48,2.2,-1.87);lamp.add(lampLight);
 const plant=addGroup();cylinder(plant,-2.9,.28,1.85,.31,.56,stone,.38);for(let i=0;i<11;i++){const a=i*2.399,g=new THREE.Mesh(new THREE.SphereGeometry(.21,16,12),green);g.position.set(-2.9+Math.cos(a)*.36,.85+(i%4)*.24,1.85+Math.sin(a)*.36);g.scale.set(.7,1.9,.27);g.rotation.set(.3,0,Math.cos(a)*.6);plant.add(g);
  const from=new THREE.Vector3(-2.9,.5,1.85),to=g.position.clone(),direction=to.clone().sub(from),stem=new THREE.Mesh(new THREE.CylinderGeometry(.008,.012,direction.length(),6),green);stem.position.copy(from.add(to).multiplyScalar(.5));stem.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());plant.add(stem);
 }
 const art=addGroup();box(art,-.85,2.12,-2.99,2.7,1.35,.07,black,.008);box(art,-.85,2.12,-2.94,2.58,1.23,.01,mat('#c0b19a',.95),.005);const artCircle=new THREE.Mesh(new THREE.CircleGeometry(.42,64),mat('#5d777b',.95));artCircle.position.set(-.75,2.16,-2.92);art.add(artCircle);
 const roof=new THREE.Group();root.add(roof);for(let i=0;i<22;i++)box(roof,-3.85+i*.36,3.48,0,.11,.1,6.3,wood,.007);
 const blueprint=new THREE.Group();scene.add(blueprint);const lines=[];
 const segment=(a,b)=>lines.push(...a,...b);
 const outline=[[-4,0,-3],[4,0,-3],[4,0,3],[-4,0,3],[-4,0,-3]];for(let i=0;i<4;i++)segment(outline[i],outline[i+1]);
 for(const rect of [[-2.65,-2.5,3.8,1.3],[-1.5,-.4,2.1,2],[2,.3,1.1,1.2]]){const[x,z,w,d]=rect;segment([x,0,z],[x+w,0,z]);segment([x+w,0,z],[x+w,0,z+d]);segment([x+w,0,z+d],[x,0,z+d]);segment([x,0,z+d],[x,0,z]);}
 for(const x of [-4,4]){segment([x,0,3.6],[x,0,4.1]);}segment([-4,0,3.85],[4,0,3.85]);
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));const line=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:'#456f8b',transparent:true}));blueprint.add(line);blueprint.position.y=.1;
 const materials=[linen,wood,plaster],samples=materials.map((material,i)=>{const m=box(scene,5.3,.16,i*1.2-1.2,.85,.3,.85,material,.06);return m;});
 return {...base,root,slab,floor,walls,furniture,roof,blueprint,line,samples};
}
function drawArchitecture(world,u){
 const {camera,root,slab,floor,walls,furniture,roof,blueprint,line,samples}=world;
 const build=at(u,5.7,9.8),furnish=at(u,11,15.4),dive=at(u,16.2,20.7),exploded=at(u,9,10)*(1-at(u,11,12));
 root.visible=u>2.2&&u<23.7;root.rotation.y=-.12+at(u,8,16)*.17;
 slab.scale.set(1,Math.max(.001,at(u,2.2,5)),1);floor.visible=u>5;floor.position.y=.1*(1-build);
 walls.scale.y=Math.max(.001,build);walls.position.y=exploded*.55;
 for(let i=0;i<furniture.length;i++){const p=at(u,10.5+i*.24,12.2+i*.24);furniture[i].visible=p>0;furniture[i].position.y=(1-p)*(2.2+i*.18);furniture[i].scale.setScalar(Math.max(.001,p));}
 roof.visible=u>8&&u<16;roof.position.y=(1-at(u,8,10))*2.5+exploded*.8+at(u,13.5,16)*5;
 blueprint.visible=u<10;line.geometry.setDrawRange(0,Math.floor(at(u,-1,4.3)*line.geometry.attributes.position.count/2)*2);line.material.opacity=1-at(u,7,10);
 samples.forEach((m,i)=>{const p=at(u,7.5+i*.3,8.8+i*.3)*(1-at(u,13,14));m.scale.setScalar(Math.max(.001,p));m.rotation.y=.3;});
 const top=at(u,2.7,6),x=mix(0,11.8,top),y=mix(18,10,top),z=mix(.1,13.2,top);
 camera.position.set(mix(x,4.7,dive),mix(y,3.7,dive),mix(z,6.3,dive));
 camera.lookAt(mix(-.6,-.2,dive),mix(0,1.05,dive),mix(0,-1,dive));
 world.key.position.set(-6+u*.17,12,8);world.renderer.render(world.scene,camera);
}
function architectureFilm(c,t,spec,world,logo){
 const u=t/spec.duration*30;drawArchitecture(world,u);c.clearRect(0,0,W,H);gradient(c,false);
 alpha(c,(1-at(u,5.9,6.6)),()=>{split(c,'Una idea.',130,270,132,at(u,-.7,.8),'#262d2b');text(c,'Un trazo.',138,366,42,'#636d69','left','Segoe UI');});
 alpha(c,at(u,6.2,6.8)*(1-at(u,12,12.7)),()=>{split(c,'Toma forma.',130,220,108,at(u,6.3,7.6),'#262d2b');});
 alpha(c,at(u,13,13.7)*(1-at(u,16,16.7)),()=>{text(c,'Luz. Material. Volumen.',960,190,76,'#262d2b','center');});
 alpha(c,at(u,17.2,18)*(1-at(u,22.2,22.8)),()=>{text(c,spec.payoff,135,205,82,'#262d2b');text(c,'Diseño conceptual 3D',141,278,32,'#636d69','left','Segoe UI');});
 endCard(c,u,spec,logo,true);
}
export function createPremium(canvas,spec,logos){
 const world=spec.style==='spatial'?architectureWorld(canvas):ribbonsWorld(canvas);
 return {draw(ctx,t){if(spec.style==='spatial')architectureFilm(ctx,t,spec,world,logos.ink);else voiceFilm(ctx,t,spec,world,logos.light);}};
}
