/* Separate the user's volume from a temporary, smoothly changing music gain. */
(() => {
 function create({read,write,fail=()=>{}}){
  let base=.5,gain=1,target=1,applied=.5,timer=null,queue=Promise.resolve(),pending=0,disposed=false;
  const clamp=value=>Math.max(0,Math.min(1,Number(value)));
  function commit(){
   pending++;
   const task=queue.catch(()=>{}).then(async()=>{if(disposed)return;const value=clamp(base*gain);await write(value);applied=value;});
   queue=task.finally(()=>pending--);queue.catch(fail);return task;
  }
  async function volume(){
   const actual=clamp(await read());
   if(!pending&&Math.abs(actual-applied)>.015){base=actual;applied=actual;if(gain<1)await commit();}
   return base;
  }
  function duck(active){
   const next=active ? .12 : 1;if(next===target||disposed)return;
   target=next;clearTimeout(timer);const from=gain,start=performance.now(),duration=active?650:1500;
   async function step(){
    if(disposed)return;const t=Math.min(1,(performance.now()-start)/duration),ease=t*t*(3-2*t);
    gain=from+(next-from)*ease;
    try{await commit();}catch{}
    if(!disposed&&target===next&&t<1)timer=setTimeout(step,85);
   }
   step();
  }
  return {volume,duck,set:async value=>{base=clamp(value);await commit();},status:()=>({base,gain,target,applied}),dispose:()=>{disposed=true;clearTimeout(timer);}};
 }
 window.BrivanyDuckingVolume={create};
})();
