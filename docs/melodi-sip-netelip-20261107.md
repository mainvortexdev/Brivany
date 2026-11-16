# Melodi: SIP y alternativas al alquiler de numeración

7 de noviembre de 2026, hora del usuario; informes posteriores fechados el 8 UTC.

## Dirección y estado

El usuario prioriza terminar las llamadas de Melodi antes de continuar otras
funcionalidades. Twitch y YouTube no forman parte de este hito. Se conserva la
voz actual y los proveedores remotos; no se descargan modelos de IA.
`PLAN_PLATAFORMA.md` y `OBJETIVO_WORKSPACE.md` reflejan esta prioridad.

Se preparó un trabajador SIP nativo aislado en `services/telephony/sip_engine.py`.
Recibe configuración por entrada estándar, limita los destinos y la duración,
usa audio PCM en memoria y no abre micrófono ni altavoces físicos. Se instaló
PJSUA2 2.15.1 en un directorio local aislado: es una biblioteca de telefonía,
no un modelo. Su distribución requiere revisar la licencia GPL/comercial de
[PJSIP](https://www.pjsip.org/licensing.htm); el prototipo no se declara listo
para distribución.

Una comprobación real y acotada de registro de la Línea SIP de Netelip obtuvo
estado SIP 200. Las credenciales pasaron por memoria, sin guardarse en archivos.
No se marcó a la red telefónica ni se invocaron proveedores de IA. El importe
facturado de esa comprobación no se conoce.
[Resultado saneado](../tmp/verification/netelip-sip-registration-20261107.json).

La integración de este trabajador con el panel y el flujo de conversación Live
sigue pendiente. Un registro SIP aprobado no acredita una conversación con
Melodi ni garantiza latencia equivalente al modo Live.

## Verificación local y correcciones

`tools.verify telephony-sip-native` aprobó una llamada SIP/RTP entre dos
procesos propios con señal sintética bidireccional. El primer bloque no nulo
llegó a 31 ms en cada sentido; el envío completo de la muestra se marcó a
156 ms. Se comprobaron vaciado de audio pendiente y finalización de llamada.
Son medidas locales, sin red pública, NAT exterior, IA ni escucha humana.
No hubo solicitudes al operador o a proveedores de IA en este ensayo.

[Informe de suite](../tmp/verification/telephony-sip-native-20261108T004855-517676b0.json),
[detalle de loopback](../tmp/verification/sip-native-loopback-20261108T004903-2ec10346.json).

Dos intentos locales anteriores no alcanzaron `media_ready`. Se corrigieron
la cuenta predeterminada de la prueba, la conservación del objeto padre SWIG
al recorrer los medios y la asignación de puertos RTP efímeros. Esta descripción
de los fallos es retrospectiva: el primer banco reutilizaba una ruta de informe
y no conservó los dos JSON originales por separado. No se presentan como
artefactos originales retenidos. El banco ahora crea nombres únicos.

También se corrigió la medición: el tiempo inicialmente rotulado como primera
señal incluía esperar el marcador de envío completo. Ahora se miden ambos
instantes por separado. Un marcador `rtp_submitted` acredita entrega al reloj
local de transmisión; no demuestra que una persona haya oído el audio.

## Alternativas verificadas de numeración

- **Número propio como identificador saliente.** Netelip permite solicitar un
  identificador propio aportando factura de la línea y documento del titular.
  El panel ofrece República Dominicana. La documentación de Netelip también
  contempla móviles propios sin portabilidad. La aprobación específica del
  móvil del usuario sigue pendiente; no se ha enviado documentación ni se ha
  cambiado el identificador. Esto no traslada las llamadas entrantes a Melodi.
  [Guía vigente](https://www.netelip.com/centro-de-ayuda/linea-sip/configuracion-del-servicio/identificador-de-llamada/),
  [manual con la opción móvil](https://static.netelip.com/downloads/manuales/GUIA_RAPIDA_PANEL_USUARIO_Netelip.pdf).
- **Sin número contratado.** Netelip confirma llamadas salientes con número
  oculto. Permite evitar el alquiler de un DID; las llamadas a teléfonos siguen
  requiriendo saldo y no muestran un número dominicano.
  [SIP Trunking](https://www.netelip.com/centro-de-ayuda/sip-trunking/preguntas-frecuentes/),
  [Línea SIP y coste de llamadas](https://www.netelip.com/centro-de-ayuda/linea-sip/preguntas-frecuentes/).
- **Numeración de otro operador.** Zadarma publica números locales de RD a
  US$7,50 al mes o US$5 al mes con pago anual, más llamadas salientes.
  Es una tarifa pública, sin comprobar disponibilidad ni precio en una cuenta
  del usuario. Permite entrega a un servidor SIP externo. Esto no confirma
  que Netelip acepte ese encaminamiento o su portabilidad dominicana; se puede
  integrar el proveedor SIP directamente en Brivany sin pasar por Netelip.
  [Tarifas](https://zadarma.com/en/tariffs/numbers/dominican-republic/),
  [entrega SIP](https://zadarma.com/es/support/faq/virtual-numbers/connect-number-to-server/).

Netelip no porta móviles. Para portabilidad internacional exige consulta
previa; no se ha confirmado que pueda portar un DID de RD ni su coste.
[Condiciones de portabilidad](https://www.netelip.com/centro-de-ayuda/numeros-virtuales/administracion-del-servicio/preguntas-frecuentes/).

La recomendación para llamadas salientes es intentar validar el móvil propio
antes de alquilar un DID. No se declara un precio cero de verificación sin
confirmación del proveedor. No hubo compra, recarga, portabilidad ni envío de
documentos de identidad. Recibir llamadas o buzón directamente en Melodi
requiere resolver por separado la ruta entrante.

## Integración posterior: panel y voz Live

El usuario eligió mantener las llamadas entrantes en su móvil, que es prepago,
y aplazó su validación como identificador. Pidió aviso y autorización antes de
cualquier llamada real que muestre ese número. No se contrató numeración, no
se solicitó código, no se remitieron documentos y no se cambió el identificador
de Netelip. La documentación consultada no acredita una vía de verificación
de prepago únicamente por SMS. Mientras siga el estado observado, la salida
sería oculta. La aprobación específica del identificador no se declara lograda.

Se conectó `SIPGateway` al panel existente mediante `TelephoneBridge`. Usa el
motor nativo tras confirmar la revisión, con una única llamada activa y destinos
permitidos. Los recibos locales evitan remarcado al repetir una solicitud o
reiniciar; no guardan encargo, conversación, audio ni credenciales. El cierre de
Brivany termina la sesión y el proceso nativo. No se abre un servidor público.

`LivePhoneSession` acepta PCM mono de 24 kHz para SIP, sin convertirlo de nuevo
a mu-law en Python; PJSIP realiza la conversión del códec RTP negociado. Se
reutilizan Muse, Meta, Cartesia, salida progresiva e interrupción por voz. La
historia en memoria distingue texto con acuse del transporte: para SIP el límite
es `rtp_submitted`, nunca escucha o reproducción remota acreditada. Se conserva
el formato mu-law de Twilio como opción independiente. Las llamadas nuevas se
bloquean antes de marcar si faltan las claves de voz o el modelo configurado.

La selección `BRIVANY_CALL_PROVIDER=sip` admite credenciales de entorno.
También se preparó `python -m tools.prepare_melodi_sip`, formulario de un uso
en loopback que guarda un perfil con Windows DPAPI únicamente al pulsar
Guardar conexión. No registra ni marca al guardar; no genera contraseñas ni
acepta términos de un operador. El perfil y los recibos quedan bajo `.local`,
fuera del control de versiones. Un perfil SIP guardado se detecta al abrir el
panel si no hay selección explícita de otro proveedor. No se guardaron
credenciales SIP reales en esta continuación.

La interfaz omite el buzón de Melodi cuando las entrantes siguen en el móvil.
Edge comprobó revisión, edición, confirmación y cancelación a 340 px; el
formulario SIP rechazó otro origen y guardó solo credenciales ficticias con
DPAPI. El primer intento de esta suite falló por no localizar Playwright;
se conserva el informe. Se reutilizó la dependencia instalada, sin descargarla.

Verificaciones finales:

- 9 pruebas SIP aprobadas, con dos llamadas SIP/RTP reales **solo en loopback**.
  Un recorrido partió de la confirmación del panel hasta dos turnos con Muse,
  Meta y Cartesia sustituidos, y colgado remoto. Otro comprobó entrada PCM y
  salida de respuesta antes de terminar el productor del modelo.
- 6 pruebas del flujo continuo y 17 de telefonía aprobadas.
- Edge y los formularios Twilio/SIP aprobados; guardado ficticio sin llamadas.
- Sintaxis de los cinco archivos Python de integración y revisión del diff
  correctas. No se midió la latencia de una conversación pública con Melodi.

[SIP](../tmp/verification/telephony-sip-20261108T010933-d0fbdaa0.json),
[flujo continuo](../tmp/verification/telephony-realtime-20261108T010949-f7dbb442.json),
[telefonía](../tmp/verification/telephony-20261108T010750-bb24de62.json),
[Edge](../tmp/verification/telephony-ui-20261108T010943-6b2db3d3.json),
[fallo de dependencia conservado](../tmp/verification/telephony-ui-20261108T010718-3f9cf935.json).

Los ensayos de esta continuación no usaron operador, PSTN, micrófono, altavoces
ni APIs de IA reales. La automatización del navegador agotó repetidamente su
tiempo de espera. Quedan pendientes guardar la conexión real en Brivany, comprobar
su activación y saldo vigentes y la prueba telefónica autorizada. No se declara
funcionamiento integral en la red telefónica ni igualdad de rapidez con Live.

## Preparación posterior de conexión sin llamada

El navegador integrado volvió a responder y el usuario restableció su sesión.
Se leyó la configuración SIP existente y se preparó el formulario local, sin
remitir documentos de identidad, cambiar el identificador ni guardar todavía
la credencial. Se pidió autorización explícita para el guardado cifrado en el
equipo; la solicitud no autoriza llamadas.

`NativeSIP.connect()` separa el registro de la marcación. La herramienta
`tools.check_melodi_sip_connection` podrá comprobar únicamente el registro del
perfil guardado, con destinos vacíos y sin invocar IA. Es una comprobación real
optativa, fuera de `tools.verify`; no se ha ejecutado todavía. El importe del
registro real se tratará como desconocido, no como cero.

Pasaron de nuevo las 9 pruebas SIP locales tras separar conexión y marcación.
[Informe](../tmp/verification/telephony-sip-20261108T014239-12716c4b.json).
La lectura de configuración encontró las claves de voz existentes en el
respaldo, sin extraerlas a archivos ni mostrarlas. El entorno actual y la copia
activa no tienen esa configuración cargada; la activación de voz sigue pendiente.

## Guardado autorizado y registro real del perfil

El usuario autorizó guardar la credencial SIP cifrada con Windows en Brivany.
El formulario local confirmó el guardado y no inició ninguna llamada. La carga
posterior mediante DPAPI recuperó el perfil correctamente, con un destino de
prueba permitido. No se publica el perfil ni la captura privada de preparación.

La comprobación explícita `tools.check_melodi_sip_connection` del perfil guardado
obtuvo SIP 200 y registro activo. La configuración de esa comprobación tenía
destinos vacíos y no envió ninguna orden de marcación. Se cerró el trabajador
nativo al terminar. Hubo una comprobación real del operador, cero llamadas
PSTN y cero solicitudes de IA; el importe facturado del registro se desconoce.
[Registro real saneado](../tmp/verification/melodi-sip-registration-20261108T014635-56a8194a.json).

Se reutilizaron del respaldo únicamente la clave Meta, su modelo y la clave
Cartesia, restaurando la configuración local que la aplicación ya admite y
manteniéndola fuera de Git. No se adjuntan archivos de configuración, valores
de claves o credenciales a esta bitácora. Esta restauración no solicitó
inferencia ni voz a los proveedores.

La comprobación local del `TelephoneBridge` real cargó el perfil y devolvió
conexión configurada, salida habilitada y entrantes en el móvil, sin buzón de
Melodi. El banco omitió únicamente la comprobación de origen de una ventana
nativa; no es una prueba física de esa ventana ni una conversación telefónica.
[Preparación local del puente](../tmp/verification/melodi-sip-readiness-20261108T014900-bd40e50b.json).

El guardado es de una vez; el registro SIP se hace automáticamente al confirmar
una llamada y termina con ella. La lista de destinos es un control local
persistente, no un código o trámite repetido por llamada. Siguen pendientes la
validación del identificador propio y la prueba PSTN autorizada. No se ha marcado
ningún teléfono en esta continuación ni se acredita latencia pública igual a Live.

## Destinos sin registro previo y primeros intentos reales

El usuario rechazó mantener una lista de destinos. Se eliminó ese requisito de
`SIPAccount`, del perfil guardado, del entorno SIP y del formulario de conexión.
Ahora puede revisar y confirmar un número nuevo directamente. El perfil anterior
se carga sin volver a pedir credenciales y se migró conservando la autorización
cifrada. No se debe modificar una lista de contactos para realizar otra llamada.

Cada trabajador nativo recibe únicamente el número de la llamada que acaba de
confirmarse; esta restricción es temporal y automática, sin registro manual.
La comprobación de registro sin llamada conserva su lista vacía. Se mantienen
normalización de teléfono, revisión de un uso, cancelación y recibos sin remarcado.

El usuario autorizó una prueba real con identificador oculto al móvil indicado.
El primer intento recibió 183 a 1,69 s y terminó con 603 a 6,73 s, sin confirmar
respuesta. El usuario informó que no sonó ni recibió la llamada. El banco
terminó a 10,89 s. No se logró una conversación.

En ese intento se abrió una sesión ASR, se enviaron 241.920 bytes de PCM
(5,04 s a 24 kHz), se intentó una respuesta Meta y una síntesis Cartesia de
63 caracteres. El audio previo a la respuesta había iniciado indebidamente
el flujo de conversación. Se conservó el fallo y se corrigió el arranque:
ahora espera llamada contestada y medios disponibles. El audio de progreso
se descarta en el flujo normal. Un estado 183 ya no se presenta como teléfono
sonando; únicamente 180 se traduce a ese estado.
[Primer intento real](../tmp/verification/melodi-netelip-live-call-20261108T015936-e5800b8d.json).

El segundo intento recibió 183 a 1,69 s y terminó con 603 a 6,50 s, también sin
respuesta confirmada. Esta vez no se inició respuesta Meta ni síntesis. Una
comprobación diagnóstica separada analizó 4,8 s de aviso previo en memoria,
con una sesión ASR y 0,8 s adicionales de silencio sintético. Solo se conservaron
códigos de clasificación; no audio ni texto. El reconocimiento señaló una
referencia a saldo y otro fragmento sin clasificar. Esto apoya revisar el saldo,
pero no demuestra que sea la única causa del 603. El banco duró 18,03 s.
Importes y tokens facturados de ambos intentos son desconocidos.
[Segundo intento y aviso](../tmp/verification/melodi-netelip-call-notice-20261108T020931-de9e92bd.json).

El historial privado de Netelip apareció vacío tras buscar las llamadas de
noviembre con todas las causas. El buscador de tarifas de la cuenta mostró
US$0,0959/min para el móvil autorizado, sin establecimiento, bloque inicial
cero e incremento de un segundo. La tarifa genérica de la zona es distinta y
no sustituye la móvil específica. El saldo mostrado sigue siendo US$0,02,
equivalente aritméticamente a unos 12,5 segundos a esa tarifa; el saldo visible
redondeado no demuestra un importe facturado nulo.

La recarga mínima ofrecida es de US$5, con IVA mostrado de 0 % y total US$5.
No se avanzó a confirmar pedido ni a pagar. Se pidió autorización para esa
recarga única, sin compra de número o suscripción. Permanece pendiente la
decisión del usuario y una conversación pública correcta; no se declara
resuelto el rechazo ni probada latencia igual a Live.
[Tarifa y saldo observados](../tmp/verification/netelip-private-tariff-20261108T021204-12429eba.json).

Pasaron 11 pruebas SIP locales, con nuevo destino sin registro, compatibilidad
del perfil anterior, espera de respuesta tras medios tempranos y dos recorridos
nativos de loopback con IA sustituida. Edge comprobó un número nuevo y el
formulario de tres campos sin destinos permitidos. Estos ensayos locales no
invocaron al operador ni a proveedores de IA.
[SIP posterior](../tmp/verification/telephony-sip-20261108T021119-f4786fba.json),
[Edge](../tmp/verification/telephony-ui-20261108T020143-4db6e71c.json).

## Recarga del usuario pendiente de revisión

El usuario indicó que había efectuado la recarga. El panel de transacciones,
comprobado de nuevo tras actualizarlo, mostró una recarga por PayPal pendiente
de revisión: US$5 de saldo y US$0,52 de gestión, total US$5,52, con IVA cero.
El saldo disponible seguía siendo US$0,02. No se conservaron identificadores
del pedido, datos de facturación ni documentos financieros originales.

La ayuda vigente de Netelip explica que PayPal requiere validación manual y
puede tardar hasta ocho horas en verse reflejado. Es un plazo publicado por
el proveedor, no una garantía de aprobación a una hora concreta.
[Ayuda de pagos](https://www.netelip.com/centro-de-ayuda/administradores/metodos-de-pago/preguntas-frecuentes/).

No se realizó otra recarga, nueva llamada ni solicitud a Muse, Meta o Cartesia.
La repetición de la prueba sigue pendiente de que Netelip apruebe el pago y
el saldo esté disponible. No se declara lograda una conversación pública.
[Estado saneado de la recarga](../tmp/verification/netelip-topup-pending-20261108T022027-403e3db9.json).
