# Google Calendar del equipo Vetsa

La release `2026-10-09.1` resuelve resúmenes de proyectos y trabajos pendientes ofrecidos por la agente elegida. «Envíamelo por email en 4 horas» crea una entrega documental en el calendario a partir del timestamp original de recepción; reintentos y aprobaciones no desplazan el plazo. El resumen se prepara inmediatamente y espera la fecha vigente de Calendar antes de entregarse.

La release `.12` añade recordatorios mensuales verdaderos: el día del mes y la hora local se guardan cifrados, y Google recibe `RRULE:FREQ=MONTHLY;BYMONTHDAY=n`. Cambios de serie, cambios de una instancia y cancelaciones se reflejan antes de ejecutar avisos. Los meses que carecen de ese día se omiten según la misma regla de Google. El cron gratuito ahora se limita a enviar un tick a la cola existente, donde se completa la lectura y publicación de Calendar antes de las actividades: la ejecución anterior se interrumpía al alcanzar 10 ms de CPU y dejaba recordatorios sin exportar.

El recordatorio reportado de Google One/ChatGPT Plus se reparó una vez y se comprobó en la cuenta vinculada: Melodi, 7 de noviembre de 2026 a las 09:00 RD, «Cada mes el día 7», evento privado y confirmación enviada. Se conservan los nombres originales y las cuotas en el libro financiero; registrar una cuota no registra un pago. Detalles en [PERSONAL-FINANCE.md](PERSONAL-FINANCE.md) y [TEAM-VERIFICATION.md](TEAM-VERIFICATION.md).

## Estado de la integración

El propietario autorizó registrar la aplicación con `felixdanielluna40@gmail.com`. Se creó el proyecto Google Cloud **`vetsa-calendar-2026`**, se habilitó Google Calendar API y se guardaron marca, URLs públicas y permisos. El cliente web **Vetsa Calendar · Worker** está habilitado, identificado como cliente para agentes, con el retorno HTTPS indicado abajo. `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` se guardaron como secretos del Worker. La consola confirmó el estado **En producción** y que la marca está verificada, publicada y visible para los usuarios. Las páginas de información, privacidad, condiciones y eliminación responden 200 en producción. El propietario completó el consentimiento tras publicar la release `2026-10-08.9`: D1 confirmó la conexión `connected` y la primera actividad de Melodi quedó mapeada como `active`, con fecha 16 de octubre a las 09:00 RD.

El procesador de medios sigue pospuesto y es independiente de Calendar: véase [estado del alojamiento](../whatsapp-media/FREE-HOSTING.md).

## Registro OAuth

Crear un cliente de tipo **Web application** para el flujo del Worker. Registrar:

| Campo | Valor |
| --- | --- |
| Proyecto | `vetsa-calendar-2026` |
| Aplicación | `Vetsa Calendar` |
| Dominio | `vetsa.es` |
| Página de aplicación | `https://ia.vetsa.es/google-calendar.html` |
| Privacidad | `https://ia.vetsa.es/privacy.html` |
| Condiciones | `https://ia.vetsa.es/terms.html` |
| Eliminación | `https://ia.vetsa.es/data-deletion.html` |
| Redirect URI exacta | `https://ia.vetsa.es/oauth/google/callback` |
| Contacto de soporte y desarrollador registrado | `felixdanielluna40@gmail.com` |

Solicitar solo `https://www.googleapis.com/auth/calendar.app.created`, `openid` y `email`. El primero crea calendarios secundarios y administra sus eventos; los otros verifican la identidad y el correo autorizado. No solicitar `profile`, Gmail ni acceso a otros calendarios personales. [Alcances oficiales](https://developers.google.com/workspace/calendar/api/auth).

El calendario **Vetsa · Equipo** es privado y pertenece al propietario autenticado. `calendars.insert` lo añade a la lista de su creador; no hace falta `calendarList.insert` ni ampliar permisos. [Calendarios y lista del usuario](https://developers.google.com/workspace/calendar/api/concepts/events-calendars).

En **Testing**, añadir al propietario como usuario de prueba. La autorización con Calendar y su refresh token caducan a los siete días: ese estado no sirve para una vinculación permanente de rutinas. Al completar registro y páginas, seguir el flujo **In production** y las verificaciones que determine la consola para marca, dominio o alcances. Publicar no equivale a una verificación aprobada; no afirmar «aplicación verificada» sin comprobar su estado. [Audiencia, Testing y Production](https://support.google.com/cloud/answer/15549945).

## Worker y almacenamiento

- `GOOGLE_CLIENT_ID`: identificador del cliente web registrado.
- `GOOGLE_CLIENT_SECRET`: secret de Cloudflare; nunca en Git, terminal visible, WhatsApp o prompts.
- `GOOGLE_CALENDAR_OWNER_EMAIL`: `felixdanielluna40@gmail.com`.
- `OWNER_WHATSAPP_NUMBER`: propietario exacto normalizado a dígitos.
- `MEMORY_ENCRYPTION_KEY`: secret existente para derivar la clave de cifrado de Calendar.
- `VETSA_CLOUD`: binding D1 de la integración.

`google-calendar.sql` combina `GOOGLE_CALENDAR_SCHEMA` y los overrides cifrados de `google-calendar-schedules.js`; esta migración ya se aplicó a D1. Conexiones, tokens, identidad y estados OAuth/sync se cifran con AES-GCM, autenticando propietario y finalidad del registro. El mapa operativo conserva IDs, responsable, versiones y hashes, no títulos ni tokens. No reutilizar las credenciales incrustadas en los scripts antiguos. `functions/calendarService.js` era un servicio Firestore sobre `primary`, ajeno a este flujo.

## Vinculación privada

1. El propietario solicita por WhatsApp vincular Google Calendar. La asistente seleccionada genera un enlace personal de 24 horas.
2. `GET /oauth/google/start?link=…` muestra la explicación; una consulta o vista previa no consume el enlace.
3. El botón envía `POST /oauth/google/start` del mismo origen. La página usa `Referrer-Policy: same-origin`: `no-referrer` convertía el encabezado `Origin` del formulario en `null`, causando el 403 observado en Safari. El formulario permite `form-action 'self' https://accounts.google.com`: los navegadores comprueban también el destino de la redirección y la regla anterior `self` lo bloqueaba después de consumir el enlace. Solo el interstitial permite ese origen exacto; las páginas de error mantienen `self`. El POST conserva la comprobación estricta de origen y MIME; consume el enlace una sola vez y crea consentimiento de 15 minutos, cookie `HttpOnly; Secure; SameSite=Lax` y PKCE `S256`. El redirect a Google mantiene `no-referrer`, sin revelar el enlace. [Algoritmo Origin de Fetch](https://fetch.spec.whatwg.org/#append-a-request-origin-header), [regresión oficial de CSP tras una redirección](https://github.com/web-platform-tests/wpt/blob/master/content-security-policy/form-action/form-action-src-redirect-blocked.sub.html).
4. Google muestra los permisos. El Worker pide acceso offline y usa `login_hint` para la cuenta prevista.
5. El callback valida cookie, estado único y propietario antes del canje. OIDC exige `sub`, `email_verified=true` y dirección idéntica a la autorizada; `login_hint` no sustituye esa comprobación.
6. Se persiste la conexión cifrada y se crea el calendario si falta. La provisión incierta queda `pending`/`uncertain`, sin crear otro calendario automáticamente en el siguiente intento.
7. Solo la conexión persistida con un ID de calendario produce confirmación de vinculación. Aún hay que comprobar la primera sincronización; la confirmación no prueba que todas las actividades ya aparezcan.

## Sincronización y programación

El cron revisa cambios cada minuto antes de actividades vencidas. Las horas del equipo usan `America/Santo_Domingo`, no el huso del PC. La recurrencia incluye zona horaria; un offset externo válido se convierte al instante UTC correspondiente.

Las preguntas del propietario sobre agenda se resuelven desde el registro actual compartido, conservando la responsable original. Una consulta por día incluye recordatorios, rutinas, informes y publicaciones, sin acceder a contextos personales de otras integrantes. La falta de resultados y un fallo de lectura son estados diferentes. Las frases motivacionales solicitadas cada día usan una rutina diaria y `RRULE:FREQ=DAILY`, visible en **Vetsa · Equipo**; se pueden cambiar de hora o cancelar desde Calendar. Una instancia modificada se difiere hasta su nueva fecha y una cancelada no se entrega. Los informes semanales existentes conservan su frecuencia semanal.

La lectura usa `syncToken`, todas las páginas y `showDeleted=true`, sin filtros incompatibles de fecha o propiedades. Solo la última página entrega el nuevo token. Un `410` reinicia la lectura de Google conservando actividades locales. Las escrituras condicionales usan ETag; un `412` exige resolver el cambio concurrente. [Sincronización incremental](https://developers.google.com/workspace/calendar/api/guides/sync), [versiones y ETag](https://developers.google.com/workspace/calendar/api/guides/version-resources).

Solo eventos con un mapa guardado por Vetsa cambian actividades existentes. Editar nombres, descripciones o propiedades privadas no reasigna agentes ni concede herramientas. Los eventos nuevos no vinculados se ignoran. Un evento de un solo día sin hora se interpreta a las 09:00 de República Dominicana. Los eventos de varios días o recurrencias no representables se ponen en revisión y se pausa esa actividad, conservando las demás. Se envía un aviso durable desde la agente responsable; corregir la fecha o frecuencia recupera la actividad sin reasignarla.

Un tombstone puede tener solo ID y requiere el mapa existente. Una excepción de serie usa `recurringEventId` y `originalStartTime`, distinta de cancelar toda la serie. Eliminar una cita no deshace acciones ejecutadas. Recordatorios, rutinas, informes y publicaciones se incluyen según los adaptadores efectivamente conectados y verificados.

Un lease impide sincronizaciones simultáneas. Una renovación conserva el refresh token si Google no devuelve otro; una respuesta tardía no puede recrear la conexión tras desconectarla. Los logs excluyen contenidos, códigos OAuth y tokens.

Las entregas de documentos con un plazo explícito aparecen como actividades independientes de su recordatorio original. El documento se prepara al aceptar el encargo, mientras la entrega espera la fecha del evento `DOCUMENT_DELIVERY`. Cambiar su hora, pausar una fecha incompatible o eliminar ese evento también afecta a un archivo ya preparado o encolado. La agente responsable conserva el encargo y el remitente; Melodi puede redactarlo y firmarlo sin asumir el proyecto. Sin fecha de entrega en la orden, la preparación y entrega se realizan de inmediato.

## Desconexión y uso de datos

Desconectar por WhatsApp elimina conexión, tokens, estados OAuth y correspondencias de Vetsa. Conserva las tareas originales y el calendario en Google; borrarlos también requiere una solicitud separada.

Revocar desde Google impide usar el permiso. Al detectar el rechazo, Vetsa marca la conexión como pendiente de vinculación. Para borrar los datos guardados, desconectar desde WhatsApp o tramitar la eliminación publicada. El intento de revocación de Google al desconectar es best effort: su caída no revierte el borrado local.

La sincronización no usa IA. Preparar una actividad a petición o mediante una función autorizada puede enviar solo su contexto necesario a proveedores IA, nunca tokens OAuth. La política no atribuye garantías contractuales de retención o entrenamiento no verificadas a terceros. Cualquier nuevo uso requiere actualizar la información y obtener el consentimiento que corresponda. [Política de datos de las API de Google](https://developers.google.com/terms/api-services-user-data-policy).

## Verificación

```powershell
node --test cloudflare-worker/test/google-calendar-client.test.js cloudflare-worker/test/google-calendar-auth.test.js cloudflare-worker/test/google-calendar-store.test.js
```

Los dobles HTTP y SQLite real cubren previews, CAS de un solo uso, cookie/PKCE, propietario, identidad, cifrado, refresh, leases, asignación y provisión incierta. Se reprodujo el envío con un navegador real y datos sintéticos: antes `Origin: null` devolvía 403; corregirlo produjo 302 pero una segunda prueba detectó que CSP bloqueaba el destino. Tras permitir el origen exacto, el navegador llegó realmente a la pantalla Google «Iniciar sesión en Vetsa Calendar», con la cuenta prevista y los enlaces de privacidad y condiciones. Se usó el cliente público real con estado/PKCE sintéticos, sin conceder permisos. La primera comprobación de 302 era insuficiente para demostrar navegación completada. Las regresiones rechazan origen opaco, externo, ausente y MIME incorrecto sin consumir el enlace. Estas pruebas no equivalen a consentimiento ni sincronización reales de la cuenta del propietario.

El siguiente intento del propietario llegó al callback, pero el log registró `network_error` antes de cualquier subrequest HTTP. Se reprodujo en workerd con la fecha de compatibilidad real `2026-09-16`: el runtime rechaza `redirect: 'error'` antes de contactar al proveedor. Token, API, identidad y revocación usan ahora `manual` y rechazan respuestas de redirección sin seguirlas ni transmitir credenciales a otro destino. Se conservaron PKCE y las comprobaciones de consentimiento e identidad. Los fallos registran únicamente etapa y código de una lista permitida; los permisos incompletos reciben una explicación específica. [Implementación oficial de Request en workerd](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B).

Tras el consentimiento de la release `.9`, se comprobó también la interfaz real de Google Calendar en la cuenta autorizada: calendario **Vetsa · Equipo**, evento privado de Melodi «Crear planos 3D a partir de imágenes (Cognira Desktop)», viernes 16 de octubre de 2026 de 09:00 a 09:15. La vista muestra las acciones de editar y eliminar. La comprobación fue de lectura: no se cambió ni canceló el recordatorio real para probar la integración.

Antes de anunciar disponibilidad, comprobar en la cuenta autorizada: calendario visible; hora RD; cambios Google→Vetsa y WhatsApp→Google; cancelación de actividad, serie y ocurrencia; asignación intacta; revocación y desconexión; y que una cancelación recibida impida ejecutar la actividad vencida. Registrar resultados sin publicar datos privados ni tokens.
