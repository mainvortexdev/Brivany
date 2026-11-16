# Selección y orden de conversaciones

15 de noviembre de 2026. Corrección posterior a la navegación del chat.

Abrir una conversación conserva su posición y sombrea únicamente su fila.
El orden cambia al enviar un mensaje nuevo: la conversación pasa al primer
lugar de inmediato. Guardar un borrador, recibir la respuesta de Melodi,
actualizar una tarea o renombrar la conversación no cambia su posición.

El almacenamiento conserva la fecha de actividad del chat y solo la actualiza
si el número de mensajes enviados por el usuario aumenta. El contador se guarda
en el resumen cifrado; para registros anteriores se obtiene una vez del historial
cifrado existente. No se añaden mensajes o pedidos en texto plano, ni se modifica
el orden histórico al introducir este comportamiento. Crear un chat nuevo sí
crea su entrada al principio de la lista.

La lista muestra inmediatamente el envío y conserva ese orden mientras termina
un guardado anterior. Después usa la fecha devuelta por el almacenamiento, de
modo que el orden se mantiene al reabrir la aplicación. La selección activa
se conserva por separado de esa fecha.

Mostrar menos está oculto en la vista de cinco chats. Aparece debajo de Mostrar
más al ampliar la lista y desaparece al volver a la vista reducida.

Verificación: 10 pruebas locales de `chat-history`, recorrido aislado de Edge
con conversaciones sintéticas en `chat-navigation-ui` y regresiones de
`chat-history-ui` y `chat-media-ui`. Se comprobaron la selección, borrador,
respuesta del asistente, renombrado, envío, guardado pendiente, reinicio del
navegador y visibilidad de los botones. Captura propia revisada visualmente en
`tmp/chat-navigation-ui/chat-selected.png`. Sin navegador personal, inferencia,
cuentas externas o generación de medios. 0 llamadas a proveedores; GPU sin medir.

Aplicación cargada mediante reinicio normal con guardado del chat. Instancia
lista y sin operaciones bloqueantes, sin forzar procesos. Evidencia local:
`tmp/chat-order-runtime-20261115.json`. No se recompiló el instalador.
