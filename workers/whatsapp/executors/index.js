import { skillFor } from '../melodi-skills.js';
import { earlyExecutors, orderedExecutors, jobExecutors, skillExecutors } from './registry.js';
import {runWhatsAppAction} from '../whatsapp-request-scope.js';

// A receipt represents an awaited tool result, never a classifier/model claim.
const receiptPolicies = Object.freeze({
  createReminderBatch: ['scheduled',value=>value?.status==='scheduled' && Array.isArray(value.events) && value.events.length>=2 && value.events.length<=8 && value.events.every(event=>typeof event?.id==='string' && event.id.length>0)],
  enqueueOwnerJob: ['queued', value => typeof value === 'string' && value.length > 0],
  enqueueDirectOwnerEmail: ['queued', value => typeof value === 'string' && value.length > 0],
  createStacyCommand: ['queued', value => typeof value === 'string' && value.length > 0],
  storeExactMemory: ['persisted', value => typeof value === 'string' && value.length > 0],
  storeIncomingMedia: ['persisted', value => Boolean(value?.objectKey)],
  setOwnerSession: ['waiting', () => true],
  scheduleEmailReminder: ['scheduled', value => Boolean(value?.event?.id)],
  sendOwnerEmail: ['provider', value => ['sent', 'reserved'].includes(value?.status)],
});

export function verifyExecutionResult(result) {
  const statuses = ['answered', 'deferred', 'queued', 'waiting', 'persisted', 'scheduled', 'provider', 'executed'];
  if (!result || !statuses.includes(result.status) || !Array.isArray(result.receipts)) {
    throw new Error('Invalid executor result');
  }
  if (['queued', 'persisted', 'scheduled', 'provider'].includes(result.status)
      && !result.receipts.some(receipt => receipt.status === result.status && receipt.verified === true)) {
    throw new Error('The executor did not provide the required tool evidence');
  }
  return result;
}

// Final output is deferred until the executor returns. An uncaught failure must
// never leak an earlier success message. Media delivery remains in its own
// idempotent provider service; buffering it would break its transaction logic.
export async function runExecutor(executor, context, services, { job = false } = {}) {
  const replies = [], receipts = [];
  const mutating = new Set(['enqueueOwnerJob','enqueueDirectOwnerEmail','createStacyCommand','storeExactMemory','storeIncomingMedia',
    'scheduleEmailReminder','sendOwnerEmail','saveProjectProgress','saveStoryPortrait','saveStoryVisualReference','setStoryAutoPublish',
    'startStoryCampaign','pauseStoryCampaign','sendInstagramOwnerCommand','upsertDocumentTemplate','upsertOwnerContact',
    'sendIssuedDocument','sendIssuedDocumentByEmail','sendReference','sendWhatsAppMedia','createReminderBatch','applyAgendaPlan']);
  if(context.env?.WHATSAPP_PROCESSING_SCOPE) services=Object.fromEntries(Object.entries(services).map(([name,fn])=>[name,
    mutating.has(name)&&typeof fn==='function' ? (...args)=>runWhatsAppAction(context.env,'executor:'+name,()=>fn(...args)) : fn]));
  const dependencies = { ...services };
  if (typeof services.applyAgendaPlan === 'function') dependencies.applyAgendaPlan = async (...args) => {
    const result = await services.applyAgendaPlan(...args);
    if (['applied', 'replayed'].includes(result?.status)) {
      if (!result.id || !Array.isArray(result.created) || !Array.isArray(result.moved)
        || result.created.some(event => !event.id)) throw Error('agenda_plan_receipt_unverified');
      receipts.push({ tool: 'applyAgendaPlan', status: 'scheduled', verified: true });
    } else if (!['conflict', 'unsupported'].includes(result?.status)) throw Error('agenda_plan_receipt_missing');
    return result;
  };
  for (const [name, [status, validate]] of Object.entries(receiptPolicies)) {
    if (typeof services[name] !== 'function') continue;
    dependencies[name] = async (...args) => {
      const value = await services[name](...args);
      if (!validate(value)) throw new Error(`Unverified tool result: ${name}`);
      if (name === 'storeExactMemory') {
        const stored = await services.getMemoryItem(args[0], args[1], value);
        if (!stored?.payload || JSON.stringify(stored.payload) !== JSON.stringify(args[3])) {
          throw new Error('La lectura de comprobación de memoria no coincidió');
        }
      }
      receipts.push({ tool: name, status, verified: true });
      return value;
    };
  }
  const executionContext = { ...context };
  executionContext.progress = context.reply;
  if (context.addReminder) executionContext.addReminder = async (...args) => {
    const event = await context.addReminder(...args);
    if (!event?.id) throw new Error('El calendario no confirmó el identificador del recordatorio');
    receipts.push({ tool: 'addReminder', status: 'scheduled', verified: true });
    return event;
  };
  if (context.reply) executionContext.reply = async body => { replies.push(() => context.reply(body)); };
  if (context.sendText) executionContext.sendText = async (...args) => { replies.push(() => context.sendText(...args)); };
  const handled = await executor(executionContext, dependencies);
  if (!job && handled === undefined) {
    if (replies.length || receipts.length) throw new Error('An unmatched executor performed an action');
    return undefined;
  }
  const status = handled?.handled === false ? 'deferred'
    : receipts.some(r => r.status === 'queued') ? 'queued'
      : receipts.at(-1)?.status || (job ? 'executed' : 'answered');
  const result = verifyExecutionResult({ status, receipts, handled });
  for (const deliver of replies) await deliver();
  console.log(JSON.stringify({ event: 'skill_executor_result', executor: executor.name, status: result.status, tools: receipts.map(r => r.tool) }));
  return result;
}

export async function executeOwnerStep(name, context, services) {
  if (!Object.hasOwn(earlyExecutors, name)) throw new Error('Unknown continuation executor');
  return (await runExecutor(earlyExecutors[name], context, services))?.handled;
}

export async function executeOwnerSkills(context, services) {
  const skill = skillFor(context.interpretation.intent, context.interpretation.agent);
  if (!Object.hasOwn(skillExecutors, skill.intent)) throw new Error(`Missing executor for ${skill.id}`);
  if (skill.agent !== context.interpretation.agent) throw new Error('Agent is not assigned to this skill');
  // Continuations have deliberate precedence over several fresh intents. Keep
  // this order explicit so attachments and reminder clarifications retain context.
  for (const executor of orderedExecutors) {
    const result = await runExecutor(executor, context, services);
    if (result !== undefined) return result.handled;
  }
  if (skill.intent !== 'chat') throw new Error(`No executor handled ${skill.id}`);
  return { handled: false, agent: skill.agent, maximumFocus: context.interpretation.maximumFocus, replyContext:context.replyContext };
}

export async function executeOwnerJob(type, context, services) {
  if (!Object.hasOwn(jobExecutors, type)) throw new Error('Unknown owner job type');
  return runExecutor(jobExecutors[type], context, services, { job: true });
}
