# Arranque nativo y vinculación de Spotify · 13 de noviembre

La instalación quedó bloqueada en «Abriendo el chat…»: el documento existía,
pero no se habían inicializado ni el arranque JavaScript ni el iframe. El
control privado indicaba proceso listo, lo que no acreditaba chat listo.
El reinicio normal recuperó dos conversaciones y los 17 mensajes de la
conversación abierta. No se conservaron textos ni capturas del historial como
evidencia. La causa original de la entrega incompleta no quedó determinada;
consultar posteriormente los assets con HTTP 200 no prueba su entrega anterior.

Se añadió una recuperación nativa que observa únicamente origen, ruta y
banderas de inicialización. Si el documento está completo y todavía no arrancó
ningún script de navegación, arranque o iframe, reintenta una sola vez tras dos
segundos. Una conversación inicializada queda bajo la recuperación de la página.
La nueva navegación conserva la autenticación nativa y utiliza una marca única
sin secretos: asignar la misma Source a WebView2 no garantiza recarga. Se consulta
el origen del documento porque el caché nativo puede conservar la URL anterior
a una redirección. No se flexibilizaron CSP, TLS ni acceso desde otros orígenes.

Spotify intentaba consultar `brivany.example`; el cliente usa ahora el servicio
real `https://brivany.vetsa.es` y su callback HTTPS. El Client ID público se obtiene
de ese servicio: no se incrustó el ID de la captura, se retiró la variable de
entorno personal como fuente y se eliminó el método de configuración del puente
de la interfaz. El fichero local de identidad actúa como caché de la aplicación.
El Client ID identifica a la aplicación, no a la cuenta que autoriza el acceso.

Antes de declarar una vinculación nueva se verifica `/me` con la autorización
recibida. Un rechazo de acceso no sustituye una cuenta previa válida. La identidad
se guarda junto a los tokens con DPAPI; la interfaz muestra solamente el nombre
de la cuenta. Al cambiar de cuenta se elimina la recuperación de música anterior.
Una autorización nueva nunca hereda el refresh token de otra cuenta. Los errores
de vinculación permanecen visibles después del sondeo de estado y el usuario
puede cancelar un intento pendiente. La autorización se completa en Spotify;
Brivany no recibe su contraseña. El reproductor existente se llama «Brivany».

La captura del usuario muestra Development Mode. El cliente preparado para
autorizaciones independientes no elimina la lista de cuentas permitidas: Spotify
exige aprobación para acceso público sin esa lista. La reproducción mediante el
SDK requiere Premium. No se solicitó esa aprobación ni se modificó la lista de
usuarios o la aplicación en el panel de Spotify.

Referencias primarias consultadas:

- [Modos de cuota y acceso público](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
- [Autorización PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow).
- [Reproductor y requisito Premium](https://developer.spotify.com/documentation/web-playback-sdk/howtos/web-app-player).

Verificación local, con proveedores, cuentas y audio sustituidos cuando procede:

| Suite | Resultado y evidencia |
| --- | --- |
| Spotify, letras, artwork y SDK aislado | 43 casos; `tmp/verification/spotify-20261113T064901-50bd9e04.json` |
| Precedencia de dispositivos | 26 casos; `tmp/verification/spotify-sync-20261113T064901-acbd6adb.json` |
| Recuperación de reproducción | 26 casos; `tmp/verification/spotify-resume-20261113T063529-c1603be0.json` |
| Inicio sin modelos ni backend nativo | 2 casos; `tmp/verification/workspace-startup-20261113T064238-7c36f2c2.json` |
| Arranque WebView2 con servidor real y perfil sintético | Sin reintento; `tmp/verification/shell-boot-native-20261113T064901-117c66cc.json` |
| Fallo 503 de scripts y recuperación WebView2 | Recuperado, un reintento; `tmp/verification/shell-recovery-native-20261113T064458-b0a23976.json` |
| Conexión visual de Spotify en Edge sin GPU | Error, cancelación, identidad y 375 px; `tmp/verification/spotify-connection-ui-20261113T063529-2ff67b81.json` |

Se conservan los fallos intermedios de recuperación. El contador de reintentos
no bastaba para demostrar recuperación; la comprobación final exige también
estado `recovered` y chat utilizable. Se corrigieron la navegación idéntica y
la dependencia de la URL nativa anterior a la redirección. El banco de recursos
usaba stubs antiguos de cierre, bordes y cuenta Vetsa; se actualizaron sin
eliminar sus comprobaciones. Un intento con el stub de cuenta anterior agotó
180 segundos. Los informes fallidos permanecen en `tmp/verification/` y bitácora.

Comprobación externa acotada: cuatro solicitudes HTTPS reales para configuración,
creación de flujo, retorno 303 a `accounts.spotify.com` y retirada del flujo.
PKCE S256, identidad de aplicación y callback coinciden. No se usó ninguna cuenta
ni se intercambiaron tokens de Spotify o reprodujo audio. Hubo además una consulta
previa a la configuración pública; cinco solicitudes explícitas conocidas en
total. Importe no consultado. Evidencia sin secretos:
`tmp/startup-spotify-fix/real-oauth-handoff.json`.

Se aplicaron siete archivos a la instalación 0.1.0 con respaldo y comprobación
de importaciones; el lanzador conserva las diferencias ajenas a este hito.
No se modificaron los tokens personales durante la instalación. El cierre se
confirmó sin forzar procesos y el nuevo arranque acredita chat y compositor
listos, dos conversaciones y 17 mensajes en la conversación abierta.
Evidencias: `tmp/startup-spotify-fix/installation.json` y
`tmp/startup-spotify-fix/installed-startup.json`.

Las suites no invocan proveedores de IA. La comprobación HTTPS no es una prueba
de consentimiento de una cuenta real, reproducción física o acceso público a
cualquier usuario. El tráfico de fondo de la aplicación no fue contabilizado;
GPU y facturación agregada no se midieron. Queda pendiente el consentimiento
real de Spotify, la comprobación de audio/dispositivo y la aprobación pública.

Revisión posterior de compatibilidad: se conserva una autorización DPAPI antigua
incluso cuando el ID anterior solo estaba en el entorno y faltaba el caché de
identidad. La identidad se recupera del registro protegido, nunca del ID personal
de entorno; al comenzar otra vinculación se vuelve a verificar la configuración
publicada. Pasan 44 pruebas Spotify en
`tmp/verification/spotify-20261113T070141-d3e33f7b.json`. Se instaló la corrección
con respaldo independiente en `tmp/startup-spotify-fix/grant-compatibility-installation.json`;
no se reescriben los hashes de la instalación anterior. El arranque final vuelve
a confirmar chat, compositor y los mismos contadores de historial en
`tmp/startup-spotify-fix/installed-startup-final.json`.

La herramienta nativa también observó el chat inicializado y el campo de entrada
en la ventana real. No logró obtener geometría de entrada ni captura de ventana
para pulsar Conexiones; esa navegación no se declara completada. Los controles de
Spotify se verificaron por el ensayo de Edge y el flujo HTTPS acotado, sin
consentimiento ni reproducción de una cuenta real.
