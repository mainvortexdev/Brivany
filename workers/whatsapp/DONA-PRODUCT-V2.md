# Melodi: objetivo de producto

Release `2026-10-26.9`.

Prioridad confirmada por el propietario el 26 de octubre: comprender correctamente y entregar una respuesta final útil en pocos segundos. El máximo inicial de 300 ms deja de ser un requisito obligatorio. Se mantienen los acuses genéricos desactivados y las confirmaciones respaldadas por resultados; no se cambia a un modelo menos fiable solo por reducir su tiempo de inferencia.

Comprender y contestar al contenido en un solo hilo natural, con herramientas reales para ejecutar lo solicitado. Se elimina el acuse genérico. Una respuesta social o explicación ya es la respuesta; una acción se confirma según su recibo, y un trabajo encolado conserva su estado pendiente.

El documento aportado por Daniel orienta la separación entre entrada autenticada, contexto, decisión semántica, herramientas y salida. Las reglas de producto del propietario conservan prioridad: puede pedir varias acciones juntas y las acciones ya autorizadas no necesitan confirmaciones rutinarias. Ningún diagrama prueba que una integración exista o que una tarea se haya ejecutado.

## Flujo

1. El webhook verifica Meta, marca leído y conserva el mensaje en la cola durable. Con `OWNER_INLINE_TURNS_ENABLED=true`, el texto del propietario comienza su planificación inmediatamente después de conservar esa copia. Esto también incluye citas verificadas y conversación cotidiana, sin disparadores por palabras clave.
2. Un solo planificador semántico recibe el turno, reloj original, historial inmediato, cita verificable y catálogo de capacidades. La charla no carga los proyectos ni recorre clasificadores de calendario y escritorio.
3. La respuesta conversacional se entrega directamente. Las acciones pasan por permisos, validación y recibos; no se decide la intención mediante palabras clave.
4. Se congela el plan por mensaje. Las lecturas independientes pueden ir en paralelo, las escrituras conservan orden y dependencias, y los reintentos recuperan recibos sin duplicar efectos.
5. Una lectura puede aportar datos para un siguiente paso autorizado en el encargo original. Las fuentes externas son datos, y no amplían ese permiso.
6. La respuesta final usa resultados comprobados. La entrega posterior de documentos y trabajos utiliza las colas e integraciones existentes.

Una conversación o aclaración puede responder desde esa primera ejecución. Un plan de acciones se cifra y se transfiere al consumidor sin ejecutarlo ni enviar un acuse. El traspaso invalida la reserva de la primera ejecución, despierta una copia durable y conserva el presupuesto de reintentos. El consumidor recupera el mismo plan, evitando otro pase por el modelo. El modelo Pro y las acciones largas se ejecutan en el consumidor; el tiempo de `waitUntil` no se usa como cola ilimitada.

Los turnos del mismo propietario conservan el orden de procesamiento mientras una ejecución está activa. Un turno que espera se vuelve a programar de forma durable y acotada; esa espera no consume los reintentos por fallos. Las copias del mismo mensaje siguen compartiendo la reserva y no pueden responder ni ejecutar dos veces.

## Contexto y voz

El foco del turno actual y el antecedente inmediato tienen prioridad. Aplicar una frase al boxeo debe hablar de entrenamiento y de la frase, aunque antes se hablara de una app. No se incorporan proyectos completos a todas las conversaciones. Las conversaciones de otras integrantes siguen privadas; una cita visible se vincula al ID del mensaje real.

No se inventan biografías, emociones, archivos, estados de ejecución ni accesos. La voz es cercana, concreta y breve cuando el encargo lo permite. Ningún resultado incluye nombres de agentes por rutina. El acuse «ya tengo tu mensaje, lo reviso y te respondo» queda desactivado.

## Validación

Se evalúan conversación con cambios de tema, referencias a frases, redacción, consultas privadas, varios compromisos y fechas, citas con instrucciones, dependencias y reintentos después de fallos. Los tiempos de inferencia se registran separados de D1, cola y transporte de WhatsApp. El modelo se selecciona por calidad y latencia medidas, sin prometer un límite de red que la aplicación no controla.

## Ejecución y recuperación

`owner-turn-planner.js` produce una respuesta final o un grafo acotado de herramientas. `owner-turn-runtime.js` congela el plan y puede continuar hasta tres fases tras una lectura. Las fases posteriores conservan el catálogo autorizado al principio y no pueden añadir una herramienta sugerida por un correo o documento. El plan, resultados y respuesta final quedan cifrados en `owner-turn-store.js`.

El ejecutor conserva el heartbeat del mensaje original antes de los efectos y utiliza los recibos específicos de Gmail, Drive y calendario. Las escrituras inciertas no se repiten a ciegas. Un fallo al redactar o entregar la respuesta no recrea un archivo ya creado. Las fuentes verificadas se conservan al pasar de una lectura a un trabajo de documento.

El modelo de conversación y planificación inicial es `@cf/deepseek-ai/deepseek-v4.1-flash-1017`, sin razonamiento visible. Pro interpreta las fases posteriores a una lectura y recupera salidas iniciales inválidas. Conserva el catálogo y permiso congelados; no amplía acciones a partir de una fuente externa. Los alias de Intelligence, las rutas de imagen/voz, los activos publicados y las conexiones anteriores se preservan.

## Capacidades y consentimiento

- Calendario: lectura y búsqueda por significado, eventos nuevos, modificación y cancelación de compromisos existentes, intervalos con aviso anticipado, capturas, recurrencias y ajuste compuesto de agenda. Los cambios puntuales exigen una lectura nueva y conservan identidad, hora y campos no pedidos. Las fechas tipadas se calculan desde el reloj original. Las rutinas completas se pueden cambiar o cancelar; una sola excepción de rutina todavía requiere Google Calendar.
- Gmail: estado, autorización, búsqueda, lectura, borrador y envío solicitado. Una petición de leer no envía correos.
- Drive: autorización independiente, búsqueda, lectura de texto y Google Docs, creación privada de documentos de texto con ID estable. PDF e imágenes de Drive conservan estado no compatible; no se inventa su contenido. La integración no comparte ni elimina archivos.
- Proyectos, notas, investigación, preparación de documentos y operaciones del escritorio se vinculan a los ejecutores existentes. Los documentos o comandos en cola se anuncian como pendientes, no como terminados.
- Finanzas personales, estadísticas de Cognira y reportes programados tienen herramientas semánticas propias con lectura de comprobación. Los importes se validan en centavos por moneda; registrar un pago no realiza una transferencia bancaria.
- Los destinatarios y cuerpos de correo pendientes, documentos, recordatorios con correo y capturas privadas conservan su sesión y continúan mediante una herramienta específica. El control de encargos y las preferencias de contacto usan las políticas existentes sin interpretar palabras clave.
- La agenda pendiente admite una resolución semántica tipada: conservar rutinas, cambiar fechas u horas de actividades concretas, reubicar el compromiso identificado en el conflicto o cancelar. Se conserva todo el encargo y su reloj original. La reubicación y el resto del plan se guardan atómicamente y se comprueban las fechas anteriores.

## Evidencia de publicación

La evaluación real del catálogo ampliado del 26 de octubre resolvió nueve casos: cuatro compromisos juntos, cambio de app a boxeo, captura con aviso de dos horas, fecha sin hora, gasto, avance de encargo, preferencia de contacto y dos continuaciones de entrega. Los tiempos del planificador fueron 1,9–3,9 segundos por la API de inferencia. No representan la entrega al teléfono ni demuestran un máximo de 300 ms.

La invitación de Gmail y Drive se envió y se reenvió por solicitud expresa. Cada envío tiene un registro cifrado distinto y estado `sent`. La cuenta ya completó la autorización: Gmail, Drive y Calendar figuran conectados. Sus callbacks validaron las cuentas contra los servicios de Google antes de guardar las conexiones.

Una medición adicional en un Worker temporal protegido utilizó el binding real de Workers AI y el planificador completo, sin datos personales ni herramientas de acción. Flash respondió los seis casos con planes válidos en 977–2.472 ms, incluyendo los cuatro avisos y la fecha sin hora a las 09:00 local. Llama 3.2 3B tuvo errores de contrato y una respuesta conversacional ante la petición de agendar, con tiempos entre 362 y 10.387 ms. La medición no incluye D1 de producción ni aceptación de Meta, y no demuestra el máximo de 300 ms. El Worker temporal fue eliminado tras medir.

Los registros operativos separan el inicio tras el ingreso, inferencia, herramientas, envío y tiempo acumulado hasta la aceptación de Meta. No registran mensajes ni credenciales. La aceptación de Meta no prueba cuándo aparece el mensaje en el teléfono.

Configurar Drive no concede acceso: la cuenta debe autorizar su propio enlace de Google. Una conexión ausente recibe un enlace real, no una confirmación falsa. Las credenciales de Drive usan tablas y contexto criptográfico separados de Gmail y Calendar.

Una fecha sin hora usa la política explícita `OWNER_DATE_ONLY_REMINDER_HOUR=09:00`; la confirmación presenta la hora utilizada. Los avisos anticipados requieren una antelación solicitada. Las expresiones relativas usan el reloj de recepción; una hora vencida no se desplaza automáticamente a otro día.

## Corrección tras la primera conversación real

La consulta «Revisa mi agenda si tengo ya programada la creación de la app de boxeo» mostró un fallo de presentación: si no se aceptaba la redacción del modelo, el respaldo no tenía una respuesta de calendario y emitía una frase técnica vacía. Las lecturas de agenda ahora se presentan directamente desde los eventos verificados, sin otro pase por un redactor.

`calendar.search` permite localizar una actividad por significado sin inventar una fecha de consulta. Por defecto revisa los próximos doce meses, con un índice acotado que incluye los eventos puntuales y una representación por rutina. El selector solo puede elegir IDs existentes; títulos y fechas provienen de los registros. Un fallo del modelo o una consulta parcial nunca demuestra ausencia. La búsqueda no modifica la agenda.

El historial conserva sus fechas originales. Las reacciones breves responden al contenido inmediato y no autorizan a interpretar cansancio ni a traer horarios antiguos. Se verificaron con el binding real el mensaje «Uff», la elección de la búsqueda de agenda y la coincidencia de la app del 14 de noviembre. La regresión del Worker comprueba además la respuesta final, sus fechas y que no se cree ni se mueva ningún evento.
