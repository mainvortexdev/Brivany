# Verificación OAuth Brivany — correcciones y evidencia, 14–15 noviembre 2026

Se mantienen los nueve scopes de Console y los dos clientes existentes. Calendar Desktop permanece solo consulta; el hito anterior conserva las 73 pruebas y la actualización acotada de cinco archivos de la instalación.

## Cambios web publicados

- Se añadió calendar.connect al catálogo semántico activo y su respuesta verificada. Solo produce el enlace de consentimiento del conector Calendar; no autoriza ni crea eventos por sí mismo. Se rechazan enlaces de otro conector/host o formato no válido.
- runScheduledTick ya no considera reconnect_required como calendario listo para trabajo fechado. El mantenimiento independiente continúa.
- Los fixtures de memoria se adaptaron al contrato vigente de teléfonos normalizados y aislamiento por titular. El fallo histórico no se borró ni se debilitó la separación de cuentas.
- La compactación de memoria privada selecciona spaik-flash/Workers AI y falla si esa ruta no está disponible. No cae al servicio Vetsa ni a sus proveedores posteriores. Esta garantía se refiere a esa ruta; no certifica proveedores de otras modalidades.
- La política canónica publicada explica Calendar Desktop solo consulta, datos derivados/agregados/anonimizados, conservación de historial/memoria y la diferencia entre desconexión y borrado. No inventa un plazo automático general.

Los cambios remotos se aplicaron sobre el código actualmente publicado, con comprobación previa y posterior del hash. Se conservaron bindings, recursos, ajustes, assets y rutas. No se desplegó el resto del árbol de trabajo modificado.

## Validación

84/84 pruebas locales en cinco archivos: executor, respuesta, conexión Calendar, memoria cifrada y programación. Proveedores sustituidos; no prueban OAuth real. Además, 3/3 regresiones sobre el bundle Calendar exacto y 3/3 sobre el bundle de memoria exacto antes de publicar. Las ejecuciones iniciales con cuatro fallos siguen en el expediente; los dos diagnósticos de planner no relacionados no se presentan como corregidos.

Se realizó un ensayo Google real limitado a recursos ficticios BRIVANY-VERIFY: lectura de correo y archivo preparados, creación de documento privado de texto, creación de evento sin invitados, modificación del mismo evento y su cancelación, creación de borrador y un único correo enviado a la misma cuenta de pruebas. No se repitió el envío. Se verificaron los efectos con Google. Una modificación de Calendar requirió aclarar la actividad antes de ejecutarse.

El ensayo utiliza APIs de Google, WhatsApp e inferencia reales: número total de llamadas y coste no medidos. No se declara consumo cero. No se incorporan conversaciones, tokens, enlaces personales ni medios originales a esta bitácora.

Se preparó un ZIP portátil de revisión desde el payload de fábrica, sustituyendo solo los cinco archivos Desktop probados. Su revisión de rutas privadas y secretos configurados dio cero coincidencias; no cambia el canal de actualización público. Su entrega externa exige la autorización específica solicitada al titular.

## Límites y entradas pendientes

No se declara evaluación CASA terminada, ni una exención. Faltan acceso Vetsa independiente para el revisor, aceptación del recorrido WhatsApp por Google, evidencia operativa de eliminación/copias y garantías de cualquier otro procesador que pueda recibir derivados Google. Una política publicada y estas pruebas no sustituyen esos controles.
