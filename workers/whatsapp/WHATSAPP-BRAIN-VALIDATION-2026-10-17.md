# Cerebros y coordinación del equipo por WhatsApp

## Contrato operativo

Melodi es la interlocutora y coordinadora por defecto. Una dirección explícita del usuario puede seleccionar otra integrante; los mensajes internos entre especialistas no abren conversaciones independientes con el propietario. Las preferencias expresas sobre temas excluidos se comparten y persisten cifradas. El silencio no autoriza nuevas propuestas.

Cada encargo dispone de identidad, propietario, alcance, plan, pasos, memoria, recibos de herramientas y revisiones condicionales persistentes en `wa_melodi_brain_tasks`. Las continuaciones retoman ese estado. Un mensaje del modelo no completa pasos ni prueba una ejecución. La delegación conserva la relación padre/hija, el alcance y la procedencia de los resultados. El resultado de un trabajo privado exige comprobar su artefacto en el almacenamiento, además del estado del trabajo.

No existe una capacidad universal para controlar servicios sin integrar. El catálogo publicado al modelo contiene las herramientas disponibles y su estado. Los servicios ausentes o los permisos insuficientes producen un bloqueo explícito. Los límites de turnos y operaciones evitan bucles indefinidos. Cognira y Melodi permanecen fuera de esta fase.

## Historial cifrado

`encrypted-conversation-store.js` conserva los identificadores de turnos y los cursores históricos. Todas las nuevas filas, incluidas las conversaciones públicas, guardan el texto bajo cifrado autenticado con propietario, rol y origen. El identificador del mensaje se representa mediante HMAC para deduplicar los dos roles sin guardar su valor original en el índice. La búsqueda utiliza tokens HMAC separados por remitente; no escribe texto en FTS.

La migración lee, cifra, vuelve a leer y autentica el dato durable antes de vaciar su columna antigua. La limpieza del índice FTS se puede reanudar tras una interrupción. Si queda una fila FTS sin turno, la conserva y autentica en un archivo cifrado separado antes de retirarla del índice; no crea un mensaje nuevo ni altera los cursores. Se procesa un máximo de tres remitentes y cuarenta turnos por remitente en cada cron, con recuperación residual también acotada. Una lectura también migra un bloque acotado. Las sesiones D1 son propias de cada almacén y empiezan en el primario. No hay promesas de I/O compartidas entre solicitudes.

La compactación nunca avanza sobre turnos antiguos pendientes de migrar y utiliza CAS del cursor y ciphertext para evitar que dos resúmenes se reemplacen silenciosamente. La falta de clave o un fallo de integridad no habilitan una copia en texto. Estas garantías corresponden a las tablas activas; no afirman eliminación forense de copias históricas o retenciones internas del proveedor. Tras migrar, un rollback necesita código compatible con el formato cifrado.

## Evidencia y resultados

`melodi-result-grounding.js` construye bloques a partir de datos de herramientas con recibos terminales comprobados y memoria correlacionada. El modelo selecciona referencias a esos bloques. Los hechos se renderizan desde el texto original; las inferencias se etiquetan y las operaciones numéricas admitidas se calculan en la aplicación. No se aceptan como hechos cifras nuevas escritas por el modelo, enlaces nuevos ni una afirmación libre de éxito.

Un recibo acredita la consulta o creación correspondiente, no la verdad universal de una fuente externa. Las inferencias son análisis y el sistema no es un detector semántico universal. El límite fuerte es la representación literal de hechos comprobados en las salidas que pasan esta frontera. Los datos omitidos por tamaño se indican y no se sustituyen por frases recortadas que puedan perder una negación.

## Permisos, continuidad y transporte

Las aprobaciones de objetivos comprueban propietario, solicitante, evento original, identidad del encargo, alcance y relación de delegación antes de ejecutar. La ejecución autorizada se registra en el cerebro solicitante y lo despierta con un evento estable. El permiso no eleva el nivel de la integrante. Un aviso de aprobación no se acompaña de un segundo mensaje genérico de fallo.

Un error de red o un 5xx después de enviar deja el transporte incierto. No se reenvía automáticamente ni se cambia a otro canal suponiendo que el primer intento no fue aceptado. Solo el rechazo explícito permite el reintento previsto. La recepción durable de mensajes, los trabajos y el outbox tienen identidades y reservas condicionales distintas. La sincronización de Calendar puede detener un recordatorio con fecha sin detener el trabajo independiente del equipo.

## Comprobaciones y límites

- `test/encrypted-conversation-store.test.js`: AES y SQLite reales, aislamiento entre remitentes, corrupción, migración interrumpida, FTS, búsqueda privada, sesiones, CAS, integración de conversación y cron.
- `test/melodi-result-grounding.test.js` y pruebas de integración: importes inventados, restricciones, procedencia de especialistas, cálculos compatibles, duplicados y memoria JSON completa.
- `test/whatsapp-goal-completion-audit.test.js`: Melodi → Melodi → Melodi, Melodi → Melodi → Melodi → Melodi → Melodi, aprobaciones concurrentes, rechazo, propietario ajeno, tarea hermana y artefactos en cola.
- `test/calendar-reminder-delivery.test.js` y `test/melodi-autonomy-runtime.test.js`: avisos solicitados, concurrencia y errores ambiguos sin reenvíos automáticos.
- La cadena real registrada en `benchmarks/brain-real-team-*-2026-10-17.json` consultó fuentes y preparó un PDF privado comprobado de 95.955 bytes. Usó un propietario sintético, sin transporte externo, y limpió su artefacto y datos al terminar.
- La revisión final recorrió el código integrado con los modelos y herramientas reales: Melodi → Melodi → Melodi → Melodi → Melodi → Melodi → Melodi. Los cuatro cerebros quedaron completados, las seis condiciones de ejecución de Melodi tuvieron recibos y se comprobó un PDF privado de 98.911 bytes. Existió un solo outbox final de Melodi con evidencia validada. El resumen financiero pertenecía a una identidad sintética sin movimientos. Véase `benchmarks/brain-final-dona4-2026-10-17.json`; `brain-final-cleanup-2026-10-17.json` confirma que no quedaron filas de esa identidad. No se enviaron mensajes ni correos. El acceso de prueba, limitado a un servicio interno, se retiró del export final.
- La pregunta exacta del incidente está comprobada con el modelo real en `benchmarks/owner-question-real-2026-10-17.json`.

Las pruebas de transporte usan recibos controlados. Una aceptación del proveedor no acredita recepción ni lectura en un teléfono. Esta revisión no anuncia una prueba física nueva de WhatsApp ni capacidades de Cognira/Melodi que no se hayan ejecutado.

## Auditoría de cierre

| Requisito del objetivo | Evidencia revisada |
| --- | --- |
| Melodi coordina; solo la dirección explícita cambia interlocutora | `owner-speaker.js`, `test/whatsapp-leader-contract.test.js` y outbox único en la cadena real final |
| Cada integrante planifica, ejecuta y conserva resultados | `melodi-brain.js`, `melodi-autonomy.js`, pruebas del cerebro y cuatro tareas completadas en la cadena final |
| Herramientas reales y permisos | Investigación pública, consulta financiera aislada y PDF reales; pruebas de aprobación, rechazo, concurrencia y tareas ajenas en `whatsapp-goal-completion-audit.test.js` |
| Memoria cifrada y preferencias compartidas | Almacén cifrado y pruebas AES/SQLite; consulta agregada de producción: 199 turnos cifrados, cero turnos o memorias en texto y cero filas FTS |
| Tareas persistentes y continuidad | Pruebas de reinicio/lease, recepción durable, continuación tras presupuesto de turno, reconciliación de trabajo y delegación |
| Ausencia de mensajes proactivos genéricos o duplicados | Contrato del líder, `melodi-contact-policy.js`, cron sin revisiones genéricas y pruebas de cuarentena de outbox legado |
| Sin contexto inventado ni falsas confirmaciones | Consulta exacta del incidente con modelo real, informes con fecha, frontera de hechos, cálculos, restricciones y borradores identificados |
| Errores y entregas | Pruebas del transporte, recibos faltantes, 429, timeout/503 inciertos, concurrencia, Calendar aislado y entrega única controlada |
| Publicación y alcance | `/health` con `2026-10-17.2`, webhook sin firma rechazado con 401, verificación inválida con 403; cambios limitados al Worker de WhatsApp y sus pruebas |

La suite final contiene 897 casos: 878 aprobados, 19 omitidos y ningún fallo. No se instaló software, contrató un servicio ni apagó el ordenador. Cognira y Melodi no se modificaron en esta fase.
