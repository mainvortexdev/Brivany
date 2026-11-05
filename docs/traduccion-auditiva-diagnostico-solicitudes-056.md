# Correlación de solicitudes y revisión del retraso · 056

## Evidencia retrospectiva

Se revisa el informe real ya existente
`tmp/selected-video/inline-sync-1793812104387.json`; esta revisión no vuelve a
llamar proveedores ni modifica ese informe.

El tramo 13,105455–15,472397 s quedó listo en ASR a los 16,618 s del reloj
del protocolo. MT empezó a los 16,681 s, sólo 63 ms después. Terminó en
`mt_timeout`, fase `sse`, a los 23,186 s: 6,505 s de petición. El siguiente
tramo, 15,472397–19,060 s, estuvo listo a los 19,981 s, inició MT a los
20,070 s, terminó MT a los 21,771 s y terminó TTS a los 22,293 s. Su voz
no se publicó hasta los 23,187 s, al retirarse el contexto anterior: 894 ms
adicionales de espera por el orden de salida.

La siguiente solicitud se inició 236 ms después de quedar listo su ASR.
Las demás esperas entre ASR listo y MT iniciado fueron aproximadamente
6–89 ms. Este ensayo no muestra una cola de despacho de varios segundos.
La espera de MT de 4,087 s en el tramo anterior y el plazo agotado de
6,505 s sí fueron significativos. El código también puede recuperar el
original por edad del turno. Sin un reloj de la causa de recuperación no se
puede afirmar cuál de ambos mecanismos actuó primero.

A partir de las trece voces completas, la suma de los excesos positivos de
duración hablada respecto de sus intervalos es 3,1604 s. La suma de espera
entre inicios de voces, por encima del mayor entre la duración hablada y el
intervalo anterior, más el hueco de origen, es 4,003403 s. Destacan 3,108 s
antes del tramo 10,400 s y 0,687603 s alrededor del plazo agotado. La suma
de ambos componentes, 7,163803 s, aproxima el crecimiento medido de
7,227656 s; la diferencia es de unos 64 ms. Es una descomposición de relojes
y duraciones, no una prueba de fidelidad semántica o atribución de personas.

## Cambio de diagnóstico

El informe anterior no conserva `segment_id` ni `mt_skipped.partial`.
Hay diecisiete intentos, dieciséis eventos de primer texto y una omisión por
plazo; esto es coherente con una solicitud sin deltas, pero no permite citar
un `partial: false` como campo guardado ni correlacionar toda la concurrencia
sin ambigüedad.

El banco ahora asigna un índice numérico estable a cada `segment_id` real
recibido. El mapa vive sólo durante ese informe y admite como máximo 128
segmentos. No exporta identificadores originales ni texto. Conserva, cuando
existen, `partial`, `request_ms`, `request_to_first_ms`, contadores de intentos
y recuperación, y una fase de una lista cerrada. Los eventos de solicitudes
paralelas mantienen índices diferentes aunque sus respuestas lleguen en otro
orden. La ausencia de `partial` sigue siendo ausencia, no se rellena con falso.

El saneamiento Python vuelve a enumerar y acotar esos campos: índices enteros
de 1 a 128, tiempos finitos entre 0 y 180.000 ms y contadores enteros de 0 a
512. Texto, audio, identificadores originales y campos no enumerados se
descartan. No se cambian los límites de retraso, el tratamiento de canciones,
los plazos de MT ni las decisiones del reproductor.

## Decisión sobre solicitudes duplicadas

No se implementa una segunda solicitud especulativa. Una regla ciega de tres
segundos habría actuado antes sobre el tramo que terminó correctamente en
4,087 s, gastando un intento adicional antes del bloqueo posterior. Una
cancelación tampoco demuestra que el proveedor no haya cobrado el intento.

Antes de considerar esa estrategia hacen falta correlación de solicitudes,
medidas del primer texto y pruebas locales de elección de un único resultado,
cancelación de ambas conexiones, y rechazo tras cualquier delta, negativa o
error de acceso. Tampoco se instala un modelo local alternativo sin evidencia
de calidad, disponibilidad y latencia. Estas alternativas son ideas pendientes,
no capacidades implementadas.

## Comprobaciones locales

- `tests.test_inline_trial_limits`: 5/5, incluido saneamiento de concurrencia,
  `partial: false` explícito y rechazo de valores inválidos.
- Pruebas JS dirigidas de continuidad y diagnóstico: 6/6. Se prueba también la
  función serializada que utiliza realmente el trabajador del banco.
- Suite admitida `workspace-sync-extension`: 68/68,
  `docs/verification-history/workspace-sync-extension-20261104T172029-97fbbfea.json`.
- `node --check browser-extension/tests/run-inline-sync-probe.mjs`: aprobado.

Estas comprobaciones son locales, sin nuevas inferencias pagadas ni audio o
transcripciones guardadas. No certifican una mejora real de la traducción.
