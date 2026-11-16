import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {MusicPresenceSession,listenForMusic} from '../music-relay.js';

class Socket {
 constructor(enabled=true){this.readyState=1;this.enabled=enabled;this.events=new Map();this.sent=[];this.closed=false}
 addEventListener(kind,fn){const set=this.events.get(kind)||new Set();set.add(fn);this.events.set(kind,set)}
 removeEventListener(kind,fn){this.events.get(kind)?.delete(fn)}
 send(raw){const value=JSON.parse(raw);this.sent.push(value);if(value.type==='authenticate')queueMicrotask(()=>{for(const fn of [...this.events.get('message')||[]])fn({data:JSON.stringify({type:'authenticated',enabled:this.enabled})})})}
 close(){this.closed=true;this.readyState=3;for(const fn of [...this.events.get('close')||[]])fn()}
}
const grant={music_url:'ws://127.0.0.1:48217/music',token:'synthetic-owned-token'};
test('music relay waits for native opt-in and sends metadata without audio',async()=>{const socket=new Socket();const session=new MusicPresenceSession({connect:async()=>grant,socketFactory:()=>socket});await session.receive({type:'music',video:'abcdefghijk',playing:true});assert.equal(socket.sent.at(-1).type,'music');session.close();assert(socket.closed)});
test('disabled native option closes the socket and bounds reconnect attempts',async()=>{let count=0,now=0;const socket=new Socket(false);const session=new MusicPresenceSession({connect:async()=>{count++;return grant},socketFactory:()=>socket,now:()=>now});await session.receive({type:'music'});await session.receive({type:'music'});assert.equal(count,1);assert(socket.closed);assert.equal(socket.sent.length,1);now=16000;await session.receive({type:'music'});assert.equal(count,2);session.close()});
test('extension music ports accept only their own YouTube tab senders',()=>{let listener,count=0;const runtime={id:'owned',onConnect:{addListener:fn=>listener=fn}};listenForMusic(runtime,()=>{count++;return {receive:async()=>{},close(){}}});const port={name:'brivany-music',sender:{id:'owned',url:'https://www.youtube.com/watch?v=abcdefghijk'},onMessage:{addListener(){}},onDisconnect:{addListener(){}}};listener({...port,sender:{...port.sender,id:'other'}});listener({...port,sender:{...port.sender,url:'https://other.invalid/'}});listener(port);assert.equal(count,1)});
test('YouTube music capture observes playback and metadata, not microphone or UI',()=>{const posted=[],events={},video={paused:false,ended:false,muted:false,volume:.8,currentTime:10,duration:180},response={videoDetails:{videoId:'abcdefghijk',title:'Artista - Canción',author:'Artista - Topic'},microformat:{playerMicroformatRenderer:{category:'Music'}}};const window={ytInitialPlayerResponse:response,postMessage:value=>posted.push(value),addEventListener:(name,fn)=>events[name]=fn};const document={querySelector:selector=>selector==='video'?video:null,addEventListener:(name,fn)=>events[name]=fn};vm.runInNewContext(fs.readFileSync(new URL('../music-presence.js',import.meta.url),'utf8'),{window,document,location:{hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=abcdefghijk',origin:'https://www.youtube.com'},URL,setInterval:()=>1,clearInterval(){}});assert.equal(posted[0].music,true);assert.equal(posted[0].artist,'Artista');assert.equal(posted[0].playing,true);video.paused=true;events.pause();assert.equal(posted.at(-1).playing,false);assert(!JSON.stringify(posted).includes('audio_data'))});
