'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../web/youtube-source.js'),'utf8');

function environment({api=true}={}) {
  const created=[],scripts=[],players=[];
  const document={createElement(tag){const value={tagName:tag.toUpperCase(),style:{},dataset:{},remove(){this.removed=true;}};created.push(value);return value;},head:{append(script){scripts.push(script);}}};
  const window={};
  function Player(frame,options){
    this.frame=frame;this.options=options;this.calls=[];players.push(this);
    this.setVolume=value=>this.calls.push(['volume',value]);this.playVideo=()=>this.calls.push(['play']);this.pauseVideo=()=>this.calls.push(['pause']);this.destroy=()=>this.calls.push(['destroy']);
    this.getCurrentTime=()=>12.5;this.getDuration=()=>60;
    queueMicrotask(()=>options.events.onReady({target:this}));
  }
  if(api)window.YT={Player};
  vm.runInNewContext(source,{window,document,location:{origin:'http://127.0.0.1:8765'},URL,setTimeout,clearTimeout,Map,Error});
  const container={dataset:{},children:[],replaceChildren(...items){this.children=items;}};
  return {window,document,created,scripts,players,Player,container,...window.BrivanyYouTubeSource};
}

test('strict YouTube links normalize only a safe fixed video identity',()=>{
  const {parseYouTubeUrl}=environment();
  for(const url of ['https://www.youtube.com/watch?v=qGEPPNTTYmk','https://youtu.be/qGEPPNTTYmk?t=6','https://m.youtube.com/shorts/qGEPPNTTYmk','https://youtube.com/live/qGEPPNTTYmk','https://youtube.com/v/qGEPPNTTYmk']) {
    const parsed=parseYouTubeUrl(url);assert.equal(parsed.videoId,'qGEPPNTTYmk');assert.equal(parsed.url,'https://www.youtube.com/watch?v=qGEPPNTTYmk');
  }
  for(const url of ['javascript:alert(1)','https://youtube.com.evil.test/watch?v=qGEPPNTTYmk','https://youtube.com@evil.test/watch?v=qGEPPNTTYmk','https://user:password@youtube.com/watch?v=qGEPPNTTYmk','https://www.youtube.com:444/watch?v=qGEPPNTTYmk','https://youtu.be/qGEPPNTTYmk/extra','https://www.youtube.com/watch?v=qGEPPNTTYmk&v=abcdefghijk','https://www.youtube.com/watch?v=%3Cscript%3E','https://www.youtube.com/redirect?q=qGEPPNTTYmk','https://youtube.com/watch?v=qGEPPNTT mk'])assert.throws(()=>parseYouTubeUrl(url));
});

test('constructing does not request YouTube or autoplay; explicit load creates origin-bound controlled iframe',async()=>{
  const env=environment(),events=[];const player=new env.YouTubeSource(env.container,{onReady:event=>events.push(event)});
  assert.equal(env.created.length,0);assert.equal(env.scripts.length,0);assert.equal(player.ready,false);
  const result=await player.loadUrl('https://youtu.be/qGEPPNTTYmk?autoplay=1&origin=https://evil.test');
  assert.equal(result.ready,true);assert.equal(events.length,1);assert.equal(player.state,'cued');
  const frame=env.container.children[0],url=new URL(frame.src);assert.equal(url.origin,'https://www.youtube.com');assert.equal(url.pathname,'/embed/qGEPPNTTYmk');
  assert.equal(url.searchParams.get('autoplay'),'0');assert.equal(url.searchParams.get('enablejsapi'),'1');assert.equal(url.searchParams.get('origin'),'http://127.0.0.1:8765');
  assert.equal(frame.referrerPolicy,'strict-origin-when-cross-origin');assert.equal(env.players[0].calls.filter(call=>call[0]==='play').length,0);
  assert.match(frame.allow,/autoplay/);
  player.play();player.pause();player.setVolume(15);assert.equal(player.currentTime,12.5);assert.equal(player.duration,60);
  assert.deepEqual(env.players[0].calls.slice(-3),[['play'],['pause'],['volume',15]]);assert.throws(()=>player.setVolume(101));
  player.destroy();assert.equal(player.ready,false);assert.equal(env.container.children.length,0);
});

test('normalized states and video errors cannot arrive from a destroyed old player',async()=>{
  const env=environment(),events=[],errors=[];const player=new env.YouTubeSource(env.container,{onStateChange:event=>events.push(event.state),onError:error=>errors.push(error.message)});
  await player.loadUrl('https://youtu.be/qGEPPNTTYmk');const first=env.players[0];
  first.options.events.onStateChange({data:1});assert.equal(player.state,'playing');assert.deepEqual(events,['playing']);
  await player.loadUrl('https://youtu.be/abcdefghijk');first.options.events.onStateChange({data:0});first.options.events.onError({data:150});
  assert.equal(player.videoId,'abcdefghijk');assert.equal(player.ready,true);assert.deepEqual(events,['playing']);assert.deepEqual(errors,[]);
  env.players[1].options.events.onError({data:150});assert.equal(player.ready,false);assert.match(errors[0],/no permite/);player.destroy();
});

test('API loads only after explicit load and cancelled initialization never inserts a stale iframe',async()=>{
  const env=environment({api:false}),player=new env.YouTubeSource(env.container);
  const pending=player.loadUrl('https://youtu.be/qGEPPNTTYmk');assert.equal(env.scripts.length,1);assert.equal(env.scripts[0].src,'https://www.youtube.com/iframe_api');
  player.destroy();env.window.YT={Player:env.Player};env.window.onYouTubeIframeAPIReady();
  assert.equal((await pending).cancelled,true);assert.equal(env.container.children.length,0);assert.equal(env.players.length,0);
});

test('playConfirmed waits for actual PLAYING, reuses pending confirmation and preserves the iframe when paused',async()=>{
  const env=environment(),player=new env.YouTubeSource(env.container);await player.loadUrl('https://youtu.be/qGEPPNTTYmk');
  const frame=env.container.children[0],native=env.players[0];let completed=false;
  const playing=player.playConfirmed();playing.then(()=>{completed=true;});assert.equal(native.calls.at(-1)[0],'play');
  assert.equal(player.playConfirmed(),playing);await Promise.resolve();assert.equal(completed,false);
  native.options.events.onStateChange({data:3});await Promise.resolve();assert.equal(completed,false);
  native.options.events.onStateChange({data:1});assert.equal((await playing).state,'playing');assert.equal(player.error,null);
  player.pause();native.options.events.onStateChange({data:2});assert.equal(env.container.children[0],frame);assert.equal(player.ready,true);assert.equal(player.videoId,'qGEPPNTTYmk');
  const again=player.playConfirmed();native.options.events.onStateChange({data:1});assert.equal((await again).state,'playing');player.destroy();
});

test('blocked playback rejects with a useful code and keeps the visible player ready for a manual retry',async()=>{
  const env=environment(),blocked=[],player=new env.YouTubeSource(env.container,{onAutoplayBlocked:event=>blocked.push(event.errorCode)});
  await player.loadUrl('https://youtu.be/qGEPPNTTYmk');const frame=env.container.children[0],native=env.players[0];
  const playing=player.playConfirmed();native.options.events.onAutoplayBlocked();
  await assert.rejects(playing,error=>error.code==='youtube_autoplay_blocked' && /Pulsa Reproducir/.test(error.message));
  assert.deepEqual(blocked,['youtube_autoplay_blocked']);assert.equal(player.error.code,'youtube_autoplay_blocked');assert.equal(player.ready,true);assert.equal(env.container.children[0],frame);
  const retry=player.playConfirmed();native.options.events.onStateChange({data:1});await retry;assert.equal(player.error,null);player.destroy();
});

test('confirmed play timeout and embed errors never masquerade as successful playback or clear the video',async()=>{
  const env=environment(),errors=[],player=new env.YouTubeSource(env.container,{onError:error=>errors.push(error.code)});
  await player.loadUrl('https://youtu.be/qGEPPNTTYmk');const frame=env.container.children[0];
  await assert.rejects(player.playConfirmed(10),error=>error.code==='youtube_playback_timeout');
  assert.equal(player.snapshot().errorCode,'youtube_playback_timeout');assert.equal(env.container.children[0],frame);assert.equal(player.ready,true);
  const playing=player.playConfirmed();env.players[0].options.events.onError({data:150});
  await assert.rejects(playing,error=>error.code==='youtube_embed_forbidden');assert.equal(player.ready,false);assert.deepEqual(errors,['youtube_embed_forbidden']);assert.equal(env.container.children[0],frame);
  await assert.rejects(player.playConfirmed(),error=>error.code==='youtube_embed_forbidden');player.destroy();
});

test('pause, destroy and stale playback events cannot complete a waiting play confirmation',async()=>{
  const env=environment(),player=new env.YouTubeSource(env.container);await player.loadUrl('https://youtu.be/qGEPPNTTYmk');
  let playing=player.playConfirmed();player.pause();await assert.rejects(playing,error=>error.code==='youtube_playback_paused');
  playing=player.playConfirmed();const native=env.players[0];player.destroy();await assert.rejects(playing,error=>error.code==='youtube_cancelled');
  native.options.events.onStateChange({data:1});assert.equal(player.ready,false);assert.equal(player.state,'unstarted');assert.equal(env.container.children.length,0);
  await assert.rejects(player.playConfirmed(),error=>error.code==='youtube_not_ready');
});

test('an explicit play unmutes YouTube before requesting playback without enabling autoplay at load',async()=>{
  const env=environment(),player=new env.YouTubeSource(env.container);await player.loadUrl('https://youtu.be/qGEPPNTTYmk');
  const native=env.players[0];native.unMute=()=>native.calls.push(['unmute']);
  assert.equal(new URL(env.container.children[0].src).searchParams.get('autoplay'),'0');assert.equal(native.calls.filter(call=>call[0]==='play').length,0);
  const playing=player.playConfirmed();assert.deepEqual(native.calls.slice(-2),[['unmute'],['play']]);native.options.events.onStateChange({data:1});await playing;player.destroy();
});
