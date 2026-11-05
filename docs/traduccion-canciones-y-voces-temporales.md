# Traducción: canciones y voces temporales

3 de noviembre de 2026. El usuario confirmó que se usarán únicamente voces
propias o autorizadas. La traducción normal empieza con las voces de catálogo
existentes. «Clonar voces autorizadas» activa dos trabajadores independientes
sin bloquear la captura, Meta ni la reproducción. «Origen» corresponde al audio
de la muestra; el selector principal sigue siendo el idioma de traducción.
La clonación está desactivada al arrancar y no se activa con el micrófono.

## Flujo implementado

- Muse proporciona etiquetas anónimas de hablante. No se identifica a una persona
  por nombre ni se verifica su identidad real. Meta conserva la traducción y su
  prosodia opcional; la clonación usa el endpoint documentado de Cartesia.
- El agente de hablantes comprueba intervalos y clasifica las muestras localmente.
  Requiere dos turnos y diez segundos acumulados de voz limpia. Rechaza música
  significativa, etiquetas ausentes, intervalos incompletos y solapamientos
  detectados. Máximo treinta segundos por hablante y cuatro hablantes.
- El agente de clonación envía WAV en memoria a Cartesia con acceso privado.
  Se intenta una vez por etiqueta y sesión. El error conserva las voces normales
  sin reintentos continuos. La calidad insuficiente mantiene la recogida de audio.
- Una voz preparada se adopta al comenzar la síntesis de una frase posterior.
  La frase ya enviada conserva su voz, sin repetición ni corte para cambiarla.
  La elección manual Masculina/Femenina conserva prioridad.
- La caché reutiliza cada voz durante la sesión de traducción. Al detenerla se
  descarta PCM y se solicita borrar únicamente los IDs creados por esa sesión.
  Una clonación terminada después de detener se elimina. La interfaz no espera
  una petición de red de clonación para responder al botón Detener.

Los dos agentes pequeños aparecen en WorkSpace como Hablantes y Clonación de
voz. Seleccionarlos abre Traducción auditiva. Los ajustes de clonación se bloquean
durante una traducción directa o de extensión. Se incorporan los trabajos de ambas
rutas y se mantiene la cancelación/restauración existente del audio original.

## Guardado temporal y limpieza

Audio y etiquetas se mantienen en memoria, sin archivos de muestras ni bitácora
de conversaciones. El clon remoto sí se aloja temporalmente en Cartesia.
`.local/translation/temporary-voices.json` conserva solamente UUID, huella de
credencial y vencimiento, para recuperar limpiezas tras un cierre inesperado.
No contiene la clave, nombres, grabaciones ni transcripciones.

La concesión de limpieza vence tras treinta minutos sin renovación. El agente
renueva localmente cada minuto sus voces activas, sin solicitudes de API. Un
próximo uso del clonador intenta borrar hasta cuatro voces caducadas de la misma
credencial. Un equipo apagado, credencial revocada o fallo de red pueden retrasar
el borrado remoto; no se promete limpieza en el proveedor con Brivany cerrado.

Las etiquetas no se reutilizan entre sesiones ASR: una nueva A no acredita que
sea la persona de una sesión anterior. La caché no es una base biométrica.

## Filtro de canciones

YAMNet/AudioSet se ejecuta en CPU antes de traducir y sintetizar una cláusula en
WorkSpace y extensión. Para canto a cappella ambiguo se añade una señal acústica
conservadora de notas sostenidas. Se conserva diálogo sobre banda sonora. Las
muestras demasiado cortas o inciertas pasan; no se garantiza detectar todo canto.

La extensión recibe `source-skipped` con intervalos filtrados y no espera una voz
que no se generará. La reproducción también reanuda su entrada cuando el filtro
vacía la cola. ASR y prosodia opcional conservan su funcionamiento: el filtro
local no hace gratuita toda la sesión de traducción.

Modelo oficial de 4,13 MB y licencia Apache-2.0 en `desktop/assets/audio/`;
`ai-edge-litert==2.2.0` en requisitos de escritorio. Se incluye el instalador
`tools.setup_audio_classifier` para el activo oficial.

## Comprobaciones y límites

`translation-voices`, `river-translation`, `workspace-translation`,
`workspace-translation-ui`, `workspace-sync-extension`, `sync-relay`, `work` y
`workspace-agents-ui` usan proveedores/acciones sustituidos. El protocolo completo
provoca una clonación pendiente mientras ya sale traducción y comprueba que una
frase posterior use el UUID preparado. No mide fidelidad ni latencia física.

El modelo local real se probó sobre cinco casos: voz sintética propia, habla
humana de la muestra oficial MediaPipe, canto CC0 en dos puntos y mezcla propia
de diálogo con canto de fondo. La primera versión confundió canto a cappella con
habla; el fallo se conserva. Tras añadir notas sostenidas, los cinco pasaron:
12,74–37,13 ms por muestra de tres segundos en este equipo. No es una evaluación
exhaustiva de idiomas, rap, coros ni conversación natural.

Evidencias sin audio original:

- `tmp/song-filter/report-acapella-initial.json`: fallo anterior.
- `tmp/song-filter/report-1793762404344243600.json`: inferencia local real tras
  corregir, cinco casos, sin clonación ni inferencia remota pagada.
- Informes fechados de suites en `docs/verification-history/`, registrados por
  `tools.verify`, incluidos fallos y correcciones.
- `tmp/workspace-translation-ui/translation-390.png`: interfaz propia con texto
  sintético y controles dentro del panel.

El primer ensayo de integración saturó la cola al inyectar doce segundos de
audio instantáneamente; se corrigió ese productor acelerado, conservando límites
de producción. El primer ensayo de UI dejó Detener fuera del panel: se corrigieron
distribución flexible y alturas nativas, comprobando 280–780 px con clonación.

No se envió una voz personal real a clonar en esta implementación. Transporte,
consentimiento, caché, fallo, asociación y limpieza se probaron con sustitutos.
Fidelidad, distinción efectiva y acento al traducir una voz autorizada a otro
idioma siguen pendientes de una muestra autorizada real. Las descargas del
modelo, licencia, dependencias y muestras no son inferencias de clonación; no
se atribuye coste cero a usos anteriores de APIs.

## Fuentes

[Cartesia: clonación](https://docs.cartesia.ai/api-reference/voices/clone),
[muestras y limitaciones](https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices)
y [acentos multilingües](https://docs.cartesia.ai/api-reference/voices/add-accents).
Un acento nativo en otro idioma puede requerir localización adicional. Esta
entrega no certifica localización nativa de cada voz.

[Clasificador MediaPipe](https://developers.google.com/edge/mediapipe/solutions/audio/audio_classifier)
y [canto CC0 de Derrick Coetzee](https://commons.wikimedia.org/wiki/File:Twinkle_Twinkle_Little_Star_-_sung_with_full_lyrics.ogg).
