import test from 'node:test';
import assert from 'node:assert/strict';
import {researchPublicWeb} from '../public-web-research.js';

test('general research does not rewrite every question into an Instagram search and retains evidence provenance',async()=>{
  const requests=[];
  const result=await researchPublicWeb({EXA_API_KEY:'fixture-only'},{query:'Cloudflare Queues delivery guarantees official documentation'},async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return Response.json({results:[{title:'Official queues documentation',url:'https://developers.cloudflare.com/queues/',publishedDate:'2026-10-01',highlights:['At least once delivery.']},{url:'http://localhost/secret',title:'Reject me'}]});
  });
  assert.equal(requests[0].body.query,'Cloudflare Queues delivery guarantees official documentation');
  assert.equal(requests[0].body.numResults,6);assert.equal('includeDomains' in requests[0].body,false);
  assert.equal(result.results.length,1);assert.equal(result.status,'observed');assert.ok(Number.isFinite(Date.parse(result.results[0].retrievedAt)));
});
test('a missing integration or provider error is unavailable, not verified research with an invented result',async()=>{
  assert.equal((await researchPublicWeb({}, {query:'Anything'})).available,false);
  const result=await researchPublicWeb({EXA_API_KEY:'fixture-only'},{query:'Anything'},async()=>new Response('fail',{status:503}));
  assert.equal(result.available,false);assert.deepEqual(result.results,[]);
});
test('oversized responses and accidental credential queries are rejected',async()=>{
  const env={EXA_API_KEY:'fixture-only'};
  await assert.rejects(researchPublicWeb(env,{query:'password=not-for-search'},()=>{throw Error('must not fetch');}),/private_search_query_rejected/);
  await assert.rejects(researchPublicWeb(env,{query:'anything'},async()=>new Response('x'.repeat(128001))),/too_large/);
});
