# 44. YouTube en vivo con Palabra

29 de octubre de 2026, America/La_Paz. El usuario eligió Palabra y proporcionó
`https://www.youtube.com/watch?v=qGEPPNTTYmk` para su primera prueba real con
video externo. Se incorpora el reproductor oficial y el recorrido de captura
en vivo, sin descargar, extraer ni procesar previamente el video.

## Abrir y probar

Abrir [Live Traductor](http://127.0.0.1:8765/dubbing?provider=palabra&source=youtube).
También hay un acceso «Traductor live · YouTube» desde la biblioteca espacial.
La página prepara ese enlace sin reproducción automática; el campo permite
abrir otros enlaces `youtube.com/watch`, `shorts`, `live` o `youtu.be` con un
identificador válido. Un video puede restringir su reproducción incrustada;
se comunica el error y no se intenta descargarlo como alternativa.

1. Elegir el idioma real del video y el destino entre inglés, francés y español.
2. Marcar el permiso para enviar audio a Palabra y pulsar **Preparar escucha**.
   Activar el audio en la ventana separada si el navegador lo solicita.
3. Volver a Brivany y pulsar **Compartir audio e iniciar**. Elegir esta misma
   pestaña de Brivany y activar **Compartir audio de la pestaña**.
4. El video empieza al estar preparado el relay. El original se escucha al 15 %
   por defecto en este modo y la voz traducida tiene su propio volumen. El botón
   **Escuchar original** alterna la escucha sin reiniciar el video.

Se necesitan capacidades de captura de pestaña y Capture Handle de un navegador
de escritorio compatible, como Chrome/Edge; aún no se acredita móvil, macOS,
contenedor Desktop ni navegador integrado. Dos gestos separados evitan depender
de reutilizar una activación del navegador para abrir ventana y compartir pantalla.
La elección/permisión de la pestaña corresponde al usuario y no se automatiza.
Las sesiones de prueba conservan el límite de 60 segundos, sin renovación ni
reenvío automáticos. Al terminar se puede iniciar desde el momento actual.

## Audio y aislamiento

El iframe está en otro origen: no se lee directamente mediante Web Audio. Se
usa `getDisplayMedia` sólo después del gesto, validando superficie de navegador,
origen y nonce de Capture Handle para rechazar escritorio, otra pestaña o una
fuente que cambie. Se comprueba que el navegador declare supresión de reproducción
local del original. Sin esas condiciones se cierra la captura antes de abrir
Palabra. Los frames visuales no se transmiten ni graban.

Una ventana local distinta reproduce el original reducido y la traducción. Esto
separa la salida de la pestaña capturada; la captura real de YouTube y la ausencia
física de realimentación siguen pendientes de probar con el selector del usuario.
La comunicación usa un MessageChannel con origen, ventana y nonce comprobados;
colas acotadas y cancelación liberan streams y audio. No se piden micrófono ni
cámara. El video permanece servido por YouTube, con su tráfico normal de iframe.

## Cambio de idioma y contexto

Palabra conserva la conexión y su entrada continua. Cambiar de destino envía
`interrupt_task` y espera confirmación antes de `set_task`; espera otra confirmación
para admitir audio del nuevo idioma. Se limpia la reproducción pendiente del
cliente, filtran idioma/IDs conocidos y se marca un epoch local. No se reenvía
audio anterior ni se inicia otra inferencia por cambiar idioma.

La frase pendiente se descarta al interrumpir: puede perderse esa parte. Palabra
no documenta un identificador de generación en el audio; al volver a un idioma,
un fragmento tardío de ese idioma con ID nunca visto no se puede distinguir con
certeza. El epoch local no convierte esa ausencia de información en una garantía.
Cambiar el idioma fuente, pausar o buscar otro momento termina la sesión para
no conservar un contexto incompatible. Escuchar el original mantiene la
traducción activa en segundo plano y puede seguir consumiendo saldo.

El perfil `contextual_live` solicita segmentos confirmados, división de oraciones,
silencio de 0,3 s, sin voz clonada ni parciales inestables. Sólo se declara
observado si `current_task` devuelve todos los campos coincidentes; los campos
ausentes permanecen desconocidos. No se añade un supuesto campo de prompt o
historial que la API no documenta. La rúbrica de
[seis casos contextuales](fixtures/palabra-contextual-evaluation.json) permanece
sin ejecutar ni revisión bilingüe. La claridad, conjugación y significado no se
declaran comprobados por pasar pruebas del protocolo.

## Evidencia

| Comprobación | Resultado |
|---|---|
| Iframe real del video proporcionado | [Disponible sin autoplay](../tmp/youtube-embed-real/report.json), sin errores oficiales del reproductor ni violaciones CSP del documento principal. No se pulsó Play, Compartir ni Iniciar; cero sesiones Palabra. |
| Protocolo, perfil y tres idiomas | [28 pruebas Python PASS](verification-history/palabra-live-20261030T033621-dd8fcabb.json), transportes sustituidos. |
| Enlaces, ventana de escucha, permiso tardío y origen de captura | [15 pruebas Node PASS](verification-history/youtube-source-20261030T034030-f47d6c02.json). |
| Recorrido YouTube local | [4 controles PASS](verification-history/youtube-dubbing-20261030T034032-9e3b227d.json): HTTP/WS, AudioWorklet, AudioContext y MessageChannel reales; YouTube, selector de captura y Palabra sustituidos por fixtures sintéticas. Una conexión, cambio ES→FR, audio no nulo, liberación de tracks. |
| Regresión de archivo local y proveedores anteriores | [39 controles PASS](verification-history/dubbing-ui-20261030T033900-79854121.json), audio sintético y upstream sustituido. |
| Servidor HTTP | [23 pruebas PASS](verification-history/http-20261030T033750-295a8971.json). |

La regresión antigua esperaba que elegir el idioma original cancelase la sesión;
se actualizó para el nuevo comportamiento solicitado de escuchar el original
sin cortar la traducción. El iframe real sí hizo solicitudes públicas normales
a YouTube y sus recursos; no se describe esa comprobación como cero red externa.
Las suites locales tienen cero llamadas de inferencia pagada y no acreditan
audio físico, calidad bilingüe ni el objetivo de retraso audible de 500 ms.

La clave guardada de Palabra está configurada y el relay disponible según estado
local; no se consultó saldo ni se abrió una sesión pagada en esta ampliación.
La apertura del panel de Codex devolvió `queued`; no prueba que la pestaña del
usuario haya cambiado. El enlace directo permite acceder a la pantalla.

Referencias primarias: [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference),
[captura de pantalla/audio](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia),
[supresión de audio local](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/suppressLocalAudioPlayback),
[control de traducción Palabra](https://docs.palabra.ai/docs/streaming_api/management),
[configuración Palabra](https://docs.palabra.ai/docs/streaming_api/translation_settings_breakdown).
