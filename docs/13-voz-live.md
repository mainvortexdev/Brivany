# Voz live: Muse y Melodi

27 de octubre de 2026. Esta integración sustituye la restricción de voz exclusivamente local de los documentos del primer hito. El usuario autorizó conectar los modelos y guardó su API key mediante el formulario local.

## Proveedores identificados

- Entrada: `muse-voice-transcribe-1.0`, Meta Model API. Es una integración nueva de Brivany, no procede de ProjectFixture.
- Conversación: `muse-spark-1.3`, disponible en el catálogo de la cuenta y comprobado con solicitudes reales. Identidad: Melodi. Brivany es la aplicación; no es el nombre del usuario.
- Salida: Melodi utiliza `celeste`, modelo `@cf/deepgram/aura-2-es` de Cloudflare Workers AI. Se comprobó en `ProjectFixture App/preview/voice-lab-data.mjs` y en el módulo `ProjectFixture-Intelligence/cloudflare-worker/live-voice.js` que referencia ese proyecto. ProjectFixture no se modificó.
- Inglés mantiene voz local inglesa explícita; Celeste es la voz española. No se presenta como traducción ni como clonación de una persona.

Referencias: [Muse speech-to-text](https://dev.meta.ai/docs/speech-to-text), [receta oficial](https://dev.meta.ai/docs/cookbook/voice-api-fundamentals), [Aura-2 ES](https://developers.cloudflare.com/workers-ai/models/aura-2-es/), [Cloudflare REST](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).

## Recorrido implementado

1. Comenzar abre el micrófono solo por acción del usuario. Un AudioWorklet produce PCM16LE mono a 24 kHz, en bloques de 80 ms. Adapta 44.1/48 kHz si el dispositivo no entrega 24 kHz.
2. Un WebSocket del servidor local recibe esos bloques y abre la conexión cifrada a `wss://api.meta.ai/v1/asr/realtime`. La clave aparece solo en el handshake del servidor a Meta. No se envía al navegador.
3. En práctica e inglés se usa `ENDPOINTING`; en reunión, `DIARIZATION`. Se esperan el acuse inicial y `speechComplete`; los parciales acumulativos reemplazan el texto anterior. Se correlacionan turnos superpuestos por `turnId` y se deduplican finales.
4. `/api/voice/turn` envía el texto y hasta 12 mensajes de historial efímero a Muse Spark. La salida NDJSON incluye texto incremental, frases y final. La primera frase puede pasar a `/api/voice/speech` antes de completar la respuesta. Cloudflare devuelve PCM progresivo; el navegador programa audio conforme llega. Recorta hasta un segundo de silencio inicial, conservando 40 ms antes de la actividad; las pausas internas se conservan. Si se desactiva «Conversar con Melodi», se usa la guía local.
5. Mientras habla Melodi, Muse recibe silencio PCM y se descartan los resultados de esos turnos, evitando realimentación. Interrumpir cancela el fetch, el audio ya programado y los segmentos pendientes. La interrupción es por botón, no una promesa de detección automática de voz superpuesta.
6. Terminar libera el micrófono y envía `endStream`, con una espera acotada para el último texto. Borrar, cambiar modo o salir cancelan inmediatamente y no conservan resultados tardíos.

La espera acústica tras una pausa usa medio segundo por defecto. Con Muse se conserva el silencio elegido por el usuario y no se añade otro margen después de `speechComplete`. Las reuniones nunca disparan voz automáticamente. La conversación con IA se activa en práctica; no se envían automáticamente los fragmentos de la reunión al modelo.

## Configuración y límites

Se requiere Python 3.11+ y `pip install -r requirements-h1.txt`. El `.venv` local ya incluye `websockets==15.0.1`. La API HTTP queda en 127.0.0.1:8765 y el relay ocupa un puerto loopback libre anunciado por `/api/status`; solo acepta el origen exacto del servidor. Hay una sesión Muse y una síntesis concurrente, buffers acotados, timeouts y cierre a los 55 minutos. No se reconecta automáticamente con audio perdido.

Variables:

La clave de Meta puede guardarse en el formulario local de ajustes («Conectar clave de Meta»),
o abriendo `/app?setup=meta`. El campo es de tipo password, se vacía tras enviar/cerrar y la
respuesta de la API solo confirma `saved: true`. Se escribe `.env` de forma atómica y se actualiza
el proceso actual; no hace falta reiniciar si se usa este formulario. No se envía al chat.

| Variable | Uso |
|---|---|
| `BRIVANY_MUSE_API_KEY` | Clave Meta para Muse; si está vacía, toma `BRIVANY_META_API_KEY` |
| `BRIVANY_CLOUDFLARE_ACCOUNT_ID` | Cuenta Cloudflare |
| `BRIVANY_CLOUDFLARE_API_TOKEN` | Token con permisos de Workers AI |
| `BRIVANY_CLOUDFLARE_USE_WRANGLER` | Solo desarrollo Windows: usar sesión local existente y refrescar con Wrangler si caducó |
| `BRIVANY_META_MODEL` | Modelo de conversación independiente; no necesario para transcripción y TTS |

Ni audio ni texto se registran en disco por el servidor. La PWA no cachea APIs. Las políticas de los proveedores externos siguen siendo independientes; no se promete retención cero en ellos. El benchmark guarda exclusivamente una frase de prueba sintetizada, nunca captura el micrófono.

El relay loopback es para desarrollo. Publicar la app móvil requiere HTTPS/WSS y autenticación del servidor, cuotas por usuario y gestión segura de secretos. No es un backend multiusuario ni permite usar el localhost del ordenador directamente desde un teléfono.

## Medir latencia

```powershell
.\.venv\Scripts\python.exe -m tools.benchmark_live --runs 5
node tools/measure_playback.cjs
```

El primer comando mide bloques PCM y el primer bloque con voz. Si hay clave Meta, envía una frase sintética a Muse al ritmo real y mide parcial/final. El segundo mide peticiones reales a Melodi y el instante de programación de voz audible en el navegador headless. Ninguno prueba altavoces físicos ni certifica conversación completa.

Los informes se guardan en `tmp/live-latency.json` y `tmp/playback-latency.json`. Hay que medir por separado captura, transcripción final, generación de respuesta, primer audio y reproducción. El tiempo al primer byte no equivale al momento en que se oye una respuesta. Cinco muestras son un diagnóstico inicial, no un SLA.

Medición inicial real desde este equipo, 27 de octubre de 2026: cinco frases de Melodi tuvieron 528 ms de mediana y 626 ms de máximo al primer bloque PCM. Otras cinco peticiones pasando por la app y el servidor local, con recorte del silencio inicial, programaron la primera voz en 879 ms de mediana y 1344 ms de máximo. Estas últimas incluyen red, servidor, Cloudflare y planificación de Web Audio, pero no hardware de salida, Muse ni generación de una respuesta con un LLM.

Pruebas conectadas: Muse reconoció correctamente tres muestras sintéticas; el final llegó 285–368 ms después de la última actividad de audio (umbral acústico de referencia, no timestamps de palabras). En la app completa, tres ensayos posteriores con Muse + Spark + Celeste programaron voz entre 3746 y 4599 ms tras el final acústico del mensaje; mediana 4286 ms. El tiempo hasta el primer texto del modelo fue 1709–3051 ms, la parte más lenta. No se puede garantizar aún una conversación instantánea ni calidad en todos los ambientes. Informes: `tmp/live-latency-connected.json` y `tmp/conversation-latency.json`; reproducción: `node tools/measure_conversation.cjs` con la frase sintética preparada por el benchmark.

Estado: los tres proveedores se comprobaron con solicitudes reales. La clave está persistida en `.env`, excluida de Git y cargada en un proceso nuevo. El control del navegador de Work sigue deshabilitado; el usuario creó la clave y la pegó directamente en el formulario local. No apareció en el chat. Queda pendiente probar micrófono y salida físicos, precisión con personas, traducción en contexto y respuestas con fuentes externas.

## Apoyo de reunión antes del final de la pregunta

La ruta de reunión prepara un índice local al confirmar cada fragmento. Mantiene hasta tres citas distintas a mano sobre temas como presupuesto, fechas, responsables, acuerdos y pendientes. Los parciales de Muse pueden activar una tarjeta provisional mientras la persona sigue preguntando. Se recuperan como máximo dos citas textuales anteriores a ese turno, con su procedencia y tiempo; no se espera `speechComplete`, un LLM ni síntesis de voz.

El parcial siguiente reemplaza al anterior. Si deja de ser pregunta, cambia de tema o se vacía, el apoyo anterior se retira. Un nuevo turno limpia la sugerencia provisional; un final atrasado de otro turno no borra la pregunta actual. Los tiempos del audio ordenan el contexto aunque los finales lleguen fuera de orden. La recuperación excluye las cláusulas interrogativas como evidencia y conserva las citas completas, incluidas negaciones o correcciones. Es coincidencia léxica con grupos de temas, no verificación semántica. Las menciones diferentes siguen visibles como tales.

En móvil, la tarjeta de ayuda ocupa el espacio principal de reunión y el registro completo queda plegado. El modo sigue en silencio. Escuchar una cita requiere pulsar el control correspondiente.

Medición del 27 de octubre de 2026, tres muestras con Muse real en `DIARIZATION` y navegador Edge headless:

| Medida | Rango observado |
|---|---|
| Conexión inicial, antes de empezar a hablar | 1030–1201 ms |
| Inicio de la pregunta → primera cita provisional | 2256–2575 ms |
| Parcial útil recibido → oportunidad de pintado de la tarjeta | 17–25 ms |
| Anticipación respecto al final de la pregunta | 4277–4596 ms |

Se usó una pregunta sintética de 6,852 segundos sobre presupuesto y fecha de entrega, con tres hechos de prueba introducidos manualmente antes del audio. El primer parcial útil fue «¿Cuál es el presupuesto»; esa tarjeta aporta el presupuesto, no responde anticipadamente la segunda parte todavía no pronunciada. La prueba dejó terminar la pregunta completa y bloqueó las rutas de generación y TTS: hubo cero solicitudes a ellas. El tiempo de pintado se aproxima con dos `requestAnimationFrame`; no incluye una pantalla física. Tampoco se probaron micrófono real ni fuentes externas. Informe: `tmp/meeting-latency.json`.

Reproducción: con `tmp/meeting-question.wav` (PCM16LE mono, 24 kHz, cabecera WAV de 44 bytes) preparado y el servidor activo, ejecutar `node tools/measure_meeting.cjs`. Usa las variables de Playwright descritas en [VALIDACION](../VALIDACION.md). Las pruebas deterministas de correcciones, turnos, falta de evidencia y disposición móvil están en `tests/context-engine.test.cjs` y `tools/check_live_ui.cjs`.

Esta mejora permite consultar datos ya registrados mientras se formula la pregunta. No reduce por sí sola los 3,7–4,6 segundos medidos en la conversación oral con Muse Spark ni garantiza ayuda instantánea ante una pregunta corta o desconocida. Las respuestas complejas con fuentes externas siguen pendientes de integración y medición.

## Continuidad de voz y espera inicial

Se corrigió una espera entre frases: antes se completaba toda la reproducción y luego se pedía la siguiente síntesis. Ahora, cuando termina la descarga de una frase, se pide la siguiente mientras queda audio en reproducción. No hay dos solicitudes TTS simultáneas. Se conserva la misma línea temporal, las pausas intencionales y el orden; cancelar detiene tanto el audio programado como la solicitud pendiente. La cola programada permanece acotada a dos segundos incluso si la red agrupa bloques grandes. El servidor libera la síntesis antes de anunciar fin de flujo, evitando una carrera que podía provocar un 409 en la siguiente petición.

Tres comparaciones alternadas de la versión anterior y la actual, con las mismas dos frases sintéticas, Cloudflare real y programación Web Audio en Edge headless, dieron:

| Mediana | Antes | Actual |
|---|---:|---:|
| Intervalo entre bloques PCM de frases consecutivas | 794 ms | 89 ms |
| Intervalo entre última y primera actividad vocal de esas frases | 1150 ms | 416 ms |

El segundo intervalo incluye silencios del propio audio sintetizado; se detecta actividad con un umbral de amplitud, sin altavoces físicos. Los 90 ms de pausa intencional siguen presentes. El intervalo de actividad bajó aproximadamente un 64% en esta muestra. No equivale a una evaluación perceptiva humana. Informe: `tmp/voice-fluency.json`; reproducción: `node tools/measure_voice_fluency.cjs` con la versión anterior guardada en `tmp/live-voice-before-fluency.js`.

También se compararon Spark 1.1, 1.2 y 1.3 con tres casos sintéticos y orden rotado, usando `reasoning_effort=minimal` y 480 tokens máximos. Las doce respuestas terminaron correctamente. La variante 1.3 con instrucciones compactas tuvo 1738 ms de mediana hasta el primer texto, frente a 2388 ms de la configuración anterior, 1953 ms de 1.2 y 2402 ms de 1.1. Se mantuvo 1.3 con las instrucciones compactas; los casos de identidad e historial conservaron Melodi y el nombre explícito del usuario. Es un diagnóstico pequeño, no demuestra superioridad general ni estabilidad de latencia. Informe: `tmp/model-comparison.json`; reproducción: `python -m tools.benchmark_conversation`.

Al medir el recorrido completo con Muse, Spark y Celeste, tres muestras anteriores dieron 4290 ms de mediana (3186–4714 ms); las tres actualizadas dieron 4155 ms (2909–4243 ms). La mejora de mediana fue solo de 135 ms, menor que la variación entre solicitudes. El margen local tras el final de Muse bajó de 191–211 ms a 24–35 ms, conservando el silencio acústico configurado. No se ha conseguido respuesta oral instantánea. Informes: `tmp/conversation-before-fluency.json` y `tmp/conversation-after-fluency.json`. `BRIVANY_MEASURE_OUTPUT` permite guardar comparaciones sin sobrescribirlas; `BRIVANY_VOICE_SCRIPT` permite inyectar la versión anterior en el navegador aislado.

Meta documenta que Spark no admite `reasoning_effort=none`, y que Muse Transcribe solo produce texto. No existe una opción de audio de salida en Chat Completions que permita eliminar esta cadena de transcripción, respuesta y síntesis. Referencias: [parámetros de Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions), [Muse Transcribe](https://dev.meta.ai/docs/models).
