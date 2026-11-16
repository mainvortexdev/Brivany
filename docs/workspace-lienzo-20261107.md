# Lienzo de Brivany · 7 de noviembre de 2026

Petición: una herramienta que abra una ventana de dibujo blanca, minimalista,
con varias herramientas, copia como imagen PNG y exportación. Se conserva el
selector compacto de Herramientas; elegir «Lienzo» abre el editor independiente
y devuelve el selector a su herramienta anterior.

## Implementación

- Ventana clara con título funcional y barra flotante de iconos. Sin eslóganes,
  explicaciones permanentes ni textos decorativos. Etiquetas accesibles y ayuda
  al pasar el puntero. Inspiración en convenciones Apple, usando fuentes del
  sistema y los controles de ventana de Windows.
- Lápiz, marcador translúcido, borrador, línea, rectángulo y elipse. Paleta y
  color personalizado, grosor, relleno de figuras, deshacer/rehacer. Atajos
  Ctrl+Z/Shift+Z, Ctrl+C/S, P/M/E/L/R/O. Zoom con rueda y desplazamiento con
  Espacio o botón central; soporte de eventos de lápiz y pellizco táctil.
- Lienzo inicial de 1600 × 1000 píxeles, fondo blanco incluido en el PNG.
  Tamaño editable de 256 a 4096 píxeles por lado, hasta 8 megapíxeles. Limpiar y
  cambiar de tamaño se pueden deshacer. Historial vectorial acotado a 2000
  acciones/200.000 puntos; sin copias raster completas por trazo.
- Copiar prepara formatos PNG, image/png y CF_DIB para pegar como imagen en
  aplicaciones Windows. El servicio no lee ni vigila el portapapeles.
- Exportar abre el selector de destino PNG de la propia ventana y escribe
  mediante archivo temporal y sustitución atómica. No se guarda un dibujo en
  disco sin una exportación elegida. Cancelar conserva el dibujo.
- Cerrar o crear otro lienzo pregunta por dibujos sin salida guardada/copiada.
  Se puede guardar PNG, descartar o cancelar. La salida general de la aplicación
  también espera esta decisión. Reabrir después de cerrar empieza en blanco.

La ventana y WebView2 se crean solo al pedir la herramienta y se destruyen al
cerrarla. No hay sondeo, llamadas a modelos, actividad de red ni bucle de dibujo
en reposo. Dos buffers raster se reutilizan y se liberan al cerrar; el historial
es vectorial. La exportación evita crear el bitmap DIB que solo necesita Copiar.
No se midió el ahorro porcentual de CPU/RAM de toda la aplicación.

La página tiene una API separada del puente principal, limitada a dibujo/salida
y su propia ventana. Cada entrada comprueba origen, ruta e identidad de la
ventana. El PNG se valida y normaliza localmente: hasta 16 MiB de entrada,
4096 píxeles por lado, 8 megapíxeles, un solo fotograma y sin metadatos.

## Evidencia y límites

Pruebas locales con trazos e imágenes sintéticas propias, sin proveedores,
cuentas, micrófono, captura del escritorio personal ni medios de referencia.

- `workspace-canvas`: 15 casos aprobados de PNG, límites, transparencia sobre
  blanco, exclusión de animación, guardado atómico, cancelación, origen, revisión,
  cierre y creación diferida. Tres casos usan HGLOBAL real de Win32 con llamadas
  de portapapeles sustituidas: bytes, cesión de propiedad, liberación ante error
  y conservación del portapapeles ocupado. No abren el portapapeles personal.
- `workspace-canvas-core`: 2 casos aprobados de historial, ramificaciones,
  dimensiones, identidad de salida y límites de memoria/trabajo.
- `workspace-canvas-ui`: Edge real con la página de producción y puente nativo
  sustituido. Puntero real de navegador para las seis herramientas, comprobación
  de colores por píxel, opacidad uniforme del marcador, borrado, deshacer,
  igualdad de los PNG de copiar/exportar, cancelar, cierre durante copia,
  520/340 píxeles y acceso por teclado. Cero fotogramas de animación durante el
  intervalo de reposo observado. No acredita todo el consumo del proceso.
- `workspace-canvas-native`: ventana WebView2 propia real, con entrada de puntero
  sintética. Creación diferida, reutilización, cierre nativo/cancelar, exportación
  real de renderer a Python y PNG de 1600 × 1000 con píxeles comprobados.
  Solo se sustituye la selección del diálogo por una ruta de prueba propia.
  Cierre, reapertura en blanco y temporizador de arranque retirado comprobados.
- Regresión `workspace-widgets-ui` aprobada: notas, preferencias, temporizador,
  controles, portapapeles sustituido y distribución a 340 píxeles.

Dos intentos de verificar una copia real en una estación de ventanas privada
fallaron al crear la estación (Windows, acceso denegado 5), antes de abrir un
portapapeles. Se preservan los informes fallidos. No se sustituyó el portapapeles
personal para forzar la prueba. El pegado físico entre aplicaciones, un lápiz
físico, pantalla táctil y el diálogo elegido manualmente quedan sin certificar.
Los resultados de navegador y WebView2 no se presentan como esa comprobación.

El primer ensayo de interfaz detectó un método inexistente del banco. El segundo
detectó que el botón enfocado quedaba fuera al reducir de 520 a 340 píxeles; se
corrigió el seguimiento del foco durante el redimensionado. Se preservan ambos
fallos. No se usó inferencia pagada; GPU total desconocida en navegador/nativo.

Informes del hito: `tmp/verification/workspace-canvas-milestone-20261107.json`.
Vista blanca entregable: `Exports/Brivany-Lienzo-20261107.png`.
El objetivo general de WorkSpace permanece activo.

Referencias de plataforma: [estaciones y portapapeles de Windows](https://learn.microsoft.com/en-us/windows/win32/winstation/window-stations),
[asignación de estación al proceso](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setprocesswindowstation),
[formatos estándar del portapapeles](https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats).
