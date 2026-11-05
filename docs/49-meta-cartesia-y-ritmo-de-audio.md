# 49. Meta para traducir y regulación del audio de Cartesia

30 de octubre de 2026. Sustituye la ruta efectiva Groq/Qwen del
[hito 48](48-muse-llama-cartesia.md), cuyo ensayo y resultados históricos se
conservan. Página: <http://127.0.0.1:8767/translate>.

## Problema observado y alcance del diagnóstico

El usuario reprodujo voz real y recibió el error público
`native_audio_translation_backlog`: más de tres segundos de PCM pendiente.
El código anterior depositaba cada mensaje completo de Cartesia directamente
en el mezclador. Una generación más rápida que la reproducción podía superar
el límite en una ráfaga, incluso con un dispositivo que consume audio con
normalidad. La captura de pantalla no aporta telemetría del driver; no demuestra
que esa sea la única causa de retraso en el equipo del usuario.

La regresión local reproduce una condición suficiente para disparar el fallo:
dos paquetes consecutivos que contienen cuatro segundos de voz, sin tiempo
entre ellos. Se comprueba ahora con el mezclador real y un dispositivo simulado,
sin inferencia ni audio del usuario.

## Ruta efectiva

```text
YouTube / captura de pestaña autorizada
  → Muse Voice Transcribe (WebSocket, PCM16 mono 24 kHz / 80 ms)
  → prefijos estables y cola acotada
  → Muse Spark configurado en Meta (SSE, actualmente muse-spark-1.3)
  → texto traducido incremental
  → Sonic 3.6 en Cartesia (WebSocket)
  → entrega regulada al mezclador WinMM / altavoces locales
```

Muse Voice Transcribe documenta reconocimiento, parciales, turnos y hablantes;
no hay un parámetro documentado en ese contrato para traducir al idioma
seleccionado. Se mantiene como transcriptor y se usa Muse Spark de Meta para
traducir el texto antes de que Cartesia genere la voz. No se presenta como un
solo modelo de audio que traduce directamente. Cartesia recibe texto y devuelve
audio; no recibe el audio original para traducirlo.

Se reutiliza `MetaTranslationSession`, ya existente en el repositorio: endpoint
fijo `https://api.meta.ai/v1/chat/completions`, petición SSE por fragmento,
razonamiento `minimal`, contexto acotado de los dos últimos pares y texto de
origen en JSON de usuario no confiable. No usa herramientas, redirecciones,
proxy, retry ni fallback. La instancia conserva su conexión HTTP cuando el
proveedor permite keep-alive y permite cancelar una lectura mediante shutdown
del socket. Esta ruta le pasa un presupuesto máximo de **192 tokens por
fragmento**; el valor predeterminado de otros consumidores de este adaptador
sigue siendo 768. El truncamiento o respuesta incompleta detienen la sesión.

La disponibilidad depende de `BRIVANY_META_API_KEY`, `BRIVANY_META_MODEL`,
la clave de Muse y la de Cartesia. La clave Groq y su comprobación histórica
ya no participan en la disponibilidad ni se usan en este recorrido. No se
borró el secreto Groq de la configuración privada ni se modificaron otros
consumidores de Meta, Melodi, human-skills o los proveedores de `/dubbing`.

El footer y el aviso de envío ahora nombran Meta Spark y Cartesia. Se conservan
los tres botones y sus idiomas; cambiar idioma sigue cerrando la sesión y exige
iniciar otra explícitamente.

## Regulación sin aumentar el presupuesto

`NativeMixer.push_translation_paced` recibe un paquete validado de hasta tres
segundos, lo divide en frames de 20 ms y espera hasta que la cola de traducción
pueda aceptar otro frame sin superar **240 ms**. Usa el consumo real del
mezclador como señal, no una estimación del tiempo de generación. No descarta
PCM ni aumenta la cola general de tres segundos que siguen usando otras rutas.

La espera solo bloquea el receptor TTS; la entrada de audio y el receptor de
Stop siguen siendo concurrentes. La cancelación se comprueba a lo sumo cada
25 ms durante esa espera. Cerrar el dispositivo despierta al productor. Si el
dispositivo no consume a tiempo, vence el timeout de cuatro segundos por
paquete y la sesión se detiene con un diagnóstico de dispositivo detenido.
El timeout y el watchdog total siguen acotando la sesión.

Los 240 ms son **cola de aplicación**, no latencia total, ni el contenido de
los buffers WebSocket/red/proveedor, ni medición física del altavoz. El receptor
WebSocket conserva una cola acotada de cuatro mensajes y tamaño máximo por
mensaje; el envío de texto y los contextos de Cartesia siguen serializados por
fragmento. La traducción puede durar más que el original o quedar atrasada por
espera del modelo: se mantienen los límites de tres fragmentos pendientes,
cuatro segundos de antigüedad, seis segundos por cierre TTS y ocho segundos de
cierre general. No se promete traducción continua sin retraso para cualquier
velocidad del hablante.

Los límites de 30 s, tres reservas diarias, doce fragmentos, 2.400 caracteres,
45 s de salida y cero reintentos permanecen. No se reinició la cuota para hacer
pruebas. Al comprobar la instalación quedó **un inicio disponible hoy**.

## Verificación

| Suite | Resultado | Pregunta que resuelve |
|---|---|---|
| `tools.verify river-translation` | 11 pruebas correctas | Meta SSE sustituido en el relay, sin Groq, dos fragmentos/deduplicación, rechazo sin retry, Stop y ráfaga de cuatro segundos con mezclador real/dispositivo simulado |
| `tools.verify native-audio` | 13 pruebas correctas | La ráfaga conserva orden y muestras con cola ≤240 ms, Stop interrumpe espera, dispositivo bloqueado vence por timeout; regresiones WinMM con API sustituida |
| `tools.verify meta-translation` | 22 pruebas correctas | Contrato SSE, contexto/datos, cancelación, errores, presupuesto menor reenviado y presupuestos inválidos rechazados |
| `tools.verify river-ui` | recorrido correcto | HTTP, UI, AudioWorklet, idioma francés, controles y cierre con captura/YouTube/Meta/Cartesia/dispositivo sustituidos; sin desbordamiento a 390 px |
| `tools.verify http` | 23 pruebas correctas | Endpoints y seguridad local compartidos |
| HTTP de la instancia 8767 | correcto | Configuración efectiva Muse + Meta Spark + Cartesia, HTML sin Groq, límite de cola y cuota restante |

Son pruebas locales: **cero solicitudes de inferencia externas** durante este
cambio. Los proveedores y el dispositivo de audio fueron simulados. No se
ejecutó otro ensayo pagado para preservar el último inicio disponible al
usuario. No verifican calidad bilingüe, latencia física, eco ni la nueva
combinación con Meta Spark real. El ensayo real anterior de Groq en el hito 48
no se atribuye a esta nueva ruta.

El primer recorrido de prueba encontró que el servidor HTTP simulado cerraba
la conexión tras el primer fragmento. Se corrigió la fixture a HTTP/1.1 con
Content-Length/keep-alive para probar dos fragmentos en una misma conexión.
El fallo y la corrección quedan como resultados separados en la bitácora.

El servidor local de 8767 se reinició con el nuevo código y se comprobó por
HTTP. No se pudo recargar su pestaña mediante automatización: el control local
del navegador estaba desactivado en los ajustes de Work. El usuario debe
actualizar la pestaña para cargar el JS y los avisos vigentes; la URL no cambia.

Evidencias locales sanitizadas: `tmp/river-meta-local.json`,
`tmp/river-ui/browser.json`, informes de `docs/verification-history/` y pruebas fuente.
No se incorporó a la bitácora la captura del usuario, que contiene contenido
de su sesión, ni se adjuntaron secretos, texto reconocido o audio.

## Fuentes del contrato

- [Meta: Speech to text](https://dev.meta.ai/docs/speech-to-text)
- [Meta: protocolo realtime](https://dev.meta.ai/docs/api-reference/voice/realtime)
- [Meta: Chat Completions y salida incremental](https://dev.meta.ai/docs/protocols/chat-completions)

La documentación respalda los protocolos; el resultado de las pruebas locales
respalda el cambio de código dentro del alcance indicado.
