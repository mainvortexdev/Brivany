import { createAutonomyStore, AUTONOMY_MEDIA_EVENT_TYPES } from './melodi-autonomy-store.js';
import { createTeamCoordinator, contactWindow } from './melodi-team-coordination.js';
import { AUTONOMY_PROFILES, autonomyToolCatalog, autonomyAgentPrompt, executeAutonomyTool, validateAutonomyToolInput } from './melodi-autonomy-tools.js';
import { clockContext } from './event-time.js';
import { ownerAutonomyServices } from './owner-features.js';
import { safeAgentAnswer } from './vetsa-knowledge.js';
import { createPermissionStore, permissionForTool } from './melodi-permissions.js';
import { createRoutineStore } from './melodi-routines.js';
import { createAutonomyMaintenance } from './melodi-autonomy-maintenance.js';
import { runWeeklyResearch } from './melodi-routine-workflow.js';
import { createArtifactTracker } from './melodi-artifact-tracking.js';
import { documentDeliveryState, completeDocumentSchedule } from './document-schedules.js';
import { createDeliveryNotices } from './delivery-notice.js';
import { refreshEmailSenders } from './email-sender-status.js';
import { ensureAgentEmailSenders } from './ensure-melodi-email-senders.js';
import { ownerConversationAnswer } from './owner-conversation-answer.js';
import { runRequestedResearchReport } from './requested-research-report.js';
import { readPublicInstagramSource } from './public-post-research.js';
import { publicInstagramResearchUrl } from './owner-research-request.js';
import { createTaskReferences } from './owner-task-references.js';
import { createOwnerJobRetry, ownerJobRetryPolicy } from './owner-job-retry.js';
import { repairOwnerResearchAssignments, requestedResearchErrorCode } from './owner-research-repair.js';
import { validatePublicMediaExtraction } from './public-media-evidence.js';
import { resumeRequestedMedia } from './public-media-resume.js';
import { routineCalendarRunState } from './google-calendar-schedules.js';
import { googleCalendarInviteAuthority, googleCalendarInviteKey, freshGoogleCalendarInviteBody } from './google-calendar-invite.js';
import { createGoogleCalendarStore } from './google-calendar-store.js';
import { motivationalPhrase } from './motivational-routine.js';
import { createContactPolicy, parseOwnerContactPreference } from './melodi-contact-policy.js';
import { currentOwnerSpeaker, leaderConversationEnabled } from './owner-speaker.js';
import { createAgentBrain, agentBrainPrompt } from './melodi-brain.js';
import { calendarReminderCurrent, confirmCalendarReminder, contextualCalendarReminderMessage, contextualRoutineReminderMessage } from './calendar-reminder-delivery.js';
import { screenshotReminderCurrent, confirmScreenshotReminder } from './screenshot-calendar-store.js';
import { currentScreenshotReminderMessage } from './screenshot-reminder-delivery.js';
import { naturalAgentMessage } from './melodi-voice.js';
import { reminderDueMessage } from './reminder-language.js';
import { buildAgentEvidence, validateAgentResult, groundedAgentFallback, serializeAgentToolMemory } from './melodi-result-grounding.js';

const IDS = Object.keys(AUTONOMY_PROFILES);
const clean = (value, limit = 3000) => String(value || '').replace(/\u0000/g, '').trim().slice(0, limit);
function modelObject(result) {
  const value = result?.text ?? result?.response ?? result;
  if (value && typeof value === 'object') return value;
  const parsed = JSON.parse(String(value).match(/\{[\s\S]*\}/)?.[0] || '{}');
  if (!parsed || Array.isArray(parsed)) throw new Error('invalid_agent_decision');
  return parsed;
}

function objectiveProgress(task) {
  const verified = receipt => receipt.verified === true && ['observed','prepared','completed','sent'].includes(receipt.status);
  const steps = task.steps.filter(step => step.status !== 'completed');
  const tools = task.requiredTools.filter(tool => !task.receipts.some(receipt => receipt.tool === tool && verified(receipt)));
  const agents = (task.requiredAgents || []).filter(target => !task.receipts.some(receipt => receipt.tool === 'delegate_agent_event'
    && receipt.targetAgent === target && receipt.verified === true && receipt.status === 'completed'));
  return { steps, tools, agents, complete: task.steps.length > 0 && !steps.length && !tools.length && !agents.length };
}

export function createAgentRuntime(env, overrides = {}) {
  const services = { ...ownerAutonomyServices(env), ...overrides.services };
  const owner = String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const clock = () => new Date(overrides.now ? overrides.now() : Date.now()).toISOString();
  const store = overrides.store || createAutonomyStore(env.VETSA_CLOUD, { ...services, now: () => Date.parse(clock()) });
  const coordinator = overrides.coordinator || createTeamCoordinator(env.VETSA_CLOUD, services);
  const permissions = createPermissionStore(env.VETSA_CLOUD, { ...services, now: () => Date.parse(clock()) });
  const routines = createRoutineStore(env.VETSA_CLOUD, { ...services, now: () => Date.parse(clock()) });
  const maintenance = createAutonomyMaintenance(env.VETSA_CLOUD, { ...services, queue: env.MELODI_JOBS, now: () => Date.parse(clock()) });
  const artifacts = createArtifactTracker(env.VETSA_CLOUD, { now: () => Date.parse(clock()) });
  const notices = createDeliveryNotices(env.VETSA_CLOUD, { ...services, now: () => Date.parse(clock()) });
  const references = createTaskReferences(env.VETSA_CLOUD, { now: () => Date.parse(clock()) });
  const jobRetry = createOwnerJobRetry(env.VETSA_CLOUD, { ...services, queue: env.MELODI_JOBS, now: () => Date.parse(clock()) });
  const contactPolicy = createContactPolicy(env.VETSA_CLOUD, { ...services, now: () => Date.parse(clock()) });
  const brain = createAgentBrain(env.VETSA_CLOUD, { ...services, now: () => Date.parse(clock()) });
  const active = env.TEAM_AUTONOMY_ENABLED === 'true';

  async function dispatchWork(message, delaySeconds = 0) {
    if (typeof env.MELODI_JOBS?.send !== 'function') return;
    try {
      await env.MELODI_JOBS.send(message, delaySeconds ? { delaySeconds } : undefined);
    } catch {
      // The task/event already exists in D1. Cron remains the recovery path;
      // a wakeup failure must not turn a verified tool result into a retry.
      console.error(JSON.stringify({ event: 'autonomy_dispatch_deferred', type: message.type, agent: message.agent || null }));
    }
  }

  async function wakeAfterEvent(event, taskIdentity, agents, calendarReady) {
    const settled = await env.VETSA_CLOUD.prepare('SELECT status FROM wa_melodi_work_events WHERE owner=? AND agent=? AND id=?')
      .bind(owner,event.agent,event.id).first();
    if (!settled || !['done','failed'].includes(settled.status)) return;
    if (taskIdentity) {
      const child = await brain.get(taskIdentity);
      if (child?.parentTaskId && ['completed','failed','cancelled'].includes(child.status)) {
        const parentRow = await env.VETSA_CLOUD.prepare('SELECT agent FROM wa_melodi_brain_tasks WHERE owner=? AND id=?')
          .bind(owner,child.parentTaskId).first();
        if (parentRow) {
          const identity = { owner, agent: parentRow.agent, id: child.parentTaskId };
          const parent = await brain.get(identity);
          if (parent && !['completed','failed','cancelled'].includes(parent.status)) {
            const updated = await brain.reconcileDelegationOutcome({ ...identity, childTaskId: child.id, childAgent: child.agent });
            if (['failed','cancelled'].includes(updated.status)) await notifyBrainBlock(updated);
            else if (updated.revision !== parent.revision) {
              await store.enqueueEvent({ owner, agent: parent.agent, eventKey: `brain-resume:${parent.id}:${updated.revision}`,
                type: 'agent_objective', priority: 20, payload: { brainTaskId: parent.id, ownerRequested: true, allowContact: false } });
              agents.set(parent.agent, 0);
            }
          }
        }
      }
    }
    // Publish wakeups only after finishEvent releases the producer's lease
    // and its delegation receipt is persisted. D1 claims deduplicate retries.
    for (const [agent, delaySeconds] of agents) await dispatchWork({ type: 'autonomy_agent', agent, calendarReady }, delaySeconds);
    const pending = await env.VETSA_CLOUD.prepare("SELECT id FROM wa_melodi_work_outbox WHERE owner=? AND event_id=? AND status='pending' LIMIT 1")
      .bind(owner,event.id).first();
    if (pending) await dispatchWork({ type: 'autonomy_outbox', calendarReady });
  }

  async function initialize() {
    await contactPolicy.ensureSchema();
    if(env.OWNER_CONTACT_POLICY_BOOTSTRAP_TOPICS && (await contactPolicy.read(owner)).revision===0) {
      for(const topic of env.OWNER_CONTACT_POLICY_BOOTSTRAP_TOPICS.split(',').map(item=>item.trim()).filter(Boolean).slice(0,10)) await contactPolicy.update(owner,{topic,blocked:true});
    }
    await brain.ensureSchema();
    await notices.ensureSchema();
    await references.ensureSchema();
    await coordinator.init(owner, clock());
    for (const agent of IDS) await store.ensureAgent({ owner, agent, config: { enabled: true, dailyRunLimit: 8, dailyMessageLimit: 3, cooldownMs: 45 * 60000 } });
    for (const agent of IDS) await permissions.ensureAgent(owner, agent);
  }

  const name = agent => AUTONOMY_PROFILES[agent]?.name || agent;
  async function notifyBrainBlock(task) {
    if(task.parentTaskId || !['failed','waiting'].includes(task.status)
      || ['queued','pending','delegated','authorization_required','next_action_required','execution_retry_pending'].includes(task.blocker)) return;
    const reason=task.blocker==='authorization_required' ? 'Necesito una autorización para continuar.'
      : task.blocker==='unavailable' ? 'Una herramienta necesaria no está conectada o no respondió correctamente.'
      : task.blocker==='scope_blocked' ? 'El encargo incluye un tema que pediste excluir.'
      : 'La ejecución no pudo completar los pasos necesarios.';
    await notices.enqueue({owner,key:`brain-block:${task.id}`,agent:task.agent,ownerRequested:true,
      body:`${name(task.speaker)}: No pude terminar el encargo «${clean(task.objective,200)}». ${reason} No lo he dado por completado.`});
    await dispatchWork({ type: 'autonomy_outbox' });
  }
  async function ownerMessage(producer, body) {
    const content = naturalAgentMessage(body);
    if (!leaderConversationEnabled(env)) return { speaker: producer, body: content };
    const selected = await currentOwnerSpeaker(env, owner, new Date(clock()));
    const speaker = selected === producer ? producer : 'melodi';
    return { speaker, body: content };
  }
  const approvalBody = async request => {
    const ref = await references.register({ owner, type: 'approval', id: request.id, agent: request.requester, status: request.status || 'pending' });
    const action = ({prepare_document:'preparar el documento',prepare_story:'preparar la historia',account_metrics:'consultar las métricas',
      retry_owner_job:'reintentar el trabajo',delegate_agent_event:'coordinar una colaboración',research_public_marketing:'investigar la fuente pública',
      inspect_public_media:'inspeccionar los medios públicos de la fuente',
      inspect_workspace:'consultar el trabajo pendiente',send_owner_email:'enviar el correo solicitado',read_owner_email:'leer el correo solicitado',
      generate_media:'preparar el contenido visual',desktop_action:'realizar la acción en el equipo',publish_social:'publicar el contenido aprobado',
      manage_social:'gestionar la cuenta conectada',retrieve_private_document:'recuperar el documento',manage_memory:'actualizar la memoria',
      manage_calendar:'actualizar el calendario',manage_projects:'actualizar el proyecto'})[request.tool] || 'completar la acción solicitada';
    return `${name(request.helper)}: Para continuar con tu encargo necesito tu autorización para ${action}. `
      + `El permiso es solo para esta acción (${ref.shortRef}). Responde «apruebo ${ref.shortRef}» o «rechazo ${ref.shortRef}».`;
  };

  async function requestTool(agent, tool, input, eventKey, event, goalScope = 'team', notify = true) {
    // A specialist may carry out the owner's concrete assignment under Melodi's
    // existing authority for private reads/artifacts. This never upgrades an
    // agent, grants external publication or turns model text into permission.
    if (leaderConversationEnabled(env) && agent !== 'melodi' && input.ownerRequest?.origin === 'owner_request'
      && input.ownerRequest.assignmentAgent === agent) {
      const descriptor = autonomyToolCatalog(agent, tools).find(item => item.name === tool);
      const leader = (await permissions.getTeam(owner)).find(member => member.agent === 'melodi');
      if (descriptor?.status === 'available' && ['read','owner_artifact'].includes(descriptor.effect)
        && leader?.level >= descriptor.minLevel) {
        return { allowed: true, status: 'authorized_by_leader', authorizer: 'melodi', agent, tool,
          permissionRevision: leader.permission_revision };
      }
    }
    const authority = await permissions.authorizeOrRequest({ owner, agent, tool, input, eventKey, parentEventId: event?.id || null, goalScope });
    if (authority.waitingApproval) await references.register({ owner, type: 'approval', id: authority.waitingApproval.id,
      agent: authority.waitingApproval.requester, status: authority.waitingApproval.status });
    if (authority.waitingApproval && notify && input.ownerRequest?.origin === 'owner_request') {
      const request = authority.waitingApproval;
      await store.enqueueOutbox({ owner, agent: request.helper, messageKey: `approval:${request.id}`,
        ...(input.ownerRequest && event?.id ? { eventId: event.id } : {}),
        payload: { body: await approvalBody(request), approvalId: request.id, needsReply: true,
          ...(event?.type === 'agent_objective' && input.ownerRequest?.brainTaskId ? { brainTaskId: input.ownerRequest.brainTaskId } : {}),
          ...(input.ownerRequest ? { ownerRequested: true, ownerRequestEventId: event?.id || input.ownerRequest.eventId } : {}) } });
    }
    return authority;
  }

  async function isRoutineActive(id, runKey) {
    if (!id) return true;
    return (await routineState(id,runKey)).active;
  }

  const routineState=(id,runKey)=>routineCalendarRunState(env,owner,id,runKey,{services,now:()=>Date.parse(clock())});
  const routineRetryAt=state=>state.status==='waiting' ? state.startAt:new Date(Date.parse(clock())+60000).toISOString();
  const hydrateRoutine=(routine,state)=>({...routine,title:state.title || routine.title,
    ...(state.startAt ? {occurrenceAt:state.startAt}: {})});
  async function requireRoutineReady(routine) {
    const state=await routineState(routine.id,routine.runKey);
    if (state.active && state.status!=='ready') {
      const error=new Error('routine_calendar_deferred');error.routineDeferral={routine,state};throw error;
    }
    if (state.active) Object.assign(routine,hydrateRoutine(routine,state));
    return state.active;
  }

  const tools = {
    ...services,
    async inspectWorkspace(input) {
      const result = await services.inspectWorkspace(input);
      if (!Array.isArray(result?.jobs)) return result;
      const scopedJobs = [];
      for (const job of result.jobs) {
        const id = job.id || job.jobId;
        if (!id) continue;
        const selected = await jobRetry.select({ owner, jobId: id, statuses: ['failed', 'waiting', 'pending', 'processing', 'complete', 'rejected'] });
        const assigned = selected.job?.agent || null;
        const ref = await references.register({ owner, type: 'job', id, agent: assigned,
          status: /^[a-z_]{1,32}$/.test(job.status || '') ? job.status : 'active' });
        const policy = ownerJobRetryPolicy(job);
        scopedJobs.push({ ...job, shortRef: ref.shortRef, retryPolicy: { retryable: policy.allowed, reason: policy.reason } });
      }
      return { ...result, jobs: scopedJobs };
    },
    async delegateAgentEvent({ agent, target, task, eventId, goalScope }) {
      if (goalScope === 'personal' || !IDS.includes(target)) return { available: false, reason: 'El objetivo personal pertenece a una sola integrante.' };
      const depth = Number(overrides.delegationDepth || 0);
      if (depth >= 3) return { available: false, reason: 'Se alcanzó el límite de colaboración interna.' };
      const event = await store.enqueueEvent({ owner, agent: target, eventKey: `delegate:${eventId}:${target}`, type: 'delegation',
        payload: { from: agent, task, depth: depth + 1 }, priority: 2 });
      return { status: 'delegated', eventId: event.id };
    },
  };

  async function observeOwner({ messageId, message, agent = 'melodi' }) {
    if (!active || !owner || !IDS.includes(agent)) return;
    await initialize();
    const preference = parseOwnerContactPreference(message);
    if (preference) await contactPolicy.update(owner, preference);
    await coordinator.recordOwnerReply(owner, agent, clock());
    await coordinator.remember(owner, agent, message, clock());
    await notices.reopenWindow({ owner, now: clock() });
  }

  async function seedEvents({ calendarReady = true } = {}) {
    const now = clock();
    const settings = await coordinator.settings(owner);
    if (!settings?.enabled) return;
    // Recover the owner's reported request once. A stopped routine stays stopped.
    if (env.REQUESTED_MOTIVATION_RESTORE_REV) {
      const restored=await routines.create({owner,agent:'melodi',eventKey:`restore-motivation:${env.REQUESTED_MOTIVATION_RESTORE_REV}`,
        kind:'motivational_message',frequency:'daily',title:'Frase motivacional diaria',
        brief:'Una frase motivacional corta sobre avanzar hacia el éxito, todos los días.',channel:'auto',hour:'10:00'});
      if (restored.status==='active') {
        const ref=await references.register({owner,type:'routine',id:restored.id,agent:'melodi',status:'active'});
        await notices.enqueue({owner,agent:'melodi',key:`restore-motivation-confirmed:${env.REQUESTED_MOTIVATION_RESTORE_REV}`,ownerRequested:true,
          body:`Melodi: Tu petición diaria ya quedó programada (${ref.shortRef}). Te enviaré una frase breve cada día a las 10:00 a. m., hora de República Dominicana, empezando el ${new Intl.DateTimeFormat('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'long'}).format(new Date(restored.nextAt))}. Elegí esa hora porque me diste libertad de horario. Aparecerá en «Vetsa · Equipo» y puedes detenerla con «Melodi, detén las frases diarias».\nPara hoy: Haz ese paso que llevas posponiendo. Ahí empieza el cambio.`});
      }
    }
    await maintenance.pruneExpiredEvents({ owner, now });
    await maintenance.recoverPrivateJobs({ owner, now });
    // Wake a paused task only after new, correlated evidence exists. Polling
    // a waiting job does not spend model calls or manufacture progress.
    for (const agent of IDS) for (const task of await brain.list({ owner, agent, limit: 50 })) {
      if (task.status !== 'waiting') continue;
      const identity = { owner, agent, id: task.id };
      let changed = false;
      for (const receipt of task.receipts) {
        if (receipt.status === 'delegated' && receipt.operationId) {
          const childRow = await env.VETSA_CLOUD.prepare('SELECT agent FROM wa_melodi_brain_tasks WHERE id=? AND owner=?').bind(receipt.operationId,owner).first();
          if (!childRow) continue;
          const updated = await brain.reconcileDelegationOutcome({ ...identity, childTaskId: receipt.operationId, childAgent: childRow.agent });
          changed ||= updated.revision !== task.revision;
        } else if (receipt.status === 'queued' && receipt.operationId) {
          const job = await services.privateJobInfo(owner, receipt.operationId);
          if(job?.brainTaskId===task.id && job.agent===agent && ['failed','rejected'].includes(job.row?.status)) {
            await brain.fail({...identity,reason:'artifact_job_failed'});changed=true;break;
          }
          if (job?.brainTaskId !== task.id || job.agent !== agent || !job.artifact || job.row?.status !== 'complete') continue;
          const updated = await brain.reconcileJobOutcome({ ...identity, jobId: receipt.operationId,
            result: { status: 'complete', verified: true, artifact: job.artifact } });
          changed ||= updated.revision !== task.revision;
        }
      }
      if (!changed) continue;
      const current = await brain.get(identity);
      if (['failed','cancelled'].includes(current.status)) {await notifyBrainBlock(current);continue;}
      await store.enqueueEvent({ owner, agent, eventKey: `brain-resume:${task.id}:${current.revision}`, type: 'agent_objective',
        payload: { brainTaskId: task.id, ownerRequested: true, allowContact: false }, priority: 20 });
    }
    for (const routine of calendarReady ? await routines.claimDue({ owner, now, limit: 4 }) : []) {
      await store.enqueueEvent({ owner, agent: routine.agent, eventKey: routine.runKey, type: routine.kind || 'weekly_research',
        payload: { routine, allowContact: false }, priority: 6 });
      await routines.complete({ owner, id: routine.id, leaseToken: routine.leaseToken, success: true, now });
    }
    // A clock tick is not a user request. Only requested routines and verified
    // artifact/job state transitions create work; generic daily reviews used
    // to manufacture proposals and repeated questions from stale context.
    await artifacts.discoverExisting({ owner, decrypt: services.decrypt, limit: 40, now });
    await artifacts.reconcileDelivered({ owner, now });
    for (const job of await artifacts.listReady({ owner, now, limit: 10 })) {
      const privateJob = await services.privateJobInfo(owner, job.job_id);
      // Brain tasks own their final result, including delegated artifacts.
      // Their correlated completion path prevents an independent specialist
      // message or a premature generic attachment from reaching the owner.
      if (privateJob?.brainTaskId) continue;
      if (!calendarReady && (privateJob?.scheduledDelivery || job.routine_id)) continue;
      if (privateJob?.scheduledDelivery) {
        const state = await documentDeliveryState(env,owner,job.job_id,Date.parse(clock()),true);
        if (!state.active) { await artifacts.cancel({owner,jobId:job.job_id,reasonCode:'document_cancelled',now}); continue; }
        if (state.status !== 'ready') continue;
      }
      if (job.routine_id) {
        const state=await routineState(job.routine_id,privateJob?.runKey);
        if (!state.active) { await artifacts.cancel({ owner, jobId: job.job_id, reasonCode: 'routine_stopped', now }); continue; }
        if (state.status!=='ready') continue;
      }
      const claim = await artifacts.claim({ owner, jobId: job.job_id, now });
      if (!claim) continue;
      const ownerRequested = privateJob?.origin === 'owner_request' && privateJob.agent === job.agent
        && privateJob.row?.id === job.job_id && privateJob.row?.owner_phone === owner;
      const outbox = await store.enqueueOutbox({ owner, agent: job.agent, messageKey: `artifact:${job.job_id}`, payload: {
        body: job.job_type === 'generate_document' && privateJob?.scheduledDelivery ? 'Aquí tienes el documento que acordamos para hoy.'
          : `Preparé ${job.job_type === 'generate_story' ? 'este borrador de historia para que lo revises.' : job.routine_id ? 'tu informe semanal, con fuentes y límites de los datos disponibles.' : 'el documento solicitado.'}`,
        artifactJobId: job.job_id, routineId: job.routine_id, routineRunKey: privateJob?.runKey || null, channel: job.channel, needsReply: !job.routine_id,
        ownerRequested,
      } });
      await artifacts.markEnqueued({ owner, jobId: job.job_id, token: claim.token, outboxId: outbox.id, now });
    }
  }

  async function tick({ calendarReady = true } = {}) {
    if (!active || !owner) return { enabled: false };
    await initialize();
    if (services.repairRequestedDocument) await services.repairRequestedDocument();
    const repaired = await repairOwnerResearchAssignments({ db: env.VETSA_CLOUD, owner,
      ownerEmail: env.OWNER_EMAIL_FORWARD_TO, ...services, now: clock() });
    for (const item of repaired) await notices.enqueue({ owner, key: `research-assignment-repaired:${item.id}`, agent: item.agent,
      body: `${name(item.agent)}: Tu encargo estaba asignado por error a ${name(item.previousAgent)}. Lo corregí y lo retomaré conservando tu petición original. Te avisaré del resultado.`, ownerRequested: true });
    if (env.PUBLIC_MEDIA_ANALYSIS_ENABLED === 'true' && typeof services.extractPublicMedia === 'function') {
      const resumed = await resumeRequestedMedia({ db: env.VETSA_CLOUD, owner, eventId: env.PUBLIC_MEDIA_RESUME_EVENT_ID,
        decrypt: services.decrypt, now: clock() });
      if (resumed) await notices.enqueue({ owner, key: `media-activation-resume:${resumed.id}`, agent: resumed.agent,
        body: `${name(resumed.agent)}: Retomaré tu encargo original con lectura de imágenes y vídeo; te avisaré del resultado.`, ownerRequested: true });
    }
    await seedEvents({ calendarReady });
    await refreshEmailSenders(env, { now: clock() });
    await ensureAgentEmailSenders(env, { now: clock() });
    await deliverNotices({calendarReady});
    const due = await store.listDueAgents({ owner, now: clock(), limit: 4 });
    // Duplicate dispatches are harmless: the D1 claim and per-agent lease are authoritative.
    for (const item of due.filter(item => item.owner === owner)) await env.MELODI_JOBS.send({ type: 'autonomy_agent', agent: item.agent, calendarReady });
    await env.MELODI_JOBS.send({ type: 'autonomy_outbox', calendarReady });
    return { enabled: true, dispatched: due.length };
  }

  async function runAgent(agent, { calendarReady = true } = {}) {
    if (!active || !IDS.includes(agent)) return;
    await contactPolicy.ensureSchema();
    await brain.ensureSchema();
    const settings = await coordinator.settings(owner);
    if (!settings?.enabled) return;
    let event = null;
    // A Calendar outage must hold dated work without spending its attempts or
    // preventing an independent owner assignment behind it from progressing.
    for (let deferred = 0; deferred < 8; deferred++) {
      event = await store.claimEvent({ owner, agent, now: clock(), leaseMs: 5 * 60000 });
      if (!event || calendarReady) break;
      let routine = event.payload.routine;
      if (event.type === 'approved_action') {
        const approval = await env.VETSA_CLOUD.prepare(`SELECT input_encrypted,input_iv FROM wa_melodi_permission_requests
          WHERE owner_phone=? AND id=? AND helper=? AND status='approved'`).bind(owner,event.payload.approvalId,agent).first();
        if (approval) {
          const decoded = await services.decrypt(approval.input_encrypted,approval.input_iv);
          routine = (typeof decoded === 'string' ? JSON.parse(decoded) : decoded)?.routine;
        }
      }
      if (!routine) break;
      await store.deferRoutineEvent({ owner,agent,eventId:event.id,leaseToken:event.leaseToken,
        routineId:routine.id,runKey:routine.runKey,retryAt:Date.parse(clock())+60000,now:clock() });
      event = null;
    }
    if (!event) return;
    let taskIdentity = null, finalizeVerifiedObjective = false;
    const wakeAgents = new Map();
    try {
      if (event.type === 'agent_objective') {
        const task = await brain.get({ owner, agent, id: event.payload.brainTaskId });
        if (!task || task.owner !== owner || task.agent !== agent || ['completed','failed','cancelled'].includes(task.status)) {
          await store.finishEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken, now: clock() });
          return;
        }
        taskIdentity = { owner, agent, id: task.id };
        const exhausted = (task.turns || 0)>=6 || Date.parse(clock()) - task.createdAt > 30 * 60000
          || task.receipts.filter(receipt=>receipt.key.startsWith(`${task.id}:step`)).length >= 12;
        finalizeVerifiedObjective = exhausted && objectiveProgress(task).complete;
        if (exhausted && !finalizeVerifiedObjective) {
          await brain.fail({ ...taskIdentity, reason:'objective_execution_budget_exhausted' });
          await store.finishEvent({ owner,agent,eventId:event.id,leaseToken:event.leaseToken,status:'failed',errorCode:'objective_execution_budget_exhausted',now:clock() });
          return;
        }
        if (task.parentTaskId) {
          const parentRow = await env.VETSA_CLOUD.prepare('SELECT agent,status FROM wa_melodi_brain_tasks WHERE id=? AND owner=?').bind(task.parentTaskId,owner).first();
          if (!parentRow || ['failed','cancelled'].includes(parentRow.status)) {
            await brain.cancel(taskIdentity);
            await store.finishEvent({ owner, agent, eventId:event.id,leaseToken:event.leaseToken,now:clock() });
            return;
          }
        }
        event.payload.objective = task.objective;
        // Reconciliation makes a task running before it wakes this durable
        // event. Each claimed execution still spends one of its six turns.
        if (!finalizeVerifiedObjective) {
          if (task.status === 'running') await brain.wait({ ...taskIdentity, reason: 'next_action_required' });
          await brain.start(taskIdentity);
        }
      }
      if (['daily_review', 'background_review', 'team_bootstrap', 'owner_context'].includes(event.type)
        || !await contactPolicy.permits(owner, JSON.stringify(event.payload))) {
        if (taskIdentity) await brain.wait({ ...taskIdentity, reason: 'owner_topic_excluded' });
        await store.finishEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken,
          checkpoint: { summary: 'Evento sin encargo vigente o excluido por las preferencias del propietario.', lastEvent: event.type }, now: clock() });
        return;
      }
      if (event.payload.routine) {
        if (!await requireRoutineReady(event.payload.routine)) {
          await store.finishEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken, now: clock() });return;
        }
      }
      if (event.type === 'approved_action') {
        const result=await runApprovedAction(agent, event, wakeAgents);
        if (result?.deferred) return;
        await store.finishEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken, now: clock() });
        return;
      }
      if (event.type === 'owner_research_report') {
        const request = event.payload.request;
        const ownerRequest = { channel: request.channel, origin: 'owner_request', assignmentAgent: agent,
          eventId: event.id, sourceUrl: request.sourceUrl, request };
        const reportServices = { ...services,
          ...(typeof services.extractPublicMedia === 'function' || event.payload.approvedMedia ? {
            extractPublicMedia: async input => {
              if (event.payload.approvedMedia) return event.payload.approvedMedia;
              if (event.payload.mediaOperation?.approvalId) {
                const approval = await env.VETSA_CLOUD.prepare(`SELECT id FROM wa_melodi_permission_requests
                  WHERE owner_phone=? AND id=? AND requester=? AND tool='inspect_public_media' AND status IN ('claimed','completed')`)
                  .bind(owner, event.payload.mediaOperation.approvalId, agent).first();
                if (!approval) throw new Error('requested_research_media_approval_invalid');
                return services.extractPublicMedia(input);
              }
              const authority = await requestTool(agent, 'inspect_public_media', { url: request.sourceUrl, ownerRequest },
                `${event.id}:requested-media`, event);
              if (!authority.allowed) return authority;
              return services.extractPublicMedia(input);
            },
          } : {}),
          readPublicSource: async input => {
            if (event.payload.approvedResearch) return event.payload.approvedResearch;
            const authority = await requestTool(agent, 'research_public_marketing', {
              query: clean(`Lee los formatos en esta fuente pública exacta: ${request.sourceUrl}`, 700), ownerRequest,
            }, `${event.id}:requested-source`, event);
            if (!authority.allowed) return authority;
            return typeof services.readPublicSource === 'function' ? services.readPublicSource(input)
              : readPublicInstagramSource(env, { url: input.url });
          },
          prepareDocument: async input => {
            const authority = await requestTool(agent, 'prepare_document', { ...input, ownerRequest }, `${event.id}:requested-document`, event);
            if (!authority.allowed) return authority;
            return services.prepareDocument({ ...input, agent, assignmentAgent: agent, channel: request.channel, origin: 'owner_request' });
          },
        };
        const result = await runRequestedResearchReport({ owner, agent, eventId: event.id, request,
          mediaOperation: event.payload.mediaOperation, now: clock() }, reportServices);
        if (result.status === 'pending') {
          await store.deferEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken,
            payload: { ...event.payload, mediaOperation: { operationId: result.operationId,
              startedAt: event.payload.mediaOperation?.startedAt ?? Date.parse(clock()),
              eventId: event.payload.mediaOperation?.eventId || event.id } },
            retryAt: Date.parse(clock()) + result.retryAfterMs,
            checkpoint: { lastEvent: event.type, result: 'pending', summary: 'Extracción de medios públicos en curso; informe pendiente.',
              operationId: result.operationId, updatedAt: clock() }, now: clock() });
          return;
        }
        if (result.status === 'blocked') await store.enqueueOutbox({ owner, agent, eventId: event.id,
          messageKey: `requested-research-blocked:${event.id}${env.PUBLIC_MEDIA_RESUME_EVENT_ID === event.id ? ':media-v1' : ''}`,
          payload: { body: `${name(agent)}: ${result.summary || 'No pude verificar el contenido de esa fuente pública; no preparé un informe con datos inventados.'}`,
            ownerRequested: true, ownerRequestEventId: event.id, channel: request.channel, needsReply: true } });
        if (result.jobId) await references.register({ owner, type: 'job', id: result.jobId, agent, status: 'pending' });
        await store.finishEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken,
          errorCode: result.status === 'blocked' ? (['source_unavailable', 'formats_not_verified', 'source_reader_not_connected'].includes(result.reason)
            ? `requested_research_${result.reason}` : 'requested_research_blocked') : undefined,
          checkpoint: { lastEvent: event.type, result: result.status, summary: result.summary || '',
            pendingApproval: result.waitingApproval ? { id: result.waitingApproval.id, helper: result.waitingApproval.helper,
              tool: result.tool, status: 'pending' } : null, updatedAt: clock() }, now: clock() });
        return;
      }
      if (event.type === 'motivational_message' || event.type === 'recurring_reminder') {
        const routine=event.payload.routine, state=await routineState(routine?.id,routine?.runKey);
        if (!state.active || state.agent !== agent) {
          await store.finishEvent({owner,agent,eventId:event.id,leaseToken:event.leaseToken,checkpoint:{lastEvent:event.type,result:'cancelled'},now:clock()}); return;
        }
        if (state.status !== 'ready') {
          await store.deferRoutineEvent({owner,agent,eventId:event.id,leaseToken:event.leaseToken,routineId:routine.id,runKey:routine.runKey,retryAt:routineRetryAt(state),now:clock()});return;
        }
        if (Date.parse(clock())-Date.parse(state.startAt)<86400000) {
          const recent=(await coordinator.context(owner,agent))?.recent || [];
          const phrase=event.type==='recurring_reminder' ? reminderDueMessage(state.title) : await motivationalPhrase({agent,brief:routine.brief,now:clock(),recent},services.generate);
          const current=await routineState(routine.id,routine.runKey);
          if (current.active && current.status==='ready') await store.enqueueOutbox({owner,agent,eventId:event.id,
            messageKey:`motivational:${routine.runKey}`,payload:{body:`${name(agent)}: ${phrase}`,routineId:routine.id,
              routineRunKey:routine.runKey,routineMessage:true,channel:routine.channel,needsReply:false}});
        }
        await store.finishEvent({owner,agent,eventId:event.id,leaseToken:event.leaseToken,
          checkpoint:{lastEvent:event.type,routineId:routine.id,result:'prepared',updatedAt:clock()},now:clock()});return;
      }
      if (event.type === 'weekly_research') {
        const routine = event.payload.routine;
        const delegatedServices = { ...services, isRoutineActive: () => requireRoutineReady(routine),
          researchPublicMarketing: async input => {
            if (event.payload.approvedResearch) return event.payload.approvedResearch;
            const authority = await requestTool(agent, 'research_public_marketing', { ...input, routine }, `${event.id}:research`, event);
            if (!authority.allowed) return authority;
            return services.researchPublicMarketing?.(input) || { configured: false, results: [] };
          },
          prepareDocument: async input => {
            const authority = await requestTool(agent, 'prepare_document', { ...input, routine }, `${routine.runKey}:document`, event);
            if (!authority.allowed) return authority;
            return services.prepareDocument({ ...input, idempotencyKey: `${routine.runKey}:document` });
          },
        };
        const result = await runWeeklyResearch({ agent, owner, eventId: event.id, routine, now: clock() }, delegatedServices);
        if (result.status === 'failed') throw new Error('weekly_research_failed');
        await store.finishEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken,
          checkpoint: { lastEvent: event.type, routineId: routine.id, result: result.status, updatedAt: clock() }, now: clock() });
        return;
      }
      let resumedMedia = null;
      const previousMedia = event.payload.pendingTool;
      if (event.type === 'public_media_poll') {
        const operation = event.payload.mediaOperation;
        const valid = validateAutonomyToolInput({ agent, name: previousMedia?.name, input: { url: previousMedia?.url } });
        if (!valid.ok || previousMedia?.name !== 'inspect_public_media' || !AUTONOMY_MEDIA_EVENT_TYPES.includes(previousMedia.originalType)
          || !['team', 'personal'].includes(previousMedia.goalScope) || !operation?.operationId || previousMedia.eventId !== operation.eventId)
          throw new Error('invalid_pending_media_tool');
        const finishMedia = (status, errorCode, summary) => store.finishEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken,
          status, errorCode, checkpoint: { lastEvent: previousMedia.originalType, result: 'blocked', summary, updatedAt: clock() }, now: clock() });
        if (Date.parse(clock()) >= operation.startedAt + 15 * 60000) {
          await finishMedia('failed', 'media_processing_timeout', 'La inspección de medios no terminó dentro del plazo; no hay resultado confirmado.');
          return;
        }
        const level = await permissions.ensureAgent(owner, agent);
        let authorized = level.level >= permissionForTool('inspect_public_media').minimumLevel;
        if (!authorized && operation.approvalId) {
          const approval = await env.VETSA_CLOUD.prepare(`SELECT p.id,p.input_encrypted,p.input_iv,p.goal_scope
          FROM wa_melodi_permission_requests p JOIN wa_melodi_levels h ON h.owner_phone=p.owner_phone AND h.agent=p.helper
          JOIN wa_melodi_levels r ON r.owner_phone=p.owner_phone AND r.agent=p.requester
          WHERE p.owner_phone=? AND p.id=? AND p.requester=? AND p.tool='inspect_public_media' AND p.status='completed'
            AND h.permission_revision=p.helper_revision AND r.permission_revision=p.requester_revision AND h.level>=p.required_level`)
            .bind(owner, operation.approvalId, agent).first();
          if (approval && operation.eventId === `approved:${approval.id}` && previousMedia.goalScope === approval.goal_scope) {
            const granted = await services.decrypt(approval.input_encrypted, approval.input_iv);
            const input = typeof granted === 'string' ? JSON.parse(granted) : granted;
            authorized = input?.url === previousMedia.url;
          }
        }
        if (!authorized) {
          await finishMedia('failed', 'media_permission_revoked', 'La autorización de la inspección cambió; no se continuó la operación.');
          return;
        }
        if (typeof services.extractPublicMedia !== 'function') {
          await finishMedia('failed', 'media_backend_not_connected', 'La inspección no está conectada; no se obtuvo un resultado.');
          return;
        }
        if (!await store.renewLease({ owner, agent, eventId: event.id, leaseToken: event.leaseToken, now: clock() })) throw new Error('agent_lease_lost');
        const result = await executeAutonomyTool({ agent, name: 'inspect_public_media', input: valid.input, ownerPhone: owner,
          eventId: operation.eventId, now: clock(), goalScope: previousMedia.goalScope }, {
          extractPublicMedia: args => services.extractPublicMedia({ ...args, operationId: operation.operationId }),
        });
        if (result.status === 'pending' && result.receipt?.operationId !== operation.operationId) throw new Error('pending_media_operation_changed');
        if (result.status === 'pending' && result.receipt?.verified) {
          await store.deferEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken, payload: event.payload,
            retryAt: Date.parse(clock()) + result.data.retryAfterMs,
            checkpoint: { lastEvent: previousMedia.originalType, result: 'pending', summary: 'Inspección de medios públicos en curso; resultado pendiente.' }, now: clock() });
          return;
        }
        if (result.status !== 'ready' || !result.receipt?.verified) {
          await finishMedia('failed', 'media_inspection_blocked', 'La inspección no recuperó medios verificables; no se anunció un resultado.');
          return;
        }
        resumedMedia = result;
        event.type = previousMedia.originalType;
        event.payload = Object.fromEntries(Object.entries(event.payload).filter(([key]) => !['pendingTool', 'mediaOperation'].includes(key)));
      }
      const goal = await coordinator.goal(owner, agent);
      const taskScope = taskIdentity ? (await brain.get(taskIdentity)).scope : goal ? 'personal' : 'team';
      const ownContext = await coordinator.context(owner, agent);
      const checkpoint = await store.getCheckpoint(owner, agent) || {};
      const contactPreferences = await contactPolicy.read(owner);
      const teamLevels = await permissions.getTeam(owner);
      const ownPendingApprovals = await Promise.all((await permissions.listPending(owner)).filter(row => row.requester === agent).map(async row => ({
        id: row.id, shortRef: (await references.register({ owner, type: 'approval', id: row.id, agent, status: row.status })).shortRef,
        helper: row.helper, tool: row.tool, requiredLevel: row.required_level,
        status: row.status, goalScope: row.goal_scope, createdAt: row.created_at, expiresAt: row.expires_at,
      })));
      let pendingApproval = ownPendingApprovals.find(row => row.id === checkpoint.pendingApproval?.id) || null;
      const memberLevel = teamLevels.find(row => row.agent === agent)?.level ?? 0;
      // Automatic context reads follow the same authority policy as model
      // requests. A level-zero agent does not get private workspace access.
      const observations = resumedMedia ? [...(previousMedia.observations || []), resumedMedia] : taskIdentity ? [] : [memberLevel >= permissionForTool('inspect_workspace').minimumLevel
        ? await executeAutonomyTool({ agent, name: 'inspect_workspace', input: { limit: 10 }, ownerPhone: owner, eventId: `${event.id}:inspect` }, tools)
        : { ok: false, status: 'blocked', error: 'level_required', receipt: { tool: 'inspect_workspace', status: 'blocked', verified: false } }];
      const receipts = resumedMedia ? [...(previousMedia.receipts || []), resumedMedia.receipt] : [];
      const resultEvidence = async () => {
        const task = taskIdentity ? await brain.get(taskIdentity) : null;
        const evidence = buildAgentEvidence({observations,task});
        // A document specialist reads the original coordinator's correlated
        // tool memory, not a model-authored delegation paraphrase. Keep these
        // references separate from her own execution receipts and plan.
        if (task?.parentTaskId && task.scope === 'team') {
          const parentRow = await env.VETSA_CLOUD.prepare('SELECT agent FROM wa_melodi_brain_tasks WHERE id=? AND owner=?')
            .bind(task.parentTaskId,owner).first();
          const parent = parentRow && await brain.get({owner,agent:parentRow.agent,id:task.parentTaskId});
          if (parent?.scope === 'team') evidence.push(...buildAgentEvidence({task:parent}));
        }
        return [...new Map(evidence.map(block=>[block.id,block])).values()];
      };
      const runtimeTools = { ...tools,
        ...(taskIdentity && typeof services.prepareDocument === 'function' ? { prepareDocument: input => services.prepareDocument({ ...input,
          origin:'owner_request',assignmentAgent:agent,brainTaskId:taskIdentity.id }) } : {}),
        ...(taskIdentity && typeof services.prepareStory === 'function' ? { prepareStory: input => services.prepareStory({ ...input,
          origin: 'owner_request', brainTaskId: taskIdentity.id }) } : {}),
        delegateAgentEvent: async request => {
        if ((event.payload.depth || 0) >= 3) return { available: false, reason: 'Límite de colaboración interna.' };
        if (taskIdentity) {
          const parent = await brain.get(taskIdentity);
          if (parent.scope !== 'team') return { available:false,reason:'El objetivo personal no se comparte.' };
          const child = await brain.accept({ owner, agent: request.target, eventId: `delegate:${request.eventId}:${request.target}`,
            objective: request.task, origin: 'delegation', speaker: parent.speaker, parentTaskId: parent.id,
            requiredTools:parent.requiredTools.filter(tool=>({research_public_web:'melodi',research_public_marketing:'melodi',inspect_public_media:'melodi',prepare_document:'melodi',inspect_finances:'melodi',account_metrics:'melodi'})[tool]===request.target) });
          await store.enqueueEvent({ owner, agent: request.target, eventKey: `brain:${child.id}`, type: 'agent_objective', priority:20,
            payload: { brainTaskId: child.id, parentBrainTaskId: parent.id, depth:(event.payload.depth || 0)+1, allowContact:false } });
          wakeAgents.set(request.target, 0);
          return { status:'delegated',eventId:child.id };
        }
        const delegated = await store.enqueueEvent({ owner, agent: request.target, eventKey: `delegate:${request.eventId}:${request.target}`, type: 'delegation',
          payload: { from: agent, task: request.task, depth: (event.payload.depth || 0) + 1 }, priority: 2 });
        wakeAgents.set(request.target, 0);
        return { status: 'delegated', eventId: delegated.id };
      }, permissionLevel: Object.fromEntries(teamLevels.map(row => [row.agent, row.level])) };
      const reportQuery=taskIdentity ? (await brain.get(taskIdentity)).objective : JSON.stringify(event.payload || {});
      const ecosystemReports=/\b(?:vetsa|cognira|spaik|remote host)\b/i.test(reportQuery) && typeof services.ecosystemReportContext==='function'
        ? await services.ecosystemReportContext({ownerPhone:owner,query:reportQuery,maxChars:14000}) : '';
      let decision, objectiveContinuation = false;
      for (let step = 0; step < (finalizeVerifiedObjective ? 0 : event.type === 'team_bootstrap' ? 1 : 4); step += 1) {
        objectiveContinuation = false;
        if (!await store.renewLease({ owner, agent, eventId: event.id, leaseToken: event.leaseToken, now: clock() })) throw new Error('agent_lease_lost');
        decision = modelObject(await services.generate(agent, {
          ...clockContext(clock()), identity: agent, objectives: AUTONOMY_PROFILES[agent].goals,
          assigned_personal_goal: taskIdentity && taskScope !== 'personal' ? null : goal, own_checkpoint: checkpoint, own_recent_conversation: ownContext,
          owner_contact_preferences: { unsolicited: false, blockedTopics: contactPreferences.blockedTopics },
          ...(ecosystemReports ? {ecosystem_reports_reference:ecosystemReports} : {}),
          ...(taskIdentity ? { task_memory: await brain.get(taskIdentity) } : {}),
          ...(taskIdentity ? { result_evidence: await resultEvidence() } : {}),
          own_pending_approvals: ownPendingApprovals,
          own_level: teamLevels.find(row => row.agent === agent), team_levels: teamLevels.map(({ agent, level }) => ({ agent, level })),
          event: { type: event.type, data: event.payload }, tools: autonomyToolCatalog(agent, runtimeTools), observations,
          contact_allowed: event.payload.allowContact === true && (!settings.focus_agent || settings.focus_agent === agent),
        }, `${autonomyAgentPrompt(agent)}\n${taskIdentity ? agentBrainPrompt(agent,runtimeTools) : ''}\nDevuelve solo JSON: {"action":"tool"|"message"|"wait","tool":"","input":{},"plan":[{"description":"Paso concreto","tool":"herramienta real del catálogo"}],"message":"","result":{"claims":[{"kind":"fact","evidenceIds":["ID de result_evidence"]}]},"needs_reply":false,"checkpoint":{"summary":"","next_step":"","open_question":""}}.
RESULTADOS Y DOCUMENTOS: result_evidence contiene bloques comprobados por herramientas, con procedencia. Para cada hecho selecciona kind=fact y evidenceIds; omite text o copia literalmente el bloque completo, incluidos límites y negaciones. Para análisis usa kind=inference, evidenceIds y text explícitamente tentativo (Recomiendo, podría, convendría); el sistema lo etiqueta Inferencia y no acepta cifras ni nuevas URLs ni contradicciones de restricciones. Para totales numéricos usa kind=derived, operation=sum|difference|mean, evidenceIds de valores compatibles; la aplicación calcula el número. result.claims se usa también al preparar documentos. No conviertas una delegación, una URL sola o el texto de message/input.content en evidencia. Si necesitas datos, ejecuta la herramienta primero. Un resumen libre sin claims no se enviará como un hecho.
Usa tool para ejecutar un siguiente paso concreto; después recibirás su resultado. No declares resultados sin recibo. message inicia una conversación pertinente y breve, nunca un saludo vacío. Un objetivo personal es privado para ti: no lo delegues ni lo compartas, aunque esté pausado o completado. No sigas trabajando en un objetivo pausado o completado. owner_context y background_review actualizan tu estado y trabajan silenciosamente: no envían mensajes espontáneos. No repitas una pregunta pendiente ni interpretes silencio como progreso. Solo estas herramientas existen, y no puedes elegir destinatarios ni cambiar permisos. Si nada nuevo merece atención, wait. Los recibos queued son tareas pendientes, no terminadas. Máximo una pregunta por mensaje. Si una integración falta, registra el bloqueo sin insistir a diario. Al hablar con el propietario usa referencias cortas C/R/T; nunca muestres UUID, auto-ID ni nombres internos de herramientas. El id completo de jobs es solo para la llamada técnica. Ofrece reintentos únicamente cuando retryPolicy.retryable sea true; un fallo de créditos, permisos, formato o entrega incierta no se resuelve repitiendo.`));
        if (taskIdentity && !(await brain.get(taskIdentity)).steps.length) {
          const proposed = Array.isArray(decision.plan) ? decision.plan.filter(item => typeof item?.description === 'string'
            && item.description.trim() && item.description.length <= 800 && autonomyToolCatalog(agent, runtimeTools).some(tool => tool.name === item.tool)).slice(0,12) : [];
          if (proposed.length) await brain.setPlan({ ...taskIdentity, steps: proposed.map(({ description, tool }) => ({ description, tool })) });
        }
        // A proven objective needs no further side effects, even if the model
        // proposes an unrelated tool after the last required receipt arrives.
        if (taskIdentity && decision.action === 'tool' && objectiveProgress(await brain.get(taskIdentity)).complete) break;
        if (decision.action !== 'tool') {
          if (taskIdentity) {
            const current = await brain.get(taskIdentity), remaining = objectiveProgress(current);
            if (current.status === 'running' && !remaining.complete) {
              // Prose cannot finish an objective or stand in for a receipt.
              // Give the model its remaining real work within this bounded loop.
              observations.push({ ok: false, status: 'required_steps_pending',
                pendingSteps: remaining.steps.map(({ id, description, tool, status }) => ({ id, description, tool, status })),
                requiredTools: remaining.tools, requiredAgents: remaining.agents,
                message: 'El objetivo sigue pendiente. Usa una herramienta real para el siguiente paso del plan; delega a la especialista requerida y espera su evidencia. Si falta el plan, propón pasos del catálogo. Un mensaje parcial no completa el encargo y no debes repetir pasos ya verificados.' });
              objectiveContinuation = true;
              continue;
            }
          }
          break;
        }
        if (event.type === 'team_bootstrap') { decision = { action:'wait',checkpoint:{summary:'Inspección inicial completada; las acciones propuestas quedan para un evento de trabajo.'} }; break; }
        const toolDescriptor = autonomyToolCatalog(agent, runtimeTools).find(item => item.name === decision.tool);
        const validation = validateAutonomyToolInput({ agent, name: decision.tool, input: decision.input });
        if (taskIdentity) {
          const current=await brain.get(taskIdentity), matches=current.steps.filter(item=>item.tool===decision.tool);
          const specialist=({research_public_web:'melodi',prepare_document:'melodi',inspect_finances:'melodi',account_metrics:'melodi'})[decision.tool];
          if(agent==='melodi' && (current.requiredAgents || []).includes(specialist)) {
            observations.push({ok:false,status:'delegate_required',message:`Esta parte está asignada a ${specialist}. Usa delegate_agent_event con target=${specialist}; espera su evidencia y coordina el siguiente paso.`});objectiveContinuation=true;continue;
          }
          const requiredDelegation = decision.tool === 'delegate_agent_event'
            && objectiveProgress(current).agents.includes(validation.input?.target);
          if (matches.length && matches.every(item=>item.status==='completed') && !requiredDelegation) {
            observations.push({ ok:true,status:'already_verified',tool:decision.tool,
              message:'Ese paso ya tiene un recibo comprobado; utiliza su evidencia guardada y continúa con los pasos pendientes.' });
            objectiveContinuation = true;
            continue;
          }
        }
        if (validation.ok && !await contactPolicy.permits(owner, `${['account_metrics','research_public_marketing','inspect_public_media'].includes(decision.tool) ? 'instagram ' : ''}${JSON.stringify(validation.input)}`)) {
          decision = { action: 'wait', checkpoint: { summary: 'El tema está excluido por una preferencia expresa del propietario.' } };
          break;
        }
        if (!toolDescriptor || toolDescriptor.status !== 'available' || !validation.ok) {
          const reason = !toolDescriptor ? 'unknown_autonomy_tool' : toolDescriptor.status !== 'available' ? 'tool_not_connected' : validation.error;
          observations.push({ ok: false, status: 'blocked', error: reason });
          decision = { action: 'wait', checkpoint: { summary: `Acción bloqueada: ${reason}.` } };
          break;
        }
        if (taskIdentity) {
          const current = await brain.get(taskIdentity);
          if (current.receipts.filter(receipt => receipt.key.startsWith(`${current.id}:step`)).length >= 12
            || Date.parse(clock()) - current.createdAt > 30 * 60000) {
            await brain.fail({ ...taskIdentity, reason: 'objective_execution_budget_exhausted' });
            break;
          }
        }
        if (taskIdentity && decision.tool === 'prepare_document') {
          const task = await brain.get(taskIdentity), required = new Set(task.requiredTools);
          if (task.parentTaskId) {
            const parentRow = await env.VETSA_CLOUD.prepare('SELECT agent FROM wa_melodi_brain_tasks WHERE id=? AND owner=?').bind(task.parentTaskId,owner).first();
            const parent = parentRow && await brain.get({owner,agent:parentRow.agent,id:task.parentTaskId});
            if (parent?.scope === 'team') for (const tool of parent.requiredTools) required.add(tool);
          }
          const factual = ['research_public_web','research_public_marketing','inspect_public_media','inspect_finances','account_metrics','inspect_workspace'].some(tool=>required.has(tool));
          let content;
          if (factual) {
            const evidence = await resultEvidence();
            const selected = validateAgentResult(decision?.result,evidence,{maxChars:14500});
            const grounded = selected.ok ? selected : groundedAgentFallback(evidence,{limit:20,maxChars:14500});
            if (!grounded.ok) {
              await brain.wait({...taskIdentity,reason:'source_evidence_required'});
              decision = {action:'wait',checkpoint:{summary:'El informe necesita datos comprobados antes de redactarse.'}};
              break;
            }
            content = grounded.text;
          } else {
            // Authorship is a real capability without a research prerequisite.
            // Its creation receipt proves the file, not the draft's assertions.
            content = `Borrador generado; los hechos no están verificados.\n\n${validation.input.content}`.slice(0,16000);
          }
          validation.input = {...validation.input,content,
            title:task.objective.includes(validation.input.title) ? validation.input.title : factual ? 'Informe del encargo solicitado' : 'Borrador del encargo solicitado'};
        }
        const toolInput = taskIdentity ? { ...validation.input, ownerRequest: { origin: 'owner_request', assignmentAgent: agent,
          eventId: event.id, brainTaskId: taskIdentity.id, channel: 'auto' } } : validation.input;
        const authority = await requestTool(agent, decision.tool, toolInput, `${event.id}:step${step}`, event, taskScope);
        if (!authority.allowed) {
          observations.push(authority);
          if (authority.status === 'waiting_approval' && authority.waitingApproval) pendingApproval = {
            id: authority.waitingApproval.id, tool: authority.waitingApproval.tool, helper: authority.waitingApproval.helper,
            status: authority.waitingApproval.status,
          };
          decision = { action: 'wait', checkpoint: { summary: authority.status === 'waiting_approval'
            ? 'Colaboración pendiente de aprobación del propietario.' : `Acción bloqueada: ${authority.reason || authority.status || 'sin autorización'}.` } };
          if (taskIdentity) await brain.wait({ ...taskIdentity, reason: 'authorization_required' });
          break;
        }
        const durableTask = taskIdentity ? await brain.get(taskIdentity) : null;
        const operationIndex = durableTask?.receipts.filter(receipt=>receipt.key.startsWith(`${durableTask.id}:step`)).length;
        const toolEventId = taskIdentity ? `${taskIdentity.id}:step${operationIndex}`
          : decision.tool === 'inspect_public_media' ? `${event.id}:public-media` : `${event.id}:step${step}`;
        const tool = await executeAutonomyTool({ agent, name: decision.tool, input: validation.input,
          ownerPhone: owner, eventId: toolEventId, now: clock(), goalScope: taskScope }, runtimeTools);
        if (taskIdentity) await brain.recordToolOutcome({ ...taskIdentity, operationKey: toolEventId, tool: decision.tool, result: tool });
        if (taskIdentity && tool.receipt?.verified && tool.data) await brain.remember({ ...taskIdentity,
          fact: serializeAgentToolMemory(tool.data), source: { kind:'tool',id:toolEventId } });
        if (decision.tool === 'inspect_public_media' && tool.status === 'pending' && tool.receipt?.verified) {
          await store.deferEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken,
            payload: { ...event.payload, pendingTool: { name: 'inspect_public_media', url: validation.input.url,
              eventId: toolEventId, goalScope: taskScope, originalType: event.type, observations, receipts },
              mediaOperation: { operationId: tool.receipt.operationId, eventId: toolEventId, startedAt: Date.parse(clock()) } },
            retryAt: Date.parse(clock()) + tool.data.retryAfterMs,
            checkpoint: { lastEvent: event.type, result: 'pending', summary: 'Inspección de medios públicos en curso; resultado pendiente.' }, now: clock() });
          return;
        }
        observations.push({...tool,operationKey:toolEventId,agent});
        if (tool.receipt?.verified) receipts.push(tool.receipt);
        if (taskIdentity && ['queued','pending','delegated','unavailable','blocked','failed'].includes(tool.receipt?.status)) break;
        objectiveContinuation = true;
      }
      const next = { summary: clean(decision?.checkpoint?.summary, 3000), nextStep: clean(decision?.checkpoint?.next_step, 1200),
        openQuestion: clean(decision?.checkpoint?.open_question, 800), lastEvent: event.type, updatedAt: clock(), receipts: receipts.slice(-8),
        pendingApproval };
      // Model prose is not delivery evidence. Requested research, routines and
      // verified artifacts have dedicated delivery paths below. Never emit a
      // generic proposal/status claim produced by an autonomous model step.
      if (taskIdentity) {
        const task = await brain.get(taskIdentity);
        if (task.status === 'running' && objectiveProgress(task).complete) {
          const completed = await brain.complete(taskIdentity);
          let completedArtifact = null;
          for (const receipt of completed.receipts.filter(item=>item.verified && item.status==='prepared' && item.operationId)) {
            const job=await services.privateJobInfo(owner,receipt.operationId);
            if (job?.row?.status==='complete' && job.artifact && job.row.owner_phone===owner) completedArtifact=receipt.operationId;
          }
          const evidence = await resultEvidence();
          if (completedArtifact) evidence.push(...buildAgentEvidence({observations:[{ok:true,agent,
            receipt:{tool:'prepare_document',status:'prepared',verified:true,operationId:completedArtifact},
            data:{report:'El archivo solicitado está preparado y su artefacto privado está comprobado.'}}]}));
          const selected = validateAgentResult(decision?.result,evidence,{maxChars:2700});
          const grounded = selected.ok ? selected : groundedAgentFallback(evidence,{limit:10,maxChars:2700});
          // A file caption reports verified creation. The
          // findings and full citations belong in the attached report, rather
          // than a long dump of source metadata that WhatsApp would truncate.
          const body = completedArtifact ? 'Aquí tienes el documento para revisarlo.' : grounded.text;
          if (!completed.parentTaskId) await store.enqueueOutbox({ owner, agent, messageKey: `brain-result:${completed.id}`, eventId: event.id,
            payload: { body: `${name(agent)}: ${body}`, brainTaskId: completed.id, ownerRequested: true,
              ownerRequestEventId: event.id, speakerAgent: completed.speaker,
              grounding:{verified:grounded.ok,receipts:grounded.receipts},...(completedArtifact ? {artifactJobId:completedArtifact}: {}) } });
        }
        else if (task.status === 'running') {
          await brain.wait({ ...taskIdentity, reason: 'next_action_required' });
          const current = await brain.get(taskIdentity);
          const exhausted = (current.turns || 0) >= 6 || Date.parse(clock()) - current.createdAt > 30 * 60000
            || current.receipts.filter(receipt=>receipt.key.startsWith(`${current.id}:step`)).length >= 12;
          if (exhausted) await brain.fail({ ...taskIdentity, reason:'objective_execution_budget_exhausted' });
          else if (objectiveContinuation && current.steps.some(step => autonomyToolCatalog(agent, runtimeTools).some(tool => tool.name === step.tool))) {
            await store.enqueueEvent({ owner,agent,eventKey:`brain-continue:${current.id}:${current.revision}`,type:'agent_objective',priority:20,
              availableAt:Date.parse(clock())+1000,payload:{brainTaskId:current.id,ownerRequested:true,allowContact:false} });
            wakeAgents.set(agent, 1);
          } else await brain.fail({...taskIdentity,reason:'required_steps_not_executed'});
        }
        await notifyBrainBlock(await brain.get(taskIdentity));
      }
      await store.finishEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken, checkpoint: next, now: clock() });
      console.log(JSON.stringify({ event: 'autonomy_agent_complete', agent, eventType: event.type, toolCount: receipts.length }));
    } catch (error) {
      if (taskIdentity) {
        const task = await brain.get(taskIdentity);
        if (task && !['completed','failed','cancelled'].includes(task.status)) await brain.wait({ ...taskIdentity, reason: 'execution_retry_pending' });
      }
      if (error?.routineDeferral && ['weekly_research','motivational_message'].includes(event.type)) {
        const {routine,state}=error.routineDeferral;
        await store.deferRoutineEvent({owner,agent,eventId:event.id,leaseToken:event.leaseToken,
          routineId:routine.id,runKey:routine.runKey,retryAt:routineRetryAt(state),now:clock()});return;
      }
      const errorCode = event.type === 'owner_research_report' ? requestedResearchErrorCode(error) : 'agent_run_failed';
      const finished = await store.finishEvent({ owner, agent, eventId: event.id, leaseToken: event.leaseToken, status: 'pending', errorCode, now: clock() });
      if (finished && event.type === 'owner_research_report' && event.attempts >= event.max_attempts) {
        await notices.enqueue({ owner, key: `requested-research-failed:${event.id}`, agent,
          body: `${name(agent)}: No pude terminar la investigación que me pediste después de los reintentos. El encargo quedó bloqueado; todavía no puedo entregarte el documento.`, ownerRequested: true });
      }
      console.error(JSON.stringify({ event: 'autonomy_agent_failed', agent, eventType: event.type, errorCode }));
    } finally {
      try { await wakeAfterEvent(event, taskIdentity, wakeAgents, calendarReady); }
      catch { console.error(JSON.stringify({ event: 'autonomy_wakeup_recovery_deferred', agent })); }
    }
  }

  async function approvedObjective(request, input, { checkContact = true } = {}) {
    const source = request.parent_event_id && await env.VETSA_CLOUD.prepare(`SELECT type,payload_encrypted,payload_iv FROM wa_melodi_work_events
      WHERE id=? AND owner=? AND agent=?`).bind(request.parent_event_id,owner,request.requester).first();
    const assigned = input?.ownerRequest;
    if (source?.type !== 'agent_objective') {
      if (assigned?.brainTaskId) throw Error('approved_objective_scope_mismatch');
      return null;
    }
    const decoded = await services.decrypt(source.payload_encrypted,source.payload_iv);
    const payload = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
    if (assigned?.origin !== 'owner_request' || assigned.assignmentAgent !== request.requester
      || assigned.eventId !== request.parent_event_id || typeof assigned.brainTaskId !== 'string'
      || assigned.brainTaskId !== payload.brainTaskId) throw Error('approved_objective_scope_mismatch');
    const identity = { owner,agent:request.requester,id:assigned.brainTaskId };
    const task = await brain.get(identity);
    if (!task || !['pending','running','waiting'].includes(task.status) || task.scope !== request.goal_scope
      || !['owner_request','delegation'].includes(task.origin)
      || !task.steps.some(step => step.tool === request.tool && step.status !== 'completed')) throw Error('approved_objective_scope_mismatch');
    if (task.parentTaskId) {
      const parentRow = await env.VETSA_CLOUD.prepare('SELECT agent FROM wa_melodi_brain_tasks WHERE id=? AND owner=?')
        .bind(task.parentTaskId,owner).first();
      const parent = parentRow && await brain.get({ owner,agent:parentRow.agent,id:task.parentTaskId });
      if (!parent || parent.scope !== 'team' || !['pending','running','waiting'].includes(parent.status)
        || !parent.receipts.some(receipt => receipt.tool === 'delegate_agent_event' && receipt.verified
          && receipt.status === 'delegated' && receipt.operationId === task.id)) throw Error('approved_objective_parent_mismatch');
    }
    if (checkContact && !await contactPolicy.permits(owner, `${task.objective}\n${JSON.stringify(input)}`)) throw Error('approved_objective_topic_excluded');
    return { identity,task,depth:payload.depth || 0 };
  }

  async function runApprovedAction(agent, event, wakeAgents = new Map()) {
    const pending = (await permissions.listPending(owner)).find(row => row.id === event.payload.approvalId);
    if (!pending) return;
    // Inspect only this encrypted approved request before claiming its one-use
    // grant. Calendar waiting never consumes or changes tool authorization.
    const approvedRow=await env.VETSA_CLOUD.prepare(`SELECT input_encrypted,input_iv FROM wa_melodi_permission_requests
      WHERE owner_phone=? AND id=? AND helper=? AND status='approved'`).bind(owner,pending.id,agent).first();
    let approvedState;
    if (approvedRow) {
      const decoded=await services.decrypt(approvedRow.input_encrypted,approvedRow.input_iv);
      const input=typeof decoded==='string' ? JSON.parse(decoded):decoded;
      if (input?.routine) {
        approvedState=await routineState(input.routine.id,input.routine.runKey);
        if (approvedState.active && approvedState.agent!==pending.requester) return;
        if (approvedState.active && approvedState.status!=='ready') {
          await store.deferRoutineEvent({owner,agent,eventId:event.id,leaseToken:event.leaseToken,
            routineId:input.routine.id,runKey:input.routine.runKey,retryAt:routineRetryAt(approvedState),now:clock()});
          return {deferred:true};
        }
      }
    }
    const grant = await permissions.claimApproved({ owner, approvalId: pending.id, helper: agent, eventKey: event.id });
    if (!grant.allowed) return;
    const request = grant.request;
    let objectiveAuthority = null;
    try {
      objectiveAuthority = await approvedObjective(request,request.input);
      if (request.input.routine && !await isRoutineActive(request.input.routine.id,request.input.routine.runKey)) throw new Error('routine_stopped');
      if (request.input.routine && approvedState) {
        request.input.routine=hydrateRoutine(request.input.routine,approvedState);
        if (request.tool==='prepare_document') request.input.title=clean(request.input.routine.title,160);
      }
      let result;
      if (request.input.ownerSkill) {
        if (!overrides.executeOwnerSkill) throw new Error('owner_skill_unavailable');
        result = await overrides.executeOwnerSkill({ helper: agent, input: request.input.ownerSkill });
        if (result?.ok !== true || !['accepted','queued','complete'].includes(result.status)) throw new Error('owner_skill_unverified');
      } else {
        const input = request.input;
        const ownerRequest = input.ownerRequest?.origin === 'owner_request' && input.ownerRequest.assignmentAgent === request.requester
          ? input.ownerRequest : null;
        const approvedServices = { ...tools,
          prepareDocument: args => services.prepareDocument({ ...args, agent: request.requester,
            assignmentAgent: request.requester, routineId: input.routine?.id, runKey: input.routine?.runKey,
            channel: ownerRequest && ['email', 'auto', 'whatsapp'].includes(ownerRequest.channel) ? ownerRequest.channel : input.routine?.channel || 'auto',
            ...(ownerRequest ? { origin: 'owner_request', sourceUrl: ownerRequest.sourceUrl } : {}),
            ...(objectiveAuthority ? { brainTaskId:objectiveAuthority.task.id } : {}), approvalId: request.id }),
          prepareStory: args => services.prepareStory({ ...args, agent: request.requester,
            ...(objectiveAuthority ? { origin:'owner_request',brainTaskId:objectiveAuthority.task.id } : {}), approvalId: request.id }),
          ...(objectiveAuthority ? { delegateAgentEvent:async args => {
            const parent = await brain.get(objectiveAuthority.identity);
            if (parent.scope !== 'team' || objectiveAuthority.depth >= 3) return {available:false,reason:'Límite de colaboración interna.'};
            const child = await brain.accept({owner,agent:args.target,eventId:`delegate:${args.eventId}:${args.target}`,
              objective:args.task,origin:'delegation',speaker:parent.speaker,parentTaskId:parent.id,
              requiredTools:parent.requiredTools.filter(tool=>({research_public_web:'melodi',research_public_marketing:'melodi',inspect_public_media:'melodi',
                prepare_document:'melodi',inspect_finances:'melodi',account_metrics:'melodi'})[tool]===args.target)});
            await store.enqueueEvent({owner,agent:args.target,eventKey:`brain:${child.id}`,type:'agent_objective',priority:20,
              payload:{brainTaskId:child.id,parentBrainTaskId:parent.id,depth:objectiveAuthority.depth+1,allowContact:false}});
            wakeAgents.set(args.target, 0);
            return {status:'delegated',eventId:child.id};
          } } : {}),
          ...(input.ownerRetry?.explicit === true && ['melodi'].includes(input.ownerRetry.agent) ? {
            retryOwnerJob: args => jobRetry.retry({ owner, jobId: args.jobId, agent: input.ownerRetry.agent,
              requestKey: input.ownerRetry.requestKey, explicit: true }),
          } : {}),
        };
        if (['research_public_marketing', 'inspect_public_media'].includes(request.tool) && ownerRequest && !objectiveAuthority) {
          const source = publicInstagramResearchUrl(ownerRequest.sourceUrl);
          if (!source || !ownerRequest.request || ownerRequest.request.agent !== request.requester) throw new Error('approved_research_invalid_scope');
          if (request.tool === 'inspect_public_media') {
            if (typeof services.extractPublicMedia !== 'function') throw new Error('approved_media_not_connected');
            const media = validatePublicMediaExtraction(await services.extractPublicMedia({ url: source.sourceUrl,
              agent: request.requester, ownerPhone: owner, eventId: ownerRequest.eventId, now: clock(),
              idempotencyKey: `public-media:${ownerRequest.eventId}` }), { url: source.sourceUrl });
            await store.enqueueEvent({ owner, agent: request.requester, eventKey: `requested-media-resume:${request.id}`, type: 'owner_research_report',
              payload: { request: ownerRequest.request, allowContact: false,
                ...(media.status === 'pending' ? { mediaOperation: { operationId: media.operationId,
                  startedAt: Date.parse(clock()), eventId: ownerRequest.eventId, approvalId: request.id } } : { approvedMedia: media }) }, priority: 20 });
            wakeAgents.set(request.requester, 0);
            result = { ok: true, status: media.status, receipt: { tool: request.tool, status: media.status, verified: media.verified } };
          } else {
          const research = typeof services.readPublicSource === 'function'
            ? await services.readPublicSource({ url: source.sourceUrl, agent, ownerPhone: owner, eventId: request.id, now: clock() })
            : await readPublicInstagramSource(env, { url: source.sourceUrl });
          await store.enqueueEvent({ owner, agent: request.requester, eventKey: `requested-research-resume:${request.id}`, type: 'owner_research_report',
            payload: { request: ownerRequest.request, approvedResearch: research, allowContact: false }, priority: 20 });
          wakeAgents.set(request.requester, 0);
          result = { ok: true, status: 'observed', receipt: { tool: request.tool, status: 'observed', verified: true } };
          }
        } else {
        const catalogTool = autonomyToolCatalog(agent, approvedServices).find(row => row.name === request.tool);
        const fields = Object.keys(catalogTool?.parameters?.properties || {});
        result = await executeAutonomyTool({ agent: request.tool === 'inspect_public_media' ? request.requester : agent,
          name: request.tool, input: Object.fromEntries(Object.entries(input).filter(([key]) => fields.includes(key))),
          ownerPhone: owner, eventId: grant.grant.idempotencyKey, now: clock(), goalScope: request.goal_scope || 'team' }, approvedServices);
        if (!result.ok) throw new Error('approved_tool_failed');
        if (request.tool === 'prepare_document' && result.receipt?.operationId) await references.register({ owner, type: 'job',
          id: result.receipt.operationId, agent: request.requester, status: 'pending' });
        if (request.tool === 'research_public_marketing' && input.routine) {
          await store.enqueueEvent({ owner, agent: request.requester, eventKey: `resume:${request.id}`, type: 'weekly_research',
            payload: { routine: input.routine, approvedResearch: result.data, allowContact: false }, priority: 8 });
        } else if (!input.routine && !ownerRequest && request.tool === 'inspect_public_media' && result.status === 'pending') {
          await store.enqueueEvent({ owner, agent: request.requester, eventKey: `media-collaboration-result:${request.id}`, type: 'public_media_poll',
            payload: { helper: agent, allowContact: false,
              pendingTool: { name: 'inspect_public_media', url: input.url, eventId: grant.grant.idempotencyKey,
                goalScope: request.goal_scope || 'team', originalType: 'collaboration_result', observations: [], receipts: [], approvalId: request.id },
              mediaOperation: { operationId: result.receipt.operationId, startedAt: Date.parse(clock()), eventId: grant.grant.idempotencyKey,
                approvalId: request.id } }, priority: 6 });
        } else if (!input.routine && !ownerRequest) {
          await store.enqueueEvent({ owner, agent: request.requester, eventKey: `collaboration-result:${request.id}`, type: 'collaboration_result',
            payload: { helper: agent, tool: request.tool, receipt: result.receipt, result: result.data, allowContact: true }, priority: 6 });
        }
        }
      }
      if (objectiveAuthority) {
        const operationKey = `${objectiveAuthority.task.id}:approval:${request.id}`;
        await brain.recordToolOutcome({...objectiveAuthority.identity,operationKey,tool:request.tool,result});
        if (result.receipt?.verified && result.data) await brain.remember({...objectiveAuthority.identity,
          fact:serializeAgentToolMemory(result.data),source:{kind:'tool',id:operationKey}});
        if (['observed','prepared','completed','sent'].includes(result.receipt?.status)) {
          await store.enqueueEvent({owner,agent:request.requester,eventKey:`brain-approved:${request.id}`,type:'agent_objective',priority:20,
            payload:{brainTaskId:objectiveAuthority.task.id,ownerRequested:true,allowContact:false}});
          wakeAgents.set(request.requester, 0);
        }
      }
      await permissions.finishApproval({ owner, approvalId: request.id, token: grant.grant.token, status: 'complete', receiptCode: result?.status === 'queued' ? 'job_queued' : result?.status === 'accepted' ? 'action_accepted' : 'verified_execution' });
      await references.setStatus({ owner, type: 'approval', id: request.id, status: 'completed' });
    } catch {
      await permissions.finishApproval({ owner, approvalId: request.id, token: grant.grant.token, status: 'failed', receiptCode: 'execution_failed' });
      await references.setStatus({ owner, type: 'approval', id: request.id, status: 'failed' });
      if (objectiveAuthority) {
        const task = await brain.get(objectiveAuthority.identity);
        if (task && !['completed','failed','cancelled'].includes(task.status)) {
          await brain.fail({...objectiveAuthority.identity,reason:'approved_tool_failed'});
          await notifyBrainBlock(await brain.get(objectiveAuthority.identity));
        }
      } else await store.enqueueOutbox({ owner, agent: request.requester, messageKey: `approval-failed:${request.id}`,
        payload: { body: `${name(request.requester)}: La colaboración aprobada no pudo terminarse. Puedes pedirme revisar el bloqueo o elegir otra opción.`, needsReply: false } });
    }
  }

  async function deliverOutbox({ calendarReady = true } = {}) {
    if (!active) return;
    await contactPolicy.ensureSchema();
    await store.recoverExpiredOutbox({ owner, now: clock() });
    const calendarDeferred = async outbox => !calendarReady && Boolean(outbox.payload.routineId
      || (outbox.payload.artifactJobId && (await services.privateJobInfo(owner,outbox.payload.artifactJobId))?.scheduledDelivery));
    const nextDirect = async agent => {
      if (calendarReady) return store.peekOutbox({ owner,agent,now:clock() });
      const rows = await env.VETSA_CLOUD.prepare(`SELECT id FROM wa_melodi_work_outbox
        WHERE owner=? AND agent=? AND status='pending' AND available_at<=? ORDER BY available_at,created_at,id LIMIT 100`)
        .bind(owner,agent,Date.parse(clock())).all();
      for (const row of rows.results || []) {
        const item = await store.peekOutbox({ owner,agent,outboxId:row.id,now:clock() });
        if (item && !await calendarDeferred(item)) return item;
      }
      return null;
    };
    const reservedForOther = (settings, agent) => Boolean((settings?.focus_agent && settings.focus_agent !== agent)
      || (settings?.conversation_agent && settings.conversation_agent !== agent && settings.conversation_until > clock()));
    const artifactAuthority = async (outbox, tracked, activeRoutines) => {
      if (outbox.payload.brainTaskId && !outbox.payload.approvalId && outbox.payload.ownerRequested && outbox.event_id) {
        const task = await brain.get({ owner, agent: outbox.agent, id: outbox.payload.brainTaskId });
        const event = await env.VETSA_CLOUD.prepare('SELECT type,status,payload_encrypted,payload_iv FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=?')
          .bind(outbox.event_id,owner,outbox.agent).first();
        if (task?.status === 'completed' && event?.type === 'agent_objective' && event.status === 'done') {
          const decoded = await services.decrypt(event.payload_encrypted,event.payload_iv);
          const payload = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
          if (payload.brainTaskId === task.id && !task.parentTaskId && outbox.payload.ownerRequestEventId === outbox.event_id) return { routine:false, requestedReply:true };
        }
        return { routine:false, requestedReply:false };
      }
      if (await googleCalendarInviteAuthority(env,outbox)) return {routine:false,requestedReply:true,whatsappRequired:true};
      if (outbox.payload.routineMessage === true && outbox.event_id) {
        const routine=activeRoutines.find(row=>row.id===outbox.payload.routineId && row.agent===outbox.agent
          && row.status==='active' && ['motivational_message','recurring_reminder'].includes(row.kind));
        const event=routine && await env.VETSA_CLOUD.prepare('SELECT type,status,payload_encrypted,payload_iv FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=?')
          .bind(outbox.event_id,owner,outbox.agent).first();
        if (event && routine && event.type===routine.kind && event.status==='done') {
          const decoded=await services.decrypt(event.payload_encrypted,event.payload_iv);
          const payload=typeof decoded==='string' ? JSON.parse(decoded):decoded;
          if (payload.routine?.id===routine.id && payload.routine?.runKey===outbox.payload.routineRunKey) {
            if (routine.kind === 'motivational_message') {
              const state = await routineState(routine.id, outbox.payload.routineRunKey);
              const zone = env.TIME_ZONE || 'America/Santo_Domingo';
              if (!state.active || !state.startAt || clockContext(state.startAt,zone).today_local !== clockContext(clock(),zone).today_local) {
                return { routine: false, requestedReply: false };
              }
            }
            return {routine:true,requestedReply:routine.kind==='recurring_reminder'};
          }
        }
        return {routine:false,requestedReply:false};
      }
      if (outbox.payload.approvalId && outbox.payload.ownerRequested === true && outbox.event_id) {
        const approval = (await permissions.listPending(owner)).find(row => row.id === outbox.payload.approvalId
          && row.helper === outbox.agent && row.status === 'pending' && row.parent_event_id === outbox.event_id);
        const event = approval && await env.VETSA_CLOUD.prepare('SELECT type,status,payload_encrypted,payload_iv FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=?')
          .bind(outbox.event_id, owner, approval.requester).first();
        if (event?.status === 'done' && outbox.payload.ownerRequestEventId === outbox.event_id) {
          if (event.type === 'owner_research_report') return { routine: false, requestedReply: true };
          if (event.type === 'agent_objective' && outbox.payload.brainTaskId) {
            const decoded = await services.decrypt(event.payload_encrypted,event.payload_iv);
            const payload = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
            const task = await brain.get({owner,agent:approval.requester,id:outbox.payload.brainTaskId});
            if (payload.brainTaskId === task?.id && ['waiting','running'].includes(task.status)
              && task.blocker === 'authorization_required') return {routine:false,requestedReply:true};
          }
        }
      }
      if (!outbox.payload.artifactJobId && outbox.payload.ownerRequested === true && outbox.event_id) {
        const event = await env.VETSA_CLOUD.prepare("SELECT owner,agent,type,status FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=?")
          .bind(outbox.event_id, owner, outbox.agent).first();
        if (event?.type === 'owner_research_report' && event.status === 'done' && outbox.payload.ownerRequestEventId === outbox.event_id)
          return { routine: false, requestedReply: true };
      }
      const job = tracked.find(row => row.status === 'enqueued' && row.agent === outbox.agent && row.outbox_id === outbox.id
        && row.job_id === outbox.payload.artifactJobId && (row.routine_id || null) === (outbox.payload.routineId || null)
        && row.channel === (outbox.payload.channel || 'auto'));
      if (!job) return { routine: false, requestedReply: false };
      const routine = Boolean(job.routine_id && activeRoutines.some(row => row.id === job.routine_id
        && row.agent === job.agent && row.status === 'active'));
      let requestedReply = false;
      if (outbox.payload.ownerRequested === true && !job.routine_id) {
        const privateJob = await services.privateJobInfo(owner, job.job_id);
        requestedReply = privateJob?.origin === 'owner_request' && privateJob.agent === job.agent
          && privateJob.row?.id === job.job_id && privateJob.row?.owner_phone === owner && privateJob.row?.status === 'complete';
      }
      return { routine, requestedReply };
    };
    const pendingApprovals = await permissions.listPending(owner);
    const tracked = await artifacts.listPending({ owner, limit: 200 });
    const activeRoutines = await routines.list(owner);
    // Retire unsent chatter left by older releases. A model's ownerRequested
    // flag alone cannot turn a generic proposal into a requested response.
    const legacy = await env.VETSA_CLOUD.prepare(`SELECT id,agent FROM wa_melodi_work_outbox
      WHERE owner=? AND status='pending' AND available_at<=? ORDER BY created_at,id LIMIT 100`).bind(owner, Date.parse(clock())).all();
    for (const row of legacy.results || []) {
      const item = await store.peekOutbox({ owner, agent: row.agent, outboxId: row.id, now: clock() });
      if (!item) continue;
      if (await calendarDeferred(item)) continue;
      const verified = await artifactAuthority(item, tracked, activeRoutines);
      if ((!verified.requestedReply && !verified.routine) || !await contactPolicy.permits(owner, item.payload.body)) {
        // An outbox may be committed just before its parent event completes.
        // Do not race that legitimate transition into an irreversible failure.
        const parent = item.payload.ownerRequested && item.event_id && await env.VETSA_CLOUD.prepare('SELECT type,status FROM wa_melodi_work_events WHERE id=? AND owner=?')
          .bind(item.event_id, owner).first();
        if (['owner_research_report','agent_objective'].includes(parent?.type) && ['pending','processing','waiting'].includes(parent.status)) continue;
        await env.VETSA_CLOUD.prepare(`UPDATE wa_melodi_work_outbox SET status='failed',error_code=?,updated_at=?
          WHERE id=? AND owner=? AND agent=? AND status='pending'`).bind(item.payload.routineId ? 'cancelled' : 'unsolicited_contact_blocked', Date.parse(clock()), item.id, owner, item.agent).run();
      }
    }
    const plans = [];
    for (const agent of IDS) {
      const settings = await coordinator.settings(owner);
      if (!settings?.enabled) return;
      const reserved = reservedForOther(settings, agent);
      const inWindow = contactWindow(clock(), settings.notification_start, settings.notification_end);
      let candidate = null, authority = { routine: false, requestedReply: false }, collaborationMessage = false;
      if (agent==='melodi' && env.GOOGLE_CALENDAR_INVITE_REV) {
        const invite=await store.peekOutbox({owner,agent,messageKey:googleCalendarInviteKey(env),now:clock()});
        if (invite && await googleCalendarInviteAuthority(env,invite)) {candidate=invite;authority={routine:false,requestedReply:true,whatsappRequired:true};}
      }
      const direct = await nextDirect(agent);
      if (direct && !candidate) {
        const verified = await artifactAuthority(direct, tracked, activeRoutines);
        if (verified.requestedReply || (leaderConversationEnabled(env) && verified.routine && direct.payload.routineMessage && inWindow)) {
          candidate = direct; authority = verified;
        }
      }
      if (!candidate && leaderConversationEnabled(env) && inWindow) {
        const dueRoutine = await env.VETSA_CLOUD.prepare(`SELECT o.id FROM wa_melodi_work_outbox o
          JOIN wa_melodi_work_events e ON e.id=o.event_id AND e.owner=o.owner AND e.agent=o.agent
          WHERE o.owner=? AND o.agent=? AND o.status='pending' AND o.available_at<=?
            AND e.type IN ('motivational_message','recurring_reminder') AND e.status='done'
          ORDER BY o.created_at,o.id LIMIT 20`).bind(owner,agent,Date.parse(clock())).all();
        for (const row of dueRoutine.results || []) {
          const item = await store.peekOutbox({ owner, agent, outboxId: row.id, now: clock() });
          if (!item?.payload.routineMessage) continue;
          const verified = await artifactAuthority(item,tracked,activeRoutines);
          if (verified.routine) { candidate = item; authority = verified; break; }
        }
      }
      // Source failures are requested replies too, although no artifact job
      // exists. Locate their exact completed owner event past older chatter.
      if (!authority.requestedReply) {
        const requested = await env.VETSA_CLOUD.prepare(`SELECT o.id FROM wa_melodi_work_outbox o
          JOIN wa_melodi_work_events e ON e.id=o.event_id AND e.owner=o.owner AND e.agent=o.agent
          WHERE o.owner=? AND o.agent=? AND o.status='pending' AND o.available_at<=?
            AND e.type='owner_research_report' AND e.status='done'
          ORDER BY o.created_at,o.id LIMIT 20`).bind(owner, agent, Date.parse(clock())).all();
        for (const row of requested.results || []) {
          const item = await store.peekOutbox({ owner, agent, outboxId: row.id, now: clock() });
          if (!item) continue;
          const verified = await artifactAuthority(item, tracked, activeRoutines);
          if (verified.requestedReply) { candidate = item; authority = verified; break; }
        }
      }
      // A direct response has priority over older spontaneous conversation and
      // is authorized by the private job's origin, never by a model flag alone.
      for (const job of tracked.filter(row => row.agent === agent && row.status === 'enqueued' && row.outbox_id)) {
        if (authority.whatsappRequired) break;
        const item = await store.peekOutbox({ owner, agent, outboxId: job.outbox_id, now: clock() });
        if (!item) continue;
        if (await calendarDeferred(item)) continue;
        const verified = await artifactAuthority(item, tracked, activeRoutines);
        if (verified.requestedReply) { candidate = item; authority = verified; break; }
        if (!candidate && verified.routine && inWindow && reserved) { candidate = item; authority = verified; }
      }
      if (!authority.requestedReply) {
        for (const request of pendingApprovals.filter(row => row.helper === agent && row.status === 'pending')) {
          const item = await store.peekOutbox({ owner, agent, messageKey: `approval:${request.id}`, now: clock() });
          if (item?.payload.approvalId === request.id) {
            const verified = await artifactAuthority(item, tracked, activeRoutines);
            if (verified.requestedReply) { candidate = item; authority = verified; collaborationMessage = true; break; }
          }
        }
      }
      if (!candidate && inWindow && !reserved) {
        candidate = await nextDirect(agent);
        if (candidate) authority = await artifactAuthority(candidate, tracked, activeRoutines);
      }
      if (!candidate || await calendarDeferred(candidate) || (!authority.requestedReply && !authority.routine) || (!inWindow && !authority.requestedReply)) continue;
      const exception = collaborationMessage || authority.routine || authority.requestedReply;
      if (reserved && !exception) continue;
      plans.push({ agent, candidate, authority, collaborationMessage });
    }
    plans.sort((a, b) => Number(b.authority.requestedReply) - Number(a.authority.requestedReply));
    for (const plan of plans) {
      const { agent, candidate, authority } = plan;
      const token = await coordinator.claimContact(owner, agent, clock(), {
        collaboration: plan.collaborationMessage || authority.routine || authority.requestedReply,
        requestedReply: authority.requestedReply,
      });
      if (!token) continue;
      const outbox = await store.claimOutbox({ owner, agent, outboxId: candidate.id, requestedReply: authority.requestedReply, now: clock() });
      if (!outbox) { await coordinator.finishContact(owner, token, { now: clock() }); continue; }
      let delivered = false, uncertain = false, deliveredByEmail = false, emailReceipt = null, contactReceipt = null;
      try {
        const latestApprovals = await permissions.listPending(owner);
        const collaborationMessage = Boolean(outbox.payload.approvalId && latestApprovals.some(row =>
          row.id === outbox.payload.approvalId && row.helper === agent && row.status === 'pending'));
        const verified = await artifactAuthority(outbox, await artifacts.listPending({ owner, limit: 200 }), await routines.list(owner));
        const latestCoordination = await coordinator.settings(owner);
        const reserved = reservedForOther(latestCoordination, agent);
        if ((!verified.requestedReply && !verified.routine) || !await contactPolicy.permits(owner, outbox.payload.body)) {
          await store.finishOutbox({ id: outbox.id, leaseToken: outbox.leaseToken, status: 'failed', errorCode: 'unsolicited_contact_blocked', now: clock() });
          continue;
        }
        if (!latestCoordination?.enabled || (!contactWindow(clock(), latestCoordination.notification_start, latestCoordination.notification_end) && !verified.requestedReply)
          || (!collaborationMessage && reserved && !verified.routine && !verified.requestedReply)) {
          await store.finishOutbox({ id: outbox.id, leaseToken: outbox.leaseToken, status: 'pending',
            errorCode: 'conversation_reserved', retryAt: Date.parse(clock()) + 45 * 60000, now: clock() });
          continue;
        }
        let routineReminderBody = null;
        if (outbox.payload.routineId) {
          const runKey=outbox.payload.routineRunKey || (await services.privateJobInfo(owner,outbox.payload.artifactJobId))?.runKey;
          const state=await routineState(outbox.payload.routineId,runKey);
          if (state.active && state.status!=='ready') {
            await store.deferRoutineOutbox({owner,agent,id:outbox.id,leaseToken:outbox.leaseToken,
              routineId:outbox.payload.routineId,runKey,retryAt:routineRetryAt(state),now:clock()});continue;
          }
          if (!state.active || (outbox.payload.routineMessage && (!verified.routine || Date.parse(clock())-Date.parse(state.startAt)>=86400000))) {
            await store.finishOutbox({id:outbox.id,leaseToken:outbox.leaseToken,status:'failed',errorCode:'cancelled',now:clock()});continue;
          }
          if (outbox.payload.routineMessage && activeRoutines.find(item => item.id === outbox.payload.routineId)?.kind === 'recurring_reminder') {
            routineReminderBody = await contextualRoutineReminderMessage(env, {
              id: outbox.payload.routineId, runKey: outbox.payload.routineRunKey, title: state.title, startAt: state.startAt,
            }, { services, now: Date.parse(clock()) });
            if (!routineReminderBody) {
              await store.finishOutbox({ id: outbox.id, leaseToken: outbox.leaseToken, status: 'failed', errorCode: 'cancelled', now: clock() });
              continue;
            }
          }
        }
        if (outbox.payload.artifactJobId && (await services.privateJobInfo(owner,outbox.payload.artifactJobId))?.scheduledDelivery) {
          const state = await documentDeliveryState(env,owner,outbox.payload.artifactJobId,Date.parse(clock()),true);
          if (!state.active || state.status !== 'ready') {
            await store.finishOutbox({id:outbox.id,leaseToken:outbox.leaseToken,status:state.active ? 'pending' : 'failed',
              errorCode:state.active ? 'document_deferred' : 'cancelled',retryAt:state.retryAt || Date.parse(clock())+60000,now:clock()});
            continue;
          }
        }
        if (outbox.payload.approvalId && !collaborationMessage) {
          await store.finishOutbox({ id: outbox.id, leaseToken: outbox.leaseToken, status: 'failed', errorCode: 'cancelled', now: clock() });
          continue;
        }
        if (verified.whatsappRequired && (await createGoogleCalendarStore(env).getConnection(owner))?.status==='connected') {
          await store.finishOutbox({id:outbox.id,leaseToken:outbox.leaseToken,status:'failed',errorCode:'calendar_already_connected',now:clock()});continue;
        }
        const envelope = await ownerMessage(agent, safeAgentAnswer(clean(verified.whatsappRequired ? await freshGoogleCalendarInviteBody(env) : routineReminderBody || outbox.payload.body, 3000)));
        const body = envelope.body;
        contactReceipt = await contactPolicy.claimDelivery({ owner, body,
          scope: outbox.payload.artifactJobId || outbox.payload.routineRunKey || outbox.event_id || outbox.id });
        if (!contactReceipt) {
          await store.finishOutbox({ id: outbox.id, leaseToken: outbox.leaseToken, status: 'failed', errorCode: 'duplicate_contact_blocked', now: clock() });
          continue;
        }
        // Explicit reports/documents may arrive by email without taking over
        // the private WhatsApp conversation assigned to another teammate.
        const leaderRoutine = leaderConversationEnabled(env) && verified.routine && outbox.payload.routineMessage;
        deliveredByEmail = !verified.whatsappRequired && (outbox.payload.channel === 'email'
          || (reserved && (verified.routine || verified.requestedReply) && !leaderRoutine));
        try {
          if (deliveredByEmail) {
            const sent = await services.emailOwner(owner, `autonomy-${outbox.id}`, agent, body, outbox.payload.artifactJobId || null);
            emailReceipt = sent;
            delivered = sent?.status === 'sent'; uncertain = !delivered;
          } else if (outbox.payload.artifactJobId) { const sent=await services.deliverArtifact(owner, outbox.payload.artifactJobId, body);if(leaderConversationEnabled(env)&&(!sent?.messageId||sent.status!=='sent'))throw Error('artifact_delivery_receipt_missing');delivered = true; }
          else {const sent=await overrides.sendText(env, owner, body,{agent:envelope.speaker});if(leaderConversationEnabled(env)&&(!sent?.messageId||sent.status!=='sent'))throw Error('message_delivery_receipt_missing');}
          if (!deliveredByEmail) delivered = true;
        } catch (error) {
          if (verified.whatsappRequired) throw error;
          if (!/131047/.test(String(error?.message || ''))) throw error;
          const sent = await services.emailOwner(owner, `autonomy-${outbox.id}`, agent, body, outbox.payload.artifactJobId || null);
          emailReceipt = sent;
          deliveredByEmail = true;
          delivered = sent?.status === 'sent';
          uncertain = !delivered;
        }
        if (delivered && deliveredByEmail) {
          const recipient = emailReceipt?.recipient ? ` a ${emailReceipt.recipient}` : '';
          const sender = emailReceipt?.sender ? ` desde ${emailReceipt.sender}` : '';
          await notices.enqueue({ owner, key: `email-confirmed:autonomy-${outbox.id}`, agent,
            body: `${name(agent)}: Envié ${outbox.payload.artifactJobId ? 'el documento' : 'el mensaje'} por correo${recipient}${sender}.`,
            ownerRequested: verified.requestedReply, artifactJobId: outbox.payload.artifactJobId || null });
        } else if (uncertain && verified.requestedReply) {
          await notices.enqueue({ owner, key: `delivery-review:${outbox.id}`, agent,
            body: `${name(agent)}: El envío quedó pendiente de verificación. Todavía no tengo confirmación de la entrega y evitaré repetirlo mientras se revisa.`,
            ownerRequested: true, artifactJobId: outbox.payload.artifactJobId || null });
        }
        await store.finishOutbox({ id: outbox.id, leaseToken: outbox.leaseToken, status: delivered ? 'sent' : 'uncertain', now: clock() });
        await contactPolicy.finishDelivery({ owner, ...contactReceipt, status: delivered ? 'sent' : 'uncertain' });
        if (delivered && outbox.payload.brainTaskId && outbox.payload.artifactJobId) await env.VETSA_CLOUD.prepare(`UPDATE wa_melodi_artifact_tracking SET status='delivered',delivered_at=?,updated_at=?
          WHERE owner=? AND job_id=? AND status IN ('pending','claiming','enqueued')
          AND EXISTS(SELECT 1 FROM wa_melodi_work_outbox WHERE id=? AND owner=? AND status='sent')`)
          .bind(Date.parse(clock()),Date.parse(clock()),owner,outbox.payload.artifactJobId,outbox.id,owner).run();
        if (delivered && outbox.payload.artifactJobId && (await services.privateJobInfo(owner,outbox.payload.artifactJobId))?.scheduledDelivery)
          await completeDocumentSchedule(env,owner,outbox.payload.artifactJobId);
        if (delivered && outbox.payload.approvalId) await control({ action: 'approval_notified', approvalId: outbox.payload.approvalId });
        if (delivered && overrides.recordTurn && !deliveredByEmail) await overrides.recordTurn(env, owner, 'assistant', body);
        if (delivered) await coordinator.remember(owner, envelope.speaker, body, clock(), 'assistant');
      } catch (error) {
        // Transport timeouts can be accepted remotely. Keep them uncertain;
        // only an explicit provider rejection is safe to retry automatically.
        const rejected = /returned (?:400|401|403|422|429)|131047|artifact_not_complete|artifact_missing/.test(String(error?.message || ''));
        uncertain = !rejected;
        if (contactReceipt) await contactPolicy.finishDelivery({ owner, ...contactReceipt, status: rejected ? 'rejected' : 'uncertain' });
        await store.finishOutbox({ id: outbox.id, leaseToken: outbox.leaseToken, status: rejected ? 'pending' : 'uncertain',
          errorCode: rejected ? 'provider_rejected' : 'delivery_uncertain', retryAt: Date.parse(clock()) + 30 * 60000, now: clock() });
        if (authority.requestedReply) await notices.enqueue({ owner, key: `delivery-review:${outbox.id}`, agent,
          body: `${name(agent)}: ${rejected ? 'El servicio rechazó la entrega del encargo. Necesito resolver ese fallo para enviártelo.' : 'No pude confirmar la entrega del encargo. El envío quedó en revisión para evitar repetirlo.'}`,
          ownerRequested: true, artifactJobId: outbox.payload.artifactJobId || null });
      } finally {
        await coordinator.finishContact(owner, token, { delivered: delivered || uncertain,
          needsReply: delivered && !deliveredByEmail && (outbox.payload.needsReply
            || (!authority.requestedReply && !authority.routine && !plan.collaborationMessage)), now: clock() });
      }
      if (delivered || uncertain) break; // Only one owner conversation at a time.
    }
    await deliverNotices({calendarReady});
  }

  async function deliverNotices({calendarReady=true}={}) {
    if (!active || !owner || typeof overrides.sendText !== 'function') return;
    await contactPolicy.ensureSchema();
    for (const candidate of await notices.peek({ owner, now: clock(), limit: 10, ownerRequested: true })) {
      if (!IDS.includes(candidate.agent) && candidate.agent !== 'melodi') continue;
      if (!candidate.ownerRequested) continue;
      if(!calendarReady){
        const row=await env.VETSA_CLOUD.prepare('SELECT payload_encrypted,payload_iv FROM wa_melodi_delivery_notices WHERE owner=? AND id=?').bind(owner,candidate.id).first();
        if(!row)continue;
        const decoded=await services.decrypt(row.payload_encrypted,row.payload_iv);
        const payload=typeof decoded==='string'?JSON.parse(decoded):decoded;
        if(payload.calendarReminder || payload.screenshotReminder)continue;
      }
      const settings = candidate.agent === 'melodi' ? await coordinator.settings(owner) : null;
      const contactAgent = candidate.agent === 'melodi' ? settings?.conversation_agent || 'melodi' : candidate.agent;
      const token = await coordinator.claimContact(owner, contactAgent, clock(), {
        collaboration: candidate.ownerRequested, requestedReply: candidate.ownerRequested,
      });
      if (!token) continue;
      let delivered = false, uncertain = false;
      try {
        const [notice] = await notices.claim({ owner, id: candidate.id, now: clock(), limit: 1 });
        if (!notice) continue;
        if (notice.calendarReminder && !await calendarReminderCurrent(env, owner, notice.calendarReminder, Date.parse(clock()))) {
          await notices.finish({ owner, id: notice.id, token: notice.token, status: 'uncertain', now: clock() });
          continue;
        }
        if (notice.screenshotReminder && !await screenshotReminderCurrent(env,owner,notice.screenshotReminder,{now:Date.parse(clock())})) {
          await notices.finish({owner,id:notice.id,token:notice.token,status:'uncertain',now:clock()}); continue;
        }
        const noticeBody = notice.calendarReminder
          ? await contextualCalendarReminderMessage(env, notice.calendarReminder, { now: Date.parse(clock()) })
          : notice.screenshotReminder ? await currentScreenshotReminderMessage(env,owner,notice.screenshotReminder,{now:Date.parse(clock())}) : notice.body;
        if (!noticeBody || !await contactPolicy.permits(owner, noticeBody)) {
          await notices.finish({ owner, id: notice.id, token: notice.token, status: 'uncertain', now: clock() });
          continue;
        }
        try {
          const envelope = await ownerMessage(notice.agent, noticeBody);
          const receipt = await overrides.sendText(env, owner, envelope.body, { agent: envelope.speaker });
          if (leaderConversationEnabled(env) && (receipt?.status !== 'sent' || !receipt?.messageId)) throw Error('notice_delivery_receipt_missing');
          delivered = true;
          const confirmed = await notices.finish({ owner, id: notice.id, token: notice.token, status: 'sent', now: clock() });
          if (confirmed && notice.calendarReminder) await confirmCalendarReminder(env, owner, notice.calendarReminder, Date.parse(clock()));
          if (confirmed && notice.screenshotReminder) await confirmScreenshotReminder(env,owner,notice.screenshotReminder,{now:Date.parse(clock())});
          if (IDS.includes(envelope.speaker)) await coordinator.remember(owner, envelope.speaker, envelope.body, clock(), 'assistant');
        } catch (error) {
          const text = String(error?.message || '');
          const closed = /131047/.test(text);
          const rejected = /returned (?:400|401|403|422|429)/.test(text);
          uncertain = !closed && !rejected;
          await notices.finish({ owner, id: notice.id, token: notice.token,
            status: closed ? 'window_closed' : rejected ? 'pending' : 'uncertain', now: clock() });
        }
      } finally {
        await coordinator.finishContact(owner, token, { delivered: delivered || uncertain, now: clock() });
      }
      if (delivered || uncertain) break;
    }
  }

  async function control({ action, type, agent, goal, messageId, level, approvalId, approvalReference, approved, contextual,
    routine, routineId, routineReference, routineKind, tool, input, request, eventId, receiptSent = false, jobId, jobReference, latest, recentIds, targetAgent,
    topic, blocked, unsolicited, objective, requiredTools, taskId }) {
    action ||= type;
    await initialize();
    if (action === 'contact_preference') {
      await contactPolicy.update(owner, { topic, blocked, unsolicited });
      return topic ? blocked
        ? `Guardé tu preferencia: no volveré a proponerte ni investigar por iniciativa propia el tema «${topic}». Solo lo retomaré si me lo pides expresamente.`
        : `Podemos retomar «${topic}» cuando me indiques un encargo concreto.`
        : 'Solo te escribiré para responder a tus encargos, entregar resultados comprobados o cumplir los avisos que hayas solicitado.';
    }
    if (agent && !IDS.includes(agent)) throw new Error('unknown_team_agent');
    if (action === 'cancel_objective') {
      const candidates = (await Promise.all((agent ? [agent] : IDS).map(member => brain.list({ owner,agent:member,limit:50 })))).flat()
        .filter(task => !task.parentTaskId && !['completed','failed','cancelled'].includes(task.status) && (!taskId || task.id === taskId));
      if (!candidates.length) return 'No encontré un encargo activo que coincida. No cambié otros trabajos.';
      if (candidates.length !== 1) return `Hay varios encargos activos. Indica cuál: ${candidates.map(task=>`«${clean(task.objective,100)}»`).join('; ')}.`;
      const task = candidates[0];
      await brain.cancel({ owner,agent:task.agent,id:task.id });
      for (const member of IDS) for (const child of await brain.list({ owner,agent:member,limit:50 })) {
        if (child.parentTaskId === task.id && !['completed','failed','cancelled'].includes(child.status)) await brain.cancel({ owner,agent:member,id:child.id });
      }
      return 'Detuve el encargo y su colaboración pendiente. Una operación externa que ya hubiera comenzado necesita confirmar su estado antes de poder detenerse.';
    }
    if (action === 'objective_request') {
      agent ||= 'melodi';
      const requestId = messageId || eventId;
      if (typeof objective !== 'string' || !objective.trim() || objective.length > 4000 || typeof requestId !== 'string' || !requestId
        || !Array.isArray(requiredTools) || !requiredTools.length) throw new Error('owner_objective_invalid');
      if (!await contactPolicy.permits(owner, objective)) return { status: 'blocked', agent,
        acknowledgement: 'Ese tema sigue excluido por tu preferencia. Si quieres retomarlo, indícamelo expresamente.' };
      const speaker = await currentOwnerSpeaker(env, owner, new Date(clock())) || agent;
      const requiredAgents=[];
      const task = await brain.accept({ owner, agent, requestId, objective, origin: 'owner_request', speaker, requiredTools,requiredAgents });
      const queued = await store.enqueueEvent({ owner, agent, eventKey: `brain:${task.id}`, type: 'agent_objective',
        payload: { brainTaskId: task.id, objective, ownerRequested: true, speakerAgent: speaker, allowContact: false }, priority: 20 });
      await env.MELODI_JOBS.send({ type: 'autonomy_agent', agent });
      return { status: 'queued', agent, taskId: task.id, eventId: queued.id,
        acknowledgement: `${name(speaker)}: Registré tu encargo y lo puse en cola. Te comunicaré el resultado cuando las herramientas lo confirmen.` };
    }
    if (targetAgent && !IDS.includes(targetAgent)) throw new Error('unknown_team_agent');
    if (action === 'task_progress' || action === 'task_progress' && targetAgent) {
      const tasks = (await Promise.all((targetAgent || agent ? [targetAgent || agent] : IDS).map(member => brain.list({ owner,agent:member,limit:10 })))).flat()
        .filter(task=>!task.parentTaskId).sort((a,b)=>b.updatedAt-a.updatedAt);
      if (tasks.length) {
        const task=tasks[0], finished=task.steps.filter(step=>step.status==='completed').length;
        const state=({pending:'Está en cola.',running:'Está ejecutando el plan.',waiting:'Está esperando un resultado o una acción necesaria.',completed:'Los pasos de ejecución están verificados; la entrega se confirma por separado.',failed:'La ejecución quedó bloqueada y no se ha dado por completada.',cancelled:'Está detenido.'})[task.status];
        return `${name(agent || 'melodi')}: ${clean(task.objective,350)}\n${state}${task.steps.length ? ` Pasos comprobados: ${finished} de ${task.steps.length}.` : ''}`;
      }
      return targetAgent ? agentWorkStatus(targetAgent, agent || 'melodi') : taskProgress(agent);
    }
    if (action === 'research_request') {
      const source = publicInstagramResearchUrl(request?.sourceUrl);
      const messageKey = eventId || messageId;
      if (!agent || request?.agent !== agent || request.recipient !== 'owner' || !source || source.scope !== request.scope
        || !['auto', 'email', 'whatsapp'].includes(request.channel) || typeof messageKey !== 'string' || !messageKey) throw new Error('owner_research_request_invalid');
      const bounded = { agent, sourceUrl: source.sourceUrl, scope: source.scope, recipient: 'owner', channel: request.channel,
        format: 'pdf', origin: 'owner_request', brief: clean(request.brief, 12000),
        includeTutorial: request.includeTutorial === true, includeAllFormats: request.includeAllFormats === true };
      const queued = await store.enqueueEvent({ owner, agent, eventKey: `owner-research:${messageKey}`, type: 'owner_research_report',
        payload: { request: bounded, allowContact: false }, priority: 20 });
      if (receiptSent) {
        try { await env.MELODI_JOBS.send({ type: 'autonomy_agent', agent }); }
        catch { console.error(JSON.stringify({ event: 'owner_research_dispatch_deferred', agent })); }
      }
      return { status: 'queued', agent, eventId: queued.id,
        acknowledgement: `${name(agent)}: Recibí tu encargo. Revisaré esa publicación y prepararé el informe con los formatos verificables${bounded.includeTutorial ? ' y cómo realizarlos' : ''}${bounded.channel === 'email' ? ' para enviártelo por correo' : ''}.` };
    }
    if (action === 'retry_job') {
      let selected;
      if (jobReference || jobId) {
        const reference = await references.resolve({ owner, type: 'job', reference: jobReference || jobId });
        if (reference.status === 'ambiguous') return `Indica un trabajo: ${reference.candidates.map(row => row.shortRef).join(', ')}.`;
        if (reference.status === 'resolved') jobId = reference.id;
        else if (jobReference) return 'No encontré ese trabajo entre tus encargos.';
        selected = await jobRetry.select({ owner, jobId });
      } else selected = await jobRetry.select({ owner, agent, latest: latest !== false, recentIds });
      if (selected.status === 'ambiguous') {
        const retryable = selected.candidates.filter(row => row.retryable);
        const refs = await Promise.all(retryable.map(row => references.register({ owner, type: 'job', id: row.jobId, agent: row.agent, status: row.status })));
        return refs.length ? `Indica cuál reintentar: ${refs.map(row => row.shortRef).join(', ')}.` : 'Los trabajos encontrados necesitan revisar el bloqueo antes de repetirlos.';
      }
      if (selected.status !== 'selected') return 'No encontré un trabajo fallido de esa agente para reintentar.';
      const ref = await references.register({ owner, type: 'job', id: selected.jobId, agent: selected.job.agent, status: selected.job.status });
      if (!selected.job.retryable) return selected.job.reason === 'already_processing' || selected.job.reason === 'already_pending'
        ? `El trabajo ${ref.shortRef} ya está en curso; no lo duplicaré.`
        : `El trabajo ${ref.shortRef} necesita resolver el bloqueo antes de repetirlo. Un problema de acceso, créditos, datos o entrega incierta no se soluciona reintentando.`;
      const requester = agent || (IDS.includes(selected.job.agent) ? selected.job.agent : 'melodi');
      const retryInput = { jobId: selected.jobId, ownerRetry: { explicit: true, agent: selected.job.agent, requestKey: `owner-retry:${messageId || eventId}` } };
      if (!messageId && !eventId) throw new Error('owner_retry_message_required');
      const authority = await requestTool(requester, 'retry_owner_job', retryInput, `owner-retry:${messageId || eventId}`, null, 'team', false);
      if (!authority.allowed) {
        if (authority.waitingApproval) {
          await coordinator.recordOwnerReply(owner, authority.waitingApproval.helper, clock());
          return { allowed: false, approvalId: authority.waitingApproval.id, response: await approvalBody(authority.waitingApproval) };
        }
        return `${name(requester)}: No tengo permiso para reintentar ${ref.shortRef} y ninguna integrante dispone del nivel necesario.`;
      }
      const retried = await jobRetry.retry({ owner, jobId: selected.jobId, agent: selected.job.agent,
        requestKey: retryInput.ownerRetry.requestKey, explicit: true });
      if (retried.status === 'queued') {
        await references.setStatus({ owner, type: 'job', id: selected.jobId, status: 'pending' });
        return `${name(requester)}: Reanudé ${ref.shortRef}, conservando el encargo y su agente original. Está pendiente de terminar.`;
      }
      if (retried.status === 'pending') return `${name(requester)}: ${ref.shortRef} ya está pendiente o programado para su reintento; no creé otro encargo.`;
      return `${name(requester)}: ${ref.shortRef} no pudo reintentarse. Hay que revisar su bloqueo antes de continuar.`;
    }
    if (action === 'stop_job') return 'No cambié ese trabajo. Para detener la iniciativa de una agente puedes pausarla; detener un trabajo ya en ejecución requiere comprobar su estado.';
    if (action === 'selected' || action === 'praise') {
      const result = await permissions.reward({ owner, agent, kind: action === 'praise' ? 'praised' : 'selected', eventKey: `${action}:${messageId}` });
      return `${name(agent)}: ${action === 'praise' ? 'Gracias por el visto bueno. ' : ''}Estoy en el nivel ${result.agent.level}, con ${result.agent.xp} puntos de progreso${result.agent.nextLevelXp ? ` de ${result.agent.nextLevelXp}` : ''}.`;
    }
    if (action === 'set_level' || action === 'lower_level') {
      const current = (await permissions.getTeam(owner)).find(row => row.agent === agent);
      if (action === 'lower_level' && level == null) level = Math.max(0, current.level - 1);
      if (!Number.isInteger(level) || level < 0 || level > 10) return 'El nivel debe estar entre 0 y 10.';
      await permissions.adjustLevel({ owner, agent, level, eventKey: `level:${messageId}` });
      return `Dejé a ${name(agent)} en nivel ${level}. Sus permisos se ajustaron y anulé las colaboraciones pendientes afectadas.`;
    }
    if (action === 'authorize_skill') {
      const authority = await requestTool(agent, tool, input, `owner-skill:${messageId}`, null, 'team', false);
      if (authority.allowed) return { allowed: true };
      if (authority.waitingApproval) {
        await coordinator.recordOwnerReply(owner, authority.waitingApproval.helper, clock());
        return { allowed: false, approvalId: authority.waitingApproval.id, response: await approvalBody(authority.waitingApproval) };
      }
      return { allowed: false, response: 'No pude verificar el permiso para esa acción. Conservé tu encargo sin ejecutarlo.' };
    }
    if (action === 'approval_notified') {
      await env.VETSA_CLOUD.prepare(`UPDATE wa_melodi_permission_requests SET receipt_code='approval_notified',updated_at=?
        WHERE owner_phone=? AND id=? AND status='pending'`).bind(Date.parse(clock()),owner,approvalId).run();
      return null;
    }
    if (action === 'approval') {
      const candidates = (await permissions.listPending(owner)).filter(row => row.status === 'pending');
      const shortCandidates = await Promise.all(candidates.map(row => references.register({ owner, type: 'approval', id: row.id, agent: row.requester, status: row.status })));
      if (approvalReference || approvalId) {
        const resolved = await references.resolve({ owner, type: 'approval', reference: approvalReference || approvalId });
        if (resolved.status === 'ambiguous') return `Indica una solicitud: ${resolved.candidates.map(row => row.shortRef).join(', ')}.`;
        if (resolved.status !== 'resolved') return 'No encontré esa solicitud de colaboración entre tus encargos.';
        approvalId = resolved.id;
      }
      if (!approvalId && contextual) {
        const settings = await coordinator.settings(owner);
        const matching = candidates.filter(row => row.helper === settings?.conversation_agent && row.receipt_code === 'approval_notified');
        if (matching.length === 1) approvalId = matching[0].id;
      }
      if (!approvalId) return candidates.length ? `Indica la solicitud: ${shortCandidates.map(row => row.shortRef).join(', ')}. Puedes decir «apruebo ${shortCandidates[0].shortRef}» o «rechazo ${shortCandidates[0].shortRef}».`
        : contextual && approved === true ? await taskProgress(agent || (await coordinator.settings(owner))?.conversation_agent, { acknowledgement: true }) : null;
      const decision = await permissions.approve({ owner, approvalId, approved: approved === true, eventKey: `decision:${messageId}` });
      if (decision.request && decision.status === 'approved') {
        await references.setStatus({ owner, type: 'approval', id: approvalId, status: 'approved' });
        await store.enqueueEvent({ owner, agent: decision.request.helper, eventKey: `approval-execute:${approvalId}`, type: 'approved_action',
          payload: { approvalId, allowContact: false }, priority: 20 });
        await dispatchWork({type:'autonomy_agent',agent:'melodi'});
        return 'Aprobación registrada. Continuaré esa acción concreta y comprobaré el resultado.';
      }
      if (decision.status === 'denied') {
        await references.setStatus({ owner, type: 'approval', id: approvalId, status: 'denied' });
        const request = candidates.find(row => row.id === approvalId);
        let objectiveDenied = false;
        if (request?.parent_event_id) {
          const original = await env.VETSA_CLOUD.prepare(`SELECT input_encrypted,input_iv FROM wa_melodi_permission_requests
            WHERE id=? AND owner_phone=? AND requester=? AND parent_event_id=? AND status='denied'`)
            .bind(request.id,owner,request.requester,request.parent_event_id).first();
          if (original) {
            const decoded = await services.decrypt(original.input_encrypted,original.input_iv);
            const scope = await approvedObjective(request,typeof decoded === 'string' ? JSON.parse(decoded) : decoded,{checkContact:false});
            if (scope) {await brain.fail({...scope.identity,reason:'authorization_denied'});objectiveDenied = true;}
          }
        }
        if (request && !objectiveDenied) await store.enqueueEvent({ owner, agent: request.requester, eventKey: `approval-denied:${approvalId}`, type: 'collaboration_denied',
          payload: { tool: request.tool, reason: 'El propietario no aprobó la colaboración.', allowContact: true }, priority: 6 });
        return 'Rechazo registrado. Esa colaboración no se ejecutará.';
      }
      return 'Esa solicitud ya fue resuelta, caducó o cambió de permisos; no se ejecutará de nuevo.';
    }
    if (action === 'create_routine') {
      if (routine?.kind === 'recurring_reminder') {
        const created=await routines.create({...routine,owner,agent,eventKey:`routine:${messageId}`});
        const ref=await references.register({owner,type:'routine',id:created.id,agent,status:created.status});
        return `${name(agent)}: ${created.status==='active' ? 'Guardé' : 'Ya estaba detenido'} el recordatorio ${ref.shortRef}: ${created.title}. ${created.frequency==='monthly' ? `Cada mes, el día ${created.dayOfMonth}` : created.frequency==='daily' ? 'Cada día' : `Cada ${['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][created.weekday]}`} a las ${created.hour}, hora de República Dominicana. Próximo: ${new Intl.DateTimeFormat('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'long'}).format(new Date(created.nextAt))}. ${routine.defaultHour ? 'Como no indicaste hora, elegí las 9:00 a. m. ' : ''}Aparecerá en «Vetsa · Equipo»; puedes cambiarlo en Google Calendar o detenerlo con «detén rutina ${ref.shortRef}».`;
      }
      if (routine?.kind === 'motivational_message') {
        const created=await routines.create({...routine,owner,agent,eventKey:`routine:${messageId}`});
        const ref=await references.register({owner,type:'routine',id:created.id,agent,status:created.status});
        return `${name(agent)}: Quedó programado: una frase breve cada día a las ${created.hour}, hora de República Dominicana, por WhatsApp y con correo de respaldo. ${routine.defaultHour ? 'Elegí esa hora porque me diste libertad de horario. ' : ''}Empiezo el ${new Intl.DateTimeFormat('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'long'}).format(new Date(created.nextAt))}. Puedes cambiarla en «Vetsa · Equipo» o decirme «detén las frases diarias» (${ref.shortRef}).`;
      }
      if (!routine?.profile) return `${name(agent)}: Dime el @usuario o enlace del perfil que quieres investigar cada semana.`;
      const created = await routines.create({ ...routine, owner, agent, eventKey: `routine:${messageId}`, title: routine.title || 'Investigación semanal de Instagram', brief: routine.brief || `Investigar formatos de ${routine.profile}` });
      const ref = await references.register({ owner, type: 'routine', id: created.id, agent, status: created.status });
      return `${name(agent)}: Registré tu encargo semanal (${ref.shortRef}). Lo entregaré por ${created.channel === 'email' ? 'correo' : created.channel === 'whatsapp' ? 'WhatsApp, con correo de respaldo' : 'WhatsApp o correo'} los ${['domingos','lunes','martes','miércoles','jueves','viernes','sábados'][created.weekday]} a las ${created.hour}, hora dominicana. Si faltan datos públicos lo señalaré en el informe. Puedes detenerlo con «detén rutina ${ref.shortRef}».`;
    }
    if (action === 'list_routines' || action === 'stop_routine') {
      const items = await Promise.all((await routines.list(owner, routineReference || routineId ? undefined : agent)).filter(row => row.status === 'active' && (!routineKind || row.kind===routineKind))
        .map(async row => ({ ...row, shortRef: (await references.register({ owner, type: 'routine', id: row.id, agent: row.agent, status: row.status })).shortRef })));
      if (action === 'list_routines') return items.length ? items.map(row => `${name(row.agent)} · ${row.title} · ${row.shortRef} · ${row.frequency==='daily' ? 'Cada día' : row.frequency==='monthly' ? `Mensual, día ${row.dayOfMonth}` : 'Semanal'} · ${row.hour} RD · ${row.channel}`).join('\n') : 'No hay rutinas activas.';
      if (routineReference || routineId) {
        const resolved = await references.resolve({ owner, type: 'routine', reference: routineReference || routineId });
        if (resolved.status !== 'resolved') return resolved.status === 'ambiguous' ? `Indica cuál detener: ${resolved.candidates.map(row => row.shortRef).join(', ')}.` : 'No encontré esa rutina entre tus encargos.';
        routineId = resolved.id;
      }
      const match = routineId ? items.filter(row => row.id === routineId) : items;
      if (match.length !== 1) return match.length ? `Indica cuál detener: ${match.map(row => row.shortRef).join(', ')}. Para detener todo, pausa el equipo.` : 'No encontré esa rutina activa.';
      await routines.cancel({ owner, id: match[0].id });
      await references.setStatus({ owner, type: 'routine', id: match[0].id, status: 'stopped' });
      return `Detuve el encargo ${match[0].shortRef}. ${match[0].kind==='motivational_message' ? 'No enviará más frases diarias.' : match[0].kind==='recurring_reminder' ? 'No enviará más recordatorios.' : 'No entregará más informes semanales.'}`;
    }
    if (action === 'set_goal') {
      await coordinator.setGoal(owner, agent, goal, clock());
      await store.configureAgent({ owner, agent, config: { enabled: true } });
      await store.enqueueEvent({ owner, agent, eventKey: `goal-init:${messageId}`, type: 'goal_followup', payload: { allowContact: true }, priority: 8 });
      return `${AUTONOMY_PROFILES[agent].name}: Me quedo a cargo de ese objetivo. Lo seguiré contigo y las demás no abrirán conversaciones sobre él. Si WhatsApp no permite escribirte, continuaré por tu correo.`;
    }
    if (action === 'pause' || action === 'resume') {
      if (!agent) await coordinator.enable(owner, action === 'resume', clock());
      else await store.configureAgent({ owner, agent, config: { enabled: action === 'resume' } });
      return action === 'pause' ? `Pausé la iniciativa ${agent ? `de ${AUTONOMY_PROFILES[agent].name}` : 'del equipo'}.` : `Reactivé la iniciativa ${agent ? `de ${AUTONOMY_PROFILES[agent].name}` : 'del equipo'}.`;
    }
    if (action === 'complete_goal' || action === 'pause_goal') {
      await coordinator.changeGoal(owner, agent, action === 'complete_goal' ? 'complete' : 'paused', clock());
      return action === 'complete_goal' ? 'Dejé el objetivo como completado.' : 'Pausé el seguimiento de ese objetivo.';
    }
    return status();
  }

  async function status() {
    const settings = await coordinator.settings(owner);
    const agents = await store.listStates(owner);
    const levels = await permissions.getTeam(owner);
    return { enabled: active && Boolean(settings?.enabled), timeZone: 'America/Santo_Domingo', notificationWindow: '08:00–22:00',
      focusAgent: settings?.focus_agent || null, oneConversationAtATime: true,
      agents: agents.map(state => ({ ...state, ...levels.find(row => row.agent === state.agent), name: name(state.agent), tools: autonomyToolCatalog(state.agent, { ...tools, permissionLevel: levels.find(row => row.agent === state.agent)?.level }) })),
      routines: await Promise.all((await routines.list(owner)).map(async row => ({ ...row,
        shortRef: (await references.register({ owner, type: 'routine', id: row.id, agent: row.agent, status: row.status })).shortRef }))),
      pendingApprovals: await Promise.all((await permissions.listPending(owner)).map(async row => ({ ...row,
        shortRef: (await references.register({ owner, type: 'approval', id: row.id, agent: row.requester, status: row.status })).shortRef }))) };
  }
  async function agentWorkStatus(target, speaker) {
    const label = `${name(speaker)}: ${name(target)}`;
    const event = await env.VETSA_CLOUD.prepare(`SELECT id,agent,status,error_code,created_at FROM wa_melodi_work_events
      WHERE owner=? AND agent=? AND type='owner_research_report' ORDER BY created_at DESC,id DESC LIMIT 1`).bind(owner, target).first();
    const artifact = await env.VETSA_CLOUD.prepare(`SELECT t.*,j.status AS job_status,j.error_code AS job_error
      FROM wa_melodi_artifact_tracking t LEFT JOIN wa_owner_jobs j ON j.id=t.job_id AND j.owner_phone=t.owner
      WHERE t.owner=? AND t.agent=? ORDER BY t.created_at DESC,t.job_id DESC LIMIT 1`).bind(owner, target).first();
    const researchIsLatest = event && (!artifact || event.created_at > artifact.created_at);
    const approval = (await permissions.listPending(owner)).find(row => row.status === 'pending' && row.requester === target
      && (researchIsLatest ? row.parent_event_id === event.id : artifact?.approval_id === row.id));
    if (approval) {
      const ref = await references.register({ owner, type: 'approval', id: approval.id, agent: target, status: 'pending' });
      return `${label} está esperando tu aprobación de la colaboración ${ref.shortRef} con ${name(approval.helper)} para continuar su encargo.`;
    }
    if (researchIsLatest) {
      if (['requested_research_source_unavailable', 'requested_research_formats_not_verified'].includes(event.error_code))
        return `${label} está bloqueada porque no pudo verificar ${event.error_code.endsWith('formats_not_verified') ? 'los formatos' : 'el contenido'} de la publicación. Necesita sus diapositivas o texto para completar el informe.`;
      if (event.status === 'failed') return `${label} está bloqueada: ${event.error_code === 'requested_research_invalid_analysis'
        ? 'el análisis del informe no produjo una respuesta válida' : 'la investigación falló después de los reintentos'}. Todavía no hay una entrega confirmada.`;
      if (event.status === 'processing') return `${label} está investigando la publicación que le pediste. El informe todavía está en preparación.`;
      if (event.status === 'pending') return `${label} tiene la investigación en la cola de trabajo${event.error_code ? ', pendiente de reintento tras un fallo' : ''}. Todavía no ha terminado el informe.`;
      if (event.status === 'waiting') return `${label} tiene la investigación en espera; el informe sigue pendiente.`;
      return `${label} terminó la revisión de la fuente. La entrega o el bloqueo tienen su propio aviso; ese estado no confirma el envío del documento.`;
    }
    if (artifact) {
      if (artifact.status === 'delivered') return `${label} completó el envío del ${artifact.job_type === 'generate_story' ? 'contenido' : 'documento'} de su último encargo.`;
      if (artifact.status === 'cancelled') return `${label} tiene su último encargo cancelado.`;
      if (artifact.job_status === 'failed') return `${label} está bloqueada: falló la preparación de su encargo. Todavía no hay una entrega confirmada.`;
      if (artifact.job_status === 'complete') return `${label} tiene el documento preparado y pendiente de entrega.`;
      return `${label} está preparando su encargo. Todavía no ha terminado.`;
    }
    return `${label} no tiene un encargo activo registrado en este momento.`;
  }

  async function taskProgress(agent, { acknowledgement = false } = {}) {
    const pending = (await permissions.listPending(owner)).filter(row => row.status === 'pending' && (!agent || row.requester === agent));
    if (pending.length === 1) return approvalBody(pending[0]);
    if (pending.length > 1) return 'Hay varias colaboraciones pendientes. Usa la referencia corta de la que quieras aprobar.';
    const events = (await env.VETSA_CLOUD.prepare(`SELECT agent,status,error_code,created_at FROM wa_melodi_work_events
      WHERE owner=? AND type='owner_research_report' AND (? IS NULL OR agent=?) ORDER BY created_at DESC LIMIT 1`)
      .bind(owner, agent || null, agent || null).all()).results || [];
    const tracking = await artifacts.listPending({ owner, ...(agent ? { agent } : {}), limit: 30 });
    const current = tracking.sort((a, b) => b.created_at - a.created_at)[0];
    if (events[0]?.status === 'failed' && (!current || events[0].created_at > current.created_at))
      return `${name(events[0].agent)}: La investigación quedó bloqueada${events[0].error_code === 'requested_research_invalid_analysis' ? ' porque el análisis no produjo una respuesta válida' : ' después de los reintentos'}. Todavía no hay una entrega confirmada.`;
    if (current) {
      const job = await env.VETSA_CLOUD.prepare('SELECT status,error_code FROM wa_owner_jobs WHERE id=? AND owner_phone=?').bind(current.job_id, owner).first();
      if (job?.status === 'failed') return `${name(current.agent)}: La preparación falló y el encargo necesita revisar ese bloqueo. No hay una entrega confirmada.`;
      return `${name(current.agent)}: El encargo está ${job?.status === 'complete' ? 'preparado y pendiente de entrega' : 'en preparación'}. Te avisaré del resultado; no hace falta que vuelvas a confirmar.`;
    }
    if (events[0] && ['pending','processing','waiting'].includes(events[0].status))
      return `${name(events[0].agent)}: La investigación está ${events[0].status === 'processing' ? 'en curso' : 'en la cola de trabajo'}. Te avisaré del resultado.`;
    const delivered = await env.VETSA_CLOUD.prepare(`SELECT status,agent FROM wa_melodi_delivery_notices
      WHERE owner=? AND (? IS NULL OR agent=?) ORDER BY created_at DESC LIMIT 1`).bind(owner, agent || null, agent || null).first();
    if (delivered && delivered.status === 'sent') return `${name(delivered.agent)}: Ya tienes el aviso del resultado en este chat.`;
    if (events[0]?.status === 'done') return `${name(events[0].agent)}: La revisión terminó. La entrega o el bloqueo se comunica en el aviso del encargo; todavía no tengo un nuevo envío confirmado.`;
    if (acknowledgement && agent && IDS.includes(agent)) {
      const recent = (await coordinator.context(owner, agent))?.recent || [];
      const unsupportedPromise = recent.some(turn => turn.role === 'assistant' && ownerConversationAnswer(turn.message).needsTaskStatus);
      if (!unsupportedPromise) return 'Entendido.';
    }
    return 'Ese encargo no figura en ejecución y no tengo un envío confirmado. No voy a darlo por enviado.';
  }
  return { initialize, tick, runAgent, deliverOutbox, deliverNotices, observeOwner, control, status, store, coordinator, permissions, routines, artifacts, references, jobRetry, notices, contactPolicy, brain };
}
