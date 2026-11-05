/**
 * Opt-in local Rapier preview. Cuboids, mass, materials and unit scale are
 * assumptions for exploration, never measurements of a reconstructed room.
 * This module owns no animation loop, network endpoint or persistence.
 */
export const PHYSICS_STEP=1/60;
export const PHYSICS_MAX_SUBSTEPS=5;
let enginePromise;

function number(value,min,max,label){
  if(typeof value!=='number' || !Number.isFinite(value) || value<min || value>max)throw Error('Valor físico inválido: '+label+'.');
  return value;
}
function vector(value,label,{min=-50,max=50}={}){
  const values=Array.isArray(value)?value:[value?.x,value?.y,value?.z];
  if(values.length!==3)throw Error('Vector inválido: '+label+'.');
  return values.map(component=>number(component,min,max,label));
}
function quaternion(value){
  if(value===undefined)return [0,0,0,1];
  const values=Array.isArray(value)?value:[value?.x,value?.y,value?.z,value?.w];
  if(values.length!==4)throw Error('Rotación física inválida.');
  values.forEach(component=>number(component,-1,1,'rotación'));
  const norm=Math.hypot(...values);
  if(Math.abs(norm-1)>.01)throw Error('La rotación necesita un quaternion unitario.');
  return values.map(component=>component/norm);
}
const xyz=value=>({x:value[0],y:value[1],z:value[2]});
const xyzw=value=>({...xyz(value),w:value[3]});
const array=value=>[value.x,value.y,value.z];

function specification(options){
  if(!options || options.mode!=='assumed_demo_units')throw Error('La física experimental necesita el modo explícito assumed_demo_units.');
  const bodies=options.bodies,environment=options.environmentBoxes ?? options.environment ?? [];
  if(!Array.isArray(bodies) || bodies.length<1 || bodies.length>32 || !Array.isArray(environment) || environment.length>64)throw Error('El sandbox admite hasta 32 cuerpos y 64 cajas de entorno.');
  const ids=new Set();
  const box=(value,dynamic)=>{
    if(!value || typeof value.id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) || ids.has(value.id))throw Error('Identificador físico inválido o repetido.');
    ids.add(value.id);
    return {id:value.id,position:vector(value.position,'posición'),rotation:quaternion(value.rotation),
      halfExtents:vector(value.halfExtents,'semiextensiones',{min:.005,max:20}),
      massKg:dynamic?number(value.massKg ?? 1,.01,10000,'masa asumida'):null,
      friction:number(value.friction ?? .6,0,2,'fricción asumida'),
      restitution:number(value.restitution ?? .05,0,1,'restitución asumida'),dynamic};
  };
  return {bodies:bodies.map(value=>box(value,true)),environment:environment.map(value=>box(value,false)),
    gravity:vector(options.gravity ?? [0,-9.81,0],'gravedad',{min:-30,max:30})};
}

async function engine(){
  enginePromise ??= import('./vendor/rapier/rapier.mjs').then(async module=>{const rapier=module.default;await rapier.init();return rapier;}).catch(error=>{enginePromise=undefined;throw error;});
  return enginePromise;
}

export class SpatialPhysics {
  static async create(options){const config=specification(options);return new SpatialPhysics(await engine(),config);}
  constructor(rapier,config){
    this.rapier=rapier;this.config=config;this.disposed=false;this.running=false;this.halted=false;
    this.haltReason=null;this.accumulator=0;this.steps=0;this.droppedSeconds=0;this.lastSubsteps=0;
    this.build();
  }
  build(){
    this.world=new this.rapier.World(xyz(this.config.gravity));this.world.timestep=PHYSICS_STEP;
    this.world.integrationParameters.numSolverIterations=8;
    this.bodies=new Map();this.colliders=new Map();this.colliderIds=new Map();
    try{
      for(const spec of [...this.config.environment,...this.config.bodies]){
        const desc=(spec.dynamic?this.rapier.RigidBodyDesc.dynamic():this.rapier.RigidBodyDesc.fixed())
          .setTranslation(...spec.position).setRotation(xyzw(spec.rotation));
        if(spec.dynamic)desc.setCanSleep(true).setCcdEnabled(true).setLinearDamping(.05).setAngularDamping(.15);
        const body=this.world.createRigidBody(desc),shape=this.rapier.ColliderDesc.cuboid(...spec.halfExtents)
          .setFriction(spec.friction).setRestitution(spec.restitution);
        if(spec.dynamic)shape.setMass(spec.massKg);
        const collider=this.world.createCollider(shape,body);
        this.colliders.set(spec.id,collider);this.colliderIds.set(collider.handle,spec.id);
        if(spec.dynamic)this.bodies.set(spec.id,body);
      }
    }catch(error){this.world.free();throw error;}
  }
  assertOpen(){if(this.disposed)throw Error('El sandbox físico ya está cerrado.');}
  body(id){this.assertOpen();const body=this.bodies.get(id);if(!body)throw Error('El cuerpo dinámico no está disponible.');return body;}
  start(){this.assertOpen();if(this.halted)throw Error('Restablece la vista previa tras salir de los límites.');this.running=true;return this.snapshot();}
  pause(){this.assertOpen();this.running=false;this.accumulator=0;this.lastSubsteps=0;return this.snapshot();}
  reset(){
    this.assertOpen();this.running=false;this.accumulator=0;this.steps=0;this.lastSubsteps=0;
    this.droppedSeconds=0;this.halted=false;this.haltReason=null;this.world.free();this.build();return this.snapshot();
  }
  impulse(id,value){
    if(this.halted)throw Error('Restablece la vista previa antes de aplicar un impulso.');
    const impulse=vector(value,'impulso',{min:-1000,max:1000});this.body(id).applyImpulse(xyz(impulse),true);return this.snapshot();
  }
  liftDrop(id,height=.75){
    number(height,.05,3,'altura de caída');if(this.halted)throw Error('Restablece la vista previa antes de elevar el objeto.');
    const body=this.body(id),position=body.translation();
    if(position.y+height>50)throw Error('La elevación sale del sandbox.');
    body.setTranslation({x:position.x,y:position.y+height,z:position.z},true);
    body.setLinvel({x:0,y:0,z:0},true);body.setAngvel({x:0,y:0,z:0},true);
    body.resetForces(true);body.resetTorques(true);return this.snapshot();
  }
  checkBounds(){
    for(const body of this.bodies.values()){
      const position=array(body.translation()),speed=array(body.linvel()),angular=array(body.angvel());
      if([...position,...speed,...angular].some(value=>!Number.isFinite(value)) || position.some(value=>Math.abs(value)>50) || position[1]<-20 || Math.hypot(...speed)>100 || Math.hypot(...angular)>100){
        this.halted=true;this.running=false;this.haltReason='out_of_bounds';this.accumulator=0;return false;
      }
    }
    return true;
  }
  step(delta){
    this.assertOpen();number(delta,0,3600,'tiempo transcurrido');this.lastSubsteps=0;
    if(!this.running || this.halted)return this.snapshot();
    const maximum=PHYSICS_STEP*PHYSICS_MAX_SUBSTEPS;
    this.droppedSeconds+=Math.max(0,delta-maximum);this.accumulator+=Math.min(delta,maximum);
    while(this.accumulator+1e-10>=PHYSICS_STEP && this.lastSubsteps<PHYSICS_MAX_SUBSTEPS){
      this.world.step();this.accumulator=Math.max(0,this.accumulator-PHYSICS_STEP);this.steps++;this.lastSubsteps++;
      if(!this.checkBounds())break;
    }
    // Never replay a tab suspension as an unbounded catch-up loop.
    if(this.accumulator>=PHYSICS_STEP){this.droppedSeconds+=this.accumulator;this.accumulator=0;}
    return this.snapshot();
  }
  contacts(){
    const result=[],seen=new Set();
    for(const id of this.bodies.keys()){
      const collider=this.colliders.get(id);
      this.world.contactPairsWith(collider,other=>{
        const otherId=this.colliderIds.get(other.handle);if(!otherId)return;
        const pair=[id,otherId].sort(),key=pair.join(':');if(seen.has(key))return;
        let touching=false;
        this.world.contactPair(collider,other,manifold=>{
          for(let i=0;i<manifold.numContacts();i++)if(manifold.contactDist(i)<=.01)touching=true;
        });
        if(touching){seen.add(key);result.push({a:pair[0],b:pair[1]});}
      });
    }
    return result;
  }
  snapshot(){
    this.assertOpen();const transforms=[];
    for(const [id,body] of this.bodies){const rotation=body.rotation();transforms.push({id,position:array(body.translation()),rotation:[rotation.x,rotation.y,rotation.z,rotation.w],sleeping:body.isSleeping(),linearVelocity:array(body.linvel())});}
    return {transforms,telemetry:{engine:'rapier3d-compat',engineVersion:'0.21.0',mode:'assumed_demo_units',
      running:this.running,halted:this.halted,haltReason:this.haltReason,steps:this.steps,substeps:this.lastSubsteps,
      fixedStepSeconds:PHYSICS_STEP,maxSubsteps:PHYSICS_MAX_SUBSTEPS,simulationSeconds:this.steps*PHYSICS_STEP,
      droppedSeconds:this.droppedSeconds,contacts:this.contacts(),sleepingBodies:transforms.filter(item=>item.sleeping).length,
      colliderApproximation:'separate_cuboids',unitsAssumed:true,massProvenance:'assumed',materialProvenance:'assumed',
      metricScaleVerified:false,physicalRealismVerified:false,persistent:false}};
  }
  dispose(){if(!this.disposed){this.running=false;this.world.free();this.bodies.clear();this.colliders.clear();this.colliderIds.clear();this.disposed=true;}}
}
