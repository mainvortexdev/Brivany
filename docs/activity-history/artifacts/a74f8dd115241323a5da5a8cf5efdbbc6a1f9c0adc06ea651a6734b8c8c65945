# Motion de Melodi · revisión con voz

1 de noviembre de 2026. El usuario rechaza las primeras piezas por planas y
solicita motion más expresivo y la voz de Melodi. Esta revisión sustituye la
dirección creativa de la primera entrega, conservando sus archivos e informes.
No modifica la voz Live, las cuentas vinculadas, la web pública ni el objetivo
de terminal que continúa en pausa.

## Implementación

El compositor incorpora una segunda edición de sus dos familias. La primera
usa cintas satinadas tridimensionales que responden a la envolvente del PCM,
se enrollan y se convierten en una tira de fotogramas con objetos cinéticos.
La segunda usa plano, despiece y ensamblaje arquitectónico, hueco real de
ventana, muebles, materiales, iluminación, sombras y entrada de cámara.
Son representaciones creativas; no una grabación de tareas ni una vivienda
medida. Se mantienen el wordmark propio y Georgia/Segoe UI.

Los planes tipados admiten cuatro frases de narración. Sólo se envían a
Cartesia cuando la petición original solicita locución: «una petición por voz»
no activa por sí sola la narración del video. Se usa el mismo modelo y la misma
voz española de `packages/providers/cartesia_melodi.py`. No se clona voz,
no se sustituye por otra, no se activa micrófono y no se utiliza audio del
usuario. La API recibe únicamente las frases de marketing creadas para estas
piezas. Una frase que no cabe detiene la exportación; no se recorta ni reintenta.

El audio WAV mono/24 kHz se coloca según sus duraciones reales y alimenta las
ondas mediante una envolvente suavizada de 125 ms. El MP4 incorpora AAC a
192 kbps, normalizado hacia −16 LUFS. El HTML autónomo usa el audio como
transporte, con reproducción, pausa y búsqueda sincronizadas. La composición
HyperFrames mantiene el timeline de búsqueda determinista y su pista `<audio>`.

No se añade música: no hay catálogo vinculado ni pista musical proporcionada.
La locución sí está incluida. La representación de WorkSpace usa los nombres
observados de sus herramientas, sin inventar prestaciones administrativas.

## Revisión y pruebas

- `motion`: 12 pruebas locales. Contrato, procedencia, cancelación, escape,
  coordinación de chat/Live y narración: cuatro frases, amplitud PCM, solicitud
  explícita, ausencia de truncación y rechazo de frases demasiado largas.
  El proveedor en esas pruebas está sustituido; no son llamadas reales.
- Producción de esta revisión: ocho peticiones reales a Cartesia, cuatro por
  película; cero nuevas planificaciones de modelo. Importe desconocido. Las
  correcciones de arte reutilizan íntegramente el audio; no llaman de nuevo a TTS.
- HyperFrames 0.8.229: ambas composiciones sin errores de lint, runtime, layout
  ni audio. Revisión de hojas de beats y tamaño teléfono; canvas no certifica
  automáticamente la lectura del texto. Se miraron además fotogramas del MP4.
- Cada entrega: 30 s, 1920×1080, 30 fps, 900 frames; búsqueda fuera de orden
  repetible, sin peticiones de red del render ni errores de página.
- La primera exportación narrada midió 77,115 s y la arquitectónica 130,076 s.
  Hubo otra revisión de cintas para retirar cruces de superficies; su tiempo
  definitivo fue 105,550 s, registrado en `tmp/motion-premium/delivery-final.json`.
  No son garantías
  de latencia ni incluyen instalación, diseño, revisión o desarrollo.
- Audio de los dos MP4 iniciales medido en −16,06/−15,93 LUFS y picos
  −0,98/−1,00 dBTP. Se analiza otra vez la revisión final. Es una comprobación
  de archivo y decodificación, no una escucha humana ni prueba de altavoces.
- `motion-ui`: reproducción del MP4 narrado real en el chat, bytes AAC
  decodificados, sonido no silenciado, tres acciones de resultado y adaptación
  320/390/768/1120 px. Planificador, productor y puente son sustitutos de QA.
- Se conserva el primer fallo de lectura del JSON de loudness: FFmpeg añadió
  texto de log después del objeto. Se corrigió el parser, sin repetir TTS ni
  render por ese fallo. Evidencia en `qa-corrections.json`.

Entregas actuales: `Exports/Brivany-motion-con-voz-final/`. La revisión anterior
permanece en `Exports/Brivany-motion-con-voz/`. Los recibos importados identifican
la autoría editorial y el uso real del mismo compositor/TTS/render; no simulan
una nueva petición al router. La app conserva control desactivado y WorkSpace
con el panel recogido. El HTTP de estado oculta trabajos sin grant, como debe.
La galería de revisión local en 8787 no es una versión web de la aplicación.
Ambos videos están abiertos y listos en el navegador integrado, con duración
30 s y sonido no silenciado. Se abrió una pestaña nueva porque la anterior
conservaba una página de error de conexión del servidor previo. No se modificó
la configuración del navegador ni se eludió una advertencia de certificados.

Límites: dos familias, sin promesa de generar cualquier película arbitraria;
Windows comprobado, macOS/Linux sin ejecutar. La habitación es conceptual,
sin simulación física/fotorrealismo certificados. Hardware de voz Live simultáneo
no probado. La red total y coste monetario no se midieron; no se declara cero.
