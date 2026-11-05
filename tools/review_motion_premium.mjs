import {chromium} from '../motion-studio/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve('.'),report=JSON.parse(await fs.readFile('tmp/motion-premium/prepared.json','utf8'));
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 for(const film of report.videos){
  // Only these owned, newly generated projects are refreshed. Voice is reused.
  let html=await fs.readFile(path.join(film.folder,'exports/Brivany-animation.html'),'utf8');
  for(const name of ['runtime.js','vendor.min.js']){
   const dest=path.join(film.folder,'assets',name),old=await fs.readFile(dest,'utf8'),next=await fs.readFile(path.join(root,'motion-studio/dist',name),'utf8');
   html=html.replace(old.replaceAll('</script','<\\/script'),next.replaceAll('</script','<\\/script'));
   await fs.writeFile(dest,next);
  }
  await fs.writeFile(path.join(film.folder,'exports/Brivany-animation.html'),html);
  const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto(pathToFileURL(path.join(film.folder,'index.html')).href);await page.waitForFunction(()=>window.OPENER?.ready);
  const folder=path.join(root,'tmp/motion-premium','review-'+film.style);await fs.mkdir(folder,{recursive:true});
  for(const t of [.8,3.5,7.5,10.5,14.5,17.5,21.3,25.5]){await page.evaluate(t=>window.OPENER.seek(t),t);await page.screenshot({path:path.join(folder,`${t}.png`)});}
  await page.close();console.log(film.style+' review frames ready');
 }
}finally{await browser.close();}
