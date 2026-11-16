const zone='America/La_Paz';
// Keep meeting URL extraction here independent of OAuth/Recall setup.
function conferenceURL(item){
 const candidates=[item.hangoutLink,...(item.conferenceData?.entryPoints||[]).filter(p=>p.entryPointType==='video').map(p=>p.uri),...(String(item.description||'')+' '+String(item.location||'')).matchAll(/https:\/\/[^\s<>"']+/g)].map(x=>Array.isArray(x)?x[0].replace(/&amp;/g,'&'):x);
 for(const value of candidates){try{const u=new URL(value);if(u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&((u.hostname==='meet.google.com'&&/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(u.pathname))||((u.hostname==='zoom.us'||/^[a-z0-9-]+\.zoom\.us$/.test(u.hostname))&&/^\/(j|my)\/[A-Za-z0-9._-]+\/?$/.test(u.pathname))))return u.href;}catch{}}
 return null;
}
const dateKey=value=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
const validDay=value=>{const date=new Date(value+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(+date)&&date.toISOString().slice(0,10)===value;};
export function calendarWindow(url,now=new Date()){
 const from=url.searchParams.get('from')||dateKey(new Date(+now-31*86400000)),to=url.searchParams.get('to')||dateKey(new Date(+now+62*86400000));
 if(!validDay(from)||!validDay(to)||to<=from||new Date(to)-new Date(from)>366*86400000)throw Object.assign(Error('Rango de fechas no válido.'),{status:400});
 return {from,to};
}
export function normalizedGoogleEvent(item,{source,calendarId,calendarName,readOnly=false}){
 if(!item?.id||item.status==='cancelled'||!item.start)return null;
 const allDay=!!item.start.date,start=allDay?null:new Date(item.start.dateTime);if(!allDay&&!Number.isFinite(+start))return null;
 return {id:'google:'+source+':'+item.id,googleId:item.id,googleCalendarId:calendarId,source,calendarName,readOnly,kind:'event',title:String(item.summary||'Sin título').slice(0,160),day:allDay?item.start.date:dateKey(start),time:allDay?'':new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hour12:false}).format(start),endDay:allDay?item.end?.date||item.start.date:dateKey(new Date(item.end?.dateTime||item.start.dateTime)),allDay,startAt:allDay?null:start.toISOString(),endAt:allDay?null:new Date(item.end?.dateTime||item.start.dateTime).toISOString(),meetingUrl:conferenceURL(item),notes:String(item.description||'').slice(0,1000),localId:item.extendedProperties?.private?.vetsaLocalId||'',dirty:false};
}
export async function googleCalendarSnapshot({accessToken,calendarId,calendarName,source,readOnly,range,fetcher=fetch}){
 const items=[];let pageToken;
 for(let page=0;page<8;page++){
  const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events');
  for(const[key,value]of Object.entries({timeMin:range.from+'T00:00:00-04:00',timeMax:range.to+'T00:00:00-04:00',singleEvents:'true',showDeleted:'false',orderBy:'startTime',timeZone:zone,maxResults:'250',...(pageToken?{pageToken}:{})}))url.searchParams.set(key,value);
  const response=await fetcher(url.href,{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(15000),redirect:'manual'});
  if(!response.ok){await response.body?.cancel();throw Object.assign(Error('No se pudieron leer los eventos de Google.'),{status:response.status===401?401:502});}
  const reader=response.body.getReader();let bytes=0,chunks=[];try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2000000)throw Error('Respuesta de calendario demasiado grande.');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const dataBytes=new Uint8Array(bytes);let at=0;for(const chunk of chunks){dataBytes.set(chunk,at);at+=chunk.length;}const data=JSON.parse(new TextDecoder().decode(dataBytes));
  for(const item of data.items||[]){const event=normalizedGoogleEvent(item,{source,calendarId,calendarName,readOnly});if(event)items.push(event);}
  pageToken=data.nextPageToken;if(!pageToken)return {events:items,snapshots:[{source,...range,complete:true}],connected:true};
 }
 throw Error('El calendario requiere un rango de fechas más corto.');
}
