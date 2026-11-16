# Melodi: respuesta rápida y procesamiento comprobado

Release `2026-10-26.2`.

## Comportamiento

La recepción autenticada de WhatsApp marca el mensaje leído y conserva una copia durable en la cola. Con `ASSISTANT_SEMANTIC_CALENDAR_ENABLED`, todos los textos llegan al intérprete semántico Pro, incluidos los recordatorios simples. Para mensajes de al menos 24 caracteres, el acuse se envía en paralelo después de que la cola haya aceptado el mensaje; el consumidor también puede recuperarlo. Respuestas cortas, citas de otro mensaje, terceros y mensajes de la app no reciben ese acuse genérico.

El acuse usa `wa_fast_owner_receipts`, separado de los recibos de ejecución. No ocupa `wa_message_processing.response_encrypted` ni convierte la tarea en `resume_only`. Una confirmación de recepción no confirma una modificación de calendario, un correo o un documento. Un envío incierto del acuse no vuelve a enviarse automáticamente ni impide procesar la petición original. Se suprimen acuses antiguos y aquellos cuyo resultado final ya esté preparado; una carrera muy corta entre comprobación y transporte todavía puede alterar su orden visible.

La voz final usa el alias `spaik-flash`, con `@cf/meta/llama-3.2-3b-instruct`. Las decisiones internas y el bucle de herramientas usan `spaik-pro`, con `@cf/deepseek-ai/deepseek-v4-pro-0813`. Son rutas privadas del Worker del asistente, activadas mediante `ASSISTANT_NATIVE_AI_ENABLED`; no se altera el mapeo global de modelos de la API compartida de Intelligence ni sus rutas de voz e imagen. Pro no se sustituye silenciosamente por Flash. Sus respuestas vacías, truncadas o identificadas con otro modelo son errores, y el contenido de razonamiento no se usa como respuesta ni plan ejecutable.

`WHATSAPP_FAST_RECEIPTS_ENABLED` activa el acuse. La aplicación no espera una inferencia para redactarlo. El helper permite una elección opcional entre frases seguras, con presupuesto de hasta 200 ms, pero esa opción no se activa en producción. La aceptación HTTP, la recepción de WhatsApp y la ejecución completa tienen latencias distintas: no se garantiza un máximo de 300 ms de extremo a extremo por las llamadas a D1 y Meta.

## Recordatorios compuestos

`owner-semantic-calendar.js` interpreta el mensaje completo antes de los manejadores anteriores. Pro decide la intención, el alcance de cada fecha y qué es una actividad o contenido citado. No se utiliza un detector por vocabulario, una gramática del ejemplo ni la fecha más cercana. Una segunda revisión Pro comprueba la cobertura completa y corrige omisiones o preguntas innecesarias antes de validar y guardar. Las rutas semánticas de agenda compleja y continuación conservan los protocolos existentes.

El código comprueba la estructura, las fechas civiles y las fuentes literales del mensaje. Las citas son contenido; ni sus instrucciones ni los números de tomas se ejecutan. Una fecha mencionada como contexto no crea otra cita; pedir explícitamente anotar también ese evento sí permite crearlo. Las expresiones relativas se resuelven desde el timestamp de recepción y después se comprueba que los instantes sigan en el futuro. Una aclaración antigua no reemplaza un encargo nuevo. Una continuación semántica conserva el mensaje completo pendiente y sus respuestas.

De uno a ocho eventos se guardan mediante `persistSemanticCalendarEvents`, el permiso `manage_calendar` y el ledger de efectos de WhatsApp. El recibo de origen y todos los eventos se insertan en una transacción. Un reintento no duplica, modifica ni restaura eventos borrados posteriormente. La confirmación solo sale después de comprobar los identificadores, títulos y fechas de todos los registros. Google Calendar se sincroniza mediante su cola existente.

## Preservación y validación

Antes de cambiar el servicio se descargaron el código publicado, sus módulos, source map, configuración y nombres de bindings en `tmp/live-2026-10-26/`. Se verificaron las diferencias respecto al repositorio, incluida la ruta móvil de Calendar añadida después de generar el source map. El despliegue usa el bundle comprobado por Wrangler y conserva los assets existentes y todos los bindings con herencia estricta. No publica las páginas locales sobre las que pudo haber trabajado el otro chat.

Las pruebas cubren el mensaje completo y su paso por el handler real, deduplicación, permisos, rollback, texto citado, reloj de recepción, el acuse seguido de un fallo y reintento, y la identidad del modelo Pro. También se hizo una inferencia real en Cloudflare, sin ejecutar herramientas ni modificar la agenda de producción.

Fuentes: [modelo Flash en Cloudflare](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/), [V4 Pro en Cloudflare](https://developers.cloudflare.com/workers-ai/models/deepseek-v4-pro-0813/), [metadatos de despliegue](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/).
