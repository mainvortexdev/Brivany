# Videos seleccionados y transcripción silenciosa

4 de noviembre de 2026. La captura del usuario mostraba un reproductor vacío
que exigía pegar un enlace. La extensión 0.3.0 ahora selecciona dentro de la
página, transcribe sin abrir ventanas ni emitir audio propio y conecta esa
fuente a Traducción auditiva de WorkSpace.

YouTube con un único video visible: elección automática. Varias fuentes visibles
u otras webs: cursor de pin, clic en el video; Escape restaura el cursor. Se
consideran rectángulos visibles, también bajo los controles del reproductor.
No se elige el primer video de una lista múltiple ni se mezcla toda la pestaña.

`captureStream()` del elemento y AudioWorklet producen PCM24k/80 ms. Chrome Port
serializa JSON: bloques Base64 hacia el worker, binarios hacia el servicio. Cuatro
máximos en vuelo, confirmaciones y límites de ritmo/colas. Los subtítulos se
importan por lotes de ocho (2.000 cues máximos), sin ASR adicional. Sin ellos se
abre Muse DIARIZATION, sin MT ni TTS en esa fase. Un error detiene sin reintentar
cada bloque. Pausar cierra esa escucha ASR de fondo; el audio posterior puede
reanudarla. No se guardan originales ni conversaciones en archivos o bitácora.

La app inicia un relay de loopback en 48217 sin abrir proveedores. `/connect`
admite el Origin exacto del ID estable de la extensión (clave pública, no privada).
Tokens temporales en memoria; revocar también deshabilita conexión automática.
El código manual del reproductor avanzado se conserva, pero el pin no lo requiere.

WorkSpace usa la fuente marcada al iniciar Traducción auditiva. Suspende el ASR
independiente mientras su traductor consume ese audio. El original pasa suavemente
al 12 % y se restaura. La voz nativa no forma parte del elemento capturado.
Los subtítulos futuros y la posición alimentan `CaptionPrefetch` también en la
ruta nativa: 16 s próximos, tres frases preparándose y coincidencia exacta del ASR.
Las etiquetas reales y clones siguen dependiendo del audio y del permiso.
La selección no añade un nuevo búfer de imagen ni garantiza seis segundos o labios.

El estado público contiene sólo metadatos y contadores. `work_video_transcription`
permite leer el texto por el puente nativo de confianza. Cerrar/cambiar selección
descarta audio, texto y subtítulos. Sin subtítulos, sólo se transcribe desde el
punto actual. Algunos iframes y medios protegidos impiden capturar su elemento;
se muestra error sin sustituirlo por audio de otras fuentes.

## Evidencia

- `selected-video`: ocho pruebas locales: identidad/Origin, protocolo WS real de
  loopback con proveedor sustituido, limpieza, ASR diarizado, ausencia de TTS,
  caché futura y selección de fuente. Sin APIs pagadas.
- `workspace-sync-extension`: 27 pruebas locales; `river-translation`: 34;
  `sync-relay`: 24; `sync-desktop`: 5; `workspace-translation`: 14.
- `workspace-translation-ui`: cinco anchuras y selección sin navegar a la app.
  El primer ensayo aún esperaba abrir Conexiones; falló y se cambió para comprobar
  su ausencia, conservando ambos informes de `tools.verify`.
- `tmp/selected-video/probe-1793765918711.json`: Brave real aislado, dos videos
  y tonos propios, servicio sustituido. Marcó el segundo, leyó sólo su subtítulo
  y midió 875 Hz para su tono 880 Hz, excluyendo 330 Hz del primero. El único video
  en una página propia con hostname YouTube se eligió sin pin (347 Hz para 330 Hz).
  Sin ventanas nuevas y captura cerrada al navegar. No certifica YouTube público.

El arnés añade permisos de host sólo a su copia temporal para fixtures, sin
fingir el gesto real de la acción ni modificar el perfil personal. Se conservan
dos fallos iniciales: import dinámico en ServiceWorker no permitido y Origin de
esquema de extensión calculado como `null`; ambos corregidos en el arnés. El
test de fallo ASR encontró validación de ritmo después de cerrar: se corrigió
para ignorar paquetes cancelados antes de contar el ritmo.

El control del Brave personal se detuvo por no poder verificar su URL. No se
realizaron más entradas de UI. Es necesario recargar la extensión del perfil
personal. No se declara probado un video público, fidelidad o escucha física.
