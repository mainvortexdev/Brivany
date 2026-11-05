/* Owned project browser and an observed, new Notepad document. No shell input. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function normalized(text){return text.replace(/^\ufeff/,'').replace(/\r\n/g,'\n');}
async function captureProject({BrowserWindow,screen,url,destination,proof,scoped,roots}){
 const parsed=new URL(url);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/'||parsed.search||parsed.hash||!/^\d+$/.test(parsed.port))throw Error('Sólo se admite el servidor local verificado.');
 if(!/^[0-9a-f-]{36}$/.test(proof))throw Error('Recibo de servidor inválido.');
 const response=await fetch(new URL('/api/health',url),{redirect:'error'});if(!response.ok||response.headers.get('x-melodi-run')!==proof)throw Error('El servidor no coincide con el proceso autorizado.');
 destination=scoped(destination,roots);if(path.extname(destination).toLowerCase()!=='.png'||fs.existsSync(destination))throw Error('La captura requiere un PNG nuevo.');
 const area=screen.getPrimaryDisplay().workArea;
 const window=new BrowserWindow({title:'Melodi · Proyecto local',width:Math.min(1160,area.width-32),height:Math.min(780,area.height-32),x:area.x+16,y:area.y+16,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'melodi-project-'+crypto.randomUUID()}});
 window.setMenuBarVisibility(false);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,target)=>{if(new URL(target).origin!==parsed.origin)event.preventDefault();});
 await window.loadURL(parsed.href);await window.webContents.executeJavaScript('document.fonts.ready.then(()=>document.title)');
 const title=await window.webContents.getTitle();if(!title.trim())throw Error('La web no tiene título.');
 const image=await window.webContents.capturePage(),size=image.getSize();if(size.width<320||size.height<240)throw Error('La captura no tiene dimensiones suficientes.');
 const bytes=image.toPNG();if(bytes.length<5000)throw Error('No se confirmó una captura con contenido.');fs.writeFileSync(destination,bytes,{flag:'wx'});
 return {verified:true,path:destination,title,url:parsed.href,width:size.width,height:size.height,window_open:true,method:'isolated-local-browser-capture'};
}
async function writeNotepad({destination,text,scoped,roots,automation,system,observe,execute,target}){
 destination=scoped(destination,roots);if(path.extname(destination).toLowerCase()!=='.txt'||fs.existsSync(destination)||typeof text!=='string'||text.length>24000)throw Error('Las notas requieren un TXT nuevo.');
 fs.writeFileSync(destination,Buffer.from([0xef,0xbb,0xbf]),{flag:'wx'});
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','notepad.exe');
 require('node:child_process').spawn(executable,[destination],{stdio:'ignore',detached:false});
 let note;const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  const matches=(await system.listWindows()).filter(w=>/^notepad$/i.test(w.processName||'')&&String(w.title).toLowerCase().includes(path.basename(destination).toLowerCase().replace(/\.txt$/,'')));
  if(matches.length===1){note=matches[0];break;}await wait(200);
 }
 if(!note)throw Error('No se identificó el Bloc de notas de este archivo.');
 const identity={handle:String(note.handle),process_id:note.processId};await target(identity);
 const observation=await observe(),fields=observation.controls.filter(c=>/\.(Edit|Document)$/.test(c.role));if(fields.length!==1)throw Error('No se identificó un campo único del Bloc de notas.');
 const typed=await execute({action:'type_text',params:{...identity,control_id:fields[0].id,text}});
 await target(identity);
 // Classic localized Notepad may use Ctrl+G instead of Ctrl+S. Resolve Save
 // from the observed menu rather than assuming a keyboard layout/language.
 let current=await observe();
 const fileMenu=current.controls.find(c=>/\.MenuItem$/.test(c.role)&&/^(?:archivo|file)$/i.test(c.name.replace(/&/g,'')));
 if(fileMenu){
  await execute({action:'click_control',params:{...identity,control_id:fileMenu.id}});
  current=await observe();
  const save=current.controls.find(c=>/\.MenuItem$/.test(c.role)&&/^(?:guardar|save)(?:\s+(?:ctrl|control).*)?$/i.test(c.name.replace(/&/g,'').trim()));
  if(!save)throw Error('No se identificó Guardar en el menú observado: '+current.controls.filter(c=>/\.MenuItem$/.test(c.role)).map(c=>c.name).join(',').slice(0,400));
  // The open menu is transient; avoid refocusing the owner between observing
  // and invoking its Save item, which would dismiss the menu.
  await automation.clickObservedControl({windowHandle:identity.handle,id:save.id,point:save.point});
 }else{
  const menu=require('./notepadSave.cjs');
  const saves=JSON.parse(await automation.run(menu.observeScript(identity.handle),8000));
  if(saves.length!==1||!saves[0].enabled)throw Error('No se identificó un menú Guardar habilitado en Bloc de notas.');
  await target(identity);await automation.run(menu.saveScript(identity.handle,saves[0].id),8000);
 }
 let saved='';for(let i=0;i<40;i++){saved=fs.readFileSync(destination,'utf8');if(normalized(saved)===normalized(text))break;await wait(100);}
 if(normalized(saved)!==normalized(text))throw Error('El archivo guardado no coincide con el texto solicitado (bytes='+Buffer.byteLength(saved)+', entrada_verificada='+typed.text_value_verified+').');
 return {verified:true,path:destination,method:'observed-notepad-edit-save-menu',input_verified:typed.text_value_verified===true,file_content_verified:true};
}
module.exports={captureProject,writeNotepad};
