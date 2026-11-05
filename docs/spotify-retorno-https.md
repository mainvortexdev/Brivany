# Spotify · retorno HTTPS y conexión del escritorio

31 de octubre de 2026, America/La_Paz. Sustituye el retorno loopback indicado en
los hitos anteriores. El registro del usuario proporcionó el Client ID público
de Brivany; el Client Secret no se necesita ni se leyó.

**Redirect URI vigente:** `https://brivany.example/spotify/callback`.
Website continúa siendo `https://brivany.example`. En Spotify debe registrarse
la URL completa del callback, incluida su ruta. La API utilizada sigue siendo
Web API con Authorization Code + PKCE S256.

## Recorrido desplegado

1. Al pulsar Vincular, el escritorio obtiene la configuración pública del editor
   desde `/api/spotify/config`. No pide un Client ID al usuario.
2. Genera el verificador PKCE, un secreto de lectura y un secreto de lanzamiento.
   Envía al puente solo el challenge, los hashes de los secretos y un nonce.
3. Cloudflare crea una sesión independiente con Durable Objects/SQLite y devuelve
   un estado firmado, con vigencia de cinco minutos. El navegador abre el dominio
   y recibe una cookie Secure/HttpOnly/SameSite=Lax antes de ir a Spotify.
4. Spotify devuelve el código al callback HTTPS. Se comprueban firma, vigencia,
   cookie y fase de sesión. Una respuesta no puede sustituir otra ya recibida.
5. El escritorio recoge el código con su secreto de lectura independiente y lo
   intercambia directamente con Spotify usando el verificador que nunca salió
   del ordenador. La lectura admite reintentos hasta su acuse de recibo.
6. El acuse elimina la sesión y hay una alarma de limpieza por caducidad. Los
   tokens permanecen en el escritorio, protegidos con DPAPI en Windows. Cerrar o
   cancelar detiene la espera y solicita retirar el intento pendiente.

El puente nunca recibe tokens ni el verificador PKCE. El código de autorización
sí pasa temporalmente por Cloudflare; no se afirma que ese código no abandone el
PC. La caducidad impide recuperarlo tras el plazo aunque una alarma se retrase.
El callback usa no-store/no-referrer y elimina los parámetros de la barra del
navegador. Se desactivaron logs automáticos y trazas de este Worker para evitar
capturar query strings OAuth; no se afirma controlar todos los registros internos
de los proveedores. Hay límites de inicio y consulta, sin almacenar la IP original
en la sesión. No se admiten orígenes externos ni destinos de retorno arbitrarios.

La clave de firma se generó para este despliegue y se guardó como secreto de
Cloudflare. Su valor no se imprimió ni se guardó en el proyecto o las evidencias.
El Client ID es público y se publica como configuración del editor.

## Corrección de conectividad TLS

La autorización real llegó al callback, pero el escritorio mostró un fallo de
conexión al intercambiarla. Una comprobación sin credenciales reprodujo
`SSLCertVerificationError` con el contexto SSL por defecto de Python; Windows
validó el mismo endpoint. Cargar el bundle actualizado de certifi verificó TLS.

Los dos transportes de Spotify ahora usan un contexto propio: confianza del
sistema más certifi, certificado obligatorio, comprobación de hostname y TLS 1.2
como mínimo. No se desactiva SSL, no hay fallback sin verificar y no se altera
globalmente la confianza de otras integraciones. Se declara la versión probada
de certifi en requirements-desktop.txt. El contexto se construye al usar la red.

El POST real de diagnóstico al endpoint de tokens, con un grant sintético inválido
y sin credenciales, devolvió HTTP 400/unsupported_grant_type con TLS verificado.
Esto comprueba transporte, no autenticación de una cuenta. Como la autorización
anterior no se completó, el usuario debe volver a pulsar Vincular Spotify para
obtener una nueva. No se conservaron códigos privados para reintentarlos.

## Evidencias y alcance

- `spotify`: 12 pruebas locales de PKCE, retorno HTTPS, bootstrap público,
  cancelación/caducidad, acuse, almacenamiento sustituido, controles y TLS estricto.
- `spotify-relay`: 22 comprobaciones en workerd/Miniflare con SQLite y rate limits
  reales locales: firma, cookie, identidades separadas, reintentos, replay, origen,
  destinos, caducidad, límites y retirada. El binario instalado soporta hasta
  2026-09-04; esa es la fecha del fixture. Producción mantiene 2026-10-31 y se
  comprobó aparte por HTTPS. Se conservan los fallos de configuración del harness
  y sus correcciones en los informes de tools.verify.
- `tmp/spotify-https-relay/remote-report.json`: puente HTTPS real y escritorio
  aislado, con intercambio de tokens sustituido. No sigue el redirect a Spotify
  ni accede a cuentas. Recibe una autorización sintética y confirma su retirada.
- `tmp/spotify-https-relay/spotify-transport-check.json`: POST real, sin cuenta,
  al endpoint de Spotify; propósito y resultado descritos arriba. Hubo además
  comprobaciones GET de diagnóstico y una comparación con Windows curl. No se
  conoce el consumo de cuota/coste de esos proveedores; no hubo inferencia.
- Suites `desktop` e `island-ui`: regresión del shell y del botón con sustitutos.
  El arranque nativo final se verifica por metadatos de las ventanas propias.

No se registra ninguna conversación, captura original, código privado, cookie,
verificador, token ni valor de clave de firma en la bitácora. Los hashes del
manifiesto acreditan integridad de fuente, no una autenticación real.

El despliegue HTTPS está en producción. El App Status de Spotify sigue sujeto
a su modo de desarrollo, Premium, lista de usuarios y aprobación de Spotify;
publicar este callback no elimina esas restricciones.

Actualización del 31 de octubre: el consentimiento añade lectura de biblioteca;
las autorizaciones anteriores conservan reproducción y pueden ampliar acceso en
Conexiones. La interfaz de Música y los proveedores de letras se describen en
[biblioteca y letras](spotify-biblioteca-letras.md).


Revisión posterior del 31 de octubre: el reproductor pasa a SDK en host nativo
aislado, con token corto solo para ese host, historial opcional, portadas mosaic,
ondas ambientales y teleprompter integrado. Actualiza los límites de la versión
anterior sin reescribirla. [Arquitectura y evidencias](spotify-workspace-dispositivo.md).
