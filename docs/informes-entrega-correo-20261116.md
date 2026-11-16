# Melodi lee los informes de entrega de correo · 16 de noviembre de 2026

Encargo del titular: que Melodi encuentre por sí misma el correo de informe que
Google envía sobre el dominio, abra su adjunto comprimido y diga en palabras
corrientes qué contiene. Se añade también la nota de voz por WhatsApp con su
voz y un ajuste de su forma de hablar. Todo vive en `workers/whatsapp`.

## Qué hace ahora

`mail-report-digest.js` abre el adjunto y lo traduce. Reconoce el envoltorio por
su contenido, no por el nombre: gzip, zip (almacenado o desinflado) y JSON suelto.
Comprueba la forma del informe agregado de TLS (RFC 8460) y normaliza sólo los
campos que se van a explicar. Convierte cada causa declarada en una frase
corriente —certificado vencido, el otro servidor no ofreció conexión protegida,
la norma del dominio no se pudo leer— con su recuento y el servidor afectado.
El texto resultante no contiene siglas, nombres de formato ni direcciones de los
servidores emisores. Distingue tres situaciones: sin fallos, fallos aislados y
mayoría de intentos sin proteger.

`mail-report-reader.js` localiza el correo sobre el buzón Gmail ya autorizado y
baja el adjunto. Devuelve siempre un estado explícito: `ready`, `not_found`,
`without_attachment`, `not_a_report` o `unreadable`. Un adjunto que no abre nunca
produce un resumen; se declara el hecho.

`gmail.read_report` es la herramienta de conversación. Con un identificador de
correo observado abre ese informe; sin él toma el más reciente del buzón. Usa la
intención y el permiso de lectura de correo que ya existían, así que no amplía la
autoridad de Melodi ni pide un consentimiento nuevo de Google.

`mail-report-watch.js` es el aviso automático. En cada tick programado consulta
los informes llegados desde la última revisión y avisa una sola vez por informe;
la reserva se hace antes de enviar, de modo que un reintento no repite el mensaje
y un envío fallido lo devuelve a la cola. Si el buzón no está conectado, la marca
de revisión no avanza. El registro guarda identificadores y marcas de tiempo; no
guarda el correo ni el adjunto.

## Nota de voz

`melodi-voice-note.js` sintetiza una frase con la voz exacta ya seleccionada de
Melodi —la misma de las llamadas, comprobada contra `workers/calls/protocol.js`
por una prueba— y la envía como audio de WhatsApp. El texto se prepara para
oírse: se quitan marcas de formato y listas, y un enlace se sustituye por una
mención hablada. No reintenta: una síntesis incierta no debe producir dos notas.
La herramienta `message.voice_note` sólo se ofrece cuando la voz está
configurada, y la respuesta escrita sigue siendo la forma normal de contestar.

Limitación conocida: se envía como audio `mp3`. WhatsApp lo reproduce con su
control de audio, pero la burbuja de nota de voz propiamente dicha requiere
`ogg/opus`; esa conversión no está hecha.

## Forma de hablar

`melodi-identity.js` incorpora su identidad como asistente personal del titular y
una regla explícita de registro: contar lo que pasó y lo que significa, no cómo
se hizo por dentro; nada de nombres de herramientas, identificadores, códigos,
estados internos, formatos ni proveedores; traducir el dato técnico a su
consecuencia. `owner-turn-response.js` añade las frases naturales de los casos
nuevos para que un fallo tampoco se cuente con vocabulario interno.

La cota del catálogo que viaja en la inferencia pasa de 40 a 48 entradas. Estaba
exactamente en su límite y cualquier capacidad nueva lo rompía; no es un recuento
de herramientas instaladas.

## Comprobación con el buzón real

Se buscaron los informes en el Gmail del titular: nueve de
`noreply-smtp-tls-reporting@google.com` sobre `vetsa.es`, uno por día. Se
descargaron y abrieron tres adjuntos reales (5, 8 y 12 de noviembre), de 311
bytes cada uno, y el lector los reconoció, descomprimió y explicó sin cambios.
El contenido exacto del informe del 12 queda como prueba de regresión.

Tres detalles del formato real que no se conocían antes:

- El adjunto llega con el tipo propio `application/tlsrpt+gzip`. La detección
  se hace por el contenido del archivo, así que no hizo falta cambiar nada.
- El identificador del asunto usa puntos, no dos puntos:
  `<2026.11.12T00.00.00Z+vetsa.es@google.com>`. Se lee correctamente.
- La norma declarada de `vetsa.es` está en `mode: testing`. Un informe sin
  fallos no demuestra entonces que el correo viaje exigiendo protección: se
  observa y se reporta, pero se entrega igual. El resumen lo dice ahora en una
  línea aparte, tanto cuando no hay fallos como cuando los hay.

No se envió ningún correo, no se modificó ningún mensaje y no se cambió ninguna
etiqueta: sólo lectura y descarga de adjuntos.

## Comprobación

386 pruebas locales de la suite de publicación, todas en verde, con proveedores
simulados: `tools.verify melodi-whatsapp`. 25 son nuevas y cubren el informe
limpio, el informe con fallos, los fallos aislados, los tres envoltorios, el
adjunto manipulado, un adjunto que se expande hasta el límite, el correo que no
es un informe, el adjunto que no abre, el filtro por fecha, el aviso único, el
aviso agrupado, el reintento tras un envío fallido, el buzón sin conectar, la
igualdad de la voz con la de las llamadas, la preparación del texto hablado y el
recibo real del envío. 35 pruebas de `whatsapp-cloud` en verde. El bundle de
Wrangler se construye con `--dry-run`, sin publicar.

No se accedió a ninguna cuenta real de Google, no se envió ningún mensaje de
WhatsApp y no se sintetizó voz con el proveedor: todas las respuestas de
proveedor están simuladas en las pruebas. Consumo real: ninguno medido y ninguno
conocido en esta tarea. La lectura sí se comprobó con tres adjuntos reales del buzón
del titular, como se describe arriba; no se ha visto todavía un informe real con
fallos declarados, así que esa rama sólo está probada con datos construidos.

## Nota de voz nativa y publicación

La burbuja de nota de voz de WhatsApp exige un Ogg cuyo contenido sea Opus, de
un solo canal, y la marca `voice` en el envío. El proveedor de voz sólo entrega
`raw`, `wav` y `mp3`, así que la codificación se hace en el Worker:
`opus-encoder.js` instancia libopus compilado a WebAssembly (331 KB, licencia
MIT) sin runtime de emscripten, y `ogg-opus.js` construye el contenedor a mano
—tabla de lacing, suma de control, `OpusHead`, `OpusTags` y posición granular
con pre-salto—. Melodi pide ahora sonido sin comprimir a 48 kHz y arma el
archivo ella misma.

Comprobado con una síntesis real: 13,52 s, 40.794 bytes. `ffprobe` lo lee como
contenedor `ogg` con códec `opus`, un canal y 48 kHz; `ffmpeg` lo decodifica sin
un solo error y los niveles medidos (media −15,9 dB) confirman voz y no silencio.
Queda por debajo de los 512 KB a partir de los cuales WhatsApp deja de mostrar el
control de reproducción.

El publicador del repositorio adjuntaba un único archivo al formulario de subida.
Con dos módulos en el bundle, eso habría dejado al Worker sin resolver su
importación y lo habría tirado al arrancar. `deploy()` adjunta ahora todos los
módulos que el propio bundle nombra, comprobando que cada nombre es simple y está
dentro del árbol del proyecto, y los enumera en el informe de despliegue.

Publicado el 16 de noviembre: 56 bindings heredados en modo estricto, assets
conservados, los dos módulos subidos. Las dos rutas responden después de publicar.
La clave de voz no existía en el Worker y se añadió como secreto; sin ella la
herramienta ni siquiera se ofrece.

## Cómo se dirige al titular

El titular observó que a un «Hola Melodi» ella respondía «Hola, Brivany». La
causa no era el modelo inventando: el camino de respuesta autónoma le envía sólo
el mensaje y el reloj, sin ningún nombre verificado, y su voz sólo tenía la
prohibición negativa de no suponer nombres. Con un único nombre propio a la
vista, tomó el de la aplicación.

`melodiOwnerName(env)` resuelve el nombre desde la configuración y nunca desde el
mensaje —un remitente no puede renombrarse a sí mismo—, descartando saltos de
línea o texto que pudiera leerse como una regla. `melodiVoice(env)` le dice quién
le escribe y le pide usar su nombre cuando suene natural, no en cada frase. La
voz prohíbe además de forma expresa usar «Brivany», «Melodi» o «Vetsa» como
nombre de quien escribe. El nombre viaja como variable del Worker y como respaldo
en código, así que sale correcto incluso sin configuración, y es el punto donde
el alta pública lo resolverá por cuenta.

## Lo que sigue pendiente

El alta pública con un asistente de nombre y número propios por cuenta sigue sin
implementar; ver [identidad de los asistentes](identidad-asistentes-20261115.md).
La nota de voz como burbuja nativa queda como siguiente paso, igual que ver un
informe real con fallos para confirmar esa rama con datos del proveedor.
