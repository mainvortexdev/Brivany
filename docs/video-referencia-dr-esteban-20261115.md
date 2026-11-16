# Nueva referencia: Melodi y Dr. Esteban

15 de noviembre de 2026. El usuario sustituyó la referencia anterior y pidió su
mismo guion y duración, voz masculina para Dr. Esteban, tono de llamada y orbes
con giro fluido. Aclaró que la llamada fue real y retiró las menciones de datos
ficticios y demostración. La revisión anterior las incluía por el encargo previo
de recreación; esta corrección se registra separadamente, sin alterar el histórico.
La realidad de la llamada se recibe como aclaración del usuario, no como una
comprobación telefónica realizada por esta tarea.

## Implementación

El contrato de llamada admite duración fraccionaria, créditos en pantalla de cero
segundos cuando no hay medios externos que atribuir, etiqueta de demostración
explícita y opcional, género del interlocutor y tiempos medidos por turno y
fragmento. Los textos son datos: no se ejecutan instrucciones del video. Se
validan fragmentos sin solapamientos, su correspondencia con el guion completo y
que el tono inicial no tape la primera voz. Una nueva referencia con petición
de duración exacta prevalece sobre los segundos del proyecto anterior.

Melodi mantiene su voz seleccionada de Cartesia. El interlocutor masculino usa
Gonzalo, del catálogo consultado en el hito anterior. Los IDs siguen siendo
decisiones del adaptador; no se habilitan overrides públicos. Se reutilizan
fragmentos comprobando voz y texto. El ajuste local de tempo conserva el tono y
las pausas medidas; la mezcla mantiene el efecto sutil de teléfono y no incorpora
música. El tono inicial se genera localmente: no requiere marcar un teléfono.

Las esferas incorporan bandas proyectadas, filamentos y reflejos sobre fondo
negro. La fase de giro se calcula con el tiempo global y la actividad de cada
voz; continúa en reposo y acelera gradualmente al hablar. Se preserva la fase
entre escenas, incluida la rotación de más de una vuelta que GSAP interpreta
módulo 360. La mezcla final se ajusta a muestras de audio independientes del
redondeo de fotogramas para respetar la duración del contenedor.

## Comprobaciones y entrega

- `call-visuals`: 30 pruebas pasadas, incluidos fragmentos de voz simulados,
  conservación de pausas, caché sin repetir síntesis, tono local y MP4 real de
  duración fraccionaria con FFmpeg. Informe
  `tmp/verification/call-visuals-20261115T232347-46c423df.json`.
- `melodi-cartesia`: 32 pruebas pasadas con WebSocket local; la voz masculina es
  distinta y no sustituye a Melodi. Informe
  `tmp/verification/melodi-cartesia-20261115T232042-bdfd3645.json`.
- `motion-social`: 49 casos, 47 pasados y dos omitidos por FFmpeg fuera del PATH
  del banco antiguo. Incluye que una referencia exacta sustituya la duración
  predeterminada y conserve los tiempos del diálogo. Informe
  `tmp/verification/motion-social-20261115T233216-cc8a4dca.json`.
- Comprobación real en Edge oculto de las 18 escenas: cambio máximo de giro
  0,898° en 20 ms y diferencia cero en las coordenadas de las bandas a ambos
  lados de los cortes. `tmp/call-orb-continuity-20261115.json`.
- El guion conserva las 203 palabras transcritas, con las identidades solicitadas
  y la mención inicial de Daniel Luna: 204 palabras adaptadas. Es una comparación
  con ASR, no una certificación de escucha humana del original.
  `tmp/call-script-reference-20261115.json`.
- HyperFrames terminó sin errores ni advertencias. Se revisaron cinco muestras
  del MP4 final. FFprobe confirma 1080×1920, H.264 a 60 fps, audio AAC a 44,1 kHz
  y contenedor de **88,142948 s**, idéntico al de la nueva referencia. El video
  termina en 88,133333 s y el audio determina el final exacto. El tono y la
  primera voz tienen señal; la pausa previa está en silencio digital.
  `tmp/call-audio-final-20261115.json`.

La nueva entrega contiene 17 turnos, conserva los anteriores y añade un MP4 y un
ZIP editable a Creaciones de Melodi. Se añadió al chat cifrado correspondiente
después del cierre normal y se reabrió desarrollo. Los originales, los audios de
referencia y sus fotogramas no se incluyen en el ZIP ni en esta bitácora.
`tmp/call-reference-revision-20261115.json` y
`tmp/call-reference-startup-20261115.json`.

Durante el trabajo se corrigió un fallo del banco que usaba una carpeta ajena a
su ejecutor. Una comprobación inicial no encontraba FFprobe en su PATH. El
diagnóstico de un SVG aislado no resolvía su línea de tiempo anidada; se usaron
el proyecto completo, muestras y una comprobación directa de GSAP. Se detuvo
únicamente un render propio para corregir el giro, antes de exportar nuevamente.
Los informes intermedios no se borran. No se modificó la versión del motor.

La revisión automática bloqueó inicialmente subir la referencia a Deepgram.
El usuario autorizó expresamente esos 88 segundos. Hubo un intento HTTP 401 por
credencial no cargada y una transcripción completada con Nova-3. Consumo conocido
del hito: 22 síntesis Cartesia, 1.175 caracteres; 19 fragmentos iniciales y tres
nuevos para conservar la vacilación del doctor, reutilizando los otros 18. No
hubo planificación Meta ni llamadas telefónicas iniciadas por esta tarea. El
importe, GPU y tráfico de fondo no se han medido; HyperFrames devolvió cuota
`unknown`. No se certifican audición humana ni igualdad visual píxel a píxel.

Fuente técnica consultada: [transcripción pregrabada y tiempos de Deepgram](https://developers.deepgram.com/docs/pre-recorded-audio),
[separación de intervenciones](https://developers.deepgram.com/docs/utterances/).
