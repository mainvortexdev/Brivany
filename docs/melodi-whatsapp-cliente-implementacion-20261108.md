# Canal de WhatsApp: implementación y pruebas simuladas

8 de noviembre de 2026. Implementado el canal del cliente de WhatsApp, su
pasarela, el adaptador experimental de Windows y el puente de audio virtual.
**Verificado en simulación. La cuenta y las llamadas reales siguen pendientes.**
El usuario reservó las llamadas públicas y la conexión real con Meta para después.

## Uso en esta entrega

En Herramientas → Llamadas, seleccionar **Vía: WhatsApp**. Aparecen la marca
**Simulación** y los botones **Revisar prueba** y **Probar ahora**.
También se reconoce «Melodi, llama por WhatsApp al +… para …»: rellena la
revisión y selecciona el canal sin iniciar una llamada por sí solo.

La prueba recorre dos turnos preparados de ASR, respuesta y voz sintéticos.
Sus paquetes de audio van a un sustituto en memoria; no salen por altavoces,
micrófonos, WhatsApp o Internet. El resultado indica que es una simulación.
No reproduce la voz real de Melodi ni acredita calidad semántica del modelo
o latencia de una conversación pública.

## Implementado

| Parte | Comportamiento |
| --- | --- |
| Canal independiente | WhatsApp conserva su recibo y no sustituye la vía SIP/Twilio existente. |
| Revisión | Número normalizado, encargo, modo, confirmación de un solo uso y revisión con caducidad. |
| Estado | Preparación, marcado, conexión, finalización, ocupado, cancelación, fallo y resultado incierto. |
| Persistencia | Canal, modo, calibración, dispositivos y últimos recibos por vía en JSON atómico. Recibos de WhatsApp en SQLite. |
| Evitar duplicados | El identificador queda ligado al hash de número, encargo y modo. Repetirlo consulta el recibo; cambiar sus datos se rechaza. Un resultado incierto impide nuevos intentos automáticos. |
| Voz | Reutiliza LivePhoneSession: PCM mono a 24 kHz, streaming, interrupciones, historial limitado a audio confirmado y cierre de recursos. |
| Límites | Colas acotadas, salida con presión y plazo, streams a demanda y cierre al terminar. Sesión de voz limitada a 150 segundos y ocho turnos, como la ruta telefónica actual. |
| Interfaz | Selector compacto, señal de simulación y restauración desde disco. Nuevas etiquetas en cuatro idiomas; los catálogos adicionales tienen 419 entradas cada uno. |

El acuse del formato `virtual_pcm_24000` se llama `virtual_audio_submitted`:
acredita entrega al adaptador de salida. No demuestra transmisión por WhatsApp,
reproducción en el móvil ni escucha por una persona.

## Adaptadores reales y límites

[OfficialWhatsAppClient](../services/telephony/whatsapp_client_ui.py) utiliza
UI Automation de Windows. Se adjunta al proceso WhatsApp, busca controles por
identificadores calibrados y rechaza coincidencias ambiguas o de otro proceso.
Abre el chat con el esquema local, lee el número desde un campo de solo lectura
y lo comprueba antes de invocar el botón. Comprueba que no haya una llamada
activa. No envía mensajes, escribe en conversaciones ni migra cuentas.

La calibración incluye destinatario, llamada, colgar y estado. Los controles
reales y su estabilidad en WhatsApp están por verificar. Una ausencia o cambio
detiene la operación. La navegación de WhatsApp se sustituyó en las pruebas.

[VirtualAudio](../services/telephony/whatsapp_client_audio.py) usa SoundCard,
NumPy y WASAPI ya presentes en el proyecto. Requiere dos endpoints virtuales
distintos y seleccionados: audio del interlocutor y salida de Melodi hacia el
micrófono de WhatsApp. Captura el loopback del endpoint elegido; no usa un
micrófono físico ni un dispositivo predeterminado como reserva. El aislamiento
real depende de asignar correctamente los canales y sigue pendiente.

Cada stream tiene su hilo COM. Al interrumpir, se descarta la salida pendiente
y se recrea el stream al comenzar la siguiente generación de voz. La cola
física que pudiera quedar en el controlador deberá medirse.

La [pasarela](../services/telephony/whatsapp_client.py) arranca en modo
`simulation`. El modo real exige habilitación explícita, calibración, canales
virtuales disponibles y voz configurada. `real_enabled: false` bloquea el
marcado real. Los [ajustes](../services/telephony/whatsapp_client_settings.py)
no almacenan secretos de cuenta, audio ni transcripciones; los recibos tampoco
guardan el encargo original. No se creó una configuración real en estos ensayos.

La integración no usa la API de WhatsApp para salientes ni altera sus requisitos.
La compatibilidad entre el número Cloud API y el cliente normal sigue pendiente.
Las llamadas entrantes mediante Meta son otra integración y no se presentan
como terminadas aquí. Se conserva Muse, Meta y Cartesia como ruta de voz para
la fase real, sin descargar modelos locales.

## Pruebas

| Suite | Resultado | Evidencia |
| --- | --- | --- |
| Cliente WhatsApp | 26 pruebas pasaron | [Informe](../tmp/verification/whatsapp-client-20261108T061433-9c314f18.json) |
| Panel → puente Python → pasarela → voz sintética | Pasó | [Informe](../tmp/verification/whatsapp-client-ui-20261108T061145-6a6fc54f.json), [vista a 340 px](../tmp/whatsapp-client-ui/review-340.png) |
| UI Automation en ventana WPF propia | Pasó | [Informe](../tmp/verification/whatsapp-client-native-20261108T061231-f6e7cc6a.json) |
| Regresión de telefonía | 17 pruebas pasaron | [Informe](../tmp/verification/telephony-20261108T061231-17e0c9b3.json) |
| Regresión de voz telefónica | 6 pruebas pasaron | [Informe](../tmp/verification/telephony-realtime-20261108T060047-4ead8d5b.json) |
| Regresión SIP y RTP nativo local | 11 pruebas pasaron | [Informe](../tmp/verification/telephony-sip-20261108T061231-7848f7c1.json) |
| Regresión del panel telefónico | Pasó | [Informe](../tmp/verification/telephony-ui-20261108T061231-2544b222.json) |

Total: **60 pruebas unitarias pasaron**, además de los recorridos de interfaz.
La suite nueva cubre conversación bidireccional, interrupción, cancelación,
audio desconectado antes y después de marcar, destinatario cambiado, llamada
ya activa, recibos, cambio de modo tras revisar, reintentos, incertidumbre al
colgar, separación de canales y colas acotadas.

Edge usa el panel real y el puente Python de una instancia temporal. Completa
dos turnos, borra el almacenamiento del navegador y recupera selección y recibo
desde disco sin repetir la llamada. Cancela una segunda sesión y comprueba
las etiquetas en inglés, francés y portugués de Brasil.

La prueba nativa invoca controles de una ventana WPF propia fuera del área
visible. Son reales UI Automation, lectura e invocación; son sintéticos la
ventana, el número y los estados. No valida selectores del cliente WhatsApp.
Se verificó el cierre del banco y la ausencia de sus ventanas al finalizar.

Se conservan dos fallos iniciales: carga de ensamblados WPF por nombre y
comprobación del PID del lanzador del entorno virtual. Se corrigió la carga
desde el runtime local y se verificó la ventana por token, handle y PID real.
Los ensayos posteriores pasaron sin instalar ni descargar componentes.

No hubo llamadas públicas, cuentas WhatsApp ni solicitudes a APIs de IA o voz.
No se grabó audio personal. No se midió latencia pública o consumo del cliente
real; la GPU de las ventanas de prueba queda sin medir.

## Próxima fase

Comprobar una cuenta compatible, calibrar controles y asignar canales virtuales
sin alterar el número Cloud API. Validar el audio y su aislamiento con una
fuente propia. Después, cuando el usuario indique la llamada concreta, comprobar
timbrado, conversación, interrupción, cierre y consumo. La conexión real de Meta
se probará en la fase que indique el usuario.

Un resultado incierto requiere revisar el cliente antes de continuar; no se
vuelve a marcar para corregirlo. La agenda telefónica conserva su
[pendiente de integración](melodi-agenda-whatsapp-auditoria-20261108.md).
