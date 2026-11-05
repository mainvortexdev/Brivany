# Vinculación real de Google y retorno con emisor

31 de octubre de 2026, hora de La Paz. Continúa el hito de
[proyecto Google y web legal](google-proyecto-y-web-legal.md).

El usuario separó la cuenta administradora del proyecto Google Cloud de la
cuenta personal que debe aportar Gmail, Drive y Calendar. Se detuvo el retorno
pendiente de la administradora, se borraron los flujos locales pendientes y los
artefactos privados de recuperación, y se prepararon los tres consentimientos
con la cuenta personal indicada. El usuario confirmó esos permisos en el paso
final. No se completó un intercambio de tokens de la cuenta administradora.
Su búsqueda de conexiones de Google para Brivany no mostró resultados.

Los tres conectores están autorizados, conectados y no simulados en la instancia
nativa abierta. El almacenamiento informa DPAPI de Windows con cifrado activo.
Se mantuvo la cuenta administradora para la configuración del proyecto, la marca
y los servicios de Google Cloud. La aplicación continúa en modo de prueba de
Google; no se presentó como verificada para uso público.

## Corrección del retorno

La primera respuesta real de Google incluyó `iss=https://accounts.google.com`.
El validador anterior rechazaba ese campo antes de consumir la solicitud local.
Ahora acepta el campo y compara su valor exacto con el emisor de Google antes de
reclamar el estado; rechaza emisores ajenos, HTTP, sufijos, barra adicional y
campos duplicados. Conserva el soporte de retornos anteriores sin `iss`, el
endpoint fijo de Google y las comprobaciones de estado, PKCE, cliente y origen.

La corrección pasó `google-oauth` (21 pruebas) y `connections-http` (12 pruebas),
con proveedor sustituido. Se reinició Brivany para cargarla: se liberó primero su
reserva AppBar y después se confirmó de nuevo la barra real de 40 píxeles, sin
entrada de WorkSpace en la barra de tareas. Una consulta real a Spotify previa
al reinicio no indicó música local activa que necesitara reanudación.

## Comprobaciones reales y alcance

Se habilitó la ejecución revisada de integraciones; cada acción sigue requiriendo
una propuesta y aprobación ligada a sus parámetros. No se ampliaron los permisos
OAuth de Google a escritura. La primera ejecución se bloqueó antes de llamar al
proveedor porque ese control permanecía desactivado.

Se realizaron las consultas mediante la API de Brivany, recorriendo propuesta,
aprobación y ejecución real:

| Operación | Resultado | Límite |
| --- | --- | --- |
| Buscar en Gmail | Correcto; 20 identificadores devueltos | Sin descarga de cuerpos de mensajes |
| Buscar en Drive | Correcto; ninguna coincidencia | Solo metadatos; sin lectura de archivos |
| Consultar Calendar | Correcto; ningún evento en el intervalo | Solo calendario principal e intervalo solicitado |

Hubo cuatro consultas de datos a Google: se repitió únicamente Calendar porque
el primer comprobador esperaba la colección `events` y el transporte devuelve
`items`. Las tres ejecuciones originales habían terminado correctamente. Los
informes conservan recuentos y estados, sin nombres de archivos, eventos,
identificadores de mensajes, cuentas, tokens ni contenido privado. Los resultados
de consulta no se persistieron en las propuestas de integración.

La interfaz se comprobó con los tres conectores y se cambió su texto a
“Cuenta vinculada · permisos autorizados”, evitando mantener el aviso genérico
de comprobación pendiente. Ese texto describe la autorización, no promete que
toda consulta futura tenga éxito.

No se crearon eventos, borradores o archivos ni se enviaron mensajes. La cantidad
de tráfico del navegador y de la app en segundo plano no se midió; no se declara
consumo externo cero. Estas pruebas no acreditan gestión completa de Gmail o
Drive, escritura, redes sociales, ni la resolución de los cortes de audio de
Spotify, que queda pendiente.

Evidencia:

- `docs/verification-history/google-oauth-20261101T015552-f91f616d.json`
- `docs/verification-history/connections-http-20261101T015552-512eb019.json`
- `tmp/google-setup/google-real-reads-final.json`
- `tmp/google-setup/connection-ui-check.json`
- `tmp/google-setup/workspace-final.json`

Fuentes técnicas: emisor y soporte `iss` en
`https://accounts.google.com/.well-known/openid-configuration` y RFC 9207,
`https://www.rfc-editor.org/rfc/rfc9207.html`.
