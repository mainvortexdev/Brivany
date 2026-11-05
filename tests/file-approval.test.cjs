'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {FileApproval}=require('../desktop/computer/fileApproval.cjs');
const {scoped,validateStep,blocked}=require('../desktop/computer/native.cjs');
const {protectFileUI}=require('../desktop/computer/fileUiPolicy.cjs');
test('generic Save, autosaving editors and self-approval cannot bypass the file gate',()=>{
 for(const label of ['Guardar','Save as','Sobrescribir','Reemplazar','Eliminar'])assert.throws(()=>protectFileUI('click_control','mspaint',{},label));
 for(const processName of ['notepad','WINWORD.EXE','excel','powerpnt']){
  assert.throws(()=>protectFileUI('type_text',processName,{text:'x'}));
  assert.throws(()=>protectFileUI('press_key',processName,{key:'enter'}));
  assert.doesNotThrow(()=>protectFileUI('press_key',processName,{key:'left'}));
 }
 assert.doesNotThrow(()=>protectFileUI('type_text','notepad',{text:'owned fixture'},'',true));
 assert.doesNotThrow(()=>protectFileUI('type_text','chrome',{text:'search'}));
 assert.throws(()=>protectFileUI('click_control','explorer',{},'Pegar'));
 assert.throws(()=>validateStep({action:'type_text',params:{handle:'1',process_id:1,control_id:'1.2',text:'x',privateOptions:{newDocument:true}}}));
 assert.throws(()=>validateStep({action:'file_action_commit',params:{ticket:'not-a-model-tool'}}));
});
function fixture(){
 const base=path.resolve(__dirname,'../tmp/access-fixtures');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'files-'));
 const source=path.join(root,'original.txt'),destination=path.join(root,'destino.txt');fs.writeFileSync(source,'contenido nuevo');
 let now=1000,calls=0;const trash=path.join(root,'trash');fs.mkdirSync(trash);
 const helper=new FileApproval({scoped,workspace:root,now:()=>now,trashItem:async file=>{calls++;fs.renameSync(file,path.join(trash,path.basename(file)));}});
 return {root,source,destination,helper,trash,get calls(){return calls;},advance:()=>now+=300001,
  close(){assert.equal(path.dirname(path.resolve(root)),base);fs.rmSync(root,{recursive:true,force:true});}};
}
test('preparation does not delete; one-use commit uses trash with no unlink fallback',async()=>{
 const f=fixture();try{const prepared=f.helper.prepare({action:'delete_file',params:{path:f.source}},[f.root]);assert(fs.existsSync(f.source));assert.equal(f.calls,0);
  const result=await f.helper.commit(prepared.ticket,[f.root]);assert.equal(result.method,'approved-os-trash');assert.equal(result.permanent_delete,false);assert.equal(f.calls,1);assert(fs.existsSync(path.join(f.trash,'original.txt')));
  await assert.rejects(f.helper.commit(prepared.ticket,[f.root]));
 }finally{f.close();}
});
test('expired, changed or redirected files are never committed',async()=>{
 for(const change of ['expire','content','symlink']){const f=fixture();try{const prepared=f.helper.prepare({action:'delete_file',params:{path:f.source}},[f.root]);
  if(change==='expire')f.advance();else if(change==='content')fs.writeFileSync(f.source,'ha cambiado');else{const folder=path.join(f.root,'sub');fs.mkdirSync(folder);const a=f.helper.prepare({action:'move_file',params:{source:f.source,destination:path.join(folder,'new.txt')}},[f.root]);fs.rmdirSync(folder);fs.symlinkSync(f.trash,folder,'junction');await assert.rejects(f.helper.commit(a.ticket,[f.root]));continue;}
  await assert.rejects(f.helper.commit(prepared.ticket,[f.root]));assert(fs.existsSync(f.source));assert.equal(f.calls,0);
 }finally{f.close();}}
});
test('replace needs an existing destination and preserves its old bytes',async()=>{
 const f=fixture();try{const step={action:'replace_file',params:{source:f.source,destination:f.destination}};
  assert.throws(()=>f.helper.prepare(step,[f.root]));fs.writeFileSync(f.destination,'versión anterior');const prepared=f.helper.prepare(step,[f.root]);
  assert.equal(fs.readFileSync(f.destination,'utf8'),'versión anterior');const result=await f.helper.commit(prepared.ticket,[f.root]);
  assert.equal(fs.readFileSync(f.destination,'utf8'),'contenido nuevo');assert.equal(fs.readFileSync(result.backup_path,'utf8'),'versión anterior');assert(fs.existsSync(f.source));
 }finally{f.close();}
});
test('move uses a new destination; changed targets and extra fields are rejected',async()=>{
 const f=fixture();try{const step={action:'move_file',params:{source:f.source,destination:f.destination}},prepared=f.helper.prepare(step,[f.root]);
  fs.writeFileSync(f.destination,'otro archivo');await assert.rejects(f.helper.commit(prepared.ticket,[f.root]));assert(fs.existsSync(f.source));
  fs.unlinkSync(f.destination);const second=f.helper.prepare(step,[f.root]);await f.helper.commit(second.ticket,[f.root]);assert(!fs.existsSync(f.source));assert.equal(fs.readFileSync(f.destination,'utf8'),'contenido nuevo');
  assert.throws(()=>f.helper.prepare({action:'delete_file',params:{path:f.destination,force:true}},[f.root]));
 }finally{f.close();}
});
test('trash failure keeps original; cancellation before commit consumes ticket',async()=>{
 const f=fixture();try{f.helper.trashItem=async()=>{throw Error('No trash available');};const step={action:'delete_file',params:{path:f.source}};
  let p=f.helper.prepare(step,[f.root]);await assert.rejects(f.helper.commit(p.ticket,[f.root]));assert(fs.existsSync(f.source));
  p=f.helper.prepare(step,[f.root]);await assert.rejects(f.helper.commit(p.ticket,[f.root],()=>{throw Error('Cancelled');}));assert(fs.existsSync(f.source));
 }finally{f.close();}
});
test('system, hard-linked, hidden, executable and outside-scope files are excluded',()=>{
 const f=fixture();try{
  for(const name of ['run.exe','.credentials.txt','system.ps1']){const file=path.join(f.root,name);fs.writeFileSync(file,'fixture');assert.throws(()=>f.helper.prepare({action:'delete_file',params:{path:file}},[f.root]));}
  const link=path.join(f.root,'link.txt');fs.linkSync(f.source,link);assert.throws(()=>f.helper.prepare({action:'delete_file',params:{path:link}},[f.root]));
  assert.throws(()=>f.helper.prepare({action:'delete_file',params:{path:f.source}},[f.trash]));
  for(const title of ['Brivany','Melodi WorkSpace','consent.exe','Regedit','User Account Control'])assert(blocked.test(title));
  assert.equal(validateStep({action:'replace_file',params:{source:'C:/owned/a.txt',destination:'C:/owned/b.txt'}}).action,'replace_file');
 }finally{f.close();}
});
