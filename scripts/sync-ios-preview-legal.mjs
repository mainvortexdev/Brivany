import {writeFile} from 'node:fs/promises';
import {sitePage} from '../official-site/pages.mjs';
for(const [path,title] of [['privacidad','Política de privacidad'],['condiciones','Condiciones de uso']]){
 const html=sitePage('/'+path),article=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1];
 if(!article)throw Error('Missing legal content: '+path);
 await writeFile(new URL('../ios/preview/dist/legal/'+path+'.html',import.meta.url),'<!doctype html><html lang="es"><meta charset="utf-8"><body><h1>'+title+'</h1>'+article+'</body></html>','utf8');
}
console.log('Documentos internos de la vista iPhone sincronizados.');
