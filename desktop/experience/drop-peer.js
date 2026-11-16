/* Shared desktop/phone engine. Bounded encrypted packets; never whole-file buffers. */
(() => {
 'use strict';
 const BLOCK=256*1024,FRAME=16*1024-12,WINDOW=8,MAX=20_000_000_000,MAX_FILES=1000,MAX_TOTAL=MAX,encoder=new TextEncoder(),decoder=new TextDecoder();
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const unbase=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
 const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
 const nameOK=name=>typeof name==='string'&&name.length>0&&name.length<=180&&!name.startsWith('.')&&!/[\\/\x00-\x1f<>:"|?*]/.test(name)&&!/[. ]$/.test(name)&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);
 const batchOK=b=>b&&/^[a-f0-9]{32}$/.test(b.id)&&Number.isSafeInteger(b.count)&&b.count>=1&&b.count<=MAX_FILES&&Number.isSafeInteger(b.total)&&b.total>=0&&b.total<=MAX_TOTAL&&Number.isSafeInteger(b.index)&&b.index>=1&&b.index<=b.count;
 const metaOK=m=>m&&/^[a-f0-9]{32}$/.test(m.id)&&nameOK(m.name)&&Number.isSafeInteger(m.size)&&m.size>=0&&m.size<=MAX&&(m.batch===undefined||batchOK(m.batch)&&m.size<=m.batch.total);
 const failures={storage_unavailable:'Abre el enlace en Safari para recibir archivos grandes.',storage_full:'No hay espacio suficiente en el teléfono.',storage_timeout:'El almacenamiento no respondió. Inténtalo de nuevo.',storage_failed:'No se pudo guardar el archivo. Inténtalo de nuevo.',receiver_failed:'No se pudo preparar la recepción. Inténtalo de nuevo.'};
 const failureCode=error=>Object.hasOwn(failures,error?.code)?error.code:'receiver_failed';
 class DropPeer {
  constructor(options){
   this.options=options;this.id=options.id;this.role=options.role;this.closed=false;this.peerPresent=false;this.ws=null;this.pc=null;this.channel=null;this.tx=null;this.rx=null;this.pending=null;this.completed=new Map();this.seen=new Set();this.queue=Promise.resolve();this.encryptQueue=Promise.resolve();this.frame=null;this.frameSequence=0;this.retry=0;this.rtcSerial=0;this.ice=[];this.key=crypto.subtle.importKey('raw',unbase(options.key),'AES-GCM',false,['encrypt','decrypt']);this.metrics={maxRead:0,maxPacket:0,maxInFlight:0,received:0,sent:0,resumes:0,directBytes:0,relayBytes:0};this.started=false;
  }
  state(state,detail={}){if(!this.closed)this.options.onstate?.({state,...detail,transport:this.channel?.readyState==='open'?'direct':'relay'})}
  checkBatch(meta){
   const b=meta.batch;if(!b){if(this.incomingBatch)throw Error('El lote cambió.');return}
   if(!this.incomingBatch){if(b.index!==1)throw Error('El lote perdió su posición.');this.incomingBatch={id:b.id,count:b.count,total:b.total,index:0,bytes:0}}
   const current=this.incomingBatch;
   if(b.id!==current.id||b.count!==current.count||b.total!==current.total||b.index!==current.index+1||current.bytes+meta.size>current.total||(b.index===b.count&&current.bytes+meta.size!==current.total))throw Error('El lote supera sus límites o cambió.');
  }
  preview(active,count=0,edge='right'){
   if(this.closed||!this.peerPresent||typeof active!=='boolean'||!Number.isInteger(count)||count<0||count>MAX_FILES||!['left','right','top','bottom'].includes(edge))return;
   const signature=JSON.stringify([active,count,edge]),now=performance.now();
   if(this.lastPreview===signature&&now-this.previewAt<900)return;
   this.lastPreview=signature;this.previewAt=now;this.send({type:'edge',active,count:active?count:0,edge},null,'relay').catch(()=>{});
  }
  start(){if(this.started)return;this.started=true;this.connect()}
  connect(){
   if(this.closed)return;this.state(this.retry?'reconnecting':'connecting');const protocols=['brivany-drop-v2'];if(this.role==='desktop')protocols.push('owner.'+this.options.owner);
   const socket=new WebSocket(this.options.socket,protocols);this.ws=socket;socket.binaryType='arraybuffer';
   socket.onopen=()=>{if(this.closed)return socket.close();this.retry=0;clearInterval(this.ping);this.ping=setInterval(()=>{if(socket.readyState===1)socket.send('ping')},25000)};
   socket.onmessage=event=>{
    if(this.closed||this.ws!==socket)return;
    if(typeof event.data==='string'){
     if(event.data==='pong')return;let value;try{value=JSON.parse(event.data)}catch{return}
     if(value.server==='ended'){this.options.onended?.();this.close();return}
     if(value.server==='ready'){
      this.peerPresent=value.peer===true;
      if(this.peerPresent){this.state('connected');this.send({type:'hello'},null,'relay').catch(()=>{});if(this.role==='desktop')this.negotiate().catch(()=>{});this.announce()}
      else this.state(this.tx||this.rx?'reconnecting':'waiting');
     }
     return;
    }
    this.enqueue(event.data,'relay');
   };
   socket.onclose=()=>{
    if(this.ws!==socket||this.closed)return;clearInterval(this.ping);this.peerPresent=false;this.interrupt();this.state('reconnecting');
    if(this.retry++>=10){this.state('failed');this.options.onerror?.('No se pudo restablecer la conexión.');return}
    clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.connect(),Math.min(8000,500*2**Math.min(this.retry,4)));
   };
   socket.onerror=()=>{};
  }
  async encrypt(header,data){
   const text=encoder.encode(JSON.stringify(header));if(text.length>2048)throw Error('Mensaje demasiado grande.');const bytes=data?new Uint8Array(data):new Uint8Array(),plain=new Uint8Array(2+text.length+bytes.length);new DataView(plain.buffer).setUint16(0,text.length);plain.set(text,2);plain.set(bytes,2+text.length);const nonce=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:encoder.encode('BrivanyDrop-v2:'+this.id+':'+this.role)},await this.key,plain));const packet=new Uint8Array(12+cipher.length);packet.set(nonce);packet.set(cipher,12);this.metrics.maxPacket=Math.max(this.metrics.maxPacket,packet.length);return packet;
  }
  async send(header,data,route='auto'){
   if(this.closed)throw Error('Conexión cerrada.');const packet=await this.encrypt(header,data);
   // Serialize packet fragments so async encryption never interleaves two frames.
   const task=this.encryptQueue.catch(()=>{}).then(()=>this.wire(packet,route));this.encryptQueue=task;return task;
  }
  async wire(packet,route){
   if(this.closed)throw Error('Conexión cerrada.');const dc=this.channel;
   if(route==='direct'&&dc?.readyState!=='open')throw Error('Conexión interrumpida.');
   if(route!=='relay'&&dc?.readyState==='open'){
    const sequence=++this.frameSequence;
    for(let offset=0;offset<packet.length;offset+=FRAME){
     while(dc.bufferedAmount>256*1024){if(this.closed||dc.readyState!=='open')throw Error('Conexión interrumpida.');await sleep(4)}
     const part=packet.subarray(offset,offset+FRAME),frame=new Uint8Array(12+part.length),view=new DataView(frame.buffer);view.setUint32(0,sequence);view.setUint32(4,packet.length);view.setUint32(8,offset);frame.set(part,12);dc.send(frame);
    }this.metrics.directBytes+=packet.length;
   }else{
    const socket=this.ws;if(socket?.readyState!==1||!this.peerPresent)throw Error('Conexión interrumpida.');
    while(socket.bufferedAmount>512*1024){if(this.closed||socket.readyState!==1)throw Error('Conexión interrumpida.');await sleep(8)}socket.send(packet);this.metrics.relayBytes+=packet.length;
   }
  }
  enqueue(packet,route){
   this.queue=this.queue.then(async()=>{
    if(this.closed)return;if(!(packet instanceof ArrayBuffer)||packet.byteLength<28||packet.byteLength>BLOCK+4096)throw Error('Paquete no válido.');
    const encrypted=new Uint8Array(packet),nonce=hex(encrypted.subarray(0,12));if(this.seen.has(nonce))return;this.seen.add(nonce);if(this.seen.size>4096)this.seen.delete(this.seen.values().next().value);
    const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:encrypted.subarray(0,12),additionalData:encoder.encode('BrivanyDrop-v2:'+this.id+':'+(this.role==='desktop'?'phone':'desktop'))},await this.key,encrypted.subarray(12))),length=new DataView(plain.buffer).getUint16(0);if(!length||length>2048||length+2>plain.length)throw Error('Mensaje no válido.');
    const value=JSON.parse(decoder.decode(plain.subarray(2,2+length)));await this.handle(value,plain.subarray(2+length),route);
   }).catch(async error=>{const reason=error.storageFailure?failureCode(error):null;this.options.onfailure?.({name:error.name||'Error',code:reason,message:String(error.message||'').slice(0,180)});await this.cancelCurrent(reason).catch(()=>{});this.state('failed',reason?{failure:reason}:{});this.options.onerror?.(reason?failures[reason]:'No se pudo verificar el envío.')});
  }
  setupRTC(){
   if(this.rtcDisabled||typeof RTCPeerConnection!=='function')return null;
   const serial=++this.rtcSerial;if(this.pc)this.pc.close();this.channel=null;this.frame=null;this.ice=[];
   const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]});this.pc=pc;
   pc.onicecandidate=event=>{if(event.candidate){const c=event.candidate;this.send({type:'ice',candidate:{candidate:c.candidate,sdpMid:c.sdpMid,sdpMLineIndex:c.sdpMLineIndex,usernameFragment:c.usernameFragment}},null,'relay').catch(()=>{})}};
   pc.ondatachannel=event=>this.channelReady(event.channel,serial);
   pc.onconnectionstatechange=()=>{if(this.rtcSerial!==serial||this.closed)return;if(['failed','disconnected'].includes(pc.connectionState)){this.channel=null;this.frame=null;this.interrupt();this.announce();this.state(this.tx||this.rx?'reconnecting':'connected')}};
   return pc;
  }
  async negotiate(){
   if(this.options.forceRelay||this.rtcDisabled||this.closed||this.role!=='desktop'||!this.peerPresent)return;if(this.pc&&['connecting','connected','new'].includes(this.pc.connectionState))return;
   try{const pc=this.setupRTC();if(!pc)return;const dc=pc.createDataChannel('brivany-drop-v2',{ordered:true});this.channelReady(dc,this.rtcSerial);await pc.setLocalDescription(await pc.createOffer());await this.send({type:'sdp',description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}},null,'relay')}catch{this.disableRTC()}
  }
  disableRTC(){this.rtcDisabled=true;this.rtcSerial++;try{this.channel?.close();this.pc?.close()}catch{}this.channel=null;this.pc=null;this.frame=null;this.ice=[];if(this.tx){this.interrupt();this.announce()}}
  channelReady(channel,serial){
   channel.binaryType='arraybuffer';this.channel=channel;
   channel.onopen=()=>{if(serial===this.rtcSerial&&!this.closed&&!this.tx&&!this.rx)this.state('connected')};
   channel.onmessage=event=>{
    if(serial!==this.rtcSerial||this.closed)return;const frame=new Uint8Array(event.data);if(frame.length<13||frame.length>16*1024)return this.failFrame();const view=new DataView(frame.buffer),sequence=view.getUint32(0),length=view.getUint32(4),offset=view.getUint32(8);
    if(length<28||length>BLOCK+4096||offset+frame.length-12>length)return this.failFrame();
    if(offset===0)this.frame={sequence,bytes:new Uint8Array(length),offset:0};const current=this.frame;
    if(!current||sequence!==current.sequence||current.bytes.length!==length||current.offset!==offset)return this.failFrame();current.bytes.set(frame.subarray(12),offset);current.offset+=frame.length-12;
    if(current.offset===length){this.frame=null;this.enqueue(current.bytes.buffer,'direct')}
   };
   channel.onclose=()=>{if(serial!==this.rtcSerial||this.closed)return;this.channel=null;this.frame=null;this.interrupt();this.announce()};
  }
  failFrame(){try{this.channel?.close()}catch{}this.frame=null;this.interrupt();this.announce()}
  async handle(value,data,route){
   if(!value||typeof value.type!=='string')throw Error('Mensaje no válido.');
   if(value.type==='edge'){
    if(data.length||typeof value.active!=='boolean'||!Number.isInteger(value.count)||value.count<0||value.count>MAX_FILES||!['left','right','top','bottom'].includes(value.edge))return;
    this.options.onedge?.({active:value.active,count:value.active?value.count:0,edge:value.edge});return;
   }
   if(value.type==='sdp'){
    if(this.options.forceRelay||this.rtcDisabled)return;const description=value.description;if(!description||!['offer','answer'].includes(description.type)||typeof description.sdp!=='string'||description.sdp.length>16000)return;
    // Direct transport is optional. A WebKit preview with no WebRTC, or an SDP
    // incompatibility, must keep the encrypted relay and the accepted file alive.
    try{let pc=this.pc;if(description.type==='offer'){if(this.role!=='phone')return;pc=this.setupRTC()}if(!pc)return;await pc.setRemoteDescription(description);for(const candidate of this.ice.splice(0))await pc.addIceCandidate(candidate);
    if(description.type==='offer'){await pc.setLocalDescription(await pc.createAnswer());await this.send({type:'sdp',description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}},null,'relay')}}catch{this.disableRTC()}return;
   }
   if(value.type==='ice'){if(this.options.forceRelay||this.rtcDisabled||!value.candidate||JSON.stringify(value.candidate).length>2048)return;if(this.pc?.remoteDescription){try{await this.pc.addIceCandidate(value.candidate)}catch{this.disableRTC()}}else if(this.ice.length<32)this.ice.push(value.candidate);return}
   if(value.type==='hello'){this.announce();return}
   if(value.type==='file'){
    const meta=value.file;if(!metaOK(meta))throw Error('Archivo no válido.');
    if(this.completed.has(meta.id)){await this.send({type:'done',id:meta.id});return}
    if(this.rx?.meta.id===meta.id){if(this.rx.meta.size!==meta.size||this.rx.meta.name!==meta.name)throw Error('Cambió el archivo.');await this.send({type:'accept',id:meta.id,offset:this.rx.offset});return}
    if(this.pending?.id===meta.id)return;if(this.rx||this.pending||this.tx){await this.send({type:'decline',id:meta.id});return}
    this.checkBatch(meta);this.pending=meta;this.requestAcceptance(meta);return;
   }
   if(value.type==='accept'){
    const tx=this.tx;if(!tx||value.id!==tx.meta.id||!Number.isSafeInteger(value.offset)||value.offset<0||value.offset>tx.meta.size)return;
    tx.version++;tx.acked=tx.next=value.offset;tx.blocks=[];tx.lastAck=Date.now();this.wake(tx);const version=tx.version;this.pump(tx,version).catch(()=>{if(this.tx===tx&&!this.closed){this.interrupt();this.state('reconnecting');setTimeout(()=>this.announce(),1000)}});return;
   }
   if(value.type==='block'){
    const rx=this.rx;if(!rx||value.id!==rx.meta.id)return;
    if(!Number.isSafeInteger(value.offset)||data.length<1||data.length>BLOCK||value.offset+data.length>rx.meta.size)throw Error('Bloque no válido.');
    if(value.offset<rx.offset){await this.send({type:'ack',id:rx.meta.id,offset:rx.offset});return}
    if(value.offset!==rx.offset)throw Error('El bloque perdió su posición.');const digest=hex(await crypto.subtle.digest('SHA-256',data));if(digest!==value.sha256)throw Error('El bloque cambió.');
    try{await rx.sink.write(rx.offset,data,digest)}catch(error){error.storageFailure=true;throw error}rx.offset+=data.length;this.metrics.received+=data.length;this.progress(rx,'receiving');await this.send({type:'ack',id:rx.meta.id,offset:rx.offset});return;
   }
   if(value.type==='ack'){
    const tx=this.tx;if(!tx||value.id!==tx.meta.id||!Number.isSafeInteger(value.offset)||value.offset<tx.acked||value.offset>tx.next)return;tx.acked=value.offset;tx.lastAck=Date.now();tx.blocks=tx.blocks.filter(end=>end>tx.acked);this.progress(tx,'sending');this.wake(tx);return;
   }
   if(value.type==='finish'){
    if(this.completed.has(value.id)){await this.send({type:'done',id:value.id});return}const rx=this.rx;if(!rx||value.id!==rx.meta.id||rx.offset!==rx.meta.size)return;
    let result;try{result=await rx.sink.finish()}catch(error){error.storageFailure=true;throw error}this.completed.set(rx.meta.id,true);if(this.completed.size>MAX_FILES)this.completed.delete(this.completed.keys().next().value);this.rx=null;
    if(rx.meta.batch){this.incomingBatch.index++;this.incomingBatch.bytes+=rx.meta.size;if(this.incomingBatch.index===this.incomingBatch.count)this.incomingBatch=null}
    this.options.onreceived?.(rx.meta,result);this.state('received');await this.send({type:'done',id:value.id});return;
   }
   if(value.type==='done'){
    const tx=this.tx;if(!tx||value.id!==tx.meta.id)return;tx.version++;this.wake(tx);this.tx=null;this.options.onsent?.(tx.meta);this.state('sent');return;
   }
   if(value.type==='decline'||value.type==='cancel'){
    if(this.tx?.meta.id!==value.id&&this.rx?.meta.id!==value.id&&this.pending?.id!==value.id)return;
    this.incomingBatch=null;
    if(this.tx?.meta.id===value.id){const tx=this.tx;tx.version++;this.wake(tx);this.tx=null;this.options.oncancel?.(tx.meta,'sending')}
    if(this.rx?.meta.id===value.id){const rx=this.rx;this.rx=null;await rx.sink.abort();this.options.oncancel?.(rx.meta,'receiving')}
    if(this.pending?.id===value.id){this.options.ondismiss?.(this.pending);this.pending=null}const reason=Object.hasOwn(failures,value.reason)?value.reason:null;this.state(reason?'failed':'declined',reason?{failure:reason}:{});if(reason)this.options.onerror?.(failures[reason]);return;
   }
  }
  async requestAcceptance(meta){
   let sink;
   try{sink=await this.options.accept(meta);if(this.closed||this.pending!==meta){await sink?.abort();return}if(!sink)throw Object.assign(Error('Rechazado.'),{declined:true})}
   catch(error){if(this.pending===meta){this.pending=null;this.incomingBatch=null;this.options.ondismiss?.(meta);const reason=error.declined?null:failureCode(error);this.send({type:'decline',id:meta.id,...(reason?{reason}:{})}).catch(()=>{});this.state(reason?'failed':'declined',reason?{failure:reason}:{});if(reason){this.options.onfailure?.({name:error.name||'Error',code:reason});this.options.onerror?.(failures[reason])}}return}
   this.pending=null;this.rx={meta,sink,offset:Number(sink.offset)||0,started:performance.now(),lastProgress:0};
   // Keep the accepted sink if the network drops before this reply. The next
   // file announcement resumes it instead of opening or truncating it again.
   try{await this.send({type:'accept',id:meta.id,offset:this.rx.offset});if(this.rx?.meta===meta)this.progress(this.rx,'receiving',true)}catch{this.state('reconnecting')}
  }
  offer(meta,read){
   if(!metaOK(meta)||typeof read!=='function')throw Error('El archivo admite hasta 20 GB.');if(this.tx||this.rx||this.pending)throw Error('Termina o cancela el archivo actual.');
   this.tx={meta,read,acked:0,next:0,blocks:[],version:0,started:performance.now(),lastProgress:0,wakers:[]};this.announce();return meta.id;
  }
  announce(){if(this.tx&&this.peerPresent&&this.ws?.readyState===1)this.send({type:'file',file:this.tx.meta},null,'relay').catch(()=>{})}
  interrupt(){if(this.tx){this.tx.version++;this.metrics.resumes++;this.wake(this.tx)}}
  wake(tx){for(const resolve of tx.wakers.splice(0))resolve()}
  wait(tx){return new Promise(resolve=>{const timer=setTimeout(()=>{const i=tx.wakers.indexOf(done);if(i>=0)tx.wakers.splice(i,1);resolve()},1500);const done=()=>{clearTimeout(timer);resolve()};tx.wakers.push(done)})}
  async pump(tx,version){
   // Give direct ICE a short opportunity to connect before using the HTTPS relay.
   const until=this.directWaitUntil??(this.directWaitUntil=Date.now()+1200);while(!this.options.forceRelay&&this.channel?.readyState!=='open'&&Date.now()<until&&this.tx===tx&&!this.closed)await sleep(30);
   let route=this.channel?.readyState==='open'&&!this.options.forceRelay?'direct':'relay';this.progress(tx,'sending',true);
   while(this.tx===tx&&tx.version===version&&!this.closed){
    if(tx.acked===tx.meta.size){await this.send({type:'finish',id:tx.meta.id},null,route);await this.wait(tx);continue}
    if(Date.now()-tx.lastAck>12000){this.interrupt();this.announce();return}
    // Drain acknowledged blocks before upgrading paths, so a late ICE result
    // accelerates a large file without reordering data from the two routes.
    if(route==='relay'&&!this.options.forceRelay&&this.channel?.readyState==='open'){
     if(tx.blocks.length){await this.wait(tx);continue}route='direct';
    }
    if(tx.blocks.length>=WINDOW||tx.next===tx.meta.size){await this.wait(tx);continue}
    const offset=tx.next,length=Math.min(BLOCK,tx.meta.size-offset);let data;
    try{data=new Uint8Array(await tx.read(offset,length));if(data.length!==length)throw Error('Lectura incompleta.')}
    catch{if(this.tx!==tx||version!==tx.version)return;this.options.onerror?.('El archivo cambió o ya no se puede leer.');await this.cancelCurrent();this.state('failed');return}
    if(this.tx!==tx||version!==tx.version)return;
    this.metrics.maxRead=Math.max(this.metrics.maxRead,data.length);const digest=hex(await crypto.subtle.digest('SHA-256',data));tx.next+=data.length;tx.blocks.push(tx.next);this.metrics.maxInFlight=Math.max(this.metrics.maxInFlight,tx.blocks.length*BLOCK);await this.send({type:'block',id:tx.meta.id,offset,sha256:digest},data,route);this.metrics.sent+=data.length;
   }
  }
  progress(file,direction,force=false){const now=performance.now();if(!force&&now-file.lastProgress<200&&((direction==='sending'?file.acked:file.offset)!==file.meta.size))return;file.lastProgress=now;const done=direction==='sending'?file.acked:file.offset;this.options.onprogress?.({id:file.meta.id,name:file.meta.name,size:file.meta.size,done,direction,bytesPerSecond:done/Math.max(.1,(now-file.started)/1000)});this.state(direction,{progress:{name:file.meta.name,size:file.meta.size,done,direction}})}
  async cancelCurrent(reason=null){
   this.incomingBatch=null;
   const file=this.tx||this.rx||this.pending;if(!file)return;const meta=file.meta||file,rx=this.rx,pending=this.pending;
   if(this.tx){this.tx.version++;this.wake(this.tx)}this.tx=null;this.rx=null;this.pending=null;
   if(pending)this.options.ondismiss?.(pending);if(rx)await rx.sink.abort().catch(()=>{});this.options.oncancel?.(meta);this.state('connected');await this.send({type:'cancel',id:meta.id,...(Object.hasOwn(failures,reason)?{reason}:{})}).catch(()=>{});
  }
  close(){
   this.incomingBatch=null;
   if(this.closed)return;this.closed=true;clearInterval(this.ping);clearTimeout(this.retryTimer);if(this.tx){this.tx.version++;this.wake(this.tx)}this.tx=null;if(this.rx)this.rx.sink.abort().catch(()=>{});this.rx=null;if(this.pending)this.options.ondismiss?.(this.pending);this.pending=null;this.rtcSerial++;try{this.channel?.close();this.pc?.close();this.ws?.close()}catch{}this.options.key=this.options.owner=null;this.key=null;this.frame=null;this.seen.clear();
  }
 }
 window.BrivanyDropPeer={DropPeer,MAX,MAX_FILES,MAX_TOTAL,BLOCK,nameOK,metaOK,hex,unbase,failures};
})();
