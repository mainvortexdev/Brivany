# Preparación automática de siete segundos en Brave

La extensión prepara el audio inicial de un video que empieza a reproducirse
en una pestaña visible de un sitio autorizado. YouTube se identifica por su
ID. En otras páginas se requiere un único video elegible. La preparación usa
audio del elemento en reproducción y deja su imagen, volumen y controles
disponibles. Se envían hasta 88 bloques de 80 ms al enlace local, que recorta
los últimos 40 ms y prepara exactamente siete segundos a partir del ancla
capturada. La página debe empezar cerca de cero, a velocidad normal y con
posibilidad de búsqueda. Videos en directo y entradas desde un punto avanzado
pueden usar la traducción directa desde la posición actual.

La extensión prepara una sola apertura por elemento y fuente. Brivany conserva
hasta seis aperturas en memoria durante diez minutos. Al activar Traducción
auditiva con una apertura coincidente, la extensión vuelve al ancla para
reproducir el inicio ya traducido. Brivany conserva los tiempos de los turnos
preparados y comienza el reconocimiento en vivo en el segundo 7 del tramo.
Si Muse devuelve una última intervención incompleta, el reconocimiento en
vivo retoma desde el inicio de esa intervención. Las dos sesiones de Muse
usan etiquetas independientes porque la letra que devuelve el proveedor solo
identifica a un hablante dentro de su propia sesión. [Esquema de Muse](https://dev.meta.ai/docs/api-reference/voice/schemas).

El filtro local clasifica la apertura y los turnos. Si todo el tramo resulta
ser música o canto con alta confianza, la preparación libera esos siete
segundos al original sin abrir una solicitud de Muse. Cuando hay diálogo o
una mezcla ambigua, Muse confirma los turnos y Brivany omite el doblaje de
los intervalos que el filtro identifica como canción. El registro acústico
y la emoción estimada son consultivos y se muestran cuando están disponibles.

## Comprobaciones

- Los protocolos sustituidos confirmaron que el relevo puede empezar en
  7000 ms con un bloque de 40 ms. El original cubrió un intervalo de canto,
  el reconocimiento en vivo omitió los siete segundos ya preparados y la
  misma letra de Muse se mantuvo separada entre sus dos sesiones.
- Brave aislado con MP4 propio y servicios sustituidos capturó desde 5 ms,
  recuperó el ancla al activar y reprodujo un turno preparado y dos en vivo
  a 1×. Primera señal a 4,910 s desde activación, sin repetir inicios y con
  una canción de prueba omitida. Informe `tmp/selected-video/inline-sync-1793801878238.json`.
- La primera prueba real desde 0:00 del video de Tecnonauta capturó desde
  18 ms. La preparación quedó lista en 13,345 s desde el inicio del protocolo.
  El relevo ocurrió en 7000 ms, sin repetir turnos. Se midieron tres frases
  preparadas y una nueva, todas con señal. Primera señal a 4,792 s desde
  activar, velocidades de 1× a 1,18× y desfases de −24 a +11 ms. El tramo
  probado contenía tres turnos de habla en la apertura. Informe
  `tmp/selected-video/inline-sync-1793801940755.json`.

En el primer ensayo real se observó una preparación de 7 s, 6 s de progreso
posterior del ASR en vivo, cuatro intentos de traducción, cuatro contextos de
síntesis y dos análisis de prosodia iniciados en vivo. Los análisis auxiliares
de la apertura y el importe facturado quedan sin contador confirmado en ese
informe. El banco permite escuchar un fragmento sintetizado que queda en
memoria. La bitácora guarda solo métricas y estados.

## Continuidad y corrección posterior

El ensayo ampliado `tmp/selected-video/inline-sync-1793802341066.json` falló
su requisito de cuatro frases nuevas completas. La preparación y el relevo
en 7000 ms funcionaron, pero solo se oyeron dos turnos nuevos. Tres doblajes
llegaron después de que el original ya hubiera cubierto esos intervalos.
Muse mantuvo dos turnos abiertos 10,40 y 12,48 s. El reproductor recuperó el
original al llegar al límite de espera y descartó las voces tardías. La fuente
de YouTube se vació cerca de 43 s capturados y la cola restante se consumió.

Contadores observados del ensayo ampliado. Una solicitud Muse de apertura y
un flujo Muse en vivo, dos análisis de prosodia de apertura y cinco en vivo,
una traducción especulativa y ocho intentos MT directos, con ocho contextos
de síntesis. El importe es desconocido. El informe conserva el fallo.

La corrección posterior incorpora cláusulas confirmadas por dos observaciones
acumulativas del ASR, con palabras de reserva. Los tiempos intermedios son
estimaciones relativas al audio procesado y se identifican con
`asr_partial_estimate`. Los límites finales del turno conservan la marca
`asr_turn`. Una revisión del texto ya emitido libera únicamente el resto con
el original. La reproducción evita volver a doblar la parte ya oída.

Se corrigió además la recepción del progreso preparado. La pestaña escucha
los eventos antes de enviar la orden de inicio, para conservar el avance de
Muse aunque el módulo de audio del navegador tarde en cargar.

El ensayo local de Brave `tmp/selected-video/inline-sync-1793802837145.json`
reprodujo tres cláusulas estimadas y dos turnos confirmados. La recuperación
del original observada incluyó 1,492 s del tramo marcado como música y
0,012 s adicionales. Las regresiones del relay verificaron una primera
cláusula a 2200 ms antes de cerrar un turno de diez segundos, el resto una
sola vez y la recuperación ante una revisión tardía. Proveedores sustituidos.

El siguiente ensayo real `tmp/selected-video/inline-sync-1793802945720.json`
se detuvo en `prefix_asr_timeout`, antes de abrir el doblaje. Una petición
Muse de apertura alcanzó el plazo de seis segundos. El original seguía
reproduciéndose y no se cambió su volumen. Se amplió el margen de esa
preparación a diez segundos y el plazo total de captura/preparación del
navegador a 25 s. La observación de doblaje mantiene su propio límite.

La auditoría del tramo 25,03–30,15 s del video se realizó con audio en memoria
y sin llamadas a proveedores. El estimador local y YIN confirmaron un registro
alto a reproducción 1×. Ese resultado no determina el timbre de catálogo que
mejor corresponde al hablante. Se añadió una estimación independiente de
timbre, con confianza, para que un registro alto pueda usar una voz de
catálogo masculina. La corrección de catálogo se aplica con confianza de al
menos 0,8 y conserva la elección manual. Informe
`tmp/selected-video/voice-audit-24s-20261104.json`.

## Revisión de continuidad y escucha posterior

El ensayo `inline-sync-1793803374340.json` pasó un criterio inicial demasiado
débil: el análisis posterior encontró 10,208 s cubiertos por el original y
cinco cláusulas perdidas. Se conserva ese informe y su revisión de calidad.
La preparación MT ahora admite dos solicitudes independientes en paralelo,
con salida ordenada y un máximo de dos contextos. Las cláusulas anticipadas
requieren al menos 1,8 s de audio; así se evita saturar los proveedores con
fragmentos mínimos. Un ensayo posterior perdió todavía 2,038 s por una voz
recibida a los 9,156 s de su origen. El límite de espera del turno cerrado se
amplió de 8,75 a 9,5 s; la recuperación del original sigue acotada.

El ensayo real `inline-sync-1793805005857.json` reutilizó siete segundos ya
preparados y continuó el ASR exactamente desde 7000 ms. Reprodujo tres frases
preparadas y doce nuevas completas, cubriendo hasta 31,7 s. No se midieron
pérdidas, duplicados ni recuperación del original en ese tramo. La primera
señal llegó a los 4,835 s desde activar. Las voces se reprodujeron entre 1× y
1,18×; el inicio respecto a la imagen estuvo entre −23 y +13 ms. Nueve frases
completas usaron límites intermedios estimados del ASR, lo que no demuestra
sincronía exacta de cada palabra.

La revisión de calidad rechazó el funcionamiento global pese a pasar ese
criterio de continuidad: el retraso entre captura e imagen creció hasta
10,415 s. El usuario confirmó que el fragmento reproducido en el banco se oye
claro y natural, pero identificó voces femeninas incorrectas para el
presentador masculino predominante. La escucha del fragmento no certifica
todo el video. El clasificador local inicial acertó las muestras propias y
falló esta correspondencia pública; su confianza numérica no se considera
evidencia suficiente de calidad. Se registra la corrección en
`tmp/selected-video/quality-audit-1793805005857.json`. El objetivo sigue abierto.

El último informe observó tres intentos MT de apertura y quince en vivo,
tres solicitudes TTS de apertura y catorce en vivo, un flujo Muse en vivo y
seis inicios de prosodia en vivo. Algunas solicitudes quedaron anticipadas
fuera del tramo completado. El importe facturado es desconocido. No se
adjuntan transcripciones, conversaciones ni medios originales a la bitácora.
