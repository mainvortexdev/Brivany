# Galería, editor e input · 10 de noviembre de 2026

Actualización local del release instalado 0.1.0. Se conserva el historial cifrado,
la configuración y los archivos originales. Sin publicación ni cambio de versión.

- Input compacto: adjuntos desde +, micrófono de dictado independiente, botón de
  voz con ondas sin texto cuando el campo está vacío y flecha al escribir. El
  micrófono se oculta durante Live. Las miniaturas no muestran dimensiones ni
  «Activa». El dictado entrega un borrador, sin enviarlo automáticamente.
- Ruta del video selecciona el archivo en el Explorador. Las imágenes tienen
  botón equivalente y la ruta corresponde a la miniatura elegida.
- Colecciones de hasta ocho imágenes: una solicitud real por imagen, prompts
  separados, progreso por índice y entrega parcial explícita si falla una.
  «Varias» sin cantidad usa tres. Los resultados no se reintentan automáticamente.
- Galería con imagen principal y miniaturas laterales. Visor modal centrado con
  fondo difuminado, navegación con flechas, cierre Escape e iconos SVG locales.
- Anotación, borrado de píxeles con transparencia, grosor/color, deshacer y cambio
  de tamaño con proporción opcional. Guardar crea un PNG nuevo. Comentarios con
  coordenadas de la zona señalada y contexto visual real mediante image-turn.
  Copia PNG y exportación desde el visor. Quitar fondo solicita una máscara a Meta
  y aplica su alfa a los píxeles originales; los contornos generados requieren
  revisión visual. No se descarga ningún modelo local.
- Los estados animados reflejan tareas y herramientas reales. No exponen
  razonamiento privado ni simulan acciones inexistentes. Se conserva el resumen
  público expandible. Los estados terminados dejan de animarse.
- Maximizado de la ventana sin bordes limitado al área útil del monitor actual,
  conservando el estado maximizado y la restauración. Límites en píxeles nativos,
  con desplazamiento relativo al monitor y actualización por ubicación/tamaño.

## Evidencia

- Pruebas Python de galería, alcance de archivos, tickets de un uso, referencias,
  persistencia de alfa, máscaras inválidas, conservación del original, división
  de prompts y entrega parcial: `tests/test_image_studio.py`, cinco pruebas.
- Suite de 76 pruebas de regresión pertinente y recorrido de historial aprobados.
  Después de los últimos cambios, 59 pruebas de imagen, despliegue y control
  aprobadas. Son grupos superpuestos, no deben sumarse.
- `tmp/image-workspace-ui/report.json`: recorrido en Edge con puente nativo y
  respuestas de proveedor simulados. Comprueba con operaciones reales de canvas
  el input, dictado, Live, selección de miniatura, anotación, borrado, deshacer,
  redimensionado, envío de comentario con coordenadas, guardado, despacho de
  quitar fondo, portapapeles PNG, exportación y cierre. Cero llamadas de modelo
  en este recorrido de interfaz. Capturas `galeria-input.png` y `visor.png`.
- Prueba real Meta: `Exports/MetaAI-Galeria-20261110T044713Z/evidence.json`.
  Dos ilustraciones independientes, 1600 × 1600, mediante ComputerService y
  Muse Image; tres llamadas (planificador + dos imágenes). Quitar fondo usó una
  llamada adicional. Alfa comprobado y recorte inspeccionado sobre damero.
  Importe facturado desconocido. El intento anterior
  `MetaAI-Galeria-20261110T044046Z` creó dos archivos con composiciones divididas;
  se corrigió la repetición del encargo completo en cada prompt y se repitió la
  prueba por ese defecto concreto. Se conservan ambas evidencias.
- `tmp/window-maximize-native.json`: ventana nativa de prueba, límites y área útil
  1280 × 994, maximizada dentro del área útil. No se han probado otros monitores.
- `tmp/chat-images-native-installed.json`: arranque del ejecutable instalado,
  historial disponible, video previo recuperado, cero vistas pendientes y cero
  etiquetas de modelo. Maximizado instalado también 1280 × 994, dentro del área
  útil de Windows. Esta prueba se cierra automáticamente; después se abre la app
  normalmente para el usuario.
- Respaldo reversible del parche:
  `.local/motion-runtime-backups/20261110T045925Z-1880a53b/manifiesto.json`.
  Los 16 recursos instalados coinciden con los hashes del código preparado.

El recorrido de interfaz simula la escucha y la respuesta conversacional; no
demuestra calidad de micrófono físico, conversación Live ni precisión artística
universal. Las imágenes de Meta y la eliminación de fondo sí se solicitaron al
proveedor real. No se modifica la creación de videos en esta entrega.
