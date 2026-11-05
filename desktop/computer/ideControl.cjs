/* Only starts the sealed, observed debug configuration; never types a command. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const {readConfiguration}=require('./ideProject.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const literal=text=>"'"+text.replace(/'/g,"''")+"'";
function workspaceRun(workspace,scoped,roots){
 workspace=scoped(workspace,roots);if(!/^Melodi-ProjectFixture-[a-f0-9]{8}\.code-workspace$/.test(path.basename(workspace)))throw Error('Workspace de Melodi inválido.');
 const value=JSON.parse(fs.readFileSync(workspace,'utf8')),items=value.launch?.configurations;
 if(Object.keys(value).some(key=>!['folders','launch'].includes(key))||Object.keys(value.launch||{}).some(key=>!['version','configurations'].includes(key)))throw Error('El workspace contiene opciones ajenas al ensayo.');
 if(!Array.isArray(items)||items.length!==1)throw Error('Se necesita una configuración única.');
 const launch=items[0];
 if(Object.keys(launch).some(key=>!['name','type','request','runtimeExecutable','program','args','cwd','console','outputCapture','skipFiles'].includes(key)))throw Error('La configuración contiene opciones ajenas al ensayo.');
 if(launch.type!=='node'||launch.request!=='launch'||launch.console!=='internalConsole'||path.resolve(launch.program)!==path.resolve(__dirname,'ideProject.cjs')||!Array.isArray(launch.args)||launch.args.length!==2||launch.preLaunchTask||value.tasks)throw Error('Sólo se admite la vista local preparada.');
 const config=readConfiguration(...launch.args);
 if(!config.node||fs.realpathSync(launch.runtimeExecutable)!==config.node||sha(config.node)!==config.node_sha256||sha(launch.program)!==config.bridge_sha256||launch.cwd!==config.work||launch.outputCapture!=='std')throw Error('El ejecutor del IDE cambió.');
 if(value.folders?.length!==1||Object.keys(value.folders[0]).some(key=>!['path','name'].includes(key))||value.folders[0].path!==config.work||launch.name!=='Melodi · ProjectFixture · '+config.id.slice(0,8))throw Error('La configuración no coincide con su proyecto.');
 return {workspace,title:path.basename(workspace,'.code-workspace'),name:launch.name,config};
}
function listScript(title){return `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
$nodes=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
$items=New-Object System.Collections.Generic.List[object]
foreach($node in $nodes){try{$c=$node.Current;if(!$c.IsEnabled -or $c.IsOffscreen -or !$c.Name.Contains(${literal(title)})){continue};$p=[System.Diagnostics.Process]::GetProcessById($c.ProcessId);$items.Add(@{handle=([long]$c.NativeWindowHandle).ToString();process_id=$p.Id;path=$p.MainModule.FileName;title=$c.Name})}catch{}}
ConvertTo-Json -InputObject @($items.ToArray()) -Compress`;
}
function stateScript(handle,configuration=''){
 if(!/^\d+$/.test(handle))throw Error('Ventana inválida.');
 return `${require('./windowGuard.cjs').windowGuardScript(handle)}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
if([CogniraInput]::GetForegroundWindow().ToInt64().ToString() -ne '${handle}'){throw 'EDITOR_FOCUS_CHANGED'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new(${handle}))
$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$selected='';$start=$false;$protected=$false;$running=$false;$owner=0
foreach($n in $nodes){try{$c=$n.Current;if($c.IsOffscreen -or !$c.IsEnabled){continue};$role=$c.ControlType.ProgrammaticName;$name=[string]$c.Name
if($role -match '(Button|MenuItem)$' -and $name -match '(?i)trust|conf[ií]a|password|contrase[nñ]a|permission|permiso|security|seguridad|sign in|iniciar sesi[oó]n'){$protected=$true}
if($role -eq 'ControlType.Button' -and $name -match '^(Start Debugging|Iniciar depuraci[oó]n)'){$start=$true}
if($role -match '(DataItem|TreeItem)$' -and $name.StartsWith('Session ideProject.cjs') -and $name.Contains(${literal(configuration)}) -and $name -match '\\bRunning\\b|En ejecuci[oó]n'){$running=$true;if($name -match '\\[(\\d+)\\]'){$owner=[int]$Matches[1]}}
if($role -eq 'ControlType.ComboBox' -and $name -match 'Debug Launch Configurations|Configuraciones.*depur'){$pattern=$null;if($n.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$selected=[string]$pattern.Current.Value}else{$selection=$null;if($n.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern,[ref]$selection)){$values=$selection.Current.GetSelection();if($values.Length -eq 1){$selected=[string]$values[0].Current.Name}}}}
}catch{}}
ConvertTo-Json -InputObject @{selected=$selected;start_available=$start;protected=$protected;running=$running;owner_pid=$owner} -Compress`;
}
async function runObservedEditor({workspace,editorPath,scoped,roots,automation,assertActive=()=>{},waitFor=wait,fetchHealth=fetch,timeout=60000,healthTimeout=180000,onStage=()=>{}}){
 const run=workspaceRun(workspace,scoped,roots),binary=fs.realpathSync(editorPath);
 if(!/^(?:Code|Cursor|Antigravity IDE|Antigravity)\.exe$/i.test(path.basename(binary)))throw Error('Editor no admitido.');
 const deadline=Date.now()+timeout;let window;
 while(Date.now()<deadline){assertActive();const candidates=JSON.parse(await automation.run(listScript(run.title),10000)).filter(w=>path.resolve(w.path).toLowerCase()===binary.toLowerCase());if(candidates.length>1)throw Error('Workspace ambiguo.');if(candidates.length===1){window=candidates[0];break;}await waitFor(200);}
 if(!window||!/^\d+$/.test(window.handle)||!Number.isInteger(window.process_id))throw Error('No se observó el workspace preparado.');
 onStage('ide_window');
 const focus=async()=>{assertActive();const result=await automation.run(`${require('./windowGuard.cjs').windowGuardScript(window.handle)}\nif(-not [CogniraInput]::FocusOwnedWindow([long]${window.handle},[uint32]${window.process_id})){throw 'EDITOR_FOCUS_CHANGED'}`,10000);return result;};
 await focus();await automation.guardedHotkey(window.handle,['ctrl','shift','d']);
 let observed;
 while(Date.now()<deadline){assertActive();observed=JSON.parse((await automation.run(stateScript(window.handle,run.name),10000)).trim().split(/\r?\n/).at(-1));if(observed.protected)throw Error('El editor requiere intervención; no se aceptarán permisos.');const matches=observed.selected===run.name||observed.selected.startsWith(run.name+' (');if(observed.selected&&!matches)throw Error('La configuración seleccionada pertenece a otra ejecución.');if((observed.start_available||observed.running)&&matches)break;await waitFor(200);}
 if(!(observed?.start_available||observed?.running)||!(observed.selected===run.name||observed.selected.startsWith(run.name+' (')))throw Error('No se observó la configuración de ejecución correcta.');
 onStage('ide_configuration');const alreadyRunning=!!observed.running;
 const healthy=async()=>{try{const response=await fetchHealth('http://127.0.0.1:'+run.config.port+'/api/health',{redirect:'error',signal:AbortSignal.timeout(1500)});return response.ok&&response.headers.get('x-melodi-run')===run.config.id&&(await response.json()).status==='healthy';}catch{return false;}};
 if(await healthy()&&!alreadyRunning)throw Error('La URL ya está activa pero no se observó su sesión en el IDE; no se enviará otro F5.');
 if(!alreadyRunning){assertActive();await automation.guardedHotkey(window.handle,['f5']);}
 onStage('ide_waiting');const healthDeadline=Date.now()+healthTimeout;
 while(Date.now()<healthDeadline){assertActive();if(await healthy()){onStage('ide_ready');return {verified:true,project_open_verified:true,execution_in_ide_verified:true,already_running:alreadyRunning,window:{handle:window.handle,process_id:window.process_id,title:window.title},configuration:run.name,url:'http://127.0.0.1:'+run.config.port,method:'observed-IDE-debugger-and-bound-health',mouse_captured:false,financial_actions_enabled:false};}await waitFor(200);}
 throw Error('El depurador no confirmó un servidor saludable; la tarea no se da por terminada.');
}
module.exports={workspaceRun,runObservedEditor,listScript,stateScript};
