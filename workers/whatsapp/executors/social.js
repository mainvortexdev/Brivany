// Explicit dependencies keep executors independently testable.

export async function continueStoryPortrait(context, services) {
  const { session, descriptor, reply, env, phone, message } = context;
  const { storeIncomingMedia, saveStoryPortrait, clearOwnerSession, enqueueOwnerJob } = services;
if (session?.type === 'await_story_portrait') {
    if (descriptor?.kind !== 'image') {
      await reply('Para que la historia conserve tu apariencia real, envíame una foto tuya nítida, de frente o tres cuartos, con el rostro visible, sin filtros fuertes y sin otras personas. JPEG o PNG, hasta 5 MB.');
      return true;
    }
    try {
      const reference = await storeIncomingMedia(env, phone, message);
      await saveStoryPortrait(env, phone, reference);
      const pending = session.state || {};
      await clearOwnerSession(env, phone);
      if (pending.purpose === 'create') {
        await enqueueOwnerJob(env, phone, 'generate_story', { prompt: pending.prompt, scheduledAt: pending.scheduledAt, activityReference: pending.activityReference || null, includeOwner: true });
        await reply('Ya guardé tu foto de referencia en privado y verifiqué el archivo 🌸 Ahora estoy creando la primera historia. Te enviaré la imagen por WhatsApp; no se publicará.');
      } else {
        await reply('Ya guardé tu foto de referencia en privado y comprobé que el archivo está listo 🌸');
      }
    } catch (error) {
      await reply(error instanceof Error ? error.message : 'No pude guardar la referencia. Envíame una foto JPEG o PNG nítida.');
    }
    return true;
  }
}

export async function story_portrait(context, services) {
  const { interpretation, descriptor, reply, env, phone, message } = context;
  const { storeIncomingMedia, saveStoryPortrait } = services;
if (interpretation.intent === 'story_portrait') {
    if (descriptor?.kind !== 'image') {
      await reply('Envíame una foto tuya en JPEG o PNG y dime que es mi referencia para las historias. La guardaré de forma privada.');
      return true;
    }
    try {
      const reference = await storeIncomingMedia(env, phone, message);
      await saveStoryPortrait(env, phone, reference);
      await reply('Guardé esta foto en tu colección privada de referencias. Puedes enviarme otras para variar las historias; usaré solo las fotos que tú me proporciones.');
    } catch (error) {
      await reply(error instanceof Error ? error.message : 'No pude guardar la foto de referencia.');
    }
    return true;
  }
}

export async function story_visual_reference_save(context, services) {
  const { interpretation, descriptor, env, phone, message, stagedImage, reply, normalized } = context;
  const { storeIncomingMedia, saveStoryVisualReference, clearOwnerSession } = services;
if (interpretation.intent === 'story_visual_reference_save') {
    const source = descriptor?.kind === 'image' ? await storeIncomingMedia(env, phone, message) : stagedImage;
    if (!source) {
      await reply('Envíame la imagen que quieres que conserve como inspiración visual. La guardaré aparte de tu foto de identidad y la usaré para futuras imágenes hasta que la actualices o me pidas dejar de usarla. 🌸');
      return true;
    }
    try {
      await saveStoryVisualReference(env, phone, source, normalized);
      if (stagedImage && !descriptor) await clearOwnerSession(env, phone);
      await reply('Listo 🌸 Guardé esta inspiración visual de forma persistente, separada de tu foto de identidad. La aplicaré a futuras historias e imágenes; cuando aparezcas, conservaré tu suéter blanco, la cadena y un AirPod. No hace falta que salgas en todas las historias.');
    } catch (error) {
      await reply(error instanceof Error ? error.message : 'No pude guardar la referencia visual.');
    }
    return true;
  }
}

export async function story_visual_reference_stop(context, services) {
  const { interpretation, env, phone, reply } = context;
if (interpretation.intent === 'story_visual_reference_stop') {
    const result = await env.VETSA_CLOUD.prepare(`UPDATE wa_story_visual_refs SET active=0,updated_at=? WHERE owner_phone=? AND active=1`)
      .bind(new Date().toISOString(), phone).run();
    await reply(result.meta.changes
      ? 'He dejado de usar tus referencias visuales anteriores. Tu foto de identidad permanece intacta 🌸'
      : 'No había una referencia visual activa que retirar; tu foto de identidad sigue intacta.');
    return true;
  }
}

export async function story_auto_on(context, services) {
  const { interpretation, env, phone, reply } = context;
  const { setStoryAutoPublish } = services;
if (interpretation.intent === 'story_auto_on' || interpretation.intent === 'story_auto_off') {
    const enabled = interpretation.intent === 'story_auto_on';
    await setStoryAutoPublish(env, phone, enabled);
    await reply(enabled
      ? 'Entendido 🌸 Para las historias de Instagram, dejaré de pedir confirmación: te mostraré la imagen y publicaré cada historia en su horario programado. Puedes pedirme que vuelva a solicitar aprobación cuando quieras.'
      : 'Listo 🌸 Volveré a mostrarte cada historia y esperaré tu aprobación antes de publicarla.');
    return true;
  }
}

export async function story_single_create(context, services) {
  const { interpretation, env, normalized, descriptor, phone, message, reply, stagedImage, session } = context;
  const { storyIncludesOwner, storeIncomingMedia, storyPortraitExists, setOwnerSession, enqueueOwnerJob, cleanText, donaOperationalReply } = services;
if (interpretation.intent === 'story_single_create') {
    const includeOwner = await storyIncludesOwner(env, normalized);
    let activityReference = null;
    if (descriptor?.kind === 'image') {
      try { activityReference = await storeIncomingMedia(env, phone, message); }
      catch (error) {
        await reply(error instanceof Error ? error.message : 'No pude leer la foto de tu actividad. Envíamela otra vez.');
        return true;
      }
    } else if (stagedImage) {
      activityReference = stagedImage;
    }
    if (activityReference && (activityReference.size > 5_000_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(activityReference.mimeType))) {
      await reply('La foto de contexto debe ser JPEG, PNG o WebP y pesar hasta 5 MB para poder crear la historia. Envíamela comprimida y la usaré como referencia de la actividad, no como tu foto de identidad.');
      return true;
    }
    if (includeOwner && !await storyPortraitExists(env, phone)) {
      await setOwnerSession(env, phone, 'await_story_portrait', { purpose: 'create', prompt: normalized, scheduledAt: interpretation.eventAt || null, activityReference });
      await reply('Antes de crearla necesito una foto tuya para conservar tu apariencia real. Envíame una foto nítida, de frente o tres cuartos, con el rostro visible, sin filtros fuertes y sin otras personas. JPEG o PNG, hasta 5 MB.');
      return true;
    }
    if (activityReference && descriptor?.kind === 'image') {
      const existingRefs = session?.type === 'staging' ? (session.state.refs || []) : [];
      await setOwnerSession(env, phone, 'staging', {
        ...(session?.type === 'staging' ? session.state : {}),
        refs: [...existingRefs.filter((reference) => reference?.kind !== 'image'), activityReference],
      });
    }
    const activeJob = !descriptor ? await env.VETSA_CLOUD.prepare(`SELECT id FROM wa_owner_jobs
      WHERE owner_phone=? AND job_type='generate_story' AND status IN ('pending','processing','waiting')
      ORDER BY created_at DESC LIMIT 1`).bind(phone).first() : null;
    if (activeJob) {
      await reply('Sí, sigo con tu historia 🌸 Ya tengo la imagen y la estrategia; te paso la vista previa en cuanto termine.');
      return true;
    }
    await enqueueOwnerJob(env, phone, 'generate_story', { prompt: normalized, scheduledAt: interpretation.eventAt, activityReference, includeOwner });
    await reply('La historia quedó en cola. Te enviaré la vista previa cuando esté lista; todavía no se ha publicado.');
    return true;
  }
}

export async function story_campaign_start(context, services) {
  const { interpretation, env, phone, normalized, reply } = context;
  const { startStoryCampaign, setOwnerSession } = services;
if (interpretation.intent === 'story_campaign_start') {
    try {
      const result = await startStoryCampaign(env, phone, normalized);
      if (result.error === 'portrait_missing') {
        await setOwnerSession(env, phone, 'await_story_portrait', { purpose: 'campaign', prompt: normalized });
        await reply('Para iniciar la campaña necesito primero una foto tuya de referencia. Envíame una foto nítida, de frente o tres cuartos, con el rostro visible, sin filtros fuertes y sin otras personas. JPEG o PNG, hasta 5 MB.');
      }
      else if (result.error === 'image_key_missing') await reply('La campaña está preparada, pero Spaik Image aún no tiene su clave privada configurada. No programé ni publiqué historias.');
      else if (result.error === 'instagram_not_ready') await reply('Instagram todavía no está listo para publicar desde la app. No programé ni publiqué historias.');
      else if (result.error === 'already_active') await reply('Ya tienes una campaña semanal activa. Puedo mostrarte su avance o pausarla.');
      else await reply(`Programé ${result.count} historias para siete días, comenzando mañana. Dos en la mañana, una en la tarde y una en la noche. Publicaré solo las imágenes que el sistema genere correctamente; cualquier fallo quedará marcado para revisión.`);
    } catch (error) {
      console.error(JSON.stringify({ event: 'story_campaign_start_error', error: error instanceof Error ? error.message : String(error) }));
      await reply('No pude activar la campaña. No se publicó nada.');
    }
    return true;
  }
}

export async function story_campaign_pause(context, services) {
  const { interpretation, reply, env, phone } = context;
  const { pauseStoryCampaign } = services;
if (interpretation.intent === 'story_campaign_pause') {
    await reply(await pauseStoryCampaign(env, phone) ? 'Pausé la campaña. No se enviarán nuevas historias.' : 'No hay una campaña activa que pausar.');
    return true;
  }
}

export async function story_campaign_status(context, services) {
  const { interpretation, env, phone, reply } = context;
  const { storyCampaignStatus } = services;
if (interpretation.intent === 'story_campaign_status') {
    const campaign = await storyCampaignStatus(env, phone);
    await reply(campaign ? `Campaña ${campaign.status}: ${campaign.progress.published || 0} publicadas, ${campaign.progress.ready || 0} preparadas, ${campaign.progress.needs_review || 0} requieren revisión.` : 'Aún no hay una campaña semanal de historias.');
    return true;
  }
}

export async function instagram_operation(context, services) {
  const { interpretation, env, phone, reply, descriptor, message, normalized, sendText } = context;
  const { approvePendingStory, sendInstagramOwnerCommand, isoNow, storeIncomingMedia, autoPublish, trackPreparedStory, processInstagramInbox } = services;
if (interpretation.intent === 'instagram_operation') {
    try {
      if (interpretation.instagramAction === 'approve_operation') {
        const story = await approvePendingStory(env, phone);
        if (story) {
          if (story.kind === 'single') {
            const health = await env.VETSA_INSTAGRAM_OPERATIONS?.fetch('https://instagram.internal/health');
            const healthData = await health?.json().catch(() => ({}));
            if (!health?.ok || healthData?.publishingReady !== true || healthData?.mediaDeliveryReady !== true) {
              await reply('La imagen ya está lista y guardada 🌸 Instagram todavía no está vinculado a Vetsa Manager. Cuando lo vuelvas a conectar, dime “publícala” y continuaré con esta misma imagen.');
              return true;
            }
            const prepared = await sendInstagramOwnerCommand(env, {
              ownerPhone: phone, action: 'prepare_story', operationId: story.id,
              instagramAccountId: env.INSTAGRAM_ACCOUNT_ID || '',
              media: { objectKey: story.object_key, mimeType: story.mime_type },
              text: 'Historia de Instagram de Daniel Luna',
            });
            if (!prepared.operation?.id) throw new Error('Instagram did not prepare the approved story.');
            await env.VETSA_CLOUD.prepare('UPDATE wa_story_single_drafts SET approved_at=?,updated_at=? WHERE id=? AND owner_phone=? AND approved_at IS NULL')
              .bind(isoNow(), isoNow(), story.id, phone).run();
            await reply(story.scheduled_at > new Date().toISOString()
              ? 'Historia aprobada 🌸 La publicaré en el horario programado.'
              : 'Historia aprobada 🌸 La enviaré a Instagram en el próximo ciclo.');
          } else {
            const approved = await env.VETSA_CLOUD.prepare(`UPDATE wa_story_slots SET approved_at=?,updated_at=?
              WHERE id=? AND owner_phone=? AND status='ready' AND preview_sent_at IS NOT NULL AND approved_at IS NULL`)
              .bind(isoNow(), isoNow(), story.id, phone).run();
            await reply(!approved.meta.changes
              ? 'Esa vista previa ya no está pendiente de aprobación. Compruebo su estado antes de intentar otra publicación.'
              : story.scheduled_at > new Date().toISOString()
                ? 'Historia aprobada 🌸 La publicaré en el horario programado.'
                : 'Historia aprobada 🌸 La enviaré a Instagram en el próximo ciclo de publicación.');
          }
          return true;
        }
      }
      const media = descriptor ? await storeIncomingMedia(env, phone, message) : null;
      const result = await sendInstagramOwnerCommand(env, {
        ownerPhone: phone,
        action: interpretation.instagramAction,
        instagramAccountId: interpretation.instagramAccountId,
        operationId: interpretation.instagramOperationId,
        text: normalized,
        media,
        metadata: {
          automationMessage: interpretation.instagramAutomationMessage,
          hours: interpretation.instagramPermissionHours,
        },
      });
      const operation = result.operation;
      if (interpretation.instagramAction === 'prepare_story' && media?.objectKey && operation?.id && await autoPublish(env, phone)) {
        await trackPreparedStory(env, phone, operation.id, media, interpretation.eventAt);
        await reply(interpretation.eventAt && Date.parse(interpretation.eventAt) > Date.now()
          ? 'Recibí la imagen 🌸 La historia quedó programada para la hora que indicaste; el modo automático está activo.'
          : 'Recibí la imagen 🌸 La historia quedó en cola para publicarse sin otra confirmación, como me pediste.');
        return true;
      }
      if (interpretation.instagramAction === 'operation_status') {
        if (!operation) {
          await reply('No veo ninguna operación reciente de Instagram. Cuando prepares una, la guardaré aquí para que puedas revisarla.');
        } else {
          const labels = { prepare_post: 'publicación', prepare_story: 'historia', prepare_reel: 'reel', prepare_campaign: 'automatización', prepare_reply: 'respuesta' };
          const states = { draft: 'esperando tu confirmación', approved: 'aprobada y en cola', completed: 'publicada', failed: 'detenida por un error' };
          await reply(`La ${labels[operation.operation_kind] || 'operación'} más reciente está ${states[operation.status] || operation.status}.`);
        }
      } else if (interpretation.instagramAction === 'approve_operation') {
        await reply(`Listo 🤍 La operación quedó aprobada${operation?.id ? ` (${operation.id.slice(0, 8)})` : ''}. Te aviso si Meta necesita algo más.`);
      } else if (interpretation.instagramAction === 'grant_reply_access') {
        const expiresAt = result.grant?.expiresAt ? new Date(result.grant.expiresAt).toLocaleString('es-DO', { timeZone: env.TIME_ZONE || 'America/Santo_Domingo' }) : '';
        await reply(`Entendido 🤍 Desde ahora responderé los mensajes pendientes de Instagram${expiresAt ? ` hasta ${expiresAt}` : ''}. Las respuestas obligatorias por palabra clave continúan siempre activas.`);
        await processInstagramInbox(env, sendText).catch((error) => console.error(JSON.stringify({ event: 'instagram_inbox_after_grant_error', error: error instanceof Error ? error.message : String(error) })));
      } else if (interpretation.instagramAction === 'revoke_reply_access') {
        await reply('Listo. Dejé de responder automáticamente los mensajes generales de Instagram. Las reglas obligatorias que configuraste siguen activas.');
      } else if (interpretation.instagramAction === 'prepare_campaign') {
        await reply(`Preparé la automatización como borrador${operation?.id ? ` (${operation.id.slice(0, 8)})` : ''}. Revísala conmigo y solo la activaremos cuando me confirmes.`);
      } else {
        const labels = { prepare_post: 'publicación', prepare_story: 'historia', prepare_reel: 'reel', prepare_reply: 'respuesta' };
        await reply(`Ya tengo preparada la ${labels[interpretation.instagramAction] || 'operación'}${operation?.id ? ` (${operation.id.slice(0, 8)})` : ''}. Dime “publícala” cuando quieras que la ejecute.`);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: 'instagram_owner_command_error', error: messageText }));
      if (messageText.includes('Attach an image or video')) {
        await reply('Envíame la foto o el video que quieres usar y preparo el borrador. No publicaré nada todavía.');
      } else if (messageText.includes('Define the private reply')) {
        await reply('Cuéntame qué debe decir el mensaje privado que recibirán las personas y preparo la automatización contigo.');
      } else {
        await reply('La conexión de Instagram todavía está terminando de configurarse. No publiqué ni envié nada.');
      }
    }
    return true;
  }
}
