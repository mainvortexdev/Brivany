const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
const turn=()=>new Promise(setImmediate);
const nonce='0123456789abcdef0123456789abcdef',origin='http://127.0.0.1:8765';

function port(){return {sent:[],closed:false,start(){},postMessage(data,transfer){this.sent.push({data,transfer});},close(){this.closed=true;},emit(data){this.onmessage?.({data});}};}
function events(target={}){const handlers=new Map();return Object.assign(target,{handlers,addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},removeEventListener(type,fn){handlers.get(type)?.delete(fn);},emit(type,event={}){for(const fn of [...(handlers.get(type)||[])])fn(event);}});}
function client({blocked=false}={}){
  const popup={closed:false,sent:[],postMessage(data,where,transfer){this.sent.push({data,where,transfer});},close(){this.closed=true;}};
  const window=events({open:()=>blocked?null:popup}),channels=[];
  class Channel{constructor(){this.port1=port();this.port2=port();channels.push(this);}}
  const context=vm.createContext({window,location:{origin},crypto:crypto.webcrypto,Uint8Array,Int16Array,Float32Array,ArrayBuffer,DOMException,AbortController,MessageChannel:Channel,setTimeout,clearTimeout,setInterval,clearInterval,console});
  vm.runInContext(fs.readFileSync('web/dub-audio-sink-client.js','utf8'),context);
  return {window,popup,channels,open:options=>window.BrivanyDubSink.openSink(options),hello(overrides={}){window.emit('message',{origin,source:popup,data:{type:'brivany-dub-sink-hello',nonce:new URL('http://x'+this.requestURL).searchParams.get('nonce')},...overrides});}};
}
function setupClient(options={}){
  const c=client(options);c.window.open=(url)=>{c.requestURL=url;return options.blocked?null:c.popup;};return c;
}
function sink({allowed=true,search='?nonce='+nonce}={}){
  const nodes=new Map();for(const id of ['listen-state','listen-error','activate-audio','close-listener'])nodes.set(id,events({textContent:'',hidden:false,disabled:false}));
  const opener={sent:[],postMessage(data,where){this.sent.push({data,where});}},audios=[];
  class Audio{constructor(){this.currentTime=10;this.state='suspended';this.destination={};this.sources=[];this.gains=[];audios.push(this);}
    async resume(){if(!allowed)throw new DOMException('gesture','NotAllowedError');this.state='running';}
    createGain(){const value={gain:{value:0},connect(){},disconnect(){this.disconnected=true;}};this.gains.push(value);return value;}
    createBuffer(channels,count,rate){return {duration:count/rate,samples:new Float32Array(count),getChannelData(){return this.samples;}};}
    createBufferSource(){const value={connect(){},disconnect(){this.disconnected=true;},start(when){this.when=when;},stop(){this.stopped=true;}};this.sources.push(value);return value;}
    async close(){this.state='closed';}}
  const window=events({opener,AudioContext:Audio,close(){this.closed=true;}}),channel=port();
  const context=vm.createContext({window,location:{origin,search},document:{getElementById:id=>nodes.get(id)},URLSearchParams,ArrayBuffer,Int16Array,Float32Array,DOMException,setInterval,clearInterval,performance:{timeOrigin:100000,now:()=>250}});
  vm.runInContext(fs.readFileSync('web/dub-audio-sink.js','utf8'),context);
  return {window,nodes,opener,audios,channel,connect(overrides={}){window.emit('message',{origin,source:opener,data:{type:'brivany-dub-sink-connect',nonce},ports:[channel],...overrides});}};
}

test('client handshake requires exact popup, origin and random nonce; PCM transfers a copy',async t=>{
  const c=setupClient(),pending=c.open();t.after(()=>c.popup.close());
  const actualNonce=new URL(origin+c.requestURL).searchParams.get('nonce');assert.match(actualNonce,/^[a-f0-9]{32}$/);
  c.hello({origin:'https://elsewhere.invalid'});c.hello({source:{}});c.hello({data:{type:'brivany-dub-sink-hello',nonce:'0'.repeat(32)}});assert.equal(c.channels.length,0);
  c.hello();assert.equal(c.channels.length,1);const channel=c.channels[0];assert.equal(c.popup.sent[0].transfer[0],channel.port2);
  channel.port1.emit({type:'ready'});const output=await pending;t.after(()=>output.close());
  const samples=new Int16Array([12,-13]),playing=output.playPcm('translation',samples,{sampleRate:24000});const data=channel.port1.sent.at(-1).data;
  assert.notEqual(data.buffer,samples.buffer);assert.deepEqual([...new Int16Array(data.buffer)],[12,-13]);assert.equal(samples.length,2);
  channel.port1.emit({type:'scheduled',id:data.id,generation:0,scheduledAtEpochMs:123});assert.equal((await playing).scheduledAtEpochMs,123);
});

test('client cancellation before ready closes popup and rejects; blocked popup is actionable',async()=>{
  const c=setupClient(),controller=new AbortController(),pending=c.open({signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(c.popup.closed,true);
  await assert.rejects(setupClient({blocked:true}).open(),/Permite la ventana/);
});

test('client stop flushes generations, ignores late schedule and supports original volume',async t=>{
  const c=setupClient(),pending=c.open();c.hello();const p=c.channels[0].port1;p.emit({type:'ready'});const output=await pending;t.after(()=>output.close());
  assert.equal(output.setGain('original',1),1);assert.equal(p.sent.at(-1).data.gain,1);assert.throws(()=>output.setGain('original',1.1));
  const first=output.playPcm('translation',new Int16Array(2400));const packet=p.sent.at(-1).data;output.stop();await assert.rejects(first,{name:'AbortError'});
  assert.equal(p.sent.at(-1).data.type,'stop');assert.equal(p.sent.at(-1).data.generation,1);
  p.emit({type:'scheduled',id:packet.id,generation:0});
  const next=output.playPcm('translation',new Int16Array(2400));const nextPacket=p.sent.at(-1).data;assert.equal(nextPacket.generation,1);
  p.emit({type:'scheduled',id:nextPacket.id,generation:1});await next;
  await assert.rejects(output.playPcm('original',new Int16Array(48001)),/demasiado/);
});

test('sink rejects wrong origin, wrong opener and nonce before constructing audio',async()=>{
  const s=sink();s.connect({origin:'https://elsewhere.invalid'});s.connect({source:{}});s.connect({data:{type:'brivany-dub-sink-connect',nonce:'0'.repeat(32)}});assert.equal(s.audios.length,0);
  s.connect();await turn();assert.equal(s.audios.length,1);assert.ok(s.channel.sent.some(({data})=>data.type==='ready'));s.window.emit('pagehide');
  const invalid=sink({search:'?nonce=private-key'});invalid.connect();assert.equal(invalid.audios.length,0);assert.equal(invalid.nodes.get('activate-audio').disabled,true);
});

test('autoplay denial asks for explicit activation and schedules no hidden audio',async()=>{
  const s=sink({allowed:false});s.connect();await turn();assert.equal(s.nodes.get('activate-audio').hidden,false);assert.ok(s.channel.sent.some(({data})=>data.type==='activation-required'));
  s.channel.emit({type:'pcm',id:1,generation:0,kind:'translation',gain:.8,sampleRate:24000,format:'s16',buffer:new Int16Array(10).buffer});
  assert.equal(s.audios[0].sources.length,0);assert.equal(s.channel.sent.at(-1).data.type,'error');s.window.emit('pagehide');
});

test('sink queue is bounded, source gain capped and stop prevents stale language audio',async()=>{
  const s=sink();s.connect();await turn();const audio=s.audios[0];
  const packet=(id,changes={})=>({type:'pcm',id,generation:0,kind:'translation',gain:.85,sampleRate:24000,format:'s16',buffer:new Int16Array(24000).buffer,...changes});
  s.channel.emit(packet(1));s.channel.emit(packet(2));s.channel.emit(packet(3));assert.equal(audio.sources.length,3);
  s.channel.emit(packet(4));assert.equal(audio.sources.length,3);assert.match(s.channel.sent.at(-1).data.message,/demasiado audio/);
  s.channel.emit(packet(5,{kind:'original',gain:1.1}));assert.equal(audio.sources.length,3);
  s.channel.emit({type:'gain',generation:0,kind:'translation',gain:.4});assert.equal(audio.gains[1].gain.value,.4);
  s.channel.emit({type:'stop',generation:1});assert.ok(audio.sources.every(source=>source.stopped && source.disconnected));
  s.channel.emit(packet(6));assert.equal(audio.sources.length,3);assert.equal(s.channel.sent.at(-1).data.type,'error');
  s.channel.emit(packet(7,{generation:1}));assert.equal(audio.sources.length,4);assert.equal(s.channel.sent.at(-1).data.timingScope,'browser_audio_context_schedule_not_physical_output');
  s.window.emit('pagehide');assert.equal(audio.state,'closed');assert.ok(audio.gains.every(gain=>gain.disconnected));assert.equal(s.channel.closed,true);
});

test('translation-only flush keeps original monitoring sources and pending acknowledgement alive',async t=>{
  const c=setupClient(),pending=c.open();c.hello();const p=c.channels[0].port1;p.emit({type:'ready'});const output=await pending;t.after(()=>output.close());
  const original=output.playPcm('original',new Int16Array(2400)),originalPacket=p.sent.at(-1).data;
  const translated=output.playPcm('translation',new Int16Array(2400));output.stop('translation');await assert.rejects(translated,{name:'AbortError'});
  assert.equal(p.sent.at(-1).data.kind,'translation');p.emit({type:'scheduled',id:originalPacket.id,generation:0});await original;
  const s=sink();s.connect();await turn();const audio=s.audios[0];
  for(const [index,kind] of ['original','translation'].entries())s.channel.emit({type:'pcm',id:index+1,generation:0,kind,gain:.15,sampleRate:24000,format:'s16',buffer:new Int16Array(2400).buffer});
  s.channel.emit({type:'stop',generation:1,kind:'translation'});assert.equal(audio.sources[0].stopped,undefined);assert.equal(audio.sources[1].stopped,true);s.window.emit('pagehide');
});
