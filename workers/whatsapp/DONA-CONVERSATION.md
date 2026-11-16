# Conversación y respuesta de Melodi

La voz compartida vive en `melodi-system.js`. Melodi conserva el hilo y las
especialistas ejecutan por dentro. La salida elimina etiquetas iniciales como
`Melodi:`; mantiene los nombres que sean parte de una cita o del contenido pedido.
Las confirmaciones y avisos de calendario usan `reminder-language.js`.

El flujo vigente se documenta en `DONA-PRODUCT-V2.md`. Todos los textos del
propietario pasan por una decisión semántica, sin disparadores por palabras
clave. Mantiene el reloj del mensaje original y confirma un recordatorio solo
después de recibir el identificador guardado: «Te recordaré imprimir el documento
de Helibert mañana a las 7:10». La ruta determinista anterior permanece para
compatibilidad con el modo antiguo, desactivado para estos turnos.

El webhook valida la firma de Meta y empieza el marcado de leído sin esperar la
cola, la IA ni la acción. Guarda siempre una copia en cola antes de ejecutar la
ruta rápida. Ambas rutas comparten la misma exclusión y registro de efectos para
evitar acciones o mensajes duplicados. Peticiones ambiguas, citas, correo y
continuaciones de adjuntos conservan el flujo completo en cola.

Las delegaciones y los resultados guardados despiertan a la siguiente agente o
a la entrega mediante la cola. El ciclo programado conserva la recuperación si
un despertar falla; no hay un diálogo simulado entre especialistas.

Las peticiones compuestas se resuelven como un plan completo: separar sesiones
de proyectos, mover pendientes de un día y añadir compromisos con hora. La
aplicación es atómica, comprueba cambios concurrentes y conserva el encargo
durante las aclaraciones. Reutiliza una rutina existente cuando coincide con la
actividad y la hora solicitadas. No ejecuta ejemplos citados ni interpreta
«Terminar la app» como una orden de desarrollar software.

Cuando se pide aligerar hoy y se vuelven a indicar boxeo, trabajo u otros
horarios de hoy, esas actividades recurrentes se conservan sin una pregunta
técnica sobre el alcance. Un trabajo flexible trasladado a mañana que coincida
con una cita busca otro inicio entre las 09:00 y las 18:00, en intervalos de
media hora; la confirmación indica su hora real. Una cita, recogida, consulta o
reunión conserva la hora: si hay conflicto, la pregunta nombra ambas actividades
y su fecha y hora. Estos son inicios propuestos, no estimaciones de duración.

La solicitud reportada el 21 de octubre a las 05:46 RD conserva su plan cifrado.
La reparación verifica la confirmación y el error originales, persiste un plan
inmutable antes de ejecutarlo y comprueba también la sesión pendiente dentro de
la transacción. Reintentar no duplica proyectos y una nueva petición o
cancelación impide aplicar el plan anterior.

Las rutinas semanales admiten varios días en una sola serie de Calendar. La
solicitud explícita del 21 de octubre configura boxeo de lunes a viernes a las
09:00, trabajo de lunes a sábado a las 11:00 y regreso a las 15:40. La revisión
de instalación se registra una sola vez y respeta cancelaciones posteriores.

La frase diaria se generaba pero la reserva de conversación para Melodi impedía
seleccionarla para entrega. Los avisos de rutinas solicitadas ahora pueden
entregarse a través de Melodi sin cambiar la interlocutora; no se acumulan frases
diarias de fechas anteriores. Los recordatorios pueden preguntar por el
entrenamiento previo del mismo día, a partir de agenda vigente y sin afirmar
asistencia ni finalización.

El calendario sincronizado es el calendario privado conectado «Vetsa · Equipo».
Los permisos existentes no dan acceso al calendario principal ni a otros
calendarios personales. Una escritura local solicita sincronización por cola
sin esperar al cron; solo el resultado de Google confirma que ya se publicó.

## Validación

Desde `cloudflare-worker`:

```powershell
node --import ./test/cloudflare-register.js --test test/*.test.js
node ./benchmarks/simple-reminder-latency.mjs
./node_modules/.bin/wrangler.cmd deploy --dry-run --keep-vars
```

El benchmark mide únicamente el parseo local. El objetivo de 300 ms para recibir
una respuesta visible necesita medición en producción: también incluye D1,
autorización, envío y red de WhatsApp. `owner_reminder_fast_path.durationMs`
registra el tiempo del manejador completo; el benchmark no demuestra una cota
máxima de entrega al teléfono. Las rayitas dependen de que Meta aplique el leído.
