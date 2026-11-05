/* Authenticated native intent, one active browser tab, previously granted site. */
import {connectDesktop,reply} from './desktop-connect.js';
const workerBuild='0.4.9-prefix-nav-070';
export class WorkspaceControl{
 constructor({activate,chromeAPI=globalThis.chrome,Socket=globalThis.WebSocket,connect=connectDesktop,authenticate=reply}={}){this.activate=activate;this.chrome=chromeAPI;this.Socket=Socket;this.connect=connect;this.authenticate=authenticate;this.socket=null;this.connecting=false;this.busy=false;}
 async start(){
  if(this.connecting||this.socket?.readyState===1)return;this.connecting=true;
  try{
   const grant=await this.connect();if(grant.selected_video_protocol!==2)return;
   const socket=new this.Socket(grant.workspace_url);this.socket=socket;
   const auth=await this.authenticate(socket,{type:'authenticate',token:grant.token},'authenticated');
   const manifestVersion=this.chrome.runtime?.getManifest?.()?.version;
   if(auth?.client_info_protocol===1&&typeof manifestVersion==='string'&&/^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(manifestVersion)){
    socket.send(JSON.stringify({type:'client-info',manifest_version:manifestVersion,worker_build:workerBuild}));
   }
   socket.addEventListener('message',event=>{let value;try{value=JSON.parse(event.data);}catch{return;}if(value.type==='select-active-video')this.select(value,socket);});
   this.timer=setInterval(()=>{if(socket.readyState===1)socket.send(JSON.stringify({type:'ping'}));},20000);
   socket.addEventListener('close',()=>{clearInterval(this.timer);if(this.socket===socket){this.socket=null;setTimeout(()=>this.start(),2000);}});
  }catch{this.socket?.close();this.socket=null;}finally{this.connecting=false;}
 }
 async select(command,socket){
  if(this.busy||typeof command.request_id!=='string'||!/^[a-f0-9]{32}$/.test(command.request_id))return;
  const answer=(ok,reason='')=>{if(socket.readyState===1)socket.send(JSON.stringify({type:'selection-result',request_id:command.request_id,ok,reason}));};
  if(!Number.isFinite(command.expires_at_ms)||Date.now()>command.expires_at_ms)return answer(false,'expired');
  this.busy=true;
  try{
   const [tab]=await this.chrome.tabs.query({active:true,lastFocusedWindow:true});if(!tab)return answer(false,'no_video_tab');
   if(!tab.url)return answer(false,'site_permission');
   if(!/^https?:/.test(tab.url))return answer(false,'no_video_tab');
   const origin=new URL(tab.url).origin+'/*';if(!await this.chrome.permissions.contains({origins:[origin]}))return answer(false,'site_permission');
   if(Date.now()>command.expires_at_ms)return answer(false,'expired');
   const started=await this.activate(tab)===true;
   answer(started,started?'':'selection_failed');
  }catch{answer(false,'selection_failed');}finally{this.busy=false;}
 }
}
