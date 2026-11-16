# Prueba independiente de transcripción · 0.4.11

Estado del 9 de noviembre de 2026: preparada para la prueba manual en Brave.
No se ha medido todavía su latencia con el video del usuario ni confirmado
la desaparición del bloqueo en su navegador.

El manifiesto carga `transcription-background.js`; la acción inyecta
`transcription-client.js`. Ninguno importa el reproductor de traducción,
traducción automática, TTS ni controles del WorkSpace. La actualización retira
el registro `brivany-video-prefix` y deja de publicar los módulos del reproductor
anterior como recursos accesibles. Es necesario recargar tanto la extensión
como la pestaña para eliminar las instancias que ya estuvieran ejecutándose.

Si el reproductor expone subtítulos accesibles, se preparan antes de pulsar
Play y se identifican como «subtítulos del video». Si no los expone, se espera
audio; el reconocimiento comienza al reproducirse. Una pista de audio de un
MediaStream ya activa puede reconocerse sin esperar al estado visual de Play.
La opción «Reconocer audio» permite probar ASR aunque existan subtítulos.

El indicador de ASR mide desde el primer bloque PCM enviado hasta el primer
texto recibido. No incluye el tiempo que el usuario permanece con el video
pausado. El indicador de subtítulos mide la preparación del texto existente;
no demuestra velocidad de reconocimiento de voz.

El cliente nunca llama a `video.play()`/`pause()`, ni escribe `currentTime`,
`volume`, `muted` o `playbackRate`. Usa una cola PCM acotada y confirmaciones de
recepción; un fallo cierra solamente la transcripción. Las pistas de un
MediaStream original se clonan para no detenerlas al cerrar la herramienta.

Para esta prueba está activo el servicio local independiente en 127.0.0.1:48218,
iniciado mediante `tools/start_transcription_service.py`. No depende de abrir
la ventana de Brivany. La configuración existente se lee del almacén del usuario;
no se entrega al navegador. Este servicio debe estar ejecutándose para ASR.
No se ha integrado todavía su inicio en el instalador. No graba audio.

Validación: 87 pruebas JavaScript aprobadas, incluidas simulaciones de video
pausado, inicio de audio, subtítulos tardíos, retiro de scripts anteriores y
prohibición de modificar la reproducción. Las 16 pruebas de selected_video
aprobaron la entrega de texto parcial/final sin MT/TTS. El protocolo real local
aceptó autenticar/seleccionar/cerrar sin enviar audio ni abrir proveedores.
La comprobación en YouTube queda pendiente del usuario.
