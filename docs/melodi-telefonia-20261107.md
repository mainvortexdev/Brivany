# Llamadas y buzón de Melodi

## Primera llamada real de prueba

El 7 de noviembre, tras el registro del usuario con Google y la verificación
por SMS, se eligió el plan de prueba limitado de Twilio sin tarjeta. Se inició
una sola llamada saliente de consola a un destino verificado de República
Dominicana desde el número temporal que asignó Twilio. La plantilla «Play a
File» usó el audio de muestra de Twilio. El registro de voz terminó en
`Completed` con 15 s de duración. El contador pasó de 75 a 74 minutos gratuitos.

Se verificó el transporte telefónico de la cuenta. El ensayo queda separado
de la pasarela de Brivany, la voz de Melodi y el buzón. No se compró un número,
no se añadió una tarjeta y no se guardaron audio, credenciales ni datos de
contacto en la evidencia.

## Implementación en Brivany

En WorkSpace, **Herramientas → Llamadas** recibe un número y un encargo. También
se puede escribir «Melodi, llama al [número] para [encargo]» en el chat compacto.
El texto prepara el formulario. **Revisar llamada** muestra el número normalizado
y el encargo. **Llamar ahora** consume esa autorización local una sola vez.
El panel muestra progreso, permite colgar y presenta el resumen al terminar.
La pestaña **Buzón** lista los 30 mensajes más recientes y reproduce el MP3 al
elegir un mensaje.

La pasarela telefónica es un proceso separado. Twilio realiza la llamada y
reconoce los turnos de voz en español. Melodi se identifica como asistente
virtual y usa su voz Cartesia existente. El modelo recibe el encargo y el
diálogo acotado, sin herramientas de ordenador, pagos ni cambios de cuenta.
El flujo tiene cinco turnos de respuesta, 25 segundos para contestar y tres
minutos de llamada. La persona puede terminar por voz al inicio o con el
teclado durante la escucha. Un encargo de consulta o mensaje funciona por
turnos de voz. El resumen depende de lo que confirme la otra persona.

El buzón recibe llamadas al número configurado. Una locución de telefonía
anuncia la grabación y la persona pulsa uno para aceptar. Se graba hasta un
minuto con tono. El proveedor conserva el audio del buzón y la pasarela
conserva la referencia, duración y fecha. La transcripción de buzón está
desactivada. Las salientes no se graban con Twilio. Sus clips de voz e historial
de conversación se conservan en memoria durante la llamada. SQLite guarda el
recibo, estado y resumen, además del índice del buzón, en `.local/telephony/`.
El audio del buzón se solicita al reproducir y se libera al salir de la vista.

La API de escritorio exige un token dedicado. Los webhooks exigen firma de
Twilio, cuenta y referencia de llamada. El audio de respuesta de Melodi usa una
URL temporal de alta entropía. La pasarela confirma un solo destino habilitado
por solicitud y mantiene un identificador persistente para evitar rediscado
ante reintentos y respuestas inciertas. La interfaz consulta periódicamente
solo mientras muestra una llamada activa. El servicio queda deshabilitado
hasta que se configura una pasarela. No se inicia con Desktop.

## Prueba gratuita y conexión posterior

**Primera prueba telefónica.** La cuenta de prueba de Twilio ofrece 75 minutos
por 30 días, sin tarjeta, y admite República Dominicana. La cuenta debe
corresponder al país del destino y el número receptor debe estar verificado.
**Voice → Try out Voice** asigna un número de prueba compartido para el destino
y deja probar una llamada con las plantillas de la consola. La llamada anterior
verificó ese trayecto telefónico. [Prueba y países](https://www.twilio.com/docs/usage/trials).

La prueba tiene restricciones de Voice API y bloquea `<Record>`. El buzón
propio necesita un número compatible con voz y una cuenta que permita grabar.
Brivany aporta el buzón, por lo que no hace falta contratar un buzón separado.
Twilio puede cobrar el número, los minutos, grabación y almacenamiento. Meta y
Cartesia tienen su propia cuota. Se confirmará disponibilidad y precio de un
número dominicano antes de comprar. [Límites de Voice](https://www.twilio.com/docs/usage/trials/try-out-voice),
[tarifas en RD](https://www.twilio.com/en-us/voice/pricing/do),
[requisitos del número](https://www.twilio.com/en-us/guidelines/do/regulatory).

**Configuración del módulo completo.** Instalar `requirements-h1.txt` en el host
de la pasarela. Usar un único proceso con una base persistente y publicar solo
la pasarela de loopback mediante un proxy HTTPS dedicado. El proxy conserva
rutas y cuerpos originales, con registro de URLs y cuerpos desactivado. El
servidor no se enlaza a interfaces externas. Las credenciales entran por el
entorno del host y se mantienen fuera de Git y del chat.

| Ubicación | Variables |
| --- | --- |
| Pasarela | `BRIVANY_CALL_PUBLIC_ORIGIN` y `BRIVANY_CALL_GATEWAY_TOKEN` |
| Telefonía | `BRIVANY_TWILIO_ACCOUNT_SID`, `BRIVANY_TWILIO_AUTH_TOKEN` y `BRIVANY_TWILIO_RD_NUMBER` |
| Habilitación | `BRIVANY_CALL_OUTBOUND_ENABLED=1`, `BRIVANY_CALL_ALLOWED_DESTINATIONS` con números separados por comas, `BRIVANY_CALL_VOICEMAIL_ENABLED=1` según lo que se active |
| Voz y conversación | `BRIVANY_CARTESIA_API_KEY`, `BRIVANY_META_API_KEY` y `BRIVANY_META_MODEL` cuando se habiliten salientes |
| Desktop | `BRIVANY_CALL_GATEWAY_ORIGIN` y el mismo `BRIVANY_CALL_GATEWAY_TOKEN` |

El comando de arranque es `python -m services.telephony.server --port 8787`.
Configurar el webhook de voz entrante del número en `POST /twilio/mailbox/incoming`
del origen público. Las URL de respuesta y estado de cada salida se crean al
confirmar. Antes de abrir el servicio a llamadas entrantes, revisar acceso,
retención de grabaciones y presupuesto en la cuenta del proveedor.

## Comprobaciones

- `tools.verify telephony` pasó 11 casos con HTTP real en loopback, firma,
  revisión y cancelación, dos turnos simulados, autenticación de buzón y
  callback de grabación. Transporte PSTN, modelo y síntesis sustituidos.
- `tools.verify telephony-ui` pasó en Edge con un puente sustituido. La orden
  del chat abrió la revisión, editar no marcó y una única confirmación simuló
  la salida. El buzón reprodujo un MP3 sintético y liberó la fuente al cerrarse.
  La revisión se comprobó a 340 px. El primer ensayo detectó que la orden con
  un número entre paréntesis no llegaba a Llamadas. Se corrigió el analizador
  y se conserva el informe fallido.
- Durante estas comprobaciones se usaron exclusivamente números ficticios y
  audio sintético. Cero llamadas PSTN, activaciones de cuenta, compras o
  inferencias. GPU total desconocida para la interfaz de Edge. Calidad de voz,
  disponibilidad de línea, latencia real y entrega del buzón siguen pendientes
  de una prueba telefónica real.

Informes en `tmp/verification/melodi-telephony-20261107.json`. El número personal
del usuario no forma parte del código, de las pruebas ni de las evidencias.

## Conversación breve desde la consola de prueba

La consola de la cuenta limitada muestra **Start a call → Custom → Custom
TwiML URL** y conservaba 74 minutos. Se preparó un modo de un solo destino para
esa ruta. `python -m services.telephony.trial --confirmed-voice-credits`
prepara el saludo con la voz española de Melodi después de confirmar un mínimo
de 1.000 créditos de voz. Se reutilizan Meta y Cartesia mediante sus APIs. Se
configuran en el entorno el origen HTTPS
dedicado, SID de cuenta, clave de Twilio y voz de Cartesia, además de
`BRIVANY_TWILIO_TRIAL_FROM` y `BRIVANY_TWILIO_TRIAL_TO`. La base de esta prueba
vive en memoria. La consola es la única que puede iniciar la llamada.

El listener público permite únicamente los webhooks firmados y el WAV efímero
del mismo emisor y destino. Meta recibe hasta dos turnos, con espera acotada
en cada petición para reducir los saltos de TwiML. El buzón queda fuera de
esta modalidad. Catorce casos de telefonía y el recorrido de Edge pasaron con
efectos sustituidos. Entre esos casos, HTTP local comprobó dos turnos, rechazo
de firma falsa, rechazo de emisor incorrecto y cierre con audio de respuesta.

La consulta de catálogo de Cartesia confirmó que el ID español sigue activo.
Su endpoint administrativo de créditos respondió 401 con la credencial
disponible. El usuario confirmó saldo suficiente. Una comprobación HTTPS
posterior del túnel devolvió 200 con datos sintéticos. La prueba real de Meta
y Cartesia recibió una respuesta de 84 caracteres y generó 4,64 segundos de
voz en memoria. Los tiempos observados fueron 4,157 s de respuesta y 2,406 s de
síntesis. Hubo una petición de cada proveedor; el importe facturado no se pudo
consultar. El ajuste de espera admite ese recorrido sin bloquear el estado.

La descarga de Qwen propuesta inicialmente se canceló por instrucción del
usuario y se retiraron sus archivos parciales. El modo de prueba usa la API
de Meta existente. El control del navegador indicó acceso desactivado y luego
agotó el tiempo de conexión. Sigue pendiente vincular la credencial de Twilio.
El formulario `python -m tools.prepare_melodi_trial --share` permite guardarla
con DPAPI desde el móvil, mediante un enlace HTTPS temporal de un uso. Solo
publica el formulario. El servidor y el conector terminan al guardarlo o a los
15 minutos. Las credenciales permanecen fuera de Git y de la bitácora.

`--credentials-file .local/telephony/twilio-trial.dpapi` carga esa configuración.
`--dial` envía una sola solicitud a la API de Twilio y limita la llamada a
100 segundos. Una respuesta incierta conserva el listener para reconciliar el
webhook y requiere comprobar los registros antes de volver a marcar. La
conversación real por teléfono sigue pendiente.

## Corrección posterior: requisito de conversación Live

El navegador integrado volvió a funcionar y se guardó la credencial con DPAPI.
Las pruebas por consola llegaron a reproducir una respuesta, pero el usuario no
pudo mantener una conversación. El resultado se registra como fallido frente
al requisito de rapidez Live. Se implementó un puente continuo Muse–Meta–Cartesia
con Media Streams, probado en loopback y deshabilitado por defecto. La prueba
limitada de Twilio bloquea ese transporte; no se realizó una compra ni se
certifica la latencia telefónica. [Cambio, mediciones y límites](melodi-llamadas-live-20261107.md).
