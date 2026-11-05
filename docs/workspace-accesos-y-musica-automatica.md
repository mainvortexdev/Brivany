# WorkSpace: accesos directos y música automática

31 de octubre de 2026, hora de La Paz. Sustituye la distribución del hito anterior
sin reabrir la edición de navegador ni el objetivo general de control del
ordenador, que continúa pausado.

## Interfaz implementada

La barra incorpora el logo completo `brivany.` con el punto azul a la izquierda.
Los accesos visibles son **Traducción auditiva**, **Selección de área**, **Música**
y **Abrir app**, agrupados con separación constante y alineación vertical común.
Melodi conserva su zona central en escritorio. En anchos estrechos se mantiene el
logo a la izquierda, se acopla el personaje a la derecha y la fila de herramientas
se puede desplazar sin barra de scroll visible; el foco revela cada acción.

Traducción auditiva abre el módulo existente de video y traducción de la app.
Selección de área abre directamente el selector nativo para traducir el texto
seleccionado. Se eliminan el modal intermedio, el control «Detectar otro idioma»
y la acción Explicar. El puente de región rechaza `explain` antes de seleccionar
o enviar una referencia. Se conservan la conversación y la interpretación de
imágenes que forman parte del chat.

Por la última indicación del usuario, **Reducir música no aparece en WorkSpace**.
El ajuste está activado por defecto y se gestiona en **Ajustes → Melodi WorkSpace
→ Música**, junto con las exclusiones adicionales de juegos. La elección del
usuario se guarda localmente y se conserva en siguientes arranques.

## Reducción de música

Se incorpora un adaptador Windows de Core Audio que enumera las sesiones de
salida activas y consulta su pico y estado de silencio. No abre captura PCM,
micrófono, ASR ni grabación; no envía audio o metadatos de procesos a proveedores.
Consulta todos los dispositivos de salida activos. La actividad debe superar un
umbral de pico de 0,002 y se consulta aproximadamente cada 100 ms. Esto no
garantiza detectar cualquier señal infinitesimal o impulso extremadamente breve.

La música del reproductor local **Brivany** baja gradualmente hasta el 25 % del
volumen elegido en unos 650 ms. Tras 1,5 s sin actividad externa vuelve suavemente
al volumen elegido en unos 1,5 s. No modifica el volumen maestro de Windows ni
el de dispositivos Spotify remotos. El volumen elegido por el usuario se separa
de esta ganancia temporal: cambiarlo o silenciarlo durante la reducción conserva
esa elección al restaurar. Los cambios se serializan para no superponer órdenes
antiguas con ajustes nuevos.

Se excluyen el proceso de Brivany y sus hosts WebView2 para evitar que la propia
música se vuelva a detectar. Los programas externos abiertos por Melodi siguen
contando como fuentes ajenas. La voz de Melodi y los medios de los módulos de la
app notifican solamente su estado de reproducción; se contemplan también estados
de reproductores YouTube incrustados que los publiquen.

Los juegos se identifican mediante rutas registradas en GameConfigStore,
carpetas de instalación conocidas y nombres de ejecutables, además de las
exclusiones que el usuario añada en Ajustes. Es una clasificación local con
heurísticas, no una identificación universal de cualquier juego. Juegos con
rutas no reconocidas requieren añadir su ejecutable. El audio de un juego y un
video mezclados por el mismo proceso de navegador no se puede distinguir solo
con los metadatos de sesión; excluir ese navegador excluye su audio completo.

El adaptador de detección está implementado y comprobado en Windows. En macOS y
Linux informa que no está disponible y no intenta acceder a las APIs de Windows.
La arquitectura no declara esos adaptadores como terminados.

## Pruebas y alcance

- `music-ducking`: ocho pruebas de actividad, silencio con espera, juegos,
  exclusiones, persistencia, audio propio y programas externos iniciados por
  Melodi. Sin captura o reproducción de audio.
- `music-ducking-volume`: tres pruebas del volumen gradual, cambios manuales,
  silencio, cambios externos, retorno y cancelación, con reloj y SDK sustituidos.
- `island-ui`: barra y accesos directos, eliminación de detector/Explicar,
  selector con imagen sintética, ocho anchos, navegación por teclado en tamaños
  pequeños y continuidad de controles musicales. Recorre también el script del
  reproductor con SDK sustituido: reducción, cambio de volumen durante ella y
  restauración, conservando el volumen elegido en los estados publicados.
- `computer-images-agents-ui`: además del chat, prueba el ajuste activado,
  desactivación/reactivación y añadir/quitar una exclusión mediante puente
  sustituido. Siete tamaños de interfaz, sin hardware de voz.
- `work`: 28 pruebas; incluye rechazo de la explicación de región.
- `spotify`: 36 pruebas de servicio, imágenes, letras y host aislado.

La comprobación nativa separada reprodujo un tono sintético de tres segundos,
amplitud 0,035, en un proceso propio. Core Audio real detectó su actividad; la
política emitió reducción y restauración y excluyó la fuente al identificarla
como propia. No se capturó ni guardó audio ni rutas de otros procesos. La orden
de ganancia en ese ensayo era un callback sustituido; la rampa del SDK se probó
por separado con sustituto. No se declara una nueva comprobación auditiva de
música Spotify física ni de todas las aplicaciones o juegos.

El primer intento nativo falló porque el comprobador filtraba el PID del
lanzador de la venv y el sonido procedía de su intérprete hijo. Se conservó el
fallo y se corrigió el filtro del ensayo, sin ocultarlo ni atribuirle éxito.
El recorrido nativo corregido pasó. Las suites UI bloquearon llamadas externas.

Tras reiniciar la app real, la API local confirma escritorio, bandeja y WorkSpace
activos, ajuste habilitado, monitor en ejecución y ausencia de error. Antes de
reiniciar se consultó Spotify y no había reproducción activa. El tráfico externo
de fondo de la app no se midió; no se declara consumo global cero. No se cambiaron
cuentas, permisos ni enlaces públicos.

Evidencia:

- `docs/verification-history/music-ducking-20261101T033843-11864eee.json`
- `docs/verification-history/music-ducking-volume-20261101T033639-000e19af.json`
- `docs/verification-history/island-ui-20261101T033631-fee028de.json`
- `docs/verification-history/computer-images-agents-ui-20261101T033631-8bd17553.json`
- `docs/verification-history/work-20261101T033631-812e5d37.json`
- `docs/verification-history/spotify-20261101T032939-3ebe18ae.json`
- `tmp/music-ducking-native/report-first-failed.json`
- `tmp/music-ducking-native/report.json`
- `tmp/music-ducking-native/app-runtime-final.json`
- `tmp/music-ducking-native/workspace-final.json`
- `tmp/workspace-compact-ui/workspace-distributed.png` (render con puente sustituido)

Base técnica consultada: [sesiones Core Audio por proceso](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-getprocessid),
[picos de audio de Windows](https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nf-endpointvolume-iaudiometerinformation-getpeakvalue)
y [volumen local del SDK Spotify](https://developer.spotify.com/documentation/web-playback-sdk/reference#spotifyplayer-setvolume).
