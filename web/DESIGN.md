# Brivany · Primera interfaz

## Dirección

Voz al centro, controles claros y una sola acción principal. La web presenta el
producto; `/app` es la interfaz cotidiana; `/practice` conserva el taller de cámara.
`/human-skills` añade creación desde video y una biblioteca de práctica: una acción
de análisis, evidencia junto al paso y detalle progresivo sobre fuentes y consumo.
Texto breve en la pantalla principal y detalle progresivo en ajustes y fuentes.

`/activity` incorpora la bitácora de construcción: cronología tipográfica, filtros
discretos y evidencia desplegable. Comparte la paleta y no activa voz ni captura.
El frontend espacial se diseña en S2 y su visor comienza en S3, según la checklist.

`/spaces` y `/viewer` materializan ese espacio de trabajo: biblioteca a la
izquierda, escena dominante y un inspector compacto. La demostración mantiene
su origen visible y la escala sin verificar. Una captura preparada muestra sus
fotogramas, sin transformarse visualmente en la demo. Los controles de edición
se habilitan al seleccionar un objeto y los accesos externos quedan fuera del
recorrido local. En anchos pequeños la biblioteca es horizontal y el inspector
pasa debajo; sin WebGL permanece la inspección textual.

La edición añade deshacer/rehacer en la barra y variantes/exportación como
detalle progresivo del inspector. La revisión de captura se abre aparte, con
la imagen dominante y tres selecciones manuales como máximo. La máscara
rectangular, escala declarada y reconstrucción pendiente permanecen explícitas.
La portada muestra una captura del visor procedural, sin presentarla como un
cuarto reconstruido.

`/dubbing` añade un reproductor de video local con subtítulos y voz traducida.
La acción de inicio controla el envío de audio; el objetivo de 500 ms se muestra
como pendiente de verificación y las mediciones de primer audio se identifican
por separado. Los ajustes de clave se abren en un diálogo local.

## Color

Paleta basada en los tokens públicos de [apple.com](https://www.apple.com/),
contrastados en su CSS el 27 de octubre de 2026:

- Fondo blanco `#ffffff`; superficie secundaria `#f5f5f7`.
- Texto `#1d1d1f`; secundario `#6e6e73`; bordes `#d2d2d7`.
- Acción principal `#0071e3`; enlaces `#0066cc`.
- Sección oscura `#000000`; enlaces sobre oscuro `#2997ff`.

`palette.css` centraliza los roles en las tres superficies. Marca, icono,
ilustraciones y contenido propios de Brivany. La esfera de Melodi usa una
superficie plateada; solo reacciona al audio cuando hay captura autorizada.

## Tipografía y espacio

Tipografía de sistema: SF en Apple cuando esté disponible, Segoe UI en Windows.
Titulares con peso medio, cuerpo legible y espacio en blanco amplio. No se
descargan fuentes ni activos de terceros.

## Estados funcionales

Inactivo, esperando permiso, escuchando, hablando y reunión silenciosa.
El usuario puede detener la escucha e interrumpir la salida. La voz se reproduce
con sintetizadores locales; el ASR opcional del navegador necesita consentimiento
porque puede enviar audio a su proveedor. Las métricas de actividad acústica y
muletillas son orientativas, no evalúan personalidad ni certifican dominio.

## Adaptación

App responsive y manifest PWA para Windows, macOS, iPhone y Android. Las APIs y
la instalación dependen del navegador. Los anchos pequeños apilan el panel de
apoyo; controles principales de al menos 44 px y respeto por reduced-motion.
No equivale a binarios nativos ni a pruebas con todos los dispositivos.


## Identidad vigente · 31 de octubre de 2026

Marca completa: **brivany.**, con punto azul #0071e3. Icono reducido: b con
punto azul, reutilizando el activo original. Tipografía elegida por el usuario:
Georgia en títulos principales y de sección; Segoe UI en texto y controles, con
fuente del sistema como alternativa cuando Segoe UI no está instalada. Los
fragmentos de código conservan una fuente monoespaciada para su lectura.
La hoja compartida es `web/typography.css`.
