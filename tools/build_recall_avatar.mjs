// Render the existing brand artwork in its meeting card; no generative media.
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {mediaHTML,MEDIA_CSS} from '../workers/whatsapp/meetings/media-page.js';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),{chromium}=require('../motion-studio/node_modules/playwright-core');
const avatar=await readFile(join(root,'workers/whatsapp/meetings/assets/melodi-profile.png'));
const font=await readFile(join(root,'web/fonts/BrivanyEditorial-Regular.woff2'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
 // Static identity only: no audio engine, permissions, network or owner data.
 const html=mediaHTML().replace(/<script[^>]*><\/script>/,'').replace(/<link[^>]*>/,'').replace('/meeting-media/avatar.png','data:image/png;base64,'+avatar.toString('base64')).replace(/<p>.*?<\/p>/,'').replace(/<small id="state">.*?<\/small>/,'');
 await page.route('**/*',route=>route.abort());await page.setContent(html);
 await page.addStyleTag({content:MEDIA_CSS.replace(/url\('[^']+'\)/,"url('data:font/woff2;base64,"+font.toString('base64')+"')")+'img{width:490px;height:490px}h1{font-size:58px;margin-top:10px}'});
 await page.waitForFunction(()=>document.querySelector('img').naturalWidth>0);await page.evaluate(()=>document.fonts.ready);
 const path=join(root,'workers/whatsapp/meetings/assets/melodi-camera.jpg');await page.screenshot({path,type:'jpeg',quality:94});
 const image=await readFile(path);if(image.length>1300000)throw Error('recall_avatar_too_large');console.log(JSON.stringify({path,width:1280,height:720,bytes:image.length,externalCalls:0}));
}finally{await browser.close();}
