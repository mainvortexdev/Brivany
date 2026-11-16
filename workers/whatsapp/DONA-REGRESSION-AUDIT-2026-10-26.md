# Melodi: reproducción y corrección de las conversaciones reales

Versión publicada y verificada: `2026-10-26.9`. Despliegue `2182782e9f02434c90c289fb44a88889`, bundle SHA-256 `bad44767caf9cb4350b2b081ab6a04a30b7e2cef355b9fc0712e48e11e2864a5`. El código remoto coincide exactamente con el bundle probado; las 57 conexiones/variables, los activos y el cron se conservaron. Gmail, Drive y Calendar continúan conectados. La prueba completa terminó con **1.419 aprobadas, cero fallos y cero omitidas**.

## Fallo reproducido

Después de encontrar «Iniciar la creación de una app para aprender boxeo» el 14 de noviembre a las 09:00 locales, el pedido «Bien, es posible que inicie antes su creación, muévelo al día 10 de noviembre» elegía `calendar.plan_agenda`. No existía una operación de modificación puntual en el catálogo unificado. La salida además repetía la lectura anterior como si fuera el resultado final del cambio.

Se reprodujo la decisión incorrecta con el binding real de Workers AI. Se consultó el registro real, sin modificarlo para fabricar una prueba. Las escrituras de prueba se hicieron en bases aisladas.

## Cambios

- `calendar.update_event` y `calendar.cancel_event` localizan el compromiso en una lectura nueva y modifican su identidad existente. Exigen el ID, instante y título observados del propietario. La escritura, comprobación y recibo cifrado son atómicos. Un reintento recupera el mismo recibo.
- Los cambios conservan campos no pedidos, duración y antelación. Las comprobaciones detectan modificaciones concurrentes y solapamientos de intervalos. Un bloque que termina justo cuando comienza otro no se considera solapado. Los eventos de más de 24 horas conservan la política previa de bloquear los primeros 30 minutos de llegada.
- Una consulta preparatoria no se vuelve a presentar con su fecha antigua después de intentar modificar ese evento. Las lecturas independientes y las comprobaciones posteriores conservan sus datos.
- Una búsqueda sin coincidencias termina sin pedir al modelo que invente un ID o cree un reemplazo.
- La agenda compuesta recupera el tramo literal autenticado cuando la copia del modelo solo difiere en mayúsculas o espacios. Una paráfrasis con contenido distinto sigue bloqueada antes de ejecutar efectos. El mensaje largo original conserva los tres proyectos, sus horarios y el traslado de pendientes.
- Una reacción breve recibe una frase propia; se corrigió una repetición literal de la motivación anterior observada al probar «Uff». Tres nuevas evaluaciones reales produjeron respuestas breves sin repetirla, traer horarios ni ejecutar acciones.
- Las fechas se expresan mediante campos semánticos: día absoluto, día de la semana, desplazamiento desde el pedido o desde el evento, y hora local. El sistema calcula UTC, semanas, cambios de mes/año y zona horaria. Esto se aplica a las altas nuevas y a los cambios. Los planes anteriores ya congelados en UTC conservan compatibilidad.
- El modelo Flash atiende conversación y planificación inicial. Pro interpreta las fases posteriores a una lectura, dentro del permiso y catálogo congelados. Una salida inicial inválida también puede pasar por Pro antes de ejecutar efectos. No se incorporan rutas por palabras clave.
- Las rutinas completas activas se pueden cambiar o cancelar conservando frecuencia, días, contenido privado y excepciones compatibles. Una rutina cancelada no se reactiva por un reintento. Google Calendar recibe una solicitud durable de sincronización tras guardar el cambio local.

## Cobertura y alcance de la evidencia

| Requisito | Evidencia |
| --- | --- |
| Buscar, mover del 14 al 10 y volver a consultar | Ruta completa de `worker.js`, permisos reales, SQLite, historial y confirmación única en `test/melodi-v2-worker.test.js`; decisión real del modelo y compilación UTC en la evaluación nativa |
| Variantes, pronombres, cambio solo de hora o título | `test/melodi-calendar-conversation-regression.test.js`, planificador y evaluaciones nativas |
| Fechas relativas sin arrastrar la fecha vieja | `test/owner-calendar-time-change.test.js`, pruebas de creación y modificación con el reloj original, y tres repeticiones reales del martes próximo |
| Cancelación y consulta posterior | Registro eliminado, recibo conservado, búsqueda vacía y duplicados de entrega en las pruebas de conversación |
| Conflictos y concurrencia | Solapamientos, medianoche, duración cambiante, destino ocupado, cambios concurrentes y rollback de escrituras ignoradas en `test/owner-calendar-mutations.test.js` |
| Rutinas | Cambio de serie con nuevo ID de ocurrencia, días conservados, cancelación, repetición de la entrega y prevención de reactivación |
| Fallos y recuperación | Comprobación previa/posterior al efecto, respuesta cifrada, caída previa al transporte, aceptación incierta de Meta y recuperación con Pro antes de un gasto real de prueba |
| Conservar capacidades anteriores | Suite completa: capturas, avisos, agenda compuesta, Gmail, Drive, documentos, finanzas, proyectos, contexto, permisos, leído al ingreso y traspaso a la cola |
| Preservar producción | Comparación del bundle publicado, las 57 conexiones/variables, los activos de calendario, OAuth, cron y entrada del calendario móvil |

Las pruebas de integración simulan la inferencia y el transporte externo; ejecutan el código real de la aplicación, permisos, base, cifrado, recibos y respuestas. Las evaluaciones nativas ejecutan inferencia real con el catálogo y compilador, pero no disponen de la base de producción ni permisos para enviar WhatsApp, correo o modificar calendarios. No se confunden esas dos clases de prueba con una conversación real entregada al teléfono.

La evaluación final reúne 37 ejecuciones reales en 32 escenarios, incluyendo repeticiones y comprobaciones de recuperación. Dos planes iniciales de Flash no superaron el esquema: un intervalo de búsqueda sin zona y un campo financiero extra. Pro produjo planes válidos para ambos; la recuperación de una entrada inválida se verifica también en la ruta completa del Worker antes de guardar un gasto. Los Workers temporales de evaluación fueron eliminados.

Después se contrastaron el mensaje compuesto original, la petición de una frase nueva de boxeo cada día y las reacciones breves. La comprobación final del tono repitió tres veces la reacción y revisó saludo y aplicación de la frase al boxeo. Se volvieron a ejecutar los cuatro casos de fechas críticos con ese prompt final: 10 de noviembre, martes próximo, dentro de tres días y alta nueva en martes. Los resultados completos conservan también la repetición inicial rechazada, sin presentarla como una mejora verificada.

Entre los planes válidos se midieron 954–3.198 ms en Flash y 2.171–5.437 ms en Pro. Son tiempos de inferencia del escenario, no de entrega al teléfono. Se conserva la prioridad explícita del propietario: comprensión y respuesta final correcta; no se promete un máximo de 300 ms.

## Límites expresos

- Modificar una sola ocasión de una rutina todavía requiere Google Calendar; el chat lo explica sin cambiar toda la serie ni abrir una pregunta que no pueda resolver. Tampoco transforma un cambio de patrón con varios días o excepciones incompatibles en una modificación parcial silenciosa.
- Las entregas automáticas vinculadas conservan su protocolo propio. La modificación puntual no las clona ni cambia su hora como si fueran un recordatorio común.
- La búsqueda personal tiene un horizonte predeterminado de doce meses y límites declarados; una búsqueda parcial o fallida no prueba ausencia.
- El recibo confirma la agenda local. La propagación a Google Calendar y la entrega de Meta son efectos externos posteriores; no se presenta su aceptación como prueba de aparición en la pantalla del teléfono.
- Ninguna batería finita garantiza comprender todo lenguaje posible ni la disponibilidad permanente de proveedores externos. Los fallos detectados se deben bloquear o aclarar sin confirmaciones falsas.

## Archivos de resultados

- `tmp/melodi-v2-26.9-validation.log`: suite completa; las dependencias antiguas de hora se instalan de forma aislada en `tmp/melodi-legacy-deps` y se cargan mediante `NODE_PATH`, sin cambiar los paquetes de producción.
- `tmp/melodi-26.8-native-audit.json`: expectativas independientes y resultados de las 37 ejecuciones finales, incluidos los errores iniciales y sus recuperaciones.
- `tmp/melodi-semantic-variants-when-create-final-2026-10-26.json`: decisiones reales y fechas compiladas de altas y modificaciones.
- `tmp/melodi-semantic-variants-breadth-final-2026-10-26.json`: conversación, variantes, negativas, ambigüedad, captura, Gmail, Drive y finanzas.
- `tmp/melodi-semantic-variants-pro-recovery-final-2026-10-26.json`: recuperación real con Pro de los dos planes iniciales inválidos.
- `tmp/melodi-semantic-variants-original-examples-final-2026-10-26.json`, `tmp/melodi-semantic-variants-reaction-final-2026-10-26.json`, `tmp/melodi-semantic-variants-calendar-voice-final-2026-10-26.json`: ejemplos originales, tono y comprobaciones posteriores con el prompt final.
- `tmp/melodi-v2-26.9-build.log`, `tmp/melodi-v2-26.9-deployment.json`, `tmp/melodi-v2-26.9-live-verification.json`: preparación, publicación y comprobación remota. La ruta de calendario móvil se sirve por el entrypoint autenticado `VetsaAppAgents`, no por el `fetch` público del dominio; ese `fetch` devuelve 404 para la ruta interna.

Los informes anteriores de errores y variantes permanecen en `tmp`; no se sustituyeron por los resultados posteriores. No se reenviaron mensajes del propietario ni se alteraron sus eventos reales o rutinas canceladas para forzar pruebas.
