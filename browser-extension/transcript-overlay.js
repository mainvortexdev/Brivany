/* Live ASR text, independent of translated speech and its playback buffer. */
export class TranscriptOverlay {
 constructor({root,video,now=()=>performance.now(),onFirst=()=>{}}){
  this.root=root;this.video=video;this.now=now;this.onFirst=onFirst;this.started=now();this.visible=true;this.first=null;this.closed=false;
  this.node=document.createElement('p');this.node.className='source-transcript';this.node.hidden=true;
  this.node.setAttribute('role','status');this.node.setAttribute('aria-live','polite');this.node.setAttribute('dir','auto');
  this.node.style.cssText='position:fixed;box-sizing:border-box;margin:0;padding:10px 16px;border-radius:12px;background:#101216ed;color:#fff;font:500 17px/1.42 Segoe UI,sans-serif;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;box-shadow:0 2px 14px #0003;max-height:100px;overflow:hidden;';
  root.append(this.node);this.fit=()=>this.position();
  window.addEventListener('resize',this.fit);window.addEventListener('scroll',this.fit,true);
  this.onFullscreen=()=>{const container=document.fullscreenElement;if(container?.contains(video)&&container!==video)container.append(root.host);else document.documentElement.append(root.host);this.position();};
  document.addEventListener('fullscreenchange',this.onFullscreen);
 }
 position(){
  if(this.closed)return;
  const r=this.video.getBoundingClientRect(),width=Math.max(180,Math.min(880,r.width-24,innerWidth-24));
  this.node.style.width=width+'px';this.node.style.left=Math.max(12,Math.min(innerWidth-width-12,r.left+(r.width-width)/2))+'px';
  this.node.style.top=Math.max(12,Math.min(innerHeight-120,r.bottom-145))+'px';
 }
 receive(event){
  if(this.closed||event?.type!=='transcript'||event.source!=='original'||typeof event.text!=='string'||!event.text.trim())return false;
  this.node.textContent=event.text.slice(-800);this.node.hidden=!this.visible;this.position();
  if(this.first===null){this.first=Math.max(0,this.now()-this.started);this.root.host.dataset.brivanyFirstTranscriptMs=String(Math.round(this.first));this.onFirst(this.first);}
  return true;
 }
 setVisible(value){this.visible=value!==false;this.node.hidden=!this.visible||!this.node.textContent;}
 close(){if(this.closed)return;this.closed=true;window.removeEventListener('resize',this.fit);window.removeEventListener('scroll',this.fit,true);document.removeEventListener('fullscreenchange',this.onFullscreen);this.node.textContent='';this.node.remove();}
}
