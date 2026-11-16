/* Pure typography and clock helpers; no audio, storage, network or page actions. */
(() => {
 'use strict';
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 function lyricAt(lines,position){let lo=0,hi=lines.length-1,result=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(Number.isFinite(lines[mid]?.ms)&&lines[mid].ms<=position){result=mid;lo=mid+1}else hi=mid-1}return result}
 function composition(text,index,width,height,measure=(text,size,weight)=>text.length*size*.57,style='orbital'){
  const words=String(text||'').trim().split(/\s+/u).filter(Boolean),variant=((index%6)+6)%6;
  if(!words.length)return {name:'empty',rows:[],font:24};
  const rows=[],add=(tokens,scale=1,weight=850,align='left',indent=0)=>{if(tokens.length)rows.push({words:tokens,scale,weight,align,indent})};
  const split=Math.max(1,Math.ceil(words.length/2));
  if(words.length===1)add(words,1,variant===4?450:900);
  else if(variant===0){add(words.slice(0,-1),.48,650);add(words.slice(-1),1.28,900)}
  else if(variant===1){add(words.slice(0,split),.82,900);add(words.slice(split),1.08,750,'right')}
  else if(variant===2){const size=Math.max(1,Math.ceil(words.length/3));for(let i=0;i<words.length;i+=size)add(words.slice(i,i+size),.6+(i/size)*.24,850,'left',Math.min(.14,(i/size)*.055))}
  else if(variant===3){add(words.slice(0,1),1.32,900);add(words.slice(1),.58,550,'right')}
  else if(variant===4){add(words.slice(0,split),.8,450);add(words.slice(split),1.05,900)}
  else{const size=Math.max(1,Math.ceil(words.length/3));for(let i=0;i<words.length;i+=size)add(words.slice(i,i+size),i===0?.58:1,900,i===0?'left':'right')}
  const warm=style==='amber';
  if(warm)for(const [i,row] of rows.entries()){row.align=variant===2?'left':variant===5?'right':'center';row.weight=row.weight<650?550:900;row.emphasis=i===(variant%rows.length)?(variant%2?'band':'ink'):'plain';row.tilt=row.emphasis==='band'?(variant%3-1)*2:0}
  let font=Math.min(warm?180:130,Math.max(22,width*.27));
  const available=Math.max(60,width);
  for(const row of rows){const text=row.words.join(' '),relative=measure(warm?text:text.toLocaleUpperCase(),1,row.weight);font=Math.min(font,available*(1-row.indent)*(warm?.88:1)/Math.max(.01,relative*row.scale))}
  font=Math.min(font,Math.max(40,height)/(rows.reduce((sum,row)=>sum+row.scale*(warm?1.18:.98),0)+.12*(rows.length-1)));
  return {name:['monument','balance','staircase','spotlight','contrast','cascade'][variant],rows,font:clamp(font,8,warm?180:150)};
 }
 const api={composition,lyricAt,clamp};if(typeof module!=='undefined'&&module.exports)module.exports=api;if(typeof window!=='undefined')window.BrivanyMusicComposition=api;
})();
