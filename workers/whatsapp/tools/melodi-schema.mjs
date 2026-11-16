const retired = /\b(?:dona|emily|lila|mora|stacy)\b/g;
export function melodiTable(name) {
  if (name.startsWith('wa_agent_')) return name.replace('wa_agent_', 'wa_melodi_');
  if (name.startsWith('wa_autonomy_')) return name.replace('wa_autonomy_', 'wa_melodi_work_');
  return ({wa_team_coordination:'wa_melodi_coordination',calendar_events:'melodi_calendar_events',
    screenshot_calendar_events:'melodi_screenshot_calendar_events',wa_scheduled_email_actions:'wa_melodi_scheduled_email_actions',
    vetsa_app_agent_messages:'brivany_whatsapp_messages',wa_owner_message_references:'wa_melodi_message_references',wa_owner_conversation_speaker:'wa_melodi_conversation_speaker',
    wa_delivery_notices:'wa_melodi_delivery_notices',wa_document_delivery_schedules:'wa_melodi_document_delivery_schedules',
    wa_owner_task_references:'wa_melodi_task_references',google_calendar_activity_map:'melodi_google_calendar_activity_map',
    google_calendar_ignored_changes:'melodi_google_calendar_ignored_changes',google_calendar_schedule_overrides:'melodi_google_calendar_schedule_overrides'})[name] || name;
}
export function schemaSql(sql, names) {
  // Identifiers and CHECK values only; this never transforms stored text.
  const identifiers=new RegExp('\\b(?:'+[...names.keys()].join('|')+')\\b','g');
  sql=sql.replace(identifiers,name=>names.get(name));
  return sql.replace(retired,'melodi').replace(/wa_agent_/g,'wa_melodi_').replace(/wa_autonomy_/g,'wa_melodi_work_');
}
export function melodiSchemaPlan(schema) {
  const pending=schema.filter(row=>row.type==='table'&&melodiTable(row.name)!==row.name),tables=[];
  while(pending.length){
    const index=pending.findIndex(row=>![...row.sql.matchAll(/REFERENCES\s+["`]?([a-zA-Z_0-9]+)/gi)].some(match=>pending.some(parent=>parent.name===match[1]&&parent!==row)));
    if(index<0)throw Error('cyclic_migration_dependencies');
    tables.push(...pending.splice(index,1));
  }
  const names=new Map(tables.map(row=>[row.name,melodiTable(row.name)]));
  const create=tables.map(row=>schemaSql(row.sql,names).replace(/^CREATE TABLE(?: IF NOT EXISTS)? /i,'CREATE TABLE IF NOT EXISTS '));
  const indexes=schema.filter(row=>row.type==='index'&&names.has(row.tbl_name)).map(row=>{
    let sql=schemaSql(row.sql,names);
    const newIndex='brivany_'+row.name.replace(/^wa_(?:agent|autonomy)_/,'');
    sql=sql.replace(row.name,newIndex).replace(/^CREATE (UNIQUE )?INDEX(?: IF NOT EXISTS)? /i,(_,unique='')=>`CREATE ${unique}INDEX IF NOT EXISTS `);
    return sql;
  });
  return {tables:tables.map(row=>({from:row.name,to:names.get(row.name)})),create:[...create,...indexes]};
}
export const PRIMARY_ONLY = new Set(['wa_agent_levels','wa_agent_level_events','wa_agent_private_context','wa_autonomy_state']);
export const RETIRED_WORK = new Set(['wa_autonomy_events','wa_autonomy_outbox','wa_autonomy_audit','wa_agent_brain_tasks','wa_agent_personal_goals','wa_agent_permission_requests']);
export const IDENTITY_COLUMNS = new Set(['agent','assigned_agent','active_agent','requester','helper','conversation_agent']);
export function copySql({from,to}, columns) {
  if(RETIRED_WORK.has(from)) return null;
  const quoted=name=>`"${name}"`;
  if(![from,to,...columns].every(name=>/^[a-zA-Z0-9_]+$/.test(name))) throw Error('invalid_migration_identifier');
  const value=column=>{
    if(column==='kind')return `CASE WHEN kind='calendar_events' THEN 'melodi_calendar_events' ELSE kind END`;
    if(IDENTITY_COLUMNS.has(column)) return `CASE WHEN "${column}" IN ('dona','emily','lila','mora','stacy') THEN 'melodi' ELSE "${column}" END`;
    if(['focus_agent','contact_agent','contact_token','contact_until','conversation_until','lease_token','lease_until','outbox_lease_token','outbox_lease_until'].includes(column)) return 'NULL';
    return quoted(column);
  };
  return `INSERT OR IGNORE INTO "${to}" (${columns.map(quoted).join(',')}) SELECT ${columns.map(value).join(',')} FROM "${from}"${PRIMARY_ONLY.has(from)?" WHERE agent='dona'":''}`;
}
