# Portal de correo de Vetsa · 15 de noviembre de 2026

Publicado en https://software.vetsa.es/correo, dentro del servicio existente
`vetsa-whatsapp-assistant`. La navegación de Workspace incluye «Correo».
El acceso admite las dos direcciones corporativas del titular con el mismo
código temporal de WhatsApp y sesiones privadas existentes.

Las dos bandejas consultan el Gmail ya autorizado, donde Cloudflare reenvía
los mensajes corporativos. Ambas reglas entrantes estaban activas; la primera
consulta de reglas no incluyó la segunda página. El intento de añadir la regla
CEO fue rechazado por Cloudflare como duplicado y no modificó el enrutamiento.

Reply usa el Reply-To o From del mensaje original; el cliente no puede sustituir
el destinatario mediante su solicitud. Conserva asunto, In-Reply-To y References.
Usa un alias Gmail aceptado cuando está disponible; en esta instalación, las
dos direcciones salen por Brevo con dominio autenticado y remitentes activos.
La conexión y configuración reales se comprobaron sin enviar mensajes.
Los envíos realizados por Brevo no se insertan en «Enviados» de Gmail.

El usuario escribe su propio texto y elige sus adjuntos: hasta ocho archivos,
máximo 5 MiB combinados, imágenes/PDF/texto. Los mensajes se muestran como texto
sin ejecutar HTML ni cargar recursos externos. Los adjuntos entrantes no se
descargan desde este portal. La interfaz no incluye generación automática de
texto ni guarda un borrador. La autorización Gmail compartida conserva su alcance
anterior; no se pidió una ampliación de permisos.

Las mutaciones usan claves persistentes de idempotencia y huellas del contenido.
Un resultado incierto o un recibo perdido después de aceptar el proveedor no
se reenvía automáticamente. La aceptación del proveedor no demuestra entrega
final al destinatario. El límite de carga mayor solo se aplica a rutas de Reply;
el resto de la API mantiene su límite anterior.

La publicación se hizo sobre el bundle previamente descargado, con comprobación
de hash antes y después, mediante la API de sustitución de contenido. Se
preservaron assets, recursos, secretos, bindings, rutas y ajustes de ejecución.
Cloudflare retiró la anotación de mensaje de la versión anterior; se verificó
que esa diferencia informativa no afectaba la configuración de ejecución.
No se publicó el resto del árbol local modificado.

Validación: 40 pruebas locales de Gmail/portal y tres pruebas del bundle exacto,
además de empaquetado Wrangler sin publicación. Navegador: lectura, Reply vacío,
selección/eliminación de un PNG sintético, cambio de cuenta y vista móvil de
390 × 844. Comprobación real: ambas bandejas, correo Fireworks encontrado y
remitentes activos. La sesión administrativa temporal usada para comprobar
los endpoints quedó revocada. No se registraron credenciales ni contenido de
mensajes en la bitácora. No se creó borrador ni se envió correo real. Las
consultas de configuración y Gmail usaron proveedores reales; coste no medido.
