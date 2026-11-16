# Durable WhatsApp processing receipts

`whatsapp-processing.js` replaces **new-message** use of the old `isDuplicate()` check. It never edits or deletes `wa_messages`. Old seen IDs are returned as `legacy`; their original outcome is unknown and they are not replayed.

Create one store per incoming processing request with `createWhatsAppProcessing(env.VETSA_CLOUD, ownerAutonomyServices(env))`, call `ensureSchema()`, then `begin({owner: cleanPhone(message.from), messageId: message.id})`. Owner is the authenticated message sender, including public chat senders, not an inferred contact or hardcoded account. `owner + messageId` is the immutable receipt identity.

## Integration in worker.js

1. Validate the webhook/phone-number ID and supported message before claiming. Do not insert a new row in `wa_messages`.
2. Handle `begin().action` before inference or tools:
   - `process`: execute the normal incoming flow under this claim.
   - `busy`: retry the Queue message after `retryAfterMs`; another delivery owns the live lease.
   - `done` or `legacy`: acknowledge without sending another response or invoking the model.
   - `resume`: inspect only the stored `response` and confirmed `effects`. Do not run routing, inference or tool execution again. If a reply receipt is confirmed, finish. If an existing job was confirmed, consult that job's status or deliver the already prepared final response. Never create another job.
   - `uncertain`: acknowledge and preserve the receipt for review/status reconciliation. Do not claim the external action failed or repeat it automatically. An unknown provider result cannot safely be retried without provider reconciliation or an actual idempotency key.
3. Pass the claim explicitly through request-local adapters; do not store it in a module global or attach it to shared mutable state.
4. Wrap every irreversible boundary (job acceptance, calendar/memory/project writes, mail/send/publication) with stable effect keys. A key identifies the logical operation, not a random attempt: `job:document`, `calendar:create`, `reply:0`. Hashes of these keys are stored. Each effect must be started **before** calling the provider or accepting a non-idempotent operation:

   ```js
   const intent = await inbox.markExternalEffect({
     ...claim, effectKey: 'job:document', kind: 'action', phase: 'started',
   });
   if (!intent.allowed) throw new Error('processing_effect_not_owned');
   const result = await acceptExistingIdempotentJob();
   const receipt = await inbox.markExternalEffect({
     ...claim, effectKey: 'job:document', kind: 'action', phase: 'confirmed',
     receipt: {jobId: result.id, status: 'queued'},
   });
   if (!receipt.allowed) throw new Error('processing_receipt_not_confirmed');
   ```

5. Prepare/accept durable work before sending a generic “received” acknowledgement. Otherwise a crash after the acknowledgement but before job acceptance leaves no job to resume. Existing idempotent job handlers should reuse `message.id` rather than allocating a new job on replay. Where possible, write the job and receipt in one D1 transaction/batch; a remote Queue timeout can still be uncertain even when the job was persisted.
6. Save only the final, already justified conversation response using `saveResponse({...claim,response:{body,agent}})` before its send. Mark the send with `kind:'response'`, `phase:'started'`; on the provider's confirmed message ID, mark it confirmed. A timeout remains `started`. Use `phase:'rejected'` only when the provider definitively rejected the operation, such as a documented no-acceptance rate limit; HTTP/network errors in general do not prove rejection.
7. On successful completion call `finish(claim)` and verify it returned true. It refuses a stale lease or an unresolved effect intent. In the error path call `fail({...claim,code:'model_unavailable'})` with a fixed code, never an error message containing private text. Retry the Queue message only when `fail().retry` is true. Confirmed effects cause the next claim to be `resume`; effect-free failures may run again. A live claim can be extended using `heartbeat(claim)` before an expensive step. An expired token cannot write.

Read state/typing notifications and inference are not irreversible delivery effects and need not fence normal safe retries. Model output is never a receipt. Persisted receipts and prepared responses are encrypted using the existing hooks; there is no plaintext fallback and this module emits no logs.

The default lease is three minutes, with five bounded claims. A resume lease rejects new `kind:'action'` effects. Only response completion/status reconciliation is permitted. Existing jobs, outbox and tool idempotency checks remain necessary: no inbox abstraction can provide exactly-once semantics for a provider that accepted an operation and then disconnected before returning its receipt.

## Validation

`node --test test/whatsapp-processing.test.js` exercises real SQLite constraints and conditional writes, authenticated sender isolation, concurrent claims, stale tokens, crash before/during/after an external effect, encrypted immutable response recovery, definite rejection, unresolved sends, legacy preservation and bounded retries.

The store uses a per-request D1 `withSession('first-primary')` when available to keep reads consistent with its writes. See [D1 Sessions API](https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession). Queue retry/ack decisions belong to the consumer, not this storage helper; see [Queue message methods](https://developers.cloudflare.com/queues/configuration/javascript-apis/#message).
