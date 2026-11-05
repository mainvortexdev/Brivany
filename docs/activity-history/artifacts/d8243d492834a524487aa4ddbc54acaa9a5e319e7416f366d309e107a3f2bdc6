# Medición real del último bloque de síntesis · 067

El ensayo diagnóstico 067 aprobó los límites de continuidad en una cobertura
de **17,453556 s** del video de Tecnonauta. Se pidieron 16 s de cobertura para
acotar el consumo de esta medición. Los límites de retraso máximo, crecimiento
y reserva de audio original siguieron en 8, 3 y 1 s, respectivamente. La prueba
de 31,460 s del ensayo 065 conserva su resultado fallido. El objetivo del video
completo y del perfil personal sigue abierto.

El banco integrado 49206 ejecutó la extensión en Brave aislado y usó proveedores
reales entre 19:27:23,341 y 19:28:06,840 UTC del 4 de noviembre de 2026. El
informe verificó los identificadores y la duración de 1495,781 s al abrir,
antes de activar y al terminar. La preparación anterior a la activación duró
13,688 s y utilizó siete segundos de los 7040 ms de PCM enviados. El prefijo
se adjuntó y el ASR en vivo empezó en 7000 ms, sin repetir inicios ni solapar
audio reconocido. El video había avanzado a 13,800659 s antes de activar.
La captura volvió al inicio y su ancla medida quedó en 22 ms.

Se completaron nueve voces con señal, tres del prefijo y seis en vivo. La
primera señal llegó a los **4,827 s desde activar**, aparte de la espera
previa del prefijo. El retraso inicial de 4,352 s creció 2,234667 s hasta un
máximo de **6,586667 s**. Los desfases de inicio de voz respecto a la imagen
fueron de −20 a +21 ms. Seis voces siguieron límites de turno y tres límites
parciales estimados por ASR. Las velocidades de reproducción estuvieron entre
1× y 1,18×. El medidor de producción confirmó las nueve voces completas y
una primera señal a los 4,5452 s en su reloj de captura.

En la cobertura completada se observaron cero voces publicadas perdidas y
cero recuperación del audio original. El contador de recuperación de huecos
fue cero. El informe no registró interrupción de fuente, error de decodificador,
error explícito de protocolo ni plazo de prosodia agotado. Se publicaron diez
voces. La décima empezaba en el límite final de cobertura y quedó fuera de las
nueve completadas. No se verificaron una parada desde WorkSpace ni canciones
omitidas en este recorrido.

Las nueve voces de catálogo fueron seis femeninas y tres masculinas. Dos de
las masculinas se marcaron provisionales. Esas categorías describen la salida
de la síntesis. Queda pendiente contrastarlas con hablantes reales de cada
intervalo, además de verificar naturalidad, fidelidad y escucha física.

## ¿Llegaba tarde el audio o el fin del contexto?

El diagnóstico 066 separa el tiempo desde solicitar síntesis hasta el último
bloque PCM y el que transcurre entre ese bloque y el fin del contexto. Los dos
campos numéricos quedaron registrados para las diez síntesis terminadas y se
conservaron en el informe saneado. [Instrumentación 066](traduccion-auditiva-arranque-066.md#medir-la-espera-de-síntesis).

| Medición | Solicitud a último bloque PCM | Último bloque PCM a fin de contexto |
| --- | ---: | ---: |
| Tercera voz del prefijo, 4,220–6,540 s | 688 ms | 0 ms redondeados |
| Máximo entre las diez síntesis terminadas | 891 ms | 31 ms |

El máximo de 891 ms correspondió a la primera voz del prefijo. El máximo
de 31 ms correspondió a la segunda. Las otras nueve síntesis registraron
cero milisegundos redondeados tras su último bloque. En este ensayo, la espera
medida de síntesis transcurrió principalmente antes de recibir todo el PCM.
La confirmación final no añadió una demora larga en ninguna de esas síntesis.
El ensayo 065 registró 3634 ms desde solicitar la tercera voz hasta terminar
su generación, sin los nuevos campos. Los datos de 067 no permiten asignar
retrospectivamente aquella espera a la llegada de PCM o a la confirmación.
La comparación queda limitada además por la variación de peticiones y cobertura.
[Ensayo 065](traduccion-auditiva-ensayo-065.md).

La tercera voz del prefijo siguió ocupando 3,439 s de reproducción para un
intervalo de 2,320 s, un exceso de aproximadamente 1,119 s. En este caso,
la duración de la voz seguía añadiendo retraso aunque el contexto de síntesis
terminara pronto. Los datos no establecen que el siguiente ensayo alcance los
mismos tiempos ni que el video completo mantenga esa continuidad.

## Consumo observado

El estado terminal confirma una preparación de prefijo y una sesión de relay.
Muse inició un batch de prefijo y un flujo en vivo con acuse y entrada de audio.
MT registró tres intentos directos del prefijo, ocho en vivo y uno anticipado
de subtítulos. TTS registró tres solicitudes del prefijo y siete en vivo.
Prosodia abrió dos intentos de conexión del prefijo y cuatro en vivo. Parte
del trabajo se anticipó fuera de la cobertura completada. El importe facturado,
el uso remoto de GPU y el tráfico incidental total son desconocidos.

Se conservaron `tmp/selected-video/inline-sync-1793820486802.json`,
`tmp/selected-video/lab-consumption-49206-067.json` y la auditoría numérica
`tmp/selected-video/tts-timing-audit-1793820486802.json`. La revisión usó esos
datos y una lectura local del estado terminal. No repitió el ensayo ni adjuntó
audio, video, transcripciones o credenciales originales.

La comprobación visual del banco integrado mostró «Prueba completada»,
primera señal a 4,83 s, nueve voces y captura de 640 × 360. También mostró
el prefijo de 7 s, seis voces en vivo, el retraso máximo redondeado a 6,59 s
y el crecimiento de 2,23 s. La captura de la interfaz quedó como observación
local y no se adjuntó a la bitácora.
