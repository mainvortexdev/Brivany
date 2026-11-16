# Gmail y eventos desde capturas

La release `2026-10-21.3` reutiliza el cliente Google existente y su callback registrado `https://ia.vetsa.es/oauth/google/callback`. Los estados `gmail.` se enrutan antes del callback de Calendar. Gmail usa PKCE, un enlace privado de un uso, cookie de navegador y comprobación de la cuenta propietaria mediante OIDC y el perfil de Gmail. Los tokens de Gmail se cifran en tablas separadas con AAD por propietario y contexto.

## Conectar la cuenta

El propietario puede pedir «Conecta mi Gmail» por WhatsApp o generar un enlace mediante el endpoint autenticado del dashboard `POST /api/integrations/gmail/link`. La revisión `REQUESTED_GMAIL_INVITE_REV=2026-10-21.1` envía una sola invitación a petición del propietario. Un enlace o una configuración presente no demuestra que la cuenta esté conectada: se requiere consentimiento y perfil Gmail verificado.

El alcance solicitado es `https://mail.google.com/` porque el propietario pidió acceso completo. Google lo muestra antes del consentimiento. El cliente implementa lectura, búsqueda, hilos, borradores, etiquetas, papelera y envío; no implementa borrado permanente ni cambios de delegación. El router de WhatsApp ofrece búsqueda, lectura y envío explícito con destinatario, asunto y cuerpo. Los resultados recibidos son datos no confiables. Las consultas no envían el buzón a modelos ni ejecutan instrucciones de los correos.

Gmail API debe estar habilitada en el proyecto del cliente OAuth. La aplicación existente está documentada en `vetsa-calendar-2026`; no se creó otro proyecto. El estado de habilitación, consentimiento y verificación de alcances de Gmail en Google Cloud no se ha comprobado mediante la consola durante esta implementación: el navegador local estaba desactivado. Si Gmail API está desactivada, el callback ofrece el enlace específico de activación y pide generar otro enlace.

Los envíos se reservan con un recibo durable ligado al mensaje del propietario y pasan por el lease de WhatsApp. Un resultado incierto no se reenvía automáticamente. Desconectar Gmail elimina sus credenciales locales y enlaces sin revocar el grant compartido de Calendar. Revocar la app desde Google puede afectar ambas conexiones.

## Captura y calendario

Una captura sola se guarda como contexto. Una orden actual como «Pon esto en el calendario, avísame dos horas antes y despeja esa hora» activa la extracción. También funciona enviar primero la orden y después la imagen. OCR lee el texto; las fechas sencillas se validan sin otra llamada al modelo. Un fallback JSON solo puede proponer fragmentos presentes en la fuente. La imagen no puede otorgar permisos.

El evento conserva su inicio y fin completos en `melodi_calendar_events` y `screenshot_calendar_events`, y publica una alerta popup de Calendar. El aviso de WhatsApp se calcula aparte del inicio. Entregar ese aviso no marca la cita como completada. Un cambio de fecha o una cancelación invalida los avisos en cola; se vuelve a comprobar antes del transporte. El cron existente revisa avisos cada minuto: no se garantiza precisión subsegundo.

En la captura de referencia, lunes 26 de octubre a las 12:00 PM GMT-5 equivale a `2026-10-26T17:00Z`, el fin es `2026-11-05T02:00Z` y el aviso de dos horas es `2026-10-26T15:00Z`. Cuando falta año, solo se resuelve si el día de semana coincide con una única fecha próxima válida.

«Despeja esa hora» se limita a la llegada: treinta minutos a partir del inicio, dentro del calendario gestionado por Vetsa. Se reubican tareas flexibles; una cita fija muestra su nombre y solicita una hora concreta. Una respuesta como «a las 4 pm» puede resolver una cita fija pendiente. No se vacía el intervalo completo de un evento de varios días ni otros calendarios personales. Todos los cambios se guardan en una transacción con snapshot CAS y recibo idempotente.

Fuentes: [alcances de Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes), [OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server), [eventos y avisos de Calendar](https://developers.google.com/workspace/calendar/api/v3/reference/events).
