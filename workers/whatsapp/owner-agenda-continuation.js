import {clockContext,localDateTimeToUtc} from './event-time.js';

const text=maxLength=>({type:'string',maxLength});
const object=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
export const ownerAgendaResolutionSchema=object({
  decision:{type:'string',enum:['apply','cancel']},onlyCalendarEvents:{type:'boolean'},
  fixedChanges:{type:'array',minItems:1,maxItems:12,items:object({index:{type:'integer',minimum:0,maximum:11},day:text(10),localTime:text(5)},['index'])},
  eventMoves:{type:'array',minItems:1,maxItems:12,items:object({id:text(200),eventAt:text(40)},['id','eventAt'])},
},['decision']);

export function ownerAgendaContinuationSummary(session){
  const state=session?.state,directive=state?.directive;
  if(session?.type!=='await_agenda_plan'||directive?.kind!=='compound_agenda'||!Array.isArray(directive.actions?.fixed)||!Array.isArray(directive.actions?.distribute))return null;
  return {reason:state.reason,referenceAt:directive.referenceAt,timeZone:directive.timeZone,
    fixed:directive.actions.fixed.slice(0,12).map((item,index)=>({index,title:item.title,day:item.day,localTime:item.localTime,assumedPeriod:item.assumedPeriod})),
    distribute:[...directive.actions.distribute],moveDay:directive.actions.moveDay,
    conflicts:(state.conflict?.events||[]).map(item=>({id:item.id,title:item.title,eventAt:item.eventAt,previousEventAt:item.previousEventAt,kind:item.kind})).slice(0,12)};
}

/** Typed resolution of the owner's saved plan. No command-word parsing and no
 * fresh model may replace its titles, distribute list or original clock. */
export function resolveSemanticAgendaContinuation(session,resolution,{now=Date.now()}={}){
  const summary=ownerAgendaContinuationSummary(session);
  if(!summary||!resolution||!['apply','cancel'].includes(resolution.decision))throw Error('agenda_semantic_resolution_required');
  if(resolution.decision==='cancel'){
    if(Object.keys(resolution).some(key=>key!=='decision'))throw Error('invalid_agenda_cancel_resolution');
    return{status:'cancelled'};
  }
  const directive=structuredClone(session.state.directive),zone=directive.timeZone,clock=clockContext(now,zone);
  if(resolution.onlyCalendarEvents!==undefined){
    if(typeof resolution.onlyCalendarEvents!=='boolean'||!directive.actions.moveDay)throw Error('invalid_agenda_resolution_scope');
    directive.actions.moveDay.onlyCalendarEvents=resolution.onlyCalendarEvents;
  }
  const seen=new Set();
  for(const change of resolution.fixedChanges||[]){
    if(!Number.isInteger(change.index)||!directive.actions.fixed[change.index]||seen.has(change.index)||!change.day&&!change.localTime)throw Error('invalid_agenda_fixed_resolution');
    seen.add(change.index);const item=directive.actions.fixed[change.index];
    if(change.day){
      const date=localDateTimeToUtc(`${change.day}T12:00`,zone);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(change.day)||!date||clockContext(date,zone).today_local!==change.day||change.day<clock.today_local
        ||Date.parse(date)>Date.parse(clock.now_utc)+366*86400000)throw Error('invalid_agenda_resolution_date');
      item.day=change.day;
    }
    if(change.localTime){if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(change.localTime))throw Error('invalid_agenda_resolution_hour');item.localTime=change.localTime;item.assumedPeriod=false;}
  }
  const ids=new Set();
  directive.eventMoves=(resolution.eventMoves||[]).map(move=>{
    const event=summary.conflicts.find(item=>item.id===move.id),at=Date.parse(move.eventAt);
    if(!event||event.kind!=='melodi_calendar_events'||ids.has(move.id)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(move.eventAt)||!Number.isFinite(at)||at<=Date.parse(clock.now_utc)
      ||at>Date.parse(clock.now_utc)+366*86400000||!Number.isFinite(Date.parse(event.previousEventAt||event.eventAt)))throw Error('invalid_agenda_event_resolution');
    ids.add(move.id);return{id:move.id,eventAt:new Date(at).toISOString(),previousEventAt:event.previousEventAt||event.eventAt};
  });
  if(!directive.eventMoves.length)delete directive.eventMoves;
  directive.effectiveAt=clock.now_utc;
  return{status:'resolved',directive};
}
