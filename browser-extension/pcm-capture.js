/* 80 ms of PCM16 mono 24 kHz. No microphone. Timestamp is a sample counter. */
class BrivanyTabPCM extends AudioWorkletProcessor{
  constructor(){
    super();this.active=false;this.frame=new Int16Array(1920);this.index=0;this.phase=0;this.sum=0;this.count=0;this.samples=0;
    this.port.onmessage=event=>{
      if(event.data.flush===true){
        this.active=false;
        if(this.index){this.frame.fill(0,this.index);this.sendFrame();}
        this.port.postMessage({flushed:true});return;
      }
      this.active=event.data.active===true;this.index=0;this.phase=0;this.sum=0;this.count=0;this.samples=0;
    };
  }
  sendFrame(){
    const bytes=new ArrayBuffer(3840),view=new DataView(bytes);
    for(let i=0;i<1920;i++)view.setInt16(i*2,this.frame[i],true);
    this.samples+=1920;
    this.port.postMessage({buffer:bytes,start_sample:this.samples-1920,end_sample:this.samples},[bytes]);
    this.index=0;
  }
  process(inputs){
    const channels=inputs[0];if(!this.active||!channels?.length)return true;
    for(let i=0;i<channels[0].length;i++){
      let sample=0;for(const channel of channels)sample+=channel[i]||0;
      this.sum+=sample/channels.length;this.count++;this.phase+=24000;
      if(this.phase>=sampleRate){this.phase-=sampleRate;const value=Math.max(-1,Math.min(1,this.sum/this.count));this.frame[this.index++]=Math.round(value*(value<0?32768:32767));this.sum=0;this.count=0;
        if(this.index===1920)this.sendFrame();}
    }return true;
  }
}
registerProcessor('brivany-tab-pcm',BrivanyTabPCM);
