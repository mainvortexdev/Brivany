# 41. Del resultado multivista al proyecto local

29 de octubre de 2026, America/La_Paz. Continuación del objetivo integral activo.
Este hito conecta el resultado preparado de habitación con biblioteca, visor,
revisión de fuentes, exportación, proyecto portátil y respaldo offline. Las
pruebas usan cámaras/profundidad conocidas y un SDK Modal sustituido. No se ha
reconstruido una habitación real ni ejecutado un nuevo modelo remoto.

## Recorrido implementado

1. Una captura preparada conserva sus fotogramas y hashes. El operador prepara
   explícitamente 2–8 vistas ordenadas. La preparación no reserva ni envía nada.
2. El despacho multivista tiene un diario independiente, presupuesto espacial
   compartido y recibo de la llamada original. La consulta y apertura locales no
   inician ni repiten una inferencia. Un coste desconocido mantiene su reserva.
3. En la captura, abrir «Resultados de reconstrucción» y consultar muestra los
   resultados guardados de objetos y habitaciones. Si una consulta falla, los
   resultados válidos de la otra siguen disponibles.
4. «Añadir al visor» verifica captura, tres hashes esperados, bytes GLB,
   manifiesto numérico, cámaras, presupuesto y recibo original antes de publicar
   una única escena. Una segunda importación abre la misma escena sin reemplazarla.
5. La superficie aparece fija, con cámaras estimadas y vista libre. La galería
   permite consultar los fotogramas de origen mediante enlaces locales firmados;
   comprueba sus bytes y procedencia antes de mostrarlos. El encuadre es aproximado,
   sin registro fotográfico exacto ni corrección del roll de la cámara inferida.
6. El proyecto portátil conserva GLB, cámaras/reportes, incertidumbre y los bytes
   exactos de `reconstruction/surface.json`. Puede guardarse, reabrirse y exportarse
   sin diarios de ejecución, conexión o nuevas llamadas al proveedor. El respaldo
   de la instalación sí conserva y corrobora diarios, reservas, capturas derivadas
   y vínculos de procedencia para restaurar la biblioteca.

La interfaz sólo ofrece consultar/importar resultados locales. La ejecución GPU
sigue en la herramienta de operador `tools.room_dispatch`, con autorización
explícita y controles cerrados por defecto. No hay un botón que compre capacidad
o ejecute reconstrucción remota al abrir una captura.

## Representación y calidad visual

Las imágenes aportan colores que ya incluyen luz y sombras. El visor utiliza
color sin iluminación adicional para esta superficie; desactiva luz de día,
sombras nuevas y oclusión ambiental incluso en calidad alta. El modo PBR y la
iluminación de las escenas de demostración e interpretación siguen disponibles.
Esto conserva el aspecto capturado; no recupera luces ni materiales físicos.

Se corrigió la transferencia de color del exportador: bajo el supuesto de entrada
sRGB, convierte a color lineal antes de escribir `COLOR_0`, como exige la
[especificación glTF de Khronos](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc).
RGBA UNORM16 conserva tonos oscuros y alineación de atributos. Una rampa sintética
de 256 niveles comprueba la conversión inversa con error máximo de un byte.
No se ha medido gestión de color de una cámara o pantalla física. El pipeline
sube a `0.2.0` para no reutilizar cachés anteriores con otra interpretación de color.

La superficie conserva los límites del worker: hasta 180 000 vértices,
300 000 triángulos y 30 MiB por GLB. La reconstrucción es por vista, sin fusión:
puede contener huecos y solapamientos. No existen todavía suelo/paredes/puertas
completos verificados, objetos separados, textura PBR recuperada, colliders
calibrados ni precisión profesional. Los valores de confianza no son probabilidades.

## Fallos encontrados y correcciones

| Hallazgo | Corrección comprobada |
|---|---|
| El proyecto portátil aceptaba rotaciones no rígidas, inversas incoherentes y reportes imposibles. | Validación de cámaras, contabilidad de píxeles/triángulos y umbrales también al reabrir offline. |
| Los literales de verificación aceptaban `0` y `1`. | Sólo se admiten booleanos JSON; las verificaciones físicas permanecen falsas. |
| Un desplazamiento de la superficie desalineaba cámaras conservadas. | Entorno fijo, transformada identidad y cuerpo estático exigidos por el contrato. |
| El proyecto perdía el manifiesto numérico original y sólo conservaba un subconjunto. | Sidecar exacto obligatorio y validación cruzada contra escena y bytes GLB en todas las versiones. |
| Colores de imagen recibían iluminación adicional y se escribían con transferencia incorrecta. | Render sin luces añadidas y exportación sRGB a lineal UNORM16; caché versionada. |
| La nueva exportación utilizaba un nombre de archivo en una función que exigía UUID. | Ruta local comprobada explícitamente; prueba de ZIP y de rechazo cuando falta el manifiesto. |
| Una consulta fallida podía ocultar resultados del otro pipeline. | Consultas independientes y conservación de resultados utilizables. |

El primer control de navegador de esta ampliación falló al esperar una descarga
porque la exportación rechazaba esa ruta. Se reprodujo en una prueba Python,
se corrigió y se vuelve a comprobar el recorrido completo. Un fallo anterior del
harness al seleccionar un control dentro de un panel cerrado se corrigió abriendo
el panel; no era un fallo del producto. La regresión del render de referencia
también usaba «el primer panel» y abría el de planos: ahora localiza «Vista y
calidad» por su nombre antes de operar sus controles.

## Evidencia y límites de las pruebas

`room-ingest` agrupa importación, contrato portátil adversarial, respaldo, HTTP
y proyecto portátil. `room-ingest-ui` recorre HTTP/SQLite, GLB real, WebGL, galería
de JPEG sintéticos, enlaces firmados, cámaras, controles fijos, duplicados y ZIP.
Los informes fechados quedan en `docs/verification-history/` y la bitácora, con capturas
sintéticas en `tmp/room-ingest-ui/`. `spatial-room` verifica geometría conocida y
transferencia de color; `room-dispatch` usa un SDK sustituido.

Resultados conservados, sin sumar suites solapadas como pruebas únicas:

| Comprobación | Resultado y evidencia |
|---|---|
| Suite Python completa | [655 PASS](verification-history/python-20261030T004906-77f6cc4f.json). |
| Importación, contratos, respaldo, HTTP y portátil | [38 PASS](verification-history/room-ingest-20261030T005742-7610a06a.json), incluyendo la validación final más estricta del material GLB. |
| Geometría conocida y transferencia de color | [16 PASS](verification-history/spatial-room-20261030T005742-e393373a.json). |
| Despacho durable, cancelación, reserva y recibo | [21 PASS](verification-history/room-dispatch-20261030T003851-92264bd8.json). |
| Recorrido multivista en navegador | [6 controles PASS](verification-history/room-ingest-ui-20261030T005314-858dd4a8.json). |
| Regresión del interior de referencia | [6 controles PASS](verification-history/spatial-render-20261030T005610-519ef577.json): tres perfiles, iluminación, imágenes, Rapier y adaptación de anchura. |

La suite completa se ejecutó antes del último endurecimiento del validador de
material GLB; ese cambio se comprobó después con las suites focalizadas de 16 y
38 pruebas. El servidor local responde en `/spaces` y sirve los nuevos módulos:
[disponibilidad HTTP](../tmp/room-ingest-ui/local-server-check.json). Esto no es
una medición de inferencia ni una prueba de cuentas externas.

No se utilizan créditos Meta/Modal en estas suites locales: cero llamadas
externas y cero segundos de inferencia GPU. WebGL permite render por software;
no acredita rendimiento, memoria GPU ni soporte en móviles o gafas físicos.
Los hashes y los diarios verifican coherencia local, no son autenticación
independiente del proveedor ni prueba de fidelidad geométrica o semántica.

El PDF de la auditoría anterior permanece como su instantánea del 29 de octubre.
Este documento registra la ampliación posterior sin modificar ese histórico.
El siguiente requisito espacial es habilitar pesos/licencia, build y presupuesto,
y comparar un único resultado real con la captura y medidas de referencia antes
de atribuir precisión o ampliar el consumo.
