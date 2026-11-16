/** Pause only the activity whose Google edit needs correction. Legacy databases
 * without the optional Calendar schema keep their previous scheduling behavior. */
export async function calendarActivityPaused(db, owner, kind, id) {
  try {
    const row = await db.prepare(`SELECT source_id FROM melodi_google_calendar_activity_map
      WHERE owner=? AND kind=? AND source_id=? AND status='unsupported'`).bind(owner,kind,id).first();
    return row?.source_id === id;
  } catch (error) {
    if (/no such table:\s*(?:main\.)?melodi_google_calendar_activity_map/i.test(`${error?.message} ${error?.cause?.message || ''}`)) return false;
    throw error;
  }
}

/** Exclude paused sources before LIMIT so they cannot starve other activities. */
export async function calendarScheduleExclusion(db,{kind,ownerColumn,idColumn}) {
  if (!['melodi_calendar_events','agent_routine','cognira_report','story_slot','story_single'].includes(kind)
    || !['phone','owner','owner_phone','s.owner_phone','d.owner_phone'].includes(ownerColumn)
    || !['id','s.id','d.id'].includes(idColumn)) throw new Error('invalid_calendar_schedule_filter');
  const table=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='melodi_google_calendar_activity_map'").bind().first();
  if (table?.name!=='melodi_google_calendar_activity_map') return '';
  // Qualify unaliased source columns: otherwise SQLite can resolve owner/id to
  // the inner mapping and accidentally exclude another owner's activity.
  const source={melodi_calendar_events:'melodi_calendar_events',agent_routine:'wa_melodi_routines',cognira_report:'cognira_report_schedules',story_slot:'s',story_single:'d'}[kind];
  const qualifiedOwner=ownerColumn.includes('.') ? ownerColumn : `${source}.${ownerColumn}`;
  const qualifiedId=idColumn.includes('.') ? idColumn : `${source}.${idColumn}`;
  return ` AND NOT EXISTS(SELECT 1 FROM melodi_google_calendar_activity_map gc_pause WHERE gc_pause.owner=${qualifiedOwner}
    AND gc_pause.kind='${kind}' AND gc_pause.source_id=${qualifiedId} AND gc_pause.status='unsupported')`;
}
