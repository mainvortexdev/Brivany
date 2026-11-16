# Cuenta Vetsa dentro de Brivany Desktop

Entrega del 12 de noviembre de 2026. El acceso se realiza en la aplicación de
escritorio, por indicación del usuario. El menú «Cuenta Vetsa» abre el panel de
cuenta; «Iniciar sesión con Vetsa» abre una ventana nativa de WebView2 de Brivany.
No se abre el navegador externo ni se ejecuta Brivany como una página web.

## Identidad y configuración

Brivany usa la identidad central existente de `https://cognira.vetsa.es`, compartida
con Vetsa y Cognira. El servidor reutiliza el mismo identificador de usuario; no
copia cuentas, contraseñas ni tokens del directorio de Cognira. Una persona con
cuenta existente debe iniciar sesión con esa cuenta, sin crear otra.

El panel muestra nombre, correo, verificación del correo, Vetsa Three Auth,
cantidad de claves de acceso y alertas de seguridad. «Mi cuenta» y «Seguridad VAS»
abren la gestión central en otra ventana nativa aislada. Las operaciones de
seguridad conservan las comprobaciones del servidor de Cognira; el panel local
no puede desactivarlas. La gestión central puede pedir autenticación nuevamente.

## Protecciones

- La ventana de identidad recibe `js_api=None`: no tiene el puente de herramientas,
  archivos, terminal, chat ni configuración privada de Brivany. Solo se admiten
  inicialmente HTTPS, el host central exacto y las rutas `/auth` o `/account`.
- Contraseña, PIN y pruebas WebAuthn se tramitan en el contenido central aislado.
  Brivany recibe un código de un solo uso mediante PKCE S256 y un estado aleatorio
  con caducidad de diez minutos. No recibe la contraseña ni la clave privada.
- El retorno escucha únicamente en `127.0.0.1:41416/auth` mientras se inicia sesión.
  Comprueba Host, ausencia de Origin, ruta, estado, generación y parámetros únicos.
  No sirve la interfaz de Brivany al navegador. El puerto local solo entrega el
  código al proceso nativo; la identidad se consulta por HTTPS.
- La sesión tiene audiencia `brivany-desktop`, identificador revocable en D1 y
  versión de seguridad de la cuenta. Un token de otro cliente no sirve para esta
  API, ni un token de Brivany permite usar las API generales de Cognira.
- La sesión persistente se cifra con Windows DPAPI en
  `%LOCALAPPDATA%/Brivany/User Data/.local/vetsa-account/session.dpapi` para la app
  instalada. No se publica el token mediante el estado del puente, localStorage,
  URL ni mensajes de error.
- Se comprueba la sesión al abrir y cada cinco minutos. Un fallo temporal de red
  conserva el archivo cifrado y muestra el estado de desconexión; una revocación
  confirmada elimina la sesión local. La renovación respeta la política central
  y el máximo absoluto de noventa días; una sesión vencida requiere nuevo acceso.
- Cerrar sesión revoca exclusivamente la sesión de Brivany y cierra sus ventanas
  de gestión. Si no se pudo confirmar la revocación por falta de red, se informa.
- Iniciar sesión no habilita control remoto ni concede permisos de Gmail, Drive,
  Calendar o acceso al ordenador. No cambia el proveedor del chat de Melodi.

## Cambios del servidor e instalación

Worker `cognira-auth`, versión activa `65da8a12-fb00-4445-bec4-1da006fd1147`,
despliegue `c2b2f975-253b-44bb-b02b-16b0d0b90e67`. Migración aplicada:
`workers/migrations/0010_brivany_sessions.sql`; añade una tabla de sesiones sin
alterar registros existentes de usuarios.

El código publicado se preparó desde la versión realmente activa de Cognira
`423ba1f9-5284-4b37-b066-c634a6c154d1`, conservando su comportamiento previo y
añadiendo únicamente el soporte de Brivany. No se publicó el resto de cambios
pendientes del repositorio de Cognira.

Se actualizaron nueve archivos de la instalación existente `0.1.0`, con respaldo
verificado y sin cambiar User Data ni la versión del paquete. En el lanzador
instalado se sustituyó exclusivamente la fábrica de cuenta: se conservaron sus
versiones actuales de las funciones de traducción, que tienen cambios pendientes
en el repositorio fuente. Brivany se cerró normalmente mediante su control privado
de ciclo de vida y se volvió a iniciar.

Respaldos locales:

- `.local/motion-runtime-backups/20261112T034003Z-75d9b43d/manifiesto.json`
- `.local/motion-runtime-backups/20261112T052424Z-e1b57b83/manifiesto.json`

## Evidencia y límites

- 22 pruebas Python: PKCE, retorno de un solo uso, estado/Host falsos, cierre o
  cancelación durante el intercambio, revocación, fallo de almacenamiento cifrado,
  persistencia DPAPI, aislamiento del puente y compatibilidad de cuenta anterior.
- 25 pruebas sobre el código exacto preparado para producción: identidad Brivany,
  verificación de correo, recuperación, claves de acceso, PIN, Three Auth y
  renovación. Otras nueve pruebas sobre el árbol fuente actual de Cognira
  confirmaron la compatibilidad con Vetsa móvil y las pruebas de seguridad.
- Recorridos de interfaz en Edge con identidad sintética: acceso pendiente,
  cancelación, perfil, seguridad, cierre de sesión y variantes clara, oscura y
  compacta. Evidencia: `tmp/vetsa-account-ui/report.json`.
- Prueba real del componente nativo de WebView2 contra el formulario público:
  origen y ruta correctos, formulario de Vetsa renderizado, botón de Google oculto
  y cero métodos nativos en la ventana de identidad. No se introdujeron
  credenciales ni se inició sesión. Evidencia:
  `tmp/verification/vetsa-native-window.json`.
- La app instalada arrancó con el botón «Cuenta Vetsa» y su control privado indicó
  `ready: true`. El historial anterior seguía presente. La captura de Windows
  devolvió errores de tiempo de espera; no se declara completado por ese medio
  el recorrido manual completo del inicio de sesión.

Queda por probar con el usuario el acceso real de su cuenta, su dispositivo
WebAuthn/Windows Hello y la gestión central de seguridad desde Brivany. El acceso
Google directo está oculto en esta ventana integrada; se utiliza el acceso propio
de Vetsa. Esta entrega unifica identidad, no sincroniza conversaciones, archivos,
credenciales de proveedores ni autorizaciones de otras integraciones.
