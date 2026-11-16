'use strict';
// Local DOM and real file events; native bridge and email dispatch substituted.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const out='tmp/workspace-files-ui';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const report={mode:'local_simulated_native_bridge',external_calls:0,provider_calls:0,checks:[],limitations:'DOM/file/drop policy tested with a substituted native bridge; does not certify actual Windows file dialog, file association or configured mail application.'};
 try{
  const page=await browser.newPage({viewport:{width:450,height:410}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<html><body data-surface="preview" data-motion="false"><section data-view="files"><div id="workspace-files"></div></section><section data-view="chat" hidden><textarea id="workspace-chat-input" maxlength="1200"></textarea><p id="workspace-chat-status"></p></section><button data-panel="files">Archivos</button></body></html>');
  await page.addStyleTag({path:'desktop/experience/island.css'});
  await page.addStyleTag({path:'desktop/experience/workspace-files.css'});
  await page.addStyleTag({path:'desktop/experience/workspace-phone.css'});
  await page.evaluate(()=>{
   window.__calls=[];window.__state={revision:0,items:[]};window.__particles=0;
   window.addEventListener('brivany-files-added',e=>window.__particles+=e.detail.count);
   const update=()=>structuredClone(window.__state);
   window.BrivanyIsland={expand:async view=>{window.__calls.push(['expand',view]);document.querySelector('[data-view=files]').hidden=view!=='files';document.querySelector('[data-view=chat]').hidden=view!=='chat';}};
   window.pywebview={api:{
    workspace_files_state:async()=>update(),
    workspace_files_upload:async(name,payload)=>{window.__calls.push(['upload',name,payload.length]);window.__state.items.push({id:String(++window.__state.revision),name,size:atob(payload).length,kind:name.split('.').at(-1),temporary:true});return update();},
    workspace_files_remove:async id=>{window.__calls.push(['remove',id]);window.__state.items=window.__state.items.filter(item=>item.id!==id);window.__state.revision++;return update();},
    workspace_file_draft:async id=>{window.__calls.push(['draft',id]);return {draft:'Mi pregunta sobre el documento de prueba: ',message:'Extracto preparado; revisa antes de enviar.'};},
    workspace_file_email:async id=>{window.__calls.push(['email-draft',id]);return {saved:true,opened:false,sent:false,attached:true};},
    workspace_file_open:async id=>{window.__calls.push(['open',id]);return {opened:true};},
    workspace_file_path:async id=>{window.__calls.push(['path',id]);return {path:'C:\\Temporal\\fixture.txt'};}
   }};
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.__calls.push(['clipboard',value])}});
  });
  await page.addScriptTag({path:'desktop/experience/workspace-files.js'});
  await page.locator('.shelf-picker').setInputFiles({name:'nota.txt',mimeType:'text/plain',buffer:Buffer.from('Contenido propio de prueba')});
  await page.getByText('nota.txt',{exact:true}).waitFor();
  assert.equal(await page.locator('.shelf-file').count(),1);
  assert.equal(await page.evaluate(()=>window.__particles),1);
  report.checks.push('File selection adds a bounded local document and dispatches one ingestion event.');
  await page.locator('.shelf-more summary').click();
  await page.getByRole('button',{name:'Abrir',exact:true}).click();
  await page.waitForFunction(()=>window.__calls.some(c=>c[0]==='open'));
  await page.locator('.shelf-more summary').click();await page.getByRole('button',{name:'Copiar ruta de nota.txt'}).click();
  await page.waitForFunction(()=>window.__calls.some(c=>c[0]==='clipboard'));
  await page.locator('.shelf-more summary').click();await page.getByRole('button',{name:'Correo',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Correo guardado con el adjunto.'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c[0]==='email-draft').length),1);
  report.checks.push('Open and copy operate on shelf IDs; saving an attached draft is reported separately from opening it.');
  await page.getByRole('button',{name:'Preguntar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#workspace-chat-input').value.startsWith('Mi pregunta'));
  assert.equal(await page.evaluate(()=>window.__calls.some(c=>c[0]==='send')),false);
  assert.equal(await page.locator('#workspace-chat-input').inputValue(),'Mi pregunta sobre el documento de prueba: ');
  report.checks.push('Ask prepares an editable chat draft without sending or calling a provider.');
  await page.evaluate(()=>window.BrivanyIsland.expand('files'));
  await page.evaluate(()=>{
   const data=new DataTransfer();data.items.add(new File(['test'],'<img onerror=evil>.txt',{type:'text/plain'}));
   document.dispatchEvent(new DragEvent('dragenter',{dataTransfer:data,bubbles:true,cancelable:true}));
   document.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
  });
  await page.getByText('<img onerror=evil>.txt',{exact:true}).waitFor();
  assert.equal(await page.locator('.shelf-file img').count(),0);
  assert.equal(await page.locator('body').getAttribute('data-file-dragging'),null);
  report.checks.push('Drop triggers shelf opening, clears drag state and renders names as text.');
  const before=await page.evaluate(()=>window.__calls.filter(c=>c[0]==='upload').length);
  await page.locator('.shelf-picker').setInputFiles({name:'unsafe.exe',mimeType:'application/octet-stream',buffer:Buffer.from('test')});
  await page.getByRole('status').filter({hasText:'formato no compatible'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c[0]==='upload').length),before);
  await page.locator('.shelf-picker').setInputFiles({name:'too-big.txt',mimeType:'text/plain',buffer:Buffer.alloc(8*1024*1024+1)});
  await page.getByRole('status').filter({hasText:'supera 8 MiB'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c[0]==='upload').length),before);
  await page.getByRole('button',{name:'Quitar nota.txt',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.shelf-file').length===1);
  report.checks.push('Unsupported types and oversized files are rejected before transfer; removal updates the list.');
  await page.setViewportSize({width:320,height:410});
  assert(await page.evaluate(()=>document.querySelector('.shelf-file').getBoundingClientRect().right<=innerWidth));
  await page.screenshot({path:path.join(out,'shelf-320.png')});
  assert.deepEqual(errors,[]);
  report.checks.push('Narrow 320px layout fits and no JavaScript errors occurred.');
  // Separate documents mirror native bar/panel ownership. The OS drag itself
  // is substituted, but crossing documents must not consume or duplicate bytes.
  const bar=await browser.newPage({viewport:{width:1000,height:40}});
  let barOpens=0;
  await bar.exposeFunction('__openShelf',async view=>{barOpens++;await page.evaluate(v=>window.BrivanyIsland.expand(v),view);});
  await bar.setContent('<body data-surface="bar"><div id="workspace-files"></div></body>');
  await bar.evaluate(()=>{window.pywebview={api:{workspace_files_state:async()=>({revision:0,items:[]})}};window.BrivanyIsland={expand:view=>window.__openShelf(view)};});
  await bar.addScriptTag({path:'desktop/experience/workspace-files.js'});
  await bar.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['cross document'],'cross-window.txt',{type:'text/plain'}));for(let i=0;i<3;i++)document.dispatchEvent(new DragEvent('dragenter',{dataTransfer:transfer,bubbles:true,cancelable:true}));document.dispatchEvent(new DragEvent('dragleave',{dataTransfer:transfer,bubbles:true,cancelable:true}));document.dispatchEvent(new DragEvent('dragend',{dataTransfer:transfer,bubbles:true,cancelable:true}));});
  await bar.waitForFunction(()=>document.body.dataset.fileDragging===undefined);
  assert.equal(barOpens,1);
  const beforeCross=await page.evaluate(()=>window.__calls.filter(c=>c[0]==='upload').length);
  await page.evaluate(()=>{document.body.dataset.panel='files';document.body.dataset.expanded='true';const transfer=new DataTransfer();transfer.items.add(new File(['cross document'],'cross-window.txt',{type:'text/plain'}));document.dispatchEvent(new DragEvent('dragenter',{dataTransfer:transfer,bubbles:true,cancelable:true}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));});
  await page.getByText('cross-window.txt',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c[0]==='upload').length),beforeCross+1);
  const shared=await page.evaluate(()=>window.__state);
  await bar.evaluate(next=>window.BrivanyWorkspaceFiles.receive(next),shared);
  assert.equal(await bar.locator('.shelf-file').count(),shared.items.length);
  await bar.close();
  report.checks.push('Cross-document bar-to-panel drag preserves one upload; nested dragenter causes one expansion and shared notifications update both views.');
  report.passed=true;
 }catch(error){report.passed=false;report.error=String(error.stack||error);throw error;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
 console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
