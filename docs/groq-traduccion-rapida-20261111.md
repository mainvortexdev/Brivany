# Groq como traductor rápido de la traducción Directa

11 de noviembre de 2026. Implementado, con medición real.

## Por qué

La [cadena Ink-2](ink2-cadena-prueba-20261111.md) dejó la traducción de Meta
como cuello de botella: 0,9–2 s por cláusula. El usuario descartó un traductor
local porque traduciría demasiado literal, y aportó una clave de Groq. Brivany
ya había usado Groq/Qwen en el [hito 48](48-muse-llama-cartesia.md); en el hito
49 se cambió a Meta para corregir la reproducción de audio, no por la latencia.

## Medición de modelos (texto, sin voz)

Seis cláusulas reales de la prueba con Ink-2, con el mismo prompt y el mismo
JSON que el traductor Meta de Brivany, en streaming:

| Modelo en Groq | Primer texto por cláusula | Observaciones |
|---|---|---|
| `qwen/qwen3.8-27b` (`reasoning_effort: none`) | 0,19–0,23 s (un valor atípico de 1,4 s) | Natural; «to cool down» en el último fragmento |
| `openai/gpt-oss-20b` (`low`) | 0,29–0,56 s | Calco «chocolate tablet» |
| `openai/gpt-oss-120b` (`low`) | 0,26–1,37 s | Correcta; más variable |

Se eligió Qwen 3.8 27B. Otros modelos activos en la cuenta (Whisper, Orpheus,
guardas) no son traductores.

## Implementación

- `GroqTranslationSession` hereda de la sesión Meta: mismo prompt, JSON,
  analizador SSE, límites, plazos y cancelación. Cambian el host
  (`api.groq.com`), la ruta (`/openai/v1/chat/completions`), el rol `system` y
  el razonamiento (`none` en Qwen). Modelo por defecto `qwen/qwen3.8-27b`;
  `BRIVANY_GROQ_MODEL` admite también los dos gpt-oss.
- La Directa de WorkSpace traduce con Groq cuando `BRIVANY_GROQ_API_KEY` está
  configurada; `BRIVANY_DIRECT_MT=meta` vuelve a Meta. El modo sincronizado y
  el video en la pestaña siguen con Meta. El estado comprueba Groq en lugar de
  Meta cuando Groq es el traductor.
- La clave aportada por el usuario se guardó en `.env` (ignorado por git), no en
  la bitácora ni en evidencias.

## Sesión real de River: Ink-2 → Groq → Sonic

Mismo clip sintético en español (12,1 s), a ritmo real; salida nativa
sustituida por una grabadora. Sin errores, con 6 cláusulas completas:

| Cláusula | Lista | Primera voz con Groq | Con Meta (sesión anterior) |
|---|---|---|---|
| 1 «Hola a todos.» | 2,79 s | 3,26 s (+0,47) | 3,93 s (+1,14) |
| 2 «Hoy vamos a preparar…» | 4,75 s | 5,21 s (+0,46) | 6,55 s (+1,80) |
| 3 «…de la finca.» | 4,87 s | 5,44 s (+0,57) | 7,96 s (+3,10) |
| 4 «Primero tostamos…» | 10,65 s | 11,21 s (+0,56) | 12,55 s (+1,91) |
| 5 «…azúcar y al final…» | 11,65 s | 12,11 s (+0,46) | 14,84 s (+3,20) |
| 6 «se enfríe.» | 11,75 s | 12,31 s (+0,56) | 16,88 s (+5,13) |

Con Meta las cláusulas se acumulaban y el retraso crecía hasta 5 s. Con Groq se
mantiene entre 0,46 y 0,57 s desde que la cláusula está lista hasta que suena.
La primera frase completa terminó de empezar a sonar 0,94 s después de que la
persona dejara de hablar (fin de voz 4,50 s, última cláusula 5,44 s).

Pruebas simuladas: `tests.test_groq_translation`, 6 correctas (configuración,
petición a Groq con rol system y sin razonamiento, carga útil de Meta
intacta, estado, selección y rechazo de proveedor inválido). Suites:
river-translation 103 correctas (1 omitida), sync-relay 104,
workspace-translation 16, meta-translation 36.

Límites: una sola muestra sintética limpia con un hablante; sin música, ruido ni
varios hablantes, y sin medir la reproducción física. Consumo: 18 peticiones de
texto en la comparación de modelos y 6 en la sesión, más unos 16 s de Ink-2 y
unos 200 caracteres de Sonic. No consulté el saldo, así que el consumo no está
verificado.
