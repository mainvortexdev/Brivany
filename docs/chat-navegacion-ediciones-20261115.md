# Chat: navegación, ediciones y presencia de agentes

15 de noviembre de 2026. Implementación en la aplicación de desarrollo de
Brivany. Las pruebas usan conversaciones, archivos y servicios sintéticos;
no reproducen ni registran la conversación o la imagen del usuario.

## Comportamiento implementado

- El chat abre al final. Al subir aparece una flecha para regresar al último
  mensaje. Los cambios de altura, fuentes o contenido nuevo siguen el final
  mientras el lector no se haya desplazado hacia arriba.
- Los títulos automáticos eliminan las presentaciones largas y priorizan el
  asunto del primer pedido. Los títulos antiguos se recalculan localmente sin
  alterar mensajes ni fechas. El lápiz permite un nombre manual, que se conserva
  ante guardados automáticos anteriores. No se llama a un modelo para titular.
- Se muestran cinco conversaciones inicialmente, con Mostrar más y Mostrar
  menos debajo. Las barras del historial y del chat no tienen flechas nativas.
  Conexiones y Bitácora pasan a pestañas dentro de Ajustes; sus módulos se cargan
  allí cuando se solicitan.
- Los agentes activos tienen un brillo azul suave. Al terminar permanecen
  cuatro segundos y desaparecen con un fundido de 1,2 s. Se mantienen el máximo
  de cuatro, el modal, la identidad por función y la opción de ocultarlos.
- El detalle de actividad actualiza texto y posición sin volver a insertar el
  tooltip ni reiniciar su entrada. Se comprobó fuera y dentro del modal.
- Se eliminó el aviso de éxito dentro de la app. El servicio nativo informa de
  una tarea principal terminada cuando Brivany está en segundo plano: título
  «Melodi terminó» y mensaje según el tipo de resultado. No duplica avisos por
  agentes hijos, guardados repetidos o cambios de foco posteriores. Al pulsar
  abre el chat correspondiente. El texto no incluye el pedido ni datos privados.
- El inicio genérico de generación de una imagen ya no cuenta como 70 %.
  Imagen y video empiezan visualmente en 1 %. Como el proveedor no comunica
  fracciones, el contador avanza como **estimación de tiempo y etapas**; su título
  y etiqueta accesible lo aclaran. La estimación temporal se limita al 90 %,
  las etapas observadas pueden superarlo y solo un resultado verificado permite
  el 100 %. No mide trabajo real del modelo. Se conserva la geometría y la
  animación continua de la miniatura durante las actualizaciones.
- La respuesta nueva tiene escritura progresiva más pausada y fundido suave.
  El historial restaurado permanece legible sin volver a escribirlo. Se respeta
  movimiento reducido.
- «Que el pájaro sea rojo» y otras revisiones visuales explícitas preparan una
  edición de la imagen verificada del mismo chat. Conservan la referencia, estilo,
  composición y transparencia; el original no se sobrescribe. No vuelven a
  preguntar por el estilo ni pasan por conversación ordinaria o el atajo remoto.
  Se conserva la autorización normal antes de ejecutar. Tras reiniciar, la unión
  entre chat y tarea se verifica en el historial cifrado. Una imagen pendiente,
  ausente, no verificada o de otro chat no se toma como un resultado editable.
- La ventana recibe el icono de Brivany desde su creación, sin esperar al inicio
  de la bandeja. Identidad Windows `Brivany.Desktop`, también en la configuración
  de los futuros accesos directos del instalador. No se ha recompilado ni publicado
  un instalador en este hito.
- El reinicio normal también se bloquea si hay tareas de agentes activas, además
  de llamadas, grabaciones, transferencias o un lienzo pendiente de guardar.

## Verificación y límites

Suites registradas con `tools.verify`: `chat-history`, `chat-followup`,
`chat-presentation`, `live-conversation`, `video-retry`, `tray`,
`desktop-lifecycle`, `agent-avatars`, `chat-navigation-ui`, `chat-history-ui`,
`chat-media-ui`, `chat-thinking-ui`, `chat-progress-ui`, `chat-agents-ui` y
`agent-avatars-ui`. Los recorridos de Edge son aislados y sin navegador personal.
El envío de referencias a `images/edits` se prueba con transporte sustituido;
no se generó una nueva versión real de la imagen del usuario. Las notificaciones
se verificaron con componentes nativos sustituidos: foco, deduplicación, mensaje
y clic. La entrega visible de una notificación depende de los ajustes de Windows.

`app-identity-native` leyó únicamente el título y HICON de la propia ventana
de Brivany, sin captura, foco ni entrada de sistema. El icono coincide por píxel
con el recurso de marca a su resolución nativa. El reinicio usa el canal privado,
guarda el chat y espera la salida normal; no fuerza procesos.

Los informes y fallos intermedios se conservan en `tmp/verification/`. Se corrigió
un banco de navegación que usaba un origen HTTP no seguro, un conteo de paginación,
recibos sintéticos incompletos y una expectativa antigua de Segoe UI. Las pruebas
de ciclo de vida necesitaron acceso al cifrado Windows fuera del sandbox y luego
pasaron. No se ocultaron estos intentos. Consumo de proveedores en estas pruebas:
0 llamadas. GPU sin medir. No se acredita fidelidad semántica de una imagen real,
aprobación de Google, actualización del instalador ni despliegue público.

Comprobación final: reinicio normal confirmado, chat guardado y nueva instancia
lista sin operaciones bloqueantes. Los recursos locales de scroll, actividad,
agentes y ajustes coinciden con los revisados. El HICON de la nueva ventana
coincide con el icono Brivany (error medio por canal 0). Las notificaciones
se mantienen verificadas con componentes sustituidos; no se envió una alerta
ficticia de tarea terminada al escritorio del usuario.
