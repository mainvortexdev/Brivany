# 20. ElevenLabs: traducción continua y síntesis Flash

27 de octubre de 2026. El usuario eligió evaluar ElevenLabs después de las pruebas
Palabra. Este documento define la ruta técnica con fuentes primarias; no acredita
acceso a la API de traducción ni cumplimiento del máximo de 500 ms de inferencia.
La investigación no ejecutó inferencias ni realizó cambios de cuenta.

## Tres productos distintos

| Producto | Entrada y resultado | Aplicación en Brivany |
|---|---|---|
| Realtime Translation | Audio continuo → traducción hablada y subtítulos | Primera ruta ElevenLabs si la cuenta tiene acceso; **la referencia lo limita actualmente a workspaces Enterprise** |
| Flash v2.5 TTS | Texto → voz en streaming | Posible síntesis rápida dentro de una cadena con transcripción y traducción separadas |
| Dubbing v2 | Archivo/proyecto → pistas de doblaje | Localización de videos completos; no equivale al endpoint de traducción continua |

La existencia de Dubbing v2 o de una clave TTS no demuestra acceso a Realtime
Translation. El FAQ de Dubbing sobre ausencia de doblaje live se refiere a ese
producto; la documentación separada de Realtime Translation sí describe un WS
continuo Enterprise. [Realtime Translation](https://elevenlabs.io/docs/api-reference/realtime-translation/v-1-translation-realtime),
[Dubbing](https://elevenlabs.io/docs/overview/capabilities/dubbing).

## Conexión Realtime Translation

```text
wss://api.elevenlabs.io/v1/translation/realtime
xi-api-key: <clave solo en el servidor>
```

Los parámetros de consulta incluyen:

| Parámetro | Uso documentado |
|---|---|
| `target_language` | Obligatorio; código ISO de destino, por ejemplo `es` |
| `voice_id` | Obligatorio; voz de salida disponible para la cuenta |
| `source_language` | Opcional; si se omite, detección automática |
| `tts_model_id` | `eleven_flash_v2_5`, `eleven_v3` o `eleven_v4_turbo`; el último es el predeterminado |
| `eagerness` | `low`, `medium` o `high`; `high` comienza antes con menos contexto, `low` espera más |
| `input_format` / `output_format` | Formato de entrada/salida; la página los presenta como tipo abierto, sin una enumeración detallada de valores para este endpoint |
| `apply_text_normalization` | `auto`, `on` u `off`; valor predeterminado `off` |
| `enable_zrm` | Zero Retention Mode; disponible para Enterprise |
| `client_session_id` | Identificador definido por la aplicación |

La configuración candidata de baja latencia es `tts_model_id=eleven_flash_v2_5`
y `eagerness=high`, con voz de biblioteca apta para español y formato PCM que el
endpoint acepte. `pcm_24000` coincide con el formato usado por Brivany y aparece
en las APIs STT/TTS, pero su aceptación concreta en Realtime Translation debe
comprobarse en el primer ensayo; no se afirma que ya se haya verificado.
[Parámetros del endpoint](https://elevenlabs.io/docs/api-reference/realtime-translation/v-1-translation-realtime).

El `voice_id` elige la voz traducida. No conserva automáticamente la voz original
de cada hablante ni convierte una voz de Cloudflare en una voz ElevenLabs. Esta
fase usará una voz disponible de biblioteca y no necesita crear una clonación.
[Características y voces de Realtime Translation](https://elevenlabs.io/realtime-translation).

## Eventos exactos

Al abrir, el servidor anuncia `session_started` y un `status` con `started`.
La aplicación debe esperar el arranque antes de transmitir audio.

```json
{"message_type":"input_audio_chunk","audio_base_64":"<audio en base64>"}
```

El SDK oficial describe bloques recomendados de unos **100 ms**. Mantener ritmo
real e incluir el silencio de la fuente; no enviar un archivo entero tan rápido
como permita la red. La referencia documenta `queue_overflow` si se envía audio
con demasiada frecuencia.
[Payload en SDK oficial](https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/types/translate_input_audio_chunk_payload.py),
[WebSocket](https://elevenlabs.io/docs/api-reference/realtime-translation/v-1-translation-realtime).

| Mensaje del servidor | Tratamiento |
|---|---|
| `session_started` | Sesión inicializada; contiene `session_id` |
| `status` / `started` | Sesión lista |
| `partial_transcript` | Texto provisional de origen; reemplazar el parcial, no concatenarlo como si fuera definitivo |
| `final_transcript` | Texto final de un segmento original |
| `translation` | Texto traducido |
| `audio` | `data` en base64 y `sample_rate`; validar contra el formato de salida elegido |
| `status` / `stopped` | Traducción detenida y cierre del recorrido |

Para terminar la fuente:

```json
{"message_type":"end_of_stream"}
```

Continuar recibiendo la cola hasta el estado final, con timeout acotado. Cerrar o
cancelar debe vaciar también la reproducción local para no oír audio de una sesión
anterior. Las decisiones sobre cola, cancelación y límites son requisitos de
Brivany; no son una garantía de latencia del proveedor.
[Esquemas de mensajes](https://elevenlabs.io/docs/api-reference/realtime-translation/v-1-translation-realtime),
[tipos del SDK](https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/v_1_translation_realtime/types/receive_translate_stream_message.py).

## Acceso y errores

La referencia dice “Currently for enterprise workspaces only”. Una cuenta gratuita
o self-serve con TTS habilitado no demuestra ese acceso. La aplicación debe mostrar
el requisito antes de una prueba y tratar el resultado real de acceso sin pasar a
otro proveedor automáticamente.

Los errores WS documentados incluyen `auth_error`, `rate_limited`, `queue_overflow`,
`input_error`, `transcriber_error`, `translation_error`, `audio_output_error`,
`quota_exceeded`, `payment_issue` y `unaccepted_terms`. Algunos fallos por segmento
permiten que la sesión continúe; la primera prueba de Brivany puede abortar ante
ellos para no consumir créditos con una salida incompleta. La documentación del
WS no fija un código HTTP exclusivo que signifique “falta Enterprise”: no se debe
interpretar cualquier 403 como esa causa sin evidencia.
[Restricción y errores](https://elevenlabs.io/docs/api-reference/realtime-translation/v-1-translation-realtime).

Las claves admiten restricciones por endpoints, cuota e IP. El enum `PermissionType`
del OpenAPI público incluye `text_to_speech`, `speech_to_speech`, `speech_to_text`,
`models_read` y `voices_read`, entre otros, pero no un permiso llamado
`realtime_translation`. El OpenAPI REST tampoco describe el WS Translation. No
se deduce por ello qué scope lo habilita: `speech_to_speech` también se usa en
Voice Changer. Se debe revisar el permiso mostrado por la cuenta para esta función
y comprobar la autorización real. Para la cadena separada, los permisos pertinentes
son Speech to Text, Text to Speech y lectura de voces/modelos si se consulta el
catálogo. [Autenticación](https://elevenlabs.io/docs/api-reference/authentication),
[OpenAPI y PermissionType](https://api.elevenlabs.io/openapi.json).

## Ruta separada si no hay acceso Enterprise

La alternativa técnica es transcripción incremental (Scribe v2 Realtime o Muse ya
integrado) → traducción acotada (M2M100 o Spark configurado) → Flash v2.5. Requiere
una elección explícita de producto: no sería la misma API integral de traducción.
Cada etapa añade espera; los resultados de Palabra no predicen su latencia.

Scribe usa:

```text
wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_24000&commit_strategy=vad&language_code=en
xi-api-key: <clave en servidor>
```

Se envía `input_audio_chunk` con `audio_base_64`; aparecen `partial_transcript` y
`committed_transcript`. `commit:true` permite un commit manual cuando se use esa
estrategia. El parámetro `vad_silence_threshold_secs` controla la espera de silencio,
no el tiempo interno de inferencia. Mantener revisión de parciales antes de enviar
texto irreversible a TTS.
[Referencia Scribe Realtime](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime).

Flash TTS incremental usa:

```text
wss://api.elevenlabs.io/v1/text-to-speech/<voice_id>/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_24000&language_code=es
xi-api-key: <clave en servidor>
```

Inicialización y texto (ejemplo de protocolo; no se ejecutó):

```json
{"text":" ","voice_settings":{"stability":0.5,"similarity_boost":0.8,"speed":1}}
```

```json
{"text":"Texto ya traducido. ","flush":true}
```

```json
{"text":""}
```

El servidor devuelve `audio` base64, alineación cuando proceda e `is_final`. El
modo `auto_mode=true` reduce buffers, pero la documentación lo recomienda para
oraciones completas y advierte de calidad inferior con frases parciales. La cola
de texto tampoco debe empujar audio de una traducción que acaba de corregirse.
[TTS WS](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input),
[guía de buffering y flush](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts).

## Coste y criterio de éxito

La página pública consultada publica Flash/Turbo a $0.04 por 1000 caracteres y
Scribe v2 Realtime a $0.39/h. Son referencias de esos componentes y condiciones
de precio concretas, no una tarifa del endpoint Realtime Translation. No se encontró
una tarifa pública inequívoca de este endpoint Enterprise en esas páginas. El
presupuesto de una cadena separada debe sumar transcripción, traducción, síntesis
y condiciones de plan; los créditos gratuitos o de pago de la cuenta se comprobarán
antes de ejecutar.
[Precio API oficial](https://elevenlabs.io/pricing/api).

Flash anuncia aproximadamente 75 ms de inferencia para entradas cortas. El propio
proveedor explica que excluye red, procesamiento de aplicación y buffers; no es
un máximo por petición ni la latencia del doblaje completo. El esquema consultado
de Realtime Translation no expone tiempo interno de inferencia, por lo que
`inference_ms` debe permanecer `null` si no se recibe evidencia verificable.
[Definición oficial de latencia](https://elevenlabs.io/docs/eleven-api/concepts/latency).

Una primera prueba, cuando exista clave y acceso apropiado, debe resolver acceso,
formato y salida de voz con una muestra propia/sintética breve. Registrar sesión,
tiempo hasta primer audio desde la primera entrada, duración de salida y consumo
conocido. Un resultado funcional no certifica el objetivo de **500 ms** ni calidad
audible: ambas necesitan sus mediciones y revisión correspondientes. La traducción
de video sigue siendo una capacidad en implementación.
