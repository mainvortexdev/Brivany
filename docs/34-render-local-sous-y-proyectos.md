# 34. Render local, Sous y proyectos de escritorio

28 de octubre de 2026, America/La_Paz. Continuación de los hitos locales del
objetivo de 72 horas. Este registro describe componentes comprobados; no acredita
la entrega integral ni sustituye una prueba de reconstrucción en Modal.

## Interior y materiales

Se importaron las cinco imágenes aportadas por el usuario en almacenamiento
privado local. Se conservan los originales y se producen derivados acotados y
sin metadatos EXIF. No se adjuntan fotografías a la bitácora. Su incorporación
no estima cámaras, cobertura, escala ni consistencia geométrica entre vistas.

La escena `Interior · luz natural` es una **interpretación manual**: 22 objetos,
14 GLB únicos, materiales procedurales y aproximadamente 2,54 MiB de artefactos.
No se ejecutaron modelos para crearla. La procedencia `reference_interpretation`
la distingue de la demo y de una futura reconstrucción inferida. Las unidades
son relativas; no hay medidas profesionales verificadas ni plano métrico.

El visor local incorpora materiales PBR, mapas de color/normal/rugosidad,
entorno PMREM generado en el dispositivo, iluminación solar ajustable, sombras
y cámaras de sala/comedor/dormitorio/general. Tres perfiles controlan resolución,
sombras y oclusión ambiental: económico, equilibrado y alto. El modo alto añade
SSAO; sigue siendo rasterización WebGL2, no trazado de rayos.

Los fotogramas se dibujan cuando cambia la escena; las sombras se actualizan al
cambiar geometría o luz. Las estadísticas cuentan dibujos, triángulos, recursos
y tiempo de envío CPU. No miden tiempo GPU, VRAM en bytes ni rendimiento en
móviles físicos. Se corrigió la política CSP del visor para permitir texturas
GLB incrustadas mediante `blob:`; el permiso queda limitado a las páginas del
visor. La lista de objetos tiene desplazamiento para conservar espacio útil.

## Física experimental

Rapier 0.21.0 está incorporado localmente, con licencia y hashes de distribución.
Su WASM se carga al iniciar expresamente la prueba de física. Hay gravedad,
colisiones simplificadas con cajas, pausa, elevación/caída y restauración.
La previsualización no guarda transformaciones experimentales sobre el proyecto.

La escala, masas, fricción y elasticidad se asumen para esta demostración. No
representan propiedades medidas del interior; no hay cuerpos blandos,
articulaciones de puertas ni realismo físico certificado. La habilitación de
física profesional con escala comprobada permanece pendiente.

## Sous, primera human-skill

`/sous` permite inventario persistente, cantidad/confirmación del usuario,
procedencia y caducidad incierta, registro de consumo/descarte y un recorrido
curado de cocina con pasos y revisión explícita. El carrito es simulado y no
realiza compras. No está implementado todavía un catálogo de recetas según
localidad, conversación de cocina integrada, pedidos reales ni envío a WhatsApp.

Existe un adaptador de visión Meta para inventario y verificación de pasos:
las imágenes requieren acción y consentimiento explícitos. Los candidatos no
se incorporan al inventario sin revisión; el avance visual requiere dos imágenes
distintas compatibles con el paso. Se conservan metadatos acotados de consumo e
intentos, no las imágenes ni respuestas crudas del proveedor.

El recorrido de navegador probado usa un proveedor de visión sustituido y lo
etiqueta como simulado. No demuestra calidad del modelo, seguridad alimentaria,
latencia ni facturación real. La prueba de acceso/visión Meta real queda
pendiente. La habilidad previa de oratoria y el flujo de human-skills desde video
se conservan.

## Proyectos portátiles y contenedor Desktop

`services/projects.py` crea, verifica, versiona, reabre y exporta proyectos en una
carpeta local. Incluye GLB, escena, transformaciones, historial, render y
referencias derivadas. Los originales requieren una opción explícita; los videos
y las credenciales no se copian. Hay escritura atómica y revisión optimista para
evitar sobrescribir cambios concurrentes. El ZIP no es un instalador.

`desktop/launcher.py` prepara una ventana pywebview con su propio servidor
loopback. El puente ofrece selectores nativos para abrir/guardar/exportar y
permite editar el proyecto seleccionado directamente. Los recursos se sirven
desde una carpeta verificada con enlaces opacos de sesión. JavaScript no recibe
una API de rutas arbitrarias ni de órdenes del sistema.

Las dependencias se instalaron en `.venv`; se comprobó la disponibilidad de
WebView2/.NET en Windows y los servicios del puente sin interfaz nativa. Sigue
pendiente verificar una ventana real y su recorrido completo de selectores,
empaquetado, firma e instalador, además de ejecución en macOS. El historial se
conserva en disco; sus controles en proyectos portátiles aún no están conectados.

## Conectores personales y sociales

`services/integrations.py` implementa un registro de capacidades, validación de
firma/deduplicación de webhooks WhatsApp y propuestas acotadas con revisión,
caducidad e idempotencia. Las conversaciones entrantes no conceden permisos.
Los transportes actuales son simulados; no hay OAuth real ni webhook público
montado. WhatsApp, Calendar, Gmail, Drive, redes/anuncios y control del equipo
continúan pendientes de adaptadores, cuentas y pruebas reales.

## Evidencia local conservada

- `docs/verification-history/python-20261029T023003-63bc958e.json`: 369 pruebas Python
  aprobadas; cubre servicios, contratos y HTTP locales con dependencias remotas
  sustituidas. No constituye una prueba integral de cuentas o modelos reales.
- `docs/verification-history/spatial-render-20261029T022901-e4da207b.json`: seis controles
  de navegador + HTTP + WebGL + WASM reales con referencias sintéticas. Verifica
  perfiles, cámaras, luz, adaptación y restauración de física. Permite render
  por software; no comprueba una GPU física ni fidelidad frente a fotografías.
- `docs/verification-history/sous-pipeline-20261029T023003-36d99d7a.json`: cinco controles
  de navegador/HTTP/SQLite, con tres consultas de visión sustituidas y ninguna
  consulta externa. No mide reconocimiento real.

Los informes de estas suites se incorporaron automáticamente a la bitácora
mediante `tools.verify`. Las capturas de `tmp/render-check` muestran geometría
modelada; las de `tmp/sous-pipeline` usan datos sintéticos. Ninguno de estos
ensayos consumió inferencia externa ni GPU de Modal.

La siguiente puerta espacial sigue siendo un objeto real reconstruido por Meta
en Modal, con acceso/licencia, imagen CUDA y presupuesto comprobados. El objetivo
de traducción audible de 500 ms sigue sin alcanzarse y se conserva por separado.
