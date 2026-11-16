# Melodi: ordenador y llamadas desde WhatsApp

14 de noviembre de 2026. El usuario informa que envió personalmente la solicitud
de verificación de Google y aporta una captura con revisión en curso. Se toma
como declaración del titular; no equivale a aprobación de acceso a datos.
Se conserva el formulario y no se presenta otra solicitud.

## Alcance autorizado

Completar las funciones de Melodi desde WhatsApp, incluido el ordenador vinculado.
También acepta llamadas por WhatsApp y por teléfono, eligiendo canal en cada pedido.
Telnyx es el transporte telefónico existente y no se sustituye. El usuario estará
fuera del PC: no se solicitan confirmaciones que ya concedió ni se compran servicios.

## Implementación en comprobación

El receptor de Brivany inicia exclusivamente conexiones HTTPS salientes.
Cada equipo tiene un identificador y una credencial cifrada con DPAPI; el servidor
conserva solo su hash y el vínculo con la cuenta/teléfono. La vinculación normal
requiere sesión Vetsa de Brivany y teléfono probado por WhatsApp. El operador
original puede incorporarse desde la administración privada durante la migración,
sin distribuir credenciales administrativas a la aplicación.

Una orden se reclama con un lease, se guarda en el diario local y recibe
confirmación del servidor antes de ejecutarse. No vuelve a la cola pendiente.
Reinicios y respuestas inciertas no repiten acciones. Se emplea la autorización
local acotada a esa tarea, conservando carpetas autorizadas y aprobaciones de
archivos. Cancelar, aprobar y continuar se refieren al ID y nonce concretos.
Inicio de sesión, UAC y diálogos protegidos siguen requiriendo al usuario.

Las llamadas se guardan con canal, instante y zona horaria. Se admite un pedido
directo como «Llámame por WhatsApp en 20 minutos» o «Llámame por teléfono mañana
a las 9». El destinatario es el remitente verificado. Sin canal se pide ese dato;
las citas y documentos no programan llamadas. Las solicitudes fuera de alcance
no se convierten en recordatorios ni en una llamada distinta.

El host usa el gateway existente de Telnyx para teléfono. Para WhatsApp se añade
Calling API con WebRTC, permisos comprobados por Meta, señalización cifrada en D1
y audio PCM en memoria. Las claves de Meta permanecen en el Worker. La conexión
de medios necesita Brivany abierta. Una llamada vencida no se realiza al volver
el PC; no hay cambio automático de canal ni remarcado incierto.

## Pruebas locales iniciales

355 pruebas de publicación con proveedores sustituidos. Doce pruebas del host
incluyen duplicados, falta de ACK, cierre de cuenta, reinicio, expiración,
aprobaciones exactas, recibos y colas PCM acotadas. Dos peers WebRTC reales en
loopback verifican DTLS/Opus con audio sintético; no usan micrófono, altavoz,
Meta, Muse, Cartesia ni Telnyx. No prueban calidad de conversación pública.

Las comprobaciones reales del número, publicación, instalación y llamadas
públicas se registrarán por separado. No se declara todavía que Meta acepte
Calling API en el número, ni que haya sonado un teléfono. Importe y consumo
agregado de la infraestructura no medidos.

## Fuentes del protocolo

- [Meta: llamadas salientes](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/business-initiated-calls)
- [Meta: permisos de llamadas](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/user-call-permissions)
- [Meta: ajustes de Calling API](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/call-settings)
- [aiortc: API WebRTC](https://aiortc.readthedocs.io/en/latest/api.html)
- [Cloudflare: transacciones batch de D1](https://developers.cloudflare.com/d1/worker-api/d1-database/)

## Cierre de implementación y comprobación real

Publicados el servicio `brivany-whatsapp-2026-11-14.1` y el proxy del sitio,
conservando bindings, secretos, número, assets y almacenamiento. La revisión
final de bytes publicados coincide con los tres bundles locales; ocho solicitudes
públicas de comprobación confirman salud, número, sesión obligatoria y rechazo de
webhook sin firma. Versión final del servicio:
`eec3376afa0c4ae995fd1e4a5011c25b`; sitio:
`afabec4aeff049eb86d9d8c6bfd63dfb`.

Corrección de instalación: el registro anterior de siete archivos no acreditaba
la actualización del cliente activo. Habían quedado junto al directorio de la
versión, cuando el ejecutable carga `releases/0.1.0/app`. Se actualizó esa ruta
real con copias verificadas y respaldo inmutable, sin copiar perfiles de usuario.
Se incorporaron las dependencias WebRTC al Python integrado y las claves faltantes
del servicio Telnyx existente a la configuración local protegida. No se imprimieron
ni incorporaron a evidencias sus valores. Los imports del runtime integrado pasan.

El titular original quedó incorporado a este equipo mediante la administración
privada de migración: credencial local DPAPI y hash remoto ligado a su identidad
de teléfono ya probada. No se añadió una ruta pública que omita SSO. El primer
inicio de otra cuenta detiene el host; un cierre de sesión posterior no restaura
el acceso especial. Brivany permanece abierta, con estado privado `ready` y
latidos reales del equipo. La captura visual de ventana no pudo certificarse:
Computer Use agotó el tiempo de captura y su único intento de recuperación.
No se sustituyó por automatización de ventanas desde shell.

La recepción de imágenes y videos resuelve únicamente el adjunto de la orden
cifrada y su lease, hasta 50 MB. Las referencias se tratan como datos. Los resultados
compatibles de hasta 5 MB se adjuntan solo si proceden del espacio de trabajo de
la tarea o de sus agentes terminados; una ruta ajena se rechaza. Las aprobaciones
de archivos mantienen nonce y tarea exactos. Se corrigió la delegación de la
autorización de una tarea a su equipo sin ampliar carpetas ni medios seleccionados.

La programación conserva canal, destinatario propio, hora y zona. Se puede listar
y cancelar una llamada en cola; un despacho interrumpido se reconcilia por su
identidad, sin segunda llamada. Órdenes vencidas y SDP expiran aunque el equipo
no vuelva a consultar. Una sesión de voz Telnyx fallida no se anuncia como éxito
solo porque el proveedor confirmó que terminó la llamada.

Telnyx real responde `configured=true`, `outbound=true`, transporte Call Control v2.
El listener dedicado arranca sin consola y vuelve a asociar exclusivamente el
webhook de la aplicación existente al conector, sin modificar presupuestos,
límites, emisor ni perfiles. No se marcó ningún teléfono. La disponibilidad de
configuración no acredita una conversación o audición real.

Meta rechazó la activación de Calling API con `138015`. Su documentación exige
un límite de mensajería de al menos 2.000; la suscripción técnica al campo `calls`
todavía no se certifica. La conexión de voz de WhatsApp está implementada pero
no operativa públicamente. Se enviaron avisos autorizados al titular con el
bloqueo y los requisitos oficiales; Meta devolvió recibos de lectura.
Ver [requisitos y fuentes de Meta](meta-llamadas-requisitos-20261114.md).

Ensayo real del puente: una orden administrativa acotada a contar procesos,
sin simular un mensaje entrante del usuario, llegó al equipo y recibió un fallo.
Se conservó el recibo; no se repitió automáticamente. El diagnóstico aislado
posterior pasó (284 procesos) y un segundo ensayo explícito del puente, tras
reinicio normal, pasó (268 procesos), con resultado aceptado por el proveedor
para WhatsApp. Ninguno solicitó inferencia: los recibos locales registran cero
llamadas de modelo para esas tareas. La causa del primer fallo no quedó
certificada; no se afirma haber reproducido y eliminado esa causa.

## Validación final y límites

| Comprobación | Resultado y alcance |
| --- | --- |
| `melodi-whatsapp` | 360 pruebas con proveedores sustituidos |
| `whatsapp-desktop` | 17 pruebas: aislamiento, reinicios, adjuntos, resultados, voz y DTLS/Opus local |
| `whatsapp-cloud` | 34 pruebas de cuenta, backend y HTTP |
| `melodi-whatsapp-site` | Cinco pruebas de proxy y audio |
| `telephony-call-control` | 29 pruebas con voz y proveedores sintéticos, incluido cambio exclusivo de webhook |
| `orchestration` | 30 pruebas de coordinación y revisión |
| `computer` | 34 pruebas con ejecutor sustituido |
| Publicación y servicios reales | Bytes publicados, HTTP privado, latido del host y estado Telnyx comprobados |
| Control físico visible | Captura de ventana fallida; no se certifica entrada gráfica real |
| Llamadas públicas | Sin marcar; WhatsApp bloqueado por Meta, conversación Telnyx real sin ensayar |
| Google | El usuario presentó la revisión; Drive/Gmail siguen pendientes de autorización |

Hubo publicaciones, lecturas administrativas y mensajes reales autorizados.
Descargas, infraestructura, tráfico y GPU agregados no contabilizados. No se
declara consumo global cero. El protocolo WebRTC local y las suites no prueban
fidelidad del audio ni que el destinatario haya oído una llamada pública.

Se generó además, por petición del usuario, un avatar de Melodi con fondo blanco
mediante image_gen integrado: `Exports/Melodi-WhatsApp/melodi-perfil-blanco-v1.png`.
Prompt resumido junto al archivo. La imagen generada no cambia el perfil público.

## Corrección posterior del mismo hito, 14 de noviembre

Se corrigieron dos casos adicionales: al cambiar de cuenta se cancelan y retiran
las tareas y referencias de la identidad anterior antes de registrar el nuevo
dispositivo; al cancelar una llamada durante un despacho interrumpido se localiza
también la orden reservada cuyo identificador aún no había quedado en la agenda.
La reconciliación respeta la cancelación concurrente y no vuelve a marcar.
Regresiones locales: `melodi-whatsapp`, 361 pruebas; `whatsapp-desktop`, 18 pruebas,
ambas con salida 0 a las 14:26 UTC. Proveedores sustituidos y transporte local,
sin nueva llamada pública ni mensaje enviado por las suites.

La corrección quedó publicada a las 14:30:57 UTC, versión del servicio
`3c6ae90be84a4d5a8bc832cb4207d1b8`, bundle SHA-256
`6c34b970569aebe8dd0227fc567202ae0cb03d9a8a55b206b6375ffa1aca4f54`.
Se conserva el sitio y los recursos de la publicación anterior. Ocho solicitudes
HTTP de comprobación a las 14:31:33 UTC pasan y los tres bundles publicados
coinciden con sus archivos locales. Configuración Google presente no significa
consentimiento de cuentas completado.

Instalada la corrección mediante cierre y arranque normales. El manifiesto local
comprueba los 24 archivos de la actualización contra `releases/0.1.0/app`, sin
diferencias. Estado privado `ready`, sin tareas ocupadas; latido remoto habilitado
y Telnyx `configured=true`, `outbound=true`, Call Control v2. No se marcó un número
en esta comprobación. Los tres avisos autorizados (`ready`, `meta-requirements`
y `calls-availability`) tienen recibo de lectura de Meta. No se reenviaron.

La causa del primer diagnóstico remoto fallido sigue sin certificar. El segundo
ensayo correcto y las suites no acreditan control gráfico físico, audición de una
llamada ni aprobación de Meta o Google. Infraestructura y consumo agregado sin
contabilizar; se mantienen los límites anteriores.
