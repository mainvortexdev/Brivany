# Melodi en reuniones por enlace

Investigación del 16 de noviembre de 2026. Estado: propuesta para un prototipo,
sin conector implementado o desplegado y sin pruebas en reuniones reales.

## Conclusión

La primera vía recomendada es mantener en Cloudflare la coordinación de Brivany
y usar una API de participantes de reuniones para el acceso y transporte de
audio. Recall.ai es un candidato documentado para Zoom y Google Meet, con
entrada por URL, audio en vivo y salida de voz mediante Output Media. Melodi
seguiría usando sus modelos y el perfil de voz exacto de Cartesia que Brivany
ya tiene; el proveedor de reuniones no decidiría su identidad ni su voz.

Es una conclusión de arquitectura basada en documentación, no una certificación
de compatibilidad, latencia o calidad de audio en una cuenta concreta.
[Participante y plataformas](https://docs.recall.ai/docs/bot-overview),
[interacción con audio](https://docs.recall.ai/docs/stream-media).

## Qué ofrece Cloudflare

Browser Run, antes Browser Rendering, permite automatizar navegadores remotos
con Puppeteer, Playwright o CDP. Las sesiones activas no tienen un límite fijo
de vida; la inactividad y los despliegues del servicio pueden cerrarlas. El plan
gratuito tiene diez minutos diarios. La documentación de límites no acredita
que el micrófono virtual y el audio WebRTC de Zoom/Meet funcionen para este caso:
eso necesita un ensayo específico, separado de abrir correctamente una web.
[Producto](https://developers.cloudflare.com/browser-run/),
[límites](https://developers.cloudflare.com/browser-run/limits/).

Cloudflare Remote Browser Isolation es otro producto: declara que no admite
micrófono ni webcam. Esa limitación no se debe atribuir automáticamente a
Browser Run. Tampoco el grabador de sesiones de Browser Run demuestra captura
de audio: guarda el DOM de los elementos multimedia, no su contenido reproducido.
[Limitaciones de Browser Isolation](https://developers.cloudflare.com/cloudflare-one/remote-browser-isolation/known-limitations/),
[grabación de Browser Run](https://developers.cloudflare.com/browser-run/features/session-recording/).

Por tanto, Browser Run sigue siendo una opción experimental para probar el
ingreso, los permisos de medios, la negociación WebRTC y la ruta completa de
audio. No se ha descartado como técnicamente imposible. Para una primera versión
multiplataforma, la API de reuniones reduce el trabajo de mantener cada cliente.

Una implementación propia en Linux/Chromium con audio virtual da más control,
pero exige mantener los ingresos, sesiones y cambios de interfaz. Cloudflare
Containers es un candidato de infraestructura, no una compatibilidad garantizada
para conferencias: habría que comprobar conectividad de medios y ciclo de vida.
La restricción de entrada HTTP a Containers no demuestra, por sí sola, que las
conexiones salientes WebRTC sean imposibles.
[Ciclo de vida de Containers](https://developers.cloudflare.com/containers/concepts/architecture/).

## Ruta recomendada para Brivany

1. El titular envía un enlace por el chat o el WhatsApp ya vinculado, con el
   propósito de la reunión y si quiere notas o participación por voz.
2. Un servicio de reuniones de Brivany en Cloudflare valida el enlace y crea
   una sesión por usuario, asistente y reunión. Guarda la asociación con el bot
   y evita duplicarlo ante un reintento del pedido. Un enlace recurrente se
   distingue por su instancia/horario, no solamente por la URL.
3. El participante aparece con el nombre «Melodi · Asistente de Daniel Luna».
   La entrada queda sujeta a la admisión, contraseña o autenticación que exija
   la reunión. Otros usuarios conservarían su propio nombre de asistente.
4. Para notas, se envía el audio remoto al reconocimiento existente y se generan
   acuerdos, pendientes y resumen. Para conversar, Output Media ejecuta una
   página de audio de Brivany conectada a la sesión de voz. Las respuestas se
   sintetizan siempre con Cartesia y el perfil seleccionado de Melodi.
5. Se controla la alternancia de turnos, se cancela la voz al interrumpirla y
   se evita que la propia salida se interprete como otra persona. El estado
   llega a Brivany/WhatsApp: esperando admisión, dentro, escuchando, hablando,
   terminada o fallo concreto.
6. Al salir se cierra el transporte y se entrega el resumen al titular. El
   servicio remoto estaría diseñado para operar con el PC apagado. Las acciones
   en ese ordenador seguirían necesitando el agente de escritorio conectado.

Este flujo es una propuesta. Las intervenciones de otros participantes son
contenido de la reunión; no amplían el encargo del titular ni autorizan acciones
en su ordenador, cuentas o servicios. Conservar audio o video completo requiere
un modo explícito y una política de retención; el prototipo debe verificar la
configuración real del proveedor, sin asumir que procesar en vivo implica que
no se almacenen grabaciones.

Recall documenta audio remoto PCM16 mono de 16 kHz y Output Media para respuestas
interactivas en Zoom y Meet. Recomienda Output Media para conversaciones; el
endpoint Output Audio se orienta a clips breves. Las sesiones inmediatas tienen
dependencia de la disponibilidad de bots; el ingreso programado debe reservarse
con antelación. El alta directa por Create Bot requiere deduplicación de Brivany.
[Audio remoto](https://docs.recall.ai/docs/how-to-get-mixed-audio-real-time),
[salida de voz](https://docs.recall.ai/docs/output-audio-in-meetings),
[programación y duplicados](https://docs.recall.ai/docs/creating-and-scheduling-bots).

## Zoom y Meet: restricciones que cambian la elección

Recall documenta ingreso a Zoom estándar por URL. Si hay sala de espera se
necesita admisión; los casos que exigen iniciar sesión llevan configuración
adicional. Para Meet, el ingreso anónimo suele necesitar admisión; autenticar
el bot tampoco elimina las políticas de la sala.
[Zoom](https://docs.recall.ai/docs/zoom-overview),
[Google Meet](https://docs.recall.ai/docs/google-meet).

Si se construye el conector propio de Zoom con Meeting SDK, las reuniones fuera
de la cuenta desarrolladora requieren revisión de la app y autorización. El
modo OBF vincula el bot a un usuario presente y obliga a salir cuando ese usuario
abandona; no sirve para prometer asistencia autónoma en ausencia del titular.
Hay que elegir el mecanismo de ingreso adecuado, no tratar todos los tokens
como equivalentes.
[Zoom OBF y revisión](https://developers.zoom.us/docs/meeting-sdk/auth/obf/).

Google anunció el 28 de octubre de 2026 que Meet Media API no llegará a
disponibilidad general y cerrará sus endpoints el 15 de enero de 2027. No es una
base adecuada para una integración nueva. Meet REST API continúa soportada para
gestión y artefactos; eso no la convierte en un participante de voz en directo.
[Anuncio oficial](https://developers.google.com/workspace/meet/release-notes).

## Reutilización comprobada en el repositorio

- `workers/calls/voice.js` y `workers/calls/protocol.js`: sesión de voz remota,
  proveedores existentes y perfil explícito de Cartesia. El transporte actual
  está acoplado a Telnyx, PCMU de 8 kHz y confirmaciones telefónicas; no se debe
  conectar el audio de reuniones a esa entrada sin un adaptador específico.
- `packages/providers/cartesia_melodi.py`: salida PCM con la identidad de Melodi.
  El formato de audio se adapta al transporte conservando voz y ritmo.
- `workers/whatsapp`: recepción de pedidos y vinculación existente. Sus módulos
  de Calendar podrían aportar horarios, sin depender de un nuevo OAuth de
  calendarios del proveedor de bots para la primera entrada por enlace.

No se encontró en las fuentes revisadas un conector de entrada a Zoom/Meet ya
implementado. Los modos de escucha de reuniones existentes no prueban que
Melodi pueda ingresar como participante desde un enlace.

## Coste publicado y aceptación del prototipo

Recall publica una tarifa base de 0,50 USD por hora de grabación. No equivale al
coste total: se suman reconocimiento, modelo, Cartesia, Cloudflare y cualquier
variante o retención adicional. Browser Run publica diez horas mensuales
incluidas en Workers Paid y 0,09 USD por hora adicional, más los conceptos de
concurrencia y plan; es coste de navegador, no de una integración completa de
reuniones. Tarifas consultadas el 16 de noviembre de 2026.
[Recall](https://www.recall.ai/pricing),
[conceptos de uso](https://docs.recall.ai/docs/calculating-usage),
[Browser Run](https://developers.cloudflare.com/browser-run/pricing/).

Antes de elegir definitivamente el transporte: ensayo controlado en Meet y otro
en Zoom, nombre visible, admisión, audio entrante identificado, voz exacta de
Cartesia, interrupción sin eco, salida/cancelación y resumen correcto. También
verificar continuidad remota al cerrar el escritorio y que repetir un pedido no
cree dos participantes. Medir latencia, consumo y almacenamiento reales, sin
confundir una conexión WebSocket o un estado «dentro» con audio comprensible.

Esta investigación solo leyó código y documentación pública. No se crearon
cuentas, bots, reuniones, grabaciones ni recursos Cloudflare, ni se invocaron
API de voz, transcripción o reuniones. No se hicieron pruebas de compatibilidad
real. El consumo de las herramientas de consulta y la GPU no se midieron.
