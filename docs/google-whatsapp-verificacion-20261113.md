# Google · revisión del canal WhatsApp de Brivany

13 de noviembre de 2026. Preparación real de Cloud Console y comprobaciones locales.

## Estado observado

El proyecto `brivany` tiene la marca verificada y publicada. El centro de
verificación confirma que el acceso a datos todavía no está verificado. La
solicitud anterior no se había enviado. No se ha declarado completada una
evaluación CASA ni presentado una solicitud incompleta como aprobada.

El cliente web «Brivany WhatsApp · Melodi» pertenece a este proyecto y utiliza
el retorno `https://ia.vetsa.es/oauth/google/callback`. Es independiente del
cliente nativo de Desktop. Los valores privados están fuera de Git.

El propietario conectó Calendar desde su teléfono. Drive y Gmail seguían
pendientes cuando se preparó este documento. El primer fallo del enlace era
una excepción del constructor OAuth por el correo fijo vacío; se corrigió en
la revisión `.2`. El aviso posterior de aplicación sin verificar proviene de
Google y requiere su proceso de revisión, no un nuevo dominio ni otro ID.

## Permisos declarados y solicitud nueva

Se guardaron nueve permisos y las justificaciones actualizadas en Google.
Las categorías son Productividad de Drive y Productividad del correo.

| Cliente y función | Permiso |
| --- | --- |
| Desktop, consultar agenda | `calendar.events.readonly` |
| Desktop, buscar metadatos de archivos | `drive.metadata.readonly` |
| Desktop y WhatsApp, buscar/leer correo | `gmail.readonly` |
| WhatsApp, crear/verificar documentos propios | `drive.file` |
| WhatsApp, buscar/leer archivos existentes | `drive.readonly` |
| WhatsApp, borradores y envíos solicitados | `gmail.compose` |
| WhatsApp, calendario creado por la app | `calendar.app.created` |
| WhatsApp, verificar identidad de Google | `openid`, `userinfo.email` |

Los permisos completos `drive`, `mail.google.com/` y `gmail.modify` no se
solicitan en el nuevo consentimiento. Se conservan los adaptadores heredados,
pero solo se anuncian las funciones accesibles con los permisos actuales.
Las concesiones anteriores compatibles no se transfieren entre clientes OAuth.

Los tokens nativos siguen protegidos por DPAPI. Los tokens web y los mensajes
privados usan cifrado de aplicación y pertenencia al teléfono/cuenta; la
infraestructura de D1/R2 aplica además su protección de almacenamiento. La
documentación pública diferencia escritorio y nube. No se adjuntan credenciales,
conversaciones ni contenido de cuentas a este documento.

## Requisito pendiente para enviar la revisión

El video registrado el 8 de noviembre es anterior al nuevo cliente web.
El formulario de Google requiere una demostración de todos los clientes y
permisos solicitados. Su declaración final confirma que la solicitud cumple
todos los requisitos; permanece sin marcar mientras falta esa demostración.

Recorrido preparado para una grabación real, tras la autorización del titular:

1. Mostrar el número público y la vinculación de Brivany con WhatsApp, sin
   conversaciones personales.
2. Mostrar el consentimiento de los clientes Desktop y WhatsApp en inglés,
   incluidos nombre de app, ID del cliente visible en el navegador y permisos.
3. En Drive, buscar y leer un archivo ficticio y crear/verificar un documento
   privado de prueba.
4. En Gmail, buscar el contenido ficticio elegido y crear/verificar un borrador.
   No enviar correos ni leer mensajes ajenos a la prueba.
5. Mostrar el calendario de la app y una actividad de prueba autorizada.
6. Revisar y ocultar correos personales, códigos OAuth, cookies, tokens y datos
   de otras cuentas antes de aportar el video a Google.

Las cuentas propuestas son Drive `ceo@vetsa.es` y Gmail del titular ya empleado
en la prueba nativa anterior. También puede elegirse una cuenta de pruebas.
Se requiere consentimiento antes de conceder al cliente web ese nuevo acceso.
No se ha contratado una evaluación ni aceptado un gasto.

Google exige CASA para el tratamiento de datos restringidos mediante un servidor
externo. La evaluación y su aprobación no se sustituyen por las pruebas unitarias
de Brivany. Las respuestas preparadas indican que la app es pública y no es
solo personal, interna, de pruebas ni un complemento SMTP de WordPress.

## Evidencia y referencias

- `.local/whatsapp-migration/reports/google-review-prepared.png`: cuestionario
  real preparado, con las declaraciones finales sin completar.
- `.local/whatsapp-migration/reports/google-review-texts.json`: justificaciones
  y nota de estado; sin credenciales.
- `.local/whatsapp-migration/reports/release-tests.tap`: pruebas locales con
  proveedores sustituidos. No acreditan aprobación de Google ni CASA.
- [Permisos de Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).
- [Permisos de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- [Verificación de permisos restringidos](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
- [Requisitos del video](https://support.google.com/cloud/answer/13804565?hl=en).

El importe y el tráfico agregado de las comprobaciones administrativas reales
no se midieron. No se solicitó inferencia para preparar la revisión. No se
afirma consumo nulo del servicio en ejecución.
