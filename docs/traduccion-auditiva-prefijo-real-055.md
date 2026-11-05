# Prefijo reutilizado y continuidad real todavía insuficiente

4 de noviembre de 2026. El ensayo
`tmp/selected-video/inline-sync-1793812104387.json` comprobó en Brave aislado
la preparación de siete segundos antes de activar y el paso al ASR en vivo
desde ese límite. **El ensayo completo falló**: el retraso alcanzó
11,515656 s, creció 7,227656 s y hubo 2,364539 s de recuperación del audio
original en un tramo no clasificado como canción. Los límites de aceptación
siguen siendo 8 s de retraso, 3 s de crecimiento y 1 s de ese tipo de reserva.

## Lo que sí quedó comprobado

El banco 49201 registró la ejecución de 17:07:20,839 a 17:08:24,436 UTC.
Usó el video público de Tecnonauta, Brave aislado y proveedores reales,
sin perfil personal ni clonación. Se verificaron identidad y duración de
la fuente, sin anuncio y con reproducción de fuente a 1×.

La extensión envió 7040 ms de PCM y el backend limitó la preparación a
**7000 ms**. La preparación quedó lista antes de activar, después de
**14,230 s de trabajo transcurrido**, con tres intervalos de habla. El video
había avanzado a 14,328650 s antes de activar. Durante la preparación no
cambió su volumen, silencio ni selección. Al comenzar la captura del
doblaje se usó de nuevo el ancla de 19 ms. Por ello, el ensayo acredita
reutilización desde el inicio, no activación arbitraria sin retroceder un
video que ya ha avanzado.

El prefijo se adjuntó a la sesión y el ASR en vivo empezó en **7000 ms**.
El informe verifica límite exacto, cero solapamiento repetido y cero inicios
de voz duplicados. Completaron trece voces con señal: tres del prefijo y diez
en vivo, hasta el segundo relativo **31,620**, superando el mínimo exigido
de 31 s. Los desfases de inicio de las trece estuvieron entre −18 y +10 ms;
nueve intervalos usaron límites parciales estimados del ASR y cuatro límites
de turno. Es sincronía medida de inicio, no alineación de cada palabra.

La primera señal apareció a los **5,120 s desde activar**. Este tiempo se
mide después de disponer del prefijo: no incluye sus 14,230 s de preparación
previa. El medidor de producción confirmó trece voces completas y trece con
señal, y primera señal a los 4,929 s desde su reloj de captura. Las velocidades
de reproducción estuvieron entre 1× y 1,18×. No se observó interrupción de la
fuente ni error de decodificador. La imagen llegó al segundo relativo
31,743011 y la captura al 43,200.

El contador de producción `recorder_gap_recoveries` quedó conservado tanto
en el informe original como en el saneado: **cero**. Ahora hay una medición
explícita, y no prueba una rama de recuperación ejecutada. Los campos por
voz `recovered_gap` también son falsos. Una voz posterior se inició sin
señal y reprodujo sólo 0,090667 s; no cuenta como completada.

## Lo que impide aceptar el producto

El retraso inicial del monitor de imagen fue 4,288 s. Creció hasta
11,515656 s y terminó en 11,456989 s. Además, el reproductor recuperó audio
original entre los segundos relativos **13,080794 y 15,445333**, durante
2,364539 s. No era un tramo identificado como canción. No hubo voces
publicadas perdidas dentro de la cobertura, pero esa comprobación no
equivale a que todo el habla se tradujera: el intervalo de reserva original
sigue siendo un fallo de continuidad del doblaje.

Las categorías de las trece voces completas fueron **dos masculinas y once
femeninas**. El prefijo produjo femenina, masculina y femenina; la fase en
vivo completó una masculina y nueve femeninas. Son categorías del catálogo
emitido, no un recuento de personas ni prueba de correspondencia correcta.
El informe mantiene `public_speaker_match_verified=false` y
`physical_listening_verified=false`. El modelo local dio consejos femeninos
con confianza alta en dos turnos del prefijo; esa confianza no sustituye una
referencia humana del audio natural ni permite declarar resuelta la queja
del usuario sobre el presentador masculino.

Los tres intervalos preparados fueron habla. No hubo canciones preparadas
ni omitidas, por lo que este recorrido no comprueba la omisión de canciones.
Tampoco valida semánticamente emociones o fidelidad de la traducción. El
prefijo y la frontera de siete segundos quedaron comprobados en este
recorrido; asignación humana, continuidad y retraso siguen abiertos.

## Consumo y evidencia conservada

El estado terminal completo está en
`tmp/selected-video/lab-consumption-49201-054.json`. Confirma una sesión de
relay y una preparación de prefijo, con los siguientes intentos observados:

- Muse: un batch del prefijo y un flujo en vivo con acuse y entrada iniciada.
- MT directo: tres del prefijo y catorce en vivo, más una traducción anticipada
  de subtítulos.
- TTS: tres solicitudes del prefijo y trece en vivo.
- Prosodia: dos intentos de conexión del prefijo y cinco en vivo.

El trabajo anticipado excedió las trece voces que llegaron a completarse.
El importe facturado, el uso remoto de GPU y el tráfico incidental total son
desconocidos. La revisión retrospectiva no abrió nuevas inferencias ni repitió
pruebas. Se conservan métricas y códigos, sin PCM, video, transcripciones
o credenciales originales. La comprobación del prefijo no transforma este
resultado fallido en aceptación del producto integral.
