/* Bounded vector undo history. No raster copy per stroke, eval or network. */
(function(host,factory){const core=factory();if(typeof module==='object'&&module.exports)module.exports=core;if(host)host.BrivanyCanvasCore=core})(typeof window==='undefined'?null:window,()=>{
 'use strict';
 const TOOLS=['pen','marker','eraser','line','rect','ellipse'],MAX_POINTS=200000,MAX_COMMANDS=2000;
 function dimensions(width,height){if(!Number.isInteger(width)||!Number.isInteger(height)||width<256||height<256||width>4096||height>4096||width*height>8388608)throw Error('Elige un tamaño de 256 a 4096 px, hasta 8 megapíxeles.');return {width,height}}
 function number(value,low,high){if(!Number.isFinite(value)||value<low||value>high)throw Error('Trazo no válido.');return value}
 function command(value){
  if(!value||typeof value!=='object')throw Error('Trazo no válido.');
  if(value.tool==='clear')return {tool:'clear'};
  if(value.tool==='resize')return {tool:'resize',...dimensions(value.width,value.height)};
  if(!TOOLS.includes(value.tool)||!/^#[0-9a-f]{6}$/i.test(value.color))throw Error('Herramienta no válida.');
  const result={tool:value.tool,color:value.color.toLowerCase(),size:number(value.size,.5,64),fill:value.fill===true,variable:value.variable===true};
  if(['pen','marker','eraser'].includes(value.tool)){
   if(!Array.isArray(value.points)||!value.points.length||value.points.length%3||value.points.length>150000)throw Error('El trazo es demasiado largo.');
   result.points=value.points.map((n,i)=>number(n,0,i%3===2?1:4096));
  }else{for(const key of ['x1','x2','y1','y2'])result[key]=number(value[key],0,4096)}
  return result;
 }
 class Document{
  constructor(width=1600,height=1000){this.base=dimensions(width,height);this.history=[];this.cursor=0;this.sequence=0;this.revision=0}
  size(){let size={...this.base};for(let i=0;i<this.cursor;i++)if(this.history[i].tool==='resize')size={width:this.history[i].width,height:this.history[i].height};return size}
  points(){return this.history.slice(0,this.cursor).reduce((sum,c)=>sum+(c.points?.length||0)/3,0)}
  add(value){const next=command(value),retained=this.history.slice(0,this.cursor);if(retained.length>=MAX_COMMANDS||this.points()+(next.points?.length||0)/3>MAX_POINTS)throw Error('Exporta el dibujo y abre un lienzo nuevo para continuar.');next.id=++this.sequence;this.history=[...retained,next];this.cursor++;this.revision++;return next}
  undo(){if(this.cursor){this.cursor--;this.revision++;return true}return false}
  redo(){if(this.cursor<this.history.length){this.cursor++;this.revision++;return true}return false}
  stamp(){return this.cursor?String(this.history[this.cursor-1].id):'empty'}
  hasDrawing(){for(let i=this.cursor-1;i>=0;i--){const c=this.history[i];if(c.tool==='clear')return false;if(TOOLS.includes(c.tool))return true}return false}
  active(){return this.history.slice(0,this.cursor)}
 }
 function segment(ctx,points,at,size){
  const x=points[at],y=points[at+1],pressure=Math.max(.15,points[at+2]);ctx.lineWidth=size*(.35+.65*pressure);
  if(at===0){ctx.beginPath();ctx.arc(x,y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();return}
  ctx.beginPath();ctx.moveTo(points[at-3],points[at-2]);ctx.lineTo(x,y);ctx.stroke();
 }
 function ink(ctx,c,start=0){ctx.strokeStyle=ctx.fillStyle=c.tool==='eraser'?'#ffffff':c.color;ctx.lineCap='round';ctx.lineJoin='round';if(!c.variable){ctx.lineWidth=c.size;if(c.points.length===3){segment(ctx,c.points,0,c.size);return}const first=Math.max(0,start-3);ctx.beginPath();ctx.moveTo(c.points[first],c.points[first+1]);for(let at=first+3;at<c.points.length;at+=3)ctx.lineTo(c.points[at],c.points[at+1]);ctx.stroke();return}for(let at=start;at<c.points.length;at+=3)segment(ctx,c.points,at,c.size)}
 function draw(ctx,c,mask){
  if(c.tool==='clear'){ctx.save();ctx.fillStyle='#ffffff';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore();return}
  if(c.tool==='resize')return;
  if(c.points){if(c.tool==='marker'){const m=mask.getContext('2d');m.clearRect(0,0,mask.width,mask.height);ink(m,c);ctx.save();ctx.globalAlpha=.28;ctx.drawImage(mask,0,0);ctx.restore()}else ink(ctx,c);return}
  ctx.save();ctx.strokeStyle=ctx.fillStyle=c.color;ctx.lineWidth=c.size;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  const x=Math.min(c.x1,c.x2),y=Math.min(c.y1,c.y2),w=Math.abs(c.x2-c.x1),h=Math.abs(c.y2-c.y1);
  if(c.tool==='line'){ctx.moveTo(c.x1,c.y1);ctx.lineTo(c.x2,c.y2)}else if(c.tool==='rect')ctx.rect(x,y,w,h);else ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);
  if(c.fill&&c.tool!=='line')ctx.fill();else ctx.stroke();ctx.restore();
 }
 function replay(ctx,doc,mask){const size=doc.size();if(ctx.canvas.width!==size.width||ctx.canvas.height!==size.height){ctx.canvas.width=size.width;ctx.canvas.height=size.height;mask.width=size.width;mask.height=size.height}ctx.fillStyle='#ffffff';ctx.fillRect(0,0,size.width,size.height);for(const c of doc.active())draw(ctx,c,mask);mask.getContext('2d').clearRect(0,0,mask.width,mask.height)}
 return {TOOLS,MAX_POINTS,MAX_COMMANDS,dimensions,command,Document,ink,draw,replay};
});
