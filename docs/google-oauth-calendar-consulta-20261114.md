# Google OAuth: nueve permisos y Calendar Desktop de consulta

Decisión explícita del titular, 14 de noviembre de 2026 (America/La_Paz): mantener
los nueve scopes declarados en el proyecto brivany / 125198900429 y retirar la
opción de escritura Calendar del cliente Desktop. El calendario dedicado de
WhatsApp conserva calendar.app.created.

Se retiró calendar.create del constructor OAuth y del transporte Google,
se limita la capacidad anunciada/propuesta por el transporte y se bloquea
/evento antes de registrar la operación. La interfaz no muestra escritura
Calendar. Los tokens históricos más amplios pueden seguir usándose para
consulta; no se solicitan grants nuevos de escritura. Se conserva el esquema
genérico del diario para registros históricos y transportes simulados.

Validación local con la .venv del proyecto: google-oauth 23/23,
connections-http 13/13, personal-providers 9/9, chat-requests 16/16 e
integrations 12/12: 73/73. Las primeras cuatro suites están registradas por
tools.verify; integrations se ejecutó con unittest. Datos sintéticos, sin
operaciones reales contra Google. No acredita CASA ni el video WhatsApp.

Los cinco archivos de producción se copiaron a la instalación 0.1.0 únicamente
tras comprobar que coincidían con sus hashes previos y que no estaba abierta.
Se guardaron copias previas en el espacio de trabajo Codex. No se tocaron
credenciales, proyectos ni datos de usuario. El texto de privacidad se ajustó
en el código del sitio; su publicación debe comprobarse por separado.

La lectura real de Cloud Console identificó exactamente dos clientes, los
nueve permisos y acceso a datos en revisión. Marca aprobada; video registrado:
https://youtu.be/Z644d_ZkvVA. El expediente distingue evidencias locales,
publicaciones y pendientes; no se ha enviado una afirmación de cumplimiento.
