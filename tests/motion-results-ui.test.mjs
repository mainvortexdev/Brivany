import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function legacy(mime){
 const source=await readFile(new URL('../desktop/experience/computer.js',import.meta.url),'utf8');
 const part=source.split("else if(job.kind==='motion'&&job.result?.verified){")[1].split("else if(['terminal','media','support'].includes(job.kind)){")[0];
 const body=part.slice(0,part.lastIndexOf('}'));
 const nodes=[],opened=[];
 const createElement=tag=>{const value={tag,style:{},children:[],attributes:{},append(...items){this.children.push(...items)},setAttribute(k,v){this.attributes[k]=v}};nodes.push(value);return value};
 const preview=createElement('preview'),job={id:'owned-job',result:{verified:true,title:'Mi historia',width:1080,height:1920,duration:15,fps:30}},blob={type:mime};
 class Reader{readAsDataURL(value){assert.equal(value,blob);this.result='data:image/png;base64,owned';queueMicrotask(()=>this.onload())}}
 const context={job,preview,document:{createElement},mount:{classList:{add(){}}},options:{open:true},session:{token:'owned-token'},motionUrl:null,state:{},owner:{pywebview:{api:{open_motion_result:async(...args)=>opened.push(args)}}},FileReader:Reader,URL:{createObjectURL:value=>{assert.equal(value,blob);return 'blob:owned'}},encodeURIComponent,closePreview(){},fetch:async(url,options)=>{assert.equal(url,'/api/computer/motion/owned-job');assert.equal(options.headers['X-Brivany-Control'],'owned-token');return {ok:true,blob:async()=>blob}}};
 await vm.runInNewContext(`(async()=>{${body}})()`,context);
 return {nodes,opened,preview};
}

test('legacy PNG result is an image with an image action, no video controls/fps labels',async()=>{
 const f=await legacy('image/png');
 const picture=f.nodes.find(n=>n.tag==='img');assert.ok(picture);assert.equal(picture.src,'data:image/png;base64,owned');assert.equal(picture.alt,'Mi historia');
 assert.equal(f.nodes.some(n=>n.tag==='video'),false);assert.equal(f.nodes.find(n=>n.tag==='p').textContent,'1080 × 1920');
 const button=f.nodes.find(n=>n.tag==='button'&&n.textContent==='Abrir imagen');assert.ok(button);await button.onclick();assert.deepEqual(f.opened,[['owned-job','image']]);
 assert.equal(f.nodes.find(n=>n.attributes['aria-label']==='Cerrar ilustración')?.tag,'button');
});
test('legacy MP4 result retains video controls and duration/fps details',async()=>{
 const f=await legacy('video/mp4'),video=f.nodes.find(n=>n.tag==='video');assert.ok(video);assert.equal(video.controls,true);assert.equal(video.preload,'metadata');assert.equal(video.src,'blob:owned');
 assert.equal(f.nodes.find(n=>n.tag==='p').textContent,'15 s · 1080 × 1920 · 30 fps');assert.ok(f.nodes.find(n=>n.textContent==='Abrir video'));assert.equal(f.nodes.some(n=>n.tag==='img'),false);
});
test('legacy viewer refuses an HTML response rather than showing it as motion media',async()=>{
 await assert.rejects(legacy('text/html'),/Formato creativo no admitido/);
});
