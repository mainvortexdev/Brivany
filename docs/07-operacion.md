# 7. Operación, privacidad y fiabilidad

## 7.1 Permisos del producto

Los permisos se otorgan por dispositivo, aplicación, proyecto, modalidad de captura y sesión. Leer una ventana no permite leer todo el disco. Observar un proyecto no permite modificarlo. Los permisos de Melodi se derivan de autorizaciones verificadas; nunca del contenido de una skill.

El usuario puede pausar captura, detener acciones y revocar un dispositivo. La revocación corta nuevas acciones y nuevas cargas. Una acción local ya ejecutada no se describe como deshecha automáticamente; el sistema consulta su resultado y ofrece la recuperación realmente disponible.

## 7.2 Manejo de contenido y datos

- Mostrar y registrar el alcance de captura antes de comenzar; soporte de audio y cámara mediante permisos separados.
- Capturar una aplicación o región autorizada, con exclusiones de campos sensibles cuando sean detectables.
- Mantener claves de proveedores en backend o almacenes seguros del dispositivo; no incrustarlas en manifiestos, logs ni distribuciones.
- Usar cifrado en tránsito y almacenamiento privado. Separar proyectos originales de artefactos de práctica.
- Dar a cada recurso dueño, espacio, finalidad, licencia y política de retención.
- Obtener permiso para compartir una demostración y sus materiales. Los proyectos de clientes no pasan al catálogo por defecto.

La captura no ofrece detección perfecta de secretos. Por eso el alcance debe limitarse antes de capturar y el usuario debe poder excluir material. Los modelos reciben fragmentos seleccionados, no un acceso general al equipo.

## 7.3 Aislamiento entre espacios

El backend valida pertenencia y rol en cada operación. PostgreSQL usará políticas de filas como defensa adicional, con rol de aplicación sin `BYPASSRLS` y distinto del propietario de tablas. El contexto del espacio se establece por transacción a partir de una identidad verificada y se limpia al devolver la conexión al pool.

Las claves compuestas evitan relaciones entre entidades de espacios diferentes. Las claves del almacén de objetos se generan en servidor y las URLs temporales se emiten después de comprobar permisos. Los workers reciben un trabajo identificado y no un filtro de espacio elegido libremente por el modelo.

## 7.4 Contenido que intenta controlar al agente

Un texto en un video, un comentario de CAD o una instrucción dentro de un proyecto puede intentar modificar el comportamiento de Melodi. Ese contenido es evidencia, no una nueva política.

Las herramientas tienen esquemas cerrados, nombres registrados y permisos externos al modelo. Las descargas de medios evitan direcciones internas, redirecciones no autorizadas y tipos inesperados. Los archivos se procesan con límites de tamaño, tiempo y recursos. Los comandos no aceptan shell libre.

## 7.5 Recuperación y protección del trabajo

| Situación | Respuesta |
|---|---|
| Cambia el proyecto activo | Invalidar la propuesta pendiente y observar nuevamente |
| Cae la conexión | Pausar acciones, conservar estado y reanudar con preflight |
| Se repite un mensaje | Deduplicar por identificador y hash de contenido |
| Se pierde el resultado de una acción | Marcar `uncertain` y reconciliar; no ejecutar otra vez por defecto |
| Falta una capacidad | Degradar a observación/revisión humana si la skill lo permite; en otro caso bloquear |
| El modelo no responde | Reintento acotado; conservar sesión y ofrecer continuar cuando vuelva |
| Se agota presupuesto | Detener inferencias adicionales y preservar progreso |
| Evidencia contradictoria | Mantener pendiente con `NEEDS_REVIEW` |
| Skill revocada | Pausar sesiones afectadas y conservar el motivo |
| Cambia la versión de la app | Invalidar perfil de compatibilidad hasta comprobarlo |

Antes de habilitar acciones, cada conector declara su estrategia de copia, undo o checkpoint. Los procedimientos que no puedan recuperarse siguen en modo de enseñanza o exigen una decisión explícita específica.

## 7.6 Política de retención propuesta

Estos valores son una propuesta de producto, no una política ya desplegada ni un requisito legal.

| Dato | Valor inicial propuesto | Condición |
|---|---|---|
| Captura cruda sin publicar | 7 días después de terminar el procesamiento | El creador puede conservarla expresamente |
| Evidencia visual de práctica | 30 días | Configurable por espacio y solicitud de borrado |
| Fuentes de una skill publicada | Mientras la versión esté distribuida y autorizada | Despublicar o sustituir si se retiran derechos |
| Progreso de aprendizaje | Mientras la cuenta lo conserve | Exportable y eliminable |
| Logs técnicos sin contenido | 30 días | Minimización y acceso restringido |
| Auditoría de acciones | 90 días como hipótesis inicial | Revisar con el contexto contractual del producto |

La eliminación debe abarcar recursos derivados e índices. La política del proveedor de modelos se verifica por modo de uso y contrato; no se promete borrado inmediato de registros externos que Brivany no controla.

## 7.7 Objetivos operativos por validar

- Respuesta pedagógica breve: objetivo inicial p95 de cinco segundos desde contexto listo, sujeto a medición por modelo.
- Comandos basados en una observación con más de cinco segundos: exigir observación nueva antes de ejecutar en el prototipo. Un conector puede imponer un límite más estricto.
- Ningún paso obligatorio aprobado con evidencia ausente, de otro proyecto o vencida.
- Recuperar progreso después de cerrar el proceso y volver a abrirlo.
- Detener nuevas acciones después de pausa o revocación.
- Registrar costo, latencia, modelo, versión de skill y conector por sesión.

Son objetivos de aceptación, no garantías de latencia o precisión existentes. La implementación deberá medirlos en una máquina y conjunto de tareas definidos.

## 7.8 Observabilidad

Cada solicitud lleva `request_id`; cada sesión, `session_id`; cada operación, `correlation_id`. Se registran transiciones, resultado de validación, herramienta, duración, cantidad de datos y costo, excluyendo contenido sensible por defecto.

Métricas: errores de API, cola pendiente, tiempo de procesamiento, latencia de observación, desconexiones, comandos inciertos, falsos `PASS`, revisión humana, errores de extracción, tokens/medios procesados, costo por sesión y costo por skill publicada.

Un panel futuro podrá mostrar estas métricas; no forma parte del entregable de interfaz. El prototipo puede exportarlas en JSON o CSV.

## 7.9 Escala y límites

El costo se calcula con tarifas actuales y uso observado: inferencias de creación + turnos de acompañamiento + verificación + medios + almacenamiento. No se asigna un costo fijo universal por alumno.

Se cachean fuentes y embeddings solo cuando aporten valor, respetando permisos y borrado. El primer buscador puede usar metadatos y texto completo de PostgreSQL. Una base vectorial separada se añade tras demostrar que mejora recuperación y justifica su operación.

El procesamiento de medios y las llamadas largas se ejecutan fuera del ciclo HTTP. La prioridad de una sesión activa es superior a la de compilaciones masivas. Las cuotas por espacio evitan que un único trabajo consuma todos los recursos.

