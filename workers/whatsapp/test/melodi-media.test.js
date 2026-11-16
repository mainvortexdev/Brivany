import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverStacyResults} from '../owner-features.js';
test('Melodi forwards image, document and video bytes to the linked recipient',async()=>{
 for(const kind of ['image','document','video']){
  let status='completed';const sends=[];const bytes=new Uint8Array([1,2,3]);
  const artifact={kind,objectKey:'melodi-files/pc/job',mimeType:kind==='video'?'video/mp4':kind==='image'?'image/png':'application/pdf',fileName:'result',size:3};
  const command={id:'job',device_id:'pc',user_id:'linked-user',type:'attachment',status:'completed',result_json:JSON.stringify({artifact})};
  const env={VETSA_CLOUD:{prepare(sql){return {async all(){return {results:status==='completed'?[command]:[]}},bind(){return {async run(){if(sql.includes("SET status = 'delivering'")){status='delivering';return {meta:{changes:1}}}if(sql.includes("SET status = 'delivered'"))status='delivered';return {meta:{changes:1}};}}}}}},VETSA_MEDIA:{async get(key){assert.equal(key,artifact.objectKey);return {size:3,async arrayBuffer(){return bytes.buffer}}}}};
  await deliverStacyResults(env,async()=>assert.fail('Should send media'),async(...args)=>sends.push(args));
  assert.equal(sends.length,1);assert.equal(sends[0][1],'linked-user');assert.equal(sends[0][2],kind);assert.deepEqual(sends[0][3],bytes);assert.equal(status,'delivered');
  await deliverStacyResults(env,async()=>{},async()=>assert.fail('duplicate'));
 }
});
