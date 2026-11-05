# 19. APIs para traducción y doblaje en vivo

Investigación de documentación oficial, 27 de octubre de 2026. Objetivo del producto:
doblaje continuo de video, nítido y con **máximo 500 ms de inferencia**. Ninguna cifra
comercial citada aquí demuestra todavía ese máximo para Brivany. No se ejecutaron
inferencias ni se crearon cuentas durante esta investigación.

## Decisión vigente

El usuario eligió **Palabra Speech-to-Speech** para la primera prueba real. La oferta
pública de $50 al registrarse motiva evaluar esa ruta, pero no se presupone que la
cuenta ya tenga ese saldo. Palabra permite una sesión de voz a voz por WS o WebRTC.
El relay servidor reutilizará el transporte PCM de Brivany, con un idioma de origen
y uno de destino explícitos. [API oficial](https://docs.palabra.ai/docs/streaming_api).

La ruta **`gpt-realtime-translate` de OpenAI permanece preparada como alternativa de
selección explícita**, sin fallback automático ni llamadas a ambos proveedores.
Su API interpreta audio continuamente y devuelve audio/texto; el proveedor recomienda
WebRTC para medios de navegador y admite WS para audio de servidor. La voz de Melodi
conserva su integración actual. [Guía OpenAI](https://developers.openai.com/api/docs/guides/realtime-translation).

La elección de Palabra no implica acceso configurado, créditos acreditados ni
presupuesto de latencia verificado. Antes del primer ensayo hay que guardar la
clave del proveedor elegido en el formulario local y comprobar su disponibilidad.

## Opciones comparadas

| Opción | Qué aporta | Latencia publicada y límite de interpretación | Coste publicado y papel propuesto |
|---|---|---|---|
| OpenAI `gpt-realtime-translate` | Audio → audio traducido y texto, continuamente; WebRTC o WS | La documentación consultada no publica un SLA de inferencia ≤500 ms | $0.034 por minuto de audio; alternativa preparada de selección explícita. [Modelo y precio](https://developers.openai.com/api/docs/models/gpt-realtime-translate) |
| Palabra Speech-to-Speech | Pipeline integral de transcripción, traducción y síntesis; WS o WebRTC | Publicita latencia inferior a un segundo; no demuestra ≤500 ms en Brivany | $0.04/min para S2S. Ruta elegida para el primer ensayo. [API](https://docs.palabra.ai/docs/streaming_api), [precio](https://www.palabra.ai/pricing) |
| Soniox STT+Translation → TTS | Dos WebSockets: tokens traducidos a síntesis incremental | Su documentación define el total como latencia STT/traducción más primer audio TTS; `max_endpoint_delay_ms:500` configura fin de turno, no un máximo de inferencia | STT equivalente aproximado $0.12/h; TTS $0.70/h generado. Traducción y contexto se calculan por tokens; no sumar las equivalencias como tarifa contractual de doblaje. [Pipeline](https://soniox.com/docs/translation/sts-translation), [precio](https://soniox.com/pricing) |
| Cartesia Sonic 3.6 | TTS expresivo en streaming; necesita traducción previa | La página comercial anuncia primer audio/modelo inferior a 90 ms; es una cifra TTS, no audio original → traducción hablada | Free: 20K créditos/mes; Pro: $5/mes y 100K. Candidato si se separan traducción y síntesis. [Sonic](https://www.cartesia.ai/sonic), [precio](https://www.cartesia.ai/pricing) |
| ElevenLabs Flash / Dubbing v2 | Flash sirve TTS rápido; Dubbing v2 adapta archivos y preserva características del hablante | Flash anuncia ~75 ms de inferencia para texto corto, excluyendo red y pipeline. El FAQ de Dubbing indica que doblaje live no está disponible | Flash podría ser la etapa TTS de una cadena; Dubbing v2 corresponde a trabajo de archivos. [Latencia](https://elevenlabs.io/docs/eleven-api/concepts/latency), [Dubbing](https://elevenlabs.io/docs/overview/capabilities/dubbing) |

Los precios son referencias públicas en USD de la consulta, sujetos a plan,
región, cambios, impuestos y uso real. No se ha comprado ni activado ninguno de
estos servicios como parte de la investigación.

## Comprobación de las ideas aportadas

**Cartesia:** la documentación vigente presenta Sonic 3.6 como GA con 44 idiomas,
incluidos inglés y español, y snapshot estable `sonic-3.6-2026-08-27`. Sonic 3.5
permanece como modelo anterior, con snapshot `sonic-3.5-2026-05-04`. Conviene fijar
snapshot cuando se ensaye para poder reproducir una comparación.
[Sonic 3.6](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest),
[modelos anteriores](https://docs.cartesia.ai/build-with-cartesia/tts-models/older-models).

El precio Free de 20K créditos y Pro de $5 está confirmado en la página consultada.
Esa página estima ~27 y ~133 minutos TTS respectivamente; 1 crédito equivale a un
carácter, con estimaciones dependientes del texto. La licencia comercial aparece
desde Pro. El plan gratuito es útil para evaluación y no debe interpretarse como
una licencia comercial o un presupuesto de traducción completa.
[Detalle de planes](https://www.cartesia.ai/pricing).

**ElevenLabs:** el número ~75 ms corresponde a inferencia TTS Flash sobre entradas
cortas, excluye red y añade el resto de la cadena. La versión actual Dubbing v2
tiene API para crear proyectos de archivos y generar sus pistas; que exista API
no implica que sea una API de doblaje live. El FAQ lo descarta expresamente a la
fecha de consulta. [Definición de latencia](https://elevenlabs.io/docs/eleven-api/concepts/latency),
[FAQ de Dubbing](https://elevenlabs.io/docs/overview/capabilities/dubbing).

**Rask:** la API v2 documenta carga de medio, creación de proyecto, consulta de
estado y descarga. Esa ruta es apropiada para localización de archivos; no se
encontró en ese flujo un transporte de audio live ni una garantía de 500 ms.
[Workflow oficial](https://docs.api.rask.ai/workflow/translation).

**Palabra:** su precio anuncia subsegundo, que no equivale a ≤500 ms ni a una
garantía contractual para esta aplicación. La configuración documentada contiene
una cola predeterminada de 5000 ms, con ajustes de tempo. Antes de un ensayo hay
que revisar esa política; el transporte WS recomienda paquetes de audio de 320 ms.
[Ajustes](https://docs.palabra.ai/docs/streaming_api/translation_settings_breakdown),
[mensajes y transporte](https://docs.palabra.ai/docs/streaming_api/management).

La página de precios también anuncia **$50 de créditos gratuitos al registrarse**.
Es una oferta pública pendiente de comprobar en la cuenta del usuario, no un saldo
ya obtenido ni una concesión del hackatón. Puede hacer de Palabra una primera
alternativa económica para comparar cuando haya acceso; no cambia el estado de
latencia sin verificar. [Oferta pública](https://www.palabra.ai/pricing).

**Azure:** Speech Translation y Live Interpreter son otras rutas oficiales de
audio a audio. El segundo está orientado a traducción continua y conservación de
estilo/tono; requiere un recurso de cuenta y verificar región, idiomas y precio.
No se adopta un máximo de 500 ms a partir de la expresión “low latency”.
[Resumen oficial](https://learn.microsoft.com/en-gb/azure/ai-services/speech-service/speech-translation).

## Lo reutilizable de Meta y Cloudflare

Brivany ya dispone de un relay Muse y síntesis Cloudflare. Se podría formar una
cadena Muse → traducción de texto → Aura-2. Cloudflare ofrece el modelo Meta
`@cf/meta/m2m100-1.2b`, con entrada `text`, `source_lang` y `target_lang`; publica
$0.342 por millón de tokens de entrada y de salida. Es traducción de texto por
petición, sin una garantía publicada de 500 ms para la cadena completa.
[Modelo oficial](https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/).

Esta posibilidad evita exigir una cuenta adicional para una prueba funcional,
pero sus tres etapas acumulan espera. Los resultados previos de voz de Brivany no
certifican el nuevo objetivo. No conviene gastar créditos en comparaciones entre
todas las combinaciones antes de validar una ruta continua.

## Protocolo Palabra de la ruta elegida

El servidor conecta al endpoint WS Speech-to-Speech de Palabra y envía `set_task`.
La configuración indica `pipeline.transcription.source_language: "en"` y una entrada
en `pipeline.translations` con `target_language: "es"` y síntesis habilitada. Entrada
PCM16 a 24 kHz y salida PCM16 mono a 24 kHz; el producto se identifica localmente
como `speech-to-speech`, no como un checkpoint de modelo propio.

Antes de mandar audio hay que recibir `task_status` de `set_task` en estado
`running`. Se envían mensajes `input_audio_data` con PCM en base64; el proveedor
recomienda 320 ms a ritmo real. La salida `output_audio_data.data.data` contiene el
audio traducido. Para finalizar se usa `end_task` y se drena hasta `end_of_stream`.
[Quickstart oficial WS](https://docs.palabra.ai/docs/quick-start/websockets).

El campo opcional `chunk_generation_delta` expresa milisegundos desde que comenzó
la generación TTS hasta ese bloque. La primera muestra puede describir el primer
chunk de síntesis, pero excluye ASR, traducción, red y reproducción: nunca se usa
para declarar el objetivo de inferencia total de 500 ms cumplido. El adaptador
lo transmite como `tts_chunk_generation_ms` y el ensayo conserva solo su primera
muestra numérica. [Definición oficial del campo](https://docs.palabra.ai/docs/streaming_api/management#output_audio_data).

## Protocolo OpenAI que debe seguir el adaptador

Endpoint de servidor:

```text
wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate
Authorization: Bearer <clave solo en servidor>
```

La secuencia es abrir, recibir `session.created`, configurar el idioma con
`session.update` y esperar `session.updated`. Se envía audio con
**`session.input_audio_buffer.append`**, no con el evento del Realtime
conversacional. No se llama a `response.create`.
[Guía de conexión y ciclo](https://developers.openai.com/api/docs/guides/realtime-translation).

```json
{"type":"session.update","session":{"audio":{"output":{"language":"es"}}}}
```

```json
{"type":"session.input_audio_buffer.append","audio":"<PCM16 base64>"}
```

El audio de entrada WS es PCM16 mono little-endian de 24 kHz. El motor consume
frames de 200 ms; el proveedor recomienda enviar paquetes de esa duración,
incluyendo silencios mientras la sesión esté activa. Al terminar se manda
`session.close` y se drena hasta `session.closed` para no perder el final.
[Eventos de cliente](https://developers.openai.com/api/reference/resources/realtime/translation-client-events).

| Evento de salida | Tratamiento en Brivany |
|---|---|
| `session.output_audio.delta` | Base64 PCM16; comprobar formato/canales/sample rate y reproducir la longitud completa del bloque |
| `session.output_transcript.delta` | Añadir texto traducido sin insertar espacios incondicionalmente |
| `session.input_transcript.delta` | Transcripción original opcional; solo existe si se configura un modelo de transcripción de entrada |
| `session.updated` | Confirma el cambio de configuración |
| `session.closed` | Fin de salida, permite cerrar el transporte |
| `error` | Fallo real; no sustituir por texto/audio de demostración |

`elapsed_ms` puede acompañar deltas y sirve para alineación del stream, con pasos
de 200 ms. Varios eventos pueden compartirlo: no es identificador, tiempo de
inferencia ni correspondencia semántica palabra a palabra. Deduplicar por un ID
real, no por `elapsed_ms`. Los bloques de audio pueden tener tamaños distintos.
[Eventos de servidor](https://developers.openai.com/api/reference/resources/realtime/translation-server-events).

La primera ruta no crea ni solicita voces clonadas. La configuración consultada
ofrece idioma de salida, no un `voice_id` de Celeste. Por ello no se promete que
el timbre del intérprete coincida con la voz actual de Melodi. La transcripción
original opcional queda desactivada en el ensayo mínimo para evitar añadir otro
modelo y un coste no medido.

## Medición y criterio de 500 ms

Las siguientes son decisiones de instrumentación de Brivany, no garantías del
proveedor:

| Medida | Qué debe significar |
|---|---|
| `inference_ms` | Tiempo interno declarado por el proveedor con definición verificable; `null` si no está expuesto |
| `connection_ms` | Tiempo de apertura y configuración de sesión |
| `first_audio_from_first_input_ms` | Primer PCM recibido menos primer audio enviado; incluye acumulación de contexto y red |
| `playback_buffer_ms` | Audio programado aún pendiente de oírse en el reproductor |
| `media_alignment_ms` | Desfase respecto al reloj del video; solo cuando haya metadata suficiente, con su método documentado |
| `target_status` | `unverified` mientras la inferencia interna no pueda comprobarse; no convertir una medición distinta en cumplimiento |

Medir desde el paquete de entrada más reciente hasta cualquier salida puede dar
un número pequeño aunque la salida traduzca audio mucho más antiguo. Esa resta
no debe presentarse como latencia de traducción. Tampoco conviene llamar
“inferencia” al tiempo hasta primer byte o al límite de silencio de un ASR.

La calidad requiere revisar comprensión en ambos idiomas, cifras/nombres y
claridad audible sobre una muestra concreta. PCM a 24 kHz permite transportar
audio sin pérdida de un codec comprimido; no demuestra por sí solo naturalidad,
limpieza de ruido ni fidelidad al hablante. Las pruebas simuladas solo verifican
protocolo, cancelación, colas y medición.

## Primer ensayo real acotado

Una sesión, un idioma de destino y **hasta 20 segundos** de audio sintético o propio
autorizado con el CLI `tools.measure_dubbing`. La ruta Palabra usa una referencia de
$0.04/min; 20 segundos equivalen a aproximadamente **$0.0133 de servicio base**.
Si se selecciona OpenAI expresamente, su referencia de $0.034/min equivale a
aproximadamente $0.0113 para esa duración. El informe aplica el precio solo a la
pareja proveedor/producto prevista y conserva el coste real como desconocido.
[Palabra](https://www.palabra.ai/pricing), [OpenAI](https://developers.openai.com/api/docs/models/gpt-realtime-translate).

Estas referencias usan la duración de entrada: no son factura ni tarifa máxima.
El tiempo activo del servicio, la cola de salida, impuestos y otras funciones
pueden alterar el cargo efectivo. La oferta de créditos tampoco demuestra consumo
cero hasta revisar la cuenta.

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.measure_dubbing .\muestra-propia.wav --source en --target es --allow-paid
```

`--source` se usa con Palabra; si se omite, se toma inglés para destino español y
español para destino inglés. No admite origen igual al destino. La ruta OpenAI
omite ese campo. El CLI consulta primero el estado local, requiere una ruta
disponible y pide permiso explícito de ejecución con `--allow-paid`; no pertenece
a las suites gratuitas de `tools.verify`.

El ejecutor deberá limitar duración y concurrencia, cerrar al pausar/cancelar y
desactivar reintentos automáticos. Guardar en la bitácora configuración, tiempos,
consumo informado y límites, sin clave ni audio original. Una segunda prueba real
se justifica solo por un fallo concreto o una decisión pendiente que la primera
no resuelva. Mientras falten credenciales o evidencia, el objetivo de 500 ms
permanece abierto.
