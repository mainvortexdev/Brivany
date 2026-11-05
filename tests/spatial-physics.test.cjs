const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const moduleReady=import(pathToFileURL(path.join(root,'web/spatial-physics.js')).href);
const floor={id:'floor',position:[0,-.1,0],halfExtents:[10,.1,10],friction:.8,restitution:0};
const body=(id='box',position=[0,3,0])=>({id,position,halfExtents:[.5,.5,.5],massKg:2,friction:.8,restitution:0});
async function world(options={}){
  const {SpatialPhysics}=await moduleReady;
  return SpatialPhysics.create({mode:'assumed_demo_units',bodies:[body()],environmentBoxes:[floor],...options});
}
const ticks=(physics,count,dt=1/60)=>{let state;for(let i=0;i<count;i++)state=physics.step(dt);return state;};

test('vendored exact Apache release hashes match manifest and has embedded WASM',async()=>{
  const directory=path.join(root,'web/vendor/rapier'),manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  assert.equal(manifest.version,'0.21.0');assert.equal(manifest.license,'Apache-2.0');
  assert.equal(manifest.local_change,null);
  for(const file of manifest.files){const raw=await fs.readFile(path.join(directory,file.path));assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),file.sha256);assert.equal(raw.length,file.size_bytes);}
  assert.match(await fs.readFile(path.join(directory,'LICENSE'),'utf8'),/Apache License/);
});

test('explicit assumption mode required, geometry bounds/types validated before engine',async()=>{
  const {SpatialPhysics}=await moduleReady;
  for(const options of [{bodies:[body()]},{mode:'metric_verified',bodies:[body()]},
    {mode:'assumed_demo_units',bodies:[body(),body()]},{mode:'assumed_demo_units',bodies:[{...body(),massKg:NaN}]},
    {mode:'assumed_demo_units',bodies:[{...body(),halfExtents:[0,1,1]}]},
    {mode:'assumed_demo_units',bodies:[{...body(),rotation:[0,0,0,0]}]}]){
    await assert.rejects(()=>SpatialPhysics.create(options));
  }
});

test('actual WASM free fall reaches floor, rests without penetration and reports assumptions',async t=>{
  const previous=global.fetch;global.fetch=()=>{throw Error('Unexpected runtime network');};
  let physics;try{physics=await world();}finally{global.fetch=previous;}
  t.after(()=>physics.dispose());physics.start();
  const falling=ticks(physics,15).transforms[0];assert.ok(falling.position[1]<2.9);assert.ok(falling.linearVelocity[1]<-2);
  const result=ticks(physics,600),box=result.transforms[0];
  assert.ok(Math.abs(box.position[1]-.5)<.025,`rest height ${box.position[1]}`);
  assert.equal(box.sleeping,true);assert.equal(result.telemetry.sleepingBodies,1);
  assert.ok(result.telemetry.contacts.some(pair=>pair.a==='box' && pair.b==='floor'));
  assert.equal(result.telemetry.massProvenance,'assumed');assert.equal(result.telemetry.metricScaleVerified,false);
  assert.equal(result.telemetry.physicalRealismVerified,false);assert.equal(result.telemetry.persistent,false);
});

test('paused worlds own no loop, fixed substep cap drops backlog and reset restores preview',async t=>{
  const physics=await world();t.after(()=>physics.dispose());
  assert.equal(physics.step(1).telemetry.steps,0);physics.start();
  let result=physics.step(10);assert.equal(result.telemetry.substeps,5);assert.equal(result.telemetry.steps,5);
  assert.ok(result.telemetry.droppedSeconds>9.9);physics.pause();
  const position=physics.snapshot().transforms[0].position;await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(physics.snapshot().transforms[0].position,position);assert.equal(physics.step(1).telemetry.steps,5);
  result=physics.reset();assert.equal(result.telemetry.steps,0);assert.equal(result.telemetry.running,false);
  assert.deepEqual(result.transforms[0].position,[0,3,0]);assert.deepEqual(result.transforms[0].linearVelocity,[0,0,0]);
  assert.equal(result.telemetry.droppedSeconds,0);
});

test('split render deltas accumulate into the same fixed steps',async t=>{
  const a=await world(),b=await world();t.after(()=>{a.dispose();b.dispose();});a.start();b.start();
  ticks(a,60,1/60);ticks(b,120,1/120);
  assert.equal(a.snapshot().telemetry.steps,60);assert.equal(b.snapshot().telemetry.steps,60);
  assert.deepEqual(a.snapshot().transforms[0].position,b.snapshot().transforms[0].position);
});

test('impulse wakes sleeper, liftDrop clears velocity, invalid deltas cannot advance',async t=>{
  const physics=await world({bodies:[body('box',[0,.5,0])]});t.after(()=>physics.dispose());physics.start();
  ticks(physics,600);assert.equal(physics.snapshot().transforms[0].sleeping,true);
  physics.impulse('box',[4,1,0]);assert.equal(physics.snapshot().transforms[0].sleeping,false);
  const moved=ticks(physics,10).transforms[0];assert.ok(moved.position[0]>.1);
  physics.liftDrop('box',1);assert.deepEqual(physics.snapshot().transforms[0].linearVelocity,[0,0,0]);
  for(const dt of [-1,NaN,Infinity,'1'])assert.throws(()=>physics.step(dt));
  assert.throws(()=>physics.impulse('floor',[0,1,0]));assert.throws(()=>physics.impulse('box',[Infinity,0,0]));
});

test('two dynamic boxes transfer collision motion and solid wall stops escape',async t=>{
  const wall={id:'wall',position:[3,1,0],halfExtents:[.1,2,3],friction:0,restitution:0};
  const physics=await world({bodies:[body('a',[-1,.5,0]),body('b',[.5,.5,0])],environmentBoxes:[floor,wall]});
  t.after(()=>physics.dispose());physics.start();physics.impulse('a',[16,0,0]);let contacted=false;
  for(let i=0;i<240;i++){const result=physics.step(1/60);contacted ||=result.telemetry.contacts.some(pair=>pair.a==='a' && pair.b==='b');}
  const result=physics.snapshot();assert.ok(contacted);assert.ok(result.transforms.find(item=>item.id==='b').position[0]>.7);
  for(const item of result.transforms){assert.ok(item.position[0]<2.45);assert.ok(item.position[1]>.45);}
});

test('escape halts bounded sandbox and requires reset; disposal releases world',async()=>{
  const physics=await world({bodies:[body('box',[49,1,0])],environmentBoxes:[],gravity:[0,0,0]});
  physics.start();physics.impulse('box',[100,0,0]);const result=ticks(physics,20);
  assert.equal(result.telemetry.halted,true);assert.equal(result.telemetry.running,false);assert.equal(result.telemetry.haltReason,'out_of_bounds');
  const count=result.telemetry.steps;assert.equal(physics.step(1).telemetry.steps,count);assert.throws(()=>physics.start());
  assert.equal(physics.reset().telemetry.halted,false);physics.dispose();physics.dispose();assert.throws(()=>physics.snapshot());
});
