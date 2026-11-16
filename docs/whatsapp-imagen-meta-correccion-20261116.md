# Corrección de generación de imágenes de Melodi en WhatsApp

16 de noviembre de 2026. El usuario informó de una promesa de generación seguida
de un aviso de fallo sin recibir imagen.

Se consultaron únicamente estados y códigos operativos, sin descifrar pedidos,
conversaciones ni imágenes. Los intentos anteriores seguían en el proveedor KIE
y constaban rechazados por HTTP 402. El intento más reciente sí pasó a Meta,
pero su registro falló en unos 100 ms y un intento posterior devolvió 409 porque
el identificador ya estaba marcado como fallido.

La causa nueva era del adaptador publicado: `redirect: "error"` funciona en Node,
pero Workers lo rechaza al construir la petición, antes de enviarla a Meta.
Se cambió a `manual`. Los códigos 3xx se rechazan sin seguir redirecciones, sin
reenviar credenciales y sin un segundo intento de generación.

Referencia: [Request en Workers](https://developers.cloudflare.com/workers/runtime-apis/request/).

## Pruebas y publicación

- Se añadió una prueba en workerd real con el adaptador, D1 y R2. Con la versión
  anterior reprodujo HTTP 502; con la corrección genera y conserva el resultado,
  lo devuelve de caché al repetir el identificador y rechaza un 302 sin seguirlo.
  El proveedor de este ensayo está sustituido; no consume imágenes de Meta.
- Pasan `vetsa-meta-runtime` y las 16 regresiones de `vetsa-meta-image`, registradas
  con `tools.verify`. Se guardó la regresión en Vetsa-Intelligence, junto al
  adaptador y la explicación del fallo en `PROVIDERS.md`.
- Se partió de una instantánea nueva del servicio desplegado. Solo se cambió el
  módulo `meta-image.js`; se conservaron los otros módulos y los 36 bindings.
  Publicación: `a6742cd6c34245a7a264b740b6354048`.

## Recuperación real de un único pedido

Se retomó únicamente el último pedido de imagen fallido que correspondía a la
incompatibilidad anterior. Se eliminó su registro de imagen fallida con filtros
por identificador, estado, proveedor y ausencia de resultado, y se volvió a
encolar una sola vez el mismo trabajo. No se cambiaron ni descifraron su pedido,
su destinatario o sus referencias. El fallo previo no pudo contactar con Meta;
no se trata de repetir a ciegas una generación cuyo resultado fuera incierto.

La comprobación final devuelve:

```json
{"whatsapp_job":"complete","whatsapp_error":null,"image_job":"completed","image_error":null}
```

Esto verifica el recorrido real del consumidor de WhatsApp, su autenticación y
binding de Vetsa Intelligence, la generación de Meta, D1/R2 y la aceptación del
envío por WhatsApp. No acredita lectura o recepción física en el teléfono. No se
volvieron a ejecutar los otros pedidos fallidos ni se envió una explicación
adicional al chat del usuario. No se reinició Brivany Desktop.

Consumo: una recuperación de imagen real y su envío por WhatsApp; el importe
facturado y el tiempo de GPU no se consultaron. Los códigos y estados se guardan
como evidencia; no se adjunta contenido de conversación o imágenes del usuario
a la bitácora. Evidencias: `tmp/vetsa-meta-fix/deployment.json` y
`tmp/vetsa-meta-fix/recovered-status.json`.
