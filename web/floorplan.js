/** Native SVG plan. Geometry and provenance come from the current scene service. */
const NS='http://www.w3.org/2000/svg';
const element=(name,attributes={},text=null)=>{const node=document.createElementNS(NS,name);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));if(text!==null)node.textContent=text;return node;};
const finitePoint=value=>Array.isArray(value) && value.length===2 && value.every(n=>Number.isFinite(n) && Math.abs(n)<=100000);
const points=value=>value.map(p=>p.join(',')).join(' ');
const rounded=value=>new Intl.NumberFormat('es',{maximumFractionDigits:2}).format(value);
const ORIGINS={reference_interpretation:'Interpretación manual',generated_demo:'Demostración procedural',capture_reconstruction:'Reconstrucción por revisar'};

export class FloorPlan {
  constructor(container,{onSelect=()=>{},onPoint=()=>{}}={}){
    this.container=container;this.onSelect=onSelect;this.onPoint=onPoint;this.selected=null;this.measureMode=false;this.disposed=false;
    this.svg=element('svg',{xmlns:NS,role:'group','aria-label':'Plano geométrico del espacio',tabindex:0,width:'100%',height:'100%','preserveAspectRatio':'xMidYMid meet'});
    this.svg.style.touchAction='none';this.svg.style.display='block';this.svg.style.minHeight='350px';
    this.wheel=event=>{event.preventDefault();this.zoom(event.deltaY>0?1.15:1/1.15);};this.svg.addEventListener('wheel',this.wheel,{passive:false});
    this.key=event=>{if(event.ctrlKey || event.metaKey || event.altKey)return;if(['+','=','-','0'].includes(event.key)){event.preventDefault();event.key==='0'?this.fit():this.zoom(event.key==='-'?1.2:1/1.2);}};this.svg.addEventListener('keydown',this.key);
    this.pointerDown=event=>{if(!this.document || this.measureMode || event.button!==0 || event.target.closest('[data-object-id]'))return;this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,box:[...this.view]};this.svg.setPointerCapture(event.pointerId);};
    this.pointerMove=event=>{if(!this.drag || event.pointerId!==this.drag.id)return;const matrix=this.svg.getScreenCTM();if(!matrix)return;const dx=(event.clientX-this.drag.x)/matrix.a,dy=(event.clientY-this.drag.y)/matrix.d;this.setView([this.drag.box[0]-dx,this.drag.box[1]-dy,this.drag.box[2],this.drag.box[3]]);};
    this.pointerUp=event=>{if(this.drag?.id===event.pointerId){this.drag=null;if(this.svg.hasPointerCapture(event.pointerId))this.svg.releasePointerCapture(event.pointerId);}};
    this.click=event=>{if(!this.measureMode || !this.document)return;const coordinate=this.coordinate(event);if(coordinate)this.onPoint(coordinate);};
    this.svg.addEventListener('pointerdown',this.pointerDown);this.svg.addEventListener('pointermove',this.pointerMove);this.svg.addEventListener('pointerup',this.pointerUp);this.svg.addEventListener('pointercancel',this.pointerUp);this.svg.addEventListener('click',this.click);
    container.replaceChildren(this.svg);
  }
  load(value){
    if(this.disposed)throw Error('El plano ya está cerrado.');
    if(value?.schema_version!=='floorplan-1' || !Array.isArray(value.objects) || value.objects.length>100 || !Array.isArray(value.architecture) || value.architecture.length>20000 || !Array.isArray(value.bounds) || value.bounds.length!==2 || !value.bounds.every(finitePoint) || !value.scale)throw Error('El documento del plano no es compatible.');
    for(const object of value.objects)if(!Array.isArray(object.polygon) || object.polygon.length>100000 || !object.polygon.every(finitePoint))throw Error('Una huella contiene coordenadas inválidas.');
    for(const segment of value.architecture)if(!segment.points?.every(finitePoint) || segment.points.length!==2)throw Error('Un corte contiene coordenadas inválidas.');
    this.document=value;this.svg.replaceChildren();this.svg.append(element('title',{},value.title+' · plano de la geometría actual'));
    this.svg.append(element('desc',{},value.scale.label+'. '+value.limitations.join(' ')));
    const [min,max]=value.bounds,span=Math.max(max[0]-min[0],max[1]-min[1],1),padding=span*.07;
    this.textSize=span*.018;this.defaultView=[min[0]-padding,min[1]-padding*2.6,max[0]-min[0]+padding*2,max[1]-min[1]+padding*5.5];
    this.svg.append(element('rect',{x:this.defaultView[0],y:this.defaultView[1],width:this.defaultView[2],height:this.defaultView[3],fill:'#fbfaf8'}));
    const defs=element('defs'),pattern=element('pattern',{id:'floorplan-uncertainty',width:span*.22,height:span*.22,patternUnits:'userSpaceOnUse',patternTransform:'rotate(45)'});
    pattern.append(element('line',{x1:0,y1:0,x2:0,y2:span*.22,stroke:'#c2aa80','stroke-width':span*.0015}));defs.append(pattern);this.svg.append(defs);
    const areas=element('g',{'aria-label':'Zonas de incertidumbre'});
    for(const zone of value.uncertainty_zones || []){if(!zone.polygon?.every(finitePoint))continue;const polygon=element('polygon',{points:points(zone.polygon),fill:zone.id==='geometry-unverified'?'none':'url(#floorplan-uncertainty)',stroke:'#c9b98e','stroke-width':span*.0012,'stroke-dasharray':`${span*.025} ${span*.018}`});polygon.append(element('title',{},zone.reason+' · sin verificar'));areas.append(polygon);}this.svg.append(areas);
    this.objectLayer=element('g',{'aria-label':'Objetos del plano'});this.nodes=new Map();
    // Larger convex hulls first, so small objects remain available for selection.
    const visible=[...value.objects].filter(obj=>obj.role!=='environment').sort((a,b)=>this.area(b.polygon)-this.area(a.polygon));
    for(const object of visible){const group=element('g',{'data-object-id':object.id,role:'button',tabindex:0,'aria-label':object.label,'aria-pressed':'false'}),shape=element(object.polygon.length>=3?'polygon':'polyline',{points:points(object.polygon),fill:object.overhead?'none':'#eeebe4',stroke:'#8b8983','stroke-width':span*.002});
      if(object.overhead)shape.setAttribute('stroke-dasharray',`${span*.018} ${span*.012}`);shape.append(element('title',{},object.label+' · huella convexa, '+object.provenance));group.append(shape);
      const select=event=>{if(this.measureMode)return;event.stopPropagation();this.select(object.id);this.onSelect(object.id,object);};group.addEventListener('click',select);group.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();select(event);}});this.nodes.set(object.id,{group,shape});this.objectLayer.append(group);
    }this.svg.append(this.objectLayer);
    const architecture=element('g',{'aria-label':'Corte de geometría arquitectónica',stroke:'#34332f','stroke-width':span*.004,'stroke-linecap':'round',fill:'none'});
    for(const segment of value.architecture)architecture.append(element('line',{x1:segment.points[0][0],y1:segment.points[0][1],x2:segment.points[1][0],y2:segment.points[1][1]}));this.svg.append(architecture);
    const annotations=element('g',{'aria-label':'Aberturas y anotaciones declaradas'});
    for(const note of value.annotations || []){if(!note.points?.every(finitePoint))continue;const color=note.kind==='window'?'#398a9b':note.kind==='door'?'#9a713d':'#6e6e73',line=element('line',{x1:note.points[0][0],y1:note.points[0][1],x2:note.points[1][0],y2:note.points[1][1],stroke:color,'stroke-width':span*.006,'stroke-dasharray':`${span*.023} ${span*.011}`});line.append(element('title',{},note.label+' · '+note.provenance+' · '+note.note));annotations.append(line);}this.svg.append(annotations);
    this.measureLayer=element('g',{'aria-label':'Referencias de longitud declaradas'});this.svg.append(this.measureLayer);
    for(const reference of value.scale.references || [])this.measure(reference.points,reference.measured_m+' m declarados','#0071e3');
    const x=min[0],top=min[1]-padding*1.3,bottom=max[1]+padding*1.3;
    this.svg.append(element('text',{x,y:top,fill:'#1d1d1f','font-size':this.textSize*1.1,'font-family':'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'},value.title));
    this.svg.append(element('text',{x,y:bottom,fill:'#6e6e73','font-size':this.textSize,'font-family':'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'},(ORIGINS[value.scene_origin] || 'Geometría por revisar')+' · revisión '+value.scene_revision));
    this.svg.append(element('text',{x,y:bottom+this.textSize*1.6,fill:'#6e6e73','font-size':this.textSize,'font-family':'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'},value.scale.label));
    if(value.scale.rms_residual_m!==null)this.svg.append(element('text',{x,y:bottom+this.textSize*3.2,fill:'#6e6e73','font-size':this.textSize*.9,'font-family':'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'},'Residual RMS: '+rounded(value.scale.rms_residual_m)+' m · consistencia del ajuste, no precisión verificada'));
    this.selectionLayer=element('g',{'aria-label':'Selección'});this.svg.append(this.selectionLayer);this.fit();this.select(this.selected);this.container.dataset.ready='true';
  }
  area(polygon){let value=0;for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];value+=a[0]*b[1]-b[0]*a[1];}return Math.abs(value/2);}
  select(id){
    this.selected=id;for(const [key,{group,shape}] of this.nodes || []){group.setAttribute('aria-pressed',String(key===id));shape.setAttribute('fill',key===id?'#dcecff':this.document.objects.find(value=>value.id===key).overhead?'none':'#eeebe4');shape.setAttribute('stroke',key===id?'#0071e3':'#8b8983');}
    this.selectionLayer?.replaceChildren();const object=this.document?.objects.find(value=>value.id===id);if(!object?.polygon.length)return;
    const x=object.polygon.reduce((s,p)=>s+p[0],0)/object.polygon.length,z=object.polygon.reduce((s,p)=>s+p[1],0)/object.polygon.length;
    const text=element('text',{x,y:z,fill:'#0059b3','font-size':this.textSize,'font-family':'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif','text-anchor':'middle','pointer-events':'none'},object.label);this.selectionLayer.append(text);
  }
  setMeasureMode(value){this.measureMode=Boolean(value);this.svg.style.cursor=this.measureMode?'crosshair':'grab';this.svg.setAttribute('aria-label',this.measureMode?'Plano: selecciona dos puntos para una referencia medida':'Plano geométrico del espacio');}
  coordinate(event){const matrix=this.svg.getScreenCTM();if(!matrix)return null;const p=this.svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const result=p.matrixTransform(matrix.inverse());return [Number(result.x.toFixed(5)),Number(result.y.toFixed(5))];}
  measure(value,label=null,color='#0071e3'){
    if(!Array.isArray(value) || value.length!==2 || !value.every(finitePoint) || !this.measureLayer)throw Error('Selecciona dos puntos válidos del plano.');
    const [a,b]=value,distance=Math.hypot(a[0]-b[0],a[1]-b[1]),scale=this.document.scale.meters_per_unit;
    const line=element('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:color,'stroke-width':this.textSize*.12});this.measureLayer.append(line);
    for(const point of value)this.measureLayer.append(element('circle',{cx:point[0],cy:point[1],r:this.textSize*.2,fill:color}));
    this.measureLayer.append(element('text',{x:(a[0]+b[0])/2,y:(a[1]+b[1])/2-this.textSize*.5,fill:color,'font-size':this.textSize,'text-anchor':'middle','font-family':'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'},label || rounded(distance*(scale || 1))+(scale?' m declarados':' u. relativas')));
    return distance;
  }
  setView(value){this.view=value;this.svg.setAttribute('viewBox',value.join(' '));}
  fit(){if(this.defaultView)this.setView([...this.defaultView]);}
  zoom(factor){if(!this.view || !Number.isFinite(factor) || factor<=0)return;const [x,y,w,h]=this.view,ratio=w*factor/this.defaultView[2];if(ratio<.05 || ratio>5)return;this.setView([x+w*(1-factor)/2,y+h*(1-factor)/2,w*factor,h*factor]);}
  exportSVG(){
    if(!this.document)throw Error('Abre primero el plano.');const copy=this.svg.cloneNode(true);copy.setAttribute('viewBox',this.defaultView.join(' '));copy.setAttribute('width','1400');copy.setAttribute('height',String(Math.round(1400*this.defaultView[3]/this.defaultView[2])));copy.removeAttribute('tabindex');copy.style.removeProperty('touch-action');
    for(const node of copy.querySelectorAll('[role="button"]')){node.removeAttribute('tabindex');node.removeAttribute('role');}
    const metadata=element('metadata',{},JSON.stringify({format:'brivany-floorplan-svg-1',scene_id:this.document.scene_id,scene_revision:this.document.scene_revision,origin:this.document.scene_origin,scale:this.document.scale,coverage_verified:false,architectural_accuracy_verified:false,limitations:this.document.limitations}));copy.insertBefore(metadata,copy.firstChild);
    return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n',new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml;charset=utf-8'});
  }
  dispose(){this.disposed=true;this.svg.removeEventListener('wheel',this.wheel);this.svg.removeEventListener('keydown',this.key);this.svg.removeEventListener('pointerdown',this.pointerDown);this.svg.removeEventListener('pointermove',this.pointerMove);this.svg.removeEventListener('pointerup',this.pointerUp);this.svg.removeEventListener('pointercancel',this.pointerUp);this.svg.removeEventListener('click',this.click);this.container.replaceChildren();this.document=null;}
}
