/* Bound worklet bursts without dropping speech or starting a timeout at setup. */
export class PCMSender{
 constructor({send,fail,clock=()=>performance.now(),schedule=true,maxQueued=75,ackTimeout=4000}){
  this.send=send;this.fail=fail;this.clock=clock;this.maxQueued=maxQueued;this.ackTimeout=ackTimeout;this.queue=[];this.pending=new Map();this.sequence=0;this.nextAt=null;this.closed=false;
  if(schedule)this.timer=setInterval(()=>this.pump(),10);
 }
 enqueue(raw){if(this.closed)return;if(!(raw instanceof ArrayBuffer)||raw.byteLength!==3840)return this.reject('El video entregó audio incompleto.');if(this.queue.length>=this.maxQueued)return this.reject('La conexión acumuló demasiado audio. Vuelve a marcar el video.');this.queue.push(raw);this.pump();}
 acknowledge(sequence){if(this.closed||!Number.isInteger(sequence))return;this.pending.delete(sequence);this.pump();}
 pause(){this.queue.length=0;}
 pump(){
  if(this.closed)return;const now=this.clock(),oldest=this.pending.values().next().value;
  if(oldest!==undefined&&now-oldest>this.ackTimeout)return this.reject('La conexión dejó de confirmar el audio. Vuelve a marcar el video.');
  if(!this.queue.length||this.pending.size>=4||this.nextAt!==null&&now<this.nextAt)return;
  const sequence=this.sequence++,raw=this.queue.shift();this.pending.set(sequence,now);this.nextAt=(this.nextAt!==null&&now-this.nextAt<80?this.nextAt:now)+80;
  try{this.send({type:'pcm',sequence,data:btoa(String.fromCharCode(...new Uint8Array(raw)))});}catch{this.reject('Se perdió la conexión con Brivany.');}
 }
 reject(message){if(this.closed)return;this.close();this.fail(message);}
 close(){if(this.closed)return;this.closed=true;clearInterval(this.timer);this.queue.length=0;this.pending.clear();}
}
