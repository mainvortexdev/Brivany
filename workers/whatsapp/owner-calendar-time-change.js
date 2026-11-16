import {clockContext,localDateTimeToUtc,DOMINICAN_TIME_ZONE} from './event-time.js';

const WEEKDAYS=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const KEYS=['onDate','weekday','offsetDays','anchor','weekOffset','localTime'];
const own=(value,key)=>Object.hasOwn(value,key);
const failure=code=>{throw Error(`calendar_when_${code}`);};
function validDay(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const at=Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===value;
}
function clockAt(value,timeZone){
  const at=value instanceof Date?value.getTime():typeof value==='number'?value:typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
  if(!Number.isFinite(at))failure('invalid_clock');
  try{return{at,...clockContext(at,timeZone)};}catch{failure('invalid_clock');}
}
function shiftDay(day,days){
  const shifted=new Date(Date.parse(`${day}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
  if(!validDay(shifted))failure('date_out_of_range');
  return shifted;
}
function weekdayOf(day){return new Date(`${day}T12:00:00Z`).getUTCDay();}

/** Validate the model's semantic date expression, never its natural-language
 * source. The executor owns the turn clock and the observed event instant. */
export function validateOwnerCalendarWhen(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.keys(input).some(key=>!KEYS.includes(key)))failure('invalid_shape');
  const dateFields=['onDate','weekday','offsetDays'].filter(key=>own(input,key));
  if(dateFields.length>1||dateFields.length===0&&!own(input,'localTime'))failure('ambiguous_date');
  if(own(input,'onDate')&&!validDay(input.onDate))failure('invalid_date');
  if(own(input,'weekday')&&!WEEKDAYS.includes(input.weekday))failure('invalid_weekday');
  if(own(input,'offsetDays')&&(!Number.isInteger(input.offsetDays)||input.offsetDays< -366||input.offsetDays>366))failure('invalid_offset');
  if(own(input,'localTime')&&(typeof input.localTime!=='string'||! /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.localTime)))failure('invalid_time');
  if(own(input,'anchor')&&(!['turn','event'].includes(input.anchor)||!own(input,'weekday')&&!own(input,'offsetDays')))failure('invalid_anchor');
  if(own(input,'weekOffset')&&(!own(input,'weekday')||!Number.isInteger(input.weekOffset)||input.weekOffset<0||input.weekOffset>52))failure('invalid_week_offset');
  return{...input};
}

/** Compile calendar arithmetic from trusted instants and typed meaning.
 * Omitted weekOffset means the next named day strictly after the anchor's
 * local date. Explicit zero means this Monday-based week; one means next week.
 * Past explicit dates remain past so the existing mutation guard can ask for
 * another date instead of silently moving them to a different week or year. */
export function compileOwnerCalendarWhen(when,{referenceAt,expectedEventAt,timeZone=DOMINICAN_TIME_ZONE}={}){
  const value=validateOwnerCalendarWhen(when),turn=clockAt(referenceAt,timeZone),event=clockAt(expectedEventAt,timeZone);
  const anchor=value.anchor==='event'?event:turn;
  let day=event.today_local;
  if(own(value,'onDate'))day=value.onDate;
  else if(own(value,'offsetDays'))day=shiftDay(anchor.today_local,value.offsetDays);
  else if(own(value,'weekday')){
    const weekday=WEEKDAYS.indexOf(value.weekday),current=weekdayOf(anchor.today_local);
    if(own(value,'weekOffset'))day=shiftDay(anchor.today_local,-((current+6)%7)+value.weekOffset*7+(weekday+6)%7);
    else day=shiftDay(anchor.today_local,(weekday-current+7)%7||7);
  }
  // This also preserves a previously observed offset during a DST fall-back.
  if(!own(value,'localTime')&&day===event.today_local)return new Date(event.at).toISOString();
  const localTime=value.localTime??event.now_local.slice(11,16);
  let result;
  try{result=localDateTimeToUtc(`${day}T${localTime}`,timeZone);}catch{failure('invalid_clock');}
  if(!result)failure('local_time_unavailable');
  // Date-only changes retain any observed seconds; explicit HH:mm starts on
  // that minute, matching the precision the owner actually requested.
  return new Date(Date.parse(result)+(own(value,'localTime')?0:((event.at%60000)+60000)%60000)).toISOString();
}
