/* Reuse the existing synthetic live suite against the actual desktop frame. */
const fs=require('node:fs');
let source=fs.readFileSync('tools/check_live_ui.cjs','utf8');
const entry="    await page.goto(base+'/app');";
if(!source.includes(entry))throw Error('The live suite entry changed; review this adapter.');
source=source.replace('const page=await context.newPage(),errors=[];', 'let page=await context.newPage();const errors=[];');
source=source.replace(entry,`    await page.goto(base+'/brivany-shell');
    await page.locator('#live-launch').click();
    await page.frameLocator('#module-frame').locator('#mic-toggle').waitFor();
    const host=page, ui=page.frames().find(frame=>new URL(frame.url()).pathname==='/app');
    if(!ui)throw Error('Desktop live frame not found');
    page=new Proxy(ui,{get(target,key){
      if(key==='setViewportSize')return host.setViewportSize.bind(host);
      if(key==='reload')return ()=>ui.goto(base+'/app');
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});`);
new Function('require',source)(require);
