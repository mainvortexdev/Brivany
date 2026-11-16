import { whatsappMessageEnvelopes } from './whatsapp-inbox.js';

/** Called only after Meta signature validation. Keep read receipts off the queue. */
export async function acceptWhatsAppMessages(env, payload, ctx, { markRead, processFast, isFast = () => false, onAccepted } = {}) {
  const pending = whatsappMessageEnvelopes(payload, env.WHATSAPP_PHONE_NUMBER_ID).map(async envelope => {
    const message = envelope.entry[0].changes[0].value.messages[0];
    const receivedAt=Date.now();
    ctx.waitUntil(Promise.resolve().then(() => markRead(env, message.id)).catch(() => {
      console.error(JSON.stringify({ event: 'whatsapp_ingress_read_failed' }));
    }));
    // Persist the retry copy before starting execution. Both paths share the
    // existing per-message lease and effects ledger, so only one can execute.
    await env.MELODI_JOBS.send({ type: 'incoming_whatsapp', payload: envelope,receivedAt });
    if (typeof onAccepted==='function') ctx.waitUntil(Promise.resolve().then(()=>onAccepted(envelope)).catch(()=>{
      console.error(JSON.stringify({event:'whatsapp_fast_receipt_deferred'}));
    }));
    if (env.TEAM_CONVERSATION_LEADER === 'melodi'
        && message.from === String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '')
        && message.type === 'text' && (env.OWNER_TURN_RUNTIME_ENABLED==='true' && env.OWNER_INLINE_TURNS_ENABLED==='true' || !message.context?.id && isFast(message.text?.body || '', message))) {
      ctx.waitUntil(Promise.resolve().then(() => processFast(envelope,{receivedAt})).catch(() => {
        console.error(JSON.stringify({ event: 'whatsapp_ingress_fast_deferred' }));
      }));
    }
  });
  await Promise.all(pending);
}
