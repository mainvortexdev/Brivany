# Ensayo 069 de la cola anticipada y la guía de palabras

El ensayo real completó 31,380 s de doblaje con quince voces y señal en todas.
El banco rechazó el resultado con los mismos límites del ensayo de 31 s
anterior. El retraso máximo alcanzó **8,167024 s**, 0,167024 s por encima del
límite de 8 s. El crecimiento fue **3,879024 s**, 0,879024 s por encima del
límite de 3 s. La reserva de audio original quedó en cero, dentro de su límite
de un segundo.

El banco integrado 49207 inició Brave aislado con proveedores reales el 4 de
noviembre de 2026 entre 19:35:16,496 y 19:36:15,609 UTC. Se verificó el video
de Tecnonauta, de 1495,781 s, y se reutilizó el prefijo. La preparación duró
13,551 s de pared antes de activar. De 7040 ms enviados se usaron 7000 ms y
el ASR en vivo empezó justo en esa frontera. No se repitieron inicios ni hubo
solapamiento con la parte ya preparada. La primera señal apareció a 4,723 s
de activar, aparte de la espera previa. El medidor de producción confirmó
tres voces del prefijo y doce en vivo, con primera señal a 4,4807 s desde
su reloj de captura.

| Medición | Ensayo 065 | Ensayo 069 |
| --- | ---: | ---: |
| Cobertura requerida | 31,000 s | 31,000 s |
| Cobertura completada | 31,460 s | 31,380 s |
| Voces completas con señal | 16 | 15 |
| Primera señal desde activar | 4,934 s | 4,723 s |
| Retraso inicial | 4,533333 s | 4,288 s |
| Retraso máximo | 10,949333 s | 8,167024 s |
| Crecimiento máximo | 6,416 s | 3,879024 s |
| Reserva de audio original | 0 s | 0 s |
| Resultado | Falló | Falló |

El máximo observado bajó 2,782309 s y el crecimiento bajó 2,536976 s.
Ambos ensayos usaron la misma fuente y los mismos límites. Cambiaron los
límites ASR, las peticiones remotas y las duraciones sintetizadas. También
entraron dos correcciones juntas. La comparación no aísla cuánto aportó
cada una ni cuánto corresponde a la variación entre ejecuciones.
[Ensayo 065](traduccion-auditiva-ensayo-065.md).

## Publicación anticipada comprobada

Uno de los 17 eventos `cue_ready` registró `published_ahead=true`. Fue el
segmento 9, de 17,989873 a 19,220 s. Su voz se publicó en el milisegundo
21739 del reloj de protocolo. La anterior, que empieza en 15,649618 s,
se publicó en 22837, 1098 ms después. El reproductor mantuvo el orden de
origen y completó las dos voces. El siguiente MT comenzó en 22710, 123 ms
antes de que terminara la síntesis anterior en 22833. Es una observación
real de publicación anticipada y trabajo concurrente. Los 1098 ms entre
publicaciones no miden una reducción equivalente de retraso audible.
[Cambio de cola](traduccion-auditiva-cola-068.md).

## El tercer turno del prefijo siguió siendo largo

| Medición | Ensayo 065 | Ensayo 069 |
| --- | ---: | ---: |
| Intervalo de fuente | 4,220–6,540 s | 4,380–6,540 s |
| Duración del intervalo | 2,320 s | 2,160 s |
| Palabras de origen reportadas | 8 | 10 |
| Palabras léxicas sintetizadas | 9 | 12 |
| Guía de velocidad de síntesis | 1,293 | 1,5 |
| PCM generado | 4,080 s | 4,160 s |
| Velocidad de reproducción | 1,18× | 1,18× |
| Tiempo real de reproducción | 3,434 s | 3,512 s |
| Exceso sobre el intervalo | 1,114 s | 1,352 s |

Los intervalos son cercanos y comparten el límite final, pero el ASR produjo
límites y conteos distintos. La guía orientativa para 2,160 s sugería unas
cinco a seis palabras y permitía superarlas para conservar el contenido.
Este turno generó más palabras y más PCM que en 065. No hay evidencia de que
la guía haya acortado esta voz. Tampoco hay una revisión semántica de las dos
traducciones para juzgar si podrían expresarse fielmente con menos palabras.
[Guía de palabras y alcance](traduccion-auditiva-guia-lexica-068.md).

La síntesis de ese turno recibió su último PCM en 891 ms desde la solicitud.
El tiempo hasta la confirmación final redondeó a cero. Fue el máximo hasta
el último bloque entre las 17 síntesis terminadas. La espera posterior
máxima fue de 16 ms en otra voz. La tercera voz ocupó más tiempo de
reproducción que su intervalo pese a que la generación terminó pronto.
En los pares de voces completadas, los excesos positivos de duración sumaron
2,620 s y las esperas positivas entre inicios, después de descontar duración
y huecos de fuente, 1,546 s. Son componentes de relojes medidos con límites
ASR parcialmente estimados. No constituyen una suma exacta del crecimiento
máximo del reloj de imagen.

## Señal, voces y consumo

Los inicios de las quince voces quedaron entre −7 y +8 ms respecto a la
imagen. Once intervalos usaron límites parciales estimados y cuatro límites
de turno. Se emitieron diez voces de catálogo femeninas y cinco masculinas.
Cuatro fueron provisionales, tres masculinas y una femenina. La atribución
humana y la naturalidad de estas voces siguen pendientes. No se recuperó
audio original ni se perdieron voces publicadas dentro de la cobertura
completada. Hubo cero recuperaciones de huecos contadas y no se registró
interrupción de fuente, error de imagen ni error explícito de protocolo.
Una voz posterior quedó fuera de las completadas. No hubo canciones
preparadas u omitidas y no se verificó la parada desde WorkSpace.

El estado terminal registró una preparación de prefijo y una sesión de relay.
Muse inició un batch de prefijo y un flujo en vivo con acuse y entrada de audio.
MT registró tres intentos directos del prefijo y quince en vivo, más un intento
anticipado de subtítulos. TTS registró tres solicitudes del prefijo y catorce
en vivo. Prosodia registró dos intentos de conexión del prefijo y cinco en
vivo. Esos conteos incluyen trabajo posterior a las quince voces completadas.
El importe facturado, la GPU remota y el tráfico incidental total siguen
sin medirse.

Se conservaron `tmp/selected-video/inline-sync-1793820975568.json`, el estado
terminal `tmp/selected-video/lab-consumption-49207-069.json` y la auditoría
`tmp/selected-video/continuity-audit-1793820975568.json`. La revisión usó una
lectura local de estado e informes ya producidos. No repitió el ensayo ni
incorporó medios, transcripciones o credenciales. El recorrido personal y la
continuidad del video completo siguen pendientes.
