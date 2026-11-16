// Explicit dependencies keep executors independently testable.
import { agentEmailIdentity, agentForEmail, literalEmailSender, ownerEmailBodyContinuation } from '../melodi-email-identity.js';
import { validDocumentEmail } from '../document-workflow.js';

function emailTarget(env, interpretation) {
  const explicit = interpretation.emailTo || interpretation.contactEmail;
  return { contactName: interpretation.contactName,
    contactEmail: explicit || (interpretation.emailToSelf && !interpretation.contactName ? validDocumentEmail(env.OWNER_EMAIL_FORWARD_TO) : '') };
}

async function acknowledgeEmail(context, identity, recipient, jobId) {
  if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('Email request was not durably accepted');
  if (!context.receiptSent) await context.reply(`${identity.name}: Recibí tu petición. Dejé el correo para ${recipient} en preparación y te avisaré cuando se envíe.`);
}

export async function continueEmailDelivery(context, services) {
  const { session, descriptor, reply, env, phone, message, interpretation } = context;
  const { storeIncomingMedia, resolveOwnerRecipient, setOwnerSession, clearOwnerSession, enqueueDirectOwnerEmail } = services;
if (session?.type === 'await_email_delivery') {
    const state = session.state;
    const rawBody = context.normalized || message?.text?.body || '';
    const awaitingBody = Boolean(state.to && !state.body && !descriptor);
    const explicitBody = /^(?:cuerpo(?:\s+del\s+correo)?|texto\s+del\s+correo|contenido\s+del\s+correo)\s*:/i.test(String(rawBody).trimStart());
    if (awaitingBody && !ownerEmailBodyContinuation(rawBody)) return;
    if (!(awaitingBody && explicitBody) && interpretation.intent && !['chat', 'send_email', 'store_contact'].includes(interpretation.intent)) return;
    const identity = agentEmailIdentity(state.agent || interpretation.agent || agentForEmail(state.from) || 'melodi',
      { from: state.emailFromExplicit ? state.from : '' });
    let attachment = state.attachment || null;
    if (!attachment && descriptor) {
      if (state.imageEditPrompt && descriptor.kind !== 'image') {
        await reply('Para editarla necesito una imagen. La información del correo sigue guardada.');
        return true;
      }
      attachment = await storeIncomingMedia(env, phone, message);
    }
    const recipient = state.to
      ? { name: state.recipientName, email: state.to }
      : await resolveOwnerRecipient(env, phone, emailTarget(env, { ...interpretation,
        contactName: interpretation.emailToSelf ? interpretation.contactName : interpretation.contactName || state.recipientName }));
    const body = state.body || (awaitingBody ? String(rawBody).replace(/^\s*(?:cuerpo(?:\s+del\s+correo)?|texto\s+del\s+correo|contenido\s+del\s+correo)\s*:[ \t]*/i, '') : interpretation.emailBody);
    if (!recipient?.email) {
      await setOwnerSession(env, phone, 'await_email_delivery', { ...state, attachment });
      await reply('Dime la dirección de destino o el nombre tal como lo guardaste y continúo con ese correo.');
      return true;
    }
    if (!body) {
      await setOwnerSession(env, phone, 'await_email_delivery', { ...state, to: recipient.email, recipientName: recipient.name || state.recipientName });
      await reply('Ya tengo el destinatario. ¿Qué quieres que le diga en el correo?');
      return true;
    }
    if ((state.requiresAttachment || state.imageEditPrompt) && !attachment) {
      await setOwnerSession(env, phone, 'await_email_delivery', { ...state, to: recipient.email, recipientName: recipient.name || state.recipientName });
      await reply('Envíame la foto y la adjunto antes de realizar el envío.');
      return true;
    }
    const jobId = await enqueueDirectOwnerEmail(env, phone, {
      ...state,
      agent: identity.agent, from: identity.from, senderName: identity.senderName,
      to: recipient.email,
      recipientName: recipient.name || state.recipientName,
      body,
      attachment,
    });
    if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('Email request was not durably accepted');
    await clearOwnerSession(env, phone);
    await acknowledgeEmail(context, identity, recipient.email, jobId);
    return true;
  }
}

export async function retrieve_email_code(context, services) {
  const { interpretation, reply, env, phone } = context;
  const { latestInboundEmail } = services;
if (interpretation.intent === 'retrieve_email_code') {
    const mailbox = interpretation.emailMailbox;
    if (!mailbox) {
      await reply('Dime a cuál dirección de Vetsa llegó el código, por ejemplo Natalie o natalie@vetsa.es.');
      return true;
    }
    const email = await latestInboundEmail(env, phone, mailbox, false);
    if (!email) {
      await reply(`No encontré un código reciente recibido en ${mailbox}. Cuando esa dirección esté conectada a Melodi, podré leerlo aquí.`);
      return true;
    }
    await reply(`El código más reciente para ${mailbox} es *${email.code}*. Llegó de ${email.from || 'un remitente'}${email.subject ? ` con asunto “${email.subject}”` : ''}.`);
    return true;
  }
}

export async function retrieve_email_data(context, services) {
  const { interpretation, reply, env, phone } = context;
  const { latestInboundEmail, cleanText } = services;
if (interpretation.intent === 'retrieve_email_data') {
    const mailbox = interpretation.emailMailbox;
    if (!mailbox) {
      await reply('Dime qué dirección de Vetsa quieres consultar.');
      return true;
    }
    const email = await latestInboundEmail(env, phone, mailbox);
    if (!email) {
      await reply(`No tengo un correo guardado para ${mailbox}. Cuando su enrutamiento llegue a Melodi, podré consultarlo de forma privada.`);
      return true;
    }
    const excerpt = cleanText(email.text).slice(0, 700);
    await reply(`El último correo en ${mailbox} llegó de ${email.from || 'un remitente'}${email.subject ? ` y tiene como asunto “${email.subject}”` : ''}.${email.code ? ` El código es *${email.code}*.` : ''}${excerpt ? `\n\n${excerpt}` : ''}`);
    return true;
  }
}

export async function send_email(context, services) {
  const { interpretation, env, reply, descriptor, phone, message } = context;
  const { storeIncomingMedia, resolveOwnerRecipient, setOwnerSession, enqueueDirectOwnerEmail } = services;
if (interpretation.intent === 'send_email') {
    const explicitSender = literalEmailSender(context.normalized || message?.text?.body);
    const identity = agentEmailIdentity(interpretation.agent || 'melodi', { from: explicitSender });
    if (!env.BREVO_API_KEY) {
      await reply('El correo saliente de Vetsa todavía no está conectado. Podré enviarlo cuando esté disponible el envío.');
      return true;
    }
    if (interpretation.imageEditPrompt && descriptor?.kind && descriptor.kind !== 'image') {
      await reply('Para editarla y adjuntarla necesito una imagen.');
      return true;
    }
    const attachment = descriptor ? await storeIncomingMedia(env, phone, message) : null;
    const recipient = await resolveOwnerRecipient(env, phone, emailTarget(env, interpretation));
    if (!recipient?.email) {
      await setOwnerSession(env, phone, 'await_email_delivery', {
        to: '',
        recipientName: interpretation.contactName,
        agent: identity.agent, from: identity.from, senderName: identity.senderName, emailFromExplicit: Boolean(explicitSender),
        subject: interpretation.emailSubject || `Mensaje de ${identity.name} · Vetsa`,
        body: interpretation.emailBody,
        attachment,
        requiresAttachment: interpretation.requiresAttachment,
        imageEditPrompt: interpretation.imageEditPrompt,
      });
      await reply('Dime la dirección de destino o el nombre tal como lo guardaste y lo preparo contigo.');
      return true;
    }
    if (!interpretation.emailBody) {
      await setOwnerSession(env, phone, 'await_email_delivery', {
        to: recipient.email,
        recipientName: recipient.name || interpretation.contactName,
        agent: identity.agent, from: identity.from, senderName: identity.senderName, emailFromExplicit: Boolean(explicitSender),
        subject: interpretation.emailSubject || `Mensaje de ${identity.name} · Vetsa`,
        body: '',
        attachment,
        requiresAttachment: interpretation.requiresAttachment,
        imageEditPrompt: interpretation.imageEditPrompt,
      });
      await reply('Ya tengo el destinatario. ¿Qué quieres que le diga en el correo?');
      return true;
    }
    if ((interpretation.requiresAttachment || interpretation.imageEditPrompt) && !attachment) {
      await setOwnerSession(env, phone, 'await_email_delivery', {
        to: recipient.email,
        recipientName: recipient.name || interpretation.contactName,
        agent: identity.agent, from: identity.from, senderName: identity.senderName, emailFromExplicit: Boolean(explicitSender),
        subject: interpretation.emailSubject || `Mensaje de ${identity.name} · Vetsa`,
        body: interpretation.emailBody,
        attachment: null,
        requiresAttachment: interpretation.requiresAttachment,
        imageEditPrompt: interpretation.imageEditPrompt,
      });
      await reply('Envíame la foto y la adjunto antes de realizar el envío.');
      return true;
    }
    const jobId = await enqueueDirectOwnerEmail(env, phone, {
      to: recipient.email,
      agent: identity.agent, from: identity.from, senderName: identity.senderName,
      subject: interpretation.emailSubject || `Mensaje de ${identity.name} · Vetsa`,
      body: interpretation.emailBody,
      recipientName: recipient.name || interpretation.contactName,
      attachment,
      imageEditPrompt: interpretation.imageEditPrompt,
    });
    await acknowledgeEmail(context, identity, recipient.email, jobId);
    return true;
  }
}
