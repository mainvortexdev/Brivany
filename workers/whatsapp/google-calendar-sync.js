import { createGoogleCalendarClient, normalizeGoogleCalendarChange, toGoogleCalendarEvent, googleCalendarOwnerTag } from './google-calendar-client.js';
import { createGoogleCalendarStore, calendarHash } from './google-calendar-store.js';
import { googleCalendarConfigured, getGoogleCalendarAccessToken } from './google-calendar-auth.js';
import { listScheduledActivities, applyCalendarChange } from './google-calendar-schedules.js';
import { localDateTimeToUtc } from './event-time.js';

function canonicalTime(value) {
  if (!value) return null;
  if (value.date) return {date:value.date};
  const time=value.dateTime;
  if (typeof time!=='string') return null;
  const utc=/(?:Z|[+-]\d{2}:\d{2})$/.test(time) ? (Number.isFinite(Date.parse(time)) ? new Date(time).toISOString() : null)
    : localDateTimeToUtc(time.slice(0,16),value.timeZone || 'America/Santo_Domingo');
  return utc ? {dateTime:utc} : {dateTime:time};
}
export function calendarEventContent(event) {
  return {summary:event.summary || '',start:canonicalTime(event.start),end:canonicalTime(event.end),
    recurrence:[...(event.recurrence || [])].sort(),status:event.status || 'confirmed',
    recurringEventId:event.recurringEventId || null,originalStartTime:canonicalTime(event.originalStartTime)};
}
const hashEvent = event => calendarHash(JSON.stringify(calendarEventContent(event)));
function mapped(row,owner) { return {owner,kind:row.kind,id:row.source_id,agent:row.agent,googleEventId:row.google_event_id}; }
const activityKey = value => `${value.kind}:${value.id || value.source_id}`;
function sameReceipt(remote,id) { return remote && remote.id===id && (remote.status==='cancelled' || (typeof remote.etag==='string' && remote.etag)); }

/** Google changes are fully read before publishing local changes or allowing due work. */
export async function syncGoogleCalendar(env,overrides={}) {
  if (!googleCalendarConfigured(env)) return {status:'unconfigured'};
  const owner=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'');
  const store=overrides.store || createGoogleCalendarStore(env);
  await store.ensureSchema();
  const leaseToken=await store.acquireLease(owner);
  if (!leaseToken) {
    const connection=await store.getConnection(owner);
    return {status:connection?.status==='connected' ? 'busy' : 'disconnected'};
  }
  const now=overrides.now || (() => Date.now()), deadline=now()+23000;
  const check=async () => {
    if (now()>deadline) throw new Error('google_calendar_sync_yield');
    if (store.assertLease) await store.assertLease(owner,leaseToken);
  };
  let actions=0;
  try {
    const connection=await store.getConnection(owner);
    if (!connection || connection.status!=='connected' || !connection.calendarId) return {status:'provisioning_needed'};
    const client=overrides.client || createGoogleCalendarClient({accessToken:() => getGoogleCalendarAccessToken(env,connection,store,{leaseToken}),timeoutMs:8000});
    let mappings=await store.listMappings(owner);
    const byGoogleId=new Map(mappings.map(row => [row.google_event_id,row]));
    const list=overrides.listScheduledActivities || listScheduledActivities;
    const apply=overrides.applyCalendarChange || applyCalendarChange;
    async function unsupported(event,row,remoteHash,reason) {
      const mapping=mapped(row,owner);
      const names={melodi:'Melodi'};
      const explanation=reason==='unsupported_recurrence' || reason==='unsupported_recurrence_instance'
        ? 'esa frecuencia no está disponible para esta actividad' : 'la fecha, la duración o el formato no son compatibles con esta actividad';
      const body=`${names[row.agent]}: No pude aplicar tu cambio en Google Calendar porque ${explanation}. Conservé la tarea original sin ejecutarla durante esta revisión. Ajusta ese evento a una fecha futura y una frecuencia compatible para continuar.`;
      if (overrides.notifyUnsupported) await overrides.notifyUnsupported({owner,agent:row.agent,key:`google-calendar-unsupported:${event.id}:${remoteHash}`,body,reason});
      if (event.recurringEventId) {
        await store.putIgnoredChange(owner,{eventId:event.id,remoteHash,kind:row.kind,id:row.source_id,agent:row.agent,reason:reason || 'unsupported_instance'},{leaseToken});
        // An unsupported exception must pause its routine until the owner makes
        // a supported correction. Preserve the parent's identity and ETag.
        await store.putMapping(owner,{...mapping,etag:row.google_etag,remoteHash:row.remote_hash,localHash:row.local_hash,
          sourceVersion:row.source_version,status:'unsupported'},{leaseToken});
        row.status='unsupported';
        return true; // An instance receipt never changes the parent ETag.
      }
      await store.putMapping(owner,{...mapping,etag:event.etag,remoteHash,localHash:row.local_hash,sourceVersion:row.source_version,status:'unsupported'},{leaseToken});
      Object.assign(row,{google_etag:event.etag || row.google_etag,remote_hash:remoteHash,status:'unsupported'});
      return true;
    }
    async function applyRemote(event,row) {
      await check();
      const remoteHash=await hashEvent(event);
      if (event.recurringEventId && await store.hasIgnoredChange(owner,event.id,remoteHash)) return true;
      if (row.remote_hash===remoteHash && !event.recurringEventId && row.status!=='unsupported') return true;
      const mapping={...mapped(row,owner),googleEventId:event.id};
      const change=normalizeGoogleCalendarChange(event,mapping);
      if (change.status==='unsupported') return unsupported(event,row,remoteHash,change.reason);
      if (!['updated','cancelled'].includes(change.status)) return false;
      // A fresh local version permits the Google edit, while a CAS protects a
      // later local write that occurs while that edit is being applied.
      const before=(await list(env,owner)).find(item => activityKey(item)===activityKey(mapping));
      if (before && before.agent!==mapping.agent) return false;
      const applied=await apply(env,owner,mapping,change,{expectedVersion:before?.sourceVersion ?? row.source_version,leaseToken});
      if (applied.conflict) return false;
      if (!applied.applied && !applied.missing) {
        if (['source_completed','source_cancelled','source_missing'].includes(applied.reason)) {
          const completed=applied.reason==='source_completed';
          if (overrides.notifyUnsupported) await overrides.notifyUnsupported({owner,agent:row.agent,
            key:`google-calendar-closed:${event.id}:${remoteHash}`,reason:applied.reason,
            body:`${row.agent[0].toUpperCase()+row.agent.slice(1)}: Ese cambio de Google Calendar corresponde a una tarea ${completed ? 'ya terminada' : 'cancelada o eliminada'}. No la reactivé. Para repetirla, crea un encargo nuevo.`});
          if (event.recurringEventId) {
            await store.putIgnoredChange(owner,{eventId:event.id,remoteHash,kind:row.kind,id:row.source_id,agent:row.agent,reason:applied.reason},{leaseToken});
            return true;
          }
          const saved={...mapped(row,owner),etag:event.etag,remoteHash,localHash:row.local_hash,
            sourceVersion:row.source_version,status:completed ? 'completed' : 'cancelled'};
          await store.putMapping(owner,saved,{leaseToken});
          Object.assign(row,{remote_hash:remoteHash,google_etag:event.etag || row.google_etag,status:saved.status});
          return true;
        }
        if (['unsupported_recurrence','unsupported_recurrence_instance','future_schedule_required','invalid_duration','recurrence_exception_limit','monthly_start_mismatch'].includes(applied.reason)) return unsupported(event,row,remoteHash,applied.reason);
        return false;
      }
      if (applied.applied) actions++;
      if (event.recurringEventId) return true;
      const current=(await list(env,owner)).find(item => activityKey(item)===activityKey(mapping));
      if (current && current.agent!==mapping.agent) return false;
      const localHash=current && current.status!=='cancelled' ? await hashEvent(await toGoogleCalendarEvent({owner,...current})) : row.local_hash;
      const saved={...mapping,etag:event.etag,remoteHash,localHash,sourceVersion:current?.sourceVersion ?? applied.sourceVersion,
        status:change.status==='cancelled' || applied.missing ? 'cancelled' : 'active'};
      await store.putMapping(owner,saved,{leaseToken});
      Object.assign(row,{google_etag:event.etag || row.google_etag,remote_hash:remoteHash,local_hash:localHash,
        source_version:String(saved.sourceVersion ?? ''),status:saved.status});
      return true;
    }

    // Full-scan discovery survives page boundaries and expired incremental
    // tokens, so mapped events omitted from the scan can be checked by ID.
    if (!connection.syncToken && !connection.pageToken && !connection.fullScanSeen) connection.fullScanSeen=[];
    for (let page=0;page<2;page++) {
      await check();
      let result;
      try { result=await client.listEvents(connection.calendarId,{syncToken:connection.syncToken || undefined,pageToken:connection.pageToken || undefined,maxResults:100}); }
      catch (error) {
        if (error.code!=='sync_token_expired') throw error;
        connection.syncToken=null; connection.pageToken=null; connection.fullScanSeen=[];
        await store.putConnection(owner,connection,{leaseToken});
        result=await client.listEvents(connection.calendarId,{maxResults:100});
      }
      if (!result || !Array.isArray(result.items || []) || (!result.nextPageToken && !result.nextSyncToken)) throw new Error('google_calendar_invalid_page');
      for (const event of result.items || []) {
        await check();
        const row=byGoogleId.get(event.id) || (event.recurringEventId ? byGoogleId.get(event.recurringEventId) : null);
        if (!row) continue; // Unmapped Google content grants no execution.
        if (Array.isArray(connection.fullScanSeen) && !event.recurringEventId && !connection.fullScanSeen.includes(event.id)) connection.fullScanSeen.push(event.id);
        // Unapplied edits must not consume a cursor or permit local publication.
        if (!await applyRemote(event,row)) return {status:'retrying',reason:'conflict_or_unsupported',actions};
      }
      connection.pageToken=result.nextPageToken || null;
      if (!connection.pageToken && result.nextSyncToken) connection.syncToken=result.nextSyncToken;
      await store.putConnection(owner,connection,{leaseToken});
      if (!connection.pageToken) break;
    }
    if (connection.pageToken) return {status:'continuing',actions};
    if (Array.isArray(connection.fullScanSeen)) {
      for (const row of mappings) {
        if (row.status==='cancelled' || connection.fullScanSeen.includes(row.google_event_id)) continue;
        await check();
        let remote;
        try { remote=await client.getEvent(connection.calendarId,row.google_event_id); }
        catch(error) {
          if (error.code!=='not_found' && error.code!=='sync_token_expired') throw error;
          remote={id:row.google_event_id,status:'cancelled'};
        }
        if (!sameReceipt(remote,row.google_event_id) || !await applyRemote(remote,row)) return {status:'retrying',reason:'conflict_or_unsupported',actions};
      }
      delete connection.fullScanSeen;
      await store.putConnection(owner,connection,{leaseToken});
    }

    const activities=await list(env,owner);
    mappings=await store.listMappings(owner);
    const quarantined=mappings.filter(row=>row.status==='unsupported').length;
    const bySource=new Map(mappings.map(row=>[activityKey(row),row]));
    for (const activity of activities) {
      if (actions>=8) break;
      await check();
      const row=bySource.get(activityKey(activity));
      if (row && row.agent!==activity.agent) return {status:'retrying',reason:'assignment_conflict',actions};
      if (activity.status==='cancelled') {
        if (!row || row.status==='cancelled') continue;
        try { await client.deleteEvent(connection.calendarId,row.google_event_id,{etag:row.google_etag}); }
        catch (error) { if (error.code!=='not_found' && error.code!=='sync_token_expired') throw error; }
        await store.putMapping(owner,{...mapped(row,owner),etag:row.google_etag,localHash:row.local_hash,remoteHash:row.remote_hash,
          sourceVersion:activity.sourceVersion,status:'cancelled'},{leaseToken});
        actions++; continue;
      }
      if (row?.status==='cancelled' || row?.status==='completed' || row?.status==='unsupported') continue;
      const event=await toGoogleCalendarEvent({owner,...activity});
      const localHash=await hashEvent(event);
      if (row?.local_hash===localHash) continue;
      let remote;
      if (!row) {
        try { remote=await client.insertEvent(connection.calendarId,event); }
        catch(error) {
          if (error.code!=='already_exists') throw error;
          remote=await client.getEvent(connection.calendarId,event.id);
          if (!sameReceipt(remote,event.id)) throw new Error('google_calendar_invalid_receipt');
          const tag=remote.extendedProperties?.private;
          if (remote.status!=='cancelled' && (!tag || tag.vetsaOwner!==await googleCalendarOwnerTag(owner)
            || tag.vetsaKind!==activity.kind || tag.vetsaId!==activity.id || tag.vetsaAgent!==activity.agent)) throw new Error('google_calendar_mapping_conflict');
          // Recover an interrupted insert even if Google was edited afterward.
          // Apply its remote state instead of overwriting it with an old snapshot.
          const recovered={kind:activity.kind,id:activity.id,agent:activity.agent,googleEventId:event.id,etag:remote.etag,
            localHash,remoteHash:null,sourceVersion:activity.sourceVersion,status:'active'};
          await store.putMapping(owner,recovered,{leaseToken});
          const recoveredRow={kind:activity.kind,source_id:activity.id,agent:activity.agent,google_event_id:event.id,
            google_etag:remote.etag,local_hash:localHash,remote_hash:null,source_version:activity.sourceVersion,status:'active'};
          if (!await applyRemote(remote,recoveredRow)) return {status:'retrying',reason:'conflict_or_unsupported',actions};
          actions++; continue;
        }
      } else remote=await client.updateEvent(connection.calendarId,row.google_event_id,event,{etag:row.google_etag});
      if (!sameReceipt(remote,event.id) || remote.status==='cancelled') throw new Error('google_calendar_invalid_receipt');
      await store.putMapping(owner,{kind:activity.kind,id:activity.id,agent:activity.agent,googleEventId:event.id,etag:remote.etag,localHash,
        remoteHash:await hashEvent(remote),sourceVersion:activity.sourceVersion,status:'active'},{leaseToken});
      actions++;
    }
    return {status:'synced',actions,quarantined};
  } catch(error) {
    if (error.message==='google_calendar_sync_yield') return {status:'continuing',actions};
    if (error.code==='authorization_required') {
      const connection=await store.getConnection(owner);
      if (connection) await store.putConnection(owner,{...connection,status:'reconnect_required'},{leaseToken}).catch(()=>{});
      return {status:'reconnect_required'};
    }
    console.error('google_calendar_sync_failed',{code:error.code || 'sync_failed'});
    return {status:'retrying',actions};
  } finally { await store.releaseLease(owner,leaseToken); }
}
