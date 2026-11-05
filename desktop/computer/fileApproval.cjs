/* Personal files only. A prepared ticket is not consent; commit is bridge-only. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const permitted=/\.(txt|md|csv|pdf|docx|pptx|xlsx|png|jpe?g|webp|wav|mp3|m4a|mp4|mov|mkv|webm|glb)$/i;
const MAX=128*1024*1024;
function personal(file){
 const denied=[process.env.SystemRoot,process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.ProgramData,process.env.APPDATA,process.env.LOCALAPPDATA].filter(Boolean);
 if(file.split(/[\\/]/).some(part=>part.startsWith('.')&&part!=='.local')||denied.some(root=>{const relative=path.relative(path.resolve(root),file);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}))throw Error('La operación sólo admite documentos personales fuera de carpetas del sistema y configuración.');
}
function fingerprint(candidate,scoped,roots){
 const file=scoped(candidate,roots),s=fs.lstatSync(file);
 personal(file);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>MAX||!permitted.test(file)||path.basename(file).startsWith('.'))throw Error('Selecciona un archivo personal regular de hasta 128 MiB.');
 return {path:file,size:s.size,ino:s.ino,dev:s.dev,mtime:s.mtimeMs,ctime:s.ctimeMs,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
}
function inspect(step,scoped,roots){
 if(!step||!['move_file','delete_file','replace_file'].includes(step.action)||!step.params||Object.keys(step).sort().join(',')!=='action,params')throw Error('Operación de archivos inválida.');
 const p=step.params,keys=step.action==='delete_file'?['path']:['source','destination'];
 if(Object.keys(p).sort().join(',')!==keys.sort().join(','))throw Error('Parámetros de archivo inválidos.');
 const source=fingerprint(p.path||p.source,scoped,roots),destination=step.action==='delete_file'?null:scoped(p.destination,roots);
 if(destination===source.path)throw Error('El origen y el destino coinciden.');
 if(destination){personal(destination);if(!fs.statSync(path.dirname(destination)).isDirectory()||!permitted.test(destination)||path.basename(destination).startsWith('.'))throw Error('Destino personal inválido.');}
 let previous=null;
 if(step.action==='replace_file')previous=fingerprint(destination,scoped,roots);
 else if(destination&&fs.existsSync(destination))throw Error('El destino ya existe. Sobrescribir requiere otra aprobación.');
 return {action:step.action,source,destination,previous};
}
class FileApproval {
 constructor({scoped,workspace,trashItem,now=()=>Date.now()}){Object.assign(this,{scoped,workspace,trashItem,now});this.pending=new Map();}
 prepare(step,roots){
  for(const [key,item] of this.pending)if(item.expires<this.now())this.pending.delete(key);
  if(this.pending.size>=30)throw Error('Hay demasiadas aprobaciones pendientes.');
  const snapshot=inspect(step,this.scoped,roots),ticket=crypto.randomUUID();
  this.pending.set(ticket,{step:structuredClone(step),snapshot,expires:this.now()+300000});
  return {ticket,expires_in:300,summary:{action:snapshot.action,source:snapshot.source.path,destination:snapshot.destination,size:snapshot.source.size,sha256:snapshot.source.sha256,destination_sha256:snapshot.previous?.sha256||null}};
 }
 revoke(ticket){this.pending.delete(ticket);}
 async commit(ticket,roots,assertActive=()=>{}){
  const item=this.pending.get(ticket);this.pending.delete(ticket);
  if(!item||item.expires<this.now())throw Error('La aprobación caducó o ya se utilizó.');
  const fresh=inspect(item.step,this.scoped,roots);
  if(JSON.stringify(fresh)!==JSON.stringify(item.snapshot))throw Error('El archivo cambió. Revisa una nueva aprobación.');
  assertActive();const {source,destination,action}=fresh;
  if(action==='delete_file'){
   // Electron fails if it cannot put the file in the OS trash. No unlink fallback.
   await this.trashItem(source.path);
   if(fs.existsSync(source.path))throw Error('No se confirmó el traslado a la papelera.');
   return {verified:true,path:source.path,method:'approved-os-trash',permanent_delete:false};
  }
  if(action==='move_file'){
   fs.copyFileSync(source.path,destination,fs.constants.COPYFILE_EXCL);
   const copied=fingerprint(destination,this.scoped,roots);
   if(copied.sha256!==source.sha256||JSON.stringify(fingerprint(source.path,this.scoped,roots))!==JSON.stringify(source))throw Error('El origen cambió. Se conservan ambos archivos.');
   assertActive();fs.unlinkSync(source.path);
   return {verified:true,destination,method:'approved-hash-checked-move'};
  }
  // Preserve the old version before replacing. No recursively writable folders,
  // scripts, executables, links or system configuration are accepted here.
  const versions=this.scoped(path.join(this.workspace,'file-versions'),[this.workspace]);
  if(fs.existsSync(versions)&&!fs.lstatSync(versions).isDirectory())throw Error('La carpeta de versiones no está disponible.');
  fs.mkdirSync(versions,{recursive:true});
  const backup=this.scoped(path.join(versions,crypto.randomUUID()+path.extname(destination)),[this.workspace]);
  fs.copyFileSync(destination,backup,fs.constants.COPYFILE_EXCL);
  if(crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex')!==fresh.previous.sha256)throw Error('La copia de recuperación no coincide.');
  // Re-check after making the backup, before any destination content is changed.
  if(JSON.stringify(inspect(item.step,this.scoped,roots))!==JSON.stringify(fresh))throw Error('El archivo cambió. No se sobrescribió.');
  assertActive();
  const data=fs.readFileSync(source.path),fd=fs.openSync(destination,'r+');
  try{
   const current=fs.fstatSync(fd);
   if(current.ino!==fresh.previous.ino||current.dev!==fresh.previous.dev||current.size!==fresh.previous.size||current.mtimeMs!==fresh.previous.mtime)throw Error('El destino cambió.');
   if(crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex')!==fresh.previous.sha256)throw Error('El contenido del destino cambió.');
   let offset=0;while(offset<data.length)offset+=fs.writeSync(fd,data,offset,data.length-offset,offset);
   fs.ftruncateSync(fd,data.length);fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  if(fingerprint(destination,this.scoped,roots).sha256!==source.sha256)throw Error('El resultado no coincide; conserva la versión de recuperación.');
  return {verified:true,destination,backup_path:backup,method:'approved-replace-with-backup'};
 }
}
module.exports={FileApproval,inspect};
