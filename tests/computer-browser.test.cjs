'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {navigateObserved,matchesDestination}=require('../desktop/computer/browserNavigation.cjs');
const {validateStep}=require('../desktop/computer/native.cjs');
const {windowGuardScript}=require('../desktop/computer/windowGuard.cjs');
const {attachYouTube,progress}=require('../desktop/computer/youtube.cjs');
const {playerHoverScript}=require('../desktop/computer/playerHover.cjs');
test('Player hover keeps identity guards and injects movement only',()=>{
 const script=playerHoverScript({windowHandle:'1',id:'1.2.-3'});assert(script.includes('OCCLUDED_PLAYER'));assert(script.includes('GetForegroundWindow'));assert.equal((script.match(/mouse_event\(/g)||[]).length,2);assert(!/LeftClick|RightClick|KeyPress/.test(script));assert.throws(()=>playerHoverScript({windowHandle:'1;bad',id:'1.2'}));
});
function youtubeFixture({ad=false,frozen=false,requireVisible=false}={}){
 let time=0,playing=true,position=0,visible=false,advertisement=ad;const clicks=[];
 const state=()=>({windowHandle:'1',tabs:[{id:'tab',selected:true}],player:{id:'player',automationId:'movie_player',className:'html5-video-player '+(advertisement?'ad-showing ':'')+(playing?'playing-mode':'paused-mode')},controls:[
  {id:'play',name:playing?'Pausa (k)':'Reproducir (k)',className:'ytp-play-button',inPlayer:true,playerId:'player',role:'ControlType.Button',width:30,height:30},
  {id:'time',name:`0 minutos ${requireVisible&&!visible?0:position} segundos de 3 minutos 32 segundos`,className:'ytp-time-contents',inPlayer:true,playerId:'player',role:'ControlType.Button'},
  ...(advertisement?[{id:'skip',name:'Saltar',className:'ytp-skip-ad-button',inPlayer:true,playerId:'player',role:'ControlType.Button',width:30,height:30}]:[])
 ]});
 const session={tabId:'tab',observe:async()=>state(),requireSelectedTab:s=>{assert(s.tabs.some(t=>t.selected&&t.id==='tab'));},revealPlayer:async s=>s,clickObserved:async(id,kind,predicate)=>{const target=state().controls.find(c=>c.id===id);assert(target&&predicate(target));clicks.push(id);if(id==='skip')advertisement=false;else playing=!playing;}};
 attachYouTube(session,{playerState:s=>s.player.className.includes('ad-showing')?null:s.player.className.includes('playing-mode')?'playing':'paused',isPlay:c=>c.name.startsWith('Reproducir'),isPause:c=>c.name.startsWith('Pausa'),assertActive:()=>{},now:()=>time,wait:async ms=>{time+=ms;if(playing&&!frozen)position++;},withVisiblePlayer:async(snapshot,run)=>{assert.equal(snapshot.player.id,'player');visible=true;try{return await run();}finally{visible=false;}}});
 session.resume=()=>session.setPlayback('resume');return {session,clicks,state};
}
test('Verification keeps the observed player visible without seeking or toggling',async()=>{
 const {session,clicks}=youtubeFixture({requireVisible:true});const result=await session.resume();assert(result.verified&&result.advances===2);assert.deepEqual(clicks,[]);
});
test('YouTube playback requires two content advances, then pause and resume are verified',async()=>{
 const {session,clicks}=youtubeFixture();const play=await session.resume();assert(play.verified&&play.playing);assert.equal(play.advances,2);assert.deepEqual(clicks,[]);
 const paused=await session.setPlayback('pause');assert(paused.verified&&paused.paused);assert.deepEqual(clicks,['play']);
 const resumed=await session.resume();assert(resumed.verified&&resumed.playing);assert.deepEqual(clicks,['play','play']);
});
test('Advertisement timer is not music; only the observed skip control is used',async()=>{
 const {session,clicks}=youtubeFixture({ad:true});const result=await session.resume();assert(result.verified&&result.playing);assert.deepEqual(clicks,['skip']);
});
test('A frozen playing label never confirms audible content progress',async()=>{
 const {session,clicks}=youtubeFixture({frozen:true});const result=await session.resume();assert.equal(result.verified,false);assert.equal(result.verificationPending,true);assert.deepEqual(clicks,[]);
});
test('Unrelated timers and advertising cannot supply content progress',()=>{
 assert.equal(progress({player:{id:'p',automationId:'movie_player',className:'ad-showing'},controls:[{name:'0 minutos 4 segundos de 1 minuto',className:'ytp-time-contents',inPlayer:true,playerId:'p'}]}),null);
 assert.equal(progress({player:{id:'p',automationId:'movie_player',className:'playing-mode'},controls:[{name:'0 minutos 4 segundos de 1 minuto',className:'ytp-time-contents',inPlayer:true,playerId:'another'}]}),null);
});
test('A result replaced during reasoning is never clicked',async()=>{
 const {session,clicks}=youtubeFixture();let title='Artista - Canción oficial';session.observe=async()=>({windowHandle:'1',tabs:[{id:'tab',selected:true}],controls:[{id:'song',name:title,videoResult:true,role:'ControlType.Hyperlink',width:100,height:30,x:1,y:1}]});session.navigateSelectedTab=async()=>({verified:true});session.decide=async()=>{title='Otro resultado';return {id:'song',certain:true};};session.automation={clickObservedControl:async()=>clicks.push('result')};
 await assert.rejects(session.searchAndPlay('Artista canción'),/resultados cambiaron/i);assert.deepEqual(clicks,[]);
});
test('Browser search and login are typed actions; credentials are not tool parameters',()=>{
 const identity={handle:'1',process_id:2};
 assert.equal(validateStep({action:'browser_youtube_search',params:{...identity,query:'Artista canción'}}).action,'browser_youtube_search');
 for(const step of [
  {action:'browser_youtube_search',params:{...identity,query:'x'.repeat(501)}},
  {action:'browser_open_login',params:{...identity,url:'http://example.com/login'}},
  {action:'browser_open_login',params:{...identity,url:'https://user:secret@example.com/login'}},
  {action:'browser_open_login',params:{...identity,url:'https://example.com/login',password:'secret'}}
 ])assert.throws(()=>validateStep(step));
 assert.equal(validateStep({action:'browser_open_login',params:{...identity,url:'https://example.com/login'}}).action,'browser_open_login');
 assert(windowGuardScript('1').includes('MODAL_WINDOW_REQUIRES_USER'));assert.throws(()=>windowGuardScript('1;bad'));
});
function fixture(pages){
 const calls=[],session={observe:async()=>({windowHandle:'1'}),requireSelectedTab:()=>{},selectCurrentTabForNavigation:async()=>calls.push('rebind')};
 let index=0;
 return {calls,options:{session,automation:{guardedHotkey:async(handle,keys)=>calls.push(keys.join('+')),getForegroundIdentity:async()=>({windowHandle:'1'})},type:async url=>calls.push(url),readPage:async()=>{const page=pages[Math.min(index++,pages.length-1)];if(page instanceof Error)throw page;return {windowHandle:'1',...page};},assertActive:()=>{},wait:async()=>{},attempts:3}};
}
test('Delayed accessible document is polled without repeating navigation',async()=>{
 const {options,calls}=fixture([Error('WEB_DOCUMENT_UNAVAILABLE'),{url:'https://example.com/page'}]);
 const result=await navigateObserved(options,'https://example.com/page');assert(result.verified);assert.equal(calls.filter(c=>c==='enter').length,1);assert.equal(calls.filter(c=>c==='https://example.com/page').length,1);assert.equal(calls.at(-1),'rebind');
});
test('Changed foreground aborts before another read or action',async()=>{
 const {options,calls}=fixture([{url:'https://example.com/'}]);options.automation.getForegroundIdentity=async()=>({windowHandle:'2'});
 await assert.rejects(navigateObserved(options,'https://example.com/'),/Cambió la ventana/);assert.equal(calls.filter(c=>c==='enter').length,1);assert(!calls.includes('rebind'));
});
test('Wrong destination never becomes verified',async()=>{
 const {options,calls}=fixture([{url:'https://other.example/'}]);await assert.rejects(navigateObserved(options,'https://example.com/'),/no coincide/);assert.equal(calls.filter(c=>c==='enter').length,1);assert(!calls.includes('rebind'));
});
test('Login redirects stay within the requested origin and hand off without reading fields',async()=>{
 const {options,calls}=fixture([{url:'https://example.com/session/new'}]);options.handoff=true;
 const result=await navigateObserved(options,'https://example.com/login');assert(result.verified&&result.requires_user);assert(!calls.includes('rebind'));
 const wrong=fixture([{url:'https://another.example/session'}]);wrong.options.handoff=true;await assert.rejects(navigateObserved(wrong.options,'https://example.com/login'),/no coincide/);
});
test('YouTube UI refresh is accepted only with the same query and origin',()=>{
 assert(matchesDestination('https://www.youtube.com/results?search_query=artist&themeRefresh=1','https://www.youtube.com/results?search_query=artist'));
 assert(!matchesDestination('https://www.youtube.com/results?search_query=other&themeRefresh=1','https://www.youtube.com/results?search_query=artist'));
 assert(!matchesDestination('https://other.example/results?search_query=artist','https://www.youtube.com/results?search_query=artist'));
});
test('Unsafe navigation schemes and credentials never reach input',async()=>{
 for(const url of ['javascript:alert(1)','file:///x','https://user:password@example.com']){const {options,calls}=fixture([]);await assert.rejects(navigateObserved(options,url));assert.deepEqual(calls,[]);}
});
