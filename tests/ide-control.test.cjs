'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {workspaceRun,runObservedEditor}=require('../desktop/computer/ideControl.cjs');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'melodi-ide-control-')));
 t.after(()=>{assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.match(path.basename(root),/^melodi-ide-control-/);fs.rmSync(root,{recursive:true,force:true});});
 const work=path.join(root,'work'),site=path.join(root,'python-env',process.platform==='win32'?'Lib/site-packages':'lib/site-packages'),folder=path.join(root,'ide','00000000-0000-4000-8000-000000000000');
 fs.mkdirSync(work);fs.mkdirSync(site,{recursive:true});fs.mkdirSync(folder,{recursive:true});
 const python=path.join(root,'python.exe'),node=path.join(root,'node.exe'),editor=path.join(root,'Antigravity IDE.exe');for(const file of [python,node,editor])fs.writeFileSync(file,'owned fixture; never executed');
 const runner=fs.realpathSync(path.resolve(__dirname,'../services/terminal/preview_server.py')),program=fs.realpathSync(path.resolve(__dirname,'../desktop/computer/ideProject.cjs'));
 const config={id:'00000000-0000-4000-8000-000000000000',work,site_packages:site,site_relative:'lib/site-packages',port:53541,python,python_sha256:sha(python),runner,runner_sha256:sha(runner),node,node_sha256:sha(node),bridge_sha256:sha(program)};
 const file=path.join(folder,'preview.json');fs.writeFileSync(file,JSON.stringify(config));const name='Melodi · ProjectFixture · 00000000';
 const value={folders:[{path:work}],launch:{version:'0.2.0',configurations:[{name,type:'node',request:'launch',runtimeExecutable:node,program,args:[file,sha(file)],cwd:work,console:'internalConsole',outputCapture:'std',skipFiles:['<node_internals>/**']}]}};
 const workspace=path.join(folder,'Melodi-ProjectFixture-00000000.code-workspace');const write=()=>fs.writeFileSync(workspace,JSON.stringify(value));write();
 const scoped=p=>{assert.ok(path.resolve(p).startsWith(root+path.sep));return p;};const keys=[];
 let observed={selected:name+' (workspace)',start_available:true,protected:false};
 const automation={run:async script=>script.includes('RootElement.FindAll')?JSON.stringify([{handle:'123',process_id:42,path:editor,title:'Melodi-ProjectFixture-00000000 (Workspace) - Antigravity IDE'}]):script.includes('$selected=')?JSON.stringify(observed):'READY',guardedHotkey:async(handle,pressed)=>keys.push(pressed)};
 const options={workspace,editorPath:editor,scoped,roots:[root],automation,fetchHealth:async()=>{if(!observed.running&&!keys.some(keys=>keys.includes('f5')))throw Error('not started');return {ok:true,headers:new Map([['x-melodi-run',config.id]]),json:async()=>({status:'healthy'})};},timeout:500,healthTimeout:500};
 return {root,config,value,write,workspace,scoped,keys,options,observed};
}
test('starts only the observed sealed configuration and checks its bound health',async t=>{const f=fixture(t);const result=await runObservedEditor(f.options);assert.equal(result.execution_in_ide_verified,true);assert.deepEqual(f.keys,[['ctrl','shift','d'],['f5']]);});
test('workspace cannot add environment injection, tasks or another runtime',t=>{const f=fixture(t);const launch=f.value.launch.configurations[0];launch.env={NODE_OPTIONS:'untrusted'};f.write();assert.throws(()=>workspaceRun(f.workspace,f.scoped,[f.root]),/opciones/);delete launch.env;launch.runtimeExecutable=f.config.python;f.write();assert.throws(()=>workspaceRun(f.workspace,f.scoped,[f.root]),/ejecutor/);});
test('a local working copy cannot be replaced by a remote folder URI',t=>{const f=fixture(t);f.value.folders[0].uri='vscode-remote://unrequested';f.write();assert.throws(()=>workspaceRun(f.workspace,f.scoped,[f.root]),/proyecto/);});
test('permissions and a different selected configuration are never accepted',async t=>{
 const f=fixture(t);f.observed.protected=true;await assert.rejects(runObservedEditor(f.options),/intervención/);assert.deepEqual(f.keys,[['ctrl','shift','d']]);
 f.keys.length=0;f.observed.protected=false;f.observed.selected='Another task';await assert.rejects(runObservedEditor(f.options),/otra ejecución/);assert.deepEqual(f.keys,[['ctrl','shift','d']]);
});
test('an unrelated HTTP response cannot certify execution or trigger another F5',async t=>{const f=fixture(t);f.options.healthTimeout=50;f.options.waitFor=()=>new Promise(r=>setTimeout(r,10));f.options.fetchHealth=async()=>({ok:true,headers:new Map([['x-melodi-run','other']]),json:async()=>({status:'healthy'})});await assert.rejects(runObservedEditor(f.options),/saludable/);assert.equal(f.keys.filter(keys=>keys.includes('f5')).length,1);});
test('an observed running session is awaited without sending F5 again',async t=>{const f=fixture(t);f.observed.running=true;f.observed.start_available=false;const result=await runObservedEditor(f.options);assert.equal(result.already_running,true);assert.deepEqual(f.keys,[['ctrl','shift','d']]);});
test('a ready URL without the IDE session does not permit a duplicate start',async t=>{const f=fixture(t);f.options.fetchHealth=async()=>({ok:true,headers:new Map([['x-melodi-run',f.config.id]]),json:async()=>({status:'healthy'})});await assert.rejects(runObservedEditor(f.options),/no se enviará otro F5/);assert.deepEqual(f.keys,[['ctrl','shift','d']]);});
