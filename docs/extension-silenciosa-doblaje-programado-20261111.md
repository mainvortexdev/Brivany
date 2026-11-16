# Extensión silenciosa y doblaje programado por subtítulos (0.6.0)

11 de noviembre de 2026. Implementado. Se probó con pruebas locales, con YouTube
real en el navegador integrado y con una medición real de tiempos con Groq y
Cartesia. Falta la prueba del usuario en su Brave.

## Objetivo del usuario

La extensión debe funcionar sola, sin clic ni textos en pantalla. Solo amplía la
traducción auditiva de Brivany: entrega la transcripción del video para que la
voz traducida se prepare antes y suene sincronizada con lo que se dice («si el
original dice "chocolate", la traducción dice "chocolate" a la vez»).

## Hallazgo previo

YouTube ya no entrega subtítulos a una petición propia de la extensión: exige un
token que solo genera su reproductor. En cambio, la respuesta que recibe el
propio reproductor al cargar subtítulos contiene la transcripción completa con
el tiempo de cada palabra. En Brave sin ventana llega vacía, probablemente por
protección antibots; en un navegador normal llega completa.

## Extensión 0.6.0 («Brivany · Sincronía con Melodi»)

- `timeline-capture.js` se ejecuta en la página (MAIN world) de
  `https://www.youtube.com/*` desde `document_start`, sin clic. Lee la
  respuesta de subtítulos del reproductor (fetch y XHR). Si el espectador no
  tiene los subtítulos activados, los carga un momento con la ventana de
  subtítulos oculta y restaura su ajuste. Agrupa las palabras en frases (corta en
  pausas de más de 0,7 s, 14 palabras, 6 s o un signo de fin) y conserva el
  tiempo de cada palabra. Envía la posición del video cada 250 ms y en cada
  play, pausa o salto. Los anuncios cuentan como pausa. Ignora los subtítulos
  traducidos por YouTube (`tlang`), para no traducir una traducción. Nunca
  envía audio ni toca la reproducción o el volumen.
- `timeline-bridge.js` (mundo aislado) valida los mensajes y los pasa al
  worker.
- `timeline-relay.js` (worker) abre en el escritorio una selección
  `timeline_only` por pestaña y video. Envía los subtítulos en lotes de 8 y el
  reloj limitado a 250 ms. Si Brivany está cerrado, reintenta en silencio cada
  15 s.
- `background.js`: `SILENT_TIMELINE=true`. El clic no muestra nada y no se
  preparan ni abren sesiones de traducción en el navegador; la preparación del
  inicio y el control de WorkSpace quedan desactivados en este modo.

## Escritorio

- `SelectedVideo` admite `timeline_only`: subtítulos con tiempos de palabra
  (hasta 4000 frases) y reloj de reproducción. Rechaza audio y no ofrece ruta de
  audio, así que la Directa sigue capturando el sonido del sistema.
- `CaptionDubbing` (`packages/providers/caption_dubbing.py`), con la Directa
  activa:
  - traduce con Groq las frases de los próximos 8 s, con las dos frases
    anteriores como contexto, porque los subtítulos automáticos cortan frases y
    no llevan puntuación;
  - sintetiza cada frase con Cartesia 2,2 s antes, con la voz del hablante que
    suena en ese momento (su clon si está listo);
  - la entrega a la salida 240 ms antes de su primera palabra, que es el margen
    de cola del mezclador;
  - si la voz es más larga que el hueco hasta la siguiente frase, la comprime
    hasta 1,5× sin cambiar el tono (WSOLA) y recorta el silencio de los bordes;
  - usa un único reproductor, así que las frases nunca se solapan;
  - con más de 0,8 s de retraso omite la frase; tras un salto vacía la cola,
    conserva las traducciones y descarta el audio preparado.
- River: mientras el doblaje programado está activo, la vía en directo no
  traduce ni sintetiza. Sigue identificando hablantes, alimentando la clonación
  y actualizando `voice_hint_value`.

## Pruebas

| Prueba | Resultado |
|---|---|
| Extensión (`node --test`, incluye 6 nuevas de `timeline.test.mjs`) | 96 correctas |
| river-translation (incluye 10 de `test_caption_dubbing` y 1 de supresión en directo) | 120 correctas |
| sync-relay / workspace-translation / translation-voices | 108 / 16 / 28 correctas |
| YouTube real en el navegador integrado | 3260 frases con tiempos de palabra de un video de 2 h 26 min, reloj en vivo; anuncio de 174 s tratado como pausa |
| Brave aislado con la extensión 0.6.0 en YouTube | Scripts cargados sin clic, mensajes de video y posición, 0 elementos en la página, sin errores (subtítulos vacíos sin ventana) |
| Real con Groq y Cartesia: 7 frases reales en un reloj de 21 s | Entrega 9–39 ms tras el inicio de cada frase (177 ms en la que empezó al arrancar); la primera se omitió por empezar a la vez que la prueba; traducción Groq 0,2–0,9 s; frase de 5,4 s comprimida a 4,2 s |

Consumo real: 14 traducciones de Groq y 14 síntesis de Cartesia de unos 3 s
(dos ejecuciones), no verificado en saldo. Evidencias en `tmp/caption-dub-real/`.

## Límites

- Sin subtítulos en el video, o con un navegador que no los recibe, el doblaje
  usa la vía en directo (Ink-2 → Groq → Sonic).
- La voz de cada frase programada es la del hablante identificado justo antes,
  así que en un cambio de hablante la primera frase puede salir con la voz
  anterior.
- La compresión tiene un límite de 1,5×: una traducción mucho más larga puede
  retrasar la siguiente.
- No se midió la salida física ni el desfase entre la imagen y el sonido del
  sistema.
