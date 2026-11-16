# Brave: inicio preparado de 10 s, traducción anticipada bilingüe y Groq

11 de noviembre de 2026. Cambios en el código del modo «Videos con Melodi»
(video en la pestaña, sincronizado) y en el relay de Brivany.

## Cambios

- **Inicio preparado de 10 s (antes 7 s).** `PREFIX_MS = 10000` en
  `prefix_translation.py`; la extensión captura 125 bloques de 80 ms
  (`prefix-preparation.js`, `background.js`, `video-selection.js`). El
  detector de canciones aceptaba como máximo 8 s; ahora acepta 10 s, sin coste
  extra porque sigue analizando cuatro ventanas como máximo. Las pruebas
  encontraron ese fallo real.
- **Traducción anticipada en español e inglés.** Al preparar el inicio, cada
  turno de voz confirmado se traduce en paralelo a `es` y `en` (hasta 12
  traducciones y 4 a la vez), con el presupuesto de duración del doblaje.
  Sirve para que cambiar entre los dos idiomas más usados no espere otra
  traducción. Las traducciones quedan en memoria del escritorio y no se envían
  al navegador. River usa la del idioma elegido sin hacer ninguna petición
  (etapa `caption_cache_hit`, uso `prefix_prepared`). Si falla, ese turno se
  traduce por la vía normal.
- **Groq en el modo video.** El modo sincronizado sigue escuchando con Muse,
  porque necesita sus marcas de tiempo, pero traduce con Groq (Qwen 3.8 27B),
  igual que la anticipación de subtítulos y del inicio. `BRIVANY_DIRECT_MT=meta`
  vuelve a Meta.
- **La clonación empieza con el inicio preparado.** Los turnos del inicio
  alimentan a la clonación por grupo acústico al activar la herramienta, así
  que el clon puede crearse sin esperar 10 s de voz en directo. Las muestras se
  limitan a 8 s.

## Pruebas

Todas locales o simuladas, sin proveedores reales:

- sync-relay: 108 pruebas, incluida una nueva en la que el inicio preparado se
  dice sin ninguna petición de traducción y solo la frase en directo se
  traduce.
- river-translation: 109 pruebas (1 omitida).
- translation-voices: 28 (1 omitida).
- workspace-translation: 16.
- extensión: 90.
- 3 pruebas nuevas de traducción preparada (dos idiomas, fallo tolerado,
  cancelación) y 1 de Groq en el modo video.
- Se actualizaron a 10 s las pruebas con 7 s escritos a mano.

**Brave aislado:** `run-inline-sync-probe.mjs --fixture --encoded --prefix` no
pudo completarse. La prueba tomaba el primer service worker y en Brave era uno
integrado del navegador; se corrigió para elegir el de Brivany. Así apareció la
causa de fondo: el manifiesto activo es **«Brivany · Transcripción» 0.4.11**
(`transcription-background.js`), una prueba independiente solo de
transcripción ([documento](extension-transcripcion-0411.md)) que no carga el
modo de traducción y además retira la preparación del inicio. Por eso estos
cambios no actúan en Brave hasta que vuelva a activarse el modo de traducción.
Ese modo se apartó mientras se investigaba un bloqueo del PC reportado el 4 de
noviembre, cuya causa no está confirmada ([045](traduccion-auditiva-estabilidad-045.md)).
Los audios de ejemplo de la prueba se generaron con voces sintéticas de Windows
en `tmp/workspace-translation-real/`.

## Reactivación del modo de traducción · extensión 0.5.0

El usuario autorizó reactivar el modo de traducción, conociendo el bloqueo del
PC del 4 de noviembre, cuya causa no está confirmada.

- `manifest.json`: «Brivany · Videos con Melodi» 0.5.0. El service worker
  vuelve a ser `background.js`, con los módulos del reproductor accesibles.
  `transcription-background.js` (0.4.11) se conserva, pero no se carga.
- `background.js`: `TRANSCRIPTION_ONLY=false`. Además, pulsar la extensión
  forzaba `transcribeOnly:true` aunque el interruptor estuviera apagado (cambio
  del 9 de noviembre). Ahora sigue el modo activo, arranca el control de
  WorkSpace y actualiza el registro de la preparación del inicio.
- **Fallo encontrado en Brave aislado:** `video-selection.js` importa
  `transcript-overlay.js`, que no estaba entre los recursos accesibles del
  manifiesto restaurado. El módulo no cargaba (`brivanyPrefixLoader:
  module-error`) y el inicio nunca se preparaba. Se añadió, junto con una prueba
  que exige que todo módulo importado por un recurso accesible también lo sea.
  Se comprobó que la prueba falla si falta y pasa si está.
- La prueba de Brave aislado elige ahora el service worker de Brivany y no el
  primero que encuentra, que en Brave puede ser uno integrado del navegador.

**Resultados.** Extensión: 90 pruebas correctas. `run-inline-sync-probe.mjs
--fixture --encoded --prefix` en Brave aislado: **aprobada**. El inicio de 10 s
(10.000 ms de PCM, 125 bloques) se preparó antes de activar, se adjuntó y se
usó; Muse arrancó exactamente en 10.000 ms y sonaron 3 voces. El relay está
sustituido y los audios son voces sintéticas de Windows. Sin proveedores reales,
sin coste y sin perfil del usuario.

Pendiente: recargar la extensión y las pestañas en el Brave del usuario, y una
prueba con un video real. Durante esa primera prueba hay que vigilar si vuelve
el bloqueo del 4 de noviembre.
