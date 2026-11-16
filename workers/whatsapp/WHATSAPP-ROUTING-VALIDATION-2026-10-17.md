# Consulta de avances y continuidad de WhatsApp

## Incidente reproducido

La pregunta del propietario «Cual fue el último avance de Cognira Edits?» dependía de `interpretOwnerIntent`, aunque no pedía ejecutar una acción. Si fallaban el clasificador principal y su alternativa, el flujo devolvía un error interno de asignación y terminaba la recepción como contestada. El catálogo y los informes disponibles no llegaban a la conversación.

Las consultas informativas acotadas sobre Vetsa/Cognira ahora pasan directamente a la conversación con la interlocutora vigente y su referencia de informes. Las solicitudes compuestas de escribir, enviar, guardar, publicar, programar o actuar conservan su autorización y herramientas. Una clasificación ausente ya no produce el mensaje de error mostrado por el usuario: la recepción durable puede reintentar sin inventar una acción. Si falla también la generación de respuesta, un informe disponible permite devolver un bloque factual completo con fecha y límites.

Una prueba real, sin envío externo, recorrió `handleOwnerMessage` y `askSpaik` con la pregunta exacta: llegó como `direct_conversation`, Melodi respondió sobre HDR y validaciones documentadas de Edits. El clasificador de acciones no fue necesario. Las referencias tienen fecha de corte y no acreditan una cronología completa de cambios posteriores.

## Continuidad y entregas

- La caída o sincronización incompleta de Google Calendar ya no detiene los encargos independientes del equipo. El estado `calendarReady` viaja con el despacho; las rutinas y entregas con fecha esperan la sincronización. Los recordatorios ya encolados tampoco consumen intentos ni se envían bajo ese estado pendiente.
- En modo Melodi líder, el cron deja de crear mensajes genéricos de preparación por IA. Los recordatorios solicitados se encolan cifrados por snapshot y se revalidan antes de enviar. Solo un recibo real permite marcarlos entregados. Dos cron simultáneos y un fallo posterior al transporte no repiten el aviso.
- Los reintentos de correo fallido utilizan una actualización condicional y los primeros envíos compiten bajo la unicidad del trabajo. Un error 5xx conserva la reserva incierta y no autoriza un envío duplicado.
- La notificación de un resultado sigue distinguiendo aceptación del proveedor, entrega y lectura. Esta revisión no afirma lectura de un mensaje en un teléfono.

## Evidencia

- `benchmarks/owner-query-routing-fix-2026-10-17.log`: consulta exacta bajo caída del clasificador, interlocución y ausencia de ejecución inventada.
- `benchmarks/owner-question-real-2026-10-17.json`: respuesta del modelo real y ruta directa, sin transporte externo.
- `benchmarks/brain-real-team-dona3-2026-10-17.json`: cadena real Melodi → Melodi → Melodi → Melodi → Melodi completada, con investigación y PDF privado de 95.955 bytes comprobado en R2. La prueba usó una identidad sintética aislada y no envió WhatsApp/correo; acredita ejecución y reconciliación, no recepción en teléfono. La identidad y su artefacto se limpiaron al terminar.
- `benchmarks/calendar-durable-reminders-2026-10-17.log`: 17 casos, incluidos concurrencia, modificación/cancelación, recibos ausentes, bloqueo de temas y aislamiento de Calendar.
- `benchmarks/email-claim-race-2026-10-17.log`: 16 casos de identidad, reservas concurrentes, aceptación incierta y avisos.
- `benchmarks/whatsapp-routing-continuity-2026-10-17.log`: suite integrada de esta revisión; 843 casos, 824 aprobados y 19 omitidos antes del último ajuste de texto del prompt.

## Auditoría posterior del objetivo general

La revisión posterior integró y probó `encrypted-conversation-store.js`: `saveTurn`, la recuperación y la compactación histórica de `worker.js` utilizan cifrado, índice HMAC y CAS. La migración comprueba la escritura durable antes de vaciar las columnas antiguas. La validación operativa final está descrita en `WHATSAPP-BRAIN-VALIDATION-2026-10-17.md`.

El desajuste de cifras reproducido con un proveedor simulado quedó cubierto por una frontera de resultados: hechos literales citados, cálculos de la aplicación e inferencias etiquetadas. Las restricciones comprobadas se conservan aunque el modelo no las seleccione. Los documentos factuales se normalizan antes de solicitar permisos; los borradores de autoría se identifican como no verificados.

La comprobación de Melodi y del equipo completo con datos controlados detectó y corrigió avisos de autorización perdidos y resultados aprobados que no reanudaban el objetivo. Incluye aislamiento de propietarios, tareas hermanas, denegación, concurrencia y un artefacto único tras las tres especialistas. Cognira/Melodi permanecen fuera de esta fase. Las pruebas no equivalen a una confirmación física de lectura en un teléfono.
