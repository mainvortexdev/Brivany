# Promoción de la traducción auditiva de Brivany

Primera pieza de 54 s para el feed profesional. El guion combina cine, una estadística de idiomas de la web, un estudio de comprensión audiovisual y una muestra de audio traducido. Se mantuvo el formato horizontal de las referencias iniciales. La revisión visual retira el reproductor tridimensional y toma del último video aportado la composición blanca, las tarjetas suaves, los acentos azules y las pistas de audio. Se recrea el panel con HTML, CSS y animación vectorial. El video muestra una ilustración del flujo de traducción.

[Composición editable](../videos/brivany-escucha-20261108/BRIEF.md) · [Entrega local](../Exports/Brivany-Escucha-20261108/Brivany-El-idioma-no-deberia-decidir.mp4) · [Texto, créditos y fuentes](../Exports/Brivany-Escucha-20261108/Fuentes-y-texto-para-publicar.md).

## Guion y material

- W3Techs, consulta del 8 de noviembre de 2026. Inglés 49,5 % y español 6,0 % entre los sitios monitorizados con idioma de contenido identificado. [Datos originales](https://w3techs.com/technologies/overview/content_language)
- Estudio de Szarkowska et al. con 168 personas. Los dos fragmentos subtitulados en el mismo idioma del audio se vieron con y sin sonido. Sin sonido se observó mayor carga cognitiva declarada y menor comprensión. El estudio no evaluó Brivany. [Publicación original](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0306251)
- Extractos de *Elephants Dream* y *Spring* obtenidos de Blender. Se acreditan titulares, licencias y modificaciones en el montaje y el texto de publicación. [Condiciones de Elephants Dream](https://orange.blender.org/blog/creative-commons-license-2/) · [Condiciones de Spring](https://studio.blender.org/projects/spring/pages/about/)

## Voz y alcance de la prueba

- Narración de Melodi con la voz española ya configurada en Cartesia. Cinco solicitudes a `sonic-3.6-2026-08-27` y 38,48 s de voz producida. Importe facturado sin medir.
- Prueba retrospectiva con `services.work.translation.translate_recording`, una sesión Muse con 5,15 s de audio real reproducido a ritmo de entrada. Dos intentos de traducción y dos contextos de síntesis River completados. Resultado de 2,48 s de PCM en español y primer PCM a los 7,109 s de pared (5,531 s después de listo). El ensayo no midió un altavoz físico. En el montaje se compara el audio inglés con el español en secuencia y se identifica la comparación editada. La duración de la escena no mide latencia en vivo. La voz del ejemplo es la de síntesis de traducción, distinta de la narradora.
- En el primer montaje se reutilizó la música de una pieza previa. La primera propuesta visual generada con ImageGen tuvo una solicitud de consumo no informado. El usuario pidió reemplazar ambas.

## Revisión del doblaje, la música y los créditos

El usuario señaló falta de claridad y pidió una voz de hombre mayor para Proog. Se verificó el diálogo original entre 0:57,090 y 1:01,110. La toma de revisión usa la traducción cotejada, «¡Levántate, Emo! Aquí no es seguro.», y la voz de catálogo Manuel, masculina madura y de español castellano. Una solicitud a Cartesia produjo 2,32 s de voz. La respuesta incluyó marcas para las seis palabras. Importe facturado sin medir. La edición ajusta el ritmo, nivela el audio y añade un subtítulo por idioma. El rótulo «Doblaje editado» identifica este audio, que sustituye la salida retrospectiva. La prueba automática anterior se conserva por separado. [Subtítulos del corto](https://commons.wikimedia.org/wiki/TimedText%3AElephants_Dream_%282006%29.webm.en.srt) · [Descripción de Proog](https://orange.blender.org/download/) · [Voz de catálogo](https://www.cartesia.ai/voices/library/manuel-newsman-948196a7-fe02-417b-9b6d-c45ee0803565)

Se compuso una pista de 54 s con piano suave, fondo ambiental y pulso discreto mediante síntesis local. La música se atenúa bajo Melodi y se corta durante la comparación. Se quitó el rótulo decorativo «BRIVANY 01» y se trasladaron los créditos de ambas películas a la placa final. Se mantuvieron las referencias de investigación junto a los datos del guion.

El usuario propuso clonar la voz original de Proog. Se verificó que la licencia del corto permite la reutilización comercial con atribución. El material consultado no acredita consentimiento expreso de Tygo Gernandt para clonar su voz, exigido por Cartesia. La clonación queda pendiente de ese permiso. No hubo subida de muestras, clonación ni intento de inferencia para ese propósito. [Créditos de reparto](https://orange.blender.org/press/) · [Licencia CC BY 2.5](https://creativecommons.org/licenses/by/2.5/) · [Política de Cartesia](https://www.cartesia.ai/legal/acceptable-use)

## Verificación y reproducción

`node build.mjs` recompone `index.html`. `score_nuevo.py` reproduce la pista instrumental sin consultar servicios y `mix.py` produce la mezcla local a partir de los activos existentes. HyperFrames 0.9.23 comprueba la composición y exporta el MP4 a 30 fps. Los datos de la exportación final se guardan en [delivery-verification.json](../videos/brivany-escucha-20261108/delivery-verification.json). Los originales de audio y video se conservan fuera de la bitácora. Tráfico externo total y segundos efectivos de GPU sin medir. No hubo publicación, llamadas ni cambios en el código de la aplicación. Las suites de la aplicación no se repitieron para este montaje.

El MP4 revisado decodificó 1.620 cuadros a 1920×1080 y audio AAC estéreo de 48 kHz. FFmpeg midió −16,1 LUFS y pico real de −2,6 dBTP. Se inspeccionaron ocho cuadros, incluidos diálogo, panel blanco y placa final. HyperFrames pasó sin errores, con advertencias de estructura y de tiempos o tamaño de lectura en algunos rótulos y fuentes. Las marcas de palabras acreditan la respuesta de síntesis. La comprobación auditiva humana queda pendiente.
