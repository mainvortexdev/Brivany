# Melodi: auditoría de entrega

Estado comprobado el 26 de octubre de 2026. Release publicada: `2026-10-26.7`.
El propietario confirmó después del bloqueo que prioriza comprensión y respuesta final correcta. El límite inicial de 300 ms deja de ser obligatorio. La revalidación de producción confirma el mismo código y configuración que se probaron; no fue necesario un nuevo despliegue para aplicar esta prioridad, porque la selección de modelos y el flujo publicado ya la respetan.

| Requisito | Evidencia actual | Estado |
| --- | --- | --- |
| Eliminar el acuse genérico | Bandera de producción desactivada y ruta unificada; verificación del código publicado y pruebas del Worker | Verificado |
| Comprender por significado, sin disparadores por palabras clave | Planificador único y herramientas tipadas; nueve evaluaciones reales del catálogo ampliado | Verificado en los casos evaluados |
| Conservar el tema actual y las citas | Caso frase → boxeo sin arrastrar la app; privacidad por interlocutora y cita vinculada al ID | Verificado |
| Cuatro compromisos de una sola petición | Modelo real produce los cuatro eventos, conserva la cita literal y las horas; Worker escribe el lote y confirma una vez | Verificado |
| Herramientas y resultados comprobables | Permisos, planes cifrados, recibos por acción, reintentos y pruebas de caída sin duplicar | Verificado en las capacidades implementadas |
| Conservar funciones anteriores | Finanzas, reportes Cognira, control del equipo y continuaciones de destinatario/cuerpo/captura incorporados; 1.324 pruebas aprobadas, 19 omitidas y ninguna fallida; resolución de agenda con el Worker y la base real de pruebas | Verificado en las rutas probadas |
| Capturas y avisos anticipados | Prueba del Worker con OCR, intervalo, zona y aviso de dos horas; modelo real elige leer/importar la imagen | Verificado |
| Rutinas, frase diaria y recordatorios naturales | Integraciones y pruebas existentes conservadas; rutina motivacional genera una frase nueva | Verificado por pruebas existentes |
| Gmail y Drive | APIs, autorización propia, cifrado e integración implementados; invitación y reenvío con estado `sent`; las tres conexiones figuran `connected` en D1. Los callbacks comprueban Gmail profile y Drive account contra Google antes de persistir la conexión | Autorización completada |
| Marcar leído desde el servidor | El webhook inicia el leído sin esperar la cola ni el modelo; pruebas de ingreso y errores | Verificado en la aplicación; Meta controla cuándo se muestra |
| Priorizar comprensión y respuesta final correcta en pocos segundos | Medición con el binding real de Cloudflare: Flash 977–2.472 ms en seis casos. Se conserva el modelo más fiable; conversación inmediata después de guardar su copia durable y acciones con plan cifrado sin repetir inferencia | Verificado en los casos evaluados; criterio aceptado por el propietario |
| Conservar publicación y configuración | Código remoto coincide con el bundle probado; 56 conexiones/variables preservadas, activos existentes conservados, cron y calendario móvil presentes | Verificado |

## Siguiente trabajo concreto

La continuación de agenda quedó corregida: usa el encargo original autenticado cuando corresponde, acepta una resolución tipada del significado de la aclaración y conserva todos los proyectos y compromisos. Los cambios manuales del conflicto se guardan atómicamente junto con el resto del plan. Las pruebas rechazan IDs inventados, horas sin zona, fechas pasadas, cambios de agenda concurrentes y reintentos que pudieran duplicar efectos. Tres evaluaciones del modelo real resolvieron el cambio de una consulta, el alcance de pendientes puntuales y el traslado de dos actividades al miércoles.

La planificación inmediata está publicada y se controla con `OWNER_INLINE_TURNS_ENABLED`. El webhook conserva primero el mensaje en la cola. La conversación responde sin esperar al consumidor. Un plan de acciones cifrado transfiere su reserva al consumidor antes de cualquier efecto, sin gastar reintentos ni producir un acuse; la cola recupera ese plan sin repetir inferencia. Las pruebas incluyen una respuesta desde el webhook autenticado, traspaso sin efectos ni respuesta temprana, recuperación tras JSON inválido, exclusión de mensajes del mismo propietario y espera durable que no gasta reintentos de fallo.

También se añadieron medidas de ingreso → inicio, inferencia, herramientas y aceptación de Meta. Las últimas consultas anteriores al despliegue no contenían turnos de WhatsApp del propietario desde la instalación del nuevo flujo (cero planes en producción); no hay una muestra real de sus mensajes que pruebe la latencia total. Los envíos de autorización sí tienen recibo de envío, pero no son respuestas del nuevo planificador.

El propietario respondió «Priorizar comprensión y respuesta final correcta» y reactivó el objetivo. Queda resuelto el criterio que motivó el bloqueo. La validación técnica incluye inferencia real dentro de Cloudflare, escritura y recuperación con los ejecutores y la base de pruebas, callbacks reales de autorización de Google, envíos de autorización confirmados por Meta y comprobación del código publicado. La prueba de aceptación que el propietario puede hacer desde su teléfono sigue disponible; no se presenta como realizada ni se afirma haber medido el tiempo visible de una conversación real.

## Revalidación final

La comprobación posterior a la publicación vuelve a confirmar `2026-10-26.6`, coincidencia del código remoto con el bundle probado, ejecución inmediata activa, acuses desactivados y las conexiones de Gmail, Drive y Calendar en estado `connected`. La consulta actual sigue sin planes ni mensajes recientes del propietario en el nuevo flujo; no existe todavía una interacción real que permita afirmar una latencia de WhatsApp.

El mismo requisito de 300 ms continúa incumplido en los cierres de las versiones 26.4, 26.5 y 26.6 y en esta revalidación. El modelo pequeño probado dentro de Cloudflare tampoco cumple ese máximo y produce planes o respuestas incorrectos. No es aceptable sustituir la respuesta útil por un acuse, volver al enrutamiento por palabras clave ni declarar cumplido ese límite con tiempos del parser o de inferencia aislada.

El bloqueo por el máximo estricto queda resuelto mediante la decisión explícita del propietario. El rediseño está implementado, publicado y validado con la cobertura descrita. La entrega no incorpora una garantía de 300 ms ni promete ejecutar capacidades sin integración disponible. No quedan cambios técnicos necesarios para aplicar la prioridad aceptada; la implementación publicada sigue activa.

En la revisión final se confirmó además que las tres rutinas personales originales conservan cancelaciones de Calendar del 23 de octubre. No se reactivaron: la capacidad de recurrencia se conserva y las modificaciones posteriores del propietario tienen prioridad sobre la instalación inicial. La frase diaria permanece activa.

Los dos envíos de autorización registrados son `f42bf133-bf34-4e9d-82b8-c118e997d793` y el reenvío solicitado `c56e4b8e-b68a-41e3-8666-f2645f327aad`; cada uno se envió una sola vez. El propietario ya autorizó Gmail y Drive. No volver a enviar enlaces sin una nueva solicitud.

## Evidencia local

- `tmp/melodi-v2-26.6-live-verification.json`: comprobación de producción, bundle y configuración; ejecución inmediata activa y acuses desactivados.
- `tmp/melodi-v2-26.6-validation.log`: suite completa.
- `tmp/melodi-v2-agenda-resolution-validation.log`, `tmp/melodi-v2-agenda-resolution-contract.log`: atomicidad y contrato de resolución.
- `tmp/melodi-planner-real-eval-compatibility-2026-10-26.json`: planes y tiempos del modelo real.
- `tmp/melodi-planner-real-eval-agenda-resolution-2026-10-26.json`: tres continuaciones con el modelo real; tiempos 2,2–5,4 segundos.
- `tmp/melodi-native-binding-evaluation-2026-10-26.json`: dos modelos × seis casos con el binding real; el Worker temporal fue eliminado. Flash produce los cuatro avisos; 3B llega a contestar con actividades «programadas» sin herramienta, por lo que se mantiene descartado.
- `tmp/melodi-v2-inline-handoff-validation.log`, `tmp/melodi-v2-inline-ordering-validation.log`: contrato de traspaso, exclusión y recuperación de la cola.

Las pruebas no demuestran que una IA comprenda cualquier petición posible ni que toda acción imaginable tenga una integración disponible. La respuesta debe reconocer una capacidad ausente y no afirmar su ejecución.

## Corrección de la conversación real reportada

El propietario probó el flujo y mostró una consulta de agenda que acabó en «La consulta se completó, pero no tengo un resumen verificable para mostrar». La rama de respaldo de lecturas no contemplaba `calendar.read`; la validación anterior no había cubierto esa salida. También se observó una reacción a «Uff» que introducía horarios del historial. La primera muestra de producción contiene cuatro turnos terminados, con una media de 7.657 ms de procesamiento antes de esta corrección; no equivale al tiempo visible en el teléfono.

La versión 26.7 presenta las lecturas de calendario directamente desde los eventos verificados. Añade `calendar.search`, una búsqueda por significado de actividades existentes en un horizonte predeterminado de doce meses, con selección de IDs reales, periodos explícitos opcionales y resultados parciales identificados. Colapsa las recurrencias del índice para que una frase diaria no oculte un evento puntual lejano. Una selección inválida o un fallo de inferencia nunca prueba ausencia ni crea eventos.

Se confirmó en la agenda real la actividad «Iniciar la creación de una app para aprender boxeo», el 14 de noviembre de 2026 a las 09:00 locales. La prueba del Worker reproduce la pregunta del propietario y devuelve esa fecha sin otro redactor ni escrituras. Tres pruebas con el binding real verifican la reacción breve sin horarios, la elección de la búsqueda y la selección del evento correcto. El historial conserva las fechas de cada turno para no reinterpretar un «mañana» antiguo como el actual.

Evidencia adicional: `tmp/melodi-reported-query-validation.log`, `tmp/melodi-native-binding-reported-query-2026-10-26.json`, `tmp/melodi-v2-26.7-validation.log` y `tmp/melodi-v2-26.7-live-verification.json`. El bundle publicado coincide con el probado, preserva las 57 conexiones/variables y conserva los activos existentes. No se reprodujeron mensajes antiguos ni se alteraron los planes o eventos del propietario para forzar una prueba.

## Nuevo objetivo: cambios de agenda y evaluación amplia

La segunda captura mostró un fallo distinto: la búsqueda encontraba el evento, pero el cambio de fecha elegía una planificación compuesta y terminaba repitiendo el dato viejo. El objetivo nuevo se fijó expresamente, sin reducirlo a una corrección de texto. Se reprodujo el fallo con inferencia real y se añadieron operaciones con identidad, lectura previa, cambios atómicos, recibos y comprobación posterior para modificar y cancelar compromisos. Las fechas de altas y modificaciones se compilan desde campos semánticos; los modelos no hacen la aritmética del calendario.

La versión `2026-10-26.9` está publicada y verificada. La suite completa termina con 1.419 pruebas aprobadas, ninguna fallida ni omitida. Las evaluaciones con el binding real cubren variantes naturales, búsqueda y cambio, conservación de hora, renombrado, cancelación, ambigüedad, negativas, creación, fechas relativas, captura, Gmail, Drive, finanzas, conversación y los ejemplos originales. Dos entradas inválidas de Flash se recuperaron con planes reales de Pro; la ruta real del Worker también prueba esa recuperación antes de guardar un gasto. Las pruebas de transporte simulan Meta y las escrituras usan bases aisladas: no se presentan como conversaciones reales entregadas al teléfono.

El código remoto coincide con el bundle probado `bad44767caf9cb4350b2b081ab6a04a30b7e2cef355b9fc0712e48e11e2864a5`. Se conservaron las 57 conexiones/variables, los activos de calendario, el cron y `VetsaAppAgents`. Gmail, Drive y Calendar continúan conectados; las tres rutinas personales previamente canceladas siguen detenidas. No se reenviaron enlaces ni mensajes para fabricar la aceptación de una prueba.

La cobertura, evidencias y límites completos constan en [DONA-REGRESSION-AUDIT-2026-10-26.md](DONA-REGRESSION-AUDIT-2026-10-26.md). En particular, la modificación de una sola ocasión de una rutina sigue requiriendo Google Calendar; la aplicación lo explica sin cambiar toda la serie. No se declara una garantía universal de comprensión, de 300 ms ni de disponibilidad de proveedores externos.
