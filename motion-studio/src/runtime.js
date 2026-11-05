import {createPremium} from './premium.js';
const {gsap,THREE,RoundedBoxGeometry}=globalThis.BrivanyMotionLibraries;

const W=1920,H=1080;
let logoInk,logoLight;
const clamp=x=>Math.min(1,Math.max(0,x));
const smooth=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);};
const at=(t,a,b)=>smooth((t-a)/(b-a));
const mix=(a,b,u)=>a+(b-a)*u;
const round=(c,x,y,w,h,r,fill)=>{c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();};
function words(c,text,x,y,size=80,color='#1d1d1f',font='Georgia',align='left'){
 c.fillStyle=color;c.font=`${font==='Georgia'?'400':'500'} ${size}px ${font}`;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(text,x,y);
}
function alpha(c,value,fn){c.save();c.globalAlpha*=clamp(value);fn();c.restore();}
function shadow(c,blur=40,y=16,color='#172d2820'){c.shadowColor=color;c.shadowBlur=blur;c.shadowOffsetY=y;}
function brand(c,x,y,width,color='#1d1d1f'){
 const img=color==='#1d1d1f'?logoInk:logoLight;
 if(img)c.drawImage(img,x,y-width*46/200,width,width*62/200);
}
function mascot(c,x,y,size,t){
 c.save();c.translate(x,y);c.rotate(Math.sin(t*1.3)*.025);shadow(c,size*.2,size*.1,'#0b262530');
 const g=c.createLinearGradient(-size*.4,-size*.4,size*.4,size*.5);g.addColorStop(0,'#ffffff');g.addColorStop(.55,'#f4f8f4');g.addColorStop(1,'#d7e5df');
 round(c,-size*.5,-size*.38,size,size*.76,size*.34,g);c.shadowColor='transparent';
 round(c,-size*.58,-size*.02,size*.13,size*.17,size*.06,'#e8f0e9');round(c,size*.45,-size*.02,size*.13,size*.17,size*.06,'#e8f0e9');
 const blink=Math.pow(Math.max(0,Math.cos(t*1.6)),30),eyeH=mix(size*.075,size*.018,blink);
 for(const sign of [-1,1])round(c,sign*size*.15-size*.022,-eyeH/2,size*.045,eyeH,size*.023,'#24453b');
 c.globalAlpha*=.25;for(const sign of [-1,1])round(c,sign*size*.3-size*.055,size*.1,size*.11,size*.045,size*.025,'#82ad99');c.restore();
}
function workspace(c,t,spec){
 const u=t/spec.duration*24,exit=at(u,19.5,22),expand=at(u,3.1,5.6),app=at(u,5.6,7.7);
 const g=c.createLinearGradient(0,0,W,H);g.addColorStop(0,'#f8f8f5');g.addColorStop(.5,'#f3f7f4');g.addColorStop(1,'#e3eee8');c.fillStyle=g;c.fillRect(0,0,W,H);
 const light=c.createRadialGradient(1450+Math.sin(u*.16)*140,160,0,1450,160,1200);light.addColorStop(0,'#ffffffc0');light.addColorStop(1,'#ffffff00');c.fillStyle=light;c.fillRect(0,0,W,H);
 alpha(c,(1-expand),()=>{words(c,spec.headline,960,305,90,'#1d1d1f','Georgia','center');});
 const barW=mix(800,1540,expand),barX=(W-barW)/2,barY=mix(476,180,expand),barH=mix(260,66,expand);
 alpha(c,1-exit,()=>{
  c.save();shadow(c,55,26,'#1f40351c');round(c,barX,barY,barW,barH,mix(44,18,expand),'#060907');c.restore();
  alpha(c,expand,()=>{brand(c,barX+32,barY+44,142,'#fff');words(c,'Traducción auditiva',barX+220,barY+40,25,'#c5ceca','Segoe UI');words(c,'Selección de área',barX+502,barY+40,25,'#c5ceca','Segoe UI');words(c,'Música',barX+1190,barY+40,25,'#c5ceca','Segoe UI');words(c,'Abrir app',barX+1335,barY+40,25,'#c5ceca','Segoe UI');});
  const mSize=mix(350,68,expand);mascot(c,960,barY+barH*.5,mSize,u);
  alpha(c,app,()=>{
   const panelY=mix(340,270,app);c.save();shadow(c,70,35,'#274b3418');round(c,310,panelY,1300,660,30,'#fff');c.restore();
   c.strokeStyle='#e6ece7';c.lineWidth=2;c.beginPath();c.moveTo(350,panelY+85);c.lineTo(1570,panelY+85);c.stroke();
   brand(c,350,panelY+57,155);words(c,'Melodi',1495,panelY+55,29,'#61766a','Segoe UI','right');
   const msg=at(u,7.6,8.6),progress=at(u,9,14.5),result=at(u,14.2,15.2);
   alpha(c,msg*(1-result),()=>{round(c,740,panelY+145,790,100,24,'#eff4f0');words(c,spec.request,780,panelY+208,35,'#263d31','Segoe UI');
    words(c,'Preparando tu video',390,panelY+365,46);round(c,390,panelY+400,1120,5,3,'#e6eee8');round(c,390,panelY+400,1120*progress,5,3,'#2d7e68');
    for(let i=0;i<24;i++){const a=i/23;c.fillStyle='#2d7e68';const h=12+Math.sin(u*3+i*.8)*Math.sin(u*1.1+i)*20*progress;c.beginPath();c.roundRect(690+i*20,panelY+510-h/2,5,h,3);c.fill();}
   });
   alpha(c,result,()=>{
    // A moving video result inside the same product surface, not a frozen screen.
    c.save();c.beginPath();c.roundRect(380,panelY+115,1160,395,24);c.clip();const pg=c.createLinearGradient(380,300,1500,720);pg.addColorStop(0,'#102b3b');pg.addColorStop(1,'#285f75');c.fillStyle=pg;c.fillRect(380,panelY+115,1160,395);
    for(let i=0;i<7;i++){c.save();c.translate(960,panelY+315);c.rotate(.2*Math.sin(u*.4)+i*.18);c.strokeStyle=`rgba(168,215,222,${.22-i*.02})`;c.lineWidth=2;c.beginPath();c.ellipse(0,0,110+i*55+Math.sin(u+i)*14,130+i*25,0,0,Math.PI*2);c.stroke();c.restore();}
    words(c,spec.payoff,960,panelY+337,70,'#f5f8f5','Georgia','center');c.restore();
    words(c,'Video listo',395,panelY+575,37);round(c,1230,panelY+538,280,65,17,'#234e3b');words(c,'Abrir video',1370,panelY+580,28,'#fff','Segoe UI','center');
   });
  });
 });
 alpha(c,exit,()=>{brand(c,658,520,650);words(c,spec.closing,960,660,56,'#304c3d','Georgia','center');words(c,'brivany.example',960,760,31,'#607568','Segoe UI','center');});
}
function roundedBox(w,h,d,r=.1){return new RoundedBoxGeometry(w,h,d,3,Math.min(r,w*.12,h*.12,d*.12));}
function makeRoom(canvas){
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(W,H,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const scene=new THREE.Scene();scene.background=new THREE.Color('#0c1d2b');scene.fog=new THREE.Fog('#0c1d2b',17,42);
 const camera=new THREE.PerspectiveCamera(38,W/H,.1,100);camera.position.set(9,10,13);camera.lookAt(0,.5,0);
 scene.add(new THREE.HemisphereLight(0xb8d6f1,0x283d48,2));const key=new THREE.DirectionalLight(0xffe2bd,4.5);key.position.set(-3,9,6);key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-9,right:9,top:9,bottom:-9});key.shadow.normalBias=.03;scene.add(key);
 const rim=new THREE.DirectionalLight(0x62adff,3);rim.position.set(7,5,-5);scene.add(rim);
 const group=new THREE.Group();scene.add(group);const matte=color=>new THREE.MeshStandardMaterial({color,roughness:.65,metalness:.04});
 const ivory=matte('#ede9dc'),blue=matte('#709ab1'),wood=matte('#be9c73'),dark=matte('#254856'),white=matte('#f4f4ea'),leaf=matte('#577969');
 function box(parent,x,y,z,w,h,d,material){const mesh=new THREE.Mesh(roundedBox(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
 const ground=box(scene,0,-.35,0,200,.2,200,matte('#102a3b'));
 const floor=box(group,0,-.09,0,7,.18,5.8,ivory);
 const rug=box(group,0,.017,.65,3.7,.035,3.1,blue);
 const walls=[box(group,0,1.5,-2.85,7,3,.16,ivory),box(group,-3.45,1.5,0,.16,3,5.8,ivory)];
 // Window inset sits on the wall plane; camera sees a clear architectural cutaway.
 const windowGroup=new THREE.Group();group.add(windowGroup);box(windowGroup,-3.33,1.8,-.5,.06,1.6,2.35,dark);box(windowGroup,-3.28,1.8,-.5,.04,1.36,2.1,matte('#9dc4d1'));box(windowGroup,-3.22,1.8,-.5,.05,1.45,.07,ivory);
 const sofa=new THREE.Group();group.add(sofa);box(sofa,0,.44,-1.65,3.4,.6,1.1,blue);box(sofa,0,.94,-2.02,3.4,1,.3,blue);for(const x of [-1.7,1.7])box(sofa,x,.72,-1.65,.25,.8,1.2,blue);for(const x of [-1.2,0,1.2])box(sofa,x,.79,-1.55,1,.14,.87,white);
 const table=new THREE.Group();group.add(table);box(table,0,.58,.65,1.8,.12,1.25,wood);for(const x of [-.7,.7])for(const z of [.2,1.1])box(table,x,.28,z,.08,.56,.08,dark);box(table,.15,.69,.6,.45,.06,.32,white);
 const lamp=new THREE.Group();group.add(lamp);box(lamp,2.6,.05,-1.8,.6,.1,.6,dark);box(lamp,2.6,1,-1.8,.05,2,.05,wood);const shade=new THREE.Mesh(new THREE.ConeGeometry(.52,.7,48,1,true),white);shade.position.set(2.6,2,-1.8);lamp.add(shade);
 const plant=new THREE.Group();group.add(plant);const pot=new THREE.Mesh(new THREE.CylinderGeometry(.3,.23,.6,32),ivory);pot.position.set(-2.5,.3,1.7);pot.castShadow=true;plant.add(pot);
 for(let i=0;i<7;i++){const mesh=new THREE.Mesh(new THREE.SphereGeometry(.23,16,12),leaf);const a=i*2.399;mesh.position.set(-2.5+Math.cos(a)*.32,.8+(i%3)*.22,1.7+Math.sin(a)*.3);mesh.scale.set(1,1.7,.4);mesh.rotation.z=Math.sin(a)*.6;plant.add(mesh);}
 const points=[[-3.5,0,-2.9],[3.5,0,-2.9],[3.5,0,2.9],[-3.5,0,2.9],[-3.5,0,-2.9]];const positions=[];for(let i=0;i<4;i++){positions.push(...points[i],...points[i+1]);}
 const outline=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3)),new THREE.LineBasicMaterial({color:'#85c5e3',transparent:true,opacity:1}));outline.position.y=.02;group.add(outline);
 const selection=new THREE.BoxHelper(table,0x6bbcff);scene.add(selection);selection.visible=false;
 return {renderer,scene,camera,group,floor,rug,walls,windowGroup,sofa,table,lamp,plant,outline,selection};
}
function spatial(ctx,t,spec,room){
 const u=t/spec.duration*24,build=at(u,4,10),furnish=at(u,10,15),closing=at(u,20.6,22.4);
 room.floor.scale.y=Math.max(.001,at(u,1.2,4));room.rug.scale.setScalar(Math.max(.001,at(u,10,12)));
 for(const wall of room.walls){wall.scale.y=Math.max(.001,build);wall.position.y=1.5*build;}
 room.windowGroup.scale.y=Math.max(.001,build);
 for(const [i,obj] of [room.sofa,room.table,room.lamp,room.plant].entries()){const p=at(u,10+i*.7,12+i*.7);obj.scale.setScalar(Math.max(.001,p));obj.position.y=(1-p)*1.4;}
 room.outline.geometry.setDrawRange(0,Math.max(0,Math.floor(at(u,.2,3)*8)));room.outline.material.opacity=1-build*.6;
 const close=at(u,15.5,20),end=at(u,21,24);room.camera.position.set(mix(10,7.3,close)+Math.sin(u*.13)*.5, mix(12.5,5.7,close)+end*4,mix(13.5,9.5,close)+end*3);room.camera.lookAt(mix(-.5,.6,close),.7,0);
 room.group.rotation.y=mix(-.2,.18,at(u,4,17));room.selection.visible=u>17&&u<20.6;room.selection.update();room.renderer.render(room.scene,room.camera);
 ctx.clearRect(0,0,W,H);
 const intro=(1-at(u,4.1,5.1));alpha(ctx,intro,()=>{words(ctx,spec.headline,130,180,82,'#eef2ef');});
 alpha(ctx,at(u,6,7)*(1-at(u,11,12)),()=>{words(ctx,spec.payoff,130,180,78,'#eef2ef');});
 alpha(ctx,at(u,15.2,16)*(1-closing),()=>{words(ctx,'Diseño conceptual',130,180,67,'#eef2ef');});
 alpha(ctx,closing,()=>{
  ctx.fillStyle=`rgba(12,29,43,${closing*.78})`;ctx.fillRect(0,0,W,H);
  brand(ctx,658,500,650,'#f8f8f5');words(ctx,spec.closing,960,650,58,'#e4edf0','Georgia','center');words(ctx,'brivany.example',960,750,31,'#a5beca','Segoe UI','center');
 });
}
export async function mount(spec){
 const image=async source=>{const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(source);await img.decode();return img;};
 logoInk=await image(spec.logo);logoLight=await image(spec.logo.replace('#1d1d1f','#f8f8f5'));
 const canvas=document.querySelector('#motion-canvas'),webgl=document.querySelector('#motion-webgl');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d'),premium=spec.edition===2?createPremium(webgl,spec,{ink:logoInk,light:logoLight}):null,room=!premium&&spec.style==='spatial'?makeRoom(webgl):null;
 if(!room&&!premium)webgl.style.display='none';
 const state={t:0},draw=t=>premium?premium.draw(ctx,t):spec.style==='spatial'?spatial(ctx,t,spec,room):workspace(ctx,t,spec);
 const tl=gsap.timeline({paused:true});tl.to(state,{t:spec.duration,duration:spec.duration,ease:'none',onUpdate:()=>draw(state.t)},0);
 draw(0);return {tl,draw,ready:true,DURATION:spec.duration,seek(t){tl.time(Math.min(spec.duration,Math.max(0,t)),false);draw(Math.min(spec.duration,Math.max(0,t)));}};
}
