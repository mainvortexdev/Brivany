# Ensayo 065 con nueva evaluación de timbre

El ensayo real del 4 de noviembre completó dieciséis voces con señal hasta
31,460 s del video de Tecnonauta. El banco rechazó el resultado por un retraso
máximo de **10,949333 s** y un crecimiento de **6,416 s**. Los límites vigentes
son 8 y 3 s. La reserva de audio original y las voces publicadas sin reproducir
dentro de la cobertura completada fueron cero.

El banco 49205 ejecutó el ensayo entre 19:16:30,346 y 19:17:36,101 UTC en Brave
aislado, con proveedores reales. La identidad y duración de la fuente,
1495,781 s, se verificaron al abrir, al activar y al finalizar. El prefijo
estuvo disponible antes de activar. Usó siete segundos de 7040 ms enviados
y continuó en vivo desde 7000 ms, sin solapamiento repetido ni inicios
duplicados. El original avanzó a 12,594257 s antes de activar y el doblaje
volvió al ancla inicial de 18 ms.

| Medición | Ensayo 062 | Ensayo 065 |
| --- | ---: | ---: |
| Preparación previa observada por el navegador | 12,059 s | 12,510 s |
| Recepción del prefijo en servidor | 7,015 s | 7,031 s |
| Preparación del servidor tras recibirlo | 5,016 s | 5,453 s |
| Primera señal desde activar | 4,803 s | 4,934 s |
| Voces completas con señal, prefijo + vivo | 15, 3 + 12 | 16, 3 + 13 |
| Cobertura relativa completada | 31,700 s | 31,460 s |
| Retraso inicial | 4,288 s | 4,533333 s |
| Retraso máximo | 9,478528 s | 10,949333 s |
| Crecimiento máximo | 5,190528 s | 6,416 s |
| Reserva de audio original | 0 s | 0 s |
| Aceptación | Falló | Falló |

La comparación reúne dos ejecuciones con el mismo video y anclas cercanas.
El ASR produjo límites distintos y los proveedores respondieron con tiempos
y audio diferentes. El resultado muestra mayor retraso en 065. No aísla la
contribución del cambio de timbre, la red, la carga del equipo o la síntesis.
La primera señal de cada columna se mide después de la espera previa del
prefijo. Las duraciones de prosodia y timbre en 065 fueron 2171 y 1750 ms
dentro de un posprocesado de 2203 ms.

## Evidencia de voz y atribución pendiente

Las dieciséis voces completadas usaron **ocho voces de catálogo masculinas y
ocho femeninas**. Cinco fueron provisionales, cuatro masculinas y una femenina.
El prefijo conservó la secuencia femenina, masculina y femenina. En vivo
se completaron siete masculinas y seis femeninas. El ensayo 062 había emitido
una masculina y catorce femeninas. La correspondencia con los hablantes reales
y la escucha física de estas voces siguen pendientes.

Los índices de solicitud muestran diez asociaciones `matched` con similitud
inferior a 0,77 en 065. Cada una registró una nueva inferencia local antes de
la solicitud TTS. En 062, ocho asociaciones por debajo de ese umbral llegaron
a TTS sin un nuevo evento de timbre local. El caso más directamente comparable
empieza cerca de la frontera de siete segundos. En 062, la pieza 7,00–8,42 s
con similitud 0,6603 heredó el timbre femenino del grupo 3. En 065, la pieza
7,06–8,42 s con similitud 0,6565 se volvió a evaluar y obtuvo timbre masculino
con confianza 0,925865. La síntesis usó categoría masculina provisional y
la procedencia `local_timbre_conflict`. Es el comportamiento esperado de la
corrección 063 en una coincidencia débil y un conflicto. El informe no dispone
de una referencia humana específica del intervalo.

Otra asociación registró similitud 0,823 y conservó categoría masculina
provisional sin nueva inferencia en ese índice. Las cinco peticiones TTS
provisionales de la cobertura usaron tres veces `local_timbre_conflict`, una
`weak_acoustic_timbre` y una `provisional_catalog`. El protocolo conservó
quince eventos de timbre local frente a siete en 062, en ambos casos contando
trabajo posterior a la cobertura completada. No se observó una espera de
200 ms entre el fin de MT y la petición TTS en los segmentos terminados de
065. Esa diferencia acotada no compensa el retraso global del ensayo.
[Corrección de caché y pruebas 063](traduccion-auditiva-cache-timbre-063.md).

## Audio y acumulación del retraso

El medidor de producción confirmó dieciséis voces completas con señal. Sus
inicios quedaron entre −20 y +8 ms respecto a la imagen. Diez intervalos
parten de estimaciones parciales de ASR y seis de límites de turno. Las
velocidades de reproducción fueron de 1× a 1,18×. No hubo interrupción de
fuente, error de decodificador o recuperación de hueco contada. El protocolo
guardó un plazo agotado de prosodia y continuó con el doblaje. No se completó
la siguiente voz y no se cuenta en la cobertura. No hubo canciones preparadas
u omitidas. La parada desde WorkSpace y la naturalidad de las voces tampoco
se verificaron en esta ejecución.

La revisión de los quince pares consecutivos de voces completadas separa
dos contribuciones comparables. Los excesos positivos del tiempo reproducido
sobre su intervalo fuente suman 3,078 s. Las esperas positivas entre inicios,
descontando la duración mayor entre voz e intervalo fuente y el hueco de fuente,
suman 3,042 s. Su suma de 6,120 s aproxima el crecimiento medido de 6,416 s.
La diferencia incluye el alcance de las ventanas y los relojes usados.
Las marcas parciales del ASR siguen siendo estimaciones.

La mayor espera entre voces fue 1,561 s antes de la pieza que empieza en
12,794 s. Su petición MT tardó 4672 ms. La espera antes de la tercera voz
del prefijo, en 4,220 s, fue 1,386 s. Esa voz quedó lista en el milisegundo
10060 del reloj de protocolo, con 1829 ms de MT y 3634 ms entre solicitud
TTS y generación completa. Esa misma voz ocupó 1,114 s más de reproducción
que su intervalo fuente. Otra voz excedió su intervalo en 0,888 s y un
resto de 80 ms en 10,180–10,260 s ocupó 0,806 s de reproducción, un exceso
de 0,726 s. Son contribuciones observadas. Los datos no aíslan una única
causa para la variación frente a 062.

## Recursos durante el banco

El muestreo de Windows empezó a las 19:16:16,772 UTC y cubrió 105 s. Se
seleccionaron 66 muestras por su hora dentro de la ventana del banco, entre
14,015 y 79,062 s desde el inicio del muestreo. La primera diferencia de CPU
incluye parte del intervalo anterior al inicio del banco. Los promedios son
medias de muestras aproximadamente separadas por un segundo.

| Medición | Mínimo | Media | Máximo |
| --- | ---: | ---: | ---: |
| CPU del PID 11736, en núcleos equivalentes | 0,0000 | 0,2091 | 0,9844 |
| Memoria residente del PID, MiB | 153,3 | 283,8 | 333,4 |
| Memoria privada del PID, MiB | 391,5 | 525,1 | 576,2 |
| CPU total del equipo | 8,59 % | 27,76 % | 68,36 % |
| Memoria física disponible, MiB | 2050,5 | 2315,2 | 3106,0 |

Los contadores del PID corresponden a un proceso del banco. La CPU del equipo
incluye Brave, otros procesos del banco y el resto de Windows. Las muestras
no aíslan el consumo del árbol completo de Brave ni miden directamente la
respuesta de la interfaz o bloqueos subsegundo. El registro conserva la
ventana muestreada y no extrapola al video completo.

## Consumo registrado

El estado terminal confirma una preparación de prefijo y una sesión de relay.
Muse inició un batch de prefijo y un flujo en vivo con acuse y entrada de
audio. MT registró tres intentos directos del prefijo, diecisiete en vivo y uno
anticipado de subtítulos. TTS registró tres solicitudes del prefijo y dieciséis
en vivo. Prosodia inició dos conexiones del prefijo y seis en vivo. Hubo
trabajo posterior a las dieciséis voces completadas. El importe, la GPU remota
y el tráfico incidental total siguen sin medirse.

Se conservaron el informe `tmp/selected-video/inline-sync-1793819856033.json`,
el estado terminal `tmp/selected-video/lab-consumption-49205-065.json`, las
muestras `tmp/selected-video/lab-resources-49205-065.json` y la auditoría
`tmp/selected-video/voice-continuity-audit-1793819856033.json`. La revisión
usó datos ya producidos y dos lecturas locales de estado. No abrió nuevas
inferencias ni incorporó medios, credenciales o conversaciones originales.
La distinción humana, la aceptación de continuidad y el video completo
siguen pendientes. [Matriz de alcance](traduccion-auditiva-aceptacion-057.md).

## Presentación y muestra generada observadas

La revisión visual del banco integrado confirmó la presentación de las
dieciséis voces con señal, el prefijo de 7 s, las trece voces completas en vivo,
el retraso máximo redondeado a 10,95 s y su crecimiento de 6,42 s. La tabla
mostró la categoría de catálogo y el estado provisional cuando correspondía.
La captura temporal `tmp/selected-video/bank-voice-review-065.png` no se
adjunta a la bitácora.

Se midió en memoria una muestra generada de 1600 ms a 24 kHz desde la ruta
local del banco. En ventanas RMS de 10 ms, la primera por encima de −65 dBFS
comenzó en 170 ms. Las primeras por encima de −55 y −45 dBFS comenzaron en
190 ms. La última ventana de 10 ms superó los tres umbrales. Una muestra
con ese patrón no permite asumir que todas las voces tengan silencio
recortable ni juzgar la naturalidad. La inspección no guardó bytes de audio
ni abrió solicitudes nuevas de proveedor.
