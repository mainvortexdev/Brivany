# Corrección de cadencia y risitas

15 de noviembre de 2026. El usuario señaló vocales exageradamente largas en la
pregunta del doctor, pausas excesivas y pidió risitas suaves. El ajuste anterior
usaba `atempo` para llenar cada intervalo de la referencia: algunos factores
bajaban hasta 0,54. Conservar el tono no evitaba que las sílabas se alargaran.
Esta corrección sustituye ese procedimiento; no se modifica el registro anterior.

## Cambio implementado

El montaje conserva el PCM hablado a su velocidad nativa. Los fragmentos se
reutilizan comprobando voz y texto, sin volver a sintetizar las palabras ni
aplicar `atempo`. Los tiempos del diálogo se calculan después del audio real,
con un límite de relleno entre turnos: una duración incompatible produce una
explicación concreta, no vocales estiradas ni silencios largos para completarla.
Los fragmentos de un mismo turno tienen separaciones acotadas a 220 ms.

Se añade `laughter: before|after` al contrato de llamada. El adaptador sintetiza
`[laughter]` con la misma voz seleccionada del personaje, conserva una risita
corta completa terminando en un valle de energía, reduce su ganancia a 0,4 y
aplica bordes suaves. No cambia su velocidad ni introduce palabras «ja ja» en
el guion. El prompt limita estas intervenciones a peticiones expresas.

La revisión utiliza los 19 fragmentos hablados originales de Cartesia, las voces
exactas de Melodi y Dr. Esteban, y dos nuevas muestras de risa reutilizadas en
seis momentos de humor. El audio hablado suma 70,043 s y las risitas 6,934 s.
El relleno calculado por turno es 0,433 s: 80 ms antes y 353 ms después del
fragmento. Esto describe la colocación de archivos; contando sus respiraciones
y bordes silenciosos, la mayor pausa interna medida es 750 ms a −60 dBFS en
ventanas de 10 ms. No se confunden ambas medidas.

Se conservan el guion, el tono inicial, el efecto telefónico sutil, el fondo
negro, los nombres y el giro de los orbes. El contenedor mantiene exactamente
88,142948 s, H.264 1080×1920 a 60 fps y AAC. No se incorpora música.

## Verificación

- 31 pruebas de `call-visuals` pasadas: PCM hablado idéntico antes de la mezcla,
  silencios acotados, caché de voz, ausencia de cambios de tempo, risita suave y
  duración fraccionaria real. Informe
  `tmp/verification/call-visuals-20261115T235026-9964cb82.json`.
- Regresión `motion-social`: 49 casos, 47 pasados y dos omitidos por FFmpeg fuera
  del PATH del banco antiguo. Informe
  `tmp/verification/motion-social-20261115T235341-c2159f59.json`.
- Los 19 fragmentos del proyecto real se compararon completos con su PCM nativo;
  todos conservan las muestras y duración. Esto acredita ausencia de
  estiramiento, no calidad perceptual por sí solo.
  `tmp/call-native-voice-20261115.json`.
- Comprobación en Edge oculto de las 18 escenas: diferencia cero entre los
  trazados al cambiar de escena y giro máximo de 0,556° en 20 ms.
  `tmp/call-native-orb-continuity-20261115.json`.
- HyperFrames terminó sin errores ni advertencias. Se inspeccionaron cinco
  fotogramas del MP4 y FFprobe confirmó la duración y pistas. La medición de
  silencios está en `tmp/call-native-final-probe-20261115.json`.
- Dos revisiones de muestras sintéticas con Muse Spark 1.3, el modelo
  configurado, evaluaron la pregunta del doctor, habla de Melodi y las risitas.
  Ambas informaron cadencia natural, sin vocales estiradas ni artefactos, y
  reacciones semejantes a risa suave. Son inferencias consultivas de muestras,
  no una audición humana ni garantía de todo el video.
  `tmp/call-native-audio-advisory-current-20261115.json` y
  `tmp/call-native-audio-advisory-melodi-20261115.json`.

La primera consulta de audio al modelo 1.2 declaró no poder oírlo: no se cuenta
como revisión válida. Se conservó su resultado y se comprobó el catálogo del
modelo actual antes de las dos consultas útiles. Se ejecutó también un
clasificador acústico local, cuyos valores de risa resultaron ambiguos y no se
usaron para certificar naturalidad. No se subieron originales de referencia en
esta corrección, sólo muestras creadas por Cartesia.

El MP4 y el ZIP nuevos se guardaron en Creaciones de Melodi y se añadieron al
chat cifrado correspondiente tras el cierre normal. Desarrollo fue reabierto.
Se conservan las entregas previas. `tmp/call-native-delivery-20261115.json` y
`tmp/call-native-startup-20261115.json`.

Consumo nuevo conocido: dos síntesis Cartesia de 20 caracteres, tres solicitudes
de evaluación Meta —una sin evaluación válida— y tres consultas de catálogo.
No hubo nuevas síntesis de palabras, transcripción ni llamadas telefónicas.
Importe, tiempo GPU y tráfico de fondo no medidos. No se certifica escucha humana.

Fuentes técnicas: [controles de velocidad y risas de Cartesia](https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion)
y [entrada de audio de Meta](https://dev.meta.ai/docs/media-understanding).
