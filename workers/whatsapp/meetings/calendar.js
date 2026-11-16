import {createGoogleCalendarStore} from '../google-calendar-store.js';
import {getGoogleCalendarAccessToken} from '../google-calendar-auth.js';
import {googleCalendarSnapshot,normalizedGoogleEvent} from '../vetsa-calendar-events.js';
import {MeetingError,boundedJSON,meetingURL} from './recall.js';
export function eventMeetingURL(item){
 const candidates=[item.hangoutLink,...(item.conferenceData?.entryPoints||[]).filter(p=>p.entryPointType==='video').map(p=>p.uri),...(String(item.description||'')+' '+String(item.location||'')).matchAll(/https:\/\/[^\s<>"']+/g)].map(value=>Array.isArray(value)?value[0].replace(/&amp;/g,'&'):value);
 for(const value of candidates){try{return meetingURL(value);}catch{/* other links are not meeting destinations */}}
 return null;
}
export function eligibleEvent(event,now=Date.now()){
 return !!event&&!event.allDay&&!!event.meetingUrl&&Number.isFinite(Date.parse(event.startAt))&&Date.parse(event.startAt)>now+60000&&Date.parse(event.startAt)<=now+90*86400000;
}
// Reuses Brivany's own Google OAuth, encrypted credentials, lease and calendar.
// Connecting or reading the calendar never creates a Recall bot.
export async function readMeetingCalendar(env,phone,{eventId,now=Date.now(),fetcher=fetch}={}){
 if(!/^\d{8,15}$/.test(phone||''))throw new MeetingError('calendar_owner_invalid',403);
 env={...env,OWNER_WHATSAPP_NUMBER:phone};
 const store=createGoogleCalendarStore(env);await store.ensureSchema();let lease;
 try{
  const connection=await store.getConnection(phone);
  if(connection?.status!=='connected'||!connection.calendarId)throw new MeetingError('calendar_connection_required',409);
  lease=await store.acquireLease(phone);if(!lease)throw new MeetingError('calendar_busy',503,10);
  const token=await getGoogleCalendarAccessToken(env,connection,store,{leaseToken:lease});
  const context={source:'google-assistants',calendarId:connection.calendarId,calendarName:'Vetsa · Equipo',readOnly:true};
  if(eventId){
   if(typeof eventId!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(eventId))throw new MeetingError('calendar_event_invalid');
   const response=await fetcher('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(connection.calendarId)+'/events/'+encodeURIComponent(eventId),{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(15000)});
   if([404,410].includes(response.status)){await response.body?.cancel();return {event:null,calendarId:connection.calendarId,connected:true};}
   if(!response.ok){await response.body?.cancel();throw new MeetingError('calendar_read_failed',502,30);}
   const raw=await boundedJSON(response,131072),event=normalizedGoogleEvent(raw,context);
   return {event:event?{...event,startAt:raw.start?.dateTime||null,endAt:raw.end?.dateTime||null,meetingUrl:eventMeetingURL(raw)}:null,calendarId:connection.calendarId,connected:true};
  }
  const range={from:new Date(now).toISOString().slice(0,10),to:new Date(now+90*86400000).toISOString().slice(0,10)};
  const result=await googleCalendarSnapshot({accessToken:token,...context,range,fetcher});
  return {connected:true,calendarId:connection.calendarId,calendarName:context.calendarName,events:result.events.map(event=>({...event,eligible:eligibleEvent(event,now)}))};
 }finally{if(lease)await store.releaseLease(phone,lease).catch(()=>{});}
}
