# Ensayo real con relleno exterior eliminado

El ensayo del banco 49208 completó quince voces con señal hasta el segundo
31,700 del video de Tecnonauta. Preparó siete segundos antes de activar,
continuó exactamente desde 7000 ms y completó tres voces del prefijo y doce
en vivo. No hubo solapamiento ni inicios repetidos. La preparación previa
duró 12,808 s y la primera señal llegó 6,362 s después de activar.

El ensayo volvió a fallar. El retraso inicial fue de 4,288 s, el máximo
10,608 s y el crecimiento 6,320 s, con los límites de 8 y 3 s. La recuperación
del original y las voces publicadas perdidas en la cobertura completada
fueron cero. La fuente continuó y no se registró un error explícito del
reproductor.

Se retiraron 1267,541 ms de relleno en las diecisiete voces publicadas y
1148,750 ms en las quince completadas. La medida describe PCM exterior
retirado, sin atribuirle una reducción equivalente del retraso. Los tiempos
MT de varias piezas crecieron a 4,125–4,954 s y la espera remota volvió a
dominar parte del recorrido. Los límites, la segmentación y los tiempos
remotos difieren de los ensayos anteriores.

Hubo nueve voces de catálogo femeninas y seis masculinas, cinco provisionales.
La correspondencia humana, la escucha física y el video completo siguen
pendientes. El recorrido no incluyó canciones. El modelo MT usado fue
Muse Spark 1.3, anterior a la comparación posterior de modelos.

El estado terminal registró una sesión de relay, una preparación, un ASR
batch y un flujo ASR en vivo. Hubo tres intentos MT del prefijo, dieciséis
en vivo y uno anticipado de subtítulos. TTS recibió tres solicitudes del
prefijo y quince en vivo. Prosodia abrió dos conexiones del prefijo y cinco
en vivo. Importe facturado, GPU y tráfico total permanecen sin medir.

Evidencias numéricas en `tmp/selected-video/inline-sync-1793826270224.json`,
`tmp/selected-video/lab-consumption-49208-071.json` y
`tmp/selected-video/padding-audit-071.json`. El informe conserva el resultado
fallido y únicamente datos de diagnóstico, sin medios originales.
