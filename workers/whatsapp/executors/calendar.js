// Explicit dependencies keep executors independently testable.
import { agentEmailIdentity, literalEmailSender } from '../melodi-email-identity.js';
import { reminderConfirmation, shortReminderTime } from '../reminder-language.js';
import { agendaPlanConfirmation, agendaPlanFailure } from '../agenda-plan-reply.js';

export async function continueReminderAttachment(context, services) {
  const { session, descriptor, reply, env, phone, message, addReminder } = context;
  const { storeIncomingMedia, clearOwnerSession, scheduleEmailReminder } = services;
if (session?.type === 'await_reminder_attachment' && descriptor) {
    if (session.state.imageEditPrompt && descriptor.kind !== 'image') {
      await reply('Para editarla necesito que me envíes una imagen. La hora y el correo siguen reservados.');
      return true;
    }
    const attachment = await storeIncomingMedia(env, phone, message);
    const state = session.state;
    await scheduleEmailReminder(env, phone, addReminder, state, attachment);
    await clearOwnerSession(env, phone);
    await reply(state.imageEditPrompt
      ? `Listo, la imagen quedó vinculada y la estoy preparando para el correo de ${state.recipientName || state.to}.`
      : `Listo, dejé el recordatorio y el correo para ${state.recipientName || state.to} programados.`);
    return true;
  }
}

export async function continueReminderRecipient(context, services) {
  const { session, descriptor, reply, env, phone, message, interpretation, addReminder } = context;
  const { storeIncomingMedia, resolveOwnerRecipient, setOwnerSession, clearOwnerSession, scheduleEmailReminder } = services;
if (session?.type === 'await_reminder_recipient') {
    const state = session.state;
    let attachment = state.attachment || null;
    if (!attachment && descriptor) {
      if (state.imageEditPrompt && descriptor.kind !== 'image') {
        await reply('Para editarla necesito una imagen. La hora y el correo siguen reservados.');
        return true;
      }
      attachment = await storeIncomingMedia(env, phone, message);
    }
    const recipient = await resolveOwnerRecipient(env, phone, {
      contactName: interpretation.contactName || state.recipientName,
      contactEmail: interpretation.emailTo || interpretation.contactEmail,
    });
    if (!recipient?.email) {
      await setOwnerSession(env, phone, 'await_reminder_recipient', { ...state, attachment });
      await reply('¿A qué correo debo enviárselo? También puedes decirme el nombre tal como lo guardaste.');
      return true;
    }
    const resolved = { ...state, to: recipient.email, recipientName: recipient.name || state.recipientName, attachment };
    const needsAttachment = Boolean(resolved.requiresAttachment || resolved.imageEditPrompt);
    if (needsAttachment && !resolved.attachment) {
      await setOwnerSession(env, phone, 'await_reminder_attachment', resolved);
      await reply('Perfecto. Envíame la foto y la uniré al correo programado.');
      return true;
    }
    await scheduleEmailReminder(env, phone, addReminder, resolved, resolved.attachment);
    await clearOwnerSession(env, phone);
    await reply(resolved.imageEditPrompt
      ? `Listo, la imagen se está preparando para el correo de ${resolved.recipientName || resolved.to}.`
      : `Listo, dejé el recordatorio y el correo para ${resolved.recipientName || resolved.to} programados.`);
    return true;
  }
}

export async function set_calendar_pin(context, services) {
  const { interpretation, normalized, reply, updateCalendarPin, phone } = context;
  const { sixDigitCode } = services;
if (interpretation.intent === 'set_calendar_pin') {
    const pin = sixDigitCode(normalized);
    if (!pin) {
      await reply('Envíame el PIN de calendario de seis dígitos para actualizarlo.');
    } else if (typeof updateCalendarPin === 'function') {
      await updateCalendarPin(pin);
      await reply('PIN de calendario actualizado. Abre https://ia.vetsa.es/' + phone + ' para gestionar tus eventos.');
    }
    return true;
  }
}

export async function create_reminder(context, services) {
  const { interpretation, upcomingEvents, addReminder, session, env, phone, reply, descriptor, message, normalized } = context;
  const { clearOwnerSession, resolveOwnerRecipient, storeIncomingMedia, setOwnerSession, scheduleEmailReminder } = services;
if (interpretation.intent === 'create_reminder') {
    if (interpretation.agendaPlan) {
      const { plan, directive } = interpretation.agendaPlan;
      const result = await services.applyAgendaPlan(env, phone, message.id, interpretation.agendaPlan);
      if (!['applied', 'replayed'].includes(result?.status)) {
        const canNarrow = result?.reason === 'unsupported_day_activities'
          && result.unsupported?.length && result.unsupported.every(item => ['agent_routine', 'cognira_report', 'story_slot', 'story_single'].includes(item.kind));
        if (canNarrow || result?.reason === 'agenda_changed' || result?.reason === 'time_conflict') await setOwnerSession(env, phone, 'await_agenda_plan', {
          directive, reason: canNarrow ? 'non_personal_activities' : result.reason,
          ...(result.reason === 'time_conflict' ? { conflict: result } : {}),
        });
        await reply(agendaPlanFailure(result, { timeZone: plan.timeZone }));
        return true;
      }
      await clearOwnerSession(env, phone);
      await reply(agendaPlanConfirmation(result, plan, plan.timeZone));
      return true;
    }
    if(Array.isArray(interpretation.reminderEvents)) {
      if(interpretation.deliverByEmail || typeof services.createReminderBatch!=='function') throw Error('calendar_batch_not_available');
      const saved=await services.createReminderBatch(env,phone,message.id,interpretation.reminderEvents,{agent:interpretation.agent || 'melodi'});
      if(saved?.status!=='scheduled' || saved.events?.length!==interpretation.reminderEvents.length || saved.events.some(event=>!event.id)) throw Error('calendar_batch_not_confirmed');
      if (services.syncAgenda) await services.syncAgenda(env, phone);
      if(session?.type==='await_reminder_time')await clearOwnerSession(env,phone);
      await reply(`Listo, te recordaré estos ${saved.events.length} compromisos:\n${saved.events.map((event,index)=>`• ${event.title}, ${shortReminderTime(event.eventAt,env.TIME_ZONE || 'America/Santo_Domingo')}${interpretation.reminderEvents[index].assumedHour ? ' Como no indicaste hora, elegí las 9:00 a. m.' : ''}`).join('\n')}`);
      return true;
    }
    const linkedEvent = interpretation.eventId
      ? upcomingEvents.find((event) => event.id === interpretation.eventId) || null
      : null;
    const eventAt = linkedEvent?.event_at
      || (interpretation.delayMinutes ? new Date(Date.now() + interpretation.delayMinutes * 60_000).toISOString() : interpretation.eventAt);
    const title = interpretation.title || linkedEvent?.title || '';
    if (title && eventAt && Date.parse(eventAt) > Date.now() && typeof addReminder === 'function') {
      if (!interpretation.deliverByEmail) {
        if (!linkedEvent) {
          const saved = await addReminder(title, eventAt, { agent: interpretation.agent || 'melodi' });
          if (!saved?.id) throw Error('calendar_reminder_not_confirmed');
        }
        if (session?.type === 'await_reminder_time') await clearOwnerSession(env, phone);
        await reply(reminderConfirmation(title, { assumedHour: interpretation.assumedReminderHour }));
        return true;
      }
      if (!env.BREVO_API_KEY) {
        await reply('Puedo dejarte el recordatorio, pero el envío de correo de Vetsa no está disponible ahora mismo.');
        return true;
      }
      const identity = agentEmailIdentity(interpretation.agent || 'melodi', { from: literalEmailSender(normalized) || undefined });
      const needsAttachment = interpretation.requiresAttachment || Boolean(interpretation.imageEditPrompt);
      const recipient = await resolveOwnerRecipient(env, phone, {
        contactName: interpretation.contactName,
        contactEmail: interpretation.emailTo || interpretation.contactEmail,
      });
      if (!recipient?.email) {
        const attachment = descriptor ? await storeIncomingMedia(env, phone, message) : null;
        await setOwnerSession(env, phone, 'await_reminder_recipient', {
          eventId: linkedEvent?.id || '',
          title,
          eventAt,
          to: '',
          recipientName: interpretation.contactName,
          from: identity.from, agent: identity.agent, senderName: identity.senderName,
          subject: interpretation.emailSubject,
          body: interpretation.emailBody,
          requiresAttachment: needsAttachment,
          imageEditPrompt: interpretation.imageEditPrompt,
          attachment,
        });
        await reply('¿A qué correo debo enviárselo? Si ya lo guardaste, dime el nombre tal como lo tienes en tus contactos.');
        return true;
      }
      const state = {
        eventId: linkedEvent?.id || '',
        title,
        eventAt,
        to: recipient.email,
        recipientName: recipient.name || interpretation.contactName,
        from: identity.from, agent: identity.agent, senderName: identity.senderName,
        subject: interpretation.emailSubject,
        body: interpretation.emailBody,
        requiresAttachment: needsAttachment,
        imageEditPrompt: interpretation.imageEditPrompt,
      };
      if (needsAttachment && !descriptor) {
        await setOwnerSession(env, phone, 'await_reminder_attachment', state);
        await reply('Perfecto. Envíame la foto y la dejaré unida al correo programado.');
        return true;
      }
      if (interpretation.imageEditPrompt && descriptor?.kind !== 'image') {
        await setOwnerSession(env, phone, 'await_reminder_attachment', state);
        await reply('Para hacer esa edición necesito una imagen. Envíamela y la dejo lista para el correo.');
        return true;
      }
      const attachment = descriptor ? await storeIncomingMedia(env, phone, message) : null;
      await scheduleEmailReminder(env, phone, addReminder, state, attachment);
      await reply(state.imageEditPrompt
        ? `Listo, voy a preparar la imagen y el correo para ${state.recipientName || state.to} quedará programado.`
        : `Listo, dejé el recordatorio y el correo para ${state.recipientName || state.to} programados.`);
    } else {
      await setOwnerSession(env, phone, 'await_reminder_time', {title: title || session?.state?.title || normalized});
      await reply(interpretation.clarification || '¿Qué necesitas que te recuerde y cuándo?');
    }
    return true;
  }
}
