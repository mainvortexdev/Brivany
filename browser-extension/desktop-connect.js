/* Loopback bootstrap. Never discovers/scans a user's network or exposes tokens. */
export function reply(socket,message,expected,timeoutMs=3500){return new Promise((resolve,reject)=>{
 let settled=false;const timer=setTimeout(()=>finish(Error('Abre Brivany y vuelve a pulsar la extensión.')),timeoutMs);
 const finish=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);for(const [name,fn] of [['message',read],['open',opened],['close',closed],['error',closed]])socket.removeEventListener(name,fn);error?reject(error):resolve(data);};
 const read=event=>{let data;try{data=JSON.parse(event.data);}catch{return finish(Error('Respuesta local no válida.'));}if(data.type==='error')return finish(Error(data.message||'Brivany rechazó la conexión.'));if(data.type===expected)finish(null,data);};
 const opened=()=>{if(!settled)socket.send(JSON.stringify(message));},closed=()=>finish(Error('Abre Brivany y vuelve a pulsar la extensión.'));
 socket.addEventListener('message',read);socket.addEventListener('close',closed);socket.addEventListener('error',closed);
 if(socket.readyState===1)opened();else socket.addEventListener('open',opened,{once:true});
});}
export async function connectDesktop(endpoint='ws://127.0.0.1:48217/connect'){
 const address=new URL(endpoint);if(address.protocol!=='ws:'||address.hostname!=='127.0.0.1'||address.pathname!=='/connect'||address.username||address.password||address.search||address.hash)throw Error('Dirección local no válida.');
 const socket=new WebSocket(address.href);
 try{
  const response=await reply(socket,{type:'connect',protocol:1},'connected');
  const relay=new URL(response.websocket_url);if(relay.origin!==address.origin||relay.pathname!=='/sync'||relay.search||relay.hash||relay.username||relay.password||typeof response.token!=='string'||response.token.length<16||response.token.length>128)throw Error('Autorización local no válida.');
  const prefix=response.prefix_url===address.origin+'/prefix'?response.prefix_url:null;
  return {...response,prefix_url:prefix,video_url:address.origin+'/video',workspace_url:address.origin+'/workspace',music_url:address.origin+'/music'};
 }finally{socket.close();}
}
