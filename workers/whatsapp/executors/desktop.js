// Explicit dependencies keep executors independently testable.

export async function requestDesktopLink(context, services) {
  const { linkMessage, env, reply, phone } = context;
  const { setOwnerSession, cleanText } = services;
if (linkMessage?.action === 'request') {
    const device = await env.VETSA_CLOUD.prepare(`
      SELECT device_name, link_code_created_at FROM stacy_devices
      WHERE link_code = ? AND user_id IS NULL
    `).bind(linkMessage.code).first();
    const createdAt = Date.parse(device?.link_code_created_at || '');
    if (!device || !Number.isFinite(createdAt) || Date.now() - createdAt > 10 * 60_000 || createdAt > Date.now() + 30_000) {
      await reply('Ese código no es válido o ha expirado. Genera otro desde Cognira Desktop.');
      return true;
    }
    await setOwnerSession(env, phone, 'await_stacy_link', { code: linkMessage.code, expiresAt: new Date(createdAt + 10 * 60_000).toISOString() });
    await reply(`Encontré «${cleanText(device.device_name || 'tu PC').slice(0, 80)}». ¿Confirmas vincularlo a este WhatsApp? Responde Sí o No.`);
    return true;
  }
}

export async function continueDesktopLink(context, services) {
  const { session, linkMessage, env, phone, reply } = context;
  const { clearOwnerSession, completeStacyLink } = services;
if (session?.type === 'await_stacy_link') {
    if (linkMessage?.action === 'reject') {
      await clearOwnerSession(env, phone);
      await reply('Vinculación cancelada. El código seguirá válido hasta que expire.');
      return true;
    }
    if (linkMessage?.action === 'approve') {
      await clearOwnerSession(env, phone);
      const linked = Date.parse(session.state?.expiresAt || '') > Date.now()
        && await completeStacyLink(env, phone, session.state.code);
      await reply(linked
        ? '✅ PC vinculada con Melodi. Ya puedes pedirme una captura de pantalla o una tarea en tu ordenador.'
        : 'El código expiró o ya se usó. Genera otro desde Cognira Desktop.');
      return true;
    }
  }
}

export async function stacy_screenshot(context, services) {
  const { interpretation, env, phone, reply, normalized, descriptor, message, stagedImage, stagedVideo } = context;
  const { findOwnerDevice, isStacyOnline, createStacyCommand, storeIncomingMedia } = services;
if (interpretation.intent === 'stacy_screenshot' || interpretation.intent === 'stacy_command' || interpretation.intent === 'stacy_status') {
    try {
      const device = await findOwnerDevice(env, phone);

      if (interpretation.intent === 'stacy_status') {
        if (!device) {
          await reply('No tengo ningún equipo vinculado. En Brivany abre Conexiones, vincula WhatsApp y activa el control de este ordenador.');
        } else if (isStacyOnline(device)) {
          await reply(`✅ Estoy en línea en ${device.device_name || 'tu PC'}. Recibí una señal del equipo hace menos de 5 minutos.`);
        } else {
          await reply(`⚠️ No estoy conectada a ${device.device_name || 'tu PC'}. Última señal: ${device.last_seen || 'desconocida'}. Verifica que Brivany esté abierta y el control de WhatsApp esté activo.`);
        }
        return true;
      }

      if (!device) {
        await reply('Necesito que vincules tu PC primero. En Brivany abre Conexiones, vincula WhatsApp y activa el control de este ordenador.');
        return true;
      }
      if (!isStacyOnline(device)) {
        await reply(`No estoy conectada a ${device.device_name || 'tu PC'} ahora mismo. Abre Brivany y vuelve a intentarlo.`);
        return true;
      }

      const commandType = interpretation.intent === 'stacy_screenshot' ? 'screenshot' : 'instruction';
      const instruction = interpretation.intent === 'stacy_screenshot'
        ? 'Captura de pantalla solicitada desde WhatsApp'
        : (interpretation.stacyInstruction || normalized || 'Comando remoto');

      const reference = commandType === 'instruction'
        ? (descriptor?.kind === 'image' ? await storeIncomingMedia(env, phone, message) : interpretation.desktopDrawing ? stagedImage : null) : null;
      const video = commandType === 'instruction' && interpretation.desktopVideo
        ? (descriptor?.kind === 'video' ? await storeIncomingMedia(env, phone, message) : stagedVideo) : null;
      if (interpretation.desktopVideo && !video) {
        await reply('Envíame el video junto con la petición de edición para que Melodi reciba el archivo.');
        return true;
      }
      if (interpretation.desktopDrawing && !reference && /\b(esto|esta imagen|esta foto)\b/i.test(normalized)) {
        await reply('Necesito la imagen de referencia para que Melodi dibuje eso en Paint. Envíala junto con la petición.');
        return true;
      }
      const commandId = await createStacyCommand(env, device.device_id, phone, commandType === 'instruction' && reference ? 'instruction_reference' : commandType, instruction, {
        ...(reference ? { referenceImage: { objectKey: reference.objectKey, mimeType: reference.mimeType } } : {}),
        ...(video ? { sourceVideo: { objectKey: video.objectKey, mimeType: video.mimeType } } : {}),
        returnArtifact: interpretation.returnArtifact === true,
        requestKey: message?.id,
      });
      console.log(JSON.stringify({ event: 'stacy_command_created', commandId, type: commandType, deviceId: device.device_id }));

      if (interpretation.intent === 'stacy_screenshot') {
        await reply('📸 Ya recibí tu solicitud. Estoy tomando la captura y te la enviaré cuando llegue del equipo.');
      } else {
        await reply(`🖥️ Recibí la tarea: "${instruction.slice(0, 100)}". Te aviso cuando el equipo confirme el resultado.`);
      }
    } catch (stacyErr) {
      console.error(JSON.stringify({ event: 'stacy_command_error', error: stacyErr instanceof Error ? stacyErr.message : String(stacyErr) }));
      await reply('No pude enviar el comando al equipo. Inténtalo de nuevo en un momento.');
    }
    return true;
  }
}
