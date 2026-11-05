# Preparación real por fases y continuidad todavía fuera de límite

4 de noviembre de 2026. El ensayo
`tmp/selected-video/inline-sync-1793816151318.json` pudo confirmar la apertura
del video con la [comprobación directa 061](traduccion-auditiva-apertura-061.md)
y medir las fases de la [preparación paralela 059](traduccion-auditiva-preparacion-paralela-059.md).
Se completaron quince voces con señal hasta el segundo relativo 31,700.
**El resultado global siguió fallando**: retraso máximo de 9,478528 s y
crecimiento de 5,190528 s, frente a los límites vigentes de 8 y 3 s.

## Preparación medida, distinta de los siete segundos de contenido

El banco 49204 registró la ejecución de 18:14:45,932 a 18:15:51,365 UTC.
Brave aislado reprodujo el video de Tecnonauta con proveedores reales,
sin perfil personal ni clonación. Los cuatro identificadores y las duraciones
coincidieron en los controles de apertura, antes de activar y al terminar:
1495,781 s de fuente, sin anuncio ni error de medios, a velocidad 1×.
El fallo anterior de apertura se conserva; esta ejecución no demuestra que
la navegación vaya a funcionar siempre dentro del plazo.

La preparación completa observada por el navegador duró **12,059 s de pared**.
Se enviaron 7040 ms de PCM y el backend utilizó exactamente 7000 ms. El nuevo
informe conserva estas fases numéricas, también en su versión saneada:

| Fase | Tiempo observado |
| --- | ---: |
| Recepción de captura en el servidor | 7015 ms |
| Filtro inicial de contenido | 63 ms |
| ASR Muse del prefijo | 2594 ms |
| Clasificación de turnos | 15 ms |
| Prosodia remota | 2344 ms |
| Timbre local | 1969 ms |
| Posprocesado total tras ASR | 2359 ms |
| Preparación total del servidor, sin captura previa | 5016 ms |

Prosodia y timbre suman 4313 ms de sus propios relojes, pero ambos quedan
dentro del posprocesado de 2359 ms. Es evidencia numérica de su solapamiento
en este recorrido, de aproximadamente 1954 ms como mínimo, con el redondeo
de las métricas. Sus tiempos no se suman para obtener la espera de pared.
Filtro, ASR y posprocesado suman los 5016 ms del servidor. Recepción y
preparación suman 12,031 s, cerca de los 12,059 s observados por el navegador;
la diferencia de unos 28 ms no se atribuye a otra fase no instrumentada.

Frente a los 15,673 s del ensayo 057, la espera previa observada fue 3,614 s
menor. Aquella ejecución no conservaba estas fases y los tiempos remotos,
intervalos ASR y salidas generadas varían. No se atribuye toda esa diferencia
al solapamiento, ni se promete el mismo ahorro en otra ejecución.

El video había avanzado a 12,279405 s antes de activar; el doblaje volvió al
ancla de 20 ms. El prefijo se adjuntó, el ASR en vivo empezó en 7000 ms y
hubo cero solapamiento repetido y cero inicios duplicados. Se completaron
tres voces del prefijo y doce en vivo. Sigue siendo una comprobación desde
el ancla inicial, no de activación arbitraria sin retroceder el video.

## Audio y límites de aceptación

La primera señal apareció a los **4,803 s desde activar**, después de contar
con el prefijo. Ese tiempo excluye los 12,059 s de preparación previa. El
medidor de producción confirmó quince voces completas y quince con señal,
y primera señal a los 4,6409 s desde su reloj de captura. Los desfases de
inicio respecto a la imagen estuvieron entre **−20 y +7 ms**. Once intervalos
usaron límites parciales estimados del ASR y cuatro límites de turno.
No se acredita con ello alineación semántica de cada palabra ni naturalidad
de las voces actuales.

No hubo recuperación del audio original, voces publicadas perdidas dentro
de la cobertura completada, interrupción de fuente o error de decodificador.
El contador `recorder_gap_recoveries` fue cero en ambos informes: no prueba
una recuperación real ejecutada. La imagen llegó al segundo relativo
31,769472 y la captura al 41,200. Una voz posterior sólo reprodujo
0,062421 s de 2,16 s sin señal registrada; no cuenta como completada.

El retraso inicial fue 4,288 s, máximo 9,478528 s y final 9,430528 s.
El crecimiento de 5,190528 s mantiene el resultado fuera del criterio.
La menor espera previa no resuelve por sí sola la acumulación durante el
doblaje. Los restos estables 058 también estaban incorporados, pero no se
aísla su efecto con una comparación de solicitudes remotas distintas.

Las categorías de las quince voces completas fueron **una masculina y catorce
femeninas**: prefijo femenina, masculina, femenina, seguido de doce voces
femeninas en vivo. Son categorías del audio emitido, no personas identificadas.
La correspondencia humana sigue sin verificarse y la queja sobre el presentador
masculino continúa abierta. El informe mantiene falsa la verificación de
escucha física y de hablantes naturales. No hubo canciones preparadas ni
omitidas, por lo que tampoco ejercita la omisión de canciones en este trayecto.
La parada real desde WorkSpace y el video completo siguen sin verificarse.

## Consumo y conservación de evidencia

El estado terminal completo
`tmp/selected-video/lab-consumption-49204-062.json` confirma:

- Una sesión de relay y una preparación de prefijo.
- Muse: un batch de prefijo y un flujo en vivo con acuse y entrada iniciada.
- MT: tres intentos del prefijo y dieciséis en vivo, más una traducción
  anticipada de subtítulos.
- TTS: tres solicitudes del prefijo y quince en vivo.
- Prosodia: dos intentos de conexión del prefijo y cinco en vivo.

El trabajo anticipado excedió las quince voces completadas. El importe
facturado, el uso remoto de GPU y el tráfico incidental total son desconocidos.
La revisión no repitió pruebas ni abrió nuevas inferencias. La auditoría
`tmp/selected-video/prefix-phase-audit-1793816151318.json` conserva sólo métricas
y códigos, sin PCM, video, transcripciones ni credenciales originales.

La presentación del banco dispone ya de estas fases numéricas; su comprobación
visual posterior pertenece a otro registro. La
[matriz de aceptación](traduccion-auditiva-aceptacion-057.md) conserva el alcance
integral de 1495,781 s y los requisitos pendientes; el nuevo resultado no
convierte componentes comprobados en aceptación completa.

## Continuación posterior: presentación comprobada

Se revisaron después el árbol de accesibilidad y una captura del banco 49204,
con ancho de 443 px. Se mostraron correctamente los redondeos de preparación,
recepción, ASR, clasificación, timbre y prosodia, junto con la explicación
de que los análisis simultáneos no se suman. No hubo solapamiento en ese ancho
y la tabla dispuso de desplazamiento horizontal. La captura temporal no se
adjunta a la bitácora. Esta comprobación posterior actualiza la evidencia de
presentación; no modifica el resultado fallido del doblaje ni añade escucha
física. El [registro visual y de arranque nativo 064](traduccion-auditiva-visual-y-carga-064.md)
conserva los límites y el estado de carga observado.
