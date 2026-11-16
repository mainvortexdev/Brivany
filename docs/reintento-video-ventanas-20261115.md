# Reintento contextual y controles de ventana

15 de noviembre de 2026. El reintento mostrado por el usuario había creado un
pedido nuevo con el texto «Vuelve a intentarlo». El proyecto observado tenía
30 segundos y ningún perfil de referencia, en vez de conservar los 98 segundos
y el adjunto del encargo anterior. Ese intento aparece cancelado; no se modifica
ni se borra su contenido. El consumo de proveedores de ese intento no se consultó.

El chat ahora identifica la tarea a la que responde. Un reintento explícito de
video recupera el pedido completo y sus archivos antes de pasar al planificador.
Se prepara con la misma autorización nativa que un encargo nuevo; no se ejecuta
por leer un historial o un archivo. Los límites originales se conservan. Si el
video sigue trabajando se observa esa tarea, sin crear otra; si falta contexto
o el archivo cambió se informa y se solicita el dato necesario. Una frase citada
o una orden diferente no se interpreta como reintento.

Se guarda el contexto de los pedidos de video cifrado con DPAPI por tarea y
conversación, separado de los recibos operativos. No se guardan tokens de control
ni se restauran permisos al reiniciar. Las carpetas del pedido se intersectan con
las todavía autorizadas. La selección de archivos se comprueba antes de usarla.
Los reintentos de otras conversaciones y tareas que no son videos no se ejecutan
mediante este mecanismo.

Para el fallo anterior a esta versión se recuperó el pedido desde su conversación
cifrada. El adjunto almacenado se comparó con el SHA-256 de su perfil de referencia
y se guardó el contexto recuperado también cifrado. Esa comparación verifica
identidad de bytes, no fidelidad visual. La comprobación real conservó los 98
segundos y un adjunto; no inició una nueva generación ni una llamada de proveedor.

Por petición posterior del usuario, minimizar sólo llama a la minimización de la
ventana. Se eliminó el enlace del evento nativo de minimizar que abría WorkSpace.
La X y Alt+F4 minimizan Brivany en la barra de tareas y mantienen el proceso y sus
servicios activos; no destruyen la ventana, cierran música ni abren WorkSpace.
La salida explícita desde la bandeja y el cierre de administración conservan la
limpieza completa habitual. Se añadió una X «Cerrar WorkSpace» en la barra
superior: cierra sus superficies, devuelve el área de escritorio y vuelve al chat.

## Verificaciones

- `video-retry`: seis pruebas locales con archivos, historial y protector
  sintéticos: recuperación completa, reinicio sin permisos heredados,
  aislamiento por conversación, cambio de archivo, tarea activa sin duplicación,
  recuperación de un reintento antiguo y frases citadas. Informe
  `tmp/verification/video-retry-20261115T220615-4b6d5c91.json`.
- `computer`: 37 pruebas. Informe
  `tmp/verification/computer-20261115T220616-a5a6f68d.json`.
- `work`: 47 pruebas con ventanas sustituidas, incluidos minimizar, cerrar,
  cierre de WorkSpace y devolución al chat. Informe
  `tmp/verification/work-20261115T220617-bfaa6e24.json`.
- `workspace-startup`: dos pruebas, incluidas la X nativa sin destrucción y la
  ausencia de apertura de WorkSpace al minimizar. Se aisló el banco de los
  servicios de fondo y del control privado real. Informe
  `tmp/verification/workspace-startup-20261115T220903-8a7370e2.json`.
- `chat-media-ui`: once comprobaciones en Edge propio sin ventana visible,
  incluyendo identificación de la tarea precedente, botones de ventana y la X
  de WorkSpace; los puentes nativos están sustituidos. Informe
  `tmp/verification/chat-media-ui-20261115T220812-0f6e1f74.json`.
- Recuperación real en lectura y reinicio normal con guardado cifrado, sin
  tareas activas ni salida forzada:
  `tmp/video-retry-real-recovery-20261115.json` y
  `tmp/retry-window-ready-20261115.json`.

Se corrigieron fallos del banco (dobles de ventana incompletos y listeners reales
en una prueba que debía ser simulada). Una aserción antigua de clonación se
actualizó al comportamiento ya existente de cambio durante traducción directa;
no se modificó esa función del producto. Los fallos registrados se conservan.

No se hicieron llamadas externas a proveedores para las pruebas descritas. No
se prueba ni certifica una nueva exportación o su calidad final. La minimización
física queda para la prueba del usuario; el reinicio y disponibilidad sí fueron
comprobaciones reales. GPU y tráfico de fondo de Brivany sin medir. El historial,
las referencias y los datos de voz privados no se adjuntan a la bitácora.
