# Duración del doblaje y aceptación sin cobertura vacía

4 de noviembre de 2026. Se audita el tramo real que empezó cerca del segundo
300 del video de referencia. La voz masculina llegó con señal, pero el búfer
de imagen se interrumpió antes de terminar la primera frase. El informe
`tmp/selected-video/inline-sync-1793808194417.json` conserva el fallo. Esta
corrección no acredita resolver ese fallo de imagen ni completar el producto.

## Guía de velocidad sobre el texto que se pronuncia

La preparación calculaba `generation_config.speed` usando las palabras del
ASR original. Cartesia pronuncia la traducción, cuya longitud puede ser
distinta. Una fuente de dos palabras podía convertirse en una frase extensa
sin recibir ajuste; una traducción muy corta podía heredar una aceleración
innecesaria de su fuente larga.

El cálculo ahora usa el texto traducido disponible al enviar la primera
solicitud TTS. Las continuaciones del mismo contexto conservan esa guía, para
no cambiar el ritmo a mitad de una frase. Los tiempos siguen procediendo del
intervalo ASR validado y no de instrucciones incrustadas en el texto. No se
recortan palabras, cifras, negaciones ni repeticiones para ajustar duración.

Se conserva el límite de orientación de 1 a 1,28. La guía de Sonic no es un
multiplicador estricto y no permite deducir la duración final del PCM sin
medirlo. La reproducción del navegador mantiene su propia corrección de
velocidad; una guía de síntesis y una tasa de reproducción no certifican por
sí solas que el resultado sea natural.
[Documentación del proveedor](https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion).

En traducciones enviadas por frases antes de que termine MT, solo se conoce
el texto recibido hasta el primer envío. El resto aún puede ampliar la
traducción. Se mantiene esa limitación en lugar de inventar una duración
garantizada o añadir otra solicitud de síntesis.

Tres regresiones con protocolos locales verificaron expansión y contracción
entre idiomas, texto TTS íntegro, límites de origen intactos y configuración
coherente entre continuaciones. No se usaron proveedores reales.

## La continuidad requiere una frase terminada

La submétrica `continuity_quality` del ensayo fallido anterior marcaba
`passed=true` con cero frases completas y cobertura de cero milisegundos.
El resultado global ya era fallido, pero esa submétrica era demasiado débil.
Se conserva el informe histórico y se corrige la regla para ensayos futuros.

La política numérica compartida del banco exige al menos una frase completa
con señal y cobertura positiva, además de los límites de retraso, crecimiento,
recuperación del original y voces publicadas perdidas. Una voz anticipada
posterior al tramo completado no amplía la cobertura acreditada. Cuatro
regresiones JavaScript comprueban esos casos, incluido el rechazo de una
señal parcial sin ninguna frase terminada. Son pruebas de aceptación del
banco; no demuestran calidad de escucha o correspondencia de voces.

## Cancelación y resultados de verificación

La suite histórica
`docs/verification-history/sync-relay-20261104T160226-c728cbd0.json` conserva una
aserción fallida: el contador del servidor TTS aún era cero al recibirse el
aviso de fragmento omitido por el socket del navegador. Son conexiones
independientes. La prueba ahora espera, durante un máximo de un segundo,
la recepción observable del mensaje de cancelación y sigue exigiendo
exactamente una cancelación. No se amplió el plazo de producción ni se
convirtió una cancelación ausente en éxito.

Con el código corregido:

- `tools.verify sync-relay`: 62 pruebas aprobadas en 36,236 s.
  Informe `docs/verification-history/sync-relay-20261104T161254-39839e81.json`.
- `tools.verify workspace-sync-extension`: 60 pruebas aprobadas; incluye las
  regresiones del búfer incorporadas por el trabajo paralelo y las cuatro
  de esta política. Informe
  `docs/verification-history/workspace-sync-extension-20261104T161254-8b80b522.json`.

Esta auditoría y sus pruebas usaron únicamente lectura de métricas, código y
protocolos locales sustituidos, con cero solicitudes nuevas de inferencia a
proveedores y sin GPU. El consumo del ensayo público previo sigue siendo el
que declara su propio informe, con importe facturado desconocido. No se
adjuntan medios originales, transcripciones ni conversaciones a este hito.
