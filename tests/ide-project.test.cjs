'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {readConfiguration}=require('../desktop/computer/ideProject.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'melodi-ide-test-')));
 t.after(()=>{assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.match(path.basename(root),/^melodi-ide-test-/);fs.rmSync(root,{recursive:true,force:true});});
 const work=path.join(root,'work'),site=path.join(root,'python-env',process.platform==='win32'?'Lib/site-packages':'lib/site-packages'),python=path.join(root,'python.exe');
 const folder=path.join(root,'ide','00000000-0000-4000-8000-000000000000');
 fs.mkdirSync(work);fs.mkdirSync(site,{recursive:true});fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(python,'owned fixture, never executed');
 const runner=fs.realpathSync(path.resolve(__dirname,'../services/terminal/preview_server.py'));
 const value={id:'00000000-0000-4000-8000-000000000000',work,site_packages:site,site_relative:'lib/site-packages',port:53541,python,python_sha256:sha(fs.readFileSync(python)),runner,runner_sha256:sha(fs.readFileSync(runner))};
 const file=path.join(folder,'preview.json');const write=()=>{const raw=Buffer.from(JSON.stringify(value));fs.writeFileSync(file,raw);return sha(raw);};
 return {root,work,file,value,write,hash:write()};
}
test('sealed local project configuration is accepted without executing it',t=>{const f=fixture(t);assert.equal(readConfiguration(f.file,f.hash).work,f.work);});
test('changed configuration and invalid seals are rejected',t=>{const f=fixture(t);fs.appendFileSync(f.file,' ');assert.throws(()=>readConfiguration(f.file,f.hash),/changed/);assert.throws(()=>readConfiguration(f.file,'bad'),/seal/);});
test('another working copy, interpreter or adapter cannot replace the observed inputs',t=>{
 const f=fixture(t),original={...f.value};
 f.value.work=f.root;assert.throws(()=>readConfiguration(f.file,f.write()),/project path/);Object.assign(f.value,original);
 f.value.python_sha256='0'.repeat(64);assert.throws(()=>readConfiguration(f.file,f.write()),/interpreter/);Object.assign(f.value,original);
 f.value.runner_sha256='0'.repeat(64);assert.throws(()=>readConfiguration(f.file,f.write()),/adapter changed/);
});
test('preview must use a nonprivileged explicit port',t=>{const f=fixture(t);for(const port of [80,65536,1.2,'53541']){f.value.port=port;assert.throws(()=>readConfiguration(f.file,f.write()),/identity/);}});
