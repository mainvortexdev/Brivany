/* Calendar, weather and saved websites. No polling, geolocation or remote images. */
(function(host,factory){
 'use strict';const core=factory();if(typeof module==='object'&&module.exports)module.exports=core;if(!host?.document)return;
 const document=host.document,widgets=host.BrivanyWorkspaceWidgets;if(!widgets?.addTool)return;
 const KEY='brivany.workspace.daily.v1';let saved,disposed=false,weatherEpoch=0,locations=[],weather=null;
 try{const raw=host.localStorage.getItem(KEY)||'{}';saved=raw.length<=131072?JSON.parse(raw):{}}catch{saved={}}
 const preferences=host.BrivanyDesktopPreferenceStore;
 const localization=host.BrivanyWorkspaceLocale,t=source=>localization?.text(source)??source;
 const locale=()=>localization?.current()||'es';
 const named=(source,name)=>t(source).replace('{name}',()=>name);
 let state=core.state(saved),selected=core.dateKey(new Date()),month=selected.slice(0,7),weatherBusy=false;
 if(preferences)state.location=core.state({location:preferences.current('weather').location}).location;
 const panes={};for(const [id,title] of [['calendar','Agenda'],['weather','Clima'],['sites','Webs']]){const pane=document.createElement('div');if(widgets.addTool(id,title,pane))panes[id]=pane}
 if(!panes.calendar||!panes.weather||!panes.sites)return;
 const $=(selector)=>document.querySelector(selector);
 function message(id,text){const node=panes[id]?.querySelector('[role=status]');if(node)node.textContent=t(text)}
 function store(id){try{host.localStorage.setItem(KEY,JSON.stringify(state));return true}catch{message(id,'No se pudo guardar. Revisa el espacio y los permisos del equipo.');return false}}
 async function native(method,...args){if(disposed)throw Error('Esta vista está cerrada.');const api=host.pywebview?.api;if(!api?.[method])throw Error('Abre esta herramienta en Brivany Desktop.');return api[method](...args)}
 function button(label,action,cls=''){const node=document.createElement('button');node.type='button';node.textContent=label;node.className=cls;node.onclick=action;return node}
 function appendText(parent,tag,text,cls=''){const node=document.createElement(tag);node.textContent=text;node.className=cls;parent.append(node);return node}
 panes.calendar.innerHTML=`<div class="daily-calendar-nav"><button type="button" id="daily-prev" aria-label="Mes anterior">‹</button><strong id="daily-month"></strong><button type="button" id="daily-next" aria-label="Mes siguiente">›</button><button type="button" id="daily-today">Hoy</button></div><div class="daily-weekdays" aria-hidden="true"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div><div id="daily-days" role="group" aria-label="Días del mes"></div><div class="daily-agenda-heading"><strong id="daily-selected"></strong><button id="daily-export" type="button" aria-label="Exportar agenda local">Exportar</button></div><div id="daily-events" role="list" aria-label="Agenda local del día"></div><form id="daily-event-form" class="daily-event-form"><label>Título<input id="daily-event-title" maxlength="100" required placeholder="Añadir a mi agenda" autocomplete="off"></label><label>Hora<input id="daily-event-time" type="time" aria-label="Hora opcional del evento"></label><button class="widget-primary">Guardar</button></form><p class="widget-help">Agenda local. No sincroniza ni modifica Google Calendar. Exporta tus eventos para llevarlos a otra aplicación.</p><p role="status" class="widget-feedback"></p>`;
 function moveMonth(delta){try{const day=core.monthShift(selected,delta);selected=day;month=day.slice(0,7);paintCalendar()}catch{message('calendar','La agenda admite fechas entre 1900 y 2199.')}}
 function chooseDay(key,focus=false){selected=key;month=key.slice(0,7);paintCalendar();if(focus)$(`[data-calendar-day="${key}"]`)?.focus()}
 function paintCalendar(){
  if(disposed)return;const first=core.date(month+'-01'),today=core.dateKey(new Date()),days=core.monthDays(month);
  $('#daily-month').textContent=new Intl.DateTimeFormat(locale(),{month:'long',year:'numeric'}).format(first);
  $('#daily-selected').textContent=new Intl.DateTimeFormat(locale(),{day:'numeric',month:'long'}).format(core.date(selected));
  const grid=$('#daily-days');grid.replaceChildren();const offset=(first.getDay()+6)%7;
  for(let i=0;i<offset;i++){const blank=document.createElement('span');blank.setAttribute('aria-hidden','true');grid.append(blank)}
  for(let day=1;day<=days;day++){
   const key=month+'-'+String(day).padStart(2,'0'),rows=state.events.filter(e=>e.date===key),node=button(String(day),()=>chooseDay(key));node.dataset.calendarDay=key;
   node.setAttribute('aria-label',new Intl.DateTimeFormat(locale(),{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(core.date(key))+(rows.length?' · '+t('{count} eventos').replace('{count}',String(rows.length)):''));
   node.setAttribute('aria-pressed',String(key===selected));node.tabIndex=key===selected?0:-1;if(key===today)node.setAttribute('aria-current','date');if(rows.length)node.classList.add('has-events');
   node.onkeydown=event=>{const deltas={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};let next;
    if(event.key in deltas)next=core.dayShift(key,deltas[event.key]);else if(event.key==='Home')next=core.dayShift(key,-((core.date(key).getDay()+6)%7));else if(event.key==='End')next=core.dayShift(key,6-((core.date(key).getDay()+6)%7));else if(event.key==='PageUp')next=core.monthShift(key,-1);else if(event.key==='PageDown')next=core.monthShift(key,1);else return;
    event.preventDefault();chooseDay(next,true)};grid.append(node);
  }
  const list=$('#daily-events');list.replaceChildren();const events=state.events.filter(e=>e.date===selected).sort((a,b)=>a.time.localeCompare(b.time));
  if(!events.length)appendText(list,'p',t('Sin eventos locales para este día.'),'widget-help');
  for(const item of events){const row=document.createElement('article');row.className='daily-event';row.setAttribute('role','listitem');appendText(row,'time',item.time||t('Todo el día'));appendText(row,'span',item.title);const remove=button('×',()=>{const next={...state,events:state.events.filter(e=>e.id!==item.id)},old=state;state=next;if(!store('calendar')){state=old;return}paintCalendar()});remove.setAttribute('aria-label',named('Quitar evento {name}',item.title));row.append(remove);list.append(row)}
 }
 $('#daily-prev').onclick=()=>moveMonth(-1);$('#daily-next').onclick=()=>moveMonth(1);$('#daily-today').onclick=()=>chooseDay(core.dateKey(new Date()));
 $('#daily-event-form').onsubmit=event=>{event.preventDefault();try{
  if(state.events.length>=100)throw Error('La agenda admite hasta 100 eventos. Exporta o retira alguno.');
  const item=core.event({id:host.crypto.randomUUID(),title:$('#daily-event-title').value,date:selected,time:$('#daily-event-time').value});
  const old=state;state={...state,events:[...state.events,item]};if(!store('calendar')){state=old;return}$('#daily-event-title').value='';paintCalendar();message('calendar','Evento guardado en este equipo.');
 }catch(error){message('calendar',error.message)}};
 $('#daily-export').onclick=()=>{const blob=new Blob([core.ics(state.events)],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Brivany-agenda.ics';link.click();host.setTimeout(()=>URL.revokeObjectURL(url),1000);message('calendar','Agenda exportada. Importa el archivo en tu calendario.')};
 panes.sites.innerHTML=`<div id="daily-sites" role="list" aria-label="Webs favoritas"></div><form id="daily-site-form" class="daily-site-form"><label>Nombre<input id="daily-site-title" maxlength="60" required autocomplete="off" placeholder="Una web que usas a menudo"></label><label>Dirección<input id="daily-site-url" maxlength="2048" type="url" required placeholder="https://" autocomplete="off"></label><button class="widget-primary">Añadir web</button></form><p class="widget-help">Hasta doce webs. Se abren en tu navegador al pulsarlas; no cargamos vistas previas ni rastreadores.</p><p role="status" class="widget-feedback"></p>`;
 function paintSites(){const list=$('#daily-sites');list.replaceChildren();if(!state.sites.length)appendText(list,'p',t('Tus webs, a un gesto. Añade la primera.'),'daily-empty');
  for(const item of state.sites){const row=document.createElement('article');row.className='daily-site';row.setAttribute('role','listitem');const open=button('',async()=>{open.disabled=true;try{const result=await native('workspace_link_open',item.url);if(!result.opened)throw Error('No se pudo abrir el navegador.');message('sites','Abierto en tu navegador.')}catch(error){message('sites',error.message)}finally{open.disabled=false}});open.setAttribute('aria-label',named('Abrir {name}',item.title));appendText(open,'strong',item.title);appendText(open,'small',new URL(item.url).host);const remove=button('×',()=>{const old=state;state={...state,sites:state.sites.filter(s=>s.id!==item.id)};if(!store('sites')){state=old;return}paintSites()});remove.setAttribute('aria-label',named('Quitar web {name}',item.title));row.append(open,remove);list.append(row)}
 }
 $('#daily-site-form').onsubmit=event=>{event.preventDefault();try{if(state.sites.length>=12)throw Error('Puedes guardar hasta doce webs.');const item=core.site({id:host.crypto.randomUUID(),title:$('#daily-site-title').value,url:$('#daily-site-url').value});const old=state;state={...state,sites:[...state.sites,item]};if(!store('sites')){state=old;return}$('#daily-site-form').reset();paintSites();message('sites','Web guardada.')}catch(error){message('sites',error.message)}};
 panes.weather.innerHTML=`<form id="daily-weather-search" class="daily-weather-search"><label>Ciudad<input id="daily-weather-city" maxlength="100" minlength="2" required placeholder="Ciudad y país" autocomplete="off"></label><button class="widget-primary">Buscar ciudad</button></form><div id="daily-weather-locations" role="group" aria-label="Elige una ciudad"></div><div id="daily-weather-card" hidden></div><button id="daily-weather-refresh" type="button" hidden>Actualizar clima</button><p class="widget-help">Solo se consulta al pulsar. La ciudad o coordenadas elegidas se envían a Open-Meteo; no usamos tu ubicación del dispositivo.</p><p class="daily-attribution"><a href="https://open-meteo.com/" id="daily-weather-source">Open-Meteo</a> · GeoNames</p><p role="status" class="widget-feedback"></p>`;
 function weatherBusySet(busy){weatherBusy=busy;panes.weather.setAttribute('aria-busy',String(busy));for(const el of panes.weather.querySelectorAll('button'))el.disabled=busy}
 async function loadWeather(location){
  if(weatherBusy||disposed)return;const epoch=++weatherEpoch;weatherBusySet(true);message('weather','Consultando condiciones…');
  try{const result=await native('workspace_weather_current',location.latitude,location.longitude);if(disposed||epoch!==weatherEpoch)return;
   const place=core.location(location);
   if(preferences)await preferences.update('weather',{location:place});
   if(disposed||epoch!==weatherEpoch)return;
   weather={...result,location:place};const old=state;state={...state,location:place};if(!preferences&&!store('weather'))state=old;
   paintWeather();message('weather',result.cached?'Consulta reciente en caché; no se solicitó otra actualización.':'Condiciones recibidas de Open-Meteo.');
  }catch(error){if(epoch===weatherEpoch)message('weather',error.message)}finally{if(!disposed&&epoch===weatherEpoch)weatherBusySet(false)}
 }
 function paintWeather(){const card=$('#daily-weather-card');card.replaceChildren();if(!weather){card.hidden=true;return}card.hidden=false;
  appendText(card,'p',weather.location.label,'daily-weather-place');appendText(card,'strong',Math.round(weather.temperature)+'°','daily-temperature');appendText(card,'p',t(core.condition(weather.code)),'daily-weather-condition');
  appendText(card,'p',t('Sensación')+' '+Math.round(weather.apparent)+'° · '+t('Humedad')+' '+Math.round(weather.humidity)+'%','widget-help');appendText(card,'p',t('Viento')+' '+weather.wind_kmh+' km/h'+(weather.high==null?'':' · '+t('Máx')+' '+Math.round(weather.high)+'° / '+t('Mín')+' '+Math.round(weather.low)+'°'),'widget-help');
  appendText(card,'p',weather.local_time.replace('T',' · ')+' · '+weather.timezone,'daily-weather-time');$('#daily-weather-refresh').hidden=false;
 }
 $('#daily-weather-city').value=state.location?.label?.split(',')[0]||'';
 $('#daily-weather-search').onsubmit=async event=>{event.preventDefault();if(weatherBusy)return;const epoch=++weatherEpoch;weatherBusySet(true);message('weather','Buscando ciudad…');
  try{const result=await native('workspace_weather_search',$('#daily-weather-city').value);if(disposed||epoch!==weatherEpoch)return;locations=Array.isArray(result.locations)?result.locations.slice(0,5):[];const list=$('#daily-weather-locations');list.replaceChildren();
   for(const location of locations){try{core.location(location)}catch{continue}list.append(button(location.label,()=>loadWeather(location)))}message('weather',locations.length?'Elige la ciudad para consultar su clima.':'No se encontró esa ciudad. Añade el país o prueba otro nombre.');
  }catch(error){if(epoch===weatherEpoch)message('weather',error.message)}finally{if(!disposed&&epoch===weatherEpoch)weatherBusySet(false)}
 };
 $('#daily-weather-refresh').hidden=!state.location;$('#daily-weather-refresh').onclick=()=>loadWeather(weather?.location||state.location);
 $('#daily-weather-source').onclick=event=>{event.preventDefault();native('workspace_link_open','https://open-meteo.com/').catch(error=>message('weather',error.message))};
 function storage(event){
  if(preferences&&event.key==='brivany.workspace.weather.v1'){
   const location=core.state({location:preferences.current('weather').location}).location;
   if(JSON.stringify(location)===JSON.stringify(state.location))return;
   state.location=location;
   if(!weatherBusy){
    weather=null;paintWeather();
    $('#daily-weather-city').value=state.location?.label?.split(',')[0]||'';
    $('#daily-weather-refresh').hidden=!state.location;
   }
   return;
  }
  if(event.key!==KEY||!event.newValue)return;
  try{
   const next=core.state(JSON.parse(event.newValue));
   if(preferences)next.location=state.location;
   state=next;paintCalendar();paintSites();
  }catch{}
 }
 function tab(event){if(event.detail?.id==='calendar')paintCalendar()}
 function dispose(){disposed=true;host.removeEventListener('brivany-workspace-locale',localize);weatherEpoch++;host.removeEventListener('storage',storage);host.removeEventListener('brivany-widget-tab',tab)}
 host.addEventListener('storage',storage);host.addEventListener('brivany-widget-tab',tab);host.addEventListener('pagehide',dispose,{once:true});
 function localize(){
  const weekdays=panes.calendar.querySelectorAll('.daily-weekdays span');
  const formatter=new Intl.DateTimeFormat(locale(),{weekday:'short',timeZone:'UTC'});
  for(let i=0;i<weekdays.length;i++)weekdays[i].textContent=locale()==='es'?'LMXJVSD'[i]:formatter.format(new Date(Date.UTC(2024,0,1+i)));
  paintCalendar();paintSites();paintWeather();
 }
 for(const pane of Object.values(panes))localization?.mount(pane);
 host.addEventListener('brivany-workspace-locale',localize);
 host.BrivanyWorkspaceDaily={dispose};localize();
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 function dateKey(value){return value.getFullYear()+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0')}
 function date(key){if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key)||key<'1900-01-01'||key>'2199-12-31')throw Error('Fecha fuera de rango.');const [y,m,d]=key.split('-').map(Number),value=new Date(y,m-1,d,12);if(dateKey(value)!==key)throw Error('Fecha no válida.');return value}
 function monthDays(month){const value=date(month+'-01');return new Date(value.getFullYear(),value.getMonth()+1,0,12).getDate()}
 function dayShift(key,delta){const value=date(key);value.setDate(value.getDate()+delta);const next=dateKey(value);date(next);return next}
 function monthShift(key,delta){const value=date(key),day=value.getDate();value.setDate(1);value.setMonth(value.getMonth()+delta);value.setDate(Math.min(day,new Date(value.getFullYear(),value.getMonth()+1,0,12).getDate()));const next=dateKey(value);date(next);return next}
 function cleanText(value,max){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw Error('Revisa el texto introducido.');return value.trim()}
 function identifier(value){if(typeof value!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value))throw Error('Identificador no válido.');return value}
 function event(value){if(!value||typeof value!=='object')throw Error('Evento no válido.');date(value.date);if(typeof value.time!=='string'||value.time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time))throw Error('Hora no válida.');return {id:identifier(value.id),date:value.date,time:value.time,title:cleanText(value.title,100)}}
 function site(value){if(!value||typeof value!=='object')throw Error('Web no válida.');const raw=cleanText(value.url,2048);let url;try{url=new URL(raw)}catch{throw Error('Escribe una dirección http o https.')}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||/\s/.test(raw))throw Error('Usa http o https sin credenciales.');return {id:identifier(value.id),title:cleanText(value.title,60),url:url.href}}
 function location(value){if(!value||typeof value!=='object'||!Number.isFinite(value.latitude)||!Number.isFinite(value.longitude)||Math.abs(value.latitude)>90||Math.abs(value.longitude)>180)throw Error('Lugar no válido.');return {label:cleanText(value.label,240),latitude:value.latitude,longitude:value.longitude}}
 function state(value){value=value&&typeof value==='object'?value:{};const items=(rows,max,validate)=>{const result=[],seen=new Set();if(!Array.isArray(rows))return result;for(const row of rows.slice(0,max)){try{const item=validate(row);if(!seen.has(item.id)){result.push(item);seen.add(item.id)}}catch{}}return result};let place=null;try{place=location(value.location)}catch{}return {events:items(value.events,100,event),sites:items(value.sites,12,site),location:place}}
 function condition(code){return ({0:'Despejado',1:'Principalmente despejado',2:'Parcialmente nublado',3:'Nublado',45:'Niebla',48:'Niebla con escarcha',51:'Llovizna ligera',53:'Llovizna',55:'Llovizna intensa',56:'Llovizna helada ligera',57:'Llovizna helada',61:'Lluvia ligera',63:'Lluvia',65:'Lluvia intensa',66:'Lluvia helada ligera',67:'Lluvia helada',71:'Nieve ligera',73:'Nieve',75:'Nieve intensa',77:'Granos de nieve',80:'Chubascos ligeros',81:'Chubascos',82:'Chubascos intensos',85:'Chubascos de nieve',86:'Chubascos de nieve intensos',95:'Tormenta',96:'Tormenta con granizo',99:'Tormenta con granizo intenso'})[code]||'Condición no disponible'}
 function ics(events,now=new Date()){const escape=text=>text.replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');const fold=line=>{let output='',bytes=0;for(const char of line){const size=new TextEncoder().encode(char).length;if(bytes+size>73){output+='\r\n ';bytes=1}output+=char;bytes+=size}return output};const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Brivany//Agenda local//ES','CALSCALE:GREGORIAN'];
  for(const raw of events.slice(0,100)){const item=event(raw),start=item.date.replace(/-/g,''),time=item.time.replace(':','');lines.push('BEGIN:VEVENT','UID:'+item.id+'@brivany.local','DTSTAMP:'+stamp,item.time?'DTSTART:'+start+'T'+time+'00':'DTSTART;VALUE=DATE:'+start);if(!item.time){const end=date(item.date);end.setDate(end.getDate()+1);lines.push('DTEND;VALUE=DATE:'+dateKey(end).replace(/-/g,''))}lines.push('SUMMARY:'+escape(item.title),'END:VEVENT')}
  lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n'}
 return {dateKey,date,monthDays,dayShift,monthShift,event,site,state,location,condition,ics};
});
