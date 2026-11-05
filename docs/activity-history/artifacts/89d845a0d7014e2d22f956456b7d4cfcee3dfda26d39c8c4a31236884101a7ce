# Traducción auditiva en la pestaña · 0.4.3

WorkSpace solicita a la extensión que active la pestaña autorizada. El icono
de Brave también puede iniciar la selección. YouTube con un único video visible
lo elige automáticamente. En las demás páginas, el pin delimita el elemento.

La extensión graba la imagen y el audio del elemento en memoria. Conserva
cuatro segundos de adelanto como mínimo para transcribir y traducir mientras
se reproduce. La imagen en la pestaña espera al inicio de la frase si todavía
falta su voz. El original se oye de fondo al 12 % del nivel que tenía al empezar.
Detener desde la pestaña o WorkSpace restaura el volumen y recupera la posición
que se veía cuando es posible buscar en el video. Al final natural se reproducen
las frases restantes antes de liberar la sesión.

Muse confirma el texto y la separación de hablantes. Los subtítulos que la
página expone pueden adelantar la traducción de Meta. La extensión reutiliza
esa traducción si Muse confirma las mismas palabras. Una frase inicial estable
también puede prepararse mientras se confirma. Cartesia recibe cada intervención
completa y el navegador reproduce su voz a velocidad natural, con un ajuste de
hasta el 18 % que conserva el tono cuando debe encajar en el turno. El indicador
muestra el texto al sonar la frase y puede ocultarse desde Ajustes.

El modo Auto usa muestras del turno asociado a cada etiqueta de Muse. Combina
registro consultado a Meta, cuando es concluyente, con un cálculo local de tono
y resonancia. Una introducción corta sin evidencia suficiente queda provisional.
Dos turnos distintos con evidencia fuerte pueden corregir un registro anterior.
La clonación autorizada conserva su selección por hablante y su caché temporal.

## Evidencia

- Un ensayo local con Brave y MP4 propio reprodujo la separación de 159 ms
  entre rangos del grabador que dejaba inmóvil la imagen. Tras la corrección,
  la prueba corta con transporte sustituido reprodujo las tres frases, con
  diferencias de −17 a −21 ms, velocidad 1× y cierre natural tras la última
  frase. Informe `tmp/selected-video/inline-sync-1793776693587.json`.
- Brave aislado recibió la orden autenticada de WorkSpace con servidor local
  sustituido. La parada intencional retiró el panel, restauró el nivel de
  origen y mantuvo el enlace de control. Informe
  `tmp/selected-video/inline-sync-1793777908388.json`.
- Los primeros ensayos con APIs reales reprodujeron una sola frase y dejaron
  otras en cola. Tras corregir el búfer, el ensayo controlado con dos voces
  propias y tres turnos comprobó la secuencia A/B/A y voces masculina,
  femenina y masculina. Arrancó a 6,85 s y alineó las tres entradas entre
  −24 y −12 ms. Informe `tmp/selected-video/inline-sync-1793774577595.json`.
- Con subtítulos propios hubo tres traducciones anticipadas reutilizadas.
  El primer audio llegó a 7,27 s. La última repetición, con la corrección de
  registro, conservó A/B/A, velocidad 1× y errores de −17 a −2 ms. El primer
  audio llegó a 7,73 s. Informes `tmp/selected-video/inline-sync-1793775276128.json`
  y `tmp/selected-video/inline-sync-1793777297666.json`.
- Brave aislado reprodujo el video público de Tecnonauta sin abrir otra ventana.
  Cerca del inicio, el primer audio llegó a 5,16 s. Desde el segundo 24,
  llegó a 10,66 s. En ese segundo caso, las dos entradas quedaron a −23 y
  −19 ms del turno informado. El análisis de Meta fue inconcluyente y la
  selección acústica eligió dos voces femeninas. Estos ensayos verifican la
  reproducción y el reloj de video. La correspondencia de esas voces con los
  hablantes del clip queda abierta. Informes
  `tmp/selected-video/inline-sync-1793775413326.json` y
  `tmp/selected-video/inline-sync-1793777182092.json`.
- Desde el segundo 54 del mismo video, la primera intervención del presentador
  en pantalla se asignó a una voz masculina. El turno siguiente se reprodujo
  con una voz femenina. El primer audio llegó a 6,14 s y las dos entradas
  quedaron a 0 y −23 ms. Informe `tmp/selected-video/inline-sync-1793777657642.json`.

Las medidas de primer audio comienzan con la captura seleccionada. La
sincronización medida se refiere a los turnos de Muse, con precisión limitada
por el proveedor. La reproducción de la voz se comprobó con el navegador.
Quedan pendientes la escucha física y un arranque de hasta seis segundos en
turnos largos. Los ensayos con proveedores tienen coste agregado desconocido.
Los informes guardan métricas y estados, sin medios ni transcripciones.
