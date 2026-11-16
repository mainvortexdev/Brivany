// Explicit dependencies keep executors independently testable.

export async function literalNote(context, services) {
  const { note, env, phone, reply } = context;
  const { storeExactMemory, getMemoryItem } = services;
if (note) {
    try {
      const id = await storeExactMemory(env, phone, 'note', {text:note,refs:[]});
      const stored = await getMemoryItem(env, phone, id);
      if(stored?.payload?.text !== note)throw Error('La lectura de comprobación no coincidió.');
      await reply(`Nota guardada y comprobada: ${note}`);
    } catch(error) { await reply('No pude comprobar el guardado de la nota. No voy a confirmarla como guardada.'); }
    return true;
  }
}

export async function stageImage(context, services) {
  const { descriptor, normalized, session, env, phone, message, reply } = context;
  const { storeIncomingMedia, setOwnerSession, donaOperationalReply } = services;
if (descriptor?.kind === 'image' && !normalized && (!session || session.type === 'staging')) {
    try {
      const reference = await storeIncomingMedia(env, phone, message);
      const refs = (session?.state?.refs || []).filter((item) => item?.kind !== 'image');
      await setOwnerSession(env, phone, 'staging', {
        ...(session?.state || {}), refs: [...refs, reference],
      });
      // WhatsApp may deliver an image and its caption/text as separate webhook
      // events. Keep this acknowledgement neutral so the next text can trigger
      // the requested work without being asked to repeat the caption.
      await reply(await donaOperationalReply(env, { event: 'activity_image_received', savedPrivately: true }, 'Ya tengo la foto, Daniel 🌸 La guardé como contexto para tenerla presente.'));
    } catch (error) {
      console.error(JSON.stringify({ event: 'owner_image_stage_error', error: error instanceof Error ? error.message : String(error) }));
      await reply('No pude guardar esa imagen de forma privada. Envíamela otra vez, por favor.');
    }
    return true;
  }
}

export async function continueRetrieval(context, services) {
  const { session, env, phone, reply, normalized, markTyping, sendText, interpretation } = context;
  const { getMemoryItem, clearOwnerSession, resolveRetrievalSelection, sendReference } = services;
if (session?.type === 'retrieve') {
    if (interpretation?.intent && !['chat', 'recall_memory', 'retrieve_document'].includes(interpretation.intent)) return;
    const item = await getMemoryItem(env, phone, session.state.itemId);
    if (!item) {
      await clearOwnerSession(env, phone);
      await reply('Ese recuerdo ya no está disponible.');
      return true;
    }
    const selection = await resolveRetrievalSelection(env, normalized, item).catch((error) => {
      console.error(JSON.stringify({ event: 'owner_retrieval_interpretation_error', error: error instanceof Error ? error.message : String(error) }));
      return 'unclear';
    });
    const sendPrompt = (selection === 'both' || selection === 'prompt' || selection === 'credential') && Boolean(item.payload.text);
    const sendRefs = (selection === 'both' || selection === 'reference') && Boolean(item.payload.refs?.length);
    if (!sendPrompt && !sendRefs) {
      await reply(item.payload.refs?.length && item.payload.text
        ? 'No quiero asumir. ¿Prefieres el prompt, la referencia o los dos?'
        : 'No quiero asumir. ¿Quieres que te lo envíe?');
      return true;
    }
    await clearOwnerSession(env, phone);
    await markTyping();
    if (sendPrompt && item.payload.text) await sendText(env, phone, item.payload.text);
    if (sendRefs) for (const reference of item.payload.refs || []) await sendReference(env, phone, reference, sendText);
    return true;
  }
}

export async function capture_start(context, services) {
  const { interpretation, env, phone } = context;
  const { setOwnerSession } = services;
if (interpretation.intent === 'capture_start') {
    await setOwnerSession(env, phone, 'capture', { prompt: '', refs: [], autoFinish: true, itemType: 'prompt' });
    return true;
  }
}

export async function store_credential(context, services) {
  const { interpretation, env, phone, normalized, reply } = context;
  const { storeExactMemory } = services;
if (interpretation.intent === 'store_credential') {
    const label = interpretation.label || 'credencial';
    await storeExactMemory(env, phone, 'credential', { text: normalized, label, refs: [] });
    await reply(`Guardé la credencial de ${label} en tu memoria privada cifrada.`);
    return true;
  }
}

export async function store_contact(context, services) {
  const { interpretation, reply, env, phone } = context;
  const { upsertOwnerContact } = services;
if (interpretation.intent === 'store_contact') {
    if (!interpretation.contactName || !interpretation.contactEmail) {
      await reply('Pásame el nombre y la dirección de correo de esa persona y la guardaré para ti.');
      return true;
    }
    const contact = await upsertOwnerContact(env, phone, {
      name: interpretation.contactName,
      email: interpretation.contactEmail,
    });
    await reply(`Listo 🤍 Guardé el correo de ${contact.name} para que puedas pedírmelo sin volver a escribirlo.`);
    return true;
  }
}

export async function continueMemoryCapture(context, services) {
  const { session, interpretation, descriptor, env, phone, message, links, normalized, reply } = context;
  const { storeIncomingMedia, setOwnerSession, finishCapture } = services;
const isMemoryContinuation = (session?.type === 'capture' && ['chat','capture_start','stage_memory','save_memory'].includes(interpretation.intent))
  || (session?.type === 'staging' && ['stage_memory','save_memory'].includes(interpretation.intent));
if (isMemoryContinuation) {
    // A file received before its instruction remains available as staged
    // memory. Only reference/memory turns are consumed here; document,
    // reminder, image and normal chat intents continue to their own handlers.
    const state = session.state;
    if (descriptor) state.refs = [...(state.refs || []), await storeIncomingMedia(env, phone, message)];
    if (links.length) state.refs = [...(state.refs || []), ...links];
    const textWithoutLinks = links.reduce((text, link) => text.replace(link.url, ''), normalized).trim();
    if (textWithoutLinks && interpretation.intent !== 'save_memory' && !descriptor) state.prompt = state.prompt || textWithoutLinks;
    // A deliberate capture is silent until its promised reference arrives. This
    // prevents a partial prompt from being acknowledged as if it were complete.
    if (interpretation.intent === 'save_memory' && state.autoFinish && !state.refs?.length) {
      await setOwnerSession(env, phone, session.type, state);
      return true;
    }
    if (interpretation.intent === 'save_memory' || (state.autoFinish && state.prompt && state.refs?.length)) {
      const stored = await finishCapture(env, phone, state);
      await reply(stored.hasReference && stored.hasText ? 'Listo, guardé el prompt junto con su referencia.' : 'Listo, quedó guardado en tu memoria privada.');
      return true;
    }
    await setOwnerSession(env, phone, session.type, state);
    // During a capture Melodi reads every message but stays silent until the
    // reference arrives and the user asks to save, as requested by the owner.
    return true;
  }
}

export async function recall_memory(context, services) {
  const { interpretation, env, phone, normalized, reply } = context;
  const { findMemoryItems, getMemoryItem, replyForFoundItem } = services;
if (interpretation.intent === 'recall_memory') {
    const matches = await findMemoryItems(env, phone, normalized);
    if (!matches.length) {
      await reply('No encontré un recuerdo que coincida con eso. Dame una palabra o detalle más específico.');
      return true;
    }
    const item = await getMemoryItem(env, phone, matches[0].id);
    await replyForFoundItem(env, phone, item, reply);
    return true;
  }
}

export async function save_memory(context, services) {
  const { interpretation, normalized, env, phone, reply } = context;
  const { storeExactMemory } = services;
if (interpretation.intent === 'save_memory') {
    if (normalized) {
      await storeExactMemory(env, phone, 'note', { text: normalized, refs: [] });
      await reply('Listo, quedó guardado exactamente en tu memoria privada.');
    } else {
      await reply('No tengo nada pendiente para guardar. Envíame el contenido o la referencia.');
    }
    return true;
  }
}

export async function stageMemory(context, services) {
  const { descriptor, links, interpretation, normalized, env, phone, message, reply } = context;
  const { storeIncomingMedia, setOwnerSession, donaOperationalReply } = services;
if (descriptor || links.length || interpretation.intent === 'stage_memory') {
    // Captions are part of the owner's intent.  Retaining them makes a media
    // item recoverable even if a model route is temporarily unavailable.
    const state = { prompt: normalized, refs: [], autoFinish: false, itemType: 'prompt' };
    if (descriptor) state.refs.push(await storeIncomingMedia(env, phone, message));
    state.refs.push(...links);
    await setOwnerSession(env, phone, 'staging', state);
    if (descriptor?.kind === 'image') {
      await reply(await donaOperationalReply(env,
        { event: 'activity_image_received', savedPrivately: true, noStoryRequestDetected: true },
        'Ya tengo la foto, Daniel 🌸 La guardé como contexto para tenerla presente.'));
    }
    return true;
  }
}
