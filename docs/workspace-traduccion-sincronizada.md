# Traducción con anticipación audiovisual y reducción de espera

Estado del 2 de noviembre de 2026, hora de La Paz. Continuación de la
[corrección de continuidad](workspace-traduccion-continuidad.md). El usuario
retiró el objetivo de terminal; este trabajo corresponde a traducción.

## Implementado

La captura directa conserva su recorrido de un clic. Se añaden Preproducción y
Navegador en Traducción auditiva. La extensión MV3 en `browser-extension/`
captura la pestaña autorizada y reproduce su imagen y audio desde un búfer en
una ventana separada; no captura el micrófono ni la voz traducida de esa ventana.
El original retrasado queda al 12 %. Preproducción prepara al menos cinco
segundos y espera «Reproducir desde el principio». Navegador prepara al menos
cuatro segundos. La fuente debe seguir adelantada: rebobinar la web original
destruiría esa anticipación. No se obtiene sonido del futuro de una emisión live.

El relay de escritorio sólo escucha en loopback. Vinculación de un uso/120 s,
token ligado al Origin exacto/ocho horas, revocación desde Conexiones. Los
secretos viven en memoria y `chrome.storage.session`, sin localStorage ni
tokens en parámetros URL. El enlace temporal lleva sólo el código de seis
dígitos. Captura directa y sincronizada comparten exclusión de sesión ASR.

Se transmiten PCM mono/24 kHz/80 ms a ritmo real, progreso real del ASR, turnos
y cues de voz completos. Epoch, cola acotada y cancelación evitan mezclar
sesiones. El búfer de anticipación tiene límite de 30 s; el video codificado,
32 MiB. Se elimina historial detrás de seis segundos del cursor. Si falta una
voz, se retiene imagen y original; no se salta contenido para aparentar rapidez.
La voz ajusta duración entre 0,85× y 1,18× conservando tono; un excedente retiene
la imagen al final del turno. Esto **no es sincronización labial**.

Los tiempos ASR `audioProcessedMs` son progreso del procesamiento cuando se
emite cada evento, no límites acústicos precisos. Se preservan etiquetas de
hablante de la sesión, sin inferir identidad. Un error pequeño respecto a esos
marcadores no certifica alineación respecto a los labios o al audio original.

Meta analiza opcionalmente una muestra inicial de 1,6 s por turno para obtener
entrega/emoción/muletillas como metadatos consultivos, en paralelo a la captura.
Si no hay muestra completa, usa el final del turno; máximo dos trabajos y
deadline de tres segundos desde su lanzamiento. Resultado dudoso, timeout o
modelo no verificado mantienen voz neutra. El modelo de audio se comprueba
mediante catálogo oficial, caché de 24 h ligada a la configuración y GET acotado
fuera de MT/TTS. No se afirma que detecte correctamente todas las emociones.
La traducción conserva muletillas que efectivamente aparezcan en ASR; no inserta
muletillas sin alineación ni reconstruye las que el reconocedor haya omitido.

## Espera medida y optimizaciones

La meta solicitada es **como máximo seis segundos desde el clic hasta la voz**.
No se confunde con tener el búfer preparado ni con la diferencia entre el reloj
del video y la fuente. La última medición real aún no acredita esa meta.

| Ensayo propio | Búfer preparado desde captura | Primera voz desde captura | Primera voz desde clic |
| --- | ---: | ---: | ---: |
| Preparación anterior, sin adelantar conexiones | 7,33 s | 7,95 s | No instrumentado |
| Conexiones adelantadas y análisis al final del turno | 6,22 s | 6,75 s | 7,65 s |
| Análisis anticipado del prefijo, Preproducción | 6,03 s | 6,56 s | 8,20 s |
| Análisis anticipado del prefijo, Navegador | 5,78 s | 6,15 s | 7,12 s |

Se implementaron estas reducciones sin traducir hipótesis revisables:

- Preparar los proveedores antes de capturar, evitando una cola inicial que
  luego no puede enviarse más rápido que tiempo real.
- Abrir TLS de MT en paralelo, sin enviar una inferencia de calentamiento.
- Analizar entrega/emoción sobre el prefijo disponible mientras la persona
  continúa hablando. Se conserva el final real del turno para emitir el cue.
- Esperar sólo el primer cue necesario para arrancar; no esperar además toda
  intervención que empiece dentro de los primeros cinco segundos.
- Mantener MT/TTS en streaming y el buffering Cartesia en cero, porque Brivany
  ya agrupa frases. Esta última corrección precede a estos ensayos.

En el último ensayo, ASR finalizó el primer turno a 4,438 s, llegó el primer
texto traducido a 5,250 s y el cue completo a 5,781 s. El análisis de entrega ya
había terminado a 4,063 s. El silencio inicial de la fuente y la preparación
del navegador también cuentan para el instante de primera voz. La demora
efectiva máxima observada fue 5,94 s; no equivale a espera desde el clic.

La mejora adicional del prefijo silencioso en Navegador se verifica por separado
con proveedores sustituidos; no se aplica retroactivamente a estos tiempos
reales. Preproducción conserva el inicio manual.
Con un cue simulado disponible a 7,052 s, la voz empezó a 7,083 s en vez de
reproducir después el segundo inicial de silencio. Sólo avanza silencio
confirmado por speechStart y progreso ASR, tras el búfer mínimo; se detiene
antes del habla pendiente. Dieciocho pruebas de extensión aprobaron esta
condición, la pausa manual y el bloqueo de Preproducción.

## Métodos que aún requieren desarrollo o validación

1. Acceder antes de reproducir a un archivo autorizado o a subtítulos
   temporizados disponibles, traducir y sintetizar por anticipado. Es la vía
   para salir de la limitación de capturar sólo audio presente. El acceso depende
   del sitio/formato; la extensión actual **no descarga videos completos** ni
   obtiene automáticamente sus pistas/subtítulos. No elude DRM.
2. Traducción especulativa de parciales, validando el texto contra el final antes
   de hacerlo audible y descartando resultados revisados. Puede ahorrar la
   espera MT/TTS posterior al cierre, pero añade consumo cuando el texto cambia
   y requiere pruebas semánticas. **No implementado como voz sincronizada.**
3. Separar reconocimiento de baja latencia y atribución de hablantes. Meta
   recomienda ENDPOINTING para menor latencia; DIARIZATION conserva etiquetas
   pero no está optimizado para ello. Cambiar sólo ese modo eliminaría la
   atribución automática solicitada. Requiere otro mecanismo probado, no una
   sustitución silenciosa de calidad.

Un turno hablado de más de seis segundos ya supera el presupuesto si se exige
su texto final completo antes de sintetizar. No hay parámetro documentado para
forzar una confirmación DIARIZATION en seis segundos. Un timeout visible no
cumple el objetivo de entregar la traducción, ni garantiza la red externa.

## Evidencias y límites de las pruebas

Siete ensayos reales reutilizaron la misma muestra sintética propia A→B→A de
9,96 s. Un ensayo inicial falló al terminar la pista de la fuente del arnés; se
conserva y corrige con una pista de silencio propia continua. Seis completaron
los tres cues con voces estables. En el último, 285 fotogramas decodificados y
errores de inicio de 12/7/23 ms **respecto a los marcadores ASR**, no a límites
acústicos verificados. Son proveedores reales y reproducción de navegador
aislado, no prueba de audición humana del usuario ni de su sesión de YouTube.

Consumo observado en esos ensayos: siete sesiones ASR, 21 invocaciones MT y
21 análisis Meta de audio; los contextos TTS no tienen contador independiente
de facturación en este arnés. Se añade un análisis Meta independiente de 2,48 s
(2,14 s de respuesta, 649 tokens reportados) y una lectura real del catálogo.
El importe es desconocido; no se certifica el número de recuperaciones de pago.
No se han adjuntado grabaciones, videos ni transcripciones del usuario.

Informes reales: `tmp/extension-sync-buffer/real-1793589929418.json`
(fallo preservado), `real-1793590203413.json`, `real-1793590304462.json`,
`real-1793591082790.json`, `real-1793591272707.json`,
`real-1793591518883.json` y `real-1793591698216.json`; consumo en archivos
`real-consumption-*` de la misma carpeta. El análisis independiente está en
`tmp/workspace-translation-continuity/prosody-real-20261102.json`.

Las suites locales prueban relay/autorización, cursores/colas/cancelación,
prosodia sustituida, preparación TLS y los tres modos UI. Se verificó el panel
en cinco anchuras (780, 460, 390, 320 y 280 px), incluyendo el botón Detener
dentro de su región nativa. Se conservan informes en `docs/verification-history/`.
Los ensayos de MediaRecorder/MediaSource con canvas y osciladores sustituidos
incluyen 25 s, Preproducción y cue tardío. No consumen inferencia externa.
La última regresión WebView2 nativa también pasó con servicios sustituidos:
`workspace-chat-native-20261102T040259-a5d2c9b3.json`. El panel y botón Detener
pasaron `workspace-translation-ui-20261102T035602-cf3c6cfc.json`; relay 23,
River 32, Meta MT 30, prosodia 19, puente Desktop 5, Work 32 y extensión 18
pruebas locales, sin sumar esos números como escenarios reales únicos.

Un perfil Edge aislado cargó realmente la extensión, registró su worker y
verificó CSP, Origin, vinculación y caché contra un relay sustituido. Un intento
posterior con atajo de teclado no abrió la ventana de captura en headless y
queda como **no verificado**, no éxito. No se instaló en Brave del usuario:
falta la carga manual y la prueba del gesto autorizado de `tabCapture` sobre su
video. La carpeta/ZIP están preparados; la instalación y prueba real en su
navegador siguen pendientes.

## Documentación primaria consultada

- [Meta: reconocimiento, modos y parciales](https://dev.meta.ai/docs/speech-to-text).
- [Meta: esquemas y significado de audioProcessedMs](https://dev.meta.ai/docs/api-reference/voice/schemas).
- [Meta: audio en modelos multimodales](https://dev.meta.ai/docs/video-understanding).
- [Cartesia: buffering y latencia](https://docs.cartesia.ai/use-the-api/tts-websocket/buffering).
- [Chrome: autorización tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture).
- [Chrome: procesos de captura](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture).
