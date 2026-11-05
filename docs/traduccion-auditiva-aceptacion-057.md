# Alcance de aceptación de Traducción auditiva · revisión 057

4 de noviembre de 2026, después del ensayo real
`inline-sync-1793813320346`. El objetivo sigue siendo el funcionamiento
conjunto de la extensión Brave y Traducción auditiva, con preparación
anticipada, canciones omitidas, voces coherentes y doblaje comprensible
sin bloquear el equipo. El alcance incluye el video de referencia completo,
de **1495,781 s**. Una capacidad comprobada en un tramo o con sustitutos no
acredita ese resultado integral.

En esta tabla, «acotado» significa que existe una comprobación del componente
o de un tramo, con los límites indicados. «Pendiente» significa que falta
evidencia suficiente del requisito real. «Falló» preserva un resultado que
contradice su aceptación. Ninguna fila autoriza declarar cumplido todo el
objetivo.

| Requisito | Estado y evidencia disponible | Lo que falta acreditar |
| --- | --- | --- |
| Preparación predeterminada de los primeros 7 s de cada video elegible | Acotado. Código y regresiones exigen sitio autorizado, pestaña activa y visible, video único, reproducción normal cerca de cero y búsqueda disponible. Los ensayos 055 y 057 prepararon automáticamente un video real antes de activar. | Recorrido repetido con nuevos videos/navegación en la extensión instalada. La preparación 057 tardó 15,673 s de pared para siete segundos de contenido. |
| Reutilizar el prefijo y continuar desde 7 s | Acotado real. En 057 se adjuntó el prefijo, ASR vivo desde 7000 ms, cero solapamiento y cero inicios duplicados; tres voces del prefijo y once en vivo completadas. | Continuidad posterior hasta el video completo y comportamiento al activar en posiciones distintas. En el ensayo se volvió al ancla inicial tras avanzar el original. |
| Omitir canciones conservando diálogo | Acotado por componente. YAMNet real pasó cinco muestras controladas, incluido canto y diálogo sobre canción; regresiones de protocolo evitan esperar voces omitidas. | Canciones en el recorrido real conjunto. En 055/057 no hubo canciones preparadas u omitidas, por lo que esos ensayos no ejercitan el requisito. |
| Distinción estable de hablantes y elección de voz según evidencia | Pendiente en habla natural. Embeddings reales distinguen voces propias y conservan frase/ganancia; pruebas locales evitan fusionar por letra ASR o pitch. El ensayo 057 emitió dos voces masculinas y doce femeninas. | Referencia verificable de quién habla en cada intervalo y correspondencia correcta del catálogo. La queja del usuario sobre el presentador sigue sin resolverse; confianza de modelo no equivale a identidad humana. |
| Conservar emoción y registro cuando exista evidencia | Acotado de protocolo. Metadatos y umbrales de confianza se conservan; pruebas separan timbre de expresividad y mantienen resultados inciertos como tales. | Corrección semántica de esas marcas y su reproducción en habla natural del recorrido conjunto. No se prueba emoción a partir de presencia de un campo. |
| Audio claro y natural, sin ralentización artificial | Acotado. Una escucha anterior del usuario confirmó un fragmento claro y natural. En 057 se midieron catorce voces con señal y velocidades de reproducción entre 1× y 1,18×. | Escucha y fidelidad de las voces actuales, incluida guía TTS hasta 1,5. Energía, tasa PCM y duración no demuestran naturalidad o traducción correcta. |
| Anticipación y sincronización con retraso estable | Falló en 057: máximo 9,559520 s y crecimiento 5,255520 s, frente a límites de 8 y 3 s. Inicios de las catorce voces entre −23 y +19 ms; diez límites son estimaciones ASR. | Sostener retraso y continuidad aceptables, con correspondencia del contenido, durante el recorrido prolongado. Inicios precisos no compensan un retraso que crece. |
| Continuidad sin perder doblaje ni bloquear imagen | Acotado real de 31,700 s: catorce voces completas, sin reserva original ni voces publicadas perdidas en esa cobertura, sin error de imagen o fuente. | Continuidad más allá de ese tramo. En 055 hubo 2,364539 s de original no clasificado como canción. En 057 el contador de recuperaciones de huecos es cero: no prueba una recuperación real ejecutada. |
| Arranque normal desde Work y extensión personal instalada | Falló en el último ensayo personal: selección aceptada sin captura, cero PCM, sesiones o voces, `frontend_unverified`. La confirmación de carga posterior tiene pruebas locales. | Ejecución real de la actualización en el trabajador instalado y trayecto Work → captura → proveedores → audio. Integridad del paquete no prueba recarga; la última carga nativa del ajuste de ritmo tampoco quedó acreditada. |
| Banco real en el navegador integrado | Acotado. El banco local integrado muestra el video y orquesta pruebas reales de la extensión en Brave aislado, con métricas saneadas. | Recorrido personal conjunto estable. El navegador integrado no se convierte en un host MV3 por mostrar el banco; no se declara que haya cargado la extensión allí. |
| Respuesta del equipo y CPU bajo control | Acotado en reposo. La corrección de consultas de estado redujo el proceso Python de 1,993 a 0,050 núcleos en dos ventanas de unos cinco segundos. Hay límites de captura/colas y pruebas locales. | Medición del navegador, escritorio y respuesta del equipo durante traducción prolongada. El resultado en reposo no acredita ausencia de bloqueos bajo carga. |
| Pausa, búsqueda, cambio de fuente, cancelación y recuperación de fallos | Acotado de regresiones. Los protocolos locales cubren límites, pérdida de fuente, cancelación, intervalos omitidos y restauración. | Verificación real conjunta de esos controles. Los últimos informes no verifican `workspace_stop_clean` ni una recuperación real contada de hueco. |
| Video completo de referencia y consumo documentado | Pendiente. La duración e identidad de 1495,781 s están verificadas; el último doblaje verificado completa 31,700 s. El perfil personal reprodujo 98,394726 s de fuente sin traducción. Los ensayos y los intentos de proveedores están anotados. | Recorrido de traducción completo. Los perfiles aislados sin extensión tuvieron cortes de fuente alrededor de 43–44,5 s, de causa desconocida. Importe facturado, GPU remota y tráfico incidental no medidos siguen siendo desconocidos. |

## Evidencia principal de esta revisión

- [Ensayo real 057 y consumo](traduccion-auditiva-ensayo-057.md),
  `tmp/selected-video/inline-sync-1793813320346.json` y
  `tmp/selected-video/lab-consumption-49202-057.json`.
- [Ensayo previo con reserva original](traduccion-auditiva-prefijo-real-055.md).
- [Enlace personal sin captura](traduccion-auditiva-enlace-personal-052.md),
  `tmp/selected-video/personal-sync-1793811452177586100.json`.
- `tmp/song-filter/report-1793805010064616000.json` y
  `tmp/speaker-embedding/production-owned-fixtures-v2.json`: inferencia local
  real, muestras controladas; no atribución natural del video completo.
- [CPU en reposo](traduccion-auditiva-rendimiento-048.md),
  `tmp/selected-video/native-status-cpu-20261104.json`.
- [Fuente aislada y límites](traduccion-auditiva-fuente-048.md),
  `tmp/selected-video/personal-source-baseline-20261104.json`.
- Suites locales registradas: sync-relay 81 casos,
  `sync-relay-20261104T171643-6d9e2caf.json`; River 62,
  `river-translation-20261104T171519-b94ffb26.json`; extensión 68,
  `workspace-sync-extension-20261104T172029-97fbbfea.json`. Sus resultados
  prueban las condiciones de sus casos, no el conjunto de filas pendientes.

Esta matriz es una revisión retrospectiva de evidencia existente. No ejecutó
nuevas inferencias, no redujo el alcance ni declara completado el objetivo.
