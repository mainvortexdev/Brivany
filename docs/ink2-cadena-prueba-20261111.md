# Prueba real: cadena estilo Pocket Interpreter (Ink-2 → Meta → Sonic)

11 de noviembre de 2026. Comprobación real controlada, no integrada en Brivany.

## Contexto

El usuario propuso tres opciones de voz a voz: OpenAI Realtime, Gemini Live y el
«Pocket Interpreter» de Cartesia. Según su README, el Pocket Interpreter **no es
una API única**: encadena Ink-2 (STT de Cartesia, `/stt/turns/websocket`, con
eventos `turn.eager_end`/`turn.end`), un LLM externo y Sonic 3.6. Es la misma
arquitectura que Brivany (Muse → Meta → Sonic), cambiando Muse por Ink-2. Usa
voces de catálogo y no conserva la voz del hablante. Ink-2 admite en, es, fr,
hi y ja.

Gemini Live Translate ya se integró y se midió en octubre: primer PCM 953 ms
tras el final de la fuente en una fixture corta ([26](26-retraso-audible.md)).
El adaptador `gpt-realtime-translate` existe, pero nunca se probó: no hay clave
de OpenAI ni de Gemini en `.env`.

## Método

Clip sintético en español (voz Helena de Windows, 12,1 s, dos oraciones; fin de
voz en 4,50 s y 11,34 s según la energía), enviado a ritmo real a Ink-2
(`ink-2`, PCM 24 kHz) y seguido de 3 s de silencio. En `turn.eager_end` se pide
la traducción a Meta (`MetaStream`, el mismo traductor de Brivany), y sus
fragmentos van a Sonic (`sonic-3.6-2026-08-27`, voz Daniel,
`max_buffer_delay_ms: 0`) por un WebSocket ya abierto. Una sola sesión.

## Resultados

| Paso | Oración 1 | Oración 2 |
|---|---|---|
| Fin de voz en la fuente | 4,50 s | 11,34 s |
| Ink-2 `turn.eager_end` (texto completo y correcto) | 4,76 s (+0,26) | 11,65 s (+0,31) |
| Meta, primer texto traducido | 5,99 s (+1,23) | 13,40 s (+1,75) |
| Sonic, primer audio | 6,28 s (+0,29) | 13,71 s (+0,31) |
| **Fin de voz → voz traducida** | **1,78 s** | **2,37 s** |

Traducciones: «Hello everyone. Today we are going to prepare a chocolate bar
with cocoa from the farm.» y «First we toast the seeds, then we grind them with
sugar and finally we let the mixture cool.» `turn.end` llegó a los 80–110 ms de
`eager_end` con el mismo texto, así que la traducción especulativa se aprovechó.

## Conclusiones

- Ink-2 detecta el final de una frase en unos 0,3 s y Sonic empieza a hablar en
  unos 0,3 s. **El cuello de botella es Meta: 1,2–1,75 s**, y entregó cada
  traducción casi de una vez.
- Esta cadena no baja de 1 s mientras la traducción tarde más de 1 s. Las vías
  para bajarla: un traductor más rápido, o traducir por cláusulas a partir de
  `turn.update` antes del final de la frase.
- Gemini Live (953 ms medidos en octubre) sigue siendo la referencia de voz a
  voz más rápida medida en Brivany, pero no clona la voz del hablante.

## Límites y consumo

Una sola muestra con voz sintética limpia, sin música ni varios hablantes; no se
midió la reproducción física. Consumo: unos 15 s de audio en Ink-2, dos
traducciones de Meta y unos 180 caracteres en Sonic, todo con claves ya
configuradas. Saldo no consultado: consumo no verificado. Evidencias locales en
`tmp/soniox-probe-20261111/` (`ink_chain_log.json` y `ink_chain_output_en.wav`).

## Implementación: Ink-2 sustituye a Muse en la traducción Directa

A petición del usuario, la traducción Directa de WorkSpace transcribe con
Cartesia Ink-2 en lugar de Muse. Quedan dos proveedores: Cartesia (escucha y
voz) y Meta (traducción). Cartesia no traduce.

- `packages/providers/ink_asr.py` adapta los eventos de Ink-2 a los de Muse:
  `turn.start` → `speechStart`, `turn.update` → `transcript`, `turn.end` →
  `speechComplete`. Así River se reutiliza sin cambios de fondo. Se ignora
  `turn.eager_end`. Como Ink no da marcas de tiempo, la posición se toma del
  audio ya enviado.
- Al terminar, el adaptador espera a que se cierre el turno abierto (máximo
  4 s). La primera prueba real envió `finalize`, que el endpoint de turnos
  rechaza: hubo error y se perdió la última cláusula. Corregido.
- **Distinción de hablantes:** Ink-2 no etiqueta hablantes, así que la
  Directa con Ink activa la agrupación acústica local (CAM++), ya usada en el
  video en la pestaña. Cada grupo recibe su etiqueta «Hablante N» y su voz de
  catálogo propia. La muestra de cada turno (hasta 8 s) también alimenta la
  clonación por grupo.
- Solo la Directa usa Ink-2: el modo sincronizado y el video en la pestaña
  siguen con Muse, porque necesitan sus marcas de tiempo.
  `BRIVANY_DIRECT_ASR=muse` restaura Muse. El estado exige la clave de Cartesia,
  no la de Muse.

Pruebas simuladas: `tests.test_ink_direct`, 8 correctas (adaptador, URL, cierre,
estado, dos hablantes → dos etiquetas y dos voces, un hablante → una voz,
muestras para clonar por grupo, ninguna conexión a Muse). Suites:
river-translation 97 correctas (1 omitida), sync-relay 104, workspace-translation
16, translation-voices 28, pacing correcto.

**Prueba real del recorrido completo de River** (mismo clip sintético, salida
nativa sustituida por una grabadora; dos sesiones: la primera reveló el error de
cierre). En la segunda, sin errores y con 6 cláusulas traducidas completas:

| Cláusula | Lista para traducir | Primera voz |
|---|---|---|
| «Hola a todos.» | 2,79 s | 3,93 s |
| «Hoy vamos a preparar…» (fin de voz 4,50 s) | 4,75 s | 6,55 s |
| «…de la finca.» | 4,86 s | 7,96 s |
| «Primero tostamos…» | 10,64 s | 12,55 s |

Ink-2 entrega cláusulas mientras la persona habla, y la primera voz llegó antes
de que terminara la frase. Las cláusulas siguientes esperan a Meta, que tarda
0,9–2 s cada una y las procesa de una en una; ese sigue siendo el cuello de
botella. Hubo un solo hablante, identificado como «Hablante 1» con voz Daniel.
Consumo de las dos sesiones: unos 32 s de audio en Ink-2, unas 11 traducciones
de Meta y unos 400 caracteres de Sonic; no verificado en saldo.
