# Google: producción, conexiones y revisión

8 de noviembre de 2026.

## Estado comprobado

Proyecto Google Cloud `brivany`, número `125198900429`.

| Comprobación | Resultado |
| --- | --- |
| Gmail API, Drive API y Calendar API | Habilitadas previamente; comprobadas en Cloud Console |
| Cliente OAuth de escritorio | Se reutilizó Brivany Desktop · Melodi |
| Publicación de la app | En producción |
| Verificación automática de marca | Aprobada y marca publicada |
| Revisión de permisos sensibles/restringidos | Video y justificaciones guardados en Google; cuestionario final pendiente, solicitud todavía no enviada |
| Almacén local | Acceso reparado para el usuario felix; propietario felix y permisos para felix, SYSTEM y Administradores |
| Persistencia de autorizaciones | Comprobada desde un proceso nuevo; tokens cifrados mediante DPAPI del usuario de Windows |

La configuración del cliente se recuperó de la copia original de Brivany y se instaló mediante la API local de credenciales. No se crearon clientes ni secretos adicionales. Los valores privados no se incluyen en este informe. Se habilitó la ejecución de operaciones revisadas; se conserva la aprobación vinculada a los parámetros de cada acción.

## Cuentas y pruebas reales

| Servicio | Cuenta autorizada por el usuario | Alcance | Prueba |
| --- | --- | --- | --- |
| Gmail | felixdanielluna40@gmail.com | `gmail.readonly` | Búsqueda correcta, 20 referencias; sin descargar cuerpos |
| Drive | ceo@vetsa.es | `drive.metadata.readonly` | Búsqueda correcta, sin coincidencias |
| Calendar | ceo@vetsa.es | `calendar.events.readonly` | Consulta correcta, sin eventos en el intervalo |

Las consultas recorrieron propuesta, aprobación y ejecución de la API de Brivany. Los informes guardan estados y recuentos; no guardan mensajes, identificadores, archivos ni eventos recibidos. No se enviaron correos ni se modificaron archivos o eventos.

La primera prueba de Gmail con ceo@vetsa.es no se completó. La API devolvió `400 FAILED_PRECONDITION` y la interfaz de Google mostró «Agrega Gmail a tu cuenta de Google». El usuario autorizó sustituir únicamente el conector Gmail por su buzón personal. La primera ejecución permanece registrada como resultado incierto en el diario existente; no se eliminó ni se presentó como exitosa. La prueba posterior en el buzón correcto sí terminó correctamente.

## Lo que falta para enviar la revisión de datos

El usuario publicó el video de 2:14 en https://youtu.be/Z644d_ZkvVA. El enlace se comprobó en YouTube y se guardó junto con las tres justificaciones y sus categorías. Google Cloud confirmó «Se guardaron los cambios de acceso a los datos». La página pública y la política de privacidad de https://brivany.vetsa.es también se comprobaron mediante el navegador integrado.

En el centro de verificación se confirmó que la marca está verificada y publicada y que el acceso a los datos todavía no está verificado. Se abrió «Prepare for verification» y se completó la información adicional del escritorio nativo, PKCE, retorno loopback, cifrado DPAPI y flujo directo entre el PC y Google. Al confirmar se abrió el cuestionario final; no se pulsó «Enviar para la verificación».

La siguiente interacción con el navegador devolvió «Local browser use is disabled in Work settings». No se intentó eludir esa configuración con otra herramienta. Para continuar es necesario que el usuario reactive el uso del navegador en Work.

Antes del envío final:

1. Revisar las preguntas de uso personal, interno, desarrollo/pruebas y complemento SMTP de WordPress conforme al lanzamiento público autorizado por el usuario.
2. Revisar las dos declaraciones sobre requisitos y CASA sin afirmar evaluaciones no realizadas ni comprometer pagos.
3. Comprobar la adecuación del video a los requisitos: muestra los permisos en inglés y las consultas reales, con correos ocultos. El ID público se presenta en una placa; no se capturó la barra nativa del navegador. La documentación de Google pide el ID en esa barra y el flujo completo de autorización; puede requerirse una grabación complementaria antes de declarar el cumplimiento íntegro.
4. Enviar únicamente cuando las respuestas y declaraciones sean correctas y conservar evidencia del estado que devuelva Google.

La aprobación del acceso a los datos corresponde a Google. La aprobación de marca y el modo de producción no equivalen a esa aprobación. No se han presentado declaraciones sobre evaluaciones de seguridad que no se hayan realizado; Google puede solicitar información adicional sobre los flujos de datos durante la revisión.

## Justificaciones preparadas

### Calendar

Brivany is a native desktop assistant. When the user requests an agenda lookup, it lists events from the primary Google Calendar within the requested time range and displays event titles, start times and end times. calendar.events.readonly is needed because free/busy alone does not provide event details. This integration does not use this scope to create, change or delete events. Access is initiated by the user through a reviewed operation. OAuth refresh tokens are stored locally encrypted with Windows DPAPI.

### Drive

Categoría seleccionada: Productividad de Drive.

Brivany lets the user search existing Google Drive files by a name fragment across their Drive and displays matching file names, MIME types and identifiers. drive.metadata.readonly is required to search metadata of existing files beyond files selected or created with the app; drive.file would not support that cross-Drive search. File contents are not downloaded, modified, uploaded or deleted by this integration. Requests originate in the native desktop backend and refresh tokens are stored locally encrypted with Windows DPAPI.

### Gmail

Categoría seleccionada: Productividad del correo electrónico.

Brivany provides a user-requested Gmail search using the Gmail API messages.list endpoint with the user supplied q filter. The current integration returns message and thread identifiers for matching messages; it does not fetch message bodies or change mail. gmail.readonly is needed because Gmail metadata scope does not permit the q parameter used for this search. The integration does not send mail or create drafts with this scope. Requests are executed by the native desktop backend after review; refresh tokens are stored locally encrypted with Windows DPAPI.

## Evidencia local

- `tmp/google-setup/production-20261108.jpg`
- `tmp/google-setup/verification-status-20261108.jpg`
- `tmp/google-setup/verification-draft-20261108.txt`
- `tmp/google-setup/google-real-reads-20261108.json`
- `tmp/google-setup/google-persistence-20261108.json`
- `tmp/google-setup/repair-google-store-access-result.json`

Fuentes oficiales: [revisión de permisos restringidos y requisitos del video](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [búsquedas de Gmail y limitación de gmail.metadata](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [alcances de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Reanudación del 9 de noviembre de 2026

El navegador integrado permitió abrir de nuevo el centro de verificación del proyecto `brivany`. Google mostró literalmente «Se verificó la información de tu marca y se muestra a los usuarios». La marca está aprobada y publicada; no requiere otro video para esa etapa. En el mismo panel, el acceso a datos seguía sin verificar.

Se abrió el resumen de envío y se comprobaron los tres permisos de lectura, sus justificaciones y el enlace de YouTube existente. Se preparó en el formulario una explicación técnica de 676 caracteres sobre el cliente de escritorio, PKCE, retorno loopback, DPAPI y consultas directas a Google. Confirmar ese resumen abrió el cuestionario. No se marcaron las declaraciones finales ni se pulsó «Enviar para la verificación». Esa información del formulario no debe darse por persistida tras cerrar o recargar la pestaña.

Para el requisito pendiente del identificador en la barra nativa se reutilizó la grabación ya realizada, sin nuevas autorizaciones ni consultas a Google. Se preparó localmente `Exports/Brivany-Google-Demo-20261108/Brivany-Google-OAuth-Consentimiento.mp4`: 41 segundos con la barra real, los permisos de Gmail en inglés y el retorno a Brivany. Correos y URL privada de retorno se cubrieron con máscaras opacas. La decodificación completa y el OCR de 41 fotogramas del archivo codificado pasaron sin candidatos de correo. El informe es `OAuth-Consentimiento-validacion.json`. El complemento no está publicado ni asociado aún a la solicitud; el enlace principal de YouTube no se cambió.

Después de esas comprobaciones, el control del navegador volvió a devolver «Local browser use is disabled in Work settings». La solicitud de acceso a datos permanece sin enviar. No se intentó controlar otro navegador ni usar mecanismos alternativos para eludir ese ajuste.

El usuario pidió iniciar Brivany para probar la traducción auditiva con el directo del hackatón y después continuar con Google. Se inició el ejecutable instalado con `--island` y se comprobó que sus procesos seguían activos. No se inició la traducción ni se declaró realizada una prueba de audio.
