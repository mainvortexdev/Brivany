# WorkSpace compacto · ojos centrales y apertura con intención

Actualización: el [retorno HTTPS en producción](spotify-retorno-https.md) sustituye
el callback loopback. El Client ID público del editor ya está configurado;
el escritorio obtiene esa configuración desde el dominio.

31 de octubre de 2026, America/La_Paz. Sustituye el tamaño, distribución y flujo
de configuración visibles de [WorkSpace premium](melodi-workspace-premium.md).

La barra conserva negro opaco, 40 px de reserva Windows y exclusión de tareas.
Ahora presenta solo los nombres de las herramientas. Un espacio central simétrico
queda reservado al rostro: los ojos se desplazan dentro de esa zona, permanecen
separados de los botones y vuelven al centro para dormir. Se conservan la mirada
ocasional y la preferencia de movimiento reducido. Al cambiar la resolución se
recoloca el rostro dentro de su espacio; las herramientas menos frecuentes siguen
disponibles en Más.

Captura baja de 620 × 220 a 336 × 148 px. Los paneles tienen cuatro esquinas
curvas y una separación superior de 6 px. La región nativa coincide con el panel;
la parte invisible de la ventana anfitriona no intercepta el ratón. El tamaño
depende del contenido: vinculación Spotify 336 × 212, reproductor 384 × 376,
Skills 336 × 210 y Video 336 × 172, acotados por el monitor. No se amplía la reserva
al abrirlos.

Se retiraron los atributos `title` de la barra para eliminar los avisos nativos.
La aproximación inicial espera 480 ms; cambiar de una herramienta abierta a otra
espera 140 ms. Un candidato estable no reinicia su temporizador en cada lectura
del cursor; pasar brevemente o salir cancela la apertura. El rostro y los huecos
entre botones no disparan paneles. La salida mantiene 1200 ms de tolerancia.
Video, Skills, Espacios y Conexiones tienen paneles propios; sus acciones abren
los módulos existentes solo al pulsarlas. No se abren programas por el mero hover.

## Spotify: flujo de usuario y configuración de la aplicación

Música muestra un único botón «Vincular Spotify». Con un Client ID de Brivany
preconfigurado, abre la autorización oficial en el navegador; el callback PKCE
local guarda la autorización y el estado del panel se actualiza al regresar.
No se piden identificadores de desarrollador en este panel.

La configuración de editor sigue siendo indispensable una sola vez: hay que
registrar la app Brivany en Spotify y proporcionar su Client ID público al
escritorio. No se inventó un identificador ni se usó el de terceros. Mientras no
se configure, el botón comunica que la integración no está habilitada; no simula
que la cuenta se vinculó. No se realizó autenticación ni reproducción real.
La creación de la app y la aceptación de sus términos quedan en manos del usuario.

Datos para el formulario de registro:

- Nombre: Brivany.
- Descripción: «Brivany is a desktop assistant that lets users connect their
  Spotify account to control playback on their Spotify devices.»
- Website: `https://brivany.example`.
- Redirect URI vigente: `https://brivany.example/spotify/callback`.
- API: Web API. No se utiliza Web Playback SDK, Ads API ni SDKs de iOS/Android.

El propietario necesita Premium para que la app funcione en modo desarrollo;
reproducir mediante la API también requiere Premium. Fuentes:
[modo desarrollo](https://developer.spotify.com/documentation/web-api/concepts/quota-modes),
[reproducción](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback),
[redirecciones loopback](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

## Comprobaciones

- `work`: 26 pruebas de ciclo de vida, audio/consentimiento, geometría, proximidad,
  opacidad, mirada y AppBar.
- `island-ui`: puente y proveedores sustituidos; nueve paneles en cinco tamaños,
  ocho anchos de barra con ojos dentro de su zona y sin solapar herramientas,
  ausencia de íconos/avisos, aproximación breve ignorada, cambio Video → Skills,
  un solo botón de Spotify con una app sustituida ya configurada, dispositivos,
  letras, reposo y movimiento reducido. No acredita acceso a una cuenta real.
- `spotify`: ocho pruebas del protocolo con HTTP/almacén sustituidos; sin Spotify
  externo ni música real.
- `tmp/workspace-compact-native/report.json`: Windows/WebView2 real, ventanas
  propias; anfitrión de 440 px, anclajes de 336 px a ambos extremos, panel 6 px
  debajo de la barra, alfa 255, reserva única y retirada normal. El ensayo
  coexistió con la barra anterior, reservó y=40..80 y restauró y=40. Sin captura,
  audio ni inferencia; consumo de red de fondo desconocido.

Las primeras comprobaciones detectaron un desplazamiento de panel al reducir el
viewport y se conservó el fallo. El ajuste de resolución ahora recoloca tanto
panel como rostro. Las capturas de `tmp/workspace-compact-ui/` son fixtures
sintéticas. No incluyen el escritorio ni los originales del usuario.
