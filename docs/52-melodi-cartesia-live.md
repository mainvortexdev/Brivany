# 52. Voz live de Melodi con Cartesia en español e inglés

30 de octubre de 2026. Integrado en el servidor principal:
<http://127.0.0.1:8765/app>. El usuario realizará la prueba física del modo live.
No se ejecutaron nuevas síntesis pagadas ni se usó su micrófono durante este
cambio. Los resultados simulados siguientes no sustituyen esa prueba.

## Ruta e IDs solicitados

```text
Micrófono autorizado → Muse Voice Transcribe
  → Muse Spark (conversación incremental y frases)
  → Cartesia Sonic 3.6, voz elegida por idioma
  → PCM16 mono 24 kHz → reproductor del navegador
```

| Idioma de salida | ID exacto indicado por el usuario |
|---|---|
| Español | `3597a26f-80ef-4bd5-8101-9699bc764917` |
| Inglés | `db6b0ed5-d5d3-463d-ae85-518a07d3c2b4` |

Los IDs se fijan en `packages/providers/cartesia_melodi.py`. El navegador envía
`language: es` o `en` a `/api/voice/speech`, nunca una clave ni un ID arbitrario.
La API también acepta es-ES, en-US y en-GB como alias y rechaza otros idiomas y
overrides de proveedor/voz. Las solicitudes antiguas sin idioma siguen usando
español. La clave local es `BRIVANY_CARTESIA_API_KEY`, que ya estaba configurada;
no se vuelve a solicitar ni se copia a la UI/bitácora.

Se usa el WebSocket de Cartesia con API `2026-08-14` y modelo fijado
`sonic-3.6-2026-08-27`. Cada frase explícita tiene un único `context_id` y una
petición `continue: false`. Los eventos JSON con PCM base64 se decodifican en el
servidor y se transmiten progresivamente por la respuesta HTTP local en PCM sin
contenedor. No se descargan WAV ni se conservan transcripciones/audio. No se
abren conexiones de proveedor al cargar la página; solo al pedir voz.

El lector expone `read1`, conserva muestras completas, valida contexto/formato,
y traduce los errores a mensajes fijos sin copiar el cuerpo del proveedor. Tiene
timeout de apertura, de inactividad y protección de tamaño de una frase; no añade
cuotas de sesión o inicios diarios. No reintenta ni cambia a Cloudflare si falla.

`live_voice.open_melodi` delega ahora en Cartesia y `voice_status().tts` publica
proveedor, voces por idioma y configuración. No declara acceso real verificado.
El módulo conserva los helpers Cloudflare que necesitan los adaptadores
históricos; la voz principal ya no depende de esos secretos.

## Live y selección de idioma

- La opción remota de la UI se llama **Melodi · Cartesia · Español / English**.
  Se mantiene la elección explícita de voces locales del sistema.
- El idioma de escucha determina la voz remota de la conversación y de la vista
  previa. Elegir el modo Inglés selecciona en-US; la vista previa usa texto en
  inglés. Las frases de apoyo en inglés también usan el ID inglés de Cartesia.
- El idioma se pasa hasta `MelodiOutput` y la API de síntesis. Antes, la ruta
  remota solo se elegía al hablar español y el inglés caía a una voz local.
- `ConversationRequest` admite `language`, con es por defecto. El prompt conserva
  la identidad e instrucciones de Melodi y añade la salida del idioma del turno.
- El modo Inglés admite ahora respuesta a un final de Muse tras la pausa, además
  de sus frases de apoyo; el modelo recibe inglés y TTS recibe el mismo idioma.
  Las reuniones permanecen silenciosas salvo que el usuario pida escuchar apoyo.
- Al cambiar modo o idioma durante escucha se detiene la sesión actual y se
  requiere Comenzar de nuevo. Una respuesta iniciada no cambia de voz a mitad.
- Los avisos de envío de texto en Melodi, Sous y el asistente espacial nombran
  Cartesia. Sous y el asistente conservan salida en español por defecto y sus
  controles de consentimiento. Las voces de traducción de videos siguen siendo
  independientes de estos dos IDs de Melodi.

El identificador interno antiguo `melodi-cloudflare` se acepta como alias por
compatibilidad de clientes en memoria, pero también llama la nueva API Cartesia;
la UI vigente solo ofrece `melodi-cartesia`. La caché de interfaz pasa a v39 para
actualizar assets. No se persisten permisos de micrófono ni se activan por abrir.

## Interrupción y ritmo

El reproductor conserva PCM por bloques, pausas entre frases y preparación de la
siguiente frase tras el EOF anterior, sin peticiones TTS simultáneas. Su cola de
audio programado sigue acotada. El control de ritmo existente modifica la
velocidad del reproductor; no se envía a Cartesia ni cambia el ID de voz.

Interrumpir aborta el fetch, detiene las fuentes programadas y descarta audio
tardío. El handler HTTP observa la desconexión del cliente durante una lectura
de Cartesia: cierra el contexto, envía `cancel` y libera el slot de síntesis,
incluso si todavía no llegó el primer audio. No hay un retry de esa frase.
Durante la voz, el micrófono envía silencio al ASR y se descartan turnos tardíos
asociados a la salida, como en el recorrido anterior; se verifica la lógica con
señal sintética, no el aislamiento físico del altavoz.

## Verificación ejecutada

| Suite | Resultado y alcance |
|---|---|
| `tools.verify melodi-cartesia` | 17 pruebas locales: dos IDs/idiomas exactos sobre WebSocket loopback, formato y orden PCM, error sin retry, voz no reemplazable por cliente, cancelación antes de audio, HTTP real y contratos de ASR/conversación |
| `tools.verify javascript` | 45 pruebas correctas; idioma inglés y español por defecto enviados a la API, reproducción por frases, PCM partido, prefetched cancelado y captura/echo simulados |
| `tools.verify live-ui` | recorrido de navegador con micrófono/ASR/Meta/TTS sustituidos; español, preview inglés y final live inglés → petición de conversación inglesa → síntesis inglesa; interrupción, silencio durante respuesta y reunión silenciosa |
| `tools.verify http` | 23 pruebas correctas de la API compartida, incluida liberación del slot antes del EOF de síntesis |
| `tools.verify sous-voice` / `sous-voice-pipeline` | 8 pruebas y recorrido de navegador/contexto reales con proveedores y micrófono sustituidos |
| `tools.verify spatial-assistant` / `spatial-assistant-ui` | 15 pruebas y recorrido textual/estado real con modelo sustituido; no mide voz espacial física |
| `tools.verify river-translation` | 13 pruebas de regresión del traductor existente, con proveedores/dispositivo sustituidos |
| HTTP de la instancia principal | Cartesia configurado, ambos IDs y HTML actualizado comprobados sin abrir sesión de proveedor |

El recorrido `live-ui` observó los idiomas TTS `es, en, en` y un turno de modelo
en inglés. El test del backend recorre los eventos reales del protocolo mediante
un servidor Cartesia sustituto, mientras que el test de UI sustituye la salida
de la API local. No se presenta como una llamada al proveedor real.

**Consumo de esta implementación y verificación:** cero llamadas externas de
inferencia/síntesis de proveedor. Las consultas de documentación no acreditan
acceso a las voces del usuario. No se comprueba la calidad de pronunciación,
prosodia, reconocimiento, timbre, latencia audible, micrófono/altavoz físico ni
acceso/saldo real del ID español. La prueba física queda al usuario, conforme
a su última indicación; no se ejecutó el ensayo real inicialmente propuesto.

El servidor principal de 8765 se reinició con el cambio. Debe recargarse la
pestaña `/app` para cargar el nuevo JS. En Ajustes, seleccionar Melodi/Cartesia,
activar voz y transcripción de Muse, elegir idioma y pulsar Comenzar. Estos
controles no se marcaron automáticamente en la sesión del usuario.

Evidencias sanitizadas: `tmp/melodi-cartesia-local.json`, informes de
`docs/verification-history/`, pruebas de protocolo en `tests/test_cartesia_melodi.py`.
No se adjuntan claves ni conversaciones, audios o imágenes de la sesión privada.

Contrato oficial consultado:
[Cartesia TTS WebSocket](https://docs.cartesia.ai/api-reference/tts/websocket) y
[Sonic 3.6](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest).
