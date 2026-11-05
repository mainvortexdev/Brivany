import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readVideoCaptions,upcomingCaptions} from '../caption-probe.js';

async function probe({tracks=[],url='https://www.youtube.com/watch?v=abcdefghijk',response=null,fetcher=()=>assert.fail('unexpected caption fetch'),cache=null}={}){
 const video={readyState:4,ended:false,paused:false,currentTime:4,playbackRate:1,currentSrc:'https://owned.example/movie.mp4',textTracks:tracks};
 const sandbox={document:{querySelectorAll:()=>[video],querySelector:()=>({getPlayerResponse:()=>response})},location:new URL(url),URL,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,fetch:fetcher,cache};
 return vm.runInNewContext(`(${readVideoCaptions.toString()})(cache)`,sandbox);
}
test('native captions preserve voice hints as data and select only the upcoming bounded window',async()=>{
 const snapshot=await probe({tracks:[{kind:'subtitles',mode:'showing',language:'es',cues:[{startTime:5,endTime:7,text:'<v Alicia>Hola.</v>'},{startTime:9,endTime:11,text:'<v Bruno>No, son 15.</v>'},{startTime:12,endTime:13,text:'[music]'},{startTime:40,endTime:41,text:'Too far.'}]}]});
 const future=upcomingCaptions(snapshot);assert.equal(future.cues.length,2);assert.equal(future.cues[0].speaker,'Alicia');assert.equal(future.cues[1].text,'No, son 15.');assert.equal(future.source,'youtube:abcdefghijk');
 assert.equal(upcomingCaptions({...snapshot,paused:true}),null);assert.equal(upcomingCaptions({...snapshot,rate:2}),null);
});
test('only same-origin timedtext of the current exposed YouTube video can be fetched',async()=>{
 let requests=0;const response={videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk',languageCode:'es'}]}}};
 const result=await probe({response,fetcher:async(address,options)=>{requests++;assert.equal(new URL(address).searchParams.get('fmt'),'json3');assert.equal(options.redirect,'error');return new Response(JSON.stringify({events:[{tStartMs:5000,dDurationMs:2000,segs:[{utf8:'Hola.'}]}]}));}});
 assert.equal(requests,1);assert.equal(result.kind,'youtube-captions');assert.equal(result.cues[0].text,'Hola.');
 for(const baseUrl of ['https://evil.example/api/timedtext?v=abcdefghijk','https://www.youtube.com/api/timedtext?v=11111111111','http://www.youtube.com/api/timedtext?v=abcdefghijk']){
  response.captions.playerCaptionsTracklistRenderer.captionTracks[0].baseUrl=baseUrl;assert.equal((await probe({response})).cues.length,0);
 }
 response.videoDetails.videoId='11111111111';assert.equal((await probe({response})).cues.length,0);
});
test('unavailable captions return an empty fallback; a cached track avoids another request',async()=>{
 const snapshot=await probe();assert.equal(snapshot.cues.length,0);
 const cached={source:'youtube:abcdefghijk',expires:Date.now()+50000,kind:'youtube-captions',language:'es',cues:[{start:5,end:7,text:'Hola.',speaker:null}]};
 const result=await probe({cache:cached});assert.equal(result.cues.length,1);assert.equal(result.language,'es');
 const denied={videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk'}]}}};
 assert.equal((await probe({response:denied,fetcher:async()=>new Response('',{status:403})})).cues.length,0);
});
