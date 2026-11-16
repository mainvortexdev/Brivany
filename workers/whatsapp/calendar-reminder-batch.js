const AGENTS = ['melodi'];
export const REMINDER_BATCH_SCHEMA = `CREATE TABLE IF NOT EXISTS calendar_reminder_batches (
  id TEXT PRIMARY KEY,phone TEXT NOT NULL,source_hash TEXT NOT NULL,fingerprint TEXT NOT NULL,
  event_count INTEGER NOT NULL CHECK(event_count BETWEEN 2 AND 8),created_at TEXT NOT NULL,
  UNIQUE(phone,source_hash))`;
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** A message creates its whole calendar set atomically, with immutable source
 * identity. A replay cannot duplicate events, change their count or undo a
 * later calendar edit. The caller supplies the authenticated owner and grant. */
export async function createReminderBatch(env,phone,messageId,events,{agent='melodi'}={}) {
  if (!/^\d{8,15}$/.test(phone || '') || typeof messageId!=='string' || !messageId || messageId.length>500
    || /[\u0000-\u001f]/.test(messageId) || !AGENTS.includes(agent)
    || !Array.isArray(events) || events.length<2 || events.length>8) throw Error('invalid_reminder_batch');
  const normalized=events.map(item=>{
    const title=typeof item?.title==='string' ? item.title.trim() : '',at=new Date(item?.eventAt);
    if (!title || title.length>240 || /[\u0000-\u001f]/.test(title) || !Number.isFinite(at.valueOf()) || at.valueOf()<=Date.now()) throw Error('invalid_reminder_batch_event');
    return {title,eventAt:at.toISOString(),agent};
  });
  if (new Set(normalized.map(item=>JSON.stringify(item))).size!==normalized.length) throw Error('duplicate_reminder_batch_event');
  const db=typeof env.VETSA_CLOUD?.withSession==='function' ? env.VETSA_CLOUD.withSession('first-primary') : env.VETSA_CLOUD;
  if (!db?.batch || !db?.prepare) throw Error('atomic_calendar_batch_unavailable');
  await db.prepare(REMINDER_BATCH_SCHEMA).run();
  const sourceHash=await digest(`${phone}\u0000${messageId}`),id=`calbatch-${sourceHash}`;
  const fingerprint=await digest(JSON.stringify(normalized)),createdAt=new Date().toISOString();
  const saved=normalized.map((item,index)=>({...item,id:`${id}-${index+1}`}));
  // A NOT NULL violation is intentional on mismatched replay or an event that
  // has since been edited. D1 batch rolls back the complete set on any error.
  await db.batch([
    db.prepare(`INSERT INTO calendar_reminder_batches(id,phone,source_hash,fingerprint,event_count,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET fingerprint=CASE WHEN calendar_reminder_batches.phone=excluded.phone
        AND calendar_reminder_batches.source_hash=excluded.source_hash AND calendar_reminder_batches.fingerprint=excluded.fingerprint
        AND calendar_reminder_batches.event_count=excluded.event_count THEN calendar_reminder_batches.fingerprint ELSE NULL END`)
      .bind(id,phone,sourceHash,fingerprint,saved.length,createdAt),
    ...saved.map(item=>db.prepare(`INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at)
      VALUES(?,?,?,?,'REMINDER',?,?,?) ON CONFLICT(id) DO UPDATE SET title=CASE WHEN melodi_calendar_events.phone=excluded.phone
        AND melodi_calendar_events.title=excluded.title AND melodi_calendar_events.event_at=excluded.event_at
        AND melodi_calendar_events.event_type=excluded.event_type AND melodi_calendar_events.assigned_agent=excluded.assigned_agent
        THEN melodi_calendar_events.title ELSE NULL END`).bind(item.id,phone,item.title,item.eventAt,agent,createdAt,createdAt)),
  ]);
  const rows=await db.prepare(`SELECT id,phone,title,event_at,assigned_agent FROM melodi_calendar_events WHERE id IN (${saved.map(()=>'?').join(',')})`)
    .bind(...saved.map(item=>item.id)).all();
  if ((rows.results || []).length!==saved.length || saved.some(item=>!(rows.results || []).some(row=>row.id===item.id && row.phone===phone
    && row.title===item.title && row.event_at===item.eventAt && row.assigned_agent===agent))) throw Error('reminder_batch_verification_failed');
  return {status:'scheduled',id,events:saved};
}
