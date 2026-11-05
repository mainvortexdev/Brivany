# WorkSpace: reproducción local, portadas y teleprompter

Hito del 31 de octubre de 2026, hora de La Paz. Continúa los ajustes de Música
sin modificar los módulos web originales, chat, voz live ni human-skills.

## Resultado

El reproductor incorpora un teleprompter de tres filas entre canción y controles.
La fila central se muestra nítida; anterior y siguiente tienen opacidad reducida
y un desenfoque suave. No hay botón Letra, enlace Abrir en Spotify ni paginación
Anterior / número / Siguiente. Biblioteca carga más elementos al desplazarse.
Se conserva la atribución de las letras. LRCLIB con tiempos sigue el progreso;
las letras sin tiempos permiten avanzar con rueda o flechas, sin inventar una
sincronización. Se corrigió además una excepción al consultar letras sin canción.

El foco por ratón no deja el recuadro del botón. El teclado conserva un indicador
redondeado accesible. Reproducir mantiene fondo claro al pasar el cursor. El panel
horizontal tiene 720 × 232 px preferidos, se limita a la pantalla y reorganiza su
contenido en tamaños estrechos. Las superficies bajas permiten desplazamiento
interno sin barras visibles.

Ondas ambientales recorren el ancho de la barra mientras Spotify informa de una
canción sonando, incluso con WorkSpace recogido. Los paneles de cualquier
herramienta reciben un degradado de la portada. La animación comunica reproducción;
**no analiza el audio ni representa sus pulsos reales**. La portada se procesa
localmente: dos colores de sus píxeles, con fallback neutro. Pausa, ausencia de
reproducción, pérdida de actualización y movimiento reducido detienen el efecto.
No se captura pantalla/audio para calcularlo y no se guardan imágenes en disco.

## Causa del estado vacío y portadas

Una comprobación real de solo lectura obtuvo 204 tanto en `/me/player` como en
`/me/player/currently-playing`, y ningún dispositivo activo. Es evidencia de que
Spotify no compartía reproducción actual en ese momento; no demuestra que el
usuario no hubiera escuchado música antes en su móvil. La interfaz anterior no
explicaba esa diferencia. Se añade respaldo de consulta de canción actual y una
vista de Recientes con permiso independiente. La última escucha se etiqueta como
tal, separada de reproducción activa, y no activa ondas ni presume un dispositivo
de origen. El historial no permite identificar el móvil de esa escucha.

Las portadas sí llegaban desde `mosaic.scdn.co`, pero el filtro solo admitía
`i.scdn.co/image`. Se corrigieron validación y CSP para ambos CDN exactos, sin
permitir hosts arbitrarios, puertos, credenciales, queries o redirecciones.
Las imágenes fallidas usan un placeholder. La extracción tiene límites de cuerpo
(1 MiB), dimensiones (8 millones de píxeles), tiempo (8 s) y caché (32 paletas).

## Brivany como dispositivo Spotify

Se incorpora el **Web Playback SDK oficial**, en una ventana nativa oculta propia
con nombre de dispositivo **Brivany**. Se crea bajo solicitud explícita desde
Escuchar aquí o al reproducir biblioteca. Se mantiene aunque el panel se recoja
o se cambie de herramienta; al salir de la app o desvincular, se desconecta.

Su puente está aislado del chat, WorkSpace y módulos. Solo la página local exacta
`/spotify-player` obtiene el access token de corta duración necesario para el SDK.
Refresh token y PKCE permanecen nativos/protegidos. Ningún método de WorkSpace
entrega tokens. Los eventos SDK se validan y se distinguen de la disponibilidad
real: antes de transferir/reproducir, el destino debe aparecer en dispositivos
observados por la API. Un evento ready simulado no acredita audio real.

El helper usa CSP para SDK/CDN/orígenes Spotify y políticas de reproducción
protegida y autoplay. En Windows, el proceso WebView2 permite autoplay para este
reproductor nativo; el SDK solo se inicia por acción del usuario y registrar el
dispositivo no inicia una canción por sí solo. Errores de DRM, cuenta Premium,
autorización y conexión se muestran sin inventar éxito. No hay captura de audio,
extracción de DRM ni sustitución de las grabaciones.

**Activación pendiente del usuario:** Conexiones → Spotify → Actualizar acceso;
aceptar los permisos nuevos y luego pulsar Escuchar aquí o elegir biblioteca.
Spotify exige **Premium** para reproducción mediante el SDK. Se solicitan
`streaming`, `user-read-private`, `user-read-email` (requisitos del SDK) y
`user-read-recently-played` (historial). Brivany no consulta ni guarda el correo del
perfil. La autorización anterior conserva reproducción remota/biblioteca mientras
no se amplíe el acceso. Actualizar acceso cierra el host local anterior para no
mezclar una nueva cuenta con un reproductor ya autorizado.

El puente HTTPS fue desplegado en `brivany.example`, versión
`ec2dfae2-d9da-43fb-9cba-d4f81223e019`, sin cambiar secreto, dominio ni Durable
Object. No se hizo una nueva autorización en nombre del usuario.

## Evidencias y alcance

- `tools.verify spotify`: 30 pruebas con servicios/cuentas sintéticos. Permisos,
  estado vacío e historial separado, respaldo de canción, portadas mosaic, paleta,
  restricciones, aislamiento del token SDK, dispositivo ready frente a observado,
  host único oculto y cierre.
- `tools.verify island-ui`: proveedores y puente sustituidos. Decodificación de
  portada sintética bajo CSP, paleta/ondas/degradados, pausa/ausencia/movimiento
  reducido, teleprompter seguro de tres filas, foco/hover, carga incremental y
  adaptación a resoluciones pequeñas. Incluye carga del SDK **sustituido**, entrega
  de token sintético, evento ready y desconexión en su página aislada.
- `tools.verify work`: 26 pruebas; `desktop`: 21. `spotify-relay`: 23 comprobaciones
  workerd/SQLite locales; fechas de compatibilidad local 2026-09-04 y producción
  2026-10-31 se mantienen distintas.
- `tools.check_work_native --run`: Windows real con Spotify sustituido; región
  CSS/nativa de 720 px en ambos extremos, AppBar, maximización, exclusión de barra
  de tareas y restauración del área previa. Finalizó con código de salida 0.
- Una comprobación nativa real confirmó contexto seguro, EME y aceptación de
  `com.widevine.alpha` con AAC. **No acredita registro SDK de la cuenta ni audio
  físico**. Esas comprobaciones necesitan la autorización Premium del usuario.
- Dos diagnósticos reales de solo lectura hicieron diez peticiones conocidas:
  nueve a Spotify y una al CDN público. Se comprobaron respuestas vacías actuales
  y portada mosaic decodificada/paleta disponible. Sin mutaciones de cuenta ni
  reproducción. No se guardaron títulos, IDs, nombres de dispositivos ni portadas
  reales. Importe no medido; sin inferencia de pago. Tráfico auxiliar de los
  motores nativos no medido.

Se conservan los informes fallidos de iteración: una excepción por letra nula se
corrigió; la aserción inmediata del hover se ajustó para esperar su transición.
Los resultados posteriores no sustituyen esos registros. Las capturas revisadas
usan contenido sintético. No acredita todos los catálogos, sincronización de
letras sin tiempos, reproducción física ni funcionamiento DRM en macOS/Linux.

Fuentes: [Spotify SDK](https://developer.spotify.com/documentation/web-playback-sdk),
[SDK y permisos](https://developer.spotify.com/documentation/web-playback-sdk/howtos/web-app-player/),
[historial](https://developer.spotify.com/documentation/web-api/reference/get-recently-played),
[flags WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags).
