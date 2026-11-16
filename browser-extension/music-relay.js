import {connectDesktop,reply} from './desktop-connect.js';

export class MusicPresenceSession {
 constructor({connect=connectDesktop,socketFactory=url=>new WebSocket(url),now=()=>Date.now()}={}){
  Object.assign(this,{connect,socketFactory,now});this.socket=null;this.opening=null;this.retryAt=0;this.closed=false;this.enabled=false;
 }
 async receive(value){
  if(this.closed||this.now()<this.retryAt)return;
  if(!this.socket){
   if(this.opening)return;
   this.opening=true;
   try{
    const grant=await this.connect();if(this.closed)return;
    const address=new URL(grant.music_url||grant.video_url.replace(/\/video$/,'/music'));
    if(address.protocol!=='ws:'||address.hostname!=='127.0.0.1'||address.pathname!=='/music')throw Error('music endpoint');
    const socket=this.socketFactory(address.href),state=await reply(socket,{type:'authenticate',token:grant.token},'authenticated');
    if(this.closed){socket.close();return}
    if(state.enabled!==true){socket.close();this.retryAt=this.now()+15000;return}
    this.socket=socket;this.enabled=true;socket.addEventListener('close',()=>{if(this.socket===socket)this.socket=null});
   }catch{this.retryAt=this.now()+15000}finally{this.opening=false}
  }
  if(this.socket?.readyState===1)this.socket.send(JSON.stringify(value));
 }
 close(){this.closed=true;this.socket?.close();this.socket=null}
}

export function listenForMusic(runtime=chrome.runtime,factory=()=>new MusicPresenceSession()){
 runtime.onConnect.addListener(port=>{
  if(port.name!=='brivany-music'||port.sender?.id!==runtime.id||!/^https:\/\/(?:www|music)\.youtube\.com\//.test(port.sender?.url||''))return;
  const session=factory();port.onMessage.addListener(value=>{if(value?.type==='music')session.receive(value).catch(()=>{})});port.onDisconnect.addListener(()=>session.close());
 });
}
