# Latencia de la traducción Directa

11 de noviembre de 2026. Implementado, con mediciones reales de la cadena.

## Por qué

En sitios sin subtítulos (por ejemplo, un TikTok incrustado en Discord) la
extensión no puede preparar la traducción por adelantado y Brivany usa la
Directa: escucha, reconoce con Ink-2, traduce con Groq y habla con Cartesia. El
usuario la notó lenta y pidió acelerarla antes de ampliar la extensión.

## Banco de medición

Narración continua en inglés generada con la voz local de Windows (Zira), con el
momento de cada palabra (`SpeakProgress`; sus marcas vienen en otra escala y se
corrigen ×2/3). Dos ritmos: 4,6 palabras/s (33,5 s, muy rápido) y 3,15
palabras/s (38,7 s, natural). El audio entra a ritmo real en
`WorkLiveTranslation` con Ink-2, Groq y Cartesia reales y una salida simulada.
Por cláusula se mide cuándo empieza a sonar la traducción respecto a la última
palabra original de esa cláusula (`lag_end`). Script y resultados locales en
`tmp/direct-bench/` (sin audio de terceros).

## Resultados

| Configuración | Ritmo | Confirmar cláusula | lag_end medio | máx. |
|---|---|---|---|---|
| Anterior | rápido | 3,12 s | 7,85 s (crecía hasta 11 s) | 11,3 s |
| + traducción de intérprete | rápido | 2,98 s | 6,26 s | 10,2 s |
| + velocidad 1,5×, descarte >3 s, 6 palabras | rápido | 2,45 s | 5,4–5,6 s | 8,0–8,3 s |
| Anterior | natural | 3,01 s | 4,56 s | 7,0 s |
| Nueva (con confirmación inmediata de Ink) | natural | 2,26–2,46 s | 3,83–4,08 s | 5,0–5,8 s |
| Muse en lugar de Ink (referencia) | natural | 1,7–2,4 s | 3,1–4,6 s | 5,4–6,1 s |

Desglose con ritmo natural: confirmar la cláusula 2,3–2,5 s, esperar turno de
salida ~1 s, Groq 0,35 s y primer audio de Cartesia 0,2 s. Ink-2 entrega sus
parciales unas 5–8 palabras por detrás del habla (≈1,5 s): es el límite de esta
cadena. Las pasadas varían ±0,5 s; Muse no fue claramente mejor.

## Cambios

- **Traducción de intérprete** (`LIVE_INSTRUCTIONS`, solo Directa con Groq):
  frase más corta e idiomática, sin muletillas ni repeticiones, con
  `duration_budget_ms` = duración de la cláusula original.
- **Velocidad**: base 1,15×, +0,1 por cláusula en espera, máximo 1,5×.
- **Retraso acotado**: una cláusula confirmada que espera más de 3 s para
  traducirse se omite (`stale_skipped`), como haría un intérprete.
- **Cláusulas**: se confirman 6 palabras (antes 8), guardando 1 (antes 2); con
  Ink-2 se confirman desde el último parcial sin esperar una segunda lectura igual.

## Límites

- Con cláusulas más cortas aparecen algunos cortes de sentido entre fragmentos
  (p. ej. «what.» suelto traducido como «¿Qué?», «getting lost» repartido en dos).
- Omitir cláusulas pierde contenido cuando el hablante es muy rápido.
- Bajar de ~3 s exige un reconocimiento de voz con parciales más rápidos que Ink-2.
- Voz sintética limpia, un solo hablante y sin música; no se midió la salida
  física ni un video real de Discord.

## Consumo

Nueve pasadas de ~40 s: unos 6 min de audio en Ink-2/Muse, ~190 traducciones
cortas en Groq y ~5 min de voz en Cartesia, con las claves ya configuradas.
Importe no consultado.

## Deepgram (misma tarde)

El usuario aportó una clave de Deepgram (guardada solo en `.env`). Se añadió
`packages/providers/deepgram_asr.py` con dos adaptadores al mismo contrato que
Ink-2: Nova-3 (`/v1/listen`, `language=multi`, parciales por tramo convertidos
en texto acumulado del turno) y Flux (`/v2/listen`, `flux-general-en`, eventos
`TurnInfo` acumulados, solo inglés). Mismo banco, ritmo natural, misma
configuración final (voz base 1,25×, presupuesto 80 % de la cláusula):

| Reconocimiento | Parciales | Confirmar cláusula | Primera cláusula (cola vacía) | lag_end medio por pasada |
|---|---|---|---|---|
| Ink-2 | cada ~0,3 s, 5–8 palabras por detrás | 2,2–2,5 s | 2,8–3,2 s | 3,83–4,34 (media 4,03) |
| Deepgram Nova-3 | cada ~0,94 s | 2,15 s | 2,74 s | 4,57 (1 pasada) |
| **Deepgram Flux** | cada ~0,23 s | **1,15–1,25 s** (una de 1,96) | **1,7–2,5 s** | 3,27–4,64 (media 3,86) |

Con habla rápida: Flux 4,0 s frente a 5,4–5,6 s de Ink-2.

Flux reconoce ~1 s antes. Al empezar a hablar o tras una pausa, eso se nota
entero (~1,1 s menos). Con habla continua sin pausas, la voz traducida ocupa casi
todo el tiempo de la original y la cola de salida absorbe la ganancia (~0,2 s).

Decisión: la Directa usa Deepgram cuando hay clave. Si se traduce a español o
francés (fuente presumiblemente inglesa), con Flux. Si se traduce al inglés
(fuente en otro idioma), con Ink-2, porque Flux solo entiende inglés.
`BRIVANY_DIRECT_ASR=ink|muse|deepgram` y `BRIVANY_DEEPGRAM_MODEL=nova` permiten
volver atrás. Límite: un video en francés traducido al español pasaría por Flux
y se transcribiría mal.

Consumo adicional: 11 pasadas de ~40 s (unos 7 min de audio entre Deepgram e
Ink-2), ~200 traducciones cortas en Groq y ~6 min de voz en Cartesia. Créditos de
Deepgram e importes no consultados.

## Prueba con video real

Con permiso del usuario se descargaron con yt-dlp (entorno temporal) los
primeros 95 s de audio de «30 Years of Business Knowledge in 2hrs 26mins»
(YouTube 9VlvbpXwLJs): habla real continua, ~3,6 palabras/s. Se guardaron en
`tmp/real-video/`, fuera de la bitácora. La referencia de cada palabra salió de
Whisper en Groq (`whisper-large-v3-turbo`, una transcripción por lotes ajena a
los proveedores comparados).

Hallazgos y correcciones:
- **Flux trata los 95 s como un solo turno** y reescribe la puntuación ya dicha
  («thing, business» → «thing. Business.»). El separador de cláusulas exigía que
  el texto confirmado no cambiara: se atascaba el resto del turno o paraba la
  sesión. Ahora, con Ink-2 y Deepgram, se confirma por número de palabras y no
  por prefijo de texto (`LiveClauses._eager`).
- **El ping automático de la librería websockets cerró la conexión con Deepgram**
  («keepalive ping timeout») y causó 36 s sin texto. Se desactivó para Deepgram;
  el audio fluye sin pausa.
- **Groq agotó su cuota gratuita del día**: 200.000 tokens diarios, más
  8.000 por minuto y 1.000 peticiones. Con el prompt anterior (~300–550 tokens
  por cláusula) eso da para unos 10–20 min de Directa continua al día. Se
  compactó el prompt de intérprete (50 palabras y 2 fragmentos de contexto).
  Hoy no se pudo medir la cadena completa con Groq.

Medición solo del reconocimiento: audio real a tiempo real hacia el adaptador
y el separador de cláusulas, sin traducción ni voz. Se mide cuándo se confirma
cada cláusula respecto a su última palabra en el video, con alineación global
(difflib):

| Reconocimiento | Mediana | Media | p90 | Máx. |
|---|---|---|---|---|
| Ink-2 | 1,70 s | 1,77 s | 2,19 s | 3,13 s |
| Deepgram Flux (pasada 1) | 0,88 s | 1,21 s | 2,48 s | 5,19 s |
| Deepgram Flux (pasada 2) | 0,73 s | 0,79 s | 1,24 s | 1,95 s |

Flux reconoce el habla real ~0,9 s antes que Ink-2, con picos ocasionales de
red. Con la traducción (~0,35 s) y el primer audio (~0,2 s), la frase traducida
empezaría ~1,3–1,5 s después de terminar la cláusula si no hay cola, frente a
~2,3 s con Ink-2. Es una estimación: la cadena completa con Groq no se midió en
video real por la cuota.

Consumo de esta parte: ~95 s de audio en Groq Whisper, ~8 min de audio entre
Deepgram e Ink-2 y parte de la cuota diaria de Groq ya agotada.
