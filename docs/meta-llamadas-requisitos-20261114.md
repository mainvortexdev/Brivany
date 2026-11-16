# Llamadas de WhatsApp: requisitos de Meta

Consulta de documentación oficial el 14 de noviembre de 2026. No es una
aprobación de Meta ni una solicitud enviada en nombre de una empresa.

| Requisito | Estado observado en Brivany |
| --- | --- |
| Número en WhatsApp Cloud API con permisos de mensajería | Mensajes reales aceptados, entregados y leídos |
| Aplicación suscrita a la cuenta y al campo `calls`, o señalización SIP | Receptor firmado implementado; suscripción de `calls` todavía sin certificar |
| Límite diario de mensajería de al menos 2.000 destinatarios únicos | La activación real fue rechazada por Meta con `138015` |
| Calling API habilitada en el número | Pendiente: Meta no aceptó la activación |
| Autorización del usuario para la llamada en el modelo de permisos | Comprobación y tarjeta oficiales implementadas; no se pidió permiso ni se marcó como prueba |
| Transporte de voz | WebRTC/Opus comprobado localmente, sin llamada pública por WhatsApp |

El error `138015` significa «Calling cannot be enabled». La solución que indica
Meta es comprobar que el límite de mensajería del número sea de 2.000 o más.
No significa que se deban enviar 2.000 mensajes a esta conversación.

Según la documentación de límites, existen vías para solicitar el nivel de
2.000: verificación de empresa, verificación por el proveedor cuando corresponda,
o mensajes legítimos entregados a destinatarios distintos fuera de las ventanas
de servicio, con plantillas de calidad, cumpliendo el volumen y periodo que Meta
describe. Meta analiza la calidad y decide la aprobación. No se enviaron mensajes
masivos, no se contrataron servicios ni se declararon datos de empresa inexistentes.

Meta también limita los países de los números empresariales que pueden iniciar
llamadas. No basta con que la integración tenga código WebRTC. Existen modelos
de llamadas basados en permisos y otros basados en calidad para países elegibles;
Brivany comprueba las acciones permitidas por la API antes de marcar y no deduce
consentimiento de una conversación o de un archivo.

Telnyx es el canal telefónico independiente ya integrado. El error de Meta y la
revisión de acceso a datos de Google no impiden usar ese canal.

Fuentes:

- [Requisitos de Calling API](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling#step-1--prerequisites)
- [Error 138015 y requisitos técnicos 138018](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/troubleshooting)
- [Límites de mensajería y vías de ampliación](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [Permisos del usuario](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/user-call-permissions)

Comprobación posterior del 14 de noviembre: la documentación de límites especifica
que el nivel se comparte entre los números del portafolio empresarial y cuenta
destinatarios únicos fuera de las ventanas de atención, en un periodo móvil de
24 horas. Puede consultarse en [Administrador de WhatsApp](https://business.facebook.com/wa/manage/home/)
→ Herramientas de la cuenta → Límites de mensajes. El campo de API vigente es
`whatsapp_business_manager_messaging_limit`; `messaging_limit_tier` está obsoleto.
