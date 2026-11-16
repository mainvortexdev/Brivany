# Estados, visor y creaciones organizadas · 10 de noviembre de 2026

Cambios instalados en el release local 0.1.0, conservando el historial y los
proyectos originales. No se publican versiones ni se generan nuevos medios.

- «Pensando» es un único evento dentro del turno, con brillo sobre el texto.
  Se elimina al primer texto, al comenzar una herramienta, al terminar, cancelar
  o fallar. Se retiró el segundo aviso del temporizador que quedaba en el pie del
  input. Los repintados conservan el evento en su turno, sin duplicarlo.
- Las tareas muestran «Trabajando» por defecto. Estado concreto, herramientas,
  eventos y agentes están dentro del desplegable. No se añade el párrafo final
  genérico a resultados visuales; también se oculta ese párrafo legado cuando
  corresponde al resultado visual anterior.
- Imágenes: hasta 380 px de ancho y 320 px de alto en el chat. Videos: hasta
  420 × 260, conservando proporción, controles y pantalla completa.
- El visor usa el PNG autorizado como data URL; la dirección blob anterior no
  estaba permitida por img-src. Se conserva la CSP. Clic en espacio vacío,
  Escape o X cierran el visor. Se comprobó además el resto de sus herramientas.
- El Explorador usa SHOpenFolderAndSelectItems con el identificador del archivo,
  evitando los problemas de comillas de /select con rutas que tienen espacios.
- Archivos finales en Documentos/Creaciones de Melodi: Documentos, Imágenes y
  Videos. Se usa la ubicación real de Documentos de Windows, incluida una
  redirección configurada por el usuario. Los recursos técnicos quedan privados.
  Una base SQLite privada asocia trabajo e índice de imagen con su entrega.
  Volver a abrirla reutiliza el archivo comprobado; una copia que el usuario haya
  modificado se conserva y se publica otra versión sin reemplazarla.
- Las nuevas creaciones se publican al guardar su recibo final, incluidos agentes
  aceptados tras revisión. Los botones de ruta revelan la entrega organizada.

Se organizaron cuatro resultados existentes: dos documentos Markdown, una imagen
y un video. Dos investigaciones antiguas apuntaban al checkout original; sus
archivos se copiaron al workspace activo y a Documentos, conservando los originales.
Los proyectos de video, assets y metadatos no se copiaron a la carpeta pública.

Evidencias:

- `tmp/chat-thinking-ui/report.json`: transporte NDJSON real y proveedor simulado;
  espera superior a cuatro segundos, repintado por otra tarea, primer token,
  cancelación, error, sustitución de turno, transición a herramienta y reducción
  de movimiento. Un solo evento, cero llamadas de inferencia.
- Recorridos de historial e imágenes aprobados. El de imágenes incluye la CSP
  real, lectura mediante ticket PNG, tamaño compacto y clic fuera para cerrar.
- 74 pruebas Python pertinentes aprobadas, incluidas siete de entregas y cinco
  de selección nativa. Comprueban clasificación, conservación de fuentes, rechazo
  de metadatos, alcance, índices, nombres, reutilización, archivos editados y
  errores de catálogo. No representan pruebas de calidad artística.
- `tmp/organized-creations-native-final.json`: ejecutable instalado saludable,
  input visible e historial recuperado. El visor decodifica el archivo real de
  1920 × 1280 sin error. La API nativa solicita la selección de la entrega.
- Explorador comprobado con CUA: carpeta
  `C:/Users/felix/Documents/Creaciones de Melodi/Videos`, un único elemento,
  `Trailer Cognira Vetsa Brivany - 339960dd.mp4`, y un elemento seleccionado de
  2,56 MB. No se abrió ningún reproductor ni se modificó el video.
- `tmp/creation-deliveries-migration.json`: las cuatro entregas y ninguna omitida.
- Respaldo del último parche:
  `.local/motion-runtime-backups/20261110T053925Z-cd836ffc/manifiesto.json`.
  El parche previo de estados y visor tiene su propio respaldo contiguo.

La aplicación se abre normalmente después de las comprobaciones nativas. Las
fuentes técnicas se conservan para futuras ediciones; las entregas son copias
finales organizadas y requieren espacio adicional de disco.
