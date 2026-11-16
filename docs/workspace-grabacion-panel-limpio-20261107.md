# WorkSpace · grabación y panel limpio

7 de noviembre de 2026. Continuación del objetivo activo y aplicación de la
corrección visual solicitada mediante Foto 1. Se mantienen las posiciones de
la barra y la identidad de Melodi.

El cajón de Herramientas sustituye las pestañas horizontales por un selector.
El reloj se ofrece como herramienta independiente; ya no ocupa una cabecera en
todas las vistas. Apariencia y opciones de grabación viven en la ventana de
Ajustes, sección Melodi WorkSpace. El engranaje del cajón abre esa sección.
El panel nativo normal pasa de 360 a 280 px de alto.

Grabar muestra la fuente, el contador y una acción principal. Durante la captura
se oculta Actualizar; se mantienen Detener y el indicador de la barra. No muestra
ruta, límites, opciones de fluidez/cursor ni textos auxiliares permanentes.
Los errores siguen apareciendo cuando requieren intervención. Ajustes conserva
la carpeta, 15/30 fps, cursor y límites. Las preferencias se aplican entre vistas
por eventos de almacenamiento y preservan notas y temporizadores existentes.

## Grabación local

Se enumeran pantallas y ventanas solo por acción del usuario. La selección usa
IDs opacos; se comprueban ventana, visibilidad y proceso antes de capturar.
No se aceptan comandos ni rutas arbitrarias desde el puente. Todas las acciones
públicas validan el origen de confianza antes de acceder al sistema.

La captura usa [gdigrab de FFmpeg](https://www.ffmpeg.org/ffmpeg-devices.html#gdigrab),
sin audio ni subida. FFmpeg debe estar instalado y disponible en PATH. Solo se
crea el proceso al pulsar Grabar. El ajuste inicial es 15 fps, codificación con
dos hilos y salida de hasta 1080p. Se limita a 30 minutos o 2 GB. Se guarda en
Vídeos/Brivany con nombre único, sin sobrescribir.

Detener solicita el cierre del capturador y prepara el MP4 copiando el flujo
codificado, sin otra codificación. Se conserva el MKV parcial si falla el guardado
del MP4. El cierre de Brivany termina su propio proceso de captura. No termina
otros procesos FFmpeg. La interfaz no sondea el grabador en reposo y solo actualiza
el contador mientras su vista está visible.

## Comprobaciones

Pasaron 14 casos locales con captura sustituida: límites, confianza, cierre,
duplicación, falta de codificador/espacio, interrupciones, conservación del MKV y
fallo de la tubería. Pasaron 45 casos de Work, incluida la altura compacta y el
acceso directo a Ajustes. La captura GDI real se hizo únicamente sobre una ventana
sintética propia: 640×360, 52 fotogramas, 3,466 s y sin audio. Se decodificó el MP4
completo y se comprobó cambio de píxeles dentro del contenido propio y cierre del
proceso. No se capturó el escritorio personal.

Pasaron Edge con los archivos reales para configuración entre dos páginas,
grabación, widgets, diseño integrado y agenda/clima/webs con sus puentes
sustituidos. Se revisaron el panel a 340 px y Ajustes en escritorio y a 340 px.
Las pruebas de interfaz verifican también que los controles trasladados no
permanecen en Grabar y que el selector funciona con teclado.

Se conserva el primer fallo nativo: exigía fracción exacta de FPS aunque el
remux desde Matroska redondea a milisegundos (media 26000/1733 frente a nominal
15/1). Se añadió CFR explícito y una tolerancia de 0,02 fps sobre la media. Se
conserva también el primer fallo de interfaz por nombre accesible de Fluidez;
se corrigió antes de trasladar esa opción a Ajustes por petición del usuario.
Los informes posteriores no sustituyen los fallidos.

No hubo llamadas a proveedores ni generación de voz/medios. El tiempo de GPU de
las comprobaciones de navegador y captura es desconocido; se registra como tal.
Se ajustó `tools.verify` para usar null en las suites de interfaz. Los ceros de
GPU en los informes anteriores de diseño/agenda no provienen de una medición y
no se usan como evidencia de consumo nulo; se conserva su contenido histórico.
No se certifica el funcionamiento de ventanas protegidas/minimizadas, captura de
monitor completo, audio, una instancia personal ya abierta ni memoria/CPU de
todo Desktop. El objetivo general y las otras filas pendientes siguen activos.

[Informes concretos y límites](../tmp/verification/workspace-recording-clean-milestone-20261107.json).
