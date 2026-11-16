# Melodi: conversación telefónica y requisito Live

Continuación del 7 de noviembre, con comprobaciones del 8 de noviembre UTC.
El criterio del usuario es mantener una conversación con respuesta tan rápida
como Live. **Todavía no está validado en una llamada telefónica real.**

## Resultado real de la cuenta limitada

El navegador integrado volvió a estar disponible. La credencial existente se
guardó con DPAPI desde un formulario de loopback. Se corrigió su política de
referencia a `same-origin`; Edge comprobó el POST nativo con datos ficticios.
La validación de origen sigue rechazando `null` y orígenes ajenos.

Se iniciaron cuatro llamadas desde la consola: 5, 5, 24 y 40 segundos. El
contador bajó de 74 a 70 minutos gratuitos. Una solicitud REST adicional fue
rechazada con HTTP 400. El estado `Completed` verifica conexión y cierre;
no demuestra una conversación satisfactoria. El usuario solo oyó el saludo
en la prueba de 24 segundos y una respuesta sin continuidad en la de 40.
La última prueba generó dos respuestas pero no se observó la descarga del
audio final. Se conserva como fallo de la experiencia requerida.

El interceptor de consola envió POST sin `X-Twilio-Signature`. El modo
explícito `--console-proxy` exige la capacidad aleatoria de esa sesión y
comprueba por REST autenticada que cuenta, llamada, emisor, destino y estado
activo coincidan antes de aceptar el primer evento. Reutiliza esa validación
solo para la misma sesión, limita los intentos a tres y rechaza firmas
presentes pero inválidas. El servidor normal sigue exigiendo la firma.

El modo por archivos añadió esperas: en la última llamada, Meta tardó 3,625
y 2,453 s; Cartesia completó las respuestas en 1,484 y 2,110 s, antes de los
saltos adicionales del interceptor. Ese modo no cumple el criterio Live.

## Puente continuo implementado, sin activar en la cuenta

`services/telephony/realtime.py` adapta Media Streams a los proveedores ya
usados por Brivany: Muse para ASR, Meta para conversación y Cartesia para la
voz española de Melodi. No descarga modelos. La conversación recibe frases
progresivas, y el PCM sale antes de terminar la síntesis. No espera JSON ni
un WAV completo. Conserva el encargo autorizado y no dispone de herramientas
de ordenador, compras, pagos o cambios de cuenta.

La conexión WSS valida la firma sobre el origen público configurado y enlaza
una sola sesión a la llamada ya autorizada. Audio de entrada G.711 μ-law a
8 kHz se convierte a PCM de 24 kHz para Muse; la salida realiza la conversión
inversa. El codec usa `audioop` del Python 3.12 actual. Python 3.13 necesita
un adaptador de codec adicional antes de habilitar este modo.

La cola remota está acotada a un segundo. Los acuses de reproducción separan
audio escuchado y audio retirado. Voz sostenida durante 240 ms interrumpe la
respuesta, cancela Meta/Cartesia y limpia el búfer remoto. El historial solo
conserva frases con acuse de reproducción y vive en memoria. Hay una sesión,
ocho respuestas como máximo y un límite local de 150 s. Cero permite colgar.
No se crea un proceso ni una conexión de proveedor al iniciar Desktop.

Arranque del host, cuando la cuenta admita el servicio:

```powershell
python -m services.telephony.server --port 8787 --realtime --media-port 8790
```

El proxy HTTPS público debe enviar `/twilio/media/` al WebSocket de loopback
en 8790 y las rutas HTTP de telefonía al 8787, conservando ruta y cabeceras.
Si usa otro origen, configurar `--media-origin https://host.example`.
La configuración de cuenta, número RD, destinos y credenciales sigue siendo
la del [módulo de telefonía](melodi-telefonia-20261107.md). El modo está
deshabilitado por defecto y no se publica una pasarela al crear el archivo.

## Validación y consumo

Pasaron 17 pruebas de telefonía y seis del puente continuo. Este último usa
WebSockets reales en loopback, proveedores sustituidos y señal sintética.
Comprueba acceso antes de proveedores, una sola sesión, entrega de audio
antes del fin del modelo, interrupción durante TTS, marcas retiradas que no
se añaden al historial, codec, límites de cola y cierre por teclado. No mide
la red telefónica, escucha humana ni consumo de producción.

Dos muestras sintéticas adicionales usaron APIs reales, sin teléfono: el
nuevo flujo entregó el primer PCM en 4,329 s; el flujo Live actual en 3,078 s.
Cada muestra hizo una petición Meta y una Cartesia; se enviaron 74 y 104
caracteres de voz. Se cancelaron después del primer bloque. El coste y los
tokens finales son desconocidos. Son muestras individuales secuenciales,
sin ASR ni reproducción física: no demuestran igualdad de latencia.

Las cuatro llamadas y la preparación REST consumieron tres respuestas Meta
y ocho síntesis Cartesia: 894 caracteres conocidos más una respuesta cuyo
tamaño no se registró. Las dos muestras posteriores añaden dos peticiones
de cada proveedor y 178 caracteres de voz. Las lecturas rutinarias de consola
no se contabilizaron globalmente. No hubo compras ni modelos locales.

## Límite de la prueba gratuita y siguiente comprobación

Twilio bloquea `<Stream>` y `<ConversationRelay>` en esta prueba limitada.
El mecanismo de audio bidireccional necesita una cuenta que lo admita y un
número emisor propio. No se intenta eludir esa restricción ni se activa pago.
Las unidades promocionales tras una ampliación dependen de la elegibilidad.
La tabla pública actual incluye 75 minutos de llamadas y 30 unidades de Media
Streams tras ampliar; el primer mes gratuito de número corresponde a números
US locales o gratuitos de US/Canadá, no a un número dominicano.
[Restricciones oficiales](https://www.twilio.com/docs/usage/trials/try-out-voice),
[Media Streams](https://www.twilio.com/docs/voice/media-streams),
[promociones](https://www.twilio.com/docs/usage/trials).

La tarifa pública de referencia para móviles RD es US$0,1925/min y Media
Streams añade US$0,0044/min: aproximadamente US$0,197/min antes de número,
impuestos y proveedores Meta/Cartesia, cuando no apliquen unidades gratis.
El precio y disponibilidad de un número dominicano y el importe de ampliación
de la cuenta deben confirmarse antes de cualquier compra.
[Tarifas oficiales](https://www.twilio.com/en-us/voice/pricing/do).

Pendientes: habilitación del transporte, llamada real con interrupción y cierre
audibles, medición desde el final de la intervención hasta el primer sonido
recibido y comparación con Live bajo las mismas condiciones.

Comprobación posterior en el navegador integrado: la página de ampliación de
esta cuenta exige añadir fondos para acceder a la plataforma completa. Se dejó
sin pulsar el botón que continúa la ampliación. No se proporcionaron datos de
facturación ni se inició un pago; el importe exacto sigue sin cotizar.
