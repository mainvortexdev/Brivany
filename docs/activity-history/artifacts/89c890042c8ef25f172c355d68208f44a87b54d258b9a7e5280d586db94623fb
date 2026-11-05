# Ensayo real con ritmo medido: menor retraso observado, todavía fuera de límite

4 de noviembre de 2026. La prueba
`tmp/selected-video/inline-sync-1793813320346.json` incorporó la
[guía de duración medida](traduccion-auditiva-duracion-medida-055.md) y el
[diagnóstico por solicitud](traduccion-auditiva-diagnostico-solicitudes-056.md).
Completó catorce voces con señal hasta el segundo relativo 31,700. **Falló
la aceptación**: retraso máximo de 9,559520 s y crecimiento de 5,255520 s,
frente a los límites vigentes de 8 y 3 s. No se rebajan los criterios ni se
presenta este resultado como el producto completo.

## Recorrido comprobado

El banco 49202 registró la ejecución de 17:27:34,574 a 17:28:40,405 UTC,
con Brave aislado y proveedores reales. La identidad del video de Tecnonauta
y su duración de 1495,781 s coincidieron antes de activar y al terminar,
sin anuncio ni error de medios, con fuente a 1×. No se usó el perfil personal
ni clonación.

La preparación del prefijo tardó **15,673 s de pared** antes de activar.
Se enviaron 7040 ms de PCM y se utilizaron exactamente siete segundos.
El video había avanzado a 15,722223 s antes de activar; la captura del
doblaje volvió al ancla de 18 ms. El prefijo se adjuntó, el ASR en vivo
empezó en 7000 ms y no hubo solapamiento repetido ni inicios duplicados.
Se completaron tres voces del prefijo y once en vivo.

La primera señal llegó a los **4,980 s desde activar**; excluye los 15,673 s
de preparación previa. El medidor de producción confirmó catorce voces
completas y catorce con señal, con primera señal a los 4,8334 s desde su
reloj de captura. Los desfases de inicio respecto a la imagen estuvieron
entre **−23 y +19 ms**. Diez intervalos usaron límites parciales estimados
del ASR y cuatro límites de turno. Estas medidas no prueban alineación
semántica de cada palabra.

No hubo recuperación del audio original, voces publicadas perdidas dentro
de la cobertura completada, interrupción de fuente ni error de decodificador.
La imagen llegó al segundo relativo 31,741814; la captura, al 41,280.
El contador `recorder_gap_recoveries` fue cero, tanto en el informe original
como en el saneado: no se ejercitó una recuperación contada de hueco.
La siguiente voz llegó a iniciarse, pero sin señal o finalización guardadas;
no amplía la cobertura completada. La parada desde WorkSpace y la escucha
física no quedaron verificadas en este ensayo.

## Comparación sin atribución causal

| Medición | Ensayo 055, 1793812104387 | Ensayo 057, 1793813320346 |
| --- | ---: | ---: |
| Preparación previa del prefijo | 14,230 s | 15,673 s |
| Ancla de captura | 19 ms | 18 ms |
| Voces completas con señal | 13 | 14 |
| Cobertura relativa completada | 31,620 s | 31,700 s |
| Primera señal desde activar | 5,120 s | 4,980 s |
| Retraso inicial del monitor | 4,288 s | 4,304 s |
| Retraso máximo | 11,515656 s | 9,559520 s |
| Crecimiento máximo | 7,227656 s | 5,255520 s |
| Reserva original fuera de canciones | 2,364539 s | 0 s |
| Aceptación | Falló | Falló |

El retraso máximo fue menor y no se recuperó el original en la nueva
cobertura. Las solicitudes remotas, las respuestas de ASR/MT y las duraciones
generadas no fueron idénticas entre ejecuciones. No es una comparación con
proveedores controlados y no aísla la contribución del ajuste de ritmo.
El resultado tampoco garantiza que otro recorrido evite plazos agotados.
La guía TTS observada llegó a 1,5; las velocidades de reproducción fueron
de 1× a 1,18×. Medir señal y duración no certifica que esa nueva combinación
resulte natural al oído.

Las categorías de catálogo de las catorce voces completas fueron **dos
masculinas y doce femeninas**. El prefijo fue femenina, masculina, femenina;
la fase en vivo completó una masculina y diez femeninas. Se conservan
`public_speaker_match_verified=false` y `physical_listening_verified=false`.
Estos recuentos no prueban cuántas personas hablan ni resuelven la queja
de atribución al presentador masculino. Tampoco hubo canciones preparadas
u omitidas; el filtro de canciones no se ejercitó en este recorrido.

## Correlación y consumo

Por primera vez en estos ensayos, el protocolo conserva índices numéricos
por solicitud. Hay 172 eventos con índice, repartidos entre diecisiete
segmentos, sin identificadores originales, texto ni audio. Se observaron
diecisiete inicios e intentos MT y dieciséis primeros textos y finales MT;
dieciséis solicitudes TTS, quince finales TTS y quince voces publicadas.
No hubo evento explícito de error u omisión MT en el informe. Los trabajos
anticipados aún pendientes al detener el banco no se convierten en voces
completadas. Esta correlación permite investigar esperas sin reconstruirlas
a partir de un orden concurrente ambiguo; no es prueba de calidad por sí sola.

El estado terminal completo
`tmp/selected-video/lab-consumption-49202-057.json` confirma:

- Una sesión de relay y una preparación de prefijo.
- Muse: un batch inicial y un flujo en vivo con acuse y entrada iniciada.
- MT: tres intentos del prefijo y catorce en vivo, más una traducción
  anticipada de subtítulos.
- TTS: tres solicitudes del prefijo y trece en vivo.
- Prosodia: dos intentos de conexión del prefijo y cinco en vivo.

El importe facturado, el uso remoto de GPU y el tráfico incidental total
son desconocidos. La revisión retrospectiva no repitió pruebas ni abrió
nuevas inferencias. Se conserva una auditoría numérica en
`tmp/selected-video/prefix-continuity-audit-1793813320346.json`, sin medios,
transcripciones ni credenciales originales. La
[matriz de aceptación vigente](traduccion-auditiva-aceptacion-057.md) conserva
el alcance completo y los requisitos pendientes.
