# Melodi: control del ordenador y modelos durante el live

La experiencia nueva incorpora **Ordenador y modelos** y un panel dentro de Melodi.
**Activar control** crea un permiso nativo de una hora; **Elegir carpeta** permite
trabajar con archivos de esa carpeta. El espacio inicial es `.local/computer/workspace`.
**Detener tareas** revoca el permiso y cancela ambas colas. Escape detiene la acción
nativa y el borde visible; una orden de voz explícita para detener también revoca
el permiso al ser reconocida. Las tareas no se retoman automáticamente.

## Arquitectura

El borde y la reserva de Escape se mantienen durante toda la tarea de ordenador,
incluidas las esperas del planificador. Los pasos comparten esa misma sesión nativa.
Los recibos operativos se conservan en `.local/computer/receipts`, separados de la
bitácora de desarrollo. Incluyen acciones y rutas de resultados, sin instrucciones,
texto escrito, listas de ventanas/pestañas, capturas, audio ni permisos. Al reiniciar,
una tarea que estaba activa aparece como interrumpida y nunca se repite sola.

- `services/computer`: router semántico, planificador Meta, permisos, HTTP privado,
  dos colas independientes, cancelación y publicación de modelos.
- `desktop/computer/native.cjs`: proceso Electron con transporte loopback autenticado;
  reutiliza AutomationEngine, SystemAgent, ApplicationResolver, el borde/cursor y
  Paint de Cognira. No expone comandos del sistema al modelo.
- `desktop/computer/textInput.cjs`: escritura literal mediante UIA/Unicode; el texto
  llega como base64, sin expansión de `$()` ni interpretación de SendKeys.
- `desktop/computer/compile.cjs`: utiliza el compilador de habitaciones/mobiliario
  de Cognira y Three.js para exportar GLB incrustado por objeto.
- `desktop/experience/computer.*`: controles de permiso, tareas y vista 3D junto al
  live. Sólo con un permiso activo se enrutan los turnos hacia `/api/computer/turn`.

El backend utiliza el paquete local activado en `.local/computer/backend`. Incluye
los módulos fijados de Cognira, Electron y Three.js; el compilador no requiere Node
global. Puede elegirse un directorio de desarrollo con `BRIVANY_COGNIRA_SOURCE`;
sin paquete activado se conserva el checkout hermano como alternativa de desarrollo.
Los locks de código/runtime se revisan antes de ejecutar. Un paquete o selección
alterado no provoca un cambio automático a otra fuente. [Paquete y evidencia](backend-local-melodi.md).

El modelo de planificación es el Meta ya configurado en Brivany. Las claves se
quedan en Python y no se pasan a Electron. El selector de aplicaciones y Paint
consultan ese proveedor mediante un proxy local con secreto distinto del permiso
de interfaz. Las observaciones de ventanas y capturas Paint son datos, nunca
instrucciones. No se guardan automáticamente capturas, voz ni tareas en la bitácora
de desarrollo; las evidencias de pruebas usan fixtures y resúmenes técnicos.

## Modelos 3D

Una orden explícita como «Crea una mesa redonda en 3D» inicia la cola de modelos y
devuelve el control a la conversación. Al terminar se publica un espacio con GLB,
transformaciones editables y limitaciones. **Ver junto a la voz** abre su visor sin
descargar el live; **Ver modelo en Espacios** abre el módulo completo. Un cambio
posterior puede utilizar el último plan conceptual de la sesión y crea otra versión.
Se mantienen los límites actuales de cien objetos, escala relativa y física no
verificada. No es reconstrucción multivista ni usa Modal automáticamente.

Una orden sintética con Meta real produjo una mesa de cinco piezas mientras se
respondía otra conversación. La revisión visual corrigió el panel para mantener
modelo, micrófono y estado de voz dentro de los tamaños comprobados; el visor
incrustado abre directamente el canvas y conserva acceso a las piezas. Las
opciones y las notas se despliegan sin reemplazar los controles del live.
[Evidencia, coste y límites de esta comprobación](modelo-real-y-live-melodi.md).

## Comprobaciones y límites

`tests/test_computer_control.py` comprueba permisos, revocación/expiración, parada,
dos colas en paralelo, ruta de voz, proxy privado, límites de planificación,
rechazo de planes inválidos, HTTP y publicación de un GLB real en SQLite temporal.
`tests/computer-native.test.cjs` comprueba acciones, confinamiento de rutas/enlaces
y escritura literal resistente a expansión de comandos.

`tools.check_computer_ui` recorre el HTTP y visor reales, con puente, planificador
y entrada nativa sustituidos. Comprueba una tarea desde la ruta live, conversación
mientras se crea el modelo, vista junto a la voz, parada y márgenes a 320, 390, 768,
1120 y 1440 px. No usa servicios externos.

`tools.check_computer_paint_real --allow-paid` es una prueba real aparte: abre una
ventana nueva de Paint, pide una casa/árbol/sol sintéticos y ejecuta las herramientas
y trazos del programa. Puede consultar el modelo para elegir aplicación, ubicar
herramientas y diseñar la composición. Conserva informe y captura del dibujo de
prueba. Su resultado y gasto se registran después de cada ejecución; el importe
permanece desconocido hasta contrastar facturación. Un número de trazos no prueba
calidad artística y una captura no acredita todas las aplicaciones.

La matriz de paridad completa y las validaciones todavía pendientes están en
`OBJETIVO_CONTROL_MELODI.md`. El objetivo permanece activo: no se afirma paridad
total con Office, navegador, programación y producción multimedia de Stacy.

## Atribución

Se reutiliza código de Cognira Desktop/Stacy (Vortex Developer), por indicación
expresa del usuario sobre su directorio local. Sus módulos no se modifican. Brivany
añade el adaptador, el transporte, la política de herramientas, las colas y la
integración con Melodi. El borde HTML se adaptó conservando la atribución en el
archivo. El empaquetado y cualquier redistribución deberán conservar los avisos
de licencia que correspondan a Cognira y sus dependencias.

## Resultado real de Paint del 30 de octubre

La prueba abrió una ventana nueva, ejecutó 300 trazos con el pincel/paleta de Paint
y guardó desde su diálogo nativo un PNG de 768×614. Se usaron cinco solicitudes de
planificación; importe desconocido. La revisión de la captura confirma casa, árbol
y sol, con contornos irregulares y franjas de relleno. No se certifica calidad de
producción. El resultado generado de prueba está en `tmp/computer-paint-real/drawing.png`.
Los fallos previos del borde se conservaron: notificaciones de métricas sin cambio
geométrico real activaban una cancelación. El adaptador compara ahora topología,
escala y rotación antes de cancelar. No ignora cambios efectivos de monitor.

## Escritura y archivos reales

`tools.check_computer_files_real` crea únicamente fixtures nuevas. Verificó bytes de
una nota, su apertura en Bloc de notas, escritura de caracteres literales (tildes,
`$()` y `{ENTER}`) y lectura de vuelta desde el control observado. Copia y movimiento
preservaron los bytes y se rechazó un destino existente. No hubo llamadas externas.
El texto introducido en la ventana de prueba no se guardó automáticamente en disco.
En este Bloc de notas, UIA exponía sólo paneles; el adaptador añadió la observación
Win32 de controles Edit/RichEdit, comprobando relación padre/hijo, proceso, foco y
estado protegido antes de leer o escribir. No sustituye el objetivo por otra ventana.

## Navegador y Office

Se añadieron herramientas tipadas de observación y selección de pestañas, y pausa/
reanudación de YouTube usando `BrowserSession` de Cognira. Conservan IDs observados,
ventana/proceso y comprobación del estado del reproductor. Se ejecutaron 39 pruebas
locales del ejecutor fuente y sus planes Office. La validación nativa posterior en
Chrome/Windows comprobó búsqueda Google, lectura, pestañas, canción/artista YouTube,
pausa/reanudación y entrega de acceso GitHub. Un recorrido completo con HTTP, router
y planificador Meta actuó en páginas sintéticas sin sustituir el ejecutor. Alcance,
fallos conservados y consumo: [pruebas de navegador](pruebas-navegador-melodi.md).

`create_office` valida un plan Word/folleto/PowerPoint antes de crear archivos nuevos
y PDF en el espacio de trabajo. La prueba nativa de Word falló por licencia expirada,
antes de producir un resultado confirmado. PowerPoint no se ejecutó después de ese
fallo. No se presenta como función comprobada en esta instalación. El adaptador
actual admite texto/tablas/animaciones; imágenes y edición avanzada conservan sus
validaciones pendientes. No se modificaron documentos personales ni se consumió API.
