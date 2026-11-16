/* Render local de videos para redes de Melodi (edición 4).
   Cada cuadro es una función pura del tiempo: se busca la línea de tiempo,
   se captura en JPEG y se codifica con FFmpeg. Sin red: el navegador no
   resuelve nombres ni usa proxy real. Uso:
     node social_render.mjs <proyecto> cues <salida.json>
     node social_render.mjs <proyecto> video <salida.mp4> [--workers 3]
     node social_render.mjs <proyecto> stills <carpeta> <t1,t2,...> [--cover]
   Requiere playwright-core (motion-studio/node_modules) y Microsoft Edge o
   BRIVANY_CHROMIUM_PATH. FFmpeg en PATH o BRIVANY_FFMPEG. */
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const here=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.join(here,'../../motion-studio/package.json'));
const {chromium}=require('playwright-core');
const [,,projectArg,mode,target,extra]=process.argv;
const flag=(name,def)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:def};
const project=path.resolve(projectArg);const index=path.join(project,'index.html');
const ffmpeg=process.env.BRIVANY_FFMPEG||'ffmpeg';
const data=JSON.parse(fs.readFileSync(path.join(project,'social.json'),'utf8'));
const [W,H]=data.size,FPS=data.fps,TOTAL=data.total;

async function open(browser,hash=''){
  const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(index).href+hash,{waitUntil:'load'});
  // Sondeo explícito: waitForFunction (rAF) hizo caer al renderizador en Windows.
  for(let i=0;!(await page.evaluate(()=>window.__socialReady===true));i++){if(i>600)throw Error('La composición no terminó de cargar.');await new Promise(r=>setTimeout(r,50))}
  if(errors.length)throw Error('Errores en la composición: '+errors.join(' | '));
  return {page,errors};
}
// Sin red: ningún nombre resuelve (page.route hacía caer al renderizador en Windows).
const offline=['--host-resolver-rules=MAP * ~NOTFOUND','--proxy-server=127.0.0.1:9','--proxy-bypass-list=<-loopback>'];
const launch=()=>chromium.launch(process.env.BRIVANY_CHROMIUM_PATH?{executablePath:process.env.BRIVANY_CHROMIUM_PATH,args:offline}:{channel:'msedge',args:offline});

async function encode(browser,from,to,file){
  const {page,errors}=await open(browser);
  const ff=spawn(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(FPS),'-i','pipe:0',
    '-vf','scale=in_color_matrix=bt601:in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-r',String(FPS),'-g',String(FPS),'-bf','2',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-an',file],{stdio:['pipe','inherit','inherit']});
  const closed=once(ff,'close');ff.stdin.on('error',()=>{});
  for(let f=from;f<to;f++){
    await page.evaluate(t=>{window.__timelines.main.seek(t,false)},f/FPS);
    const jpg=await page.screenshot({type:'jpeg',quality:92});
    if(!ff.stdin.write(jpg))await once(ff.stdin,'drain');
  }
  ff.stdin.end();const [code]=await closed;await page.close();
  if(code!==0||errors.length)throw Error(`Tramo ${from}-${to}: FFmpeg ${code}; ${errors.join(' | ')}`);
}

const browser=await launch();
try{
  if(mode==='cues'){
    const {page}=await open(browser);
    const out=await page.evaluate(()=>({sfx:window.__sfx,duration:window.__timelines.main.duration()}));
    fs.writeFileSync(target,JSON.stringify(out,null,1));
  }else if(mode==='stills'){
    fs.mkdirSync(target,{recursive:true});
    const {page}=await open(browser,process.argv.includes('--cover')?'#cover':'');
    const files=[];
    for(const t of extra.split(',').map(Number)){
      await page.evaluate(t=>{window.__timelines.main.seek(t,false)},t);
      const file=path.join(target,`frame-${t.toFixed(2)}.jpg`);await page.screenshot({path:file,type:'jpeg',quality:94});files.push(file);
    }
    console.log(JSON.stringify(files));
  }else if(mode==='audit'){
    // Mide cada texto visible: caja real, tamaño de letra efectivo y desborde.
    const {page}=await open(browser);const report=[];
    for(const t of extra.split(',').map(Number)){
      await page.evaluate(t=>{window.__timelines.main.seek(t,false)},t);
      report.push(await page.evaluate(t=>{
        const out=[];const seen=new Set();
        const visible=e=>{for(let n=e;n&&n.nodeType===1;n=n.parentElement){const cs=getComputedStyle(n);if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)<.35)return false}return true};
        const walker=document.createTreeWalker(document.getElementById('root'),NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){const node=walker.currentNode;if(!node.textContent.trim())continue;const e=node.parentElement;
          let block=e;while(block&&getComputedStyle(block).display.startsWith('inline'))block=block.parentElement;
          if(!block||seen.has(block)||!visible(e))continue;seen.add(block);
          const r=block.getBoundingClientRect();if(r.width<1||r.height<1)continue;const inSvg=!!e.closest('svg');
          const scale=r.width/Math.max(1,block.offsetWidth);const size=parseFloat(getComputedStyle(e).fontSize)*scale;
          const role=block.closest('.cap')?'caption':block.closest('.kit')?'kit':block.closest('#brand')?'brand':block.classList.contains('headline')||block.closest('.headline')?'headline':block.classList.contains('cta')?'cta':block.classList.contains('kicker')?'kicker':block.classList.contains('body')?'body':'other';
          const clipped=!inSvg&&block.scrollWidth>block.clientWidth+2||block.scrollHeight>block.clientHeight+4&&getComputedStyle(block).overflow!=='visible';
          out.push({role,text:block.textContent.trim().slice(0,80),x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),font:inSvg?null:Math.round(size*10)/10,clipped})}
        // extensión real de la ilustración: unión de sus piezas visibles
        for(const box of document.querySelectorAll('.kitbox')){if(!visible(box))continue;let x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
          for(const n of box.querySelectorAll('*')){if(!visible(n))continue;const r=n.getBoundingClientRect();if(r.width<12||r.height<12)continue;
            const cs=getComputedStyle(n);const painted=n.tagName==='svg'||n.tagName==='IMG'||(cs.backgroundColor&&cs.backgroundColor!=='rgba(0, 0, 0, 0)')||cs.backgroundImage!=='none'||cs.borderTopWidth!=='0px';
            if(!painted)continue;x1=Math.min(x1,r.left);y1=Math.min(y1,r.top);x2=Math.max(x2,r.right);y2=Math.max(y2,r.bottom)}
          if(x2>x1)out.push({role:'visual',text:'ilustración',x:Math.round(x1),y:Math.round(y1),w:Math.round(x2-x1),h:Math.round(y2-y1),font:null,clipped:false})}
        return {t,items:out}},t));
    }
    fs.writeFileSync(target,JSON.stringify(report,null,1));
  }else if(mode==='video'){
    const frames=Math.round(TOTAL*FPS),workers=Math.max(1,Math.min(6,Number(flag('--workers',3))));
    const parts=[],size=Math.ceil(frames/workers),tmp=target+'.parts';fs.mkdirSync(tmp,{recursive:true});
    const started=Date.now();
    await Promise.all(Array.from({length:workers},(_,i)=>{const a=i*size,b=Math.min(frames,(i+1)*size);const file=path.join(tmp,`part-${i}.mp4`);parts[i]=file;return a<b?encode(browser,a,b,file):null}));
    const list=path.join(tmp,'list.txt');fs.writeFileSync(list,parts.filter(p=>fs.existsSync(p)).map(p=>`file '${p.replace(/\\/g,'/')}'`).join('\n'));
    const ff=spawn(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy',target],{stdio:'inherit'});
    const [code]=await once(ff,'close');if(code!==0)throw Error('No se pudieron unir los tramos.');
    fs.rmSync(tmp,{recursive:true,force:true});
    console.log(JSON.stringify({frames,workers,seconds:(Date.now()-started)/1000}));
  }else throw Error('Modo no válido');
}finally{await browser.close()}
