// Explicit dependencies keep executors independently testable.

export async function job_generate_image(context, services) {
  const { env, row, payload, jobId } = context;
  const { ownerImageGenerationReferences, callVetsa, sendWhatsAppMedia, base64ToBytes, rememberGeneratedImage } = services;

      const references = await ownerImageGenerationReferences(env, row.owner_phone);
      const { visualGuidance, ...imageReferences } = references;
      const appearance = ` Si representas a Daniel Luna, conserva sus rasgos reconocibles y su estilo distintivo: suéter blanco, cadena y un solo AirPod; no lo sustituyas por otra persona. No es obligatorio incluirlo si la idea funciona mejor sin personas.${visualGuidance ? ` Usa además la última inspiración visual guardada como guía de estilo/composición, no de identidad: ${visualGuidance}` : ''}`;
      const result = await callVetsa(env, { model: 'spaik-image', contents: `${payload.prompt}${appearance}`, options: { aspect_ratio: '1:1', requestId: jobId, ...imageReferences } });
      if (result.status === 'processing') throw new Error('image_processing');
      if (!result.imageBase64) throw new Error('Image generation returned no media');
      const generated = base64ToBytes(result.imageBase64), imageType = result.mimeType || 'image/jpeg';
      await sendWhatsAppMedia(env, row.owner_phone, 'image', generated, imageType, 'melodi-imagen.jpg', 'Imagen generada por Melodi');
      // Entregada la imagen, queda guardada para que el titular pueda pedir un
      // cambio sobre ella en el siguiente mensaje sin reenviarla.
      if (typeof rememberGeneratedImage === 'function') {
        try { await rememberGeneratedImage(env, row.owner_phone, generated, imageType); }
        catch { console.error(JSON.stringify({ event: 'generated_image_not_retained' })); }
      }
    
}

export async function job_generate_story(context, services) {
  const { env, row, jobId, payload } = context;
  const { prepareSingleStory, sendWhatsAppMedia, removeStagedImage } = services;

      await prepareSingleStory(env, row.owner_phone, jobId, payload.prompt, payload.scheduledAt, sendWhatsAppMedia, payload.activityReference || null, payload.includeOwner === true, { privateDraft: payload.deliveryMode === 'private' });
      if (payload.activityReference?.objectKey) await removeStagedImage(env, row.owner_phone, payload.activityReference.objectKey);
    
}

export async function job_edit_image(context, services) {
  const { env, row, payload } = context;
  const { editImageForScheduledEmail, attachmentFromPrivateReference, sendWhatsAppMedia } = services;

      const reference = await editImageForScheduledEmail(env, row.owner_phone, payload.source, payload.prompt, payload.mode);
      const attachment = await attachmentFromPrivateReference(env, reference);
      try {
        await sendWhatsAppMedia(env, row.owner_phone, reference.precise ? 'document' : 'image', attachment.bytes, attachment.mimeType, attachment.fileName,
          reference.precise ? 'Texto editado y verificado. Archivo PNG.' : 'Imagen editada por Melodi');
      } catch (error) {
        // Some Meta configurations reject image MIME types in document messages.
        // Fall back only on an explicit parameter rejection, never on a timeout
        // or ambiguous response that could cause duplicate accepted messages.
        if (!reference.precise || !error.mediaTypeRejected) throw error;
        await sendWhatsAppMedia(env, row.owner_phone, 'image', attachment.bytes, attachment.mimeType, attachment.fileName,
          'Texto editado y verificado. Vista previa; el PNG original está guardado.');
      }
    
}

export async function job_transcribe_audio(context, services) {
  const { env, payload, sendText, row } = context;
  const { bytesToBase64, cleanText } = services;

      const object = await env.VETSA_MEDIA.get(payload.reference.objectKey);
      if (!object) throw new Error('Audio reference is missing');
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (!env.AI) throw new Error('Workers AI transcription binding is missing');
      const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
        audio: bytesToBase64(bytes),
        task: 'transcribe',
        language: 'es',
        vad_filter: true,
        initial_prompt: 'Transcribe fielmente en español. Conserva nombres propios, números y estructura.',
      });
      const transcription = cleanText(result?.text || result?.transcription_info?.text);
      if (!transcription) throw new Error('Transcription returned no text');
      await sendText(env, row.owner_phone, transcription);
    
}
