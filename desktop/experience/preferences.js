(() => {
 const defaults={theme:'light',chatSize:'normal',language:'es-ES',rate:1.05,quiet:false,autoReply:true,voiceNotices:true,threshold:.025};
 const valid=(key,value)=>key==='theme'?['light','dark','system'].includes(value):key==='chatSize'?['normal','large'].includes(value):key==='language'?['es-ES','en-US'].includes(value):key==='rate'?typeof value==='number'&&value>=.75&&value<=1.15:key==='threshold'?typeof value==='number'&&value>=.01&&value<=.08:['quiet','autoReply','voiceNotices'].includes(key)&&typeof value==='boolean';
 let owner;try{owner=parent.location.origin===location.origin?parent:window;}catch{owner=window;}
 const read=()=>{try{const saved=JSON.parse(localStorage.getItem('brivany.preferences')||'{}');return {...defaults,...Object.fromEntries(Object.entries(saved).filter(([k,v])=>valid(k,v)))};}catch{return {...defaults};}};
 const apply=()=>{const value=read();document.documentElement.dataset.theme=value.theme==='system'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):value.theme;document.documentElement.dataset.chatSize=value.chatSize;};
 window.BrivanyPreferences={get:read,set:(key,value)=>{if(!valid(key,value))throw Error('Ajuste no válido.');localStorage.setItem('brivany.preferences',JSON.stringify({...read(),[key]:value}));owner.dispatchEvent(new Event('brivany-preferences'));},reset:()=>{localStorage.removeItem('brivany.preferences');owner.dispatchEvent(new Event('brivany-preferences'));}};
 owner.addEventListener('brivany-preferences',apply);window.addEventListener('storage',apply);matchMedia('(prefers-color-scheme:dark)').addEventListener('change',apply);window.addEventListener('pagehide',()=>owner.removeEventListener('brivany-preferences',apply),{once:true});apply();
})();
