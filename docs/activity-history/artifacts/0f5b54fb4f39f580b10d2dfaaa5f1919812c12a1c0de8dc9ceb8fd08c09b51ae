# Brave: subtítulos anticipados y voces por hablante

3 de noviembre de 2026, continuación solicitada tras los agentes de clonación.
Extensión MV3 existente ampliada a 0.2.0; no se crea un navegador separado de
Brivany ni se reemplaza su traducción auditiva. Brivany debe permanecer abierto.

## Recorrido implementado

1. La acción de la extensión en la pestaña autoriza la captura y abre el
   reproductor con búfer audiovisual existente. Emparejamiento local y token
   temporal conservan el Origin exacto de esa extensión.
2. `caption-probe.js` lee las pistas HTML5 activas o los subtítulos expuestos
   por el reproductor actual de YouTube. Solicitudes HTTPS al mismo origen y
   video, sin redirecciones; máximo 1 MiB y plazo de 1,4 s. Las pistas sin acceso
   producen una respuesta vacía. No se consultan ni extraen cookies.
3. Cada cuatro segundos se ofrece una ventana futura de dieciséis segundos,
   hasta seis cues, al relay de la sesión actual. El proceso del navegador
   cancela al cerrar/navegar y descarta una consulta que termina después.
4. `CaptionPrefetch` prepara hasta tres frases con Meta en otro trabajador,
   cola de tres, 32 entradas máximas y vencimiento de 45 s. Sin archivos de
   subtítulos ni audio. Una avería especulativa no bloquea el traductor normal.
5. Cuando el ASR confirma una frase, el filtro de canciones se aplica primero.
   Sólo una coincidencia exacta de palabras y números permite usar la traducción
   preparada. Se conservan negaciones; no hay búsqueda semántica aproximada.
   Si no coincide o aún no está lista, se traduce por la ruta habitual.
6. Los límites reales del audio y sus etiquetas de hablante siguen determinando
   el cue y la voz. El nombre de un subtítulo WebVTT nunca decide quién habla.
   La clonación autorizada trabaja en paralelo y se incorpora a frases nuevas,
   como se documenta en [voces temporales](traduccion-canciones-y-voces-temporales.md).

No se sintetiza voz únicamente porque haya llegado un subtítulo. No es posible
inferir la voz real de un hablante a partir de texto: hacen falta muestras limpias
de su audio y permiso. Anticipación de texto, búfer y clonación resuelven partes
distintas del recorrido. La caché y época impiden publicar trabajo de otro video.

## Evidencias y límites

- `caption-prefetch`: cinco pruebas locales con proveedor sustituido, caché,
  cancelación, texto hostil, límites, fallo y no bloqueo.
- `workspace-sync-extension`: 24 pruebas locales, incluido permiso de captura,
  descarte tras navegación, selección de pistas, URLs, pausa y época activa.
  El primer test nuevo esperaba dos microtareas para un resultado de otro VM y
  falló; se corrigió la espera del fixture con el siguiente ciclo del evento.
  Se conserva el informe fallido y el aprobado de `tools.verify`.
- `sync-relay`: 24 pruebas de protocolos reales locales y proveedores simulados.
  El nuevo caso prepara MT antes del audio, comprueba cero solicitudes TTS hasta
  el ASR final y genera el cue con sus tiempos reales y etiqueta anónima. Usa una
  solicitud Meta sustituida en total, sin una segunda traducción de la frase.
- `river-translation`: 34 pruebas locales mantienen continuidad, cancelación,
  filtrado de canciones y cambio de catálogo a clon preparado.
- `tmp/extension-sync-buffer/extension-load-2026-11-04T03-50-20-344Z.json`:
  Brave real con perfil temporal, worker registrado, CSP, emparejamiento,
  autenticación y reapertura de autorización comprobados. No invoca tabCapture
  ni acredita un permiso de captura en la sesión personal del usuario.
- `tmp/extension-sync-buffer/brave-captions-1793764227818.json`: Brave real,
  video/canvas y TextTracks propios. Lee dos cues de prueba y sus pistas de voz,
  filtra el marcador musical y deja de anticipar al pausar. Sin medios personales
  ni llamadas pagadas. No demuestra subtítulos disponibles en cualquier web.
- `tmp/extension-sync-buffer/probe-2026-11-04T03-52-05-491Z.json`: recorrido real
  MediaRecorder/MediaSource/AudioWorklet con video y oscilador propios, relay
  sustituido y ventana Edge aislada. Cue iniciado en imagen 0,976 s para origen
  1 s; búfer observado hasta 4,26 s, sin errores. No es latencia de los proveedores.

La carga se ha probado en un perfil Brave aislado, no se ha instalado en el
perfil personal del usuario. El ZIP de entrega contiene los archivos de ejecución
y README; para cargarlo se descomprime y se selecciona su carpeta desde
`brave://extensions` → Cargar descomprimida.

Las pruebas nuevas son locales o con sustitutos y no consumen inferencia pagada.
La función real sí puede consumir Meta para frases que luego no se reutilicen;
no se mide aquí una nueva latencia real ni se garantiza seis segundos máximos.
El ASR y la síntesis siguen teniendo latencia y pueden retener el búfer.
Fidelidad de clones personales continúa pendiente de muestra autorizada real.

## Referencias primarias

[Chrome scripting/activeTab](https://developer.chrome.com/docs/extensions/reference/api/scripting),
[tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
y [YouTube captions.download](https://developers.google.com/youtube/data/reference/rest/v3/captions/download).
La API oficial de descarga exige autorización y permiso de edición del video;
no se presenta como fuente universal para cualquier video ajeno.
