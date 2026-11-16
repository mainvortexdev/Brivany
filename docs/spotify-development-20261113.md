# Spotify con la aplicación de Brivany · 13 de noviembre

El usuario autorizó usar el Client ID de la aplicación de su captura para uso
inmediato. El servicio HTTPS publicado coincide exactamente con esa aplicación
y con `https://brivany.vetsa.es/spotify/callback`. No se cambió ni rotó el ID
publicado: ya era el correcto. No se leyó ni necesitó el Client Secret. El ID
público se configura en el servidor; cada persona autoriza su propia cuenta.

Se preparó la configuración de origen real, la identidad pública de aplicación
y `SPOTIFY_ACCESS_MODE=development` en el proyecto del sitio. El contacto aportado
por el usuario, `daniel@vetsa.es`, sustituye al contacto de ejemplo en el código
del sitio. Este cambio no modifica el correo de la cuenta propietaria de Spotify.
El nombre legal presente en las páginas requiere revisión antes de publicarlas;
no se ha declarado ni inventado una empresa registrada.

El Worker preparado publica el modo de acceso y el requisito Premium, rechaza
modos inválidos y solicita consentimiento explícito con `show_dialog=true`.
Estos metadatos son una declaración operativa del editor: cambiar una variable
a `extended` no obtiene ni acredita aprobación de Spotify. El cliente admite
también el servicio anterior sin ese campo, usando `unknown` y evitando afirmar
acceso público. En Conexiones se indica el acceso en pruebas cuando el servidor
lo declara. No se añadieron permisos ni se ampliaron los scopes OAuth existentes.

El servicio desplegado sigue con su protocolo anterior, compatible y comprobado.
Las mejoras de metadatos y consentimiento del Worker quedan preparadas en código,
sin publicar esta versión del sitio: su `index.html` servido difiere del artefacto
local. Publicar el sitio completo podría sustituir contenido ajeno a Spotify.
Las rutas, bindings, secretos y recursos públicos de transferencia no se tocaron.
La aplicación actual puede vincularse con el ID publicado sin esperar ese despliegue.

Datos para la configuración de la aplicación Spotify:

| Campo | Valor |
| --- | --- |
| Nombre | Brivany |
| Website | https://brivany.vetsa.es |
| Redirect URI exacto | https://brivany.vetsa.es/spotify/callback |
| Integraciones utilizadas | Web API y Web Playback SDK |
| Autorización | Authorization Code con PKCE S256 |
| Contacto aportado | daniel@vetsa.es |
| Empresa registrada | El usuario indica que no cuenta con ella |
| Usuarios activos mensuales | No aportado; no se presume cero ni 250.000 |

Según los [requisitos actuales de Spotify](https://developer.spotify.com/documentation/web-api/concepts/quota-modes),
la solicitud de socio para acceso público requiere una entidad registrada, un
servicio lanzado y al menos 250.000 usuarios activos mensuales, entre otros
criterios. Actualmente no se cumple el requisito de entidad registrada. No se
presentó una solicitud, se aceptaron condiciones ni se añadieron cuentas a la
lista de usuarios. Development exige cuentas habilitadas para la aplicación;
Premium es necesario para reproducir desde el SDK. El correo corporativo no
sustituye la aprobación. La futura solicitud debe describir funciones reales
y contrastarse con la política del proveedor.

Pruebas locales, con cuentas, tokens, APIs Spotify y audio sustituidos:

- 46 casos de cliente/SDK/letras/artwork:
  `tmp/verification/spotify-20261113T141440-a880b2dd.json`.
- 37 comprobaciones de Worker/SQLite/PKCE, modo Development predeterminado,
  declaración extended, modo inválido y consentimiento explícito:
  `tmp/verification/spotify-relay-20261113T141440-68d7872c.json`.
- Interfaz Edge sin GPU con nota Development y compatibilidad con modo desconocido:
  `tmp/verification/spotify-connection-ui-20261113T141729-6d415c65.json`.

Comprobación HTTPS real con estado y autorización sintéticos, sin cuentas reales,
audio ni tokens Spotify persistidos: siete solicitudes al relay, retorno inspeccionado
sin seguirlo a Spotify, callback, perfil/token sustituidos y retirada del flujo.
Coincide con la aplicación configurada. El servicio anterior declara modo
`unknown` por no publicar aún el nuevo campo; esto no convierte su app en pública.
Informe: `tmp/spotify-https-relay/remote-report-20261113T141731Z.json`.
El primer cotejo de configuración añadió una solicitud y el cotejo del índice
otra: nueve solicitudes operativas explícitas conocidas. La lectura de documentación
y el tráfico de herramientas no se contabilizaron juntos. Importe no medido.

Mientras el usuario enviaba archivos se trabajó solo en código y pruebas aisladas.
Después confirmó que había terminado y autorizó reiniciar. Se guardó el chat,
se confirmó el cierre normal y se actualizaron tres archivos locales con respaldo,
sin modificar autorizaciones personales. El arranque posterior acredita chat y
compositor listos, conservando los contadores de historial. Evidencias sin claves:
`tmp/spotify-development/installation.json` y `tmp/spotify-development/startup.json`.

Los ensayos no invocan modelos ni síntesis de voz. GPU, tráfico de fondo y
facturación agregada no se midieron. No acreditan consentimiento, reproducción
física o alta de una cuenta real, ni acceso sin lista de usuarios. Los hashes
de instalación acreditan bytes aplicados, no esas capacidades.
