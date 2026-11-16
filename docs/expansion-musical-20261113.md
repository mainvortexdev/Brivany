# Expansión musical · 13 de noviembre

Implementación local de la casilla Expansión musical, apagada por defecto para
nuevos usuarios. Se activa tras 60 segundos de inactividad del sistema, únicamente
con reproducción detectada en Spotify o YouTube. Movimiento, teclado, pausa,
pérdida de fuente y desactivación cierran la escena. La vista previa explícita
permite revisar la canción actual sin esperar. Se corrigió su estado para que
una pausa no deje una vista previa capaz de reaparecer durante el uso del equipo.

Dos estilos seleccionables conservan las letras reales y sus tiempos: Luna y
órbita y Tipografía ámbar. El segundo toma de la referencia nueva el fondo negro,
el reloj, la luz cálida del borde y las composiciones centradas con bandas de
resaltado. Seis composiciones por frases cambian jerarquía, tamaño, peso,
alineación e inclinación. Se respeta movimiento reducido. Una letra no disponible
se indica como tal; no se inventan versos ni tiempos por palabra.

El espectro usa loopback del sistema cuando la escena está lista. Al renderer
se envían 64 bandas; no se abre micrófono, guarda audio ni envía PCM a proveedores.
La extensión transmite metadatos de música de YouTube mediante el canal local
autenticado, con caducidad de ocho segundos y miniatura canónica del video.
Se consulta el proveedor existente de letras sincronizadas y, cuando existe,
la línea de subtítulos del video seleccionado. La disponibilidad de letra depende
de una coincidencia de versión y duración. Spotify se conecta mediante su propia
autorización; ver [corrección de arranque y Spotify](arranque-spotify-20261113.md).

Se prepararon también los acompañantes del equipo de Melodi en código y pruebas
con tareas sintéticas. Su interfaz nativa no se activó en la instalación en este
hito; el usuario pidió revisar primero la función musical.

Pruebas locales, sin fuentes personales, dispositivos de audio ni proveedores:

- 23 casos de inactividad, vista previa, metadatos y espectro sintético:
  `tmp/verification/music-expansion-20261113T055858-4159fb8e.json`.
- Cinco pruebas de composición:
  `tmp/verification/music-composition-20261113T055335-52674616.json`.
- WebSocket real en loopback con metadatos sintéticos:
  `tmp/verification/music-presence-protocol-20261113T054023-462fa02e.json`.
- Extensión y regresiones con sockets/DOM sustituidos:
  `tmp/verification/music-extension-20261113T054025-d5fbcc6b.json`.
- Edge sin GPU, fuentes sustituidas, CSP estricta y tamaños 375/800/1280 px:
  `tmp/verification/workspace-companions-music-ui-20261113T055442-c51aca96.json`.

El primer ensayo ámbar detectó que una banda inclinada salía del margen. Se
reservó espacio lateral y se corrigió un stub de preferencias del banco. Los
informes fallidos se conservan. Las imágenes de prueba usan letras y música
sintéticas; no se adjuntaron los videos originales a la bitácora.

La instalación recibió 16 archivos musicales con respaldo y comprobación de
importación, sin desplegar la interfaz nueva de agentes ni otras diferencias
de traducción del repositorio. La casilla quedó activada por petición del usuario
y Tipografía ámbar seleccionada. Evidencia:
`tmp/music-expansion-activation/installation.json`. La comprobación visual de
YouTube se interrumpió al no poder verificar la URL del navegador; no se acredita
la recarga de la extensión instalada, una letra personal, captura de audio real
ni el minuto de inactividad real. La función estaba activada al comenzar la
corrección de arranque posterior; se mantienen estos límites.

Activos locales con procedencia:

- `music-assets/moon.jpg`: [Nearside Spectacular](https://science.nasa.gov/photojournal/nearside-spectacular/), NASA/GSFC/Arizona State University.
- `music-assets/earth.jpg`: [Blue Marble, Apollo 17](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-from-apollo-17-1133/), NASA/JSC.

Las descargas de estos activos y el tráfico de desarrollo no se contabilizaron
por solicitud. No se usaron modelos o síntesis de voz para las pruebas; GPU y
facturación agregadas no se midieron. Los hashes de instalación prueban bytes,
no fidelidad perceptual al video ni funcionamiento con cuentas reales.
