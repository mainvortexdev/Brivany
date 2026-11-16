# Melodi: agenda por teléfono y opciones de llamada

Auditoría del 8 de noviembre de 2026. El usuario reservó las llamadas reales
para una fase posterior. Después pidió minimizar costes y evitar solicitudes
de permiso por destinatario, y confirmó que su número de WhatsApp Business
ya está registrado **directamente en Meta**.

## Resultado de agenda

**La conversación telefónica todavía no tiene acceso a la agenda.**
Se completaron doce turnos sintéticos: seis solicitudes en cada formato de
audio de `LivePhoneSession` (PCM de SIP y μ-law de Twilio). Los doce llegaron
a la ruta de conversación, que recibió únicamente el encargo autorizado.
Hubo cero propuestas y cero ejecuciones de herramientas de calendario.

| Solicitud durante una llamada | Estado observado | Trabajo que falta |
| --- | --- | --- |
| Consultar la agenda | Pendiente de integración | Conectar la lectura autorizada al contexto de la llamada. |
| Agendar una cita | Pendiente de integración | Preparar, confirmar y ejecutar los datos concretos desde la sesión. |
| Encontrar un hueco libre | No implementada en telefonía | Consultar disponibilidad completa y calcular intervalos. |
| Hacer espacio para una cita | No implementada | Proponer desplazamientos sin perder eventos ni ocultar conflictos. |
| Organizar varias citas | No implementada | Plan revisable, confirmación y seguimiento de cada cambio. |
| Desplazar un evento | No implementada | Identificación del evento, cambio de inicio/final y comprobación posterior. |

El verificador devuelve código **1** y `ready_for_calendar_calls: false`.
Ese resultado registra una capacidad ausente; los turnos de audio simulados
sí terminaron. No se acredita ejecución de agenda a partir de una respuesta
hablada preparada por el sustituto del modelo.

## Recorrido del código

- [SIPGateway](../services/telephony/sip.py) y
  [MediaBridge de Twilio](../services/telephony/realtime.py) usan la sesión
  `LivePhoneSession`. `LiveProviders.sentences` llama a `stream_reply` con
  instrucciones que declaran expresamente que no tiene herramientas.
- [La conversación de reserva](../services/telephony/dialogue.py) también
  limita las acciones a la conversación. No despacha operaciones de agenda.
- [El proveedor Google](../packages/providers/personal.py) sí implementa
  `calendar.list` y `calendar.create`, a través del
  [diario de propuestas y aprobaciones](../services/integrations.py).
  Esa ruta está separada de la conversación telefónica.
- La lista actual está limitada a veinte eventos y devuelve `more_available`;
  no basta para declarar libre un intervalo cuando hay más resultados.
- [La agenda visual de WorkSpace](../desktop/experience/workspace-daily.js)
  guarda sus eventos en el almacenamiento del navegador y exporta ICS.
  No está sincronizada con Google ni expuesta como herramienta telefónica.
- La vista actual de Conexiones permite vincular cuentas; los formularios
  antiguos de operaciones se retiraron. La revisión de futuras acciones por
  llamada necesita un flujo visible propio.

Antes de las pruebas reales hacen falta el puente de herramientas por sesión,
la fuente de agenda elegida, fechas con zona horaria, lectura completa y
confirmación de los cambios. Hay que verificar conflictos, recurrencias,
eventos de día completo, cancelación, repetición de solicitudes y resultados
inciertos. Una persona llamada no debe recibir permisos sobre toda la agenda
por el mero hecho de contestar.

Google ofrece [Freebusy para disponibilidad](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
y [Events.patch para actualizar un evento](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch).
Son piezas disponibles en el proveedor, pendientes de implementar en Brivany.

## Pruebas y límites

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Seis solicitudes en dos formatos telefónicos | Auditoría completada; agenda no preparada | [Datos](../tmp/verification/phone-calendar-audit-20261108T053815-ebdc671b.json), [ejecución registrada](../tmp/verification/phone-calendar-audit-20261108T053814-bc9f5210.json) |
| Telefonía y callbacks de reserva | 17 pruebas pasaron | [Informe](../tmp/verification/telephony-20261108T053448-57740ed5.json) |
| Streaming telefónico | 6 pruebas pasaron | [Informe](../tmp/verification/telephony-realtime-20261108T053221-9442c3e4.json) |
| SIP, revisión y recorridos RTP locales | 11 pruebas pasaron | [Informe](../tmp/verification/telephony-sip-20261108T053221-e9e58e64.json) |
| Proveedores personales | 9 pruebas pasaron | [Informe](../tmp/verification/personal-providers-20261108T053221-93218783.json) |
| OAuth Google | 21 pruebas pasaron | [Informe](../tmp/verification/google-oauth-20261108T053221-adde3334.json) |
| Preparación de solicitudes por chat | 15 pruebas pasaron | [Informe](../tmp/verification/chat-requests-20261108T053448-e9b5d6d2.json) |
| Conexiones en Edge y HTTP local | Pasó; cuentas y API sustituidas | [Informe](../tmp/verification/connections-20261108T053513-5e00036c.json) |

Las 79 pruebas unitarias y los recorridos locales no certifican una gestión
real de calendario ni la latencia de Muse, Meta o Cartesia. La auditoría nueva
usa reconocimiento, respuesta, voz y transporte sustituidos; la suite SIP
adicional prueba SIP/RTP nativo de loopback. Ninguna de estas ejecuciones
marcó a la red pública, consumió API de IA o modificó un calendario real.

Se conserva el primer intento fallido del banco de auditoría: faltaba el número
de secuencia en los acuses sintéticos. Se corrigió el banco y se repitió.
El primer intento de Conexiones no encontró Playwright; la repetición usó el
runtime local ya disponible y pasó, sin descargar dependencias.

## WhatsApp y coste mínimo

El número registrado directamente en Meta permite estudiar una integración
directa, evitando el cargo de canal de un intermediario. Su habilitación para
mensajería no acredita todavía la habilitación de voz ni su conexión con Melodi.

WhatsApp distingue las llamadas entrantes de las salientes de empresa. Las
salientes requieren permiso del destinatario: lo confirma el
[anuncio oficial de WhatsApp](https://whatsappbusiness.com/blog/whatsapp-business-calling-api/).
Existe permiso temporal o permanente hasta revocación; el permanente evita
repetir la solicitud mientras siga vigente.
[Referencia de permisos](https://www.twilio.com/docs/voice/whatsapp-business-calling#business-initiated-call-permission-and-consent).

| Vía | Permiso técnico previo por destinatario | Coste y encaje |
| --- | --- | --- |
| WhatsApp entrante a Melodi, directo a Meta | No hay solicitud de llamada saliente: la persona inicia la llamada | Candidato para reducir costes. Falta habilitar voz y verificar la tarifa directa y el audio con Meta. |
| WhatsApp saliente desde el número registrado | Sí, aunque puede ser permanente | No cumple el requisito de llamar a cualquier destinatario sin ese trámite. |
| SIP/Netelip hacia móviles de RD | No exige la autorización de WhatsApp ni registrar cada destino en Brivany | Alternativa comprobada en documentación para ese requisito. No requiere comprar DID si se sale en oculto; se pagan minutos. |
| Zadarma hacia RD | Telefonía SIP convencional | Publica US$0,10/min en Ahorro y US$0,12/min en Estándar para los destinos RD listados; no mejora la tarifa comercial publicada por Netelip. |

Netelip confirma que [se puede llamar sin comprar un número, saliendo en oculto](https://www.netelip.com/centro-de-ayuda/sip-trunking/preguntas-frecuentes/).
Publica celulares de RD **desde 3,01 centavos/min**, consumo sin cuota de
llamadas y facturación por segundos; la tarifa del destino y los impuestos
deben comprobarse en el panel.
[Tarifas Netelip](https://www.netelip.com/do/tarifa-de-llamadas/).
La comparación anterior de Zadarma procede de su
[tarifario oficial para RD](https://zadarma.com/es/tariffs/calls/dominican-republic/).

La [tabla de Twilio](https://www.twilio.com/en-us/whatsapp/pricing) separa
conectividad Meta y canal Twilio. Publica conectividad Meta entrante a RD de
US$0/min y saliente de US$0,01160/min, más US$0,005/min de canal Twilio.
Estos datos son una referencia pública: una conexión directa debe confirmar
el tarifario Meta aplicable a la cuenta y no tendría el cargo de canal Twilio.
Voz, modelo, red y alojamiento pueden añadir consumo. No se promete coste
total cero.

No se encontró una vía oficial verificada que combine llamadas salientes
automatizadas a cualquier móvil de RD, ausencia de permiso técnico del
destinatario y coste permanente cero. Para ese criterio, mantener disponible
SIP; estudiar Meta directa como vía complementaria usando el número existente.
No se cambió de proveedor ni se activó pago, mensaje o llamada.

## Configuración por revisar

En esta copia del proyecto, la comprobación local encontró ausentes el token
WhatsApp, secreto de aplicación, token de validación de webhook y
`phone_number_id`; el webhook local también está deshabilitado. El usuario
confirmó que el número existe en Meta: falta vincular esa cuenta con esta copia
y comprobar Calling en su panel. No se consultó su cuenta remota ni se imprimieron
números o credenciales durante la comprobación.

Las páginas técnicas de Calling de Meta respondieron HTTP 429 durante la
consulta. Se pudo verificar la existencia y el requisito de permiso mediante
el anuncio oficial de Meta y la documentación oficial de Twilio. El contrato
de señalización/audio directa de Meta queda por verificar antes de escribir
un adaptador de llamadas; el conector actual de WhatsApp solo envía texto.

Estado del catálogo: agenda telefónica y WhatsApp Calling **pendientes de
integración**. La conversación telefónica pública estable conserva su marca
de **REVISAR**. El cierre anterior del objetivo de WorkSpace por aceptación
del usuario se mantiene independiente de esta auditoría.
