# WorkSpace: audio real, personaje, letras y continuidad

Hito del 31 de octubre de 2026, hora de La Paz. Sigue la dirección de
`PLAN_PLATAFORMA.md` y conserva los demás servicios de Melodi. No declara completo
el objetivo integral de control del ordenador ni la compatibilidad de otros SO.

## Audio y controles

La cuenta ya había autorizado el SDK y Brivany figuraba como dispositivo activo.
Se reprodujo el fallo real: con el host completamente oculto (`Hide`), el contador
SDK avanzaba sin que WebView2 indicara audio. Mostrar el controlador fuera del área
del escritorio hizo que `IsDocumentPlayingAudio` pasara a verdadero. Se conserva
el host renderizado fuera del escritorio virtual, sin activación ni entrada de
barra de tareas, con `IsMuted=False`. No se captura audio ni se accede al micrófono.
El usuario confirmó después que se escucha en su salida habitual. Una señal de
WebView2 no equivale por sí sola a una medida acústica; la confirmación manual se
registra separada, sin adjuntar la conversación.

Pausa, reanudación, siguiente, anterior, posición y volumen del dispositivo local
usan métodos del SDK directamente. Se reactivan los permisos de audio al reanudar.
El resultado se confirma por una respuesta asíncrona acotada de 8 segundos y el
estado SDK se comunica a las superficies de WorkSpace. No espera el próximo ciclo
HTTP para actualizar icono, posición y ondas. Los accesos nativos siguen limitados
a la página exacta del reproductor; los tokens no salen al chat ni a WorkSpace.
Aleatorio y repetición siguen usando Web API y los cambios se observan en el SDK.
Se respetan restricciones de Spotify, incluido el período de carga de una pista.

El SDK publica estado cada 750 ms y por evento, con revisiones para ignorar
respuestas anteriores. Se aceptan tiempos numéricos finitos con decimales y un
pequeño exceso transitorio al finalizar; se redondean y limitan al intervalo de
la canción. Antes se exigían enteros y se perdían actualizaciones después de un
salto al final. El botón principal permanece blanco también durante una orden
pendiente o deshabilitada, sin bajar opacidad ni añadir sombra. `aria-busy` y el
bloqueo lógico evitan acciones duplicadas. Se prepara el host autorizado al abrir
la barra; registrar el dispositivo no inicia música por sí solo.

## Ondas y teleprompter

Al recibir reproducción activa, las ondas aparecen con transición de entrada
corta. Al pausar se conserva la ambientación, estática, durante cinco minutos;
si no se reanuda, se retira con opacidad durante 2,4 segundos. Reanudar cancela
esa retirada. Los paneles conservan el degradado de portada durante ese plazo.
Movimiento reducido desactiva animación y transiciones. Las ondas comunican estado:
no se hace análisis de audio ni se afirma sincronización con pulsos musicales.

Se retiraron del reproductor los textos y botones de proveedor y de desplazamiento
que pidió quitar el usuario. La procedencia de las letras se conserva en los datos
del servicio y en esta documentación. El teleprompter mantiene tres líneas, con
centro nítido y vecinas atenuadas/difuminadas. Sin marcas temporales no se inventan
horarios; el texto simple conserva navegación manual.

LRCLIB devolvió 502 en el diagnóstico. La cadena ahora busca tiempos con **SyncLRC**
antes de aceptar Lyrics.ovh. Se solicita la API pública documentada, únicamente
con título, artistas, álbum y duración. Se valida título, artista principal y
colaboradores conocidos, y duración con tolerancia de 2,1 segundos. Se admiten
separadores `feat.` equivalentes; no otra identidad principal. Se eliminan marcas
por palabra del texto a mostrar cuando llegan en LRC mejorado. No se renderiza
HTML ni se interpreta texto de proveedores como instrucciones.

La comprobación real de la canción observada obtuvo 104 líneas con tiempos,
identidad/duración coincidentes. Las pruebas sintéticas verifican avance, pausa,
salto adelante y atrás. Los resultados simples caducan tras 120 segundos para
poder actualizarse a una versión sincronizada; la UI tampoco los conserva para
siempre. Se respetan pausas `Retry-After` y límites de cada proveedor. No se garantiza
cobertura completa ni precisión semántica de todos los registros.

## Cola y biblioteca

Se retiró **Recientes** de la biblioteca; quedan Playlists, Álbumes y Canciones.
El último tema puede seguir figurando como última escucha cuando Spotify no
comparte reproducción activa, separado de la biblioteca y sin ondas falsas.

Había un fallo en la implementación: un tema guardado se iniciaba como una lista
de una sola URI. La prueba anterior de audio también había usado una sola URI;
no conservó un contexto completo. El diagnóstico de cola posterior encontró diez
entradas pero una única identidad distinta. Se conservan las evidencias y esta
corrección; no se atribuye ese resultado a una biblioteca vacía del usuario.

Playlists y álbumes conservan su `context_uri` para que Spotify gestione su cola.
En canciones guardadas se construye una cola real a partir de elementos observados
de la biblioteca, comenzando en la selección. Si no tiene contexto guardado, se
usan otras canciones guardadas disponibles. Los duplicados se eliminan. La carga
inicial es acotada y las páginas siguientes se añaden antes de agotar el bloque.
Solo hay un trabajador por cola, con generación cancelable al cambiar selección o
cuenta. Cada append se envía una vez; ante un fallo ambiguo no se repite para no
duplicar pistas. Un error se comunica conservando los temas ya cargados. Al terminar
una colección finita, se respeta la repetición elegida por el usuario, no se promete
una radio infinita. No se consultan endpoints privados.

## Personaje de Melodi

Se sustituyeron los ojos sueltos por un personaje pequeño con cuerpo marfil
redondeado, sombreado suave, ojos oscuros, mejillas discretas y manos. La referencia
fue el video Coucou proporcionado por el usuario; no se copió ni adjuntó el video
original a la bitácora. La figura se dibuja en HTML/CSS, sin sprites descargados.

Conserva un área central protegida, movimiento horizontal limitado a ella y mirada
ocasional al cursor. Respira suavemente, saluda al abrir, cambia durante actividad
y descansa con párpados cerrados y una `z` tras inactividad. Ajustes de animación y
movimiento reducido detienen esos gestos. Se revisó la figura y su reposo en
capturas sintéticas; no tapó herramientas en los ocho anchos comprobados.

## Pruebas y límites

- `tools.verify spotify`: 36 pruebas locales con cuentas/transporte sustituidos:
  SDK, aislamiento, respuestas asíncronas, tiempos fraccionarios/hostiles, colas
  multipista y extensión, fuentes con tiempos, fallback y actualización de letra.
- `tools.verify island-ui`: puente/proveedores sustituidos. Controles, indicador
  pendiente sin oscurecimiento, cinco minutos de permanencia y fade, reproducción
  por eventos, personaje en ocho anchos y teleprompter al avanzar/pausar/buscar.
  No hay pestaña Recientes ni los textos retirados. Las capturas usan contenido
  sintético. Cero llamadas externas desde esa suite.
- `tools.verify work`: 26 pruebas; `desktop`: 21 pruebas locales.
- Diagnóstico nativo de audio: tres recorridos reales separados conservaron la
  falta de audio oculta, el contraste visible/oculto y la solución renderizada
  fuera de pantalla. El usuario confirmó audibilidad. Los métodos directos
  respondieron en 16 ms en ese diagnóstico; no se generaliza como latencia máxima.
- `tools.check_spotify_controls_native --run`: cuenta/SDK/ventanas reales. La última
  ejecución comprobó pausa, reproducción, anterior, siguiente, posición, volumen,
  aleatorio activado/desactivado y repetición contexto/canción/desactivada. Confirmó
  una cola de 20 canciones distintas y paso natural a otra sin enviar `next`, con
  salida de audio no silenciada. Se pausó al terminar y se restauraron volumen,
  aleatorio y repetición previos. No se afirma una escucha ininterrumpida de horas.
- Se conservan cuatro ejecuciones fallidas de controles. Las primeras accionaban
  controles durante carga de pista; la última detectó rechazo de tiempos SDK con
  decimales al acercarse al final. La ejecución corregida final pasó. Las
  restricciones transitorias de carga se esperan; no se declaran todos los botones
  disponibles durante un estado que Spotify restringe.

Informes: `tmp/spotify-audio-controls/`, `docs/verification-history/` y capturas sintéticas
`tmp/workspace-compact-ui/`. Los informes reales contienen estados, recuentos,
latencias y rutas, sin títulos, artistas, IDs, portadas, palabras de canciones,
tokens ni audio. Las peticiones API nativas conocidas se cuentan en cada informe;
tráfico interno SDK/CDN y coste monetario no se midieron. No hubo inferencia de
pago. No se extrapola esta comprobación Windows a macOS/Linux.

Fuentes: [SDK Spotify](https://developer.spotify.com/documentation/web-playback-sdk/reference),
[cola Spotify](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback),
[SyncLRC API](https://synclrc.dev/), [LRCLIB API](https://lrclib.net/docs.txt),
[WebView2 audio](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_8).


## Corrección posterior: carga anticipada y ausencia honesta de tiempos

Ante otra canción que tardó en cargar y mostró texto fijo, se comprobó su registro:
SyncLRC entregó HTTP 200, 71 líneas con tiempos y coincidencia de identidad/duración.
La fuente con tiempos pasa a consultarse primero, sin esperar un fallo de LRCLIB.
La carga empieza al cambiar la canción desde la barra, aunque Música esté recogida.
Mientras se consulta se muestran tres trazos discretos; se borran las líneas viejas.
El reproductor muestra únicamente registros con tiempos: un resultado simple no
se presenta ya como una estrofa fija. Si no hay tiempos, el centro informa
«Sin letra sincronizada». No se fabrican tiempos ni se sincroniza por reparto
uniforme del texto. Las fuentes simples pueden seguir en el servicio, pero no
acreditan un teleprompter sincronizado. Esta corrección sustituye el comportamiento
manual de texto simple descrito antes y conserva su histórico.
