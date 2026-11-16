# Corrección de citas múltiples y referencias locales

## Fallo

`reminderHasTaskReference` trataba «anótalo» como una referencia obligatoria al historial. Aunque la petición ya especificara una actividad concreta, `resolveReminderTaskReference` podía devolver una aclaración genérica. Esa aclaración sobrescribía el título y la hora resueltos por el modelo. Además, el ejecutor de calendario solo guardaba una cita por petición.

La validación anterior no cubrió una petición con dos actividades, dos horarios y un pronombre referido al propio mensaje. Los resultados de la suite previa no justificaban afirmar que ese uso estaba corregido.

## Cambio

- La referencia se resuelve primero dentro de la petición. Una actividad concreta suministrada ahí no se reemplaza por tareas de conversaciones o proyectos antiguos. Las referencias realmente ambiguas siguen pidiendo el dato que falta.
- Un listado explícito de citas puede producir varios eventos. La fecha se calcula desde el timestamp original de WhatsApp, con su zona horaria; la espera en la cola no cambia «mañana». «Otro/otra» conserva la actividad indicada en el mismo mensaje.
- El parser rápido es acotado: listas explícitas de hasta cinco fechas con actividades y fechas reconocibles. No ejecuta citas textuales, negaciones, recurrencias, cambios de eventos o envíos por correo. La sintaxis fuera de ese contrato conserva las rutas semánticas existentes; esta corrección no afirma que todo lenguaje natural posible esté resuelto.
- Se utiliza el permiso existente `manage_calendar` y la interlocutora seleccionada. No se cambia automáticamente a Melodi ni se omiten autorizaciones.
- `calendar-reminder-batch.js` guarda el conjunto en una transacción D1 con identidad estable por propietario y mensaje. Si falla una inserción, revierte todo el conjunto. Un replay idéntico no duplica citas; un payload distinto o una edición posterior no se sobrescriben. Una lectura posterior verifica todos los eventos antes de confirmar.
- La respuesta enumera cada fecha, hora y actividad una sola vez. Los días sin hora mantienen la política previa de 09:00 y explican esa elección. Una aclaración pendiente de recordatorio se limpia solo tras la escritura confirmada.

## Evidencia

`test/multi-reminder-request.test.js` comprueba la frase reportada, AM/PM, horario de 24 horas, días relativos y de semana, cambios de día local, hora inexistente por DST, herencia de actividad, segundo evento incompleto, títulos vagos, negaciones y citas textuales.

`test/multi-reminder-integration.test.js` usa SQLite real y un clasificador que falla deliberadamente: la petición clara debe guardar ambos eventos sin depender de él. Comprueba permisos, otra interlocutora explícita, concurrencia, replay, fecha original, contexto privado ajeno, rollback, ausencia de falsa confirmación y limpieza de la aclaración antigua. Las pruebas de `owner-reminder-context` conservan los escenarios históricos de referencias verdaderamente ambiguas.

La petición original se localizó dentro del contexto cifrado del propietario y se vinculó a un recibo de procesamiento con la respuesta errónea y sin creación previa de calendario. Se verificó que faltaban sus dos eventos, se aplicó la ruta corregida con el identificador original y se comprobó la sincronización con Google Calendar. Un segundo intento confirmó que ya estaban guardados y no creó duplicados. Los detalles privados de esa reparación permanecen en las evidencias locales; no se enviaron mensajes externos. El acceso interno temporal utilizado para la comprobación se retiró antes del despliegue final.

La transacción se apoya en el contrato documentado de [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), con una sesión primaria por operación. La confirmación local y los mapas activos de Calendar son comprobaciones distintas; ninguna de ellas se presenta como lectura de un WhatsApp en un teléfono.
