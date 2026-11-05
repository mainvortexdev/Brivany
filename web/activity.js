/* Local project ledger. No microphones, model calls, or telemetry. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const kinds = {idea:'Idea',implementation:'Implementación',test:'Prueba',decision:'Decisión'};
  const statuses = {pending:'Pendiente',implemented:'Implementado',passed:'Prueba superada',failed:'Prueba fallida'};
  const health = {ok:'SHA-256 coincide',missing:'Falta la copia',mismatch:'SHA-256 no coincide'};
  const dayFormat = new Intl.DateTimeFormat('es-BO',{timeZone:'America/La_Paz',day:'2-digit',month:'short',year:'numeric'});
  const timeFormat = new Intl.DateTimeFormat('es-BO',{timeZone:'America/La_Paz',hour:'2-digit',minute:'2-digit'});
  let data = null, loading = false;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if(className) node.className = className;
    if(text !== undefined) node.textContent = String(text);
    return node;
  }
  function costText(cost) {
    const calls = Number.isInteger(cost?.external_calls) && cost.external_calls >= 0 ? cost.external_calls + ' llamadas externas' : 'Llamadas externas sin registrar';
    const gpu = Number.isFinite(cost?.gpu_seconds) && cost.gpu_seconds >= 0 ? cost.gpu_seconds + ' s de GPU' : 'Tiempo de GPU sin registrar';
    return calls + ' · ' + gpu;
  }
  function safeEvidenceURL(value) {
    if(typeof value !== 'string') return null;
    try {
      const url = new URL(value,location.origin);
      return url.origin === location.origin && url.pathname.startsWith('/api/activity/') ? url.href : null;
    } catch { return null; }
  }
  function evidenceItem(record) {
    const item = element('li'), heading = element('div','evidence-heading');
    const url = safeEvidenceURL(record.url);
    const link = element(url ? 'a' : 'span','',record.label || 'Evidencia');
    if(url) { link.href = url; link.target = '_blank'; link.rel = 'noopener'; }
    const integrity = element('span','evidence-health',health[record.integrity] || 'Sin comprobar');
    integrity.dataset.integrity = record.integrity || 'unknown';
    heading.append(link,integrity);
    const hash = element('code','evidence-hash','SHA-256 · ' + (record.sha256 || 'Sin hash'));
    const size = element('span','evidence-hash',Number.isInteger(record.size_bytes) ? record.size_bytes.toLocaleString('es-BO') + ' bytes · copia conservada' : 'Tamaño sin registrar');
    item.append(heading,hash,size);
    return item;
  }
  function activityItem(entry) {
    const item = element('li','activity-item'); item.dataset.entryId = entry.id;
    const date = element('time','activity-date');
    const parsed = new Date(entry.recorded_at);
    if(Number.isNaN(parsed.getTime())) date.textContent = 'Fecha sin registrar';
    else { date.dateTime = parsed.toISOString(); date.textContent = dayFormat.format(parsed); date.append(element('span','',timeFormat.format(parsed) + ' · La Paz')); }
    const content = element('article'), meta = element('div','entry-meta');
    const status = element('span','entry-status',statuses[entry.status] || 'Sin clasificar'); status.dataset.status = entry.status;
    meta.append(element('span','entry-kind',kinds[entry.kind] || 'Actividad'),status);
    content.append(meta,element('h3','',entry.title),element('p','entry-summary',entry.summary || ''));
    const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
    const details = element('details','entry-details');
    details.append(element('summary','',evidence.length ? 'Ver evidencia y registro · ' + evidence.length : 'Ver registro'));
    const body = element('div','detail-body');
    body.append(element('p','detail-label',entry.verification === 'evidenced' ? 'Incluye evidencia conservada. Revisa su alcance en los archivos.' : 'Declaración registrada. Aún no incluye evidencia adjunta.'));
    body.append(element('p','detail-label',costText(entry.cost)),element('p','detail-label','ID · ' + entry.id));
    if(evidence.length) { const list = element('ul','evidence-list'); list.setAttribute('aria-label','Evidencias de la actividad'); evidence.forEach(record=>list.append(evidenceItem(record))); body.append(list); }
    details.append(body); content.append(details); item.append(date,content); return item;
  }
  function render() {
    if(!data) return;
    const query = $('activity-search').value.trim().toLocaleLowerCase('es');
    const kind = $('activity-kind').value, status = $('activity-status').value;
    const entries = data.entries.filter(entry=>(!kind || entry.kind === kind) && (!status || entry.status === status) && (!query || [entry.title,entry.summary,kinds[entry.kind],statuses[entry.status]].join(' ').toLocaleLowerCase('es').includes(query)));
    $('activity-list').replaceChildren(...entries.map(activityItem));
    $('activity-empty').hidden = entries.length > 0;
    $('load-older-activity').hidden = !data.has_more;
    $('empty-title').textContent = data.entries.length ? 'No hay coincidencias.' : 'El registro empieza aquí.';
    $('empty-description').textContent = data.entries.length ? 'Prueba con otro término o cambia los filtros.' : 'Los próximos avances aparecerán en esta bitácora.';
    $('activity-notice').textContent = entries.length + (entries.length === 1 ? ' actividad' : ' actividades') + (entries.length !== data.entries.length ? ' de ' + data.entries.length : '') + ' · más recientes primero';
  }
  async function load(older = false) {
    if(loading) return;
    loading = true; $('refresh-activity').disabled = true; $('load-older-activity').disabled = true; $('activity-error').hidden = true;
    $('activity-notice').textContent = 'Consultando registro…'; $('activity-list').setAttribute('aria-busy','true');
    const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),12000);
    try {
      const cursor = older && data?.has_more ? '?before=' + encodeURIComponent(data.next_before) : '';
      const response = await fetch('/api/activity' + cursor,{cache:'no-store',signal:controller.signal});
      if(!response.ok) throw new Error('El servidor local respondió con un error.');
      const result = await response.json();
      if(!Array.isArray(result.entries) || !result.entries.every(entry=>entry && typeof entry.id === 'string' && typeof entry.title === 'string')) throw new Error('El registro recibido no tiene el formato esperado.');
      if(older && data) result.entries = [...new Map([...data.entries,...result.entries].map(entry=>[entry.id,entry])).values()];
      data = result;
      $('entry-count').textContent = (Number.isInteger(data.integrity?.entries) ? data.integrity.entries : data.entries.length).toLocaleString('es-BO');
      const valid = data.integrity?.valid === true;
      $('integrity-label').textContent = valid ? 'Cadena local íntegra' : 'El registro necesita revisión';
      $('integrity-label').parentElement.classList.toggle('warning',!valid);
      $('export-activity').disabled = false; render();
    } catch(error) {
      $('activity-error').hidden = false;
      $('activity-error-message').textContent = error.name === 'AbortError' ? 'La consulta tardó demasiado. Pulsa Actualizar para intentarlo de nuevo.' : 'Comprueba que el servidor local siga abierto e inténtalo de nuevo.';
      $('activity-notice').textContent = data ? 'Se conserva la última consulta. No se pudo actualizar.' : '';
      if(!data) { $('activity-empty').hidden = true; $('integrity-label').textContent = 'Registro sin comprobar'; }
    } finally { clearTimeout(timeout); loading = false; $('refresh-activity').disabled = false; $('load-older-activity').disabled = false; $('activity-list').removeAttribute('aria-busy'); }
  }
  $('activity-filters').addEventListener('submit',event=>event.preventDefault());
  $('activity-search').addEventListener('input',render);
  $('activity-kind').addEventListener('change',render);
  $('activity-status').addEventListener('change',render);
  $('refresh-activity').addEventListener('click',()=>load());
  $('load-older-activity').addEventListener('click',()=>load(true));
  $('export-activity').addEventListener('click',()=>{
    if(!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link = element('a'); link.href = url; link.download = 'brivany-bitacora-' + new Date().toISOString().slice(0,10) + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  load();
})();
