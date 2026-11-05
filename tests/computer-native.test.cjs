'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {scoped,validateStep}=require('../desktop/computer/native.cjs');
const {textScript}=require('../desktop/computer/textInput.cjs');
const win32=require('../desktop/computer/win32Text.cjs');
test('Win32 editor fallback uses observed identity and literal data',()=>{
 const text='$(no-ejecutar) {ENTER} áéñ';const script=win32.appendScript('12','win32:34',text);
 assert(script.includes(Buffer.from(text).toString('base64')));assert(!script.includes(text));assert(script.includes('IsChild'));
 assert.throws(()=>win32.appendScript('12;bad','win32:34',text));
 assert.equal(validateStep({action:'type_text',params:{handle:'12',process_id:5,control_id:'win32:34',text}}).action,'type_text');
});
test('Literal input cannot interpolate shell syntax or SendKeys commands',()=>{
 const text='$(Remove-Item x) `test` $HOME {ENTER} "quoted"';
 const script=textScript('12','1.2.3',text);
 assert(!script.includes(text));assert(script.includes(Buffer.from(text).toString('base64')));
 assert(!script.includes('Invoke-Expression'));assert(!script.includes('SendWait'));assert.throws(()=>textScript('1;bad','1.2','x'));
});
test('Only typed native actions; no code, invented control or shell entry',()=>{
 for(const step of [{action:'exec',params:{code:'x'}},{action:'launch_app',params:{app:'PowerShell'}},{action:'type_text',params:{handle:'1',process_id:1,control_id:'invented',text:'x'}},{action:'press_key',params:{handle:'1',process_id:1,key:'ctrl+enter'}},{action:'write_note',params:{name:'x.txt',text:'x',script:'x'}}])assert.throws(()=>validateStep(step));
 assert.equal(validateStep({action:'type_text',params:{handle:'12',process_id:34,control_id:'1.2.3',text:'fixture'}}).action,'type_text');
});
test('File scopes reject root modification, traversal, sibling prefixes and symlinks',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'brivany-scope-'));
 try{
  assert.equal(scoped(path.join(root,'note.txt'),[root]),path.join(root,'note.txt'));
  for(const candidate of [root,path.join(root,'..','outside.txt'),root+'-sibling/file.txt'])assert.throws(()=>scoped(candidate,[root]));
  const link=path.join(root,'redirect');fs.symlinkSync(os.tmpdir(),link,'junction');assert.throws(()=>scoped(path.join(link,'x.txt'),[root]));
 }finally{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));fs.rmSync(resolved,{recursive:true,force:true});}
});
