// Explicit dependencies keep executors independently testable.

export async function job_send_email(context, services) {
  const { env, payload, row, jobId, sendText } = context;
  const { attachmentFromPrivateReference, sendOwnerEmail } = services;

      const attachment = await attachmentFromPrivateReference(env, payload.attachment);
      const result = await sendOwnerEmail(env, row.owner_phone, jobId, { ...payload, attachment });
      if (result.status === 'sent') {
        if (services.notifyEmailDelivered) await services.notifyEmailDelivered(env, row.owner_phone, jobId, result);
        else await sendText(env, row.owner_phone, `Listo, ya salió para ${result.recipient || payload.to}${result.sender ? ` desde ${result.sender}` : ''}.`);
      } else {
        await sendText(env, row.owner_phone, `Dejé el envío a ${payload.to} en verificación para no duplicarlo.`);
      }
    
}

// Explicit dependencies keep executors independently testable.

export async function job_prepare_direct_email_attachment(context, services) {
  const { env, row, payload, jobId, sendText } = context;
  const { editImageForScheduledEmail, attachmentFromPrivateReference, sendOwnerEmail } = services;

      const reference = await editImageForScheduledEmail(env, row.owner_phone, payload.source, payload.imageEditPrompt);
      const attachment = await attachmentFromPrivateReference(env, reference);
      const result = await sendOwnerEmail(env, row.owner_phone, jobId, { ...payload, attachment });
      if (result.status === 'sent') {
        if (services.notifyEmailDelivered) await services.notifyEmailDelivered(env, row.owner_phone, jobId, result);
        else await sendText(env, row.owner_phone, `Listo, ya salió para ${result.recipient || payload.to} con la imagen adjunta ✨`);
      } else {
        await sendText(env, row.owner_phone, `Dejé ese envío en verificación para no duplicarlo.`);
      }
    
}

export async function job_prepare_scheduled_email_attachment(context, services) {
  const { env, payload, row, sendText } = context;
  const { editImageForScheduledEmail, updateScheduledEmailAction } = services;

      const action = await env.VETSA_CLOUD.prepare(`
        SELECT status FROM wa_melodi_scheduled_email_actions WHERE event_id = ? AND owner_phone = ?
      `).bind(payload.eventId, row.owner_phone).first();
      if (!action) throw new Error('The scheduled email action is missing');
      if (action.status === 'preparing') {
        const attachment = await editImageForScheduledEmail(env, row.owner_phone, payload.source, payload.imageEditPrompt);
        await updateScheduledEmailAction(env, row.owner_phone, payload.eventId, {
          to: payload.to,
          from: payload.from,
          subject: payload.subject,
          body: payload.body,
          recipientName: payload.recipientName,
          attachment,
          status: 'pending',
        });
        await sendText(env, row.owner_phone, `La imagen para ${payload.recipientName || payload.to} ya quedó lista para el envío programado ✨`);
      }
    
}
