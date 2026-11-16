const AGENTS=['melodi'];
export const SEMANTIC_CALENDAR_SCHEMA=`CREATE TABLE IF NOT EXISTS semantic_calendar_requests (
  id TEXT PRIMARY KEY,phone TEXT NOT NULL,source_hash TEXT NOT NULL,fingerprint TEXT NOT NULL,
  event_count INTEGER NOT NULL CHECK(event_count BETWEEN 1 AND 8),commit_token TEXT NOT NULL,
  created_at TEXT NOT NULL,UNIQUE(phone,source_hash))`;
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

/** One immutable request and one transaction. Replays verify the original IDs;
 * they cannot restore events subsequently deleted or overwrite later edits. */
export async function persistSemanticCalendarEvents(env,phone,messageId,events,{agent='melodi'}={}) {
  if(!/^\d{8,15}$/.test(phone || '') || typeof messageId!=='string' || !messageId || messageId.length>500
    || /[\u0000-\u001f]/.test(messageId) || !AGENTS.includes(agent) || !Array.isArray(events) || events.length<1 || events.length>8)
    throw Error('invalid_semantic_calendar_request');
  const normalized=events.map(item=>{
    const title=typeof item?.title==='string'?item.title.trim():'',at=new Date(item?.eventAt);
    if(!title || title.length>240 || /[\u0000-\u001f]/.test(title) || !Number.isFinite(at.valueOf()))throw Error('invalid_semantic_calendar_event');
    return{title,eventAt:at.toISOString(),agent};
  });
  if(new Set(normalized.map(item=>JSON.stringify(item))).size!==normalized.length)throw Error('duplicate_semantic_calendar_event');
  const db=typeof env.VETSA_CLOUD?.withSession==='function'?env.VETSA_CLOUD.withSession('first-primary'):env.VETSA_CLOUD;
  if(!db?.batch || !db?.prepare)throw Error('atomic_calendar_batch_unavailable');
  await db.prepare(SEMANTIC_CALENDAR_SCHEMA).run();
  const sourceHash=await digest(`${phone}\u0000${messageId}`),id=`calbatch-${sourceHash}`,fingerprint=await digest(JSON.stringify(normalized));
  const saved=normalized.map((item,index)=>({...item,id:`${id}-${index+1}`}));
  const existing=await db.prepare('SELECT fingerprint,event_count FROM semantic_calendar_requests WHERE id=?').bind(id).first();
  if(existing && (existing.fingerprint!==fingerprint || existing.event_count!==saved.length))throw Error('semantic_calendar_request_changed');
  if(!existing){
    if(normalized.some(item=>Date.parse(item.eventAt)<=Date.now()))throw Error('semantic_calendar_time_elapsed');
    const token=crypto.randomUUID(),createdAt=new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO semantic_calendar_requests(id,phone,source_hash,fingerprint,event_count,commit_token,created_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET fingerprint=CASE WHEN semantic_calendar_requests.phone=excluded.phone
          AND semantic_calendar_requests.source_hash=excluded.source_hash AND semantic_calendar_requests.fingerprint=excluded.fingerprint
          AND semantic_calendar_requests.event_count=excluded.event_count THEN semantic_calendar_requests.fingerprint ELSE NULL END`)
        .bind(id,phone,sourceHash,fingerprint,saved.length,token,createdAt),
      ...saved.map(item=>db.prepare(`INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at)
        SELECT ?,?,?,?,'REMINDER',?,?,? WHERE EXISTS(SELECT 1 FROM semantic_calendar_requests WHERE id=? AND commit_token=?)
        ON CONFLICT(id) DO UPDATE SET title=CASE WHEN melodi_calendar_events.phone=excluded.phone AND melodi_calendar_events.title=excluded.title
          AND melodi_calendar_events.event_at=excluded.event_at AND melodi_calendar_events.event_type=excluded.event_type
          AND melodi_calendar_events.assigned_agent=excluded.assigned_agent THEN melodi_calendar_events.title ELSE NULL END`)
        .bind(item.id,phone,item.title,item.eventAt,agent,createdAt,createdAt,id,token)),
    ]);
  }
  const result=await db.prepare(`SELECT id,phone,title,event_at,assigned_agent FROM melodi_calendar_events WHERE id IN (${saved.map(()=>'?').join(',')})`).bind(...saved.map(item=>item.id)).all();
  const rows=result.results || [];
  if(rows.length!==saved.length || saved.some(item=>!rows.some(row=>row.id===item.id && row.phone===phone && row.title===item.title
    && row.event_at===item.eventAt && row.assigned_agent===agent)))throw Error('semantic_calendar_verification_failed');
  return{status:'scheduled',id,events:saved};
}
