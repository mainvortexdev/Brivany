# Finanzas personales por WhatsApp

Las cuatro agentes pueden registrar y consultar las finanzas del propietario. Una orden directa conserva la agente elegida, responde antes de guardar el cambio y confirma el resultado comprobado. El libro financiero es independiente de la integración antigua de Vetsa-App-Web/Firebase y funciona en el Worker publicado con D1, sin registrar una nueva cuenta o contratar otro servicio.

## Uso

- `Melodi, tengo la suscripción mensual de Google One de 1.99 dólares y la de ChatGPT Plus de 20 dólares, necesito que me recuerdes el día 7 de cada mes que debo renovarlas`.
- `Melodi, registra un ingreso de 15000 pesos por trabajo`.
- `Melodi, gasté 500 pesos en supermercado`.
- `Melodi, registra cuenta efectivo con 2000 pesos` y `registra cuenta banco con 1000 pesos`.
- `Registra una transferencia de 500 pesos de efectivo a banco`.
- `Registra presupuesto supermercado de 10000 pesos`.
- `Quiero ahorrar 50000 pesos para un viaje antes del 2027-01-01`.
- `Añade 500 pesos a mi ahorro F003`.
- `Registra deuda préstamo de 10000 pesos`; `abona 500 pesos a mi deuda F004`.
- `Mis suscripciones`, `mis gastos del mes pasado`, `mis gastos de septiembre de 2026`, `mis ahorros`, `mis presupuestos`, `mis cuentas`, `mis deudas`, `mis finanzas`.
- `Corrige F001 a 25 dólares`, `anula F003`, `desactiva suscripción Google One`, `activa suscripción Google One`.
- `Envíame un informe de mis finanzas por email` o `prepara un resumen de mis finanzas en Word`.

Las referencias F001, F002… identifican registros financieros; las referencias R1, R2… identifican rutinas. Si dos nombres coinciden, se pide una sola referencia concreta. La fecha predeterminada de un movimiento es la fecha local actual en República Dominicana. Se aceptan fechas ISO, día/mes/año, nombres de meses, ayer y `hace N días`; una fecha explícita incompleta o inválida requiere aclaración. Para una meta con plazo, la respuesta calcula el aporte semanal pendiente en centavos enteros. Los informes muestran el saldo derivado de lo registrado, no una lectura de una cuenta bancaria.

## Repetición y Google Calendar

`recurring_reminder` utiliza la misma cola, asignación, outbox y comprobación de entrega que las rutinas existentes. Admite repetición diaria, semanal y mensual. Un aviso mensual conserva `dayOfMonth`, hora y `America/Santo_Domingo`; Google recibe `RRULE:FREQ=MONTHLY;BYMONTHDAY=n`. Si un mes no tiene ese día, se omite, igual que Google. Sin hora se eligen las 09:00 RD y se explica en la confirmación.

Calendar permite cambiar una fecha concreta o la serie, además de cancelar instancias o toda la rutina. Un cambio de serie invalida las ejecuciones antiguas en cola. Los avisos solicitados expresamente pueden entregarse a su hora fuera de la ventana de iniciativa espontánea; conservan la exclusión mutua de conversaciones y el correo de respaldo de la agente. Las cuatro agentes tienen acceso de lectura a `inspect_finances` desde nivel 0. El modelo no dispone de una herramienta para inventar o registrar movimientos: las escrituras se autorizan mediante el texto directo del propietario.

Los informes PDF/Word siguen el permiso existente `prepare_document` (nivel 2). Si la agente elegida necesita ayuda, la colaboradora pide aprobación con una referencia C1…; no se crea un documento antes de aprobar. El permiso conserva cifrados el informe derivado del libro, el canal solicitado y la responsable original. Aprobar ejecuta ese contenido una vez; rechazar impide su creación. La confirmación de entrega procede del flujo de documentos, no de una promesa del modelo.

Una cuota de suscripción es una obligación prevista; no crea un gasto pagado. Se contabilizan por separado cuotas mensuales y anuales. Los avisos periódicos de renovación integrados son mensuales; una cuota anual se puede registrar y acompañar de un recordatorio con una fecha explícita. Desactivar una cuota elimina su nombre del aviso compartido y detener la última detiene la serie. Reactivarla es una orden explícita; una consulta o reintento nunca vuelve a activar una rutina detenida. Una nueva agente elegida para el aviso conserva esa responsabilidad, sin duplicar las cuotas ni el aviso anterior. Cambiar el aviso desde Calendar no altera la cuota con el proveedor.

## Integridad y operación

- Importe como entero de centavos, monedas DOP/USD/EUR independientes, sin conversiones implícitas. Los importes sin moneda usan DOP y la respuesta lo indica.
- Transferencias entre cuentas registradas en la misma moneda: no generan consumo ni ingresos. Los pagos de deuda sí se incluyen como salidas; los aportes a metas de ahorro no se cuentan como consumo.
- Registros y versiones previas cifrados, con sobre validado por propietario, identificador y tipo. Consultas delimitadas al propietario, parámetros vinculados y correcciones con revisión comparada. Anulación mediante estado y conservación del historial.
- Claves estables por mensaje; los reintentos no duplican movimientos ni entregas. Los informes recorren todas las páginas para sumar; muestran hasta 20 movimientos recientes indicando la limitación de presentación.
- Una fuente pegada, ejemplo, URL o adjunto no puede convertirse en una orden financiera. Datos de Calendar se interpretan como datos de horarios, nunca como instrucciones para pagar o modificar el libro.
- El cron solo envía `scheduled_tick` a la cola existente. El consumidor realiza la reparación acotada, lee primero Calendar y después ejecuta las actividades y el mantenimiento. Esto evita exceder los 10 ms de CPU del cron gratuito; las colas gratuitas admiten el presupuesto de consumidor documentado, conservando los límites y cuotas del plan. No se añade facturación ni se usa el PC como servidor.

Referencias oficiales: [Workers: límites de CPU](https://developers.cloudflare.com/workers/platform/limits/), [Queues: límites del consumidor](https://developers.cloudflare.com/queues/platform/limits/), [Calendar: eventos recurrentes](https://developers.google.com/workspace/calendar/api/concepts/events-calendars#recurring_events), [D1: operaciones batch transaccionales](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Verificación de producción

La reparación está limitada al recordatorio reportado, su propietario, responsable Melodi, título literal y fecha original. Guarda las dos cuotas y una única serie mensual; comprueba sus nombres, centavos, moneda y enlace antes de retirar el evento puntual. El aviso durable se confirma antes de cerrar el marcador, y una interrupción en ese punto permite reanudarlo sin duplicarlo. No registra pagos realizados.

En producción se verificaron F001/F002 activos, marcador `repaired`, rutina de Melodi para el 7 de noviembre de 2026 a las 09:00 RD, mapa de Google activo y confirmación de Melodi `sent` con un intento. La interfaz real mostró «Cada mes el día 7» y visibilidad privada. Un cron de la release .12 finalizó con 0 ms de CPU y su consumidor con 240 ms y sin excepciones; el cron anterior había terminado con `exceededCpu` a los 10 ms. Esta prueba de publicación y programación no anticipa una entrega futura de noviembre.

Pruebas: `node --test test/*.test.js`. La suite completa contiene 715 pruebas: 696 correctas, 19 omisiones conocidas y cero fallos. Cubre dinero exacto, monedas separadas, cifrado, aislamiento, deduplicación, contabilidad de transferencias/deudas/ahorros, presupuestos, correcciones concurrentes, nombres originales, agente seleccionada, respuesta temprana, PDF/Word/email en cola, aprobación y rechazo de informes según nivel, recurrencia mensual, meses cortos y bisiestos, instancias, cambios y cancelaciones, aviso a las 22 RD y respaldo por email. `wrangler deploy --strict --keep-vars` verifica compilación y conserva los secretos existentes.
