# Modelo con Meta real y conversación simultánea

El 30 de octubre de 2026 se comprobó una orden sintética por el mismo endpoint que
utiliza Melodi live con el control activado. El router Meta eligió creación 3D;
el planificador Meta generó una mesa y el compilador local publicó cinco GLB.
Otra petición de conversación produjo texto y frases mientras la solicitud del
modelo seguía en curso. El backend seleccionado fue el paquete local `bundled`.

La prueba recibió cuatro respuestas de Meta: dos clasificaciones de intención,
una conversación en streaming y un plan 3D. El límite de la herramienta era cinco
solicitudes, sin reintentos automáticos. Importe y tokens facturados desconocidos.
No se usaron Muse, Cartesia ni micrófono/altavoz físicos en este ensayo. No se
guardó una conversación personal ni audio. Las peticiones y la escena son fixtures.

Para comprobar concurrencia de manera reproducible, la fixture retuvo el inicio
de la solicitud del modelo hasta que empezó el streaming de conversación. Después
se observaron ambas solicitudes reales activas simultáneamente. Esta sincronización
pertenece a la prueba; no está en el servicio de producción y no mide una latencia
natural de una conversación hablada.

## Resultado geométrico observado

La orden pedía un tablero redondo de diámetro nominal 1.2 y espesor 0.08, centrado
en Y=0.75, y cuatro patas de altura 0.71 en X/Z ±0.35, centradas en Y=0.355.
El plan conservado contiene ese cilindro y cuatro cajas en dichas posiciones.
La revisión del render muestra la mesa con tablero circular y cuatro patas. Los
GLB y el contrato de escena son válidos. Esto comprueba este ejemplo procedural y
sus dimensiones de escena; no verifica escala física, resistencia, reconstrucción
de un objeto real ni todos los modelos que pueda proponer el proveedor.

El prompt de producción se alineó con el límite existente de cien piezas después
de expandir habitaciones y muebles. También distingue el tablero cilíndrico de un
compuesto `table`, cuyo compilador produce un tablero rectangular.

## Corrección visual derivada de la prueba

La primera inspección encontró que el panel desplazaba el micrófono y que el iframe
mostraba primero la biblioteca. El verificador anterior detectaba el nodo del micrófono,
sin exigir que estuviera dentro de la ventana. El informe inicial conserva
`mic_in_desktop_viewport:false`; no acredita esa accesibilidad.

El adaptador aislado de escritorio ahora ofrece:

- Una barra compacta con permiso, Detener y opciones. Las carpetas, instrucciones y
  recibos siguen accesibles en el desplegable, sin desplazar permanentemente el live.
- Modelo y conversación en columnas cuando caben, y modelo con controles de voz
  debajo en ventanas estrechas. El botón del micrófono y su estado/error quedan visibles.
- Un visor incrustado que abre directamente el canvas existente, con las piezas
  accesibles en un desplegable y una nota de escala conceptual. El módulo completo
  de Espacios conserva biblioteca, edición y controles adicionales.
- Notas y contexto con cierre explícito, cierre con Escape y cierre exterior.
  Abrir/cerrar la vista no sustituye el nodo del micrófono ni recarga el frame live.

No se modificaron `web/studio.*`, `web/spaces.*` ni el directorio Cognira. La
adaptación está en `desktop/experience`. Para repetir la revisión visual se reutilizó
la escena ya generada, sin otra petición a Meta.

## Evidencias y alcance

- `tmp/computer-model-real/api-model-first-run.json`: proveedor real, concurrencia y
  modelo; conserva la lectura inicial que encontraba el micrófono fuera de la vista.
- `tmp/computer-model-real/render-before-layout.json` y `live-before-layout.png`:
  estado anterior del panel y de la biblioteca incrustada.
- `tmp/computer-model-real/render-report.json`, `model-canvas.png`,
  `live-model-desktop.png` y `live-model-320.png`: comprobación posterior sobre la
  misma escena, con WebGL real y puente nativo sustituido.
- `tools.verify computer-ui`: recorrido repetible sin inferencia, ahora exige el
  micrófono dentro de 1440×844, 1120×760, 768×844, 390×844, 320×844, 390×568 y 640×480,
  estado de voz visible, conservación del nodo al cerrar y parada del permiso.

El render sobre la escena real verificó además selección de piezas y cierre de
opciones/contexto. En 640×480 la zona de modelo es reducida; no se afirma igual
comodidad o detalle visual en todas las resoluciones. El navegador de comprobación
es headless con software WebGL permitido, no una certificación de GPU física.

```powershell
# Nueva prueba real: puede consumir API y crea una fixture nueva.
.\.venv\Scripts\python.exe -X utf8 -B -m tools.check_computer_model_real --allow-paid
# Sólo volver a revisar una fixture creada antes, sin generar otra escena.
.\.venv\Scripts\python.exe -X utf8 -B -m tools.check_computer_model_real --render-existing tmp/computer-model-real/fixture-449ac4e6
```

Ambas comprobaciones de interfaz necesitan Playwright o `BRIVANY_PLAYWRIGHT_PATH`.
La primera sólo recibe texto sintético y no activa captura de micrófono. El objetivo
completo, incluida voz física y capacidades extendidas pendientes, sigue activo.
