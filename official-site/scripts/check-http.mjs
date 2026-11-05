import assert from 'node:assert/strict';
const origin=process.argv[2]||'http://127.0.0.1:8787';
for(const [path,type] of [['/','text/html'],['/assets/app.js','javascript'],['/assets/audio-worker.js','javascript'],['/assets/site.css','text/css'],['/favicon.svg','image/svg+xml'],['/privacidad','text/html'],['/condiciones','text/html'],['/robots.txt','text/plain'],['/sitemap.xml','application/xml']]){
 const r=await fetch(origin+path);assert.equal(r.status,200,path);assert(r.headers.get('content-type')?.includes(type),path);assert.equal(r.headers.get('set-cookie'),null,path);const body=await r.text();assert(body.length>20,path);
 if(path==='/'){assert(body.includes('Habla con Melodi.'));assert(body.includes('role="tablist"'));assert(body.includes('href="/privacidad"'));assert(body.includes('href="/condiciones"'));assert(r.headers.get('content-security-policy').includes("script-src 'self'"));}
 const head=await fetch(origin+path,{method:'HEAD'});assert.equal(head.status,200,path+' HEAD');assert.equal(await head.text(),'');
}
let r=await fetch(origin+'/privacy',{redirect:'manual'});assert.equal(r.status,308);assert.equal(r.headers.get('location'),'/privacidad');
r=await fetch(origin+'/spotify/callback');assert.equal(r.status,origin.startsWith('https://brivany.example')?200:403);assert.equal(r.headers.get('cache-control'),'no-store, private');
r=await fetch(origin+'/',{method:'POST'});assert.equal(r.status,405);
r=await fetch(origin+'/missing-route');assert.equal(r.status,404);
console.log(JSON.stringify({passed:true,origin,checks:['presentation and bundled assets','legal pages and redirects','HEAD semantics','no public cookies','CSP','private OAuth callback unchanged','404 and 405']},null,2));
