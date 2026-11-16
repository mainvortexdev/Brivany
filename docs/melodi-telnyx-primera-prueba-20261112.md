# Primer intento real de llamada con Telnyx

12 de noviembre de 2026. El usuario autorizó expresamente una llamada a su
línea personal terminada en **5246** para conversar con Melodi. Se normalizó a
E.164 dominicano, conservando todos los dígitos proporcionados. Se ejecutó una
sola vez `tools.run_telnyx_call` con el perfil cifrado existente y el emisor
verificado terminado en **9873**. No se cambiaron credenciales, límites ni rutas.

## Resultado comprobado

- Registro SIP aceptado: **200**.
- INVITE: respuestas provisionales 100 y 180; rechazo final **404** a los
  2,91 segundos del inicio del proceso, con `Reason: Q.850;cause=1`.
- No hubo respuesta confirmada, sesión Muse, generación Meta ni síntesis
  Cartesia. El programa crea la conversación después de establecer la llamada.
- Un 180 acredita señalización de llamada en curso; no demuestra que el móvil
  haya sonado físicamente.
- El usuario confirmó en este chat que la línea recibe llamadas normales.

La primera consulta REST de detalle no devolvió registros. Otra consulta de la
conexión falló por comunicación con la API. A las **16:32:34 UTC** apareció un
único registro de Telnyx que coincide con el destino solicitado, la conexión y
el perfil de salida guardados:

| Campo del operador | Valor |
| --- | --- |
| Inicio y fin | 2026-11-12 16:25:32 UTC (12:25:32 en La Paz) |
| `answered_at` | `null` |
| `connected` / `completed` | 0 / 0 |
| `hangup_cause` / `hangup_code` | `UNALLOCATED_NUMBER` / `1` |
| `sip_invite_failure_status` | `404` |
| `telnyx_error_code` | `D00` |
| `hangup_details` / `route` | `send_refuse` / `Intra` |
| País del destino | `DO` |
| Segundos de llamada / facturados | 0 / 0 |
| Coste registrado | US$0,0 |
| Reintento interno declarado por Telnyx | `false` |

El mensaje genérico inicial del cliente decía «Telnyx no reconoce ese destino.
Revisa el número». Se conserva como salida histórica; **no demuestra que el
número esté equivocado**. El CDR confirma que se envió el destino solicitado.
El valor `Intra` y el rechazo orientan la revisión de encaminamiento con Telnyx,
pero no bastan para determinar por qué el operador lo trató como no asignado.

La [documentación oficial de respuestas SIP](https://developers.telnyx.com/docs/voice/sip-trunking/troubleshooting/response-codes)
enumera varios motivos distintos para un 404, incluidos problemas de ruta.
No se atribuye a este intento un subcódigo distinto del `D00` observado.

## Evidencias y consumo

- [Estados y códigos del intento, sin audio ni conversación](../tmp/verification/telnyx-first-call-attempt-20261112.json).
- [Diagnóstico final del registro del operador](../tmp/verification/telnyx-first-call-carrier-diagnosis-20261112.json).
- [Consulta inicial sin registros](../tmp/verification/telnyx-first-call-detail-probe-20261112.json).
- [Consulta adicional con fallo de comunicación](../tmp/verification/telnyx-first-call-routing-probe-20261112.json).
- [Registro disponible en la consulta posterior](../tmp/verification/telnyx-first-call-detail-settled-20261112.json).

Una operación de marcado autorizada; ningún reintento de Brivany. Se conocen
seis intentos REST: dos lecturas de saldo del ejecutor y cuatro consultas de
diagnóstico; una de estas últimas falló por comunicación. Paquetes SIP y tráfico
de documentación no contabilizados. El saldo no varió en la lectura inmediata
y el CDR posterior registra US$0 para esta llamada. No se usaron proveedores de
IA; GPU sin medir. No se guardaron voz ni transcripciones. No se ejecutaron
de nuevo las suites locales: no hubo cambios de código ni una nueva duda sobre
los contratos locales; el fallo comprobado está en la terminación real.

## Pendiente

La conversación solicitada no se consiguió. Antes de otra llamada hay que
aclarar por qué Telnyx rechaza este destino activo como `UNALLOCATED_NUMBER`
con ruta `Intra`. No se envió ninguna comunicación a soporte ni se compraron
números. Se puede aportar al operador la hora exacta anterior y consultar el
intento en el SIP Call Flow Tool del portal; no se adjuntan aquí números completos,
credenciales ni paquetes SIP.
