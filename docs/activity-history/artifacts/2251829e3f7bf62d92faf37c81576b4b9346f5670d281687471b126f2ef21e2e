# 32. Revisión de capturas y edición espacial

28 de octubre de 2026. El usuario autorizó continuar la checklist después del
primer visor, dejando pendiente cualquier intervención propia. Este avance
es local: no crea cuentas, acepta licencias, descarga pesos ni consume
inferencias. La [primera entrega](31-infraestructura-y-visor.md) conserva su
alcance histórico; [los accesos](30-accesos-pendientes.md) siguen separados.

## Revisar antes de reconstruir

**Nuevo espacio → Grabar con cámara** añade un recorrido de captura optativa.
Abrir el diálogo no pide dispositivos: **Activar cámara** solicita solo video,
sin micrófono. Presenta vista previa, grabación de hasta 59 s y 25 MiB, detener
y preparar localmente. Al detener o cerrar libera los tracks; una autorización
que llegue después de cerrar también se libera. Cambiar de ventana detiene
grabación o cámara. El video permanece en memoria hasta preparar o cerrar.

Se usa `MediaRecorder` únicamente si el navegador anuncia grabación MP4; si no,
se ofrece importar archivo. Esta negociación no acredita un encoder ni una
cámara físicos: las pruebas sustituyen el grabador por una fixture MP4 y la
cámara por un stream de canvas. iPhone, Android y macOS reales siguen pendientes;
profundidad, calibración y guía por cobertura todavía no están implementadas.

En **Espacios → Nuevo espacio → Preparar una captura**, un MP4 produce seis
fotogramas. **Revisar captura y objetos** abre una revisión guardada por captura
y número de revisión. Permite elegir un fotograma y hasta tres objetos en total,
corregir etiquetas y dibujar una región con ratón o puntero táctil. También
admite coordenadas numéricas en porcentaje.

La selección produce una máscara PNG binaria de las mismas dimensiones que el
fotograma. Su método es **rectángulo manual**, sin segmentación de Meta. Cada
objeto conserva el hash exacto del fotograma y la máscara; un cambio de fuente,
dimensiones o integridad impide usarlo. Cambiar la región desmarca su revisión
y oculta el enlace del paquete anterior. La etiqueta es declarada por la persona;
no acredita reconocimiento automático ni identidad de fabricante/modelo.

La referencia de longitud opcional exige descripción y metros. Se guarda como
`user_declared`, con `metric_scale_verified: false`: todavía no calibra una
escena ni permite afirmar dimensiones precisas.

**Preparar este objeto** exige una selección guardada y revisada. Convierte
localmente el fotograma a PNG y produce un ZIP con `image.png`, `mask.png`,
`provenance.json` y notas. El paquete lleva hashes, captura, objeto y revisión;
permanece `prepared_not_executed`. No es todavía una petición ejecutable del
worker: faltan pesos, imagen CUDA validada, reserva y dispatch autorizado. No
inventa presupuesto ni usa una clave existente al preparar el paquete.

Persistencia: `.local/spatial/reviews.sqlite3` y subcarpetas privadas de captura.
Máscaras y paquetes se sirven con enlaces firmados de quince minutos; no se
añaden a la caché PWA ni a la bitácora como imágenes originales.

## Señales orientativas de imagen

El preflight añade una reducción gris de 96 × 64 por fotograma para medir media
y dispersión de luminancia, proporción oscura/clara, varianza del laplaciano y
cambio absoluto de píxeles respecto a la muestra anterior. Se mantienen hashes
y duplicados exactos. Los umbrales señalan qué revisar; no emiten un PASS de
calidad ni certifican que un cuarto se pueda reconstruir.

El cambio de píxeles **no estima movimiento de cámara ni solapamiento
geométrico**. Cobertura, orientación, correspondencias y selección multivista
continúan pendientes. La nitidez depende también de la textura de la escena.
Si falla el análisis orientativo se conserva el fotograma con señales no
disponibles, sin inventar un resultado.

Un MP4 muy corto puede no tener un fotograma posterior al seek solicitado.
Si FFmpeg termina sin producir imagen, se permite un único fallback local al
inicio y se registra en `sampling_observations`. No es un reintento de modelo;
puede repetir la misma vista y requerir recaptura. Los tiempos siguen siendo
solicitudes de seek, **no timestamps decodificados verificados**. El JPEG usa
formato YUV de rango completo explícito para evitar rechazos del encoder en
clips sintéticos de un fotograma. Cada proceso FFmpeg está acotado a 15 s;
la cancelación del trabajo sigue siendo cooperativa, no instantánea.

## Historial, distribuciones y exportación

- **Deshacer y rehacer** conserva hasta cien estados de transformaciones en
  SQLite. Sobrevive al reinicio, mantiene revisiones monotónicas y elimina la
  rama de rehacer al editar desde un estado anterior. No duplica los GLB.
- **Guardar variante** conserva hasta veinte distribuciones con nombre. Aplicar
  una variante o restaurar la inicial crea un paso deshacible. El entorno fijo
  no se puede mover. Se rechazan escrituras sobre una revisión antigua.
- **Exportar espacio** descarga un ZIP con `scene.json`, GLB, hashes, revisión y
  procedencia. Las transformaciones se conservan en el manifiesto; no se hornean
  en cada GLB. No incluye fotogramas, video original, claves o conversaciones.
  No es exportación CAD ni validación geométrica. El límite de artefactos es
  100 MiB y el enlace es local y temporal, sin publicación remota.

El visor limita cada GLB a 30 MiB y el total de datos GLB a 60 MiB, libera
recursos al cambiar escena y evita volver a renderizar una escena inmóvil.
Una pérdida de contexto desactiva la manipulación y permite recargar lo
guardado. Las pruebas sintéticas de estos mecanismos no sustituyen medir
memoria GPU, rendimiento y soporte en macOS, iPhone o Android físicos.

La portada presenta ahora la dirección espacial con una captura del visor
procedural identificado. Conserva acceso a Melodi y human-skills; reconstrucción
remota, gafas, reconocimiento automático y física siguen señalados como futuros.

## Respaldo y recuperación local

`tools.spatial_backup` añade `create`, `inspect` y `restore`. Exige `--offline`,
rechaza que el servidor de 8765 esté escuchando o haya trabajos pendientes y no
instancia un servicio para crear la copia. No cierra Brivany automáticamente.
La aserción offline y el sondeo de puerto no bloquean otros procesos: se deben
cerrar también las herramientas que escriban en ese almacenamiento.

El ZIP conserva snapshots SQLite, artefactos de escena, fotogramas derivados,
revisiones, máscaras y paquetes de objeto. Incluye también el diario de
orquestación, sus artefactos sustitutos y presupuesto; restaurar no reenvía un
trabajo ni libera automáticamente una reserva desconocida. Lleva manifiesto con tamaños y hashes;
su contenido **es privado y no está cifrado**. Excluye `.env`, uploads, video/audio
originales y la bitácora de desarrollo. Omite el ZIP de captura derivable; sus
fotogramas y manifiestos sí se conservan. No debe adjuntarse a la bitácora ni
enviarse a terceros como parte de una evidencia.

La inspección comprueba hashes, límites, tipos y tablas SQLite admitidos,
referencias de escena/captura/historial y consistencia de revisiones. Rechaza
rutas que escapen, enlaces y archivos inesperados. Admite hasta 10 000 archivos
y 2 GiB en total, con límites menores por tipo. Restaurar valida en staging y
publica **una carpeta nueva**, sin sustituir la instalación actual ni arrancar
servidores, modelos o jobs. La selección de esa carpeta como instalación activa
es un paso operativo posterior.

Ejemplos para cuando Brivany esté cerrado; estos comandos no se ejecutaron
sobre los datos reales durante el desarrollo:

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.spatial_backup create --source .local/spatial --destination .local/espacios-backup.zip --offline
.\.venv\Scripts\python.exe -X utf8 -B -m tools.spatial_backup inspect --source .local/espacios-backup.zip --offline
.\.venv\Scripts\python.exe -X utf8 -B -m tools.spatial_backup restore --source .local/espacios-backup.zip --destination .local/spatial-restored --offline
```

La recuperación se comprobó con fixtures temporales: conservó revisión de
escena, distribución guardada, historial y selección manual. No se creó un
respaldo de las capturas o datos privados reales del usuario.

## API local añadida

| Ruta | Función |
|---|---|
| `POST /api/spatial/scenes/<id>/undo` o `/redo` | Cambio de historial con `expected_revision` |
| `POST /api/spatial/scenes/<id>/layouts` | Guardar variante con nombre y revisión |
| `POST /api/spatial/scenes/<id>/layouts/<layout>/apply` | Aplicar variante como edición |
| `GET /api/spatial/scenes/<id>/export` | ZIP de escena con enlace firmado |
| `GET` / `POST /api/spatial/captures/<id>/review` | Leer o guardar selección y longitud declarada |
| `POST /api/spatial/captures/<id>/prepare` | Preparar entrada de un objeto sin ejecutar modelo |
| `GET /api/spatial/masks/<id>/<object>` | PNG privado con enlace firmado |
| `GET /api/spatial/packages/<id>/<hash>` | ZIP privado de entrada con enlace firmado |

Los POST requieren el origen local y límites de cuerpo. No existe una nueva
ruta de dispatch remoto. El alcance es una instalación local de un usuario;
estas firmas no implementan cuentas, permisos remotos ni enlaces compartibles.

## Verificación

Las pruebas comprueban estados, archivos, hashes y comportamiento observado;
no convierten la demostración en una reconstrucción real. El recorrido de
navegador utiliza servidor y SQLite temporales, WebGL con renderizado por
software permitido y un video sintético sin audio. Los casos de máscara usan
fixtures y una conversión sustituida en unitarias; la conversión y descarga
reales de PNG se comprueban aparte en el navegador local.

Se conserva el fallo inicial del selector de prueba que encontró dos bloques
`scene-details` al añadirse la revisión. Se acotó el selector al inspector. Una
prueba concreta del MP4 de un fotograma detectó el problema de rango del encoder
JPEG, corregido antes de cerrar la entrega. La revisión independiente detectó
el enlace anterior de paquete tras cambiar con el puntero; su corrección tiene
una comprobación en el recorrido real de interfaz.

La primera comprobación visual tras optimizar el render detectó una escena
vacía al volver de captura a demo: el visor anunciaba estar listo aunque la
cámara no hubiera cambiado y faltara invalidar el render. Se corrigió para
dibujar los objetos antes de anunciar disponibilidad y se añadió esa transición
al ensayo. El pase previo no acreditaba este caso; se conserva en el histórico.

Los informes y límites finales se añaden a [VALIDACION.md](../VALIDACION.md) y la
bitácora. Voz y 500 ms, reconstrucción real, comparación de geometría, física y
dispositivos reales siguen pendientes. Spaik Iris espera la arquitectura del
usuario.
