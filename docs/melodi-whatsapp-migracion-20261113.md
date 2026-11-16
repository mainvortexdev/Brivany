# Brivany · migración de WhatsApp a Melodi

13 de noviembre de 2026. Implementación, publicación real y límites observados.

## Resultado publicado

El número público **+1 829 424 9873** conserva su cuenta y transporte de Meta.
El servicio activo responde como Melodi de Brivany. El código canónico se
trasladó a `workers/whatsapp`, `workers/whatsapp-media` y
`workers/whatsapp-instagram`. El directorio anterior `Vetsa-Asistant` ya no
contiene un bot ni un lanzador activo; mantiene el historial Git y una nota
del traslado. Se conservó un respaldo privado de recuperación antes de retirar
los archivos, incluidas las modificaciones locales anteriores.

El sitio `brivany.vetsa.es/whatsapp` muestra el número y cómo vincularlo. La
interfaz de Conexiones incorpora número, vínculo por cuenta Vetsa, comprobación,
desvinculación y consentimientos Google independientes para el canal cloud.
El backend conserva el token de cuenta; el renderer no lo recibe. Se instalaron
siete archivos con respaldo y se cerró/reabrió Brivany mediante su API de ciclo
de vida, sin forzar el proceso. Se confirmó el arranque con chat e historial.

La lectura real del estado local confirmó el número público y que aún se
necesita iniciar sesión en Cuenta Vetsa en esta instalación para vincularla.
El operador original conserva su acceso telefónico durante la transición.
La automatización nativa pudo leer el chat, pero falló al accionar Conexiones y
capturar su ventana. No se presenta una inspección visual nativa de esa pantalla
como completada. La navegación desde un navegador externo fue rechazada por
la protección propia del escritorio.

## Capacidades y separación de usuarios

Se comprobó una sola identidad activa, 39 skills en once familias y 39
herramientas estructuradas. Se conserva la voz de Melodi y los límites de
human-skills: primera persona, continuidad, información observada y documentos
tratados como datos, nunca como autorización.

| Familia | Adaptadores conservados |
| --- | --- |
| Conversación | Texto, archivos y notas de voz compatibles |
| Agenda | Eventos, planificación, recordatorios y rutinas solicitadas |
| Google | Calendar, búsqueda/lectura de Drive, documentos privados, Gmail y borradores/envíos solicitados |
| Documentos | PDF, Word, plantillas, referencias y entregas verificadas |
| Memoria y contactos | Capturas privadas y datos del titular |
| Proyectos | Consultas, pendientes y seguimiento |
| Finanzas | Ingresos, gastos, deudas, pagos, ahorro y suscripciones |
| Investigación | Búsqueda web y preparación de informes |
| Creatividad y redes | Imágenes, historias y operaciones de Instagram conectadas, sujetas a autorización |
| Escritorio | Puente existente del ordenador vinculado, cuando esté disponible |
| Operación del negocio | Métricas y reportes internos, solo para el operador autorizado |

La tabla enumera adaptadores implementados, no certifica un ensayo real de cada
proveedor, una conexión de PC nueva ni todas las generaciones multimedia. No se
activaron llamadas públicas ni se anuncia análisis público de video: su flag
heredado continúa desactivado.

Los códigos de vínculo son de un uso, duran diez minutos y tienen enfriamiento.
La identidad de teléfono no pasa a otra cuenta tras desvincular. Los trabajos
privados y OAuth usan el ámbito del teléfono/cuenta verificado. El nonce OAuth
determina su propietario; un parámetro de URL o el modelo no puede cambiarlo.
Se aíslan también cron, memoria, reportes, historias, trabajos de imágenes,
resultados del escritorio y correo programado. Las credenciales empresariales
y las estadísticas globales no se entregan a otras cuentas.

Los niveles no aumentan por elogios ni por conversar. Una herramienta superior
requiere una aprobación concreta del titular, cifrada, caducable y de un uso.
La ejecución conserva los parámetros aprobados; no hay otra personalidad que
preste autoridad. Se retiró la delegación hacia Dona y sus antiguas agentes.

## Datos e infraestructura

Se respaldaron código y configuración remotos y los registros pertinentes de
D1 en un directorio local protegido fuera de Git. Una exportación completa por
Wrangler no pudo completarse por FTS5; no se presenta como un respaldo integral
de toda la base. Los snapshots contienen las tablas relevantes para esta
migración y no se adjuntan a la bitácora.

La simulación local retrospectiva verificó SQL, idempotencia y dependencias de
claves foráneas con el esquema y snapshots existentes. La aplicación real creó
50 elementos de esquema y copió 26 tablas al espacio de Melodi. Conservó los
28 eventos, cinco rutinas, siete registros de artefactos y 84 mensajes de la
integración de app, entre otros registros. Se mantienen IDs, estados de entrega
y tablas originales para recuperación. Las comprobaciones de recuentos pasaron
y la consulta real de claves foráneas devolvió cero infracciones.

No se copiaron al runtime activo los objetivos personales, trabajos autónomos,
outbox ni permisos de las personalidades retiradas. Se deshabilitaron los
antiguos bootstraps y reparaciones de un solo uso para no repetir acciones.
Las filas históricas y el texto literal de los usuarios no se reescribieron
como si siempre hubieran pertenecido a Melodi.

Se pausó y reanudó la cola conservando mensajes. Se reutilizaron el Worker,
colas, D1, R2, servicios y número existentes. Las publicaciones heredaron
bindings estrictamente y conservaron los assets activos. El índice público
antes/después coincide; no se sustituyó por la copia local diferente.
La observabilidad redacta parámetros de consulta para no registrar códigos OAuth.

## Google y correcciones añadidas

Se creó el cliente web «Brivany WhatsApp · Melodi» en el proyecto `brivany` y
se guardaron sus credenciales como secretos del Worker. Los tokens antiguos
no pueden usarse con este cliente, ni siquiera si su access token sigue vigente.
Los tokens nativos de Desktop permanecen separados. El nuevo calendario de la
app se llama «Brivany · Melodi» y no elimina el calendario anterior.

La primera revisión `.1` tenía un defecto: después de quitar el correo personal
fijo, los constructores OAuth todavía rechazaban el valor vacío. Los enlaces se
enviaron sin haber probado ese POST en producción y el usuario informó un 500.
La revisión `.2` lo corrigió y añadió el recorrido real GET → POST → redirección,
con nonces de prueba distintos de los enlaces distribuidos. Calendar quedó
conectado por el titular. Se conservan los resultados de los intentos anteriores.

El aviso posterior «Google no ha verificado esta aplicación» corresponde a la
revisión de acceso a datos de Google, no al 500 anterior. Se redujeron los
permisos solicitados a Drive `drive.readonly` + `drive.file` y Gmail
`gmail.readonly` + `gmail.compose`. También se corrigió el acceso de Drive para
una cuenta verificada sin correo fijo. La revisión `.3` está publicada.

Se guardaron nueve permisos y justificaciones de los clientes Desktop y
WhatsApp en Cloud Console. El formulario final se preparó, pero no se declaró
que un video antiguo demuestra el cliente web nuevo ni que CASA esté completada.
La demostración actualizada requiere autorización del titular; la aprobación
de los permisos y la evaluación corresponden a Google y sus evaluadores.
Ver [estado de la revisión](google-whatsapp-verificacion-20261113.md).

## Pruebas y evidencia

| Comprobación | Resultado y alcance |
| --- | --- |
| Suite de publicación | 339 pruebas locales: una Melodi, dos cuentas aisladas, permisos, agenda, correo, Drive, OAuth y recibos |
| Puente nativo, cuenta y HTTP | 34 pruebas con servicios externos sustituidos |
| Sitio y proxy permitido | Cinco pruebas locales |
| Regresión Spotify | 37 comprobaciones locales de Workerd/Miniflare, sin cuenta ni solicitudes a Spotify |
| Migración retrospectiva | Repetición idempotente y claves foráneas válidas; no prueba fidelidad semántica |
| Publicación | Tres bundles remotos comprobados contra los bytes publicados; cola reanudada |
| HTTP real | Salud, número en ambos dominios, sesión obligatoria, rechazo de webhook sin firma y redirección legal |
| Consentimiento web real | Calendar, Drive y Gmail alcanzan HTTP 302 hacia el cliente y retorno correctos de Google; no demuestra aprobación de scopes |
| Calendar | Conectado realmente por el titular desde el teléfono |
| Mensajes de aviso | Recibos de Meta distinguen aceptación, entrega y lectura; sin reenvío automático incierto |

La suite histórica completa de múltiples personalidades no está aprobada:
contiene expectativas retiradas y fixtures pendientes de adaptación. Se
conservan sus fallos y el ensayo que se detuvo por timeout. La suite anterior
es el conjunto explícito de publicación de una sola Melodi.

Evidencias sanitizadas en `.local/whatsapp-migration/reports/`: `release-tests.tap`,
`migration-replay.json`, `migration-apply.json`, `migration-verify.json`,
`native-install.json`, `native-cloud-status.json`, `live-check.json` y
`delivery-and-google-status.json`. Los snapshots originales protegidos no se
copian al informe de desarrollo.

Los ensayos unitarios usan proveedores y transportes sustituidos. Hubo consultas
administrativas reales a Cloudflare/Google, publicaciones, consentimientos y
mensajes de WhatsApp autorizados. El importe y el tráfico agregado, incluidos
los trabajos de fondo, no se midieron; no se declara consumo global cero.
No se solicitó inferencia de modelos como prueba de esta migración.
