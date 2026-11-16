# Llamada visual: voces, referencia y espera

15 de noviembre de 2026. El usuario rechazó el resultado: formas planas en vez de
esferas luminosas, rótulos extensos, una sola voz para ambos personajes y música
que tapaba el diálogo. Confirmó que la música molesta pertenecía al video y pidió
conservar 98 segundos ampliando la conversación, con efecto sutil de llamada.

Se incorpora `presentation: call` al contrato finito de escenas: dos participantes
con nombres de hasta 24 caracteres y un `speaker` por turno. Este modo usa un
renderizador controlado con esferas huecas, gradientes, halo, onda suavizada y
actividad calculada del PCM real. Mide centros y diámetro en muestras locales de
la referencia, conserva el fondo negro y muestra sólo los nombres y la marca
discreta de demostración. No aplica titulares de marca ni pantalla blanca de
créditos. Las referencias prevalecen sobre la guía visual general de Brivany.
No se promete igualdad píxel a píxel ni se siguen instrucciones dentro del video.

Melodi conserva su ID exacto de Cartesia. El otro personaje usa la voz pública
Fernanda, distinta de Melodi y comprobada por el catálogo del proveedor. Los IDs
no los decide el modelo ni se aceptan como override del endpoint público. La
reutilización de audio comprueba también la voz. Cada turno lleva su propia voz;
su duración se mide antes de fijar las pausas y mantener el total solicitado.

La llamada no incorpora música sin una petición explícita. Se aplica a las voces
un filtro suave de 180–4.800 Hz, presencia moderada y compresión ligera, sin
cambiar el tono ni el proveedor. Se encontró un WAV temporal que crecía sin
límite al mezclar sólo voces; se normalizaron frecuencia y marcas de tiempo y
se acotó tanto el relleno por muestras como la duración de salida. Se eliminó
únicamente ese temporal incompleto del proyecto nuevo y se reutilizaron las 22
voces ya sintetizadas, sin otras síntesis ni modificación del video anterior.

Mientras se crea un video, el chat presenta una superficie negra con animación
de carga y la fase real del trabajo, sin porcentaje inventado ni botón de
reproducción ficticio. Respeta movimiento reducido y visibilidad. Se retira al
terminar o fallar; el reproductor final mantiene un tamaño comparable.

Las preguntas ordinarias del chat escrito omiten el clasificador previo y usan
un contexto compacto. Las órdenes y consultas sobre recursos siguen pasando por
la ruta de herramientas. Se corrigió además el falso positivo que interpretaba
«creatividad» como el verbo «crea». La habilidad humana activa se conserva.

## Verificación y entrega

- 25 pruebas de contrato, renderizador y audio, incluida mezcla real de dos tonos
  con FFmpeg y duración/bytes acotados: informe
  `tmp/verification/call-visuals-20261115T224635-49f4494a.json`.
- 31 pruebas de Cartesia con servidor WebSocket local: los dos interlocutores
  usan IDs distintos, sin cambiar la voz de Melodi ni abrir un override público.
  Informe `tmp/verification/melodi-cartesia-20261115T223530-ab0bb291.json`.
- 12 pruebas de conversación y 37 de ordenador; ambas suites pasan. Informes
  `live-conversation-20261115T223928-c29ee69e.json` y
  `computer-20261115T224228-b17ece9e.json` en `tmp/verification/`.
- Regresión audiovisual: 48 casos, 46 pasados y dos omitidos por FFmpeg fuera
  del PATH del banco. La nueva prueba de mezcla sí encuentra el binario local.
  Informe `tmp/verification/motion-social-20261115T224229-dfccd448.json`.
- Doce comprobaciones de interfaz con medios sintéticos, incluida carga negra,
  fase observable, movimiento reducido y retirada ante error. Informe
  `tmp/verification/chat-media-ui-20261115T224228-8b6ee7ca.json`.
- Una pregunta sintética al proveedor escrito actual dio primer texto en 2,109 s
  y fin en 2,515 s, sin clasificador ni TTS. Es una muestra de servicio, sin medir
  la latencia visual de la interfaz ni constituir una garantía. Informe
  `tmp/written-chat-latency-20261115.json`.

Se generó una revisión real a partir del análisis anterior: 98 s, 1080×1920,
30 fps, AAC, 22 turnos y dos voces. El PCM ocupa 90 s, con pausas medias de 0,227 s.
Se comprobaron cinco fotogramas del MP4, incluidos principio y final. HyperFrames
terminó su comprobación sin errores ni advertencias. El catálogo no ofreció una
primitiva que reprodujera este estilo; se hizo un componente acotado de SVG/GSAP.
Se verificó el proyecto con el CLI instalado; la consulta de actualización no
cambió un pin y la cuota de HyperFrames devolvió `unknown`. No se certifica una
audición humana ni fidelidad exacta; faltan la escucha y revisión del usuario.

Consumo conocido de esta revisión: dos borradores de Meta, 22 síntesis de Cartesia
(1.423 caracteres), una consulta al catálogo y una pregunta de latencia. Sin ASR
ni llamadas telefónicas iniciadas por la tarea. Importe monetario y tiempo GPU
desconocidos. Las pruebas de regresión usan proveedores simulados. El tráfico de
fondo de Brivany no está medido. Los fallos intermedios se conservan en la bitácora.

El MP4 corregido y un ZIP editable se guardaron como archivos nuevos en Creaciones
de Melodi. El proyecto editable incluye composición, recursos generados, fuentes,
licencias y mezcla; omite el perfil y los fotogramas privados de referencia. Se
añadió el resultado al chat cifrado correspondiente, preservando el anterior.
Desarrollo reabierto y `ready=true`. Evidencias sanitizadas:
`tmp/call-video-review-20261115.json`, `tmp/call-video-delivery-20261115.json` y
`tmp/call-video-startup-20261115.json`. No se adjuntan diálogos, audios ni videos a
la bitácora de desarrollo.

Fuente técnica consultada: [catálogo oficial de voces de Cartesia](https://docs.cartesia.ai/api-reference/voices/list).
