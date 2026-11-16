# Melodi: llamadas telefónicas desde la nube

14 de noviembre de 2026. Continuación del hito de WhatsApp, con una corrección de
dirección solicitada por el titular: retirar WhatsApp Calling y usar Telnyx para
las llamadas telefónicas, incluso con el PC apagado. El chat de WhatsApp conserva
los pedidos, las cancelaciones y las aprobaciones. El código canónico reside en
`workers/calls/` dentro de Brivany.

## Implementación

`brivany-calls` usa un Durable Object SQL por propietario. Las alarmas persisten
el horario; no dependen de cron, del sondeo del PC ni de un túnel local. Se reutiliza
la aplicación y el emisor Telnyx existentes, con webhook y audio por llamada en
`ia.vetsa.es`. No se modifica el webhook global del proveedor ni se compra un
número. El servicio tiene `workers_dev=false`; su administración usa RPC privados.

Los objetivos se cifran con AES-GCM y los eventos Telnyx requieren firma Ed25519,
fecha reciente, coincidencia de cuenta, emisor, destinatario y reserva. Un POST
incierto no vuelve a marcar. Hay hasta diez reservas, horizonte de treinta días,
una llamada simultánea y noventa segundos máximos por llamada; silencio y fallos
de comunicación tienen límites de quince segundos. La sesión se interrumpe al
perder su estado de voz; no reproduce una conversación después de reiniciar.

La voz se genera únicamente en Cartesia: voz seleccionada de Melodi
`3597a26f-80ef-4bd5-8101-9699bc764917`, modelo `sonic-3.6-2026-08-27`, versión de API
`2026-08-14`. No hay sustitución por una voz predeterminada ni por TTS de Telnyx.
Telnyx recibe PCMU 8 kHz; el audio entrante se convierte a PCM mono 24 kHz para
Muse. El acuse de reproducción pertenece a Telnyx; no acredita escucha humana.

La llamada puede pedir una tarea, consultar su estado o cancelarla en el PC
vinculado. El enlace privado `MelodiPhoneDesktop` mantiene el propietario, la
cuenta, la llamada y la identidad de cada pedido. La instrucción enviada es la
transcripción actual, sin permitir que el modelo amplíe sus argumentos. Las
aprobaciones concretas conservan el mecanismo de WhatsApp. Para actuar en el PC,
Brivany debe estar abierta; la conversación y la programación viven en la nube.
Esta primera activación queda limitada al titular original y su propio número.

No se guardan audio ni transcripciones en el servicio de llamadas. Los recibos
operativos contienen estado, motivo, contadores y metadatos de protocolo, sin
texto de conversación. Los datos de tareas del ordenador conservan el cifrado
y las reglas del puente de escritorio existente.

## Pruebas y correcciones

Las pruebas locales abarcan RPC, SQLite persistente, alarmas y WebSockets del
motor workerd real, con Telnyx, Muse, Meta y Cartesia sustituidos. El workerd
instalado admite fecha `2026-10-19`; producción usa `2026-11-14` y tiene además
comprobaciones reales. Pasaron 24 pruebas del servicio de llamadas, 361 del
servicio de WhatsApp, 13 del host y cinco del proxy del sitio en los recorridos
registrados por `tools.verify`.

La prueba del motor real detectó una invocación incorrecta de `fetch`, ausente en
los sustitutos de Node. Se corrigió con una función envolvente. También se corrigió
la exportación del nuevo entrypoint desde `worker-main.js`. Se conserva el registro
de los fallos iniciales. Una ejecución posterior falló por memoria de paginación
de Windows; se redujo la concurrencia y la suite pasó con ejecución secuencial.

Se encontró el archivo de vínculo local del operador con 502 bytes a cero,
ilegible por DPAPI. Se conservó su copia, se generó una credencial nueva para
la misma identidad vinculada, se retiró únicamente el dispositivo anterior y se
comprobó la lectura DPAPI y el latido del host. No se atribuye una causa no
demostrada a la corrupción. El cliente arrancó con `ready=true`, sin tareas
ocupadas; sus 23 archivos de actualización coincidían con el origen.

Las comprobaciones publicadas confirman Telnyx, la voz concreta de Cartesia,
almacenamiento SQL y el enlace al ordenador. Once solicitudes HTTP verifican
los bundles publicados, las rutas privadas, firma obligatoria y retirada de la
ruta de señalización de WhatsApp Calling. Esto no acredita una llamada PSTN.

La prueba funcional real usa una frase sintética y comprueba Cartesia, Muse,
transcripción y un diagnóstico de solo lectura del ordenador. Estos cuatro
tramos pasaron; la preparación de la respuesta del modelo falló inicialmente.
El intento de usar `reasoning_effort=none` fue rechazado con HTTP 400; se corrigió
según el [contrato de razonamiento de Meta](https://dev.meta.ai/docs/reasoning).
La comprobación posterior se limita al modelo para reutilizar los resultados
válidos de voz y ordenador y evitar repetir síntesis y diagnóstico.

La comprobación aislada posterior pasa con `minimal` y un presupuesto de salida
que incluye razonamiento: el proveedor devuelve `finish_reason=tool_calls`, una
única herramienta, 902 tokens de entrada y 303 de salida (1.205 en total). El
adaptador de esa prueba está sustituido; el modelo no ejecutó acciones en el PC.
El diagnóstico real del ordenador se verificó por su propio recorrido del puente.

Hubo síntesis e inferencia reales acotadas y lecturas administrativas de
proveedores, además de infraestructura y tráfico de fondo. El importe agregado
no se ha medido. Los contadores que el proveedor devuelve se conservan en los
informes depurados; no se declara consumo global cero.

El titular pidió una llamada real a su propio número y después indicó que no se
marcase hasta completar las comprobaciones. Hasta este registro no se ha marcado
ningún teléfono desde esta implementación. La prueba telefónica permanece
condicionada a ese resultado. Google continúa en la revisión que presentó el
titular; esta tarea no la vuelve a enviar ni la declara aprobada.

## Documentación del protocolo

[Tool calling de Meta](https://dev.meta.ai/docs/tool-calling),
[esquema Chat Completions](https://dev.meta.ai/docs/api-reference/chat-completions/schemas),
[mensajes administrativos de Cloudflare Queues](https://developers.cloudflare.com/api/resources/queues/subresources/messages/methods/push/).
Los diagnósticos de pago se reservan antes de ejecutarse y una reentrega de la
cola no los repite. No forman parte de las suites locales.

## Prueba telefónica posterior y corrección de espera

Tras pasar 24 pruebas de llamadas, 361 de WhatsApp, el modelo real y las
comprobaciones frescas de los cuatro servicios, se hizo un único intento
autorizado al titular. Telnyx registra `dial` a las 16:18:47 UTC, inicio a las
16:18:48 y fin a las 16:19:03, con causa `timeout`, origen `caller` y SIP 487.
No existe evento de respuesta. Voz, transcripción y pedidos al PC: cero.
La conversación y el control desde el teléfono no quedan verificados.

Se conserva el recibo interno inicial `media_disconnected`, junto a la
corrección basada en los eventos del proveedor. El informe depurado está en
`tmp/verification/phone-provider-events-20261114.json`: tipos de evento, fechas y
códigos; sin números, audio, transcripciones ni cuerpos originales.

Se amplía la espera a 45 segundos y se separa de los temporizadores de voz.
Los noventa segundos de conversación se controlan desde la respuesta. Un timeout
firmado antes de responder se muestra como «sin respuesta», aunque el socket se
cierre primero. Pasan tres regresiones adicionales: 27 pruebas de llamadas y
361 de WhatsApp, con salida 0. No se repite la llamada real.

Corrección publicada en `brivany-calls`, versión
`edf848da55f345d2a201bc8434702ba4`, y en WhatsApp, versión
`b9901cbfb71f47ac9537b1fbb0059b19`. Once comprobaciones públicas a las 16:31:40 UTC
confirman los cuatro bundles y la espera de 45 segundos. Se conservan recursos,
secretos y assets. El aviso actualizado en WhatsApp tiene recibo de entrega a las
16:31:53 UTC, sin reintento automático.

Tras el fallo de memoria de Windows se encontró Brivany cerrada, conservando el
nuevo vínculo cifrado íntegro. Se inició de nuevo y se verificó disponible, sin
tareas ocupadas, también después de las suites finales. No se establece una
causa de cierre que no haya podido demostrarse ni se certifica control gráfico.
El importe agregado no se ha medido. Queda pendiente que el titular atienda una
llamada para comprobar la conversación y el control del PC desde el teléfono.
