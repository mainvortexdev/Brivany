# Melodi en WhatsApp · Brivany

Runtime de Melodi y adaptadores del número existente. El código canónico vive
en este directorio de Brivany; `Vetsa-Asistant` solo conserva una referencia al
traslado y su historial Git. El respaldo privado de recuperación está fuera del
repositorio.

Hay una identidad de asistente, `melodi`, 39 skills en once familias y 42
herramientas estructuradas. Se conservan los adaptadores de agenda, correo,
Drive, documentos, memoria, proyectos, finanzas, investigación, contenido,
Instagram, estadísticas del negocio y puente de escritorio. La disponibilidad
real depende de la conexión y autorización correspondiente.

## Informes de entrega de correo y nota de voz

`gmail.read_report` abre el informe agregado que el proveedor envía comprimido y
lo explica en palabras corrientes; sin identificador toma el más reciente del
buzón. El tick programado avisa por su cuenta cada informe nuevo, una sola vez,
y declara el que no se puede abrir en lugar de resumirlo. `message.voice_note`
envía una nota de voz con la voz exacta ya seleccionada de Melodi, sólo cuando
el titular la pide y sólo con la voz configurada. Ver
[el informe del hito](../../docs/informes-entrega-correo-20261116.md).

## Cuenta y número

`https://brivany.vetsa.es/whatsapp` publica el número de Melodi. En Brivany,
Conexiones → Melodi en WhatsApp permite consultar ese número, vincular la cuenta
Vetsa mediante un código enviado desde el teléfono, comprobar el vínculo y
desvincular. El código es de un solo uso, dura diez minutos y se almacena como
hash. Las credenciales de sesión permanecen en el backend nativo.

Cada teléfono vinculado tiene su propio ámbito de datos y conexiones Google.
La titularidad se conserva al desvincular para impedir que otra cuenta herede
tokens o memoria. El operador original conserva acceso desde su número durante
la transición hasta que realice una vinculación/desvinculación explícita.
Las integraciones empresariales y las estadísticas internas están reservadas
al operador, no se prestan a los demás usuarios.

## Google

El cliente web pertenece al proyecto Google `brivany`. El retorno registrado es
`https://ia.vetsa.es/oauth/google/callback`, compartido mediante estados
independientes de Calendar, Drive y Gmail. Los tokens nativos de Desktop siguen
separados. No se pueden renovar tokens de Vetsa con el nuevo cliente.

El consentimiento web solicita Calendar `calendar.app.created`, Drive
`drive.readonly` + `drive.file`, Gmail `gmail.readonly` + `gmail.compose`, e
identidad. No fuerza un correo personal. PKCE, estado de un uso y cookie del
navegador protegen el retorno. La marca de Google está verificada; la revisión
del acceso a datos y CASA no se dan por completadas.

Ver [preparación y requisito pendiente](../../docs/google-whatsapp-verificacion-20261113.md).

## Recursos y publicación

Los nombres antiguos de Worker, cola y algunos contratos RPC se conservan por
compatibilidad con los recursos existentes. No representan agentes activos.
No hay otra personalidad que deba autorizar a Melodi: las acciones que superan
su autoridad requieren una aprobación de un uso del propio titular.

- Worker principal: `vetsa-whatsapp-assistant`.
- Cola existente: `vetsa-dona-jobs`; nunca se purgó durante el traslado.
- D1 y R2 existentes; datos heredados conservados para recuperación.
- Adaptadores: `../whatsapp-media` y `../whatsapp-instagram`.
- El sitio oficial utiliza el binding privado `MELODI_WHATSAPP` para las rutas
  permitidas de vinculación; no es un proxy de destino arbitrario.

La publicación de esta migración utiliza `tools/cloudflare-release.mjs`:
respaldo del código/configuración activos, comparación antes de publicar,
bindings heredados estrictamente y conservación de assets. No sustituir los
assets activos por la carpeta local sin revisar sus diferencias.

Desde la raíz de Brivany:

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify melodi-whatsapp
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify whatsapp-cloud
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify melodi-whatsapp-site
```

Los fixtures antiguos de múltiples personalidades se conservan como material
de transición; no se declara aprobada toda esa suite histórica. La suite de
publicación anterior cubre el runtime de una Melodi, los ámbitos de usuario,
aprobaciones, OAuth, agenda, documentos, correo, Drive y recibos de WhatsApp.

Los avisos administrativos se publican exclusivamente mediante la cola
privada, al número configurado del operador, con deduplicación y recibos de
Meta. Una aceptación del proveedor no equivale a entrega; se distingue
`accepted`, `delivered`, `read` y el resultado incierto sin reenvío automático.

La migración de tablas es idempotente, conserva IDs y ordena las claves
foráneas. Los trabajos espontáneos, delegaciones y autorizaciones de las
personalidades retiradas no se reanudan. Consultar el
[informe de migración](../../docs/melodi-whatsapp-migracion-20261113.md).
