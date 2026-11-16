# Melodi: videos e ilustraciones

9 de noviembre de 2026. Implementación y carga local verificadas en la versión
instalada de Brivany 0.1.0.

## Qué incorpora

Melodi puede diseñar un video por escenas: decide los textos, su posición,
película y fragmentos, ilustraciones, música, narración y transiciones. Meta
produce un plan editable que el motor local valida y renderiza. Ya no depende
únicamente de las dos composiciones antiguas de WorkSpace y espacio 3D.

La guía de Brivany acompaña el encargo: blanco, tinta y azul, Segoe UI, wordmark
original, Melodi e ilustraciones con capas. Se admiten imágenes seleccionadas,
formas y trazados vectoriales. No se ejecuta código propuesto por el modelo.
El resultado puede ser un MP4 o una ilustración PNG y se revisa desde el chat;
también se conservan el proyecto, el plan de escenas y los créditos.

Una ilustración estática se dirige al generador de imágenes de Meta por defecto;
el compositor de escenas se reserva para video y para una petición explícita de
SVG o vectores editables. El texto de referencia y la guía de marca se añaden
al encargo de imagen cuando corresponden.

## Cómo pedirlo

Adjunta el video o la captura que servirá como referencia y describe el resultado:

- «Crea un reel educativo de Brivany de 15 segundos, vertical, con mi video como
  referencia de ritmo. Usa la voz de Melodi, otra música y créditos al final».
- «Crea una ilustración para Instagram con esta referencia. Conserva los colores
  de Brivany y usa a Melodi como protagonista».
- «Crea una ilustración vectorial editable SVG del flujo de traducción, con el
  estilo de Brivany».
- «Del último video, cambia el título a “Escucha en tu idioma”. Conserva las
  escenas, la duración y la voz».
- «Cambia la película y usa otra música. Mantén el guion y el formato».
- «Reanuda el video anterior; conserva lo que ya estaba creado».

Si hay varios proyectos, indica cuál quieres modificar. Para una nueva película
con un encuadre concreto también puedes aportar tus propios clips seleccionados.

## Formatos

| Salida | Tamaño | Límites actuales |
|---|---|---|
| Video vertical | 1080 × 1920 | MP4, 30 o 60 fps |
| Video horizontal | 1920 × 1080 | MP4, 30 o 60 fps |
| Video cuadrado | 1080 × 1080 | MP4, 30 o 60 fps |
| Ilustración estática | Según el formato elegido | PNG |

Cada video admite de 5 a 180 segundos y hasta 24 escenas. Los créditos finales
forman parte de esa duración. La narración se comprueba antes de exportar: no se
recorta una palabra para forzarla a entrar en su escena.

## Referencias y recursos

El análisis mide cortes y energía del audio y envía a Meta hasta doce fotogramas
representativos de una referencia de hasta diez minutos. Sirve para reconocer
paleta, jerarquía, encuadres, ritmo y transiciones observables. No equivale a ver
todos los fotogramas ni a escuchar o identificar la música. No garantiza una
réplica perfecta, sincronización labial o detalles que quedaron entre muestras.
Los textos dentro de una referencia se tratan como contenido, nunca como órdenes.
El generador de imágenes puede interpretar hasta cuatro imágenes seleccionadas;
no se presenta su resolución devuelta como una garantía del proveedor.

La biblioteca inicial reúne seis películas: **Sintel, Charge, Spring, Elephants
Dream, Big Buck Bunny y Cosmos Laundromat**. Ofrece tres músicas de Scott Buckley:
**Origami, Neon y Electric Dreams**. Conserva fuente, licencia, atribución y uso
previo de música para poder pedir una pista distinta. Los fragmentos de película
se obtienen sin su audio original y los créditos se construyen al final.

Es una búsqueda dentro de un **catálogo oficial curado**, más los archivos que
seleccione el usuario; no es búsqueda global de cualquier película o canción.
Para acceder a ese catálogo no se compran recursos ni se inician sesiones en
servicios audiovisuales. No se descargan modelos locales. Los clips elegidos se
recortan localmente y los originales se conservan. La narración utiliza la voz
configurada de Melodi en Cartesia; la
planificación y la lectura visual utilizan la conexión existente de Meta.

## Revisiones y persistencia

Cada modificación crea otra revisión con vínculo al proyecto anterior. Los planes,
MP4 anteriores, recursos y créditos se conservan. Una narración que no cambia se
puede reutilizar. Un error de render deja evidencia y permite pedir continuar;
no se sobrescribe el original ni se afirma que un intento fallido terminó bien.

## Prueba real de quince segundos

La prueba pasó por el chat real de Melodi, el router `motion`, un plan de Meta y
el render local. El informe registra `handwritten_demo_plan: false`; el guion y
la composición no fueron escritos manualmente para sustituir la decisión de
Melodi. El primer intento falló al ejecutar FFmpeg. Dos revisiones posteriores
terminaron correctamente y conservaron el vínculo con el proyecto previo.

La entrega final tiene **15 segundos, 1080 × 1920, 30 fps, H.264 y AAC estéreo a
48 kHz**. Se decodificó completa sin errores y una revisión independiente no
encontró incidencias P0/P1. La sonoridad medida fue −19,2 LUFS y el pico −4,6 dBFS;
no se realizó una audición humana. El primer proyecto analizó doce fotogramas
de la referencia; las revisiones conservaron la cadena del proyecto sin volver
a subirla. Por ello, `reference_used: false` en el último trabajo no significa
que el recorrido careciera de análisis previo. Ese análisis no acredita una
réplica perfecta de la referencia.

[Video de la prueba](../Exports/Melodi-Creadora-20261110T024555Z/Melodi-Creo-Este-Video-15s.mp4)
· [Plan creado por Melodi](../Exports/Melodi-Creadora-20261110T024555Z/Plan-creado-por-Melodi.json)
· [Informe](../Exports/Melodi-Creadora-20261110T024555Z/prueba-real.json).

La última suite completa registrada pasó **127 pruebas Python y tres JavaScript**,
antes del ajuste final de rutas de ilustración. El ajuste final pasó **73 pruebas
focales**; su registro está en `tmp/melodi-routing-final-tests.log`. Estos
resultados no certifican
calidad artística universal ni una réplica exacta. El importe de inferencia no
se midió y no se publicó ningún contenido.

La ilustración final de historia que acompaña la entrega tiene otra procedencia:
Melodi creó y revisó borradores con Meta Muse Image y Codex realizó el último
ajuste con ImageGen para retirar una tarjeta de video inventada y limpiar la
composición. No se atribuye esa imagen final exclusivamente a Melodi. Su
procedencia está en [la nota de entrega](../Exports/Melodi-Creadora-20261109/LEEME.md).

## Carga en Brivany instalado

El helper `tools/stage_motion_runtime.py` está preparado y probado en instalaciones
sintéticas. Primero muestra el plan; sólo copia con `--apply`. Guarda los archivos
reemplazados fuera de la app y un `manifiesto.json` con hashes para restaurarlos.
Exige Brivany cerrado, no lo inicia y no cambia versión, feed público, User Data,
credenciales ni permisos DPAPI.

La primera carga terminó correctamente: **7.035 archivos y 470.219.571 bytes**,
con once reemplazos y 7.024 archivos nuevos. Incluye Node, FFmpeg y FFprobe ya
presentes en el equipo, sus DLL y HyperFrames en el runtime de la versión 0.1.0.
No descargó binarios ni reinstaló el programa.

El respaldo y los hashes están en
`.local/motion-runtime-backups/20261110T025912Z-c66d6485/manifiesto.json`.
Se verificaron los imports de StoryService, MotionService y MetaTools con el
Python instalado y con su carpeta de trabajo dentro de la instalación; las rutas
de los módulos confirmaron que no se estaba importando el repositorio. Ambos
servicios devolvieron `available: true`, edición 3; la guía de imagen se encontró
y el CLI instalado respondió **0.9.26**. Se preservó la ubicación de User Data,
sin leer credenciales, llamar a proveedores ni iniciar la interfaz.

La segunda carga sustituyó únicamente `planner.py` y `meta.py` (48.824 bytes),
con respaldo en
`.local/motion-runtime-backups/20261110T030443Z-16c3a310/manifiesto.json`.
Desde el Python y los módulos instalados se comprobó que una ilustración estática
elige imagen, un SVG editable elige composición y ambos servicios siguen
disponibles.

La tercera carga sustituyó únicamente `planner.py` (22.786 bytes), con respaldo
en `.local/motion-runtime-backups/20261110T030618Z-7e6acf91/manifiesto.json`.
La comprobación final desde el Python instalado confirmó que «Modifica el video
anterior cambiando las ilustraciones» conserva la ruta de video y que crear un
video con ilustraciones tampoco fuerza el generador de imágenes. Se repitieron
los checks de ilustración estática, SVG, guía y disponibilidad: todos pasaron.
Las tres cargas conservaron User Data y no iniciaron la app ni llamadas a APIs.
