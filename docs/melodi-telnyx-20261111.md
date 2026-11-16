# Llamadas de Melodi con Telnyx

11 de noviembre de 2026. El usuario pidió retirar la implementación anterior de
llamadas y usar Telnyx, donde ya recargó créditos. Este documento sustituye como
dirección vigente a [Twilio](melodi-telefonia-20261107.md) y
[Netelip](melodi-sip-netelip-20261107.md), que se conservan como histórico.

## Arquitectura

Telnyx ofrece dos caminos: Call Control (webhooks y media por WebSocket hacia un
servidor público) y conexiones SIP con credenciales. Se eligió **SIP con
credenciales**: Brivany se registra en `sip.telnyx.com` desde el propio equipo y
el audio viaja por RTP. No hace falta túnel, dominio público ni puerto abierto.
El trabajador PJSUA2 aislado (`services/telephony/sip_engine.py`) ya había
completado llamadas SIP/RTP en loopback y un registro real con otro operador.

La API de Telnyx se usa solo en la configuración explícita:

- Perfil de salida «Brivany Melodi»: países permitidos (por defecto DO y US),
  límite de gasto diario (5 USD), tarifa máxima (0,30 USD/min) y una llamada
  simultánea.
- Conexión con credenciales «Brivany Melodi»: usuario y contraseña generados
  por Brivany, asociada al perfil de salida y con el número emisor fijado en
  Telnyx (`ani_override`, siempre).

La conversación usa el flujo Live existente: Muse para reconocer, Meta para
responder y Cartesia con la voz de Melodi. El audio sale antes de terminar la
respuesta, la voz de la otra persona interrumpe a Melodi y «adiós» o la tecla 0
cuelgan. No se graban audio ni transcripciones.

## Retirado

Se eliminaron del código activo la pasarela de Twilio (webhooks, TwiML, Media
Streams, prueba de consola, buzón por grabación), el perfil y los formularios de
Netelip y el códec μ-law. La pasarela remota `BRIVANY_CALL_GATEWAY_*` ya no se
carga. El canal del cliente oficial de WhatsApp se conserva: no depende de un
operador telefónico.

## Archivos

| Archivo | Función |
| --- | --- |
| `services/telephony/telnyx.py` | Cliente REST, aprovisionamiento, perfil cifrado y pasarela del panel |
| `services/telephony/sip.py`, `sip_engine.py` | Trabajador SIP nativo; marca `sip:+E164@sip.telnyx.com` |
| `services/telephony/common.py` | Errores, normalización E.164 y texto del encargo |
| `services/telephony/realtime.py` | Sesión Live sobre PCM 24 kHz |
| `tools/setup_telnyx.py` | Estado, números, verificación, compra y aprovisionamiento |
| `tools/run_telnyx_call.py` | Una llamada real autorizada con informe operativo |
| `tests/test_telephony_telnyx.py` | API y SIP sustituidos |

## Puesta en marcha

1. En el portal de Telnyx, **API Keys → Create API Key**. Copiar la clave a
   `.env` como `BRIVANY_TELNYX_API_KEY=…`. No compartirla en el chat.
2. `python -m tools.setup_telnyx status`. Solo lectura: saldo, números y estado.
3. Número emisor. Telnyx rechaza con 403 (D35) un emisor que no sea de la
   cuenta o verificado. Dos opciones:
   - Comprar uno: `numbers --country US` y `buy --number +1… --confirm-purchase`.
   - Verificar uno propio: `verify-caller --number +1809… --method sms` y
     `verify-code --number +1809… --code 123456`. Mostrará ese número a quien
     reciba la llamada.
4. `python -m tools.setup_telnyx provision --caller +1…`. Crea o actualiza la
   conexión y la guarda cifrada con Windows en `.local/telephony/telnyx.dpapi`.
5. `python -m tools.setup_telnyx check-sip`. Registro SIP sin llamar.
6. Primera llamada: `python -m tools.run_telnyx_call --destination +1809… --confirm-call`.
   El informe queda en `.local/telephony/live-call-status.json`, con estados,
   códigos SIP, tiempos de respuesta y la diferencia de saldo.

Después, WorkSpace → Herramientas → Llamadas usa la misma conexión.

## Pruebas

En un contenedor Linux con Python 3.12, con Telnyx, el trabajador SIP y los
proveedores de IA sustituidos: 13 casos de Telnyx (uno, el cifrado DPAPI, se
omite fuera de Windows), 7 de la sesión Live y 4 del trabajador SIP. Los dos recorridos SIP/RTP
de loopback necesitan PJSUA2 y se omitieron allí. No hubo peticiones a Telnyx,
llamadas ni inferencia. Falta ejecutar las suites en Windows (`tools.verify
telephony`, `telephony-sip`, `telephony-realtime`, `telephony-ui`).

## Pendiente

- Clave API, número emisor y aprovisionamiento en el equipo del usuario.
- Comprobar si la cuenta (nivel «Paid» en el portal) permite República
  Dominicana; Telnyx exige verificación adicional para algunos destinos.
- Primera llamada real y medición del primer sonido tras cada intervención.
- Llamadas entrantes y buzón: siguen en el móvil del usuario.

## Continuación del 12 de noviembre

La clave existente fue aceptada y se crearon el perfil de salida y la conexión
SIP con el único emisor verificado de la cuenta. Se corrigió el arranque de
registro del trabajador nativo y Telnyx confirmó SIP 200. Pasaron 28 pruebas
locales en Windows; no se realizó ninguna llamada PSTN. El apartado «Pendiente»
anterior describe el estado del día 11, no el estado posterior a esta configuración.
[Valores guardados, corrección, consumo y evidencias](melodi-telnyx-configuracion-20261112.md).
