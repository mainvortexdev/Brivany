# 48. Traducción incremental con Muse, Groq y Cartesia

30 de octubre de 2026. Página local: `/translate`, servida por el backend habitual
de Brivany. La instancia de revisión de esta entrega usa
<http://127.0.0.1:8767/translate>. Melodi y las rutas de doblaje anteriores conservan
sus proveedores. Spaik Iris sigue pendiente.

## Arquitectura implementada

**Modelo vigente autorizado por el usuario:** `qwen/qwen3.8-27b` en Groq,
con `reasoning_effort: none`. Es Preview según Groq; no se hace fallback
automático si deja de estar disponible. La nueva credencial obtuvo HTTP 200 y
su catálogo confirmó este modelo. Llama 3.3 no aparecía en el catálogo; los
modelos Llama de guardia no son traductores. Groq ahora recibe
`User-Agent: Brivany/1.0`; como también se cambió la clave, no puede atribuirse
el primer 403 a una sola de esas diferencias.

```mermaid
flowchart LR
    Y[YouTube embebido] --> C[Captura de pestaña autorizada]
    C -->|PCM16 mono 24 kHz · 80 ms| B[Relay local concurrente]
    B --> M[Muse Voice Transcribe]
    M -->|parciales acumulativos| S[Prefijos estables y cola acotada]
    S --> G[Qwen 3.8 27B en Groq]
    G -->|SSE de salida| T[Cartesia Sonic 3.6 por WebSocket]
    T -->|JSON con PCM en base64| W[Mezclador de Windows]
    W --> O[Altavoces locales]
```

El navegador no puede leer el audio de un iframe externo directamente. Se
reutilizan el reproductor oficial `youtube-source.js`, la captura optativa de
pestaña `dub-tab-capture.js` y el AudioWorklet existente. Dos frames de 40 ms se
agrupan en uno de 80 ms. El video y los fotogramas capturados no se transmiten.
El usuario elige esta pestaña y compartir audio; no se solicita el micrófono.
El enlace solo prepara el iframe, sin reproducir ni conectar proveedores.

El relay usa tareas concurrentes en hilos: entrada/control, reconocimiento,
traducción y recepción de voz. Es asíncrono respecto a las etapas y conserva
las conexiones de Muse y Cartesia durante la sesión. La arquitectura puede
portarse a asyncio para más concurrencia; este producto local permite una sola
sesión. No se afirma escalabilidad de servidor o despliegue multiusuario.

Los parciales son reemplazos acumulativos, nunca nuevas frases facturables por
defecto. Se reutiliza `StableClauses` y se añade `LiveClauses`: emite puntuación
estable en dos observaciones o un bloque de ocho palabras estables dejando dos
en espera, sin necesitar el final de una frase larga. Es una heurística, no una
garantía de reconocimiento. Los finales vacían solo la parte nueva; una
corrección semántica de lo ya emitido detiene la sesión. No se puede deshacer
audio que ya se escuchó. La cola admite tres bloques y cuatro segundos de
antigüedad antes de detener el flujo.

Groq recibe **una petición completa por bloque**, con los dos últimos pares
origen/traducción como contexto. No admite en esta integración añadir tokens de
entrada a una petición Chat Completions ya abierta. Su salida SSE alimenta a
Cartesia por grupos de palabras, con un umbral de 32 caracteres o 120 ms observado
al llegar un nuevo token y un límite de palabra. No existe un temporizador que
garantice vaciar un token si Groq deja de enviarlos; se aplican los timeouts.
No se traduce cada palabra aislada. Los textos se tratan como datos sin herramientas
ni permisos de ejecutar órdenes.

Cartesia usa `wss://api.cartesia.ai/tts/websocket`, versión `2026-08-14`,
modelo fijado `sonic-3.6-2026-08-27`, voz de catálogo como string, `context_id`
único por bloque y `continue` hasta completar la traducción. La respuesta es JSON
con PCM en base64, no se asume que sean frames binarios crudos. La credencial viaja
en la cabecera desde el backend. La traducción se reproduce con `NativeMixer`;
no se devuelve al contexto de audio del navegador, lo que evita recapturar la voz
traducida como origen. Esta entrega requiere el mismo ordenador Windows para
servidor y oyente. No es una llamada remota bidireccional entre dos personas.

Una ventana acotada de audio en RAM permite una autocorrelación local del tono.
Se elige una de tres voces de catálogo: grave, aguda o neutral si la señal no
basta. No clasifica género, edad ni identidad; no clona voces. La etiqueta de
hablante de Muse, cuando ya existe, mantiene la elección. Una etiqueta tardía,
voz superpuesta, música o ventana que cruza hablantes puede afectar la elección.
La fidelidad del estilo y la atribución temprana por hablante siguen pendientes
de evaluación con audio real. No se conserva esa muestra.

## Tres controles y parada

1. **Iniciar traducción**: solicita captura y confirma reproducción antes de abrir
   proveedores; acepta es, en o fr como destino y sesgo de origen multilingüe.
2. **Idioma**: recorre español → inglés → francés. Si hay sesión, la detiene;
   continuar requiere pulsar iniciar y consume otra reserva. No cambia idioma
   mediante reconexiones automáticas ni reproduce audio viejo.
3. **Detener todo**: pausa YouTube, libera los tracks/AudioContext de captura,
   envía stop y cierra el socket. El backend cierra el mezclador, cancela el
   contexto de Cartesia y cierra conexiones y traducción. Cerrar la página o
   dejar de compartir también cancela. El tiempo físico de silenciamiento del
   altavoz y la cancelación/facturación del proveedor no han sido medidos.

La salida nativa ya existente limita las colas a un segundo de original y tres
de traducción, con buffers de dispositivo nominales de hasta 80 ms. No debe
confundirse ese tamaño con latencia física verificada. La captura conserva la
compatibilidad previa cuando el navegador no confirma supresión del original;
puede quedar original muy bajo. No se ha medido aislamiento físico de eco.

## Presupuesto y errores

| Límite | Aplicación |
|---|---|
| 30 s de entrada | Tiempo de pared y número de bytes en servidor |
| 3 inicios diarios | Reserva SQLite atómica persistente, día de La Paz |
| 12 bloques por inicio | Máximo 12 peticiones Groq, un contexto TTS por bloque |
| 2.400 caracteres | Suma del texto origen enviado y traducción recibida |
| 192 tokens por bloque | `max_completion_tokens`; truncamiento detiene la sesión |
| 45 s de voz generada | Bytes PCM recibidos por sesión |
| 8 s de cierre | Espera acotada por los últimos resultados |
| 0 reintentos | Sin retries SDK, fallback de proveedor ni reconnect automático |

Los fallos después de reservar cuentan como inicio, sin reembolso local
automático. La reserva se hace antes de abrir proveedores, después de comprobar
configuración y dispositivo local. Un watchdog abarca la preparación y el flujo.
Mientras termina una tarea cancelada el relay permanece bloqueado para otra
sesión. Una reserva fallida por cuota o un rechazo de acceso ya conocido impide
abrir proveedores. La base y el control de acceso son locales a esta instalación;
no coordinan otras aplicaciones, equipos o procesos que omitan este relay.

Estos son **límites de uso, no un techo monetario garantizado**. No se conocen aquí
las tarifas efectivas, saldo, redondeos ni facturación tras cancelar. No hay
reposición de saldo, cambios en la tarjeta ni modificación de límites del proveedor.
Un límite monetario independiente en cada cuenta sigue siendo necesario si se
requiere un máximo de dinero estricto.

Las claves solo se guardan en `.env` local excluido de Git. La respuesta de estado
no las incluye. Una comprobación explícita de metadatos guarda localmente el
resultado vinculado a la credencial instalada; un rechazo conocido bloquea el
inicio. Cambiar la credencial descarta ese estado para la nueva clave. Las
huellas de vinculación solo están en `.local`, no en las evidencias.

## Verificación y estado real

- `tools.verify river-translation`: nueve pruebas locales de reserva concurrente,
  persistencia, tono sintético, texto estable sin puntuación, deduplicación de
  finales, protocolos Muse/Groq SSE/Cartesia WS sustituidos, cancelación durante
  petición, HTTP 429 sin retry, PCM incorrecto y bloqueo por cuota/acceso. No se
  ejecutan inferencias, dispositivos ni credenciales reales.
- `tools.verify river-ui`: interfaz/HTTP/WebSocket/AudioWorklet reales con YouTube,
  selector de captura, modelos y mezclador sustituidos; tres controles, selección
  de idioma, PCM de 80 ms, subtítulos, parada/liberación de tracks, bloqueo ante
  HTTP 403, escritorio y 390 px sin desbordamiento. Usa dos cláusulas sintéticas;
  según el momento de parada alcanza uno o dos bloques, nunca más. No prueba
  reproducción física, calidad bilingüe ni captación real de YouTube.
- `tools.verify http`: 23 pruebas locales de API compartida correctas.
- `tools.verify youtube-source`: 25 pruebas locales del reproductor/captura/sink
  compartidos correctas.
- Los primeros intentos detectaron conexiones SQLite sin cierre explícito en
  Windows y una expectativa de un bloque en una fixture de dos cláusulas. Se
  corrigieron y se agregaron resultados posteriores; los fallos permanecen en la
  bitácora.
- **Comprobación real de acceso:** exactamente dos GET de metadatos, sin inferencia
  ni síntesis. Cartesia `/voices` devolvió HTTP 200. Groq `/models` devolvió HTTP
  403; no se concluye que la causa sea la clave. Muse no se contactó. Importe
  monetario desconocido. Informe sanitizado: `tmp/translation-access.json`.
  Este fue el resultado inicial; la actualización y el ensayo real posterior
  se documentan abajo. La evidencia inicial permanece conservada.

La consulta puede ejecutarse expresamente una vez tras corregir la cuenta o red:
`python -m tools.check_river_access --check-access --provider groq`. Permite
consultar solo Groq o Cartesia para reutilizar el resultado del otro. No pertenece
a `tools.verify`, porque sí hace solicitudes externas. Conserva informes con
fecha sin sobrescribir el anterior. El servidor se reinicia tras cambiar `.env`.
La nueva comprobación es una acción manual, nunca un bucle de salud facturable.

No se acredita latencia de 500 ms ni calidad de traducción/voz con estas pruebas.
El tiempo de primera voz incluye captura, espera de palabras, segmentación,
colas, traducción, síntesis y red. El mezclador y el altavoz añaden reproducción.
Las cifras promocionales de primera salida TTS no se suman directamente para
prometer retraso audible. El ensayo real siguiente no sustituye la evaluación
posterior de calidad, eco físico y captura real de YouTube.

### Ensayo real único tras la actualización

Se ejecutó `tools.check_river_real --allow-paid` una sola vez, reutilizando la
fixture sintética aprobada ya disponible de 2,344 s, sin nueva generación ni
audio del usuario. Muse, Groq/Qwen y Cartesia reales, mezclador y dispositivo
WinMM reales; sin navegador/captura de YouTube en este ensayo. Límites extra
exclusivos del proceso: cinco segundos de entrada, un bloque Groq, un contexto
TTS, 600 caracteres y cero retries. Consumió una reserva; quedaron dos inicios
diarios. No hubo un segundo ensayo pagado.

Completado con un bloque y 61 caracteres de origen más traducción: 115.200 bytes
de entrada PCM (2,4 s por padding del último frame) y 103.680 bytes de voz
traducida (2,16 s). Primer audio: **3.109 ms** desde la primera entrada;
primer bloque de Cartesia: **187 ms** desde su primera petición de voz. La cola
de traducción llegó a 1.660 ms y terminó vacía sin rechazos del mezclador.
El primer audio incluye acumular la frase origen; no es desfase semántico entre
palabras ni medición física del altavoz.

Importe y tokens facturados desconocidos. No se guardaron transcripciones ni
audio de salida en el informe/bitácora: solo contadores, tiempos y resultado.
No se verificó escucha humana, calidad de traducción, selección de voz, eco
físico ni la captura real de YouTube. Evidencia:
`tmp/river-real-20261030T125228.json`.

Tras la clave inicial hubo tres GET de metadatos Groq con propósitos distintos:
autenticación, identificación de los modelos Llama accesibles y comprobación del
modelo vigente elegido. No fueron retries automáticos de inferencia. Se
conservan en `tmp/translation-access-groq-*.json`. El ensayo real está fuera de
`tools.verify`, que sigue usando exclusivamente sustitutos.

## Fuentes oficiales del contrato consultadas

- [Meta: transcripción realtime](https://dev.meta.ai/docs/api-reference/voice/realtime)
- [Groq: generación y salida en streaming](https://console.groq.com/docs/text-chat)
- [Groq: retirada de Llama para Free/Developer](https://console.groq.com/docs/deprecations?erid=2W5zFJmrUKT)
- [Groq: Qwen 3.8 y modo sin razonamiento](https://console.groq.com/docs/model/qwen/qwen3.8-27b)
- [Cartesia: TTS por WebSocket y cancelación](https://docs.cartesia.ai/api-reference/tts/websocket)
- [Cartesia: Sonic 3.6, snapshot y voces](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest)

Implementación: `packages/providers/river_translation.py`, `web/translate.*`,
integración en `services/h1/server.py`. El estado no convierte la arquitectura
implementada y simulada en integración real completa.
