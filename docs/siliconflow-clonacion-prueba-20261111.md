# Prueba real controlada: clonación de voz en SiliconFlow

11 de noviembre de 2026. Comprobación real, no implementación. Pregunta: ¿puede
SiliconFlow clonar sin subir la voz (referencia en línea) una voz en inglés y
hablar español con latencia útil para la traducción auditiva en tiempo real?

## Alcance y consumo

- Cuatro `POST /v1/audio/speech` con tope fijo en el script; ninguna subida ni
  voz guardada en la cuenta. Clave aportada en el chat, usada solo como
  variable de entorno del proceso; no se escribió en archivos.
- Referencias sintéticas: Zira (SAPI local de Windows, en-US) y la voz de
  catálogo `benjamin` de CosyVoice2 generada en la llamada 1. Ninguna persona real.
- Texto facturable según la documentación (bytes UTF-8): 332 bytes en tres
  respuestas correctas; la llamada con HTTP 500 no se sabe si se cobra. A los
  precios documentados (7,15 y 15 USD por millón de bytes) son menos de 0,01 USD.
  No se comprobó el saldo de la cuenta: consumo estimado, no verificado.

## Resultados

| Llamada | Modelo | HTTP | Primer byte | Total | Audio |
|---|---|---|---|---|---|
| Voz de catálogo inglés (benjamin) | CosyVoice2-0.5B | 200 | 4,2 s | 4,9 s | 10,4 s, MP3 22 kHz |
| Clon de Zira → español | CosyVoice2-0.5B | 200 | 7,3 s | 7,9 s | 9,6 s, MP3 22 kHz |
| Clon de benjamin → español | CosyVoice2-0.5B | 500 `50507` | 1,6 s | — | — |
| Clon de benjamin → español | fish-speech-1.5 | 200 | 2,8 s | 3,6 s | 7,1 s, PCM 24 kHz |

Comparación local (CAM++ de `acoustic_speakers`, coseno; timbre local):

- Clon CosyVoice2 frente a Zira: 0,936; frente a benjamin: 0,083.
- Clon fish-speech frente a benjamin: 0,793; frente a Zira: 0,040. Timbre
  masculino con acuerdo de los dos modelos locales.

## Hallazgos

1. **La referencia en línea funciona** en ambos modelos: fish-speech-1.5 acepta
   `references` aunque su esquema no lo muestre.
2. **CosyVoice2 ignoró `response_format: pcm`** y devolvió MP3 22,05 kHz. El
   script lo envolvió primero como PCM; el MP3 se recuperó y decodificó con
   ffmpeg. La referencia de benjamin para las llamadas 3 y 4 fue por ello ese
   MP3 dentro de una cabecera WAV: probable causa del 500 de CosyVoice2;
   fish-speech la aceptó igualmente. Defecto del script, no del proveedor.
3. **Sin streaming real**: con `stream: true`, en ambos modelos el primer byte
   llega con las cabeceras y el resto en menos de 0,8 s. La latencia es la
   síntesis completa: 7,3 s en CosyVoice2, 2,8 s en fish-speech para una frase.
4. fish-speech-1.5 documenta español; CosyVoice2 no. RTF 0,5 en fish-speech.

## Límites

Una muestra por caso; sin medición de variación ni de concurrencia. La
similitud de embeddings no acredita fidelidad percibida, pronunciación española
ni naturalidad: falta escucha humana. Las referencias son voces sintéticas
limpias, no audio de YouTube con música o ruido. El timbre local de Zira quedó
incierto (modelos en desacuerdo), limitación ya conocida de la heurística.

Evidencias locales (no versionadas): `tmp/siliconflow-clone-probe-20261111/`
(`calls.json`, `local_analysis.json` y audios sintéticos).

## Continuación: ¿primer audio en 1 s o menos?

Tres llamadas más a fish-speech-1.5 con una frase de 21 bytes («Hola, ¿cómo
estás?»), PCM 24 kHz, `stream: true`. Referencia: benjamin decodificado
correctamente (10 s WAV, petición de 648 KB).

| Caso | Primer byte | Total | Audio |
|---|---|---|---|
| Voz de catálogo, sin referencia, conexión nueva | 1,73 s | 2,36 s | 2,25 s |
| Clon en línea, conexión nueva | 2,55 s | 2,78 s | 1,83 s |
| Clon en línea, conexión reutilizada | 3,08 s | 3,44 s | 1,74 s |

Incluso sin clonar y con una frase mínima, el primer audio tarda 1,7 s; reutilizar
la conexión no ayudó. El clon añade de 0,8 a 1,3 s. SiliconFlow no documenta
WebSocket ni cifras de latencia. Conclusión: **con SiliconFlow no se alcanza
1 s** en estas condiciones (una muestra por caso, sin repeticiones).

Alternativas documentadas, no probadas: Cartesia Sonic 3.6 (ya integrado en
Brivany; primer byte declarado ~90 ms por WebSocket; clon instantáneo con
10–60 s; un clon inglés habla español con `locale` conservando su acento) y la
API propia de Fish Audio (WebSocket `wss://api.fish.audio/v1/tts/live` con
`references` en línea y `latency: balanced`, ~300 ms declarados; cuenta
independiente). Ninguna cifra declarada mide un clon real.

Consumo de esta continuación: 63 bytes de texto, estimado inferior a
0,001 USD, no verificado en la cuenta.

## Continuación: Cartesia Sonic 3.6 con voz clonada

Prueba real controlada con el código existente (`CartesiaVoiceCloner` y el
WebSocket de `river_translation`, modelo `sonic-3.6-2026-08-27`). Referencia:
la misma voz sintética benjamin (10,37 s), clonada como inglés; síntesis con
`language: es`, PCM 24 kHz, `max_buffer_delay_ms: 0`. Un clon, tres contextos
en un solo WebSocket y borrado de la voz al terminar (confirmado por la API,
registrado también en el diario de limpieza).

| Paso | Primer audio | Total | Audio |
|---|---|---|---|
| Clonación (una vez por hablante) | — | 4,30 s | — |
| Conexión WebSocket | — | 0,44 s | — |
| Clon, frase corta (primera petición) | 0,65 s | 0,92 s | 1,68 s |
| Clon, frase larga (91 caracteres) | 0,18 s | 0,83 s | 6,64 s |
| Daniel de catálogo, frase corta | 0,20 s | 0,34 s | 1,44 s |
| Borrado de la voz | — | 1,22 s | — |

Comparación local frente a benjamin: clon largo 0,817, clon corto 0,755
(Daniel 0,090, fish-speech 0,793). Los cuatro resultados, masculinos con acuerdo
de los modelos locales.

Conclusión: **Cartesia sí entrega el primer audio por debajo de 1 s** con voz
clonada (0,18–0,65 s) y streaming real; la frase larga llegó completa antes de
la mitad de su duración. El coste es una clonación de unos 4 s por hablante,
que puede ocurrir en segundo plano mientras suena una voz de catálogo. El clon
inglés hablando español conserva el acento de origen según la documentación;
falta escucha humana. Una muestra por caso, voz sintética limpia, sin ruido ni
música de YouTube. Consumo de Cartesia: una clonación y 127 caracteres
sintetizados; no se consultó el saldo, consumo no verificado.
