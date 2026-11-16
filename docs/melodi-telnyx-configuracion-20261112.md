# Telnyx preparado para la primera llamada de Melodi

12 de noviembre de 2026. Se configuró la conexión desde el repositorio de
Brivany en Windows, usando la clave que ya existía en `.env`. Telnyx la aceptó;
no se imprimió ni modificó esa clave. La cuenta aparecía verificada en el portal
y tenía un único número emisor verificado terminado en **9873**.

## Configuración aplicada y leída de nuevo por API

| Campo | Valor comprobado |
| --- | --- |
| Perfil de salida y conexión | `Brivany Melodi` |
| Tipo de conexión | SIP con credenciales |
| Servidor / transporte | `sip.telnyx.com`, UDP 5060 |
| Número emisor | Verificado, terminado en 9873; `ani_override_type=always` |
| Destinos permitidos | República Dominicana (`DO`) y Estados Unidos (`US`) |
| Llamadas simultáneas | Una en el perfil y una en la conexión |
| Límite diario | US$5, con aplicación del límite habilitada |
| Tarifa máxima de destino | US$0,30 por minuto |
| Estado | Perfil habilitado y conexión activa, asociados entre sí |
| Guardado local | Perfil cifrado con Windows DPAPI y recuperación comprobada |

El formulario de las capturas es de **Voice API / Call Control**, que exige un
webhook. Melodi utiliza la conexión SIP ya implementada; ese formulario y sus
opciones de timeout, webhook API v2 y failover no forman parte de este recorrido.
No se creó una aplicación Call Control ni se publicó un receptor HTTP.

Referencias oficiales consultadas:

- [Tipos de conexión SIP](https://support.telnyx.com/en/articles/4245868-sip-connection-types).
- [Configuración del trunk SIP y perfil de salida](https://support.telnyx.com/en/articles/8096455-how-to-configure-a-sip-trunk).
- [Formulario Call Control y TeXML](https://support.telnyx.com/en/articles/4374050-configuring-call-control-texml-applications-voice-api).
- [Crear un perfil de salida por API](https://developers.telnyx.com/api-reference/outbound-voice-profiles/create-an-outbound-voice-profile).
- [Crear una conexión con credenciales por API](https://developers.telnyx.com/api-reference/credential-connections/create-a-credential-connection).

## Primer registro fallido y corrección

La creación y las diez comprobaciones de configuración remota pasaron. Sin
embargo, el primer registro SIP terminó con estado local 0 antes de contactar
con el operador. La variable `target` del comando de prueba `local_dial`
ocultaba en toda la función `main` el constructor de URI del mismo nombre.
Los ensayos de audio entre pares locales no entraban en la rama de registro y
no detectaban el fallo.

Se renombró esa variable a `peer_port`. Una nueva prueba inicia el trabajador
nativo con `register=True` y un registrador UDP de loopback, comprueba SIP 200
y verifica que no se envía INVITE. Ese registrador acepta REGISTER sin desafío
digest: acredita arranque y eventos de registro, no autenticación de operador.
Además, `tools.setup_telnyx check-sip` ahora informa `ok=false` y sale con código
1 cuando el registro falla; antes podía devolver éxito junto a «fallida».

El informe inicial se conserva sin reescribir:
[aprovisionamiento y primer registro](../tmp/verification/telnyx-setup-20261112T161431-b8757792.json).

## Resultado posterior y pruebas

El segundo intento usó el perfil cifrado existente, sin volver a aprovisionar
ni cambiar la contraseña SIP. Telnyx respondió **SIP 200** y el comando terminó
con código 0. Solo se registró la conexión; no se marcó ningún número ni se
usaron proveedores de IA, micrófono o altavoz.

- [Registro real posterior a la corrección](../tmp/verification/telnyx-registration-20261112T161722-9ef8693b.json).
- [Telefonía: 14 pruebas locales](../tmp/verification/telephony-20261112T161649-b2a1d83a.json).
- [SIP: 7 pruebas locales, incluidos registro y audio en loopback](../tmp/verification/telephony-sip-20261112T161626-684ec36a.json).
- [Conversación Live: 7 pruebas con proveedores sustituidos](../tmp/verification/telephony-realtime-20261112T161115-687e59f9.json).

También se conservan las suites previas de 13 pruebas de telefonía y 6 de SIP;
sus resultados no acreditaban el camino de registro incorporado después.
El primer intento de ejecutar las herramientas con el Python global no arrancó
por falta de `pydantic`; se usó el entorno `.venv` existente, sin instalar paquetes.

## Consumo, navegación y límites

Se conocen 16 solicitudes REST a Telnyx: cinco de la consulta inicial y once
del aprovisionamiento, lectura de comprobación y saldo. Hubo dos intentos de
arrancar el registro SIP; solo el segundo alcanzó un registro confirmado. El
número de paquetes SIP y el tráfico de documentación/navegador no se midieron.
El saldo observado antes y después del aprovisionamiento fue US$14,79, con
diferencia visible US$0,00. No se consultó facturación: el importe atribuible
al registro y posibles cargos diferidos es desconocido. No hubo llamadas PSTN
ni solicitudes a proveedores de IA en estas comprobaciones. GPU sin medir.

El control del navegador se detuvo porque no pudo verificar la URL actual con
suficiente confianza. Antes se había preparado un borrador SIP en una pestaña
nueva; la configuración definitiva se creó y comprobó mediante API. No se
certifica la pantalla final del portal ni se adjuntan capturas con credenciales.

Quedan pendientes el número receptor de la prueba, la primera llamada PSTN,
la presentación del emisor en el teléfono, la conversación real y su latencia.
DO está permitido en el perfil, pero eso no acredita que una llamada a ese país
se complete. La configuración local se guardó en los datos del repositorio;
no se transfirió a la instalación de escritorio ni se reinició esa aplicación.
Las llamadas entrantes continúan fuera de esta prueba.

## Primer intento posterior

El usuario autorizó una llamada a su línea personal. El registro SIP volvió a
ser aceptado, pero Telnyx rechazó el destino con 404 / Q.850 1; no hubo respuesta
ni conversación. El CDR posterior coincide con el número solicitado y declara
`UNALLOCATED_NUMBER`, ruta `Intra` y US$0 de coste. El usuario confirmó que esa
línea recibe llamadas normales. No se hizo un segundo marcado.
[Intento, diagnóstico real y límites](melodi-telnyx-primera-prueba-20261112.md).
