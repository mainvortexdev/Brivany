# Chat: espera, adjuntos y resúmenes

15 de noviembre de 2026. Corrección a partir de los fallos reportados por el
usuario. Las capturas y el resumen privado se trataron como evidencia; no se
adjuntan a la bitácora ni se incorporan sus conversaciones al código.

El presupuesto anterior del cliente cancelaba un turno sin texto a los diez
segundos, aunque el clasificador admitía 35 segundos. Ahora el chat escrito
permite 90 segundos hasta el primer texto y 180 hasta completar; la voz permite
75 y 150, respectivamente. La conexión del proveedor escrito admite 45 segundos.
Se mantiene la cancelación manual y no hay reintentos automáticos. «Pensando»
permanece en el turno correspondiente y desaparece al llegar texto o un error.
Esto corrige el plazo incompatible; no garantiza una latencia del proveedor.

El chat conserva contexto breve para conversar y entrega al servidor un
historial adicional acotado para los resúmenes: hasta 64 mensajes, 2.400
caracteres por mensaje y 24.000 en conjunto. El cuerpo HTTP se recorta a
60.000 bytes, incluidos caracteres Unicode, y declara si hubo truncamiento.
Los documentos y los agentes delegados reciben ese historial cuando se solicita
resumirlo. El prompt pide distinguir solicitudes, decisiones, resultados
confirmados y pendientes. El contenido es dato, sin otorgar permisos nuevos.
Los recibos operativos omiten el historial y el cuerpo del documento.

Las preguntas explicativas sobre cómo instalar algo se contestan en el chat.
El soporte especializado sigue disponible para pedidos de documentación o
actuación concreta. Las confirmaciones de trabajo incluyen el objetivo; el cierre
usa el contenido del resultado y no una frase genérica de éxito. La respuesta
final no se repite dentro de la tarjeta de actividad. En tareas del ordenador,
los pasos enviados se distinguen de sus efectos semánticos; los fallos conocidos
conservan un diagnóstico en vez de perderlo tras un aviso genérico.

Los videos y audios se adjuntan desde un selector de archivos HTML o al soltarlos
en el chat. Se transfieren por loopback al almacenamiento privado, sin depender
del selector del puente nativo y sin ejecutar una tarea al seleccionar. Se
conservan los límites de ocho archivos, 250 MB por archivo y 1 GB de caché.
Se validan origen, extensión, longitud y nombre seguro en Windows; se rechazan
recorridos de directorio, dispositivos reservados y flujos alternativos.
El botón de quitar vacía la selección, sin borrar archivos usados por tareas.
Los errores conservan los adjuntos anteriores y muestran su causa.

## Verificación

Todas las pruebas de conversación y medios usan datos sintéticos y proveedores
interceptados. No se generó video ni se hizo inferencia real para estas pruebas.

- `computer`: 37 pruebas, incluidas privacidad del historial, resumen delegado,
  pregunta explicativa, subida real por HTTP local, rechazo de origen ajeno y
  nombres inválidos. Informe `computer-20261115T212805-429ca783.json`.
- `orchestration`: 30 pruebas. Informe
  `orchestration-20261115T212217-7ade73af.json`.
- `live-conversation`: 10 pruebas. Informe
  `live-conversation-20261115T212224-df231ff9.json`.
- `javascript`: 63 pruebas, incluidos presupuesto de 90/180 segundos,
  cancelación y expiración única. Informe
  `javascript-20261115T212700-47b302b2.json`.
- `chat-media-ui`: seis comprobaciones en Edge propio sin ventana visible:
  selector, arrastre, error recuperable, resumen con mensajes antiguos sin
  duplicación, respuesta tras 35 segundos simulados y límite UTF-8. Informe
  `chat-media-ui-20261115T213141-ec479d76.json`.
- `chat-thinking-ui`: flujo NDJSON por loopback, cancelación, respuesta tardía,
  cambio de turno y actividad paralela. Informe
  `chat-thinking-ui-20261115T213140-f38f5a4b.json`.
- `chat-voice-ui`: diez comprobaciones con micrófono y proveedores sintéticos;
  WebAudio real dentro de un navegador propio, sin usar micrófono ni altavoz
  físicos. Informe `chat-voice-ui-20261115T212700-a8551ccc.json`.

Los informes de suites están en `tmp/verification/`. Una comprobación nativa
adicional inició el ejecutor de desarrollo y recibió `source_available=true`,
sin entrada al ordenador ni repetición de órdenes del usuario:
`tmp/chat-backend-readiness-20261115.json`. No acredita el resultado de una
interacción completa con Paint o YouTube; esa prueba queda para el usuario.
El diagnóstico original se había descartado y no se atribuye retrospectivamente
una causa específica a ese fallo.

La instancia de desarrollo se reinició con el cierre y guardado normales. El
control privado de la nueva instancia confirmó `ready=true` y ninguna operación
ocupada. Evidencia: `tmp/chat-development-ready-20261115.json`. No se actualizó
la distribución instalada ni se reprodujo una tarea del usuario.

Las pruebas descritas iniciaron cero llamadas externas a proveedores. Consumo
de GPU y tráfico de fondo de la aplicación abierta sin medir. Los fallos
intermedios de pruebas y sus correcciones permanecen en la bitácora.
