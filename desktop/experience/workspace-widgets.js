/* Local WorkSpace tools. No eval, network, frame loop or hidden clock polling. */
(function (host, factory) {
 'use strict';
 const core = factory();
 if (typeof module === 'object' && module.exports) module.exports = core;
 if (!host?.document) return;
 const document=host.document, KEY='brivany.workspace.widgets.v1';let storage;try{storage=host.localStorage}catch{}
 let saved={};try{saved=JSON.parse(storage.getItem(KEY)||'{}')}catch{}
 function boundedNote(value){let result=typeof value==='string'?value.slice(0,4000):'';if(/[\uD800-\uDBFF]$/.test(result))result=result.slice(0,-1);return result}
 let preferences=core.preferences(host.BrivanyWorkspacePreferences?.widgets()||saved.preferences),timer=core.timer(saved.timer),note=boundedNote(saved.note),nativeDelegate=null;
 let selected='timer',tick=0,alarm=0,saveNote=0,disposed=false,lastFinished='',clipboard=[];const actions=new Map();
 const container=document.querySelector('#workspace-widgets'),glance=document.querySelector('#workspace-timer-glance');
 const $=s=>container?.querySelector(s), now=()=>Date.now();
 const localization=host.BrivanyWorkspaceLocale,t=source=>localization?.text(source)??source;
 const locale=()=>localization?.current()||'es';
 let feedback='',answer=0;
 function store(){try{if(!storage)throw new Error('storage');storage.setItem(KEY,JSON.stringify({preferences,timer,note}))}catch{message('No se pudo guardar en este equipo.')}}
 function message(text){feedback=text;if($('#widget-feedback'))$('#widget-feedback').textContent=t(text)}
 function noteCount(){const count=$('#widget-note-count');if(count){count.textContent=note.length+' / 4000';count.hidden=note.length<3500}}
 function applyPreferences(notify=true){
  Object.assign(document.body.dataset,{theme:preferences.theme,accent:preferences.accent,size:preferences.size,economy:String(preferences.economy)});
  if(container)for(const el of container.querySelectorAll('[data-widget-preference]')){const value=preferences[el.dataset.widgetPreference];if(el.type==='checkbox')el.checked=value;else el.value=value}
  if(notify)host.dispatchEvent(new CustomEvent('brivany-workspace-preferences',{detail:{...preferences}}));
 }
 function finish(){
  if(disposed||nativeDelegate||timer.state!=='running'||timer.deadline>now())return;
  const id=String(timer.deadline);timer=core.transition(timer,'finish',now());store();renderTimer();schedule();
  notifyFinished(id);
 }
 function notifyFinished(id){if(lastFinished!==id&&document.body.dataset.surface!=='panel'){lastFinished=id;message('Tiempo terminado.');host.dispatchEvent(new CustomEvent('brivany-timer-finished',{detail:{message:'Tu temporizador ha terminado.'}}))}}
 function active(){return !document.hidden&&document.body.dataset.expanded==='true'&&document.body.dataset.panel==='widgets'}
 function schedule(){
  host.clearTimeout(tick);host.clearTimeout(alarm);tick=alarm=0;if(disposed)return;
  if(!nativeDelegate&&timer.state==='running')alarm=host.setTimeout(finish,Math.max(0,Math.min(2147483647,timer.deadline-now())));
  // Only a visible timer needs second-by-second repainting. The alarm is one timeout.
  if(!document.hidden&&(active()&&selected==='clock'||timer.state==='running'&&(active()&&selected==='timer'||glance&&document.body.dataset.surface!=='panel')))tick=host.setTimeout(()=>{renderTimer();schedule()},timer.state==='running'?1000:60000-now()%60000);
 }
 function renderTimer(){
  const current=core.remaining(timer,now()),label=core.format(current),stateLabels={idle:'Listo para empezar',running:'En marcha',paused:'En pausa',finished:'Tiempo terminado'};
  if($('#widget-timer-value')){$('#widget-timer-value').textContent=label;$('#widget-timer-state').textContent=t(stateLabels[timer.state]);$('#widget-timer-action').textContent=t(timer.state==='running'?'Pausar':timer.state==='paused'?'Reanudar':'Iniciar');$('#widget-timer-minutes').disabled=timer.state==='running'||timer.state==='paused';$('#widget-timer-seconds').disabled=timer.state==='running'||timer.state==='paused'}
  if(glance){glance.hidden=timer.state==='idle';glance.textContent=timer.state==='finished'?t('Tiempo cumplido'):label;glance.dataset.state=timer.state}
  if(active()&&selected==='clock')renderClock();
 }
 function renderClock(){
  if(!$('#widget-clock'))return;const date=new Date();$('#widget-clock').textContent=new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit'}).format(date);$('#widget-date').textContent=new Intl.DateTimeFormat(locale(),{weekday:'long',day:'numeric',month:'long'}).format(date);
 }
 function selectTab(value){
  const picker=$('#widget-tool-picker');if(actions.has(value)){picker.value=selected;Promise.resolve().then(actions.get(value)).catch(error=>message(error.message));return}
  const outgoing=document.activeElement?.closest('[data-widget-pane]');
  const previous=selected;
  selected=[...picker.options].some(option=>option.value===value)?value:'timer';picker.value=selected;
  if(outgoing&&outgoing.dataset.widgetPane!==selected)picker.focus({preventScroll:true});
  for(const el of container.querySelectorAll('[data-widget-pane]'))el.hidden=el.dataset.widgetPane!==selected;
  if(previous!==selected)container.parentElement.scrollTop=0;
  renderTimer();schedule();host.dispatchEvent(new CustomEvent('brivany-widget-tab',{detail:{id:selected}}));
 }
 function addTool(id,title,pane){
  const picker=$('#widget-tool-picker');if(!picker||!/^[a-z][a-z-]{1,24}$/.test(id)||typeof title!=='string'||title.length>40||[...picker.options].some(option=>option.value===id))return false;
  const option=document.createElement('option');option.value=id;option.textContent=title;picker.append(option);
  pane.id='widget-pane-'+id;pane.classList.add('widget-pane');pane.setAttribute('role','region');pane.setAttribute('aria-label',title);pane.dataset.widgetPane=id;pane.hidden=true;container.insertBefore(pane,$('#widget-feedback'));localization?.mount(option);localization?.mount(pane);return true;
 }
 function addAction(id,title,action){
  const picker=$('#widget-tool-picker');if(!picker||!/^[a-z][a-z-]{1,24}$/.test(id)||typeof title!=='string'||title.length>40||typeof action!=='function'||[...picker.options].some(option=>option.value===id))return false;
  const option=document.createElement('option');option.value=id;option.textContent=title;picker.append(option);localization?.mount(option);actions.set(id,action);return true;
 }
 function updateTimer(action){
  if(action==='toggle')action=timer.state==='running'?'pause':timer.state==='paused'?'resume':'start';
  if(action==='start'){
   const minutes=Number($('#widget-timer-minutes')?.value??5),seconds=Number($('#widget-timer-seconds')?.value??0);
   if(!Number.isInteger(minutes)||!Number.isInteger(seconds)||minutes<0||minutes>180||seconds<0||seconds>59||minutes*60+seconds<1||minutes*60+seconds>10800){message('Elige entre 1 segundo y 180 minutos.');return}
   if(nativeDelegate){nativeDelegate.timer(action,(minutes*60+seconds)*1000);return}
   timer=core.transition(timer,'start',now(),(minutes*60+seconds)*1000);
  }else{if(nativeDelegate){nativeDelegate.timer(action,null);return}timer=core.transition(timer,action,now())}
  message('');store();renderTimer();schedule();
 }
 if(container){container.innerHTML=`
  <div class="widget-tool-nav"><select id="widget-tool-picker" aria-label="Herramienta"><option value="timer">Enfoque</option><option value="notes">Notas</option><option value="calculator">Calcular</option><option value="system">Windows</option><option value="clipboard">Copias</option><option value="clock">Reloj</option></select><button id="widget-tool-settings" aria-label="Ajustes de WorkSpace" title="Ajustes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1-1 3 2 2-1 3 3 2 3-1 2 2 3-1 1-3 3-1v-4l-3-1-1-3-3 1-2-2Z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
  <div id="widget-pane-timer" class="widget-pane" role="tabpanel" aria-labelledby="widget-tab-timer" data-widget-pane="timer"><div class="widget-timer-display"><output id="widget-timer-value" aria-label="Tiempo restante" aria-live="off">05:00</output><p id="widget-timer-state" class="widget-sr-only">Listo para empezar</p></div><div class="widget-timer-controls"><label>Minutos<input id="widget-timer-minutes" type="number" min="0" max="180" step="1" value="5"></label><label>Segundos<input id="widget-timer-seconds" type="number" min="0" max="59" step="1" value="0"></label><button id="widget-timer-action" class="widget-primary">Iniciar</button><button id="widget-timer-reset" aria-label="Restablecer temporizador">↺</button></div></div>
  <div id="widget-pane-notes" class="widget-pane" role="tabpanel" aria-labelledby="widget-tab-notes" data-widget-pane="notes" hidden><label class="widget-sr-only" for="widget-note">Lo que no quieres olvidar</label><textarea id="widget-note" maxlength="4000" rows="5" placeholder="Escribir nota…"></textarea><div class="widget-note-footer"><span id="widget-note-count" hidden>0 / 4000</span></div></div>
  <div id="widget-pane-calculator" class="widget-pane" role="tabpanel" aria-labelledby="widget-tab-calculator" data-widget-pane="calculator" hidden><form id="widget-calculator"><label for="widget-expression">Una cuenta rápida</label><div class="widget-calculator-row"><input id="widget-expression" maxlength="160" inputmode="decimal" placeholder="(120 + 80) × 0,15" autocomplete="off"><button class="widget-primary" aria-label="Calcular expresión">=</button></div><output id="widget-answer" aria-live="polite">0</output></form></div>
  <div id="widget-pane-system" class="widget-pane" role="tabpanel" aria-labelledby="widget-tab-system" data-widget-pane="system" hidden><div class="widget-system-controls"><button data-system-control="sound">Volumen</button><button data-system-control="display">Brillo y pantalla</button><button data-system-control="wifi">Wi-Fi</button><button data-system-control="bluetooth">Bluetooth</button><button data-system-control="notifications">Notificaciones</button><button data-system-control="privacy">Micrófono</button><button data-system-control="screenshot">Capturar pantalla</button><button id="widget-resources">Ver consumo</button></div><p id="widget-resource-value" class="widget-resource-value"></p></div>
  <div id="widget-pane-clipboard" class="widget-pane" role="tabpanel" aria-labelledby="widget-tab-clipboard" data-widget-pane="clipboard" hidden><div class="widget-clipboard-actions"><button id="widget-clipboard-read" class="widget-primary">Leer portapapeles</button><button id="widget-clipboard-clear">Borrar historial</button></div><div id="widget-clipboard-items" role="list" aria-label="Textos de esta sesión"></div></div>
  <div id="widget-pane-clock" class="widget-pane widget-clock-view" role="region" aria-label="Reloj" data-widget-pane="clock" hidden><time id="widget-clock"></time><p id="widget-date"></p></div>
  <p id="widget-feedback" role="status" class="widget-feedback"></p>`;
  localization?.mount(container);
  $('#widget-tool-picker').onchange=event=>selectTab(event.target.value);
  $('#widget-tool-settings').onclick=()=>runNative($('#widget-tool-settings'),()=>native('workspace_app_settings','work'));
  for(const option of $('#widget-tool-picker').options){const pane=$('[data-widget-pane="'+option.value+'"]');if(pane){pane.setAttribute('role','region');pane.setAttribute('aria-label',option.textContent);pane.removeAttribute('aria-labelledby')}}
  $('#widget-timer-action').addEventListener('click',()=>updateTimer('toggle'));$('#widget-timer-reset').addEventListener('click',()=>updateTimer('reset'));
  $('#widget-note').value=note;noteCount();
  $('#widget-note').addEventListener('input',()=>{note=boundedNote($('#widget-note').value);noteCount();if(nativeDelegate){nativeDelegate.note(note);return}host.clearTimeout(saveNote);saveNote=host.setTimeout(()=>{store();saveNote=0},400)});
  $('#widget-calculator').addEventListener('submit',event=>{event.preventDefault();try{answer=core.calculate($('#widget-expression').value);message('')}catch(error){answer=null;message(error.message)}renderAnswer()});
 }
 function renderAnswer(){if($('#widget-answer'))$('#widget-answer').textContent=answer===null?'—':new Intl.NumberFormat(locale(),{maximumFractionDigits:10}).format(answer)}
 async function native(method,...args){const api=host.pywebview?.api;if(!api?.[method])throw new Error('Abre esta herramienta en Brivany Desktop.');return api[method](...args)}
 function clipboardPaint(){const list=$('#widget-clipboard-items');if(!list)return;list.replaceChildren();if(!clipboard.length){const p=document.createElement('p');p.className='widget-help';p.textContent=t('Sin textos guardados en esta sesión.');list.append(p)}for(const item of clipboard){const row=document.createElement('div'),preview=document.createElement('p'),copy=document.createElement('button');row.className='widget-clipboard-item';row.setAttribute('role','listitem');preview.textContent=item.text.slice(0,140);copy.textContent=t('Copiar');copy.setAttribute('aria-label',t('Copiar texto {number}').replace('{number}',String(clipboard.indexOf(item)+1)));copy.onclick=()=>runNative(copy,async()=>{await native('workspace_clipboard_copy',item.id);message('Texto copiado.')});row.append(preview,copy);list.append(row)}}
 async function runNative(button,action){button.disabled=true;try{await action()}catch(error){message(typeof error?.message==='string'?error.message:'No se pudo completar la acción.')}finally{button.disabled=false}}
 if(container){for(const button of container.querySelectorAll('[data-system-control]'))button.onclick=()=>runNative(button,async()=>{const value=await native('workspace_control_open',button.dataset.systemControl);message(value.message||'Herramienta de Windows abierta.')});$('#widget-resources').onclick=()=>runNative($('#widget-resources'),async()=>{const result=await native('workspace_process_resources');$('#widget-resource-value').textContent='PID '+result.pid+ ' · '+t('CPU acumulada')+': '+result.cpu_seconds+' s · '+t('RAM residente')+': '+(result.rss_bytes==null?t('no disponible'):(result.rss_bytes/1048576).toFixed(1)+' MiB');$('#widget-resource-value').scrollIntoView({block:'nearest'});message('Medición puntual del anfitrión Python, sin WebView2.')});$('#widget-clipboard-read').onclick=()=>runNative($('#widget-clipboard-read'),async()=>{const value=await native('workspace_clipboard_read');clipboard=value.items||[];clipboardPaint();message('Texto guardado solo en esta sesión.')});$('#widget-clipboard-clear').onclick=()=>runNative($('#widget-clipboard-clear'),async()=>{const value=await native('workspace_clipboard_clear');clipboard=value.items||[];clipboardPaint();message('Historial borrado. El portapapeles de Windows se conserva.')});clipboardPaint()}
 if(glance)glance.addEventListener('click',()=>{selectTab('timer');host.BrivanyIsland?.expand('widgets',glance.getBoundingClientRect().x+glance.offsetWidth/2)});
 function receiveStorage(event){if(event.key!==KEY||!event.newValue)return;try{const value=JSON.parse(event.newValue),next=core.preferences(value.preferences),changed=JSON.stringify(next)!==JSON.stringify(preferences);preferences=next;if(!nativeDelegate){timer=core.timer(value.timer);if(typeof value.note==='string'&&document.activeElement!==$('#widget-note')){note=boundedNote(value.note);if($('#widget-note')){$('#widget-note').value=note;noteCount()}}renderTimer();schedule()}if(changed)applyPreferences()}catch{}}
 function useNative(delegate){nativeDelegate=delegate;if(saveNote){host.clearTimeout(saveNote);saveNote=0}schedule()}
 function adoptCanonical(value,{preserveNote=false}={}){if(disposed)return;const previous=timer;timer=core.timer(value.timer);if(!preserveNote&&typeof value.note==='string'){note=boundedNote(value.note);if($('#widget-note')&&$('#widget-note').value!==note){const el=$('#widget-note'),start=el.selectionStart,end=el.selectionEnd;el.value=note;el.setSelectionRange(Math.min(start,note.length),Math.min(end,note.length))}if($('#widget-note-count'))noteCount()}renderTimer();schedule();if(timer.state==='finished'&&previous.state==='running')notifyFinished(String(previous.deadline))}
 function refresh(){if(disposed)return;if(timer.state==='running'&&timer.deadline<=now())finish();renderTimer();schedule()}
 function receiveSettings(){if(disposed)return;try{receiveStorage({key:KEY,newValue:storage.getItem(KEY)})}catch{}}
 function localize(){
  if(disposed||!container)return;
  for(const option of $('#widget-tool-picker').options)$('[data-widget-pane="'+option.value+'"]')?.setAttribute('aria-label',option.textContent);
  renderTimer();renderAnswer();message(feedback);clipboardPaint();
 }
 function dispose(){if(disposed)return;disposed=true;if(saveNote){host.clearTimeout(saveNote);store()}host.clearTimeout(tick);host.clearTimeout(alarm);host.removeEventListener('brivany-workspace-settings',receiveSettings);host.removeEventListener('brivany-workspace-locale',localize);host.removeEventListener('storage',receiveStorage);host.removeEventListener('brivany-island-layout',refresh);document.removeEventListener('visibilitychange',refresh)}
 host.addEventListener('brivany-workspace-settings',receiveSettings);
 host.addEventListener('brivany-workspace-locale',localize);
 host.addEventListener('storage',receiveStorage);host.addEventListener('brivany-island-layout',refresh);document.addEventListener('visibilitychange',refresh);host.addEventListener('pagehide',dispose,{once:true});
 host.BrivanyWorkspaceWidgets={preferences:()=>({...preferences}),selectTab,addTool,addAction,message,dispose,useNative,adoptCanonical,desktopSeed:()=>({note,timer:{...timer}}),state:()=>({...timer,remaining:core.remaining(timer,now())}),scheduling:()=>({native:!!nativeDelegate,alarmPending:!!alarm,repaintPending:!!tick})};
 applyPreferences();refresh();
})(typeof window==='undefined'?null:window, function () {
 'use strict';
 const MAX=10800000;
 function preferences(value){value=value&&typeof value==='object'?value:{};return {theme:['dark','soft'].includes(value.theme)?value.theme:'dark',accent:['blue','mint','amber','rose'].includes(value.accent)?value.accent:'blue',size:['compact','normal','large'].includes(value.size)?value.size:'normal',economy:value.economy!==false,motion:value.motion!==false}}
 function timer(value){if(!value||typeof value!=='object')return {state:'idle',duration:300000,remaining:300000,deadline:0};const duration=Number.isFinite(value.duration)&&value.duration>=1000&&value.duration<=MAX?value.duration:300000;return {state:['idle','running','paused','finished'].includes(value.state)?value.state:'idle',duration,remaining:Math.max(0,Math.min(duration,Number.isFinite(value.remaining)?value.remaining:duration)),deadline:Number.isFinite(value.deadline)&&value.deadline>0?value.deadline:0}}
 function remaining(value,now){return value.state==='running'?Math.max(0,value.deadline-now):value.remaining}
 function transition(value,action,now,duration){value=timer(value);if(action==='start'){if(!Number.isInteger(duration)||duration<1000||duration>MAX)throw new Error('Duración inválida.');return {state:'running',duration,remaining:duration,deadline:now+duration}}if(action==='pause'&&value.state==='running')return {...value,state:'paused',remaining:remaining(value,now),deadline:0};if(action==='resume'&&value.state==='paused'&&value.remaining>0)return {...value,state:'running',deadline:now+value.remaining};if(action==='finish')return {...value,state:'finished',remaining:0,deadline:0};if(action==='reset')return {...value,state:'idle',remaining:value.duration,deadline:0};return value}
 function format(ms){const seconds=Math.ceil(Math.max(0,ms)/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
 function calculate(expression){
  if(typeof expression!=='string'||!expression.trim()||expression.length>160)throw new Error('Escribe una cuenta de hasta 160 caracteres.');
  const source=expression.replace(/,/g,'.').replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');let at=0,depth=0;
  const space=()=>{while(/\s/.test(source[at]||'')&&at<source.length)at++};
  function primary(){space();if(++depth>24)throw new Error('La cuenta tiene demasiados paréntesis.');let value;if(source[at]==='+'||source[at]==='-'){const sign=source[at++];value=(sign==='-'?-1:1)*primary()}else if(source[at]==='('){at++;value=sum();space();if(source[at++]!==')')throw new Error('Revisa los paréntesis.')}else{const match=/^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(at));if(!match)throw new Error('Usa números y los signos + − × ÷.');at+=match[0].length;value=Number(match[0])}depth--;return value}
  function product(){let value=primary();space();while(source[at]==='*'||source[at]==='/'){const operator=source[at++],right=primary();if(operator==='/'&&right===0)throw new Error('No se puede dividir entre cero.');value=operator==='*'?value*right:value/right;space()}return value}
  function sum(){let value=product();space();while(source[at]==='+'||source[at]==='-'){const operator=source[at++],right=product();value=operator==='+'?value+right:value-right;space()}return value}
  const result=sum();space();if(at!==source.length)throw new Error('Revisa la cuenta: hay símbolos sin calcular.');if(!Number.isFinite(result)||Math.abs(result)>1e15)throw new Error('El resultado está fuera del rango admitido.');return Object.is(result,-0)?0:result;
 }
 return {preferences,timer,remaining,transition,format,calculate};
});
