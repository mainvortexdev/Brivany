# 43. Carga progresiva del visor

29 de octubre de 2026, America/La_Paz. Se muestra cada GLB verificado conforme
termina su descarga y lectura, priorizando el entorno. La geometría parcial se
puede observar y navegar mientras un indicador discreto informa recursos
completados. Guardado, exportación, edición, física y presentación esperan al
final: una escena parcial no se declara lista. No se generan niveles de detalle
ni se transmite progresivamente la geometría interna de un único GLB.

Las descargas se leen por bloques con límites reales de 30 MiB por artefacto y
60 MiB por escena. Una cabecera pequeña o ausente no permite superar ese límite.
El cliente comprueba SHA-256 antes de interpretar la malla. Cambiar de espacio
cancela inmediatamente la generación anterior; una respuesta tardía no puede
publicar objetos en el siguiente espacio. Ante error se retira la escena parcial
y se ofrece recarga explícita. Se liberan geometrías, materiales, texturas e
ImageBitmap compartidos mediante conjuntos de recursos para evitar duplicados.

Los diagnósticos distinguen tiempo hasta primer envío de geometría y final de
carga. Contabilizan bytes retenidos en arrays de geometría, excluyendo texturas,
renderer y controlador: **no miden memoria GPU ni finalización física del dibujo**.
El informe mantiene estimación de descarga total en `null` cuando no se conoce.

## Verificación local

- [Cuatro pruebas Node](verification-history/spatial-load-20261030T023940-4118f75f.json): tamaño declarado engañoso, bloques excesivos, aborto, lector liberado, hash y orden de activos.
- [Cuatro controles de navegador](verification-history/spatial-progressive-20261030T024059-2d3b9586.json): primer GLB visible reteniendo artificialmente el último, controles restringidos, cancelación sin publicación tardía, fallo posterior y recarga explícita, recursos y tiempos acotados al proceso local.
- [Regresión de 24 controles espaciales](verification-history/spatial-ui-20261030T023940-aebd2094.json): selección/edición persistente, historial, cámara, captura, exportación y recuperación de pérdida de contexto simulada, entre otros.

Se usan GLB generados, servidor loopback y WebGL con render por software
permitido. No hay inferencia externa. El retraso artificial sirve para comprobar
el orden de publicación; no acredita una mejora de velocidad en móviles ni
rendimiento de una reconstrucción real. El primer informe de prueba etiquetó
incorrectamente un intervalo que incluía controles posteriores; se corrigió el
recolector para medir sólo liberación de la última descarga hasta listo y se
registró otra ejecución. No se atribuye a ese intervalo una latencia de inferencia.

Continúan pendientes carga por niveles de detalle, materiales comprimidos,
medición de GPU/hardware y evaluación de proyectos reconstruidos reales. El
objetivo integral sigue activo. La revisión del correo Palabra se registra por
separado en [42](42-palabra-events-y-latencia.md).
