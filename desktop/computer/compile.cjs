/* Reuse Cognira's architectural compiler; export native GLB primitives for Brivany. */
'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url');
async function compile(input,source){
 const scene=require(path.join(source,'electron/services/spatialService.cjs')).validateScene(input);
 if(scene.objects.length>100)throw Error('El visor admite hasta cien objetos; simplifica el proyecto.');
 const THREE=await import(pathToFileURL(path.join(source,'node_modules/three/build/three.module.js')).href);
 const assets=[];
 for(const object of scene.objects){
  if([...object.position,...object.size].some(v=>Math.abs(v)>100))throw Error('Modelo fuera del límite de 100 unidades.');
  let geometry;
  switch(object.type){
   case 'box':geometry=new THREE.BoxGeometry(1,1,1);break;
   case 'sphere':geometry=new THREE.SphereGeometry(.5,20,12);break;
   case 'cylinder':geometry=new THREE.CylinderGeometry(.5,.5,1,20);break;
   case 'cone':geometry=new THREE.ConeGeometry(.5,1,20);break;
   case 'torus':geometry=new THREE.TorusGeometry(.35,.15,12,24);break;
   case 'mesh':geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(object.vertices,3));geometry.setIndex(object.indices);geometry.computeBoundingBox();const center=geometry.boundingBox.getCenter(new THREE.Vector3()),size=geometry.boundingBox.getSize(new THREE.Vector3());geometry.translate(-center.x,-center.y,-center.z);geometry.scale(size.x?1/size.x:1,size.y?1/size.y:1,size.z?1/size.z:1);geometry.computeVertexNormals();break;
   default:throw Error('Geometría no admitida');
  }
  const buffers=[],views=[],accessors=[];let length=0;
  const add=(typed,target,type,componentType)=>{
   const data=Buffer.from(typed.buffer,typed.byteOffset,typed.byteLength),padding=Buffer.alloc((4-length%4)%4);buffers.push(padding);length+=padding.length;
   views.push({buffer:0,byteOffset:length,byteLength:data.length,target});buffers.push(data);length+=data.length;
   const count=typed.length/(type==='VEC3'?3:1),accessor={bufferView:views.length-1,componentType,count,type};
   if(type==='VEC3'){accessor.min=[Infinity,Infinity,Infinity];accessor.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<typed.length;i++){const axis=i%3;accessor.min[axis]=Math.min(accessor.min[axis],typed[i]);accessor.max[axis]=Math.max(accessor.max[axis],typed[i]);}}
   accessors.push(accessor);return accessors.length-1;
  };
  const positions=add(geometry.attributes.position.array,34962,'VEC3',5126),normals=add(geometry.attributes.normal.array,34962,'VEC3',5126);
  const idx=geometry.index?new Uint16Array(geometry.index.array):new Uint16Array(Array.from({length:geometry.attributes.position.count},(_,i)=>i));
  const indices=add(idx,34963,'SCALAR',5123),color=new THREE.Color(object.color);
  const doc={asset:{version:'2.0',generator:'Brivany · Cognira architectural adapter'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:positions,NORMAL:normals},indices,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[color.r,color.g,color.b,1],metallicFactor:0,roughnessFactor:.8}}],buffers:[{byteLength:length}],bufferViews:views,accessors};
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const binary=Buffer.concat([...buffers,Buffer.alloc((4-length%4)%4)]);
  const header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);jh.writeUInt32LE(json.length);jh.write('JSON',4);bh.writeUInt32LE(binary.length);bh.write('BIN\0',4);
  assets.push({id:object.id,base64:Buffer.concat([header,jh,json,bh,binary]).toString('base64'),rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)).toArray()});geometry.dispose();
 }
 return {scene,assets};
}
module.exports={compile};
if(require.main===module){let raw='';process.stdin.on('data',chunk=>{raw+=chunk;if(raw.length>500000)process.exit(2);});process.stdin.on('end',()=>compile(JSON.parse(raw),path.resolve(process.argv[2])).then(value=>process.stdout.write(JSON.stringify(value))).catch(()=>{process.stderr.write('Modelo inválido; no se publicó ningún espacio.');process.exitCode=2;}));}
