/* Explicit image actions only. Human, real Meta and simulated observations stay distinct. */
import {mountSousVoice} from './sous-voice.js';
const $=id=>document.getElementById(id);
const state={items:[],events:[],summary:{},plan:null,session:null,busy:false,evidence:null,evidenceLoading:false,evidenceGeneration:0,editor:null,eventItem:null,vision:null,visionInventorySession:null,catalog:[],preferences:null,shopping:null};
const units={unit:'ud.',g:'g',kg:'kg',ml:'ml',l:'l'};
const labels={not_started:'Sin iniciar',in_progress:'En curso',ready:'Comprobado',uncertain:'Por revisar'};
const sourceLabels={printed_label:'Etiqueta del envase',user_confirmed:'Fecha confirmada por ti',category_estimate:'Fecha estimada',unknown:'Fecha sin verificar'};
const sessionKey='brivany.sous.session';
const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
const quantity=value=>new Intl.NumberFormat('es',{maximumFractionDigits:3}).format(value);
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
function notify(message=''){$('notice').textContent=message;}
function error(id,message=''){$(id).textContent=message;}
function remember(id){try{if(id)localStorage.setItem(sessionKey,id);else localStorage.removeItem(sessionKey);}catch{}}
function remembered(){try{const value=localStorage.getItem(sessionKey);return uuid(value)?value:null;}catch{return null;}}
function pending(value){state.busy=value;for(const element of document.querySelectorAll('button,input,select,textarea'))if(!element.closest('.sous-conversation'))element.disabled=value;if(!value){$('event-saved').disabled=$('event-kind').value==='discarded';for(const button of document.querySelectorAll('[data-item-action]'))button.disabled=(state.items.find(item=>item.id===button.dataset.itemAction)?.quantity ?? 0)<=0;}}
async function api(path,payload){
  const response=await fetch(path,{method:payload===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    headers:payload===undefined?{}:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
  let result;try{result=await response.json();}catch{throw Error('Sous no pudo leer la respuesta local.');}
  if(!response.ok){const failure=Error(typeof result.message==='string'?result.message:typeof result.error?.message==='string'?result.error.message:'No se pudo guardar el cambio.');failure.status=response.status;throw failure;}
  return result;
}
function invalidatePlan(){state.plan=null;$('plan-meal').hidden=false;$('start-session').hidden=true;$('missing-ingredients').hidden=true;$('plan-status').textContent='Revisaremos los ingredientes que confirmaste.';}
function dateLabel(item){
  if(!item.expiry_date)return 'Fecha desconocida';
  const date=new Date(item.expiry_date+'T12:00:00'),formatted=new Intl.DateTimeFormat('es',{day:'numeric',month:'short',year:'numeric'}).format(date);
  return (sourceLabels[item.expiry_provenance] || 'Fecha sin verificar')+' · '+formatted;
}
function inventory(){
  const host=$('inventory');host.replaceChildren();
  if(!state.items.length){const empty=node('div',undefined,'empty');empty.append(node('strong','Empieza por lo que tienes.'),node('span','Añade huevos y una verdura para tu primera práctica.'));host.append(empty);}
  for(const item of state.items){
    const row=node('article',undefined,'inventory-row');row.dataset.itemId=item.id;
    const content=node('div'),heading=node('div',undefined,'ingredient-title');heading.append(node('h3',item.label),node('span',quantity(item.quantity)+' '+(units[item.unit] || item.unit),'quantity'));
    const meta=node('div',undefined,'ingredient-meta'),confirmed=item.confirmed===true;
    meta.append(node('span',confirmed?'Confirmado por ti':'Requiere confirmación','status-label'+(confirmed?'':' attention')),node('span',dateLabel(item)));
    if(item.confidence<.6)meta.append(node('span','Dato incierto · '+Math.round(item.confidence*100)+' %'));
    content.append(heading,meta);const actions=node('div',undefined,'inventory-actions');
    const edit=node('button',confirmed?'Editar':'Revisar','text-button');edit.type='button';edit.setAttribute('aria-label',(confirmed?'Editar ':'Revisar ')+item.label);edit.addEventListener('click',()=>openItem(item));
    const event=node('button','Registrar uso','text-button');event.type='button';event.dataset.itemAction=item.id;event.disabled=item.quantity<=0;event.setAttribute('aria-label','Registrar uso de '+item.label);event.addEventListener('click',()=>openEvent(item));
    actions.append(edit,event);row.append(content,actions);host.append(row);
  }
  const count=state.items.length,needs=Number(state.summary.needs_confirmation || 0),unknown=Number(state.summary.unknown_expiry_count || 0);
  $('inventory-summary').textContent=count?`${count} ingrediente${count===1?'':'s'}${needs?' · '+needs+' por confirmar':''}${unknown?' · '+unknown+' sin fecha':''}`:'Los ingredientes que registres se guardan aquí.';
  $('event-count').textContent=state.events.length?'· '+state.events.length:'';
  const events=$('kitchen-events');events.replaceChildren();
  for(const event of [...state.events].reverse().slice(0,15)){
    const item=state.items.find(item=>item.id===event.item_id),label=event.item_label || event.label || item?.label || 'Ingrediente';
    const entry=node('li');entry.append(node('strong',label),document.createTextNode(' · '+(event.kind==='discarded'?'Descartado':'Utilizado')+' · '+quantity(event.amount)+' '+(units[event.unit] || event.unit)));
    if(event.saved_from_waste===true)entry.append(document.createTextNode(' · Rescate declarado por ti'));
    events.append(entry);
  }
  if(!state.events.length)events.append(node('li','Aún no hay movimientos.'));
}
async function loadInventory(){const result=await api('/api/sous/inventory');state.items=result.items || [];state.events=result.events || [];state.summary=result.summary || {};inventory();window.dispatchEvent(new Event('sous-context-changed'));}
function openItem(item=null,candidate=false){
  state.editor=candidate?null:item;$('item-form').reset();error('item-error');$('item-dialog-title').textContent=candidate?'Revisar lectura visual.':item?'Revisar ingrediente.':'Añadir ingrediente.';
  $('item-label').value=item?.label || '';$('item-quantity').value=item?.quantity ?? 1;$('item-unit').value=item?.unit || 'unit';
  $('item-expiry').value=item?.expiry_date || '';$('item-expiry-source').value=item?.expiry_provenance || 'unknown';
  $('item-reference').value=item?.source_reference || '';
  const confidence=item?.confidence ?? 1,select=$('item-confidence');
  for(const option of [...select.options])if(!['1','0.5'].includes(option.value))option.remove();
  if(![1,.5].includes(confidence)){const option=node('option','Dato registrado · '+Math.round(confidence*100)+' %');option.value=String(confidence);select.append(option);}
  select.value=String(confidence);$('item-confirmed').checked=item?.confirmed ?? true;
  if(candidate){$('item-quantity').value='';$('item-confirmed').checked=false;}
  $('item-origin-note').textContent=candidate?'Candidato de una observación visual. Introduce y revisa tú la cantidad; nada se ha añadido aún.':'Las fechas estimadas se distinguen de las del envase. Confirma tú la cantidad antes de guardar.';
  $('item-dialog').showModal();$('item-label').focus();
}
async function saveItem(event){
  event.preventDefault();if(state.busy)return;error('item-error');const confidence=Number($('item-confidence').value),confirmed=$('item-confirmed').checked;
  const payload={label:$('item-label').value.trim(),quantity:Number($('item-quantity').value),unit:$('item-unit').value,
    confidence,confirmed:confirmed && confidence>=.6,expiry_date:$('item-expiry').value || null,
    expiry_provenance:$('item-expiry-source').value,source_reference:$('item-reference').value.trim() || null};
  if(Boolean(payload.expiry_date)===(payload.expiry_provenance==='unknown')){error('item-error','Una fecha necesita su procedencia. Si no conoces la fecha, conserva «Sin verificar».');return;}
  if(['printed_label','category_estimate'].includes(payload.expiry_provenance) && !payload.source_reference){error('item-error','Añade la etiqueta consultada o la base de tu estimación en Referencia.');return;}
  if(state.editor)payload.id=state.editor.id;
  pending(true);
  try{
    const result=await api('/api/sous/items',payload),item=result.item || result;
    if(confirmed && confidence<.6)await api('/api/sous/items/'+item.id+'/confirm',{confirmed:true,expiry_date:payload.expiry_date,expiry_provenance:payload.expiry_provenance,source_reference:payload.source_reference});
    await loadInventory();invalidatePlan();$('item-dialog').close();notify('Ingrediente guardado en este equipo.');
  }catch(exception){error('item-error',exception.message);}finally{pending(false);}
}
function openEvent(item){
  state.eventItem=item;$('event-form').reset();error('event-error');$('event-title').textContent=item.label;
  $('event-unit').textContent=units[item.unit] || item.unit;$('event-amount').value=item.quantity;$('event-amount').max=item.quantity;
  $('event-saved').disabled=false;$('event-dialog').showModal();
}
async function saveEvent(event){
  event.preventDefault();if(state.busy)return;error('event-error');const item=state.eventItem,kind=$('event-kind').value;
  const payload={kind,amount:Number($('event-amount').value),unit:item.unit,saved_from_waste:kind==='consumed' && $('event-saved').checked,
    estimated_unit_price_usd:$('event-price').value===''?null:Number($('event-price').value)};
  pending(true);try{await api('/api/sous/items/'+item.id+'/events',payload);await loadInventory();invalidatePlan();$('event-dialog').close();notify('Movimiento registrado. El rescate y el precio, si los indicaste, son estimaciones tuyas.');}
  catch(exception){error('event-error',exception.message);}finally{pending(false);}
}
function preferences(){return {vegetarian:$('vegetarian').checked,vegan:$('vegan').checked,allergens:$('allergens').value.split(',').map(value=>value.trim()).filter(Boolean),recipe_id:$('recipe-choice').value};}
async function plan(){
  if(state.busy)return;pending(true);$('plan-status').textContent='Revisando tu inventario…';$('start-session').hidden=true;error('page-error-message');$('page-error').hidden=true;
  try{
    if(state.preferences)await savePreferences(false);
    state.plan=await api('/api/sous/plan',preferences());const recipe=state.plan.recipe,eligibility=state.plan.eligibility;
    if(recipe){$('recipe-title').textContent=recipe.title;$('recipe-source').textContent=(recipe.source?.note || 'Receta de práctica predefinida en Brivany.')+' No generada por IA.';}
    const ready=eligibility?.status==='ready';$('start-session').hidden=!ready;$('plan-meal').hidden=ready;
    $('plan-status').textContent=ready?'Tus ingredientes confirmados permiten iniciar la guía.':eligibility?.status==='blocked_constraint'?'Esta receta no cumple tus preferencias. No iniciaremos la práctica.':'Faltan ingredientes confirmados para esta receta.';
    const list=$('missing-ingredients');list.replaceChildren();
    if(!ready){
      for(const item of state.plan.cart?.items || [])list.append(node('li',item.label || item.name || 'Ingrediente pendiente'));
      for(const item of eligibility?.excluded_items || [])list.append(node('li',item.label+' · '+({unconfirmed:'Por confirmar',expired:'Fecha vencida',low_confidence:'Dato por revisar'}[item.reason] || 'No disponible para esta práctica')));
      if(!list.children.length && eligibility?.status==='missing_ingredients')list.append(node('li','Revisa los ingredientes de esta práctica.'));
    }
    list.hidden=!list.children.length;
  }catch(exception){$('plan-status').textContent=exception.message;}finally{pending(false);}
}
async function startSession(){
  if(state.busy || state.plan?.eligibility?.status!=='ready')return;pending(true);
  try{const result=await api('/api/sous/sessions',{recipe_id:state.plan.recipe.id,mode:'manual'});state.session=result.session || result;remember(state.session.id);clearEvidence();showSession();notify('Práctica local iniciada. Las comprobaciones las realizas tú.');}
  catch(exception){$('plan-status').textContent=exception.message;}finally{pending(false);}
}
function clearEvidence(){
  state.evidenceGeneration++;state.evidence=null;state.evidenceLoading=false;
  $('evidence-file').value='';$('evidence-image').removeAttribute('src');$('evidence-preview').hidden=true;$('evidence-count').textContent='Sin foto';error('photo-error');
  $('verify-step').disabled=state.busy;
}
async function chooseEvidence(){
  const file=$('evidence-file').files?.[0];clearEvidence();const generation=state.evidenceGeneration;if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>8*1024*1024 || file.size===0){clearEvidence();error('photo-error','Elige una imagen PNG, JPG o WebP de hasta 8 MiB.');return;}
  state.evidenceLoading=true;$('verify-step').disabled=true;
  try{
    const bitmap=await createImageBitmap(file);if(bitmap.width<1 || bitmap.height<1 || bitmap.width>12000 || bitmap.height>12000){bitmap.close();throw Error('La imagen excede los límites.');}bitmap.close();
    const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());if(generation!==state.evidenceGeneration)return;
    const sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
    const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('image'));reader.readAsDataURL(file);});
    if(generation!==state.evidenceGeneration)return;
    state.evidence={sha256,file};$('evidence-image').src=url;$('evidence-preview').hidden=false;
    $('evidence-label').textContent='Foto elegida · '+Math.round(file.size/1024)+' KiB';$('evidence-count').textContent='1 foto local';
  }catch(exception){if(generation===state.evidenceGeneration){clearEvidence();error('photo-error','No se pudo abrir esa imagen. Elige otra foto.');}}
  finally{if(generation===state.evidenceGeneration){state.evidenceLoading=false;$('verify-step').disabled=state.busy;}}
}
function showPantry(){
  document.querySelector('.intro').hidden=false;$('pantry-view').hidden=false;$('cooking-view').hidden=true;clearEvidence();$('verify-form').reset();notify('Tu práctica queda guardada en este equipo.');
  window.dispatchEvent(new Event('sous-context-changed'));
  if(state.session && !isComplete(state.session)){
    const button=node('button','Continuar mi práctica →','text-button');button.type='button';button.id='resume-session';button.addEventListener('click',showSession);$('notice').append(document.createTextNode(' '),button);
  }
}
function isComplete(session){return session.status==='completed' || session.status==='complete' || session.steps?.every(step=>step.state==='ready');}
function showSession(){
  const session=state.session;if(!session)return;document.querySelector('.intro').hidden=true;$('pantry-view').hidden=true;$('cooking-view').hidden=false;notify('');
  $('cooking-recipe-label').textContent=(session.recipe_title || state.catalog.find(item=>item.id===session.recipe_id)?.title || 'Tu receta').toUpperCase()+' · CON GUÍA';
  window.dispatchEvent(new Event('sous-context-changed'));
  const complete=isComplete(session),steps=session.steps || [],index=steps.findIndex(step=>step.id===session.current_step_id),step=steps[index];
  const source=verificationLabel(session.verification_mode);
  $('session-mode').textContent=source;
  $('session-status').textContent=complete?'Guía completada con observaciones registradas.':'Comprueba cada paso antes de continuar.';
  $('cooking-title').textContent=complete?'Tu práctica, registrada.':'A tu ritmo.';
  $('step-progress').replaceChildren();for(const [position,item] of steps.entries()){
    const entry=node('li',item.label,item.state==='ready'?'complete-step':item.id===session.current_step_id?'current':'');
    entry.append(node('span',labels[item.state] || 'Por revisar'));if(item.id===session.current_step_id)entry.setAttribute('aria-current','step');$('step-progress').append(entry);
  }
  $('active-step').hidden=complete;$('session-complete').hidden=!complete;
  if(step && !complete){$('step-counter').textContent=`PASO ${index+1} DE ${steps.length}`;$('step-title').textContent=step.label;$('step-criterion').textContent=step.criterion;$('step-instruction').textContent=step.instruction || '';$('step-state').textContent=(labels[step.state] || 'Sin iniciar')+' · '+source;}
  $('observation-count').textContent=session.observations_count?'· '+session.observations_count:'';
  const ledger=$('observations-list');ledger.replaceChildren();
  for(const entry of session.ledger || []){
    const evidence=entry.evidence || entry,description=evidence.observation || entry.observation;
    if(!description)continue;const item=node('li',description);item.append(node('small',verificationLabel(entry.verification_mode,evidence.source)+' · '+(labels[evidence.verdict] || evidence.verdict || 'Observación')+(evidence.frame_sha256?' · Foto: huella SHA-256':'')));ledger.append(item);
  }
  if(!ledger.children.length)ledger.append(node('li','Las observaciones que registres aparecerán aquí.'));
}
async function verify(event){
  event.preventDefault();if(state.busy || !state.session)return;error('verification-error');
  if(state.evidenceLoading){error('verification-error','Espera a que la foto termine de prepararse.');return;}
  const verdict=document.querySelector('input[name="verdict"]:checked')?.value,observation=$('observation').value.trim().replace(/\s+/g,' '),confirmed=$('human-confirmed').checked;
  if(!observation || observation.length>600){error('verification-error','Describe tu comprobación en un máximo de 600 caracteres.');return;}
  if(!verdict){error('verification-error','Indica tu criterio para este paso.');return;}
  if(verdict==='ready' && !confirmed){error('verification-error','Confirma que tú revisaste este paso antes de marcarlo listo.');return;}
  const session=state.session,payload={expected_revision:session.revision,step_id:session.current_step_id,evidence:{frame_sha256:state.evidence?.sha256 || null,observation,verdict,source:'human',human_confirmed:verdict==='ready' && confirmed}};
  pending(true);
  try{const result=await api('/api/sous/sessions/'+session.id+'/verify',payload);state.session=result.session || result;
    clearEvidence();$('verify-form').reset();showSession();notify(verdict==='ready'?'Comprobación humana registrada.':'Duda registrada. El paso permanece abierto.');}
  catch(exception){
    if(exception.status===409){try{const latest=await api('/api/sous/sessions/'+session.id);state.session=latest.session || latest;showSession();}catch{}error('verification-error','La práctica cambió en otra ventana. Revisa el paso actual antes de volver a registrar.');}
    else error('verification-error',exception.message);
  }finally{pending(false);}
}
async function boot(){
  if(state.busy)return;pending(true);$('page-error').hidden=true;notify('Abriendo tu cocina…');
  try{await loadInventory();await loadVisionStatus();await loadCatalog();await loadShopping();notify('Tus datos se guardan en este equipo. Las fotos sólo se envían cuando lo autorizas.');
    const saved=remembered();if(saved){try{const result=await api('/api/sous/sessions/'+saved);state.session=result.session || result;if(!isComplete(state.session))showPantry();}catch(exception){if(exception.status===404)remember(null);}}
  }catch(exception){$('page-error').hidden=false;error('page-error-message',exception.message);notify('Sous no pudo abrir el almacenamiento local.');}
  finally{pending(false);}
}
$('add-item').addEventListener('click',()=>openItem());$('close-item').addEventListener('click',()=>$('item-dialog').close());$('item-form').addEventListener('submit',saveItem);
$('close-event').addEventListener('click',()=>$('event-dialog').close());$('event-form').addEventListener('submit',saveEvent);
$('event-kind').addEventListener('change',()=>{const discard=$('event-kind').value==='discarded';$('event-saved').disabled=discard;if(discard)$('event-saved').checked=false;});
$('plan-meal').addEventListener('click',plan);$('start-session').addEventListener('click',startSession);
for(const id of ['vegetarian','vegan','allergens','locality-country','locality-city'])$(id).addEventListener('input',invalidatePlan);
$('recipe-choice').addEventListener('change',()=>{invalidatePlan();renderRecipe();});
$('save-preferences').addEventListener('click',async()=>{if(state.busy)return;pending(true);try{await savePreferences(true);}catch(exception){$('preferences-status').textContent=exception.message;}finally{pending(false);}});
$('shopping-from-plan').addEventListener('click',addMissingShopping);$('shopping-form').addEventListener('submit',addShoppingItem);
$('back-pantry').addEventListener('click',showPantry);$('finish-session').addEventListener('click',showPantry);
$('verify-form').addEventListener('submit',verify);$('evidence-file').addEventListener('change',chooseEvidence);$('remove-evidence').addEventListener('click',clearEvidence);
$('retry').addEventListener('click',boot);window.addEventListener('pagehide',clearEvidence);
$('inventory-vision-send').addEventListener('click',observeInventory);
$('cooking-vision-send').addEventListener('click',observeCooking);
mountSousVoice({getSessionId:()=>!$('cooking-view').hidden?state.session?.id || null:null});
boot();

function verificationLabel(mode,source){
  if(mode==='test_meta_adapter')return 'Meta simulado · prueba local';
  if(mode==='meta_live')return 'Observación Meta · criterio visual';
  if(mode?.startsWith('replay'))return 'Reproducción · sin verificación en vivo';
  return source==='meta'?'Procedencia Meta por revisar':'Revisión humana · local';
}
function renderRecipe(){
  const recipe=state.catalog.find(item=>item.id===$('recipe-choice').value);if(!recipe)return;
  $('recipe-title').textContent=recipe.title;$('recipe-description').textContent=recipe.locality_note;
  $('recipe-source').textContent=recipe.source?.note || 'Propuesta escrita para Brivany.';
}
async function loadCatalog(){
  try{
    const result=await api('/api/sous/catalog');state.catalog=result.recipes || [];state.preferences=result.preferences;
    const choice=$('recipe-choice');choice.replaceChildren();for(const recipe of state.catalog){const option=node('option',recipe.title+(recipe.matches_declared_country?' · tu país':''));option.value=recipe.id;choice.append(option);}
    choice.value=state.preferences.recipe_id;$('vegetarian').checked=state.preferences.vegetarian;$('vegan').checked=state.preferences.vegan;$('allergens').value=state.preferences.allergens.join(', ');
    $('locality-country').value=state.preferences.locality?.country || '';$('locality-city').value=state.preferences.locality?.city || '';
    $('locality-note').textContent=state.preferences.locality?'Localidad declarada por ti. No usamos geolocalización.':'No usamos tu ubicación automáticamente.';
    $('catalog-count').textContent=state.catalog.length+' prácticas escritas';renderRecipe();
  }catch(exception){$('preferences-status').textContent='Catálogo no disponible. La práctica actual sigue disponible.';}
}
async function savePreferences(reload){
  if(!state.preferences)throw Error('Las preferencias aún no están disponibles.');
  const country=$('locality-country').value.trim(),city=$('locality-city').value.trim();if(city && !country)throw Error('Indica también el país o deja la localidad vacía.');
  let result;
  try{result=await api('/api/sous/preferences',{expected_revision:state.preferences.revision,locality:country?{country,city:city || null}:null,...preferences()});}
  catch(exception){if(exception.status===409){await loadCatalog();invalidatePlan();}throw exception;}
  state.preferences=result.preferences || result;$('preferences-status').textContent='Preferencias guardadas en este equipo.';
  window.dispatchEvent(new Event('sous-context-changed'));
  if(reload)await loadCatalog();
}
async function loadShopping(){
  try{const result=await api('/api/sous/shopping');state.shopping=result.shopping || result;renderShopping();}
  catch{$('shopping-status').textContent='Lista de compras no disponible.';}
}
function renderShopping(){
  const host=$('shopping-items');host.replaceChildren();const items=state.shopping?.items || [];
  $('shopping-count').textContent=items.length?items.filter(item=>!item.checked).length+' por revisar':'En este equipo';
  if(!items.length){host.append(node('li','Añade ingredientes o lo que falta en tu receta.','subtle'));return;}
  for(const item of items){
    const row=node('li',undefined,'shopping-row'),check=document.createElement('input');check.type='checkbox';check.checked=item.checked;check.setAttribute('aria-label','Marcar '+item.label);
    check.addEventListener('change',()=>editShopping(item.id,{checked:check.checked}));
    const label=document.createElement('input');label.type='text';label.value=item.label;label.maxLength=120;label.setAttribute('aria-label','Ingrediente de compra');label.addEventListener('change',()=>editShopping(item.id,{label:label.value.trim()}));
    const amount=document.createElement('input');amount.type='number';amount.min='.001';amount.max='1000000';amount.step='any';amount.value=item.quantity;amount.setAttribute('aria-label','Cantidad de '+item.label);amount.addEventListener('change',()=>editShopping(item.id,{quantity:Number(amount.value)}));
    const unit=document.createElement('select');unit.setAttribute('aria-label','Unidad de '+item.label);for(const [value,title] of Object.entries(units)){const option=node('option',title);option.value=value;unit.append(option);}unit.value=item.unit;unit.addEventListener('change',()=>editShopping(item.id,{unit:unit.value}));
    const remove=node('button','Quitar','text-button');remove.type='button';remove.setAttribute('aria-label','Quitar '+item.label);remove.addEventListener('click',()=>writeShopping(items.filter(value=>value.id!==item.id)));
    row.dataset.checked=String(item.checked);row.append(check,label,amount,unit,remove);host.append(row);
  }
}
async function writeShopping(items){
  if(state.busy || !state.shopping)return;pending(true);error('shopping-error');
  try{const result=await api('/api/sous/shopping',{expected_revision:state.shopping.revision,items});state.shopping=result.shopping || result;renderShopping();$('shopping-status').textContent='Lista guardada. No se realizó ningún pedido.';return true;}
  catch(exception){error('shopping-error',exception.message);await loadShopping();return false;}finally{pending(false);}
}
function editShopping(id,changes){writeShopping(state.shopping.items.map(item=>item.id===id?{...item,...changes}:item));}
async function addShoppingItem(event){event.preventDefault();if(!state.shopping)return;const saved=await writeShopping([...state.shopping.items,{label:$('shopping-label').value.trim(),quantity:Number($('shopping-quantity').value),unit:$('shopping-unit').value,checked:false}]);if(saved)$('shopping-form').reset();}
async function addMissingShopping(){
  if(state.busy || !state.shopping)return;pending(true);error('shopping-error');
  try{if(state.preferences)await savePreferences(false);const result=await api('/api/sous/shopping/from-plan',{expected_revision:state.shopping.revision,recipe_id:$('recipe-choice').value});state.shopping=result.shopping || result;renderShopping();$('shopping-status').textContent='Ingredientes faltantes añadidos; revisa la lista antes de comprar.';}
  catch(exception){error('shopping-error',exception.message);if(exception.status===409)await loadShopping();}finally{pending(false);}
}
async function loadVisionStatus(){
  try{state.vision=await api('/api/sous/vision/status');$('vision-status').textContent=state.vision.configured?'Configuración disponible':'Sin configurar';}
  catch{state.vision=null;$('vision-status').textContent='No disponible';}
}
async function visionBlob(file){
  if(!file || !['image/png','image/jpeg'].includes(file.type) || !file.size || file.size>8*1024*1024)throw Error('Elige una foto PNG/JPEG de hasta 8 MiB.');
  const bitmap=await createImageBitmap(file);
  try{
    if(!bitmap.width || !bitmap.height || bitmap.width>12000 || bitmap.height>12000 || bitmap.width*bitmap.height>20000000)throw Error('La imagen excede los límites.');
    const ratio=Math.min(1,1280/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
    if(!blob || blob.size>2*1024*1024)throw Error('La foto preparada supera 2 MiB. Elige otra imagen.');
    return blob;
  }finally{bitmap.close();}
}
async function sendVision(path,blob,headers={}){
  const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':blob.type,'X-Brivany-Consent':'true',...headers},body:blob});
  let result;try{result=await response.json();}catch{throw Error('No se pudo leer la observación visual.');}
  if(!response.ok){const exception=Error(result.message || result.error?.message || 'La observación no se completó.');exception.status=response.status;throw exception;}return result;
}
function visionConsent(id){
  if(!$(id).checked)throw Error('Autoriza el envío de esta foto a Meta antes de continuar.');
  if(state.vision?.configured!==true)throw Error('La visión Meta aún no está configurada. El modo manual sigue disponible.');
}
async function observeInventory(){
  if(state.busy)return;error('inventory-vision-error');
  try{visionConsent('inventory-vision-consent');const file=$('inventory-vision-file').files?.[0];if(!file)throw Error('Elige primero una foto de tu cocina.');
    pending(true);$('vision-candidates').replaceChildren();$('inventory-vision-message').textContent='Preparando una única lectura…';const blob=await visionBlob(file);
    const result=await sendVision('/api/sous/vision/inventory',blob,state.visionInventorySession?{'X-Session-Id':state.visionInventorySession}:{});
    state.visionInventorySession=result.session_id;$('inventory-vision-consent').checked=false;
    const host=$('vision-candidates');host.replaceChildren();
    for(const candidate of result.candidates || []){const row=node('article',undefined,'vision-candidate'),content=node('div');content.append(node('strong',candidate.label),node('small',Math.round(candidate.confidence*100)+' % · Cantidad por confirmar'));
      const button=node('button','Revisar cantidad','text-button');button.type='button';button.addEventListener('click',()=>openItem(candidate,true));row.append(content,button);host.append(row);}
    $('inventory-vision-message').textContent=(result.metadata?.simulation?'Lectura simulada de prueba. ':'Observación de Meta. ')+(result.candidates?.length || 0)+' candidatos; nada se guardó automáticamente.';
  }catch(exception){error('inventory-vision-error',exception.message);$('inventory-vision-message').textContent='No se añadió ningún ingrediente.';}finally{pending(false);}
}
async function observeCooking(){
  if(state.busy || !state.session)return;error('cooking-vision-error');
  try{visionConsent('cooking-vision-consent');if(state.evidenceLoading || !state.evidence?.file)throw Error('Elige primero una foto para este paso.');
    pending(true);$('cooking-vision-message').textContent='Preparando una única observación…';const blob=await visionBlob(state.evidence.file),session=state.session;
    const result=await sendVision('/api/sous/vision/sessions/'+session.id+'/verify',blob,{'X-Expected-Revision':String(session.revision)});
    state.session=result.session;clearEvidence();$('verify-form').reset();showSession();
    $('cooking-vision-message').textContent=(result.metadata?.simulation?'Observación simulada de prueba. ':'Observación visual de Meta. ')+(result.session.current_step_id===session.current_step_id?'El paso sigue abierto.':'Paso registrado; seguimos con el siguiente.');
  }catch(exception){
    if(exception.status===409){try{const latest=await api('/api/sous/sessions/'+state.session.id);state.session=latest.session || latest;showSession();}catch{}}
    error('cooking-vision-error',exception.message);$('cooking-vision-message').textContent='No se repitió la solicitud.';
  }finally{pending(false);}
}
