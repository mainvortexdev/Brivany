# Brivany · Videos con Melodi · 0.4.9

Extensión MV3 para Brave/Chromium 116 o posterior. Brivany Desktop debe estar
abierto. El clic no abre la app ni una ventana de reproducción.

Esta versión recupera la preparación al navegar, confirma la carga del módulo
y retiene la imagen si el inicio de la voz tarda. El diagnóstico local de
Brivany muestra `workspace_client_info` cuando el trabajador ha cargado esta
compilación. El paquete conserva el mismo ID y los permisos de la versión previa.

## Uso

1. Carga esta carpeta desde `brave://extensions` → Modo de desarrollador →
   Cargar descomprimida. Si ya está cargada, actualiza sus archivos y pulsa
   Recargar en su tarjeta. El ID público ahora es estable entre carpetas.
2. Abre el video y pulsa la extensión o `Alt+Shift+M`. Si quieres iniciar
   desde WorkSpace, acepta el acceso a ese sitio cuando lo pida el navegador.
   A partir de entonces, **Traducción auditiva** de WorkSpace activa la
   extensión en la pestaña de video que dejes seleccionada.
   En una pestaña visible de un sitio autorizado, la extensión prepara por
   defecto los primeros siete segundos de un video elegible al reproducirlo.
   La preparación mantiene el video original y filtra los tramos de música.
   Al activar el doblaje, se reutiliza la apertura preparada y Muse continúa
   desde el corte. Si una frase cruzó ese corte, Muse retoma su inicio.
   Durante el doblaje, las intervenciones largas también pueden avanzar por
   cláusulas estables. Sus límites de sincronía son estimaciones del ASR.
3. En YouTube, un único video visible se selecciona automáticamente. Si hay
   varios videos, o en otra web, aparece un pin: haz clic en el video elegido.
   Escape cancela el selector. No se seleccionan videos ocultos.
   Si el video está en pausa, la extensión espera a que lo reproduzcas. Los
   clics repetidos conservan la selección que ya se está preparando.
4. Empiezan juntos la transcripción progresiva y la traducción hablada. La
   imagen se prepara dentro de la pestaña con un margen mínimo de cuatro
   segundos. Al quedar lista la voz, el indicador muestra el texto de la frase
   en reproducción. Un único ASR alimenta la traducción y la separación de voces.
5. Elige idioma y voz en **Traducción auditiva** de WorkSpace (inglés/Auto por
   defecto). Se mantienen filtro de canciones y clones autorizados opcionales.
   El original suena al 12 % de su volumen previo y se restaura al terminar.
   La traducción usa el audio del video seleccionado.
6. En **Ajustes → Melodi WorkSpace → Mostrar transcripción en el navegador**
   puedes ocultar el texto. La opción viene activa y se guarda en Brivany.
   Cambiarla durante la sesión solo altera la presentación del texto.

El indicador pequeño de la página permite **Detener**. Al terminar el video se
reproducen las últimas frases preparadas antes de cerrar la captura. Pausar,
buscar otra posición, navegar o retirar el elemento detiene esa sesión. Una
vez detenida, puedes elegir otro video.

Si una intervención queda abierta o tarda demasiado, se oye su audio original
y el doblaje puede volver en el siguiente turno disponible. Si se interrumpe la
captura o la conexión, se devuelve el control y el volumen al reproductor de la
página. La copia interna para el búfer se limita a 640 × 360 y 24 fps. La página
conserva su calidad de origen al terminar la sesión.

Si el sitio vacía su reproductor antes del final, se reproducen las frases ya
capturadas y se muestra que el video original se interrumpió. Esa interrupción
no se considera un final satisfactorio de la traducción. El seguimiento de
hablantes utiliza muestras de habla y asignaciones acústicas temporales;
cuando faltan datos, conserva la voz como sin identificar.

## Conexión y captura

La app prepara el enlace `127.0.0.1:48217`. `/connect` reconoce sólo el Origin
exacto del ID público de esta extensión. Tokens en memoria, máximo ocho horas,
ligados al Origin; revocarlos también deshabilita conexión automática hasta
prepararla otra vez desde la app. Sin claves ni tokens en URLs o estado público.

Se usan `activeTab` y `scripting` tras la acción del usuario. El arranque desde
WorkSpace usa únicamente el acceso opcional concedido a ese sitio. El canal
local autenticado recibe una orden de selección con vencimiento y consulta
solo la pestaña activa del navegador conectado. `web_accessible_resources`
declara código estático, sin datos personales. No se solicita micrófono ni cámara.

`video.captureStream()` obtiene exclusivamente el elemento marcado. AudioWorklet
envía PCM16 mono/24 kHz/80 ms. Cuatro bloques máximos en vuelo, confirmaciones,
ritmo limitado y colas acotadas. Las ráfagas esperan hasta 75 bloques; el plazo
de confirmación comienza en cada envío real, no al iniciar la configuración.
La salida de la captura propia tiene ganancia
cero y no duplica el sonido del video. Audio y texto viven en memoria.

En 0.4.1 los ACK los envía Brivany después de recibir el bloque; enviarlo desde
el navegador ya no cuenta como confirmación. Cuatro bloques pendientes acotan
las ráfagas tras una pausa de lectura nativa. La negociación comprueba protocolo
2 y traducción progresiva antes de capturar; si la app en memoria es anterior,
se pide reiniciarla. El primer error se conserva sin sustituirlo al cerrar el
socket. El montaje del audio tiene un plazo separado de 20 segundos.

En 0.4.2 Brivany retiene el ACK cuando un bloque llega antes de que haya margen
de ritmo. La conexión nativa reserva espacio antes de retirar otro bloque de
la cola de captura si Muse se retrasa. Las órdenes de voz y parada se atienden
antes de esperar ese espacio.

## Anticipación y límites

Las pistas HTML5 activas y los subtítulos que expone normalmente el reproductor
YouTube se leen para el elemento elegido. Límite 1 MiB, 2.000 cues y 400 caracteres
por cue. Se importan lotes confirmados de ocho, sin saturar la conexión.

La posición actual permite preparar con Meta hasta tres frases de los próximos
16 s; caché de 32 entradas durante 45 s. Sólo una coincidencia exacta de palabras,
números, signos y unidades con ASR permite reutilizar la traducción. La preparación
puede consumir API aunque no se use. Los nombres WebVTT son pistas, no identidades
confirmadas. Diarización y clones requieren audio real. Las voces autorizadas
se preparan en paralelo, se reutilizan por sesión y se adoptan en frases posteriores.

Sin subtítulos, la extensión transcribe a partir del punto de reproducción y
puede preparar una hipótesis inicial. Sólo la confirmación exacta de Muse da
paso a la síntesis. Las frases largas o una respuesta tardía pueden ampliar la
espera. El reproductor mantiene el tono y no ralentiza la voz al arrancar.
Algunos iframes, videos protegidos y reproductores impiden esta ruta; se informa
sin cambiar a la mezcla de toda la pestaña. No se extraen cookies ni se elude DRM.
El búfer alinea cada frase con el inicio del turno de Muse. La sincronía es a
nivel de frase y depende de los límites que detecta el proveedor.

El reproductor audiovisual 0.2.0 permanece como ruta avanzada (`player.html`),
con los límites de `docs/workspace-traduccion-sincronizada.md`. Ya no se abre al
pulsar el icono. La clonación se detalla en `docs/traduccion-canciones-y-voces-temporales.md`.

## Pruebas

```powershell
node --test browser-extension/tests/*.test.mjs
node browser-extension/tests/run-selected-video-probe.mjs
.venv/Scripts/python.exe -X utf8 -B -m tools.verify selected-video
```

El ensayo usa Brave aislado y una copia temporal de la extensión con permisos
sólo para fixtures propios de localhost y una página que simula el dominio YouTube.
Dos videos emiten tonos diferentes. Verifica pin, audio separado, subtítulos,
selección automática de un único YouTube, ausencia de ventanas y cierre al navegar.
Servicio sustituido, sin perfil personal ni inferencia pagada. No certifica el
gesto de la acción en el perfil personal, un video público, fidelidad o escucha física.

Referencias: [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting),
[ID público](https://developer.chrome.com/docs/extensions/reference/manifest/key),
[captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream)
y [subtítulos YouTube](https://developers.google.com/youtube/data/reference/rest/v3/captions/download).
