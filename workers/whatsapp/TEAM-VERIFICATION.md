# Verificación del equipo — 9 de octubre de 2026

## Estado actual — release `2026-10-09.1`

Worker: `vetsa-whatsapp-assistant`. UUID publicado: `4f9549e1-25ec-47a3-b504-46b932c44798`. `/health` confirmó la release `2026-10-09.1`, Calendar configurado y análisis de medios desactivado. Rutas: `ia.vetsa.es/*`, `software.vetsa.es/*`; cron cada minuto; zona `America/Santo_Domingo`.

- Suite completa actual: **733 pruebas, 714 correctas, 19 omitidas y cero fallos**. Las omisiones se contabilizan por separado; los proveedores simulados no prueban una entrega real ni una vinculación con Google.
- El dry-run y la publicación estrictos de Wrangler compilaron la release `2026-10-09.1`, con revisión de invitación Calendar `.4`.
- La aplicación OAuth de Google está en Producción, con marca verificada y publicada. El propietario confirmó la vinculación y D1 verificó `google_calendar_connections.status=connected`. La primera actividad de Melodi quedó exportada con un mapa activo. Esto todavía no acredita una prueba manual de edición o cancelación desde Google Calendar.
- Backend privado de medios publicado: `e361d628-321d-4aba-a39d-9390f89282c5`, con **26 pruebas correctas**. La compactación del checkpoint está terminada. `PUBLIC_MEDIA_ANALYSIS_ENABLED=false`: la extracción remota permanece desactivada y no hay evidencia audiovisual nueva ni PDF/email del encargo original de Melodi.
- El acceso limitado de Northflank al repositorio fue autorizado; el propietario rechazó registrar una tarjeta. El alojamiento quedó pospuesto para una futura activación autorizada de Workers Paid. No hay proveedor gratuito de producción activo ni servidor de producción en el PC.

### Resumen de proyectos y correo con plazo — corrección `2026-10-09.1`

La continuación «Haz un resumen y envíamelo por email en 4 horas» no reconocía un documento porque no decía PDF/Word y la comprobación de recordatorio/PC recibía proyectos que mencionaban Melodi. Una ruta acotada resuelve ahora el ofrecimiento inmediatamente anterior de la agente elegida, sin consultar conversaciones privadas de otras integrantes. Una orden explícita de resumen de proyectos también funciona sin una oferta anterior. Una cita, una fuente adjunta, una orden negativa, otro tema o una instrucción compuesta de PC no autorizan esta ruta.

El informe se prepara con registros actuales del propietario: proyectos paginados, metadatos de trabajos pendientes/fallidos y documentos preparados con entrega pendiente, y las primeras 50 actividades de los próximos 90 días con su límite indicado. No usa un modelo para inventar estados, responsabilidades ni avances. Un fallo de lectura o descifrado no se presenta como ausencia de proyectos. Se conserva la identidad de correo de la responsable y la firma de Melodi como redactora. La preparación respeta `prepare_document`; una colaboración conserva el contenido y la fecha originales hasta la aprobación.

Los plazos relativos parten de `wa_messages.received_at`, guardado en la petición documental. Un reintento o una aprobación tardía no vuelve a sumar las cuatro horas. La reparación de producción verifica exclusivamente el mensaje reportado, su timestamp y el ofrecimiento en la conversación privada de Melodi; no reanuda un trabajo rechazado/cancelado ni modifica el recordatorio original de Melodi.

D1 verificó el trabajo `auto-a23RrNIHrTfi5bi3H6hQNe8iIHpgmR17E8lDXjFSro` completo, PDF privado preparado, responsabilidad de Melodi, marcador `repaired` y entrega pendiente para **9 de octubre de 2026 a las 12:37 p. m. RD** (`2026-10-09T16:37:56.087Z`). El mapa de Calendar está activo y la interfaz real de la cuenta vinculada muestra el evento privado de Melodi a las 12:37–12:52, junto al recordatorio original de Melodi. Los dos avisos durables de Melodi quedaron `sent`, con un intento cada uno. Se descargó y revisó visualmente el PDF de tres páginas, con la firma gráfica y sin asteriscos Markdown (SHA256 `51e2a3b27f88613dd5c3b1696016a9d1941f3c74ee5dc76362f1da25e4d792b2`). La entrega por email continúa pendiente de su hora; todavía no se afirma su envío.

### Finanzas y renovación mensual — corrección `.12`

El recordatorio reportado había perdido su frecuencia mensual y cambiado «ChatGPT Plus» por «ChatGPT Pulse». También se observó un cron real con `exceededCpu` a los 10 ms: no completaba la sincronización. El cron ahora solo envía un tick durable a la cola existente; el consumidor realiza primero la lectura de Calendar, después la ejecución y el mantenimiento. La primera publicación .12 confirmó un cron con 0 ms y un consumidor con 240 ms, ambos `ok`, sin excepciones. La versión final también confirmó un cron `ok`. No se contrató un servicio ni se cambió de plan.

La reparación verificó la solicitud exacta, guardó F001/F002 como cuotas USD con centavos enteros y una sola rutina mensual de Melodi, y retiró únicamente el evento puntual reportado. El marcador quedó `repaired`, el mapa de Google `active`, la próxima fecha es **7 de noviembre de 2026 a las 09:00 RD** y la confirmación durable de Melodi quedó `sent` con un intento. En la interfaz real de la cuenta vinculada se verificó «Melodi: Renovar Google One y ChatGPT Plus», «Cada mes el día 7» y visibilidad privada. No se modificaron eventos reales para probar cambios; los cambios de serie/instancia y cancelaciones se probaron con SQLite y proveedores simulados. La entrega futura de noviembre sigue pendiente.

Las cuatro agentes pueden registrar ingresos, gastos, cuentas, transferencias, cuotas activas/inactivas, presupuestos, deudas y aportes a metas de ahorro. Los informes proceden del libro cifrado del propietario, conservan la responsable y pueden prepararse como PDF/Word/email con el flujo existente. Las cuotas previstas no generan pagos ficticios; las transferencias no cuentan como consumo; los pagos de deuda sí cuentan como salidas. DOP/USD/EUR nunca se suman entre sí. Las correcciones conservan versiones cifradas y comprueban la revisión para evitar sobrescrituras. El catálogo incorpora lectura financiera desde nivel 0 para las cuatro agentes; únicamente una orden directa del propietario puede escribir movimientos. Una selección nueva para una renovación conserva a la agente elegida sin duplicar cuotas ni avisos. Uso, límites y fuentes oficiales en [PERSONAL-FINANCE.md](PERSONAL-FINANCE.md).

Los informes financieros respetan el nivel 2 de `prepare_document`. Las pruebas verificaron que no hay trabajo en cola antes de autorizar, que un rechazo no crea el documento y que una aprobación conserva el contenido cifrado del libro, el correo solicitado y a Melodi como responsable, sin regeneración con un modelo. Se comprobó también el mensaje temprano y el registro de la solicitud de aprobación solo después de informar al propietario.

### Documentos y firma de Melodi — corrección `.11`

La petición «Quiero para ese mismo día 1 documento…» se resuelve con el evento citado en la conversación privada de la agente responsable. Una fecha de entrega se guarda como actividad independiente `DOCUMENT_DELIVERY` en Calendar: la preparación comienza ahora y el outbox espera hasta su fecha actual. Los cambios, pausas y cancelaciones se comprueban de nuevo inmediatamente antes de enviar. La actividad se completa solo después de una entrega confirmada. El recordatorio de integración conserva su fecha y su responsable. Sin un plazo en la orden, la preparación y entrega continúan de inmediato; las fechas dentro de material fuente no se convierten en órdenes.

Melodi redacta sin sustituir a la agente elegida para el encargo ni asumir su implementación. El contexto conserva la empresa destinataria y las funciones no confirmadas se presentan como propuestas. DOCX utiliza estilos, encabezados, listas y tablas OOXML nativas; PDF presenta tablas con columnas proporcionadas, filas paginadas y cabecera repetida. Ambos incorporan la firma gráfica suministrada por el propietario, editada con el texto exacto «Secretaria Ejecutiva» y con transparencia en Word. No se impone a una plantilla existente ni a una conversión literal de material externo. El nombre del archivo procede del título y de la fecha RD.

La reparación única y acotada del archivo reportado de Electro Wisly se ejecutó en producción: job completo, documento revisado guardado, responsable Melodi, entrega pendiente para el **12 de octubre de 2026 a las 09:00 RD**. Melodi envió una confirmación durable con un intento. El DOCX descargado de R2 es idéntico byte por byte al documento local renderizado y revisado en sus tres páginas (SHA256 `0eafc7d15b23ff12c50f16ee2ecb93ad47531d6ed74e260cdd2010c9bd9cd689`). Se inspeccionó también el PDF de tres páginas. Al no existir LibreOffice en el runtime, la vista DOCX se obtuvo con Microsoft Word en una instancia oculta y cerrada tras exportar; no se utilizó el PC como servidor.

Google Calendar muestra la actividad privada «Melodi: Entrega de documento · Funcionalidades de Alexa AI para Electro Wisly», lunes 12 de octubre de 09:00 a 09:15, con las acciones de editar y eliminar. Esta comprobación es de lectura: no se modificaron actividades reales para probarlas. El documento está preparado y la entrega futura sigue pendiente; no se afirma que ya se haya enviado.

### Consulta de agenda y frases diarias — corrección `.10`

Melodi podía mencionar una cita del equipo en un aviso y negarla al recibir una pregunta: la conversación solo recibía agenda en el modo `melodi-owner`, y varias lecturas excluían las citas de otras integrantes. Todas las conversaciones privadas reciben ahora la agenda compartida del propietario. Una pregunta concreta como «¿Qué está programado para el 16?» consulta D1 directamente, resuelve el día en `America/Santo_Domingo` y responde con título, responsable y hora. No cambia la asignación ni consume clarificaciones ajenas; un fallo de lectura se distingue de una agenda vacía. Incluye rutinas, informes y publicaciones programadas, respeta los títulos modificados en Calendar y señala las actividades pausadas. Los chats públicos no reciben este contexto ni se comparten objetivos o conversaciones privados entre integrantes.

La petición de Melodi «envíame una frase motivacional todos los días» se trataba como conversación aislada. Ahora registra una rutina diaria cifrada, acusa recibo antes de guardar y confirma la fecha de inicio solo después de persistir. Sin hora se eligen las 10:00 RD y se comunica esa elección. La serie diaria se exporta a Google; los cambios de hora, cancelaciones e instancias se respetan antes de generar y antes de entregar. No crea documentos ni ejecuta investigación. La entrega conserva la identidad de Melodi, usa correo de respaldo ante el código WhatsApp `131047`, evita repeticiones recientes y mantiene el horario de contacto. «Melodi, detén las frases diarias» cancela ese tipo de rutina sin detener otros encargos. La recuperación de la petición reportada se aplica una sola vez; no reactiva una rutina detenida.

Las regresiones verifican consulta cruzada Melodi→Melodi, aislamiento por propietario, límites del día local, lista truncada, error de lectura, reconocimiento de una sola frase frente a recurrencia, orden de acuse y registro, entrega única, cancelación durante generación y antes de entrega, retiming de una instancia, respaldo por correo y edición de la serie diaria en Google mediante dobles HTTP/SQLite. La producción confirmó una sola rutina activa de Melodi, próxima ejecución `2026-10-09T14:00:00Z` (10:00 RD), mapa Google activo con ETag y una confirmación de Melodi enviada con un intento. La cita de Melodi del 16 permanece activa. El envío diario futuro no se acredita por anticipado.

### Google Calendar y corrección del formulario en el navegador

La integración usa `calendar.app.created`, `openid` y `email`, y un calendario privado dedicado `Vetsa · Equipo`. OAuth valida la cuenta esperada, consentimiento de un solo uso, PKCE y cookie segura; los tokens se guardan cifrados. La sincronización preserva responsable, permisos, brief y canal de entrega. Una edición del calendario no autoriza publicación ni herramientas adicionales.

Las regresiones SQLite cubren actividades no compatibles en cuarentena sin impedir otras actividades, cancelación de ocurrencias y reprogramación de un trabajo ya encolado. Al moverlo al futuro se mantiene pendiente sin entregar el documento antes del vencimiento; al llegar la fecha se aplica el título actual y se conserva la responsable. También se verifican series semanales y diarias cuyo inicio histórico ya pasó: la edición conserva la raíz de recurrencia y calcula la siguiente ejecución futura.

La pantalla «No se pudo verificar esta solicitud» se reprodujo en un navegador real con un fixture aislado y datos sintéticos: el formulario servido con `Referrer-Policy: no-referrer` enviaba `Origin: null` y recibía 403. La [norma Fetch](https://fetch.spec.whatwg.org/#append-a-request-origin-header) establece ese comportamiento para un POST de navegación. La respuesta GET del formulario ahora usa [`same-origin`](https://w3c.github.io/webappsec-referrer-policy/#referrer-policy-same-origin); el navegador envió el origen local correcto y obtuvo el 302 hacia Google con PKCE S256. La redirección OAuth mantiene `no-referrer` para no divulgar el enlace de continuación.

La regresión de la release `.7` comprobó la política de cada respuesta, `form-action 'self'`, rechazo de `Origin: null`, origen externo, origen ausente y tipo de contenido incorrecto, sin consumir el enlace ni crear consentimiento. El mismo enlace legítimo podía continuar después del rechazo. Sus 17 pruebas del módulo OAuth pasaron. La reproducción se detuvo al recibir el 302: no contactó Google ni verificó que el navegador siguiera la redirección. Esa comprobación no acreditó llegada efectiva al consentimiento ni vinculación de la cuenta del propietario.

### Segundo fallo del navegador: CSP en la redirección — corrección `.8`

El enlace de revisión `.2` quedó consumido a las `20:45:27 UTC`; se creó un consentimiento sin consumir y no se registró una conexión. Al repetir el formulario, la página mostró «Este enlace venció o ya se utilizó». Ese mensaje indica el uso previo del enlace, no prueba que Google haya mostrado o aceptado los permisos.

El formulario todavía tenía `form-action 'self'`. [WebKit comprueba esa directiva al recibir una redirección](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/DocumentLoader.cpp); las [pruebas oficiales de plataforma](https://github.com/web-platform-tests/wpt/blob/master/content-security-policy/form-action/form-action-src-redirect-blocked.sub.html) cubren el bloqueo de un POST local que redirige a otro origen. Por ello la comprobación anterior del 302 era insuficiente y podía ocultar el bloqueo posterior del salto hacia Google.

La corrección `.8` permite únicamente `form-action 'self' https://accounts.google.com` en la respuesta GET del formulario. Las respuestas de error conservan `form-action 'self'`; `default-src`, `base-uri` y `frame-ancestors` permanecen cerrados. Se mantienen la validación estricta del Origin, el tipo de contenido, el enlace de un solo uso, PKCE, cookie segura y `no-referrer` del redirect. El reintento requiere un enlace nuevo y valores OAuth nuevos; no se restablece el enlace consumido ni se reutiliza el consentimiento anterior.

Se reforzó la misma regresión OAuth para exigir esa lista exacta, ausencia de directivas CSP duplicadas, errores cerrados y un único consentimiento aun después de volver a abrir el enlace usado. Las **17 pruebas OAuth pasan**.

La reproducción completa en un navegador real utilizó una fixture aislada que llama a `handleGoogleCalendarRoute` con D1 sobre SQLite, el identificador público real del cliente y `state`/verifier ficticios. Conservó el 302 para que el navegador lo siguiera: con la política anterior permaneció bloqueado en el formulario; con la lista exacta llegó a `accounts.google.com` y mostró «Iniciar sesión en Vetsa Calendar», la cuenta `felixdanielluna40@gmail.com` y los enlaces de privacidad y términos. No se pulsó Continuar en Google ni se concedieron permisos. Esta prueba acredita navegación a la aplicación reconocida por Google, no un callback válido, una conexión persistida ni un calendario creado para el propietario.

La suite completa de la corrección `.8` terminó con **627 pruebas, 608 correctas, 19 omitidas y cero fallos**. El dry-run estricto de Wrangler pasó con revisión de invitación Calendar `.3`. La publicación `.8` quedó confirmada con UUID `7c02f85b-7f93-4a86-a08f-b42ed6f7e63a`; health real confirmó Calendar configurado y medios desactivados.

### Tercer fallo: rechazo local del transporte OAuth — corrección `.9`

El propietario llegó al consentimiento de Google y compartió los permisos, pero el callback mostró «No se pudo completar la vinculación». El consentimiento de revisión `.3` quedó consumido a las `20:54:24.182 UTC`, sin conexión persistida. El log registró `google_calendar_connect_failed`, código `network_error`, a las `20:54:24.248 UTC`. La traza contenía tres operaciones D1 y ninguna subrequest HTTP: el error ocurrió antes de contactar el endpoint de tokens.

Una prueba aislada en workerd reprodujo la causa con la misma fecha de compatibilidad `2026-09-16`: `redirect: 'error'` produjo un rechazo local inmediato. El [código oficial de workerd](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B) admite `follow` y `manual` al construir la petición; el modo `error` no es válido en ese runtime. La llamada a `fetch` como función separada sí funcionó con `manual`: el problema no era su receptor. Los proveedores simulados de Node no habían reproducido esta restricción de Workers.

La corrección usa `redirect: 'manual'` y rechaza explícitamente las respuestas 300–399 antes de leer su cuerpo o seguir el destino. Esto se aplica al intercambio y renovación de tokens y a la API Calendar; la consulta de identidad y la revocación también usan `manual` y exigen una respuesta correcta. Los fallos registran únicamente una etapa y un código de una lista permitida, sin códigos OAuth, tokens, identidad ni cuerpos del proveedor. La comprobación de los permisos sigue siendo obligatoria; un permiso insuficiente devuelve una explicación 403 y no persiste una conexión.

Las **33 pruebas específicas de cliente y OAuth pasan**. Cubren un transporte que rechaza `redirect: 'error'`, redirecciones 301, 302, 303, 307 y 308, ausencia de lectura o envío a un destino externo, y callbacks con redirección de tokens o identidad sin persistencia, creación de calendario, mensaje WhatsApp ni repetición del consentimiento consumido.

Además se ejecutó el helper de producción real dentro de Wrangler `4.149.0`/workerd, con fecha `2026-09-16`, sin bindings reales y solo credenciales, código y refresh token ficticios. El endpoint público de configuración de Google respondió HTTP 200 en modo `manual`; el intercambio y la renovación llegaron a Google y devolvieron HTTP 401, clasificado como `authorization_required`, en lugar del falso `network_error`. La evidencia está en `../tmp/calendar-runtime-probe/real-helper-result.json`. El proceso temporal se detuvo y se comprobó que el puerto local quedó cerrado. El PC se utilizó únicamente como entorno de prueba.

Esta prueba acredita la compatibilidad del transporte y el tratamiento de una respuesta real del proveedor. No valida credenciales reales, un nuevo consentimiento del propietario, la conexión persistida ni la creación de su calendario. La suite completa de `.9` terminó con **629 pruebas, 610 correctas, 19 omitidas y cero fallos**, y el dry-run estricto pasó con revisión de invitación `.4`. La publicación quedó confirmada con UUID `36a7b700-4263-442e-928a-3f2aa756e2e1`; health real confirmó `.9`, Calendar configurado y medios desactivados.

La invitación nueva `.4` de Melodi quedó `sent` en un intento, sin error, a las `21:12:05 UTC` (`5:12:05 p. m.` en República Dominicana). Su outbox es `fbe724ee-f408-4885-ad61-1e8deac534e8`. Ese recibo confirmó el envío de la invitación; la vinculación se verificó después mediante la confirmación del propietario y el registro real de D1.

El propietario confirmó «ya se vinculó». D1 verificó `google_calendar_connections.status=connected`, con `updated_at=1791493971909`, y una entrada `melodi_calendar_events` de Melodi en `melodi_google_calendar_activity_map` con estado `active`. La actividad `b7438c6f-bfc4-4520-9070-f708f4692251`, «Crear planos 3D a partir de imágenes — Cognira Desktop», quedó programada para el **16 de octubre de 2026 a las 09:00 en República Dominicana** (`13:00 UTC`), conservando a Melodi como responsable. No se había enviado su recordatorio. Esta comprobación acredita conexión y primera exportación persistida; no afirma una prueba manual de edición o cancelación en Google Calendar.

Configuración y operación: [GOOGLE-CALENDAR.md](GOOGLE-CALENDAR.md). Uso del equipo: [MELODI-WHATSAPP.md](MELODI-WHATSAPP.md).

## Historial de publicaciones

Las secciones siguientes conservan las versiones y los resultados de cada comprobación anterior. Sus cifras y estados pendientes describen ese momento, no sustituyen el estado actual de arriba.

### Calendar: primera corrección del formulario — release `2026-10-08.7`

Versión publicada `3d610655-848c-42fb-bcb3-fa23ad4bb533`, con revisión de invitación `.2`, suite 627/608/19 y dry-run estricto correcto. Health confirmó `.7`, Calendar configurado y medios desactivados. Esta versión corrigió `Origin: null`, pero la comprobación se detuvo ante el 302 y no detectó el posterior bloqueo de redirección por CSP. La segunda corrección `.8` y su reproducción completa se documentan arriba.

### Arranque inicial

Worker de producción: `vetsa-whatsapp-assistant`.

Versión publicada: `6cfa6c7e-3f1c-468f-9aec-ade0dddfc27a`.

Rutas: `ia.vetsa.es/*`, `software.vetsa.es/*`. Cron: cada minuto. `TEAM_AUTONOMY_ENABLED=true`; zona `America/Santo_Domingo`.

## Comprobaciones

- 325 pruebas pasaron, cero fallos y cero omitidas. Incluyen reloj local, AM/PM implícito, aislamiento, permisos, aprobación/rechazo, rutinas, cancelación, cuota, entrega nocturna solicitada, correo de respaldo, recuperación, concurrencia y documentos.
- Wrangler 4.127.1 compiló el paquete y publicó con `--keep-vars --strict`.
- Se aplicaron 29 sentencias de creación de tablas/índices del equipo en `vetsa-cloud-prod`, sin eliminar datos anteriores.
- `/health` devolvió `status=ok`, `teamAutonomy=true`, `timeZone=America/Santo_Domingo` y `teamRelease=2026-10-08`.
- `/api/team` sin sesión devolvió 401.
- Melodi, Melodi, Melodi y Melodi completaron el evento inicial `team_bootstrap` en producción. Las cuatro guardaron un checkpoint cifrado; cada una registró una ejecución y cero mensajes espontáneos. Los logs confirmaron `autonomy_agent_complete`, sin excepciones.
- Niveles iniciales persistidos: Melodi 3, Melodi 2, Melodi 1, Melodi 1.
- PDF real de QA revisado visualmente en dos páginas, con validación estricta de estructura, acentos, márgenes y enlaces largos. Datos de ejemplo: `../tmp/team-pdf-preview/report.pdf`.

Las entregas de email/WhatsApp, aprobación de colaboradores y cancelación se probaron con proveedores simulados y SQL real. La verificación de producción comprobó el cron, las colas, la inferencia y la persistencia de las cuatro agentes; no envió un informe de prueba al dueño ni creó una rutina ficticia. Las herramientas disponibles se informan según la integración conectada; datos privados de perfiles ajenos o publicaciones no accesibles no se inventan.

Uso y reglas: [MELODI-WHATSAPP.md](MELODI-WHATSAPP.md).

## Correcciones de asignación, ejecución y correo

Publicación del 8 de octubre, versión final `d2c20fc8-3f15-468d-869c-1d72468a0d0e`, release `2026-10-08.2`.

- 439 pruebas pasan, cero fallos u omitidas, con regresiones SQLite real y cifrado AES para las capturas. Cubren corrección «esto es para Melodi», primera respuesta antes de herramientas, reintento del trabajo original, C/T/R estables, aislamiento de sesiones, confirmaciones repetidas, promesas antiguas sin ejecución, correo por agente, avisos duraderos, ventana cerrada y transporte incierto.
- Se añadieron siete sentencias de tablas e índices en D1, conservando registros anteriores.
- `/health` confirmó la release, autonomía activa y `America/Santo_Domingo`.
- La observación de producción tras publicar registró invocaciones con `outcome=ok` y sin excepciones. Se detuvo la sesión temporal de logs al finalizar la comprobación.
- La auditoría real detectó que solo Melodi estaba registrada como remitente; el dominio `vetsa.es` estaba verificado y autenticado. Se registraron Melodi, Melodi, Melodi y Melodi mediante la API oficial y se comprobó por GET que las cinco remitentes quedaron `registered=1`, `provider_active=1`, `status=active`. La operación de configuración quedó `complete` en D1. No se enviaron correos de prueba.
- Los registros de producción comprobaron que el informe de la conversación mostrada no llegó a crear un evento de investigación ni un documento. Las respuestas generadas no constituían ejecución ni entrega. La nueva ruta distingue conversación, tarea aceptada, preparación, permiso pendiente y envío confirmado; no pregunta por seguimiento o resumen cuando ya se pidió un resultado.
- Una aprobación usa únicamente el contexto del encargo autorizado; una sesión posterior de otra tarea no puede reemplazar su contenido, destinatario o responsable. Las continuaciones de edición consultan `generate_media:3` antes de escribir o encolar.

El proveedor confirma aceptación del email mediante `messageId`; la configuración de las remitentes se verificó en producción. Las pruebas de envío/WhatsApp usan proveedores simulados: esta verificación no afirma haber entregado el informe antiguo ni haber leído un vídeo inaccesible de Instagram.

Documentación del proveedor utilizada: [registro de remitentes](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email), [API transaccional](https://developers.brevo.com/docs/send-a-transactional-email).

## Regresión «Melodi.» y recuperación del encargo

Publicación `c1da83a7-a0f1-44a0-b941-b7a444bd7e22`, release `2026-10-08.3`. Pasaron 447 pruebas, cero fallos u omitidas, y el build estricto de Wrangler. `/health` confirmó esta release, autonomía activa y `America/Santo_Domingo`.

La captura de las 11:12 mostró una dirección con punto: «Melodi. Quiero que m envíes por email…». El parser anterior no reconocía ese separador y conservaba Melodi. D1 confirmó que el evento original estaba asignado a Melodi y había agotado tres intentos con el código genérico `agent_run_failed`, sin outbox ni informe asociado. La nueva release comparte el parser inicial entre todas las rutas y mantiene intacto el contenido del documento.

El cron reasignó en producción el mismo evento a Melodi, con auditoría `assignment_repaired` y `previous_agent_emily`. La cola reclamó ese evento como Melodi. Conservó su ID, petición cifrada, fuente, canal e idempotencia: no creó otro encargo. La reparación se impide si hay una ejecución en curso, permisos, trabajo privado o mensajes asociados. Las evaluaciones correctas se auditan para que el límite de lectura no oculte solicitudes anteriores.

Las regresiones usan SQLite real y AES: Melodi con punto frente a una sesión Melodi, documento literal sin interpretar órdenes interiores, JSON cercado con evidencia válida, rechazo de JSON truncado y aviso único tras tres fallos. Aceptar un encargo o terminar la lectura no prueba entrega de un PDF; la aceptación por el proveedor requiere su propio recibo.

## Consulta de otra integrante y conexión del modo JSON

Release `2026-10-08.4`, Worker `96104788-0439-46e7-9526-afdf5618836c`: 452/452 pruebas, cero fallos u omitidas, build estricto y health de producción correctos. La captura de «Oye Melodi, que está haciendo Melodi en este momento?» reproduce una pregunta que antes pasaba a conversación sin leer el estado. Ahora identifica `agent=melodi`, `targetAgent=melodi` y consulta SQL directamente. Conserva a Melodi como hablante y explica el fallo del análisis sin pedir permiso para verificarlo. Las regresiones comprueban que no se transfieren ni revelan objetivos personales, no se genera otra tarea y no interviene el clasificador IA.

La ejecución real de Melodi identificó `requested_research_invalid_analysis`. Se comprobó que la API compartida descartaba `jsonMode` al construir la llamada a Workers AI. Antes de cambiarla se comparó el bundle local con el desplegado: idénticos, SHA-256 `3721e79d7f7d1fd80b626e18c2d16b9bb3085abb14795625a517fcf39b09db40`. Se corrigieron el envío de `response_format` y la conversión de respuestas estructuradas al contrato de texto. API publicada como `2d5b8d5c-b44c-425d-9700-8be1476c97f7`, con 39/39 pruebas y build estricto. [Contrato oficial de JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).

Después de resolver esa causa se reactivó únicamente el evento original de Melodi, con condición de fallo de análisis, propietario y ausencia de lease, permisos, outbox o documento asociado. El contenido cifrado, fuente, responsable, ID y canal no se modificaron. Esta reactivación no constituye un recibo de entrega de PDF.

La comprobación final en producción terminó el evento como Melodi en el primer intento con la API corregida: desapareció el fallo de análisis JSON. El resultado fue un bloqueo de verificación de formatos (requested_research_formats_not_verified); su outbox quedó sent. No hay PDF asociado: se comunicó que el texto recuperado no respaldaba los formatos y faltaba verificar las diapositivas o vídeo. Las dos regresiones finales cubren también el filtro de agente antes del límite de artefactos y la explicación de ese bloqueo por Melodi sin nuevas acciones ni cambios de responsable.

## Procesador audiovisual y alojamiento gratuito, 8 de octubre

Release `2026-10-08.5`, asistente `c0f09a7a-9a63-467c-9717-640ff7e6e069`: 511/511 pruebas, build estricto y health de producción correctos. La conexión `VETSA_PUBLIC_MEDIA` usa `vetsa-public-media#MediaBackend`; la visión usa `vetsa-whatsapp-assistant#MediaModels`. Ninguna añade una ruta pública de análisis o comparte la clave del proveedor. `PUBLIC_MEDIA_ANALYSIS_ENABLED=false` se mantiene mientras falta el host real.

Se crearon las colas de medios y DLQ, se aplicó el esquema a D1 y se publicó el backend con AES-256 y R2 privado. El procesador Python pasó 40 pruebas de 41; una prueba de symlink se omite por las restricciones de Windows. Las pruebas ejecutan FFmpeg, timestamps variables y el clasificador de audio CPU oficial fijado por hash. Los dobles de IA/email no acreditan lectura de la publicación original ni entrega al propietario. El dry-run de `container-host` tampoco construye una imagen ni arranca un contenedor.

Se salió de la contratación de Workers Paid sin activarlo. La cuenta y el equipo de Northflank se crearon con autorización expresa de sus términos y se seleccionó Developer Sandbox gratuito. Después se autorizó el acceso limitado al repositorio, pero el propietario rechazó registrar una tarjeta y pospuso el alojamiento para Workers Paid. El servicio de Northflank no se creó. El procesador portátil está en la rama privada `codex/free-media-processor`, con revisión [PR #3](https://github.com/mainvortexdev/Vetsa-Asistant/pull/3). No se instalaron ni ejecutaron Docker ni un servidor de producción en el PC.

El backend `f545f80e-194b-41c7-b9f6-98247fdc9dfc` introdujo lotes de ocho copias y un análisis por invocación, con continuaciones sin consumir los reintentos por fallos. Sus 24 pruebas y dry-run estricto pasaron. La revisión posterior detectó que un manifiesto de 3000 fotogramas necesitaba compactar el checkpoint; la reparación quedó publicada después en `e361d628-321d-4aba-a39d-9390f89282c5`, con 26 pruebas correctas. Las pruebas locales no acreditan la ejecución del procesador en un host remoto; la herramienta permanece desactivada hasta disponer de ese host y verificar el flujo completo.

El encargo original de Melodi sigue bloqueado por falta de evidencia audiovisual. Todavía no hay PDF ni recibo de email de este encargo. La activación solo debe ocurrir después de comprobar host, extracción del enlace exacto, procedencia, visión Vetsa, audio y conservación de identidad y permisos.
