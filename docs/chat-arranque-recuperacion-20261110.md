# Chat en blanco · recuperación de arranque

La captura del usuario muestra la estructura de la ventana, sin contenido del
chat ni historial. No se capturó la excepción original. La inicialización del
módulo dependía de terminar antes los complementos del menú; una excepción
previa impedía asignar la ruta al iframe. Se eliminó esa dependencia y la lectura
sin protección de la ubicación de un iframe todavía no accesible.

El chat se solicita primero. Un bootstrap independiente verifica su arranque y
puede cargarlo aunque falle el script de mejoras de la ventana. Durante la carga
se muestra un estado; tras doce segundos sin inicialización se ofrece «Volver a
cargar». No se reenvían mensajes ni tareas. El historial local tiene un plazo de
ocho segundos para responder; un bloqueo de esa consulta no detiene indefinidamente
el chat. Se corrigieron los colores del brillo en el contexto de la ventana
principal, donde no existían las variables de color del iframe del chat.

La versión instalada sólo se marca como saludable cuando se confirma que el
chat está inicializado y su input está visible y habilitado. El diagnóstico
local `User Data/.local/logs/startup-last.json` conserva booleanos y contadores,
sin contenido de mensajes ni credenciales. Es una comprobación acotada al arranque,
sin vigilancia permanente ni peticiones de inferencia.

Validación:

- `tmp/shell-recovery-ui/report.json`: navegador propio con un fallo de shell
  provocado y una dependencia de voz que devuelve 503. El primer fallo permite
  usar el chat; el segundo muestra el error y el botón. Al reintentar se recuperan
  la conversación y el borrador. No se modifican los chats reales del usuario.
- Recorridos de historial y editor de imágenes aprobados. Diecisiete pruebas
  Python de sesión nativa, historial y despliegue aprobadas.
- Tres arranques del ejecutable instalado recuperaron chat, historial y video
  previo (`tmp/shell-boot-native-1.json` a `-3.json`).
- `tmp/shell-boot-native-final.json`: chat listo, input visible, historial
  disponible, cero medios pendientes y `healthy: true`. Permanece un evento
  `resource-style` sin mensaje que no impide inicializar la interfaz; no se ha
  presentado como la causa del fallo original ni se ha relajado la CSP.
- Tras las pruebas se abre el ejecutable normalmente y se consulta su diagnóstico
  de arranque, conservando el historial y la configuración existentes.

Estas pruebas no demuestran la causa exacta de la captura original. Sí comprueban
la recuperación frente a fallos concretos y que la nueva ventana no se declara
saludable sólo por mostrar el menú.
