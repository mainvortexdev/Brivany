// Explicit dependencies keep executors independently testable.
import { documentNeedsEmail, documentRecipientRequest, validDocumentEmail } from '../document-workflow.js';
import { agentEmailIdentity, documentAcceptedReply, literalEmailSender } from '../melodi-email-identity.js';
import { parseOwnerFileRequest, ownerFileRequestReply } from '../owner-file-request.js';

export async function continueDocumentTemplate(context, services) {
  const { session, descriptor, env, phone, message, reply } = context;
  const { storeIncomingMedia, upsertDocumentTemplate, clearOwnerSession } = services;
if (session?.type === 'document_template' && descriptor && ['document', 'image'].includes(descriptor.kind)) {
    const source = await storeIncomingMedia(env, phone, message);
    const template = await upsertDocumentTemplate(env, phone, {
      name: session.state.name,
      kind: session.state.kind,
      instructions: session.state.instructions,
      source,
    });
    await clearOwnerSession(env, phone);
    await reply(`✨ Guardé la plantilla “${template.name}”. Cuando quieras usarla, pídeme una ${template.kind === 'quote' ? 'cotización' : template.kind === 'invoice' ? 'factura' : 'documento'} con ese formato y los datos del cliente.`);
    return true;
  }
}

export async function register_document_template(context, services) {
  const { interpretation, stagedTemplateSource, env, phone, normalized, reply } = context;
  const { upsertDocumentTemplate, documentKind, clearOwnerSession, setOwnerSession } = services;
if (interpretation.intent === 'register_document_template') {
    const name = interpretation.templateName || interpretation.label;
    if (name && stagedTemplateSource) {
      const template = await upsertDocumentTemplate(env, phone, {
        name,
        kind: documentKind(interpretation.documentKind),
        instructions: normalized,
        source: stagedTemplateSource,
      });
      await clearOwnerSession(env, phone);
      await reply(`✨ Guardé la plantilla “${template.name}”. Cuando quieras usarla, pídeme una ${template.kind === 'quote' ? 'cotización' : template.kind === 'invoice' ? 'factura' : 'documento'} con ese formato y los datos del cliente.`);
    } else if (!name) {
      await reply('Claro ✨ Dime el nombre con el que quieres que recuerde la plantilla y luego envíame el PDF, DOCX o una imagen legible.');
    } else {
      await setOwnerSession(env, phone, 'document_template', {
        name,
        kind: documentKind(interpretation.documentKind),
        instructions: normalized,
      });
      await reply(`Perfecto ✨ Envíame ahora la plantilla “${name}” en PDF, DOCX o imagen. La conservaré privada para reutilizar ese formato.`);
    }
    return true;
  }
}

export async function retrieve_document(context, services) {
  const { interpretation, env, phone, normalized, reply, markTyping } = context;
  const { findIssuedDocuments, sendIssuedDocument } = services;
if (interpretation.intent === 'retrieve_document') {
    const matches = await findIssuedDocuments(env, phone, normalized);
    if (!matches.length) {
      await reply('No encontré un documento emitido que coincida con eso. Dime el cliente, la empresa emisora o una fecha aproximada y lo busco de nuevo.');
      return true;
    }
    await markTyping();
    await sendIssuedDocument(env, phone, matches[0]);
    return true;
  }
}

export async function generate_document(context, services) {
  const { interpretation, env, phone, reply, normalized } = context;
  const { documentKind, getDocumentTemplate, resolveOwnerRecipient, enqueueOwnerJob, agentModel, setOwnerSession } = services;
if (interpretation.intent === 'generate_document') {
    // The semantic classifier cannot turn retrieval into authorship. This
    // second boundary also protects retried/approved work from stale routing.
    const existingFile = context.semanticTool==='document.generate'?null:parseOwnerFileRequest(normalized);
    if (existingFile) {
      if (existingFile.source === 'private') {
        return retrieve_document({ ...context, interpretation: { ...interpretation, intent: 'retrieve_document' } }, services);
      }
      await reply(ownerFileRequestReply(existingFile));
      return true;
    }
    const timing = services.resolveDocumentRequest ? await services.resolveDocumentRequest(env,phone,normalized,interpretation) : { immediate:true };
    if (timing.clarification) { await reply(timing.clarification); return true; }
    const explicitSender = literalEmailSender(normalized);
    const identity = agentEmailIdentity(interpretation.agent || 'melodi', { from: explicitSender });
    const kind = documentKind(interpretation.documentKind);
    const format = ['pdf', 'docx', 'txt'].includes(interpretation.format)
      ? interpretation.format : (kind === 'invoice' || kind === 'quote' ? 'pdf' : 'docx');
    const template = interpretation.templateName ? await getDocumentTemplate(env, phone, interpretation.templateName) : null;
    if (interpretation.templateName && !template) {
      await reply(`No encuentro la plantilla “${interpretation.templateName}”. Envíamela primero y la dejaré lista para ti.`);
      return true;
    }
    const needsEmail = documentNeedsEmail(interpretation);
    if (needsEmail && !env.BREVO_API_KEY) {
      await reply('Puedo preparar el documento, pero todavía no tengo conectado el envío de correo de Vetsa para mandarlo a esa dirección.');
      return true;
    }
    const recipientRequest = documentRecipientRequest(env, interpretation);
    const emailRecipient = needsEmail ? await resolveOwnerRecipient(env, phone, recipientRequest) : null;
    const payload = {
      prompt: normalized,
      agent: identity.agent,
      model: agentModel(identity.agent, interpretation.maximumFocus),
      format,
      kind,
      authorAgent: 'melodi',
      ...(interpretation.authoredDocument === true ? { authoredDocument:true } : {}),
      ...(interpretation.projectSubject ? {projectSubject:interpretation.projectSubject} : {}),
      documentContext: timing.context || '',
      ...(timing.dueAt ? { deliveryAt:timing.dueAt, deliveryTitle:interpretation.title || 'Documento solicitado' } : {}),
      ...(interpretation.preserveSourceContent === true && typeof interpretation.sourceContent === 'string'
        && interpretation.sourceContent.trim() && kind === 'document' && !template
        ? { sourceContent: interpretation.sourceContent, preserveSourceContent: true } : {}),
      template: template ? {
        id: template.id,
        name: template.template_name,
        kind: template.document_kind,
        instructions: template.profile.instructions,
      } : null,
      emailDelivery: needsEmail && emailRecipient?.email ? {
        to: emailRecipient.email,
        from: identity.from, agent: identity.agent, senderName: identity.senderName,
      } : null,
    };
    if (needsEmail && !emailRecipient?.email) {
      await setOwnerSession(env, phone, 'await_document_recipient', {
        payload, recipientName: recipientRequest.contactName,
        from: identity.from, agent: identity.agent, emailFromExplicit: Boolean(explicitSender),
      });
      await reply('¿A qué correo envío el documento? Conservé el contenido para prepararlo en cuanto me indiques el destinatario.');
      return true;
    }
    const jobId = await enqueueOwnerJob(env, phone, 'generate_document', payload);
    if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('Document request was not durably accepted');
    if (!context.receiptSent || payload.deliveryAt) await reply(documentAcceptedReply(payload));
    return true;
  }
}

export async function continueDocumentDelivery(context, services) {
  const { session, interpretation, env, phone, normalized, reply } = context;
  if (session?.type !== 'await_document_recipient') return;
  // A new task keeps its own routing. Only recipient clarifications continue
  // this saved document; the original content never becomes the email body.
  if (interpretation.intent && !['chat', 'send_email', 'store_contact'].includes(interpretation.intent)) return;
  const { resolveOwnerRecipient, setOwnerSession, clearOwnerSession, enqueueOwnerJob } = services;
  if (!env.BREVO_API_KEY) {
    await reply('El envío de correo todavía no está conectado. La solicitud del documento sigue guardada.');
    return true;
  }
  const state = session.state;
  const identity = agentEmailIdentity(state.agent || state.payload.agent || 'melodi',
    { from: literalEmailSender(state.payload?.prompt) || (state.emailFromExplicit ? state.from : '') });
  const useOwnerEmail = interpretation.emailToSelf && !interpretation.contactName;
  const recipientRequest = documentRecipientRequest(env, {
    ...interpretation,
    contactEmail: interpretation.contactEmail || validDocumentEmail(normalized),
    contactName: useOwnerEmail ? '' : interpretation.contactName || state.recipientName || (validDocumentEmail(normalized) ? '' : normalized),
  });
  const recipient = await resolveOwnerRecipient(env, phone, recipientRequest);
  if (!recipient?.email) {
    await setOwnerSession(env, phone, 'await_document_recipient', state);
    await reply('Dime el correo de destino o el nombre de un contacto guardado y continúo con el documento.');
    return true;
  }
  const payload = { ...state.payload, agent: identity.agent,
    emailDelivery: { to: recipient.email, from: identity.from, agent: identity.agent, senderName: identity.senderName } };
  const jobId = await enqueueOwnerJob(env, phone, 'generate_document', payload);
  if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('Document request was not durably accepted');
  await clearOwnerSession(env, phone);
  if (!context.receiptSent) await reply(documentAcceptedReply(payload));
  return true;
}
