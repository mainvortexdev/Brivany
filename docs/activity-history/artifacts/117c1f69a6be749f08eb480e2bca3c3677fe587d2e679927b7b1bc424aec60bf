# Recuperación de Traducción auditiva · 0.4.4

En 0.4.3, un turno de Muse podía quedar abierto indefinidamente. El reloj del
reproductor retenía la imagen delante de ese turno mientras la captura seguía
avanzando. Cerca del inicio también podía haber dos rangos decodificables con
un hueco entre ellos. El salto anterior cubría huecos de hasta 250 ms y
requería que el reloj hubiera llegado casi al borde del primer rango.

## Cambios

- Pulsar Traducción auditiva conserva una única selección activa. Si el
  video está en pausa o todavía se está cargando, la selección queda preparada
  y la conexión empieza cuando el video puede reproducirse.
- La reproducción usa el original si un turno pendiente supera su margen de
  espera. La política usa doce segundos desde el inicio del turno y da cuatro
  segundos adicionales tras un cierre reciente. El doblaje puede volver en el
  siguiente turno disponible. Un doblaje tardío del intervalo ya liberado se
  descarta para evitar repetir lo que el usuario ya oyó.
- Brivany resuelve un turno finalizado sin texto como un intervalo sin doblaje.
  La pestaña también puede saltar un hueco corto del grabador al primer cuadro
  decodificable y reproducir la voz de ese intervalo. Ese salto admite una
  diferencia local de hasta unos 800 ms en la imagen.
- Si el reproductor se queda sin avanzar o la demora llega al límite de
  recuperación, la extensión devuelve el control, el volumen y, cuando es
  posible, la posición que se veía al reproductor de la página.
- Si el reproductor vacía su fuente, la extensión termina de reproducir lo
  que ya había capturado antes de cerrar.

## Comprobaciones

- Reproducción pública en Brave aislado desde el segundo 24 con 0.4.3.
  Dos voces completadas y tercer turno abierto desde 8,7 s, con 28 s de audio
  procesado. La imagen estaba retenida en 8,66 s. Informe
  `tmp/selected-video/inline-sync-1793796924580.json`.
- Una versión intermedia recuperó el original al fallar el decodificador,
  pero no llegó a reproducir las voces que ya estaban listas. El primer rango
  terminaba en 146 ms y el siguiente comenzaba en 539 ms. El caso quedó como
  prueba de regresión. Informe `tmp/selected-video/inline-sync-1793797738410.json`.
- Brave aislado, MP4 propio y transporte sustituido. Cuatro solicitudes de
  WorkSpace con el video en pausa crearon una sola sesión tras pulsar reproducir.
  Brave reprodujo tres frases de prueba y se liberó el final. Informe
  `tmp/selected-video/inline-sync-1793797736849.json`.
- Una segunda prueba local inyectó un primer turno sin finalizar. El navegador
  recuperó el volumen de origen en el tramo detenido, ignoró su doblaje tardío
  y reprodujo las dos frases siguientes a velocidad natural, con diferencias
  de −23 y −15 ms. Informe `tmp/selected-video/inline-sync-1793797985243.json`.
- El ensayo público desde el segundo 24 reprodujo dos voces y luego avanzó
  en original por el turno abierto, sin alcanzar el límite del búfer. YouTube
  vació el elemento de video. Se reprodujo el reinicio en Brave aislado sin
  cargar la extensión y con el error del reproductor visible. Informes
  `tmp/selected-video/inline-sync-1793798180817.json` y
  `tmp/selected-video/044-public-without-extension.json`.
- La prueba local que vacía el reproductor durante la traducción completó
  las tres voces y liberó la sesión después de consumir la cola. En el video
  público desde el segundo 54 se reprodujeron dos frases, con voces masculina
  y femenina, y la cola se consumió al vaciarse la fuente. La prueba pública
  quedó por debajo de las cinco frases exigidas para certificar continuidad.
  Informes `tmp/selected-video/inline-sync-1793798492470.json` y
  `tmp/selected-video/inline-sync-1793798509143.json`.
- El ensayo final con MP4 propio y Muse, Meta y Cartesia reales reprodujo las
  tres voces A/B/A y consumió el final. El primer audio llegó a 7,86 s desde
  la captura. Las entradas quedaron a menos de 25 ms de los turnos detectados.
  Informe `tmp/selected-video/inline-sync-1793798617607.json`.

Los informes contienen métricas y estados. Las pruebas con proveedores usaron
el video público en un perfil de Brave aislado, con coste agregado desconocido.
La escucha física y el objetivo de seis segundos siguen pendientes.
