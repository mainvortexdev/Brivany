# Reanudación de llamadas Netelip · 10 de noviembre de 2026

El usuario informó saldo disponible y pidió llamar a su móvil terminado en
5246 desde el terminado en 9873. Después autorizó que la llamada aparezca
oculta. No se modificó ni se suplantó el identificador: sigue controlado por
Netelip. No se enviaron códigos ni se compró numeración o saldo adicional.

## Comprobaciones y resultado real

- Registro real de la cuenta guardada: SIP 200, sin marcar en esa comprobación.
- Prueba de proveedores reales con texto sintético: Muse aceptó sesión y
  reconoció audio sintético, Meta produjo respuesta y Cartesia produjo PCM con
  la identidad configurada de Melodi. Primera frase de Meta: 3953 ms en ese
  ensayo; no es latencia telefónica ni acredita rapidez equivalente a Live.
- Dos intentos PSTN al destino autorizado. Ambos recibieron medios tempranos
  SIP 183 a aproximadamente 3,55 s y rechazo SIP 403 a 6,67 s. Ninguno tuvo
  respuesta SIP 200 de llamada ni conversación. El SIP 200 de registro no se
  confunde con llamada contestada.
- El segundo intento procesó en memoria 3,12 s del aviso del operador. Muse
  reconoció texto, pero no coincidió con las categorías diagnósticas; la causa
  no se identifica con ese ensayo. No se guardó audio ni transcripción.
- El navegador integrado falló al abrir. Brave mostró el formulario de acceso
  a Netelip, sin sesión autenticada ni contraseña disponible. Se solicitó al
  usuario consultar desde el móvil el motivo del último intento. No se cambió
  contraseña ni se solicitó recuperación de cuenta.

Informes saneados en `tmp/verification/melodi-netelip-call-20261110-attempt1.json`
y `melodi-netelip-call-20261110-attempt2.json`. El estado de ejecución privada
queda en `User Data/.local/telephony/live-call-status.json`; solo contiene
metadatos operativos y los últimos cuatro dígitos del destino. No se afirma
coste cero: importes facturados desconocidos. La prueba real de proveedores
abrió una sesión de reconocimiento, una respuesta de modelo y una síntesis.
El diagnóstico del segundo intento abrió otra sesión de reconocimiento.

## Cambios para continuidad

Se mantienen los límites históricos para otros bancos que dependen del flujo
genérico de telefonía. En SIP, `LivePhoneSession` recibe `max_seconds=None`
y `max_turns=None`: no termina por ocho turnos ni por 150 s. En el motor
nativo se elimina también el corte de 150 s de llamada establecida; solo se
limita a 60 s el establecimiento no contestado. Colgado remoto, petición de
terminar y DTMF 0 siguen cerrando audio, transporte y proveedores.

La memoria de historial continúa acotada a diez mensajes; las latencias guardan
solo las últimas 256 observaciones. El fallo identifica la etapa ASR, respuesta
o transporte sin guardar texto privado. La conversación depende todavía de
saldo, red y disponibilidad de los proveedores: no se promete duración infinita.

La selección de SiliconFlow/DeepSeek se limita al chat escrito general como
se pidió. Voz Live y teléfono conservan el flujo de Meta. Una regresión verifica
que activar el proveedor de chat no redirige las solicitudes de voz.

`tools.run_melodi_sip_call` realiza un único intento autorizado, sin remarcado
automático y con señal de parada local. Mantiene el equipo despierto solo
durante su ejecución y restaura esa petición al terminar. No abre micrófonos
ni altavoces del PC. No se guarda la conversación.

## Validación y pendiente

Pasaron 22 pruebas locales de SIP/RTP, reconocimiento/modelo/voz sustituidos,
continuidad de diez turnos, cancelación y separación de proveedores. Las
pruebas de continuidad son simuladas y no acreditan conversación pública.
La siguiente acción depende del motivo del rechazo en Netelip o acceso a su
panel. No se declara alcanzado el objetivo de hablar con Melodi por teléfono.

## Reintento solicitado por el usuario

Se repitió una vez tras su nueva autorización. Registro SIP 200, medios
tempranos 183 a 3,61 s y rechazo 403 a 6,74 s; sin llamada contestada.
El aviso de 3,14 s se analizó solo en memoria y quedó sin clasificación.
Importe facturado desconocido. No se guardaron audio ni transcripción y
no se programó remarcado automático. Informe: 
tmp/verification/melodi-netelip-call-20261110-attempt3.json.

## Revisión autenticada de la plataforma y diagnóstico posterior

El navegador integrado permitió revisar la cuenta: saldo US$5,02, Línea SIP
activa, autenticación por registro, salientes «Sin restricción» y acceso por
IP «Dinámico / Todas las IPs permitidas». No se alteraron estos ajustes. El
identificador continúa «Oculto»; el móvil terminado en 9873 no está validado
como identificador en Netelip. No se atribuye el rechazo a esa condición sin
confirmación del operador.

El historial de los tres primeros intentos muestra destino dominicano correcto,
«No disponible», duración 00:00:00 y US$0,0000 por esas filas concretas. Esto
no acredita consumo cero de IA ni de otros intentos.

Un cuarto intento con la ruta oficial europea, sin cambiar el perfil guardado,
obtuvo registro 200, 183 a 3,41 s y 403 Forbidden a 6,09 s. El aviso temprano
de 2,70 s fue reconocido pero quedó sin diagnóstico fiable. El clasificador
semántico no produjo un resultado válido. No se guardó audio ni transcripción.

Se añadió extracción de códigos de respuestas SIP desde los eventos nativos,
incluyendo Reason/Q.850 y Warning si existen. Solo se transmiten a la aplicación
códigos permitidos; nunca paquetes, cabeceras completas ni identificadores.
Una prueba local detectó que el evento podía llegar por onCallState, por lo
que se cubren tanto ese callback como onCallTsxState y eventos RX directos.
Después pasaron las doce pruebas de SIP, incluidas dos llamadas locales con
SIP/RTP y proveedores de IA sustituidos.

El quinto intento, destinado únicamente a capturar la causa técnica, recibió
100, 183 y 403 a 6,92 s. No incluyó Reason/Q.850 ni Warning y no llegó a
respuesta de llamada 200. No se gastó otra petición de IA para analizar ese
intento. El coste de telefonía de los intentos cuarto y quinto sigue sin
confirmar. Informes:
`tmp/verification/melodi-netelip-call-20261110-attempt4-eu.json` y
`tmp/verification/melodi-netelip-call-20261110-attempt5-diagnostic.json`.

Se preparó una consulta técnica para Netelip, pendiente de autorización de envío.
El canal de incidencias advierte de diagnóstico facturable a 20 € más IVA si
la causa no es responsabilidad de Netelip. No se aceptó ni contrató ese servicio.
El borrador pide únicamente aclarar el 403 y excluye cargos e intervenciones
de pago. La conversación pública y la causa exacta del rechazo siguen pendientes.

## Consulta enviada con autorización

Tras autorización expresa del usuario se envió la consulta técnica de Línea SIP
a Netelip. Ticket **477816**, confirmado en estado **Abierto** en el panel:
https://cloud.netelip.com/es/settings/support/view/477816.

Incluye el teléfono de contacto/destino autorizado, fechas y horas UTC, secuencia
de códigos SIP y configuración revisada. No contiene contraseñas, grabaciones
ni transcripciones y no se adjuntaron archivos. El mensaje excluye expresamente
diagnósticos o intervenciones de pago, compras, suscripciones y cambios de
facturación. No se aceptaron cargos ni condiciones de un servicio de pago.
Comprobante local: `tmp/verification/netelip-ticket-477816.jpg`.
La causa del rechazo y la prueba de conversación real siguen pendientes.

## Numeración promocional y alternativas revisadas

Por nueva indicación del usuario se investigó numeración de prueba y otras formas
de llamar en la propia plataforma. La web oficial anuncia pruebas de 30 días
para Málaga, Madrid o México:
https://www.netelip.com/do/numeracion-telefonica/.
En la cuenta autenticada no se encontró una activación promocional en Mis números,
Administrar, el servicio de Numeración ni el selector de compra. España no figura
en el selector de países de esta cuenta. México mostró ofertas de pago. Esto no
demuestra que la promoción sea inexistente: se solicitó a soporte aclarar cómo
activarla, sin autorizar compras o renovación automática.

Precios observados en el panel, para cantidad 1, sin completar documentación,
confirmación de pedido ni pagos:

| País / ciudad | 1 mes | 6 meses, total | 12 meses, total |
| --- | --- | --- | --- |
| RD, Santo Domingo (829) | US$11,95 | US$53,70 (US$8,95/mes) | US$71,40 (US$5,95/mes) |
| EE. UU., Miami (305) | US$3,95 | US$17,70 (US$2,95/mes) | US$23,40 (US$1,95/mes) |

Son importes del selector de la cuenta, superiores a algunos mínimos publicitarios;
no son una cotización final de impuestos. La telefonía saliente consume saldo
aparte. La opción de Miami llega a un paso de documento identificativo y condiciones
del servicio: no se subió documento, no se marcaron declaraciones o aceptación
de términos y no se compró ni asignó un número. El panel también informa un cargo
por SMS recibido en la numeración estadounidense. No se activó recepción SMS.

La documentación de Línea SIP advierte que muchos canales simultáneos pueden
bloquear llamadas con poco saldo. Se redujo la línea de 10 a 1 canal; el panel
confirmó «Los cambios se han realizado correctamente». El sexto intento al móvil
autorizado recibió registro 200 y respuestas de llamada 100, 183 y 403 a 6,67 s.
No hubo respuesta ni conversación; no se afirma que el ajuste resolviera la causa.
El coste de ese intento sigue sin confirmar y no se usó IA en el diagnóstico.
Informe: `tmp/verification/melodi-netelip-call-20261110-attempt6-one-channel.json`.

El WebPhone oficial del panel está disponible y conectó la Línea SIP (botón
«Desconectar» y «Llamar» habilitado). Solo se comprobó su registro: no se llamó
desde ese cliente ni se habilitaron micrófonos. Se desconectó y cerró la pestaña
para evitar un registro competidor con el cliente de Brivany. Es otra interfaz
para la misma cuenta, no prueba de una ruta PSTN distinta o de conversación con IA.

Se amplió la misma consulta autorizada, ticket 477816, con el resultado de un
canal, el registro del WebPhone y la petición de instrucciones para el número
gratuito anunciado. El panel confirmó «Tu respuesta se ha enviado correctamente».
La petición mantiene la exclusión de cargos, compras, suscripciones, renovación
automática e intervenciones de pago. La causa del 403 y el número de prueba
utilizable siguen pendientes de Netelip. No se presupone que comprar un DID
vaya a corregir el rechazo.

Comprobantes locales: `tmp/verification/netelip-linea-un-canal-20261110.jpg`,
`netelip-precio-santo-domingo-829-20261110.jpg`,
`netelip-precio-miami-305-20261110.jpg`,
`netelip-webphone-conectado-20261110.jpg` y
`netelip-ticket-477816-alternativas-20261110.jpg`.

