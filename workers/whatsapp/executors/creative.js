// Explicit dependencies keep executors independently testable.

export async function continueAudio(context, services) {
  const { session, descriptor, env, phone, message, reply } = context;
  const { storeIncomingMedia, clearOwnerSession, enqueueOwnerJob } = services;
if (session?.type === 'await_audio' && descriptor?.kind === 'audio') {
    const reference = await storeIncomingMedia(env, phone, message);
    await clearOwnerSession(env, phone);
    await enqueueOwnerJob(env, phone, 'transcribe_audio', { reference });
    await reply('Estoy transcribiendo el audio.');
    return true;
  }
}

export async function continueImageEdit(context, services) {
  const { session, descriptor, reply, env, phone, message } = context;
  const { storeIncomingMedia, clearOwnerSession, enqueueOwnerJob, cleanText } = services;
if (session?.type === 'await_image_edit' && descriptor) {
    if (descriptor.kind !== 'image') {
      await reply('Para esa edición necesito que me envíes una imagen. La indicación quedó guardada.');
      return true;
    }
    const state = session.state;
    const prompt = cleanText(state.prompt).slice(0, 1_200);
    const mode = state.mode === 'recreate' ? 'recreate' : 'edit';
    if (context.authorizeImageEdit && !await context.authorizeImageEdit({ prompt, mode })) return true;
    const reference = await storeIncomingMedia(env, phone, message);
    await clearOwnerSession(env, phone);
    await enqueueOwnerJob(env, phone, 'edit_image', {
      source: reference,
      prompt,
      mode,
    });
    await reply('Perfecto ✨ Estoy trabajando sobre esa imagen y te la envío en cuanto esté lista.');
    return true;
  }
}

export async function readStagedImage(context, services) {
  const { stagedImage, normalized, env, phone, reply } = context;
  const { isImageTextRequest, readTextFromStagedImage, clearOwnerSession } = services;
if (stagedImage && normalized && isImageTextRequest(normalized)) {
    try {
      const transcription = await readTextFromStagedImage(env, stagedImage);
      await clearOwnerSession(env, phone);
      await reply(transcription);
    } catch (error) {
      console.error(JSON.stringify({ event: 'owner_image_text_error', error: error instanceof Error ? error.message : String(error) }));
      await reply('No pude leer el texto de esa imagen ahora. La foto sigue guardada para que puedas pedírmelo de nuevo.');
    }
    return true;
  }
}

export async function editStagedImage(context, services) {
  const { stagedImage, normalized, env, phone, reply } = context;
  const { classifyAttachedImageEdit, clearOwnerSession, enqueueOwnerJob } = services;
if (stagedImage && normalized) {
    const imageEdit = await classifyAttachedImageEdit(env, normalized, true).catch(() => ({ edit: false }));
    if (imageEdit.edit && imageEdit.prompt) {
      const prompt = normalized.slice(0, 1_200);
      const mode = imageEdit.mode === 'recreate' ? 'recreate' : 'edit';
      if (context.authorizeImageEdit && !await context.authorizeImageEdit({ prompt, mode, source: stagedImage })) return true;
      await clearOwnerSession(env, phone);
      await enqueueOwnerJob(env, phone, 'edit_image', {
        source: stagedImage,
        prompt,
        mode,
      });
      await reply('Entendido ✨ Estoy editando la imagen que ya me enviaste y te la paso en cuanto esté lista.');
      return true;
    }
  }
}

export async function edit_image(context, services) {
  const { interpretation, descriptor, stagedImage, reply, normalized, env, phone, message } = context;
  const { setOwnerSession, cleanText, storeIncomingMedia, enqueueOwnerJob } = services;
if (interpretation.intent === 'edit_image') {
    if (descriptor && descriptor.kind !== 'image') {
      await reply('Para editarla necesito una imagen.');
      return true;
    }
    // Intent classification must not paraphrase away the exact source/target
    // strings, accents or case needed by the deterministic text editor.
    const prompt = cleanText(normalized || interpretation.imageEditPrompt).slice(0, 1_200);
    const mode = interpretation.imageEditMode === 'recreate' ? 'recreate' : 'edit';
    if (context.authorizeImageEdit && !await context.authorizeImageEdit({ prompt, mode })) return true;
    if (!descriptor && !stagedImage) {
      await setOwnerSession(env, phone, 'await_image_edit', {
        prompt,
        mode,
      });
      await reply('Envíame la imagen y la edito cuidando de no tocar nada fuera de lo que me pidas.');
      return true;
    }
    const reference = descriptor ? await storeIncomingMedia(env, phone, message) : stagedImage;
    await enqueueOwnerJob(env, phone, 'edit_image', {
      source: reference,
      prompt,
      mode,
    });
    await reply('Estoy trabajando sobre esa imagen y te la envío en cuanto esté lista ✨');
    return true;
  }
}

export async function generate_image(context, services) {
  const { interpretation, normalized, reply, env, phone } = context;
  const { enqueueOwnerJob } = services;
if (interpretation.intent === 'generate_image') {
    if (!normalized) await reply('Dime cómo quieres la imagen.');
    else {
      await enqueueOwnerJob(env, phone, 'generate_image', { prompt: normalized });
      await reply('✨ Voy a generar la imagen. Te la envío en cuanto esté lista.');
    }
    return true;
  }
}

export async function video_request(context, services) {
  const { interpretation, reply } = context;
if (interpretation.intent === 'video_request') {
    await reply('La generación de vídeo está desactivada por ahora para que todo se mantenga ágil y confiable. Sí puedo ayudarte con imágenes, documentos y transcripciones ✨');
    return true;
  }
}

export async function transcribe_audio(context, services) {
  const { interpretation, descriptor, env, phone, message, reply } = context;
  const { storeIncomingMedia, enqueueOwnerJob, setOwnerSession } = services;
if (interpretation.intent === 'transcribe_audio') {
    if (descriptor?.kind === 'audio') {
      const reference = await storeIncomingMedia(env, phone, message);
      await enqueueOwnerJob(env, phone, 'transcribe_audio', { reference });
      await reply('Estoy transcribiendo el audio.');
    } else {
      await setOwnerSession(env, phone, 'await_audio', {});
      await reply('Envíame el audio y lo transcribo.');
    }
    return true;
  }
}
