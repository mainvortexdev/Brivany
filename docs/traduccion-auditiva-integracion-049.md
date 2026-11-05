# Integración de voces y paquete 0.4.8: resultado todavía incompleto

4 de noviembre de 2026. Se consolida la preparación de la extensión, los
cambios locales de voces y el último ensayo real. El objetivo de Traducción
auditiva continúa abierto. Ni la igualdad de archivos ni una clasificación
acústica confiada acreditan un doblaje fluido y correcto del video completo.

## Cambios relacionados y alcance

El [clasificador de timbre](traduccion-auditiva-timbre-048.md) distingue el
registro tonal de la selección de voz sintética y conserva incertidumbre cuando
faltan datos. El [seguimiento acústico](traduccion-auditiva-hablantes-locales-049.md)
agrupa piezas de habla antes de las etiquetas tardías de Muse, con muestras
locales y grupos limitados a la sesión. El [diagnóstico de fuente](traduccion-auditiva-fuente-048.md)
comprueba identificadores, duración y vaciados del reproductor. Esas capacidades
se verificaron por separado; su integración completa sigue necesitando pruebas.

## Ensayo real desde el minuto cinco

El banco del navegador integrado inició una prueba acotada con la extensión
en Brave aislado y Muse, Meta y Cartesia reales. Se solicitó empezar en 300 s
del video `sr_iLGKNsxU`. Los controles de página, reproductor y respuesta
coincidieron con ese identificador en las tres etapas del informe; la duración
fue 1495,781 s, la tasa 1 y no se observó anuncio. La captura empezó realmente
en 302865 ms, después de 2628 ms desde activar. Esta prueba no preparó ni
reutilizó el prefijo de siete segundos, porque empezó en una posición avanzada.

La primera pieza, con límites estimados de ASR, correspondía a 302925–305347 ms
del video según el ancla. Se eligió una voz de catálogo masculina y el
clasificador local declaró confianza 0,997636. El estimador tonal obtuvo
195 Hz; un registro agudo no forzó en este caso una voz femenina. Esto acredita
la decisión y su procedencia acústica, no una identidad de género ni una
correspondencia humana verificada para ese intervalo.

La primera señal se midió a los 10314 ms desde activar. La pieza tenía 2,32 s
de audio, velocidad 1 y pico 0,7934; solo llegaron a reproducirse 1,6853 s.
El inicio estuvo a +4 ms respecto a su imagen, pero la copia de video se quedó
alrededor de 0,212 s y se interrumpió antes de completar la voz. El aviso fue
«El navegador se quedó sin imagen en el búfer». La recuperación dejó activo el
reproductor original. El informe conserva cero frases completas y resultado
global fallido.

El último búfer contenía los rangos relativos 0–0,263 s, 0,419–1,431 s y
1,620–7,559 s. Estos huecos orientan la investigación de recuperación de imagen;
no demuestran todavía su causa. La fuente original no estaba vaciada. El
retraso máximo medido fue 7,457 s y su crecimiento 0,049 s. Aunque ese pequeño
control numérico pasó, no hay cobertura completa con la que declarar una mejora
de continuidad. La comprobación global rechaza correctamente el ensayo.

Consumo observado: dos intentos MT en vivo, una solicitud TTS y un inicio de
análisis de prosodia. No se solicitó prefijo. El campo de eventos
`muse_live_input_started` fue cero, pero eso no demuestra ausencia de conexión
ASR ni de consumo; no se usa como contador total de proveedor. El importe
facturado y el uso remoto de GPU son desconocidos. No se adjuntan audio,
transcripciones, conversaciones ni fotogramas originales.

Evidencia: [informe real fallido](../tmp/selected-video/inline-sync-1793808194417.json).

## Estado del paquete y de la carga real

La instantánea local `release-staging-049.json`, tomada el 4 de noviembre a las
16:10:26 UTC, comprobó veinte archivos de extensión, excluyendo el paquete de
desarrollo y las pruebas. La fuente, `dist/Brivany-Traduccion-Brave-0.4.8`, la
carpeta registrada `dist/Brivany-Traduccion-Brave-0.4.4` y el alias sin versión
coincidían en esos veinte archivos; sus manifiestos declaraban 0.4.8. El ZIP
contenía veinte archivos iguales a la carpeta de publicación. Existía una copia
de respaldo previa a esa preparación. Es una comprobación local de contenido,
sin nuevas llamadas de inferencia ni acceso a facturación.

La recarga de la extensión instalada no quedó verificada. El control nativo
de Brave se detuvo porque no pudo determinar la URL actual con confianza. El
control de navegador tampoco pudo abrir la página interna de la extensión por
la política de protocolos. No se trató de lograr esa misma acción mediante
otro mecanismo ni de eludir la restricción. Archivos preparados no equivalen
a un service worker actualizado y activo.

La misma instantánea encontró dos procesos Python cuyos argumentos coincidían
con el lanzador de escritorio. No conservó sus argumentos ni certificó qué
versión de código estaba cargada; tampoco es un inventario de todas las formas
posibles de iniciar Brivany. Por tanto, no se declara que el escritorio esté
ausente ni que ya ejecute las correcciones actuales. La comparación anterior
de rendimiento en reposo sigue teniendo su alcance específico y no sustituye
esta comprobación de carga.

Esta instantánea antecede a la siguiente corrección del búfer. Cuando cambien
los archivos de la extensión será necesario regenerar y comprobar el paquete
correspondiente antes de atribuirle esa corrección.

Evidencia: [instantánea del paquete](../tmp/selected-video/release-staging-049.json).

## Verificaciones y pendientes

Los informes se conservan en su orden real. `translation-voices` pasó 24 casos;
`workspace-sync-extension` pasó 52. `sync-relay` pasó 59 casos en una ejecución
anterior, pero la ejecución posterior del 4 de noviembre a las 16:02:26 UTC
tuvo un fallo de cancelación: esperaba una petición `cancel` en un fixture y
observó cero. No se reemplaza ese resultado por el anterior. La suite River
de esa misma ejecución pasó 55 casos. Esta consolidación no repitió las suites
ni añadió pruebas de proveedor.

- [Voces, 24 casos](verification-history/translation-voices-20261104T154747-b55d0de6.json).
- [Extensión, 52 casos](verification-history/workspace-sync-extension-20261104T154542-70d1b632.json).
- [Sync anterior, 59 casos aprobados](verification-history/sync-relay-20261104T155451-184c02bf.json).
- [Sync posterior, un fallo conservado](verification-history/sync-relay-20261104T160226-c728cbd0.json).
- [River posterior, 55 casos aprobados](verification-history/river-translation-20261104T160226-a8ede223.json).

Siguen pendientes recuperar la imagen sin truncar voces, aclarar la cancelación
del fixture, verificar la carga real de la actualización y repetir los ensayos
desde el inicio con los modelos actuales. También falta acreditar continuidad
prolongada, asignación de voces en el video natural y sincronización del
contenido completo. El prefijo automático, el salto al reconocimiento en vivo,
la omisión de canciones y los metadatos de emoción deben conservarse en ese
recorrido conjunto; los controles separados no los dan por concluidos.

## Continuación 050: dos frases completas no cierran el objetivo

La [corrección de huecos](traduccion-auditiva-huecos-050.md) y la
[guía de duración y aceptación](traduccion-auditiva-duracion-050.md) se
incorporaron después de la instantánea de paquete y del ensayo fallido descritos
arriba. Sus comprobaciones y fallos se conservan por separado. No se atribuyen
esas correcciones a la recarga de una extensión instalada que aún no se ha
certificado.

El intento real `inline-sync-1793808895861.json`, iniciado el 4 de noviembre
a las 16:14:42 UTC, agotó el plazo al abrir el video (`abrir-video:
TimeoutError`). No llegó a capturar ni a producir voces. Una lectura posterior
del estado del banco 49196 confirmó cero sesiones de relay, cero preparaciones
de prefijo y cero intentos contados de Muse batch, prosodia y traducción
anticipada. No se iniciaron proveedores de traducción en ese intento; el
tráfico de navegación a YouTube no se midió y no se declara consumo externo
total nulo. La lectura retrospectiva no abrió inferencias nuevas.

El siguiente ensayo, `inline-sync-1793809294737.json`, comenzó a las
16:21:10 UTC desde la posición solicitada de 300 s. La captura efectiva empezó
en 305736 ms. La identidad y duración del video se verificaron sin anuncio;
la reproducción completó dos frases con señal hasta el segundo absoluto
309,487111. El inicio de las voces quedó a −12 y −2 ms respecto a la imagen,
con velocidades de 1,065 y 1,147×. La primera señal apareció a los 7,435 s
desde activar. El retraso máximo fue 6,437 s y su crecimiento máximo 0,464 s.
No se observaron interrupción de fuente, voces publicadas perdidas en ese tramo
completado ni recuperación del original.

El criterio técnico corto marcó `passed=true`; no fue aceptación del producto
completo. El banco terminó antes del primer hueco del último conjunto de
rangos registrado y no conserva un contador de acciones de recuperación.
Por ello no demuestra que se ejercitara esa recuperación en el video real.
Además, la primera voz fue femenina y la siguiente masculina. La revisión
encontró que un consejo de timbre incierto todavía podía acabar en una voz
femenina por la reserva basada en registro tonal. Esa ruta está en corrección;
no se presenta como distinción correcta de hablantes. No hubo escucha física
nueva ni verificación humana específica de estos intervalos.

Los contadores del banco 49197 confirmaron una sesión de relay y un flujo
Muse con acuse y audio iniciados, cuatro intentos MT directos, una traducción
anticipada de subtítulos, dos solicitudes TTS y tres intentos de prosodia.
No hubo preparación del prefijo en este ensayo desde posición avanzada.
Parte del trabajo anticipó frases fuera de las dos completadas. El importe
facturado, el uso remoto de GPU y el total de tráfico incidental son
desconocidos. Las dos lecturas retrospectivas de contadores no ejecutaron
modelos ni adjuntaron audio, video o transcripciones.

La secuencia de verificación también se conserva. El informe
`sync-relay-20261104T161254-39839e81.json` pasó 62 casos. Una ejecución
posterior, `sync-relay-20261104T162203-b283c7d6.json`, tuvo dos errores en
las comprobaciones del error de ritmo Muse y del cierre de política: los tests
intentaban leer `code` del nuevo evento `live-asr-connected`, emitido antes
del error. Se ajustaron ambos casos para comprobar ese acuse y después el
error esperado. Los dos casos dirigidos se comprobaron después de forma local;
esa salida solo quedó en terminal y no constituye otro informe de suite
completa. Esta anotación no repite pruebas ni transforma la ejecución de
62 casos con dos errores en una suite aprobada. La nueva suite completa
continúa pendiente al registrar esta revisión.

Evidencia adicional sin medios originales:

- [Apertura agotada](../tmp/selected-video/inline-sync-1793808895861.json).
- [Contadores nulos de proveedores en ese intento](../tmp/selected-video/lab-consumption-49196-050.json).
- [Dos frases reales completadas](../tmp/selected-video/inline-sync-1793809294737.json).
- [Revisión acotada de calidad del búfer](../tmp/selected-video/buffer-quality-audit-1793809294737.json).
- [Contadores del ensayo corto](../tmp/selected-video/lab-consumption-49197-050.json).
- [Suite de 62 casos aprobada](verification-history/sync-relay-20261104T161254-39839e81.json).
- [Ejecución posterior con dos errores](verification-history/sync-relay-20261104T162203-b283c7d6.json).
