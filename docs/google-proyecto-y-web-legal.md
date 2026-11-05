# Proyecto Google Brivany y páginas públicas

31 de octubre de 2026, hora de La Paz.

Se creó un proyecto independiente de Google Cloud con nombre Brivany e ID
`brivany`. Se habilitaron Gmail API, Google Drive API y Google Calendar API en
ese proyecto, conservando ProjectFixtureAI. El usuario confirmó la aceptación de las
condiciones de Calendar y de la Política de Datos del Usuario de Google en el
paso correspondiente.

Se creó el cliente de escritorio Brivany Desktop · Melodi, identificado como
cliente para agente de IA. La configuración se guardó en el almacén local
existente y se instaló en la instancia abierta de Brivany mediante su API
loopback de credenciales. No se incluyen credenciales, archivos de importación,
URLs de autorización ni información de las cuentas en estas evidencias.

Google tiene declarados los permisos iniciales de consulta que soporta la app:
`calendar.events.readonly`, `gmail.readonly` y `drive.metadata.readonly`. La
declaración de permisos y la creación del cliente no conceden acceso a una
cuenta. El proyecto sigue en modo de prueba; su autorización y los resultados
reales se documentan separadamente.

## Publicación

El usuario indicó Daniel Luna y el correo público de contacto para las páginas.
La web incorpora una portada descriptiva, privacidad y condiciones de uso, con
tipografía del sistema, índice por anclas, enlaces recíprocos y estilos de
impresión. Se explican los datos procesados, proveedores, finalidad, conservación,
revocación/eliminación y restricciones de uso de Google. Se distinguen búsquedas
de metadatos, consulta de eventos y borradores/eventos con permiso adicional.
No se inventó domicilio, país ni denominación de una sociedad.

- Inicio: `https://brivany.example/`
- Privacidad: `https://brivany.example/privacidad`
- Condiciones: `https://brivany.example/condiciones`

Los mismos enlaces y el dominio autorizado `example.com` quedaron guardados en la
información de marca de Google. Estas páginas no acreditan una aprobación de
Google ni sustituyen los demás requisitos de revisión de la aplicación.

## Pruebas

`spotify-relay` pasó 34 comprobaciones locales, incluidas las rutas públicas,
HEAD, enlaces y canonical, redirecciones, robots, sitemap, 404/405 y el flujo
OAuth de Spotify con proveedor sustituido. Sin cuentas reales o peticiones a
Spotify en esa suite. El workerd instalado admite fecha 2026-09-04; la producción
conserva 2026-10-31 y pasó el dry run de Wrangler. Un primer ensayo encontró la
expectativa antigua de portada temporal y se actualizó al nuevo contenido.

La revisión DOM con navegador integrado comprobó las tres páginas a 320, 768 y
1280 píxeles sin desbordamiento horizontal. La inspección visual de escritorio
permitió corregir la selección de una fuente Inter local que se mostraba con un
peso excesivo. La captura de móvil del navegador se devolvió reducida a 305 × 172;
se usa solo como dato auxiliar, no para afirmar fidelidad visual completa móvil.

Se desplegó el Worker `brivany-site` en su Custom Domain existente, versión
`eea6d74c-b6b1-4f68-88c7-50ebb8282921`. Se hicieron seis consultas HTTPS públicas
reales, sin autenticación de cuenta ni inferencia, y se comprobó el callback
Spotify sin caché. El tráfico del navegador, despliegue y proveedores de la app
abierta no se cuantificó.

Evidencias: `docs/verification-history/spotify-relay-20261101T014451-a4abce9e.json`,
`tmp/google-setup/legal-responsive.json`, `tmp/google-setup/public-https.json`.

Referencias: políticas OAuth y requisitos de verificación de Google,
`https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance`,
`https://support.google.com/cloud/answer/13464321`, y política de uso de datos,
`https://developers.google.com/terms/api-services-user-data-policy`.
