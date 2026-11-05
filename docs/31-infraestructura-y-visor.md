# 31. Infraestructura local y primer visor 3D

28 de octubre de 2026. Alcance autorizado: separar cuentas, APIs y voz;
preparar infraestructura y entregar el primer visor funcional. La implementación
se detiene en este punto hasta que vuelva el usuario al ordenador. Los accesos
externos se reúnen en [su checklist propia](30-accesos-pendientes.md).

## Recorrido disponible

Abrir [Espacios](http://127.0.0.1:8765/spaces). La biblioteca contiene **Estudio de
luz**, una escena procedural de demostración. Cuatro archivos GLB reales
representan el entorno fijo y tres objetos editables: sillón, mesa y lámpara.
No se atribuyen a una captura o inferencia; el contrato conserva
`origin: generated_demo`, `capture_id: null` y referencias de captura vacías.

El visor permite orbitar, desplazar la cámara, acercar, seleccionar desde la
escena o la lista, inspeccionar, enfocar, mover y girar. Las posiciones numéricas
son una alternativa a arrastrar los ejes. Los cambios se guardan localmente con
revisión para evitar sobrescribir una edición de otra ventana. Se puede
restaurar la distribución inicial y restablecer solo la vista. El entorno no
se puede mover. La escala sigue siendo relativa y no hay simulación física.

**Nuevo espacio** permite crear otra demostración o preparar un MP4 local de
hasta 25 MiB y 60 s. La preparación produce seis fotogramas, manifiesto,
preflight y plan; presenta las imágenes y el estado **captura preparada,
reconstrucción pendiente**. Nunca utiliza la demo como resultado del video.
No se envía el video a un proveedor. El original temporal se elimina al terminar
o cancelar; los fotogramas y metadatos quedan en este equipo.

La UI comparte la paleta actual: blanco, negro, grises y azul. En móvil adapta
la biblioteca y el inspector; si WebGL no está disponible conserva la biblioteca
y la inspección textual, con edición desactivada. La prueba a distintos anchos
no sustituye un ensayo físico de iPhone, Android o macOS.

## Almacenamiento, trabajos y archivos

`SpatialService` usa `.local/spatial/spatial.sqlite3` y carpetas privadas del
proyecto. Hay un solo worker local, una cola máxima de diez trabajos y hasta
cien espacios. Los trabajos tienen estado, fase y progreso persistentes.
Cancelación y timeout se comprueban entre operaciones de FFmpeg acotadas: no
equivalen a interrumpir instantáneamente una decodificación ya iniciada.

Al reiniciar se marcan los trabajos incompletos como interrumpidos, se limpian
temporales propios y no se reintentan. No se publican resultados parciales como
completos. La caché de captura depende del hash de entrada y versión del
pipeline; antes de reutilizarla se comprueban manifiesto y hashes de imágenes.
Una caché corrupta no se acepta como resultado válido. Las demostraciones
reutilizan geometría determinista validada; cada escena guarda su propia edición.

La API escucha solo en loopback, conserva la comprobación Host/origen y requiere
un origen local para mutaciones. Los GLB y fotogramas se sirven mediante enlaces
firmados de ruta exacta que duran quince minutos y cambian al reiniciar el
servidor. Se verifican sus hashes antes de servirlos. La PWA guarda el shell y
los módulos del visor; no guarda respuestas API ni archivos privados. Esto no
implementa autenticación de múltiples usuarios ni enlaces compartibles remotos.

Los rechazos anteriores a leer el cuerpo responden primero y después drenan
como máximo 128 KiB durante 200 ms, sin conservar bytes. Esto corrige el reset
TCP de Windows cuando el cuerpo llega después de las cabeceras. No se intenta
leer framing inválido o chunked ni volver a consumir un JSON ya leído; el límite
de drenaje evita esperar por completo una carga rechazada arbitrariamente grande.

Three.js **0.180.0** y los addons se distribuyen localmente con licencia MIT,
integridad npm y hashes de los archivos. Los imports de addons se adaptaron a
las rutas locales. La carga y manipulación del visor no necesitan un CDN.

## Presupuesto preparado sin saldo inventado

`services/spatial/budget.py` implementa reservas transaccionales SQLite en
micro-USD: presupuesto total y por trabajo, tarifa explícita, reserva extra,
idempotencia, inicio, cancelación antes de ejecutar y conciliación posterior.
No usa floats para dinero ni supone una tarifa o saldo. Si el consumo real es
desconocido mantiene la reserva y bloquea nuevas reservas hasta conciliarla.
Si el coste supera lo reservado conserva el gasto real; no se presenta como
límite duro de facturación del proveedor.

Este mecanismo está comprobado localmente y todavía no se conecta a dispatch
remoto. La configuración distribuida permanece desactivada. Los trabajos de
demo/preparación no ejecutan modelos ni consumen GPU de inferencia.

## Preparación de Modal

`workers/spatial_modal.py` declara un factory perezoso; importar el módulo no
autentica ni crea recursos. El lock fija SDK, commits y hashes de archivos
fuente. Prevé L40S, cero contenedores mínimos, uno máximo, buffer cero,
reintentos de aplicación desactivados y un timeout de trabajo de 180 s.

El runtime valida imagen/máscara revisada, hashes, reserva, árbol completo de
pesos y artefacto GLB autocontenido. Contiene un runner específico SAM3D en
proceso acotado, cancelable, con caché y publicación de resultados completos.
Las pruebas sustituyen el modelo; **no se ha ejecutado SAM3D en GPU**.

El lock distribuido rechaza ejecución mientras falten imagen inmutable,
dependencias CUDA comprobadas, pesos, hashes, licencias y presupuesto. El digest
de imagen y los checkpoints siguen pendientes: fijar un commit no prueba que
todo el runtime sea reproducible. No se instaló el SDK en la aplicación local,
no se aceptaron licencias ni se desplegó un worker.
[Detalle y fuentes](../infra/modal/README.md).

La descarga de pesos, el arranque, la inferencia y el coste real se medirán por
separado al obtener acceso. El timeout de aplicación no limita todos los cargos;
Modal puede reprogramar contenedores tras un fallo aunque `retries=0`.

## API local

| Ruta | Alcance |
|---|---|
| `GET /api/spatial/spaces` | Biblioteca, trabajos y capacidades locales |
| `GET /api/spatial/spaces/<id>` | Espacio y fotogramas de captura |
| `GET /api/spatial/scenes/<id>` | Contrato, revisión y enlaces temporales de artefactos |
| `GET /api/spatial/jobs/<id>` | Estado y progreso |
| `POST /api/spatial/spaces/demo` | Encolar demostración procedural |
| `POST /api/spatial/captures` | Encolar preparación local de MP4 |
| `POST /api/spatial/jobs/<id>/cancel` | Solicitar cancelación |
| `POST /api/spatial/scenes/<id>/transforms` | Guardar objetos con `expected_revision` |
| `POST /api/spatial/scenes/<id>/reset` | Restaurar distribución con revisión |

No existe una ruta que invoque el worker remoto desde esta API.

## Verificación y límites

Las suites `spatial`, `spatial-worker`, `spatial-vendor` y `spatial-ui` son
locales. La prueba de navegador usa el servidor, SQLite, GLB y WebGL reales en
una instalación temporal; permite renderizado por software. Comprueba edición
persistente, captura sintética, procedencia, estados y adaptación. `spatial-local`
comprueba solo lecturas y selección en la instalación que queda abierta.

Dos verificaciones iniciales del inventario vendor fallaron porque el parser
contaba imports de ejemplos dentro de comentarios; se corrigió el verificador,
no los módulos. También se conservó un fallo de limpieza antes del estado
terminal y su corrección posterior. El preparador existente puede rechazar un
clip extremadamente corto con pocos FPS si el último seek solicitado queda
después de su último fotograma; se informa el fallo, sin inventar cobertura.

Las evidencias de esta entrega se enlazan en [VALIDACION.md](../VALIDACION.md)
y se registran en la bitácora sin adjuntar videos o fotogramas originales.
No demuestran reconstrucción real, escala métrica, calidad geométrica ni
realismo físico. Voz, APIs, cuentas y Spaik Iris quedan pendientes.

La autorización posterior del usuario permitió continuar con revisión de
capturas, historial, variantes y exportación. El [avance siguiente](32-revision-y-edicion-espacial.md)
documenta ese cambio sin atribuir estas capacidades a la primera entrega.
