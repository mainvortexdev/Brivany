# Reuniones de Melodi con Recall

Implementación iniciada el 16 de noviembre de 2026 siguiendo
`recall://guides/onboarding`, leído antes de modificar código o crear recursos.
La guía de integración y la referencia canónica v1.11 se consultaron por MCP.
Este documento distingue las comprobaciones locales, las reales y lo pendiente.

## Workspace y autorización

- Workspace confirmado por MCP: **Vetsa AI**,
  `1501389b-6c5d-4194-bbf8-90b2abd6a895`, región **eu-central-1 / Frankfurt**.
- El usuario eligió enviar bots **solo a eventos marcados expresamente** en
  Brivany. Sincronizar Calendar no es consentimiento de grabación.
- El usuario autorizó crear la clave REST, desplegar, instalar secretos,
  configurar/probar el webhook y entrar/grabar una reunión de Zoom concreta.
- Posteriormente pidió entrada silenciosa, responder al llamarla, su imagen
  exacta, resúmenes, solicitud de palabra y pizarra. Solicitó pruebas cortas y
  retirar el bot entre pruebas. No se habilitan llamadas de WhatsApp.

## Flujo implementado

La vista **Reuniones** usa Brivany Editorial y la Cuenta Vetsa existente. El
cliente nativo conserva el token y reenvía únicamente operaciones tipadas al
backend; ninguna clave de Recall llega al renderer. Cada usuario necesita su
propia cuenta y vinculación de WhatsApp. Los resultados se aíslan por usuario.

El backend de `workers/whatsapp/meetings` reutiliza D1, la cola, el cron, el
cifrado y Google OAuth de Brivany. Persiste la intención antes de crear el bot,
deduplica solicitudes y reconcilia una respuesta de creación ambigua por metadata
sin repetir ciegamente una operación de pago. Respeta Retry-After y conserva los
fallos. El calendario existente es **Vetsa · Equipo** (`calendar.app.created`),
no todos los calendarios personales. No fue necesario crear Calendar V2 ni
solicitar otro acceso Google. Cambios y cancelaciones de eventos seleccionados
actualizan o retiran el bot; eventos pasados, sin enlace o no seleccionados no
lo crean.

`https://ia.vetsa.es/webhooks/recall` verifica la firma del cuerpo original antes
de almacenar o encolar. La bandeja persistente y las claves de entrega permiten
procesar duplicados, reordenamientos y recuperaciones de la cola. El flujo
`recording.done → Recall async → transcript.done` guarda páginas de transcripción
cifradas y genera un resumen separado con acuerdos, acciones y preguntas. No
sondea el avance de la transcripción en Recall.

La voz opcional usa Output Media, un token temporal limitado a la reunión,
AudioWorklet PCM de 24 kHz, Muse/Meta existentes y exclusivamente la voz
seleccionada de Cartesia: `3597a26f-80ef-4bd5-8101-9699bc764917`, modelo
`sonic-3.6-2026-08-27`, velocidad 1. No hay saludo automático: responde solo a una
solicitud dirigida a «Melodi». El avatar es la imagen entregada por el usuario,
copiada sin modificar. La pizarra es una superficie de Brivany compartida por
Output Media; no se afirma controlar la pizarra nativa de Zoom. La mano es una
señal visual de solicitud de palabra; no se afirma una reacción nativa de Zoom.
Recall documenta que Meet no permite levantar la mano mediante su bot.

## Despliegue y secretos

La clave se creó con el nombre **Brivany Meetings · EU backend**. Clave y secreto
de firma se descargaron en el proceso de preparación y se protegieron con DPAPI,
sin imprimir valores. La configuración de voz reutiliza las credenciales
existentes. El backend recibe `RECALL_REGION`, `RECALL_WORKSPACE_ID`,
`RECALL_API_KEY`, `RECALL_WEBHOOK_VERIFICATION_SECRET` y `PUBLIC_API_BASE_URL`.

`tools/release_recall.mjs` prepara una ampliación del bundle publicado y conserva
el código previo de WhatsApp, módulos y bindings. Exige verificaciones del
artefacto exacto y aborta si producción cambió de forma ajena. La lectura binaria
conserva el Wasm de audio: el parser FormData de una descarga sin filename lo
convertía en texto y lo dañaba; se corrigió antes de publicar ese paquete.

Webhook creado: `ep_3MC5bsCf9ns83YHWgjJFYazqdc0`, con suscripciones mínimas a
ciclo del bot, grabación y transcripción. El evento real de prueba de Recall
quedó verificado y procesado como recurso desconocido, sin efectos sobre bots.

## Evidencia y límites al primer checkpoint

Pasan 13 pruebas de reuniones, 7 de voz/resumen/pizarra/límites, 28 del cliente
nativo, interfaz sobre HTTP real, workerd con D1/Queues, WebSockets reales y
navegador con micrófono simulado. Pasan 478 regresiones de WhatsApp y el dry run
de Wrangler 4.151.1. Las simulaciones no contactaron proveedores reales ni
entraron a reuniones. Los fallos intermedios de los bancos permanecen en los
informes de verificación; no se sustituyen por éxitos retrospectivos.

Prueba real inicial: un bot entró y grabó en el Zoom autorizado. Se retiró por
petición del usuario, con respuesta HTTP 200 y confirmación `call_ended`;
grabación y transcripción terminaron y el resumen quedó disponible. Los datos,
enlace, audio y texto de la reunión no se adjuntan a esta bitácora.

Calendar real confirmó conexión y lectura de 94 eventos, ninguno elegible en
ese rango para enviar un bot. No se modificaron eventos. La primera comprobación
sintética de proveedores de voz conectó Muse y sintetizó la entrada con
Cartesia, pero no consiguió completar reconocimiento/respuesta: **no demuestra
conversación real en Zoom**. Se amplió el diagnóstico antes de repetir una
prueba breve, sin mantener un bot dentro. Se conocen dos peticiones de proveedor
en ese primer intento; importe y GPU no consultados. El registro de uso de
Recall aún no devolvió una fila para esa sesión en la ventana consultada; no se
declara coste cero.

Las futuras pruebas privadas tienen límite de 15–90 segundos, salida en
`finally` del operador y respaldo de expiración en el cron. No se mantiene un
bot durante implementación o esperas de revisión. La voz real, la fidelidad
auditiva, la pizarra y el avatar dentro de Zoom requieren la comprobación final
breve; la mano nativa permanece sin soporte comprobado.

## Cierre de implementación y correcciones posteriores

Este registro añade los resultados posteriores; conserva el checkpoint anterior
y sus fallos. Se corrigieron tres problemas que las pruebas iniciales con
proveedores sustituidos no detectaban:

- Muse empieza sus identificadores en el número **0**. La conversión con `|| ''`
  descartaba ese primer turno. Ahora se acepta y se añade un identificador de
  conexión para no confundir el primer turno de una reconexión con un duplicado.
- El presupuesto de respuesta de Meta podía agotarse en razonamiento interno y
  dejar el contenido vacío. La conversación y los resúmenes reutilizan ahora el
  adaptador de inferencia de Brivany, Spaik Flash sobre Workers AI, con su modelo
  ya seleccionado y razonamiento desactivado. Se conserva una alternativa Meta
  con presupuesto explícito y detección de truncamiento. La síntesis sigue
  siendo únicamente Cartesia, con la voz, modelo y velocidad indicados arriba.
- `AbortSignal.timeout(5000)` seguía unido al fetch después de abrir el WebSocket
  y cortaba la escucha con cierre 1006. El plazo limita ahora solo el handshake
  y su temporizador se elimina al terminarlo. La prueba de workerd mantiene el
  socket abierto más de cinco segundos antes de pedir una respuesta.

El verificador sintético también se corrigió: espera el final efectivo dentro
de 30 segundos y transmite silencio PCM continuo mientras espera, como hace el
micrófono real. La última comprobación **sí completó** reconocimiento, respuesta
y audio: entrada sintética de 92.160 bytes y salida de 149.760 bytes PCM de
24 kHz, sin saludo inicial ni error de sesión. Hubo tres peticiones externas
(conexión Muse y dos síntesis Cartesia) y una inferencia Workers AI; esta última
informó 141 tokens de entrada, 14 de salida y 5,3727 neurons. Esto comprueba el
flujo técnico con proveedores reales, **no una conversación humana en Zoom ni
su calidad auditiva**. No se guardó audio.

Hubo siete verificaciones sintéticas breves de proveedores: seis fallaron antes
de las correcciones y la séptima pasó. Sus contadores suman 19 peticiones
externas iniciadas por esos verificadores; hubo además una petición diagnóstica
a Meta y las inferencias Workers AI, que se contabilizan aparte. No es una
cifra total de toda la integración ni un importe de facturación. El importe
real y el tiempo GPU no se consultaron.

La escucha silenciosa conserva en memoria hasta cinco minutos, cuarenta
fragmentos y 18.000 caracteres de contexto reciente, para poder responder a una
pregunta sobre lo que se discutía. No genera respuestas a conversaciones que
no se dirigen a Melodi. El contexto se elimina al cerrar la conexión; la
transcripción completa posterior sigue en el almacenamiento cifrado separado.
La sesión interactiva tiene un token de dos horas y un máximo de sesenta
respuestas; los participantes de la reunión no reciben herramientas de control
del ordenador ni permisos sobre las cuentas del titular.

La identidad se aplica también a bots con voz desactivada: cámara JPEG
1280 × 720 de 31.026 bytes, renderizada localmente desde la imagen original
y Brivany Editorial, sin generación de imagen ni cambios en el original.
Se configura en los estados de grabación y de espera de grabación mediante
el [mecanismo de imagen automática documentado por Recall](https://docs.recall.ai/docs/output-video-in-meetings).
Los bots interactivos mantienen el avatar de Output Media. El nombre del bot
del titular es **Melodi · Asistente de Daniel Luna**.

## Última prueba de Zoom y estado de salida

Tras pasar la voz con proveedores reales se intentó una única prueba breve
adicional del avatar, captura y pizarra, con el enlace previamente autorizado.
Zoom devolvió `meeting_not_found`; el bot terminó en estado `fatal` y no llegó
a entrar. El operador cerró el intento tras **24 segundos**, ejecutó su limpieza
y no repitió el lanzamiento. La consulta final por MCP mostró únicamente el
bot inicial en `done` y el nuevo en `fatal`, sin bots activos.

No se acredita aún el avatar ni la pizarra dentro de una reunión activa, ni la
conversación con una persona real. Pasan sus pruebas con navegador, WebSockets,
AudioWorklet y workerd usando proveedores sustituidos. La solicitud de palabra
sigue siendo un indicador visual en la cámara: no una mano nativa de Zoom.
La pizarra es texto y esquema compartidos por Brivany: no la herramienta de
pizarra nativa ni dibujo libre de Zoom. No se mantiene un bot en sala mientras
se desarrolla, se revisa o se espera al usuario.

Las pruebas privadas añaden vencimiento del trabajo antes de ejecutarlo y
comprobación del límite antes de crear un bot, además de limpieza del operador
y respaldo del cron. Un trabajo retrasado que ya caducó no puede crear un bot.

## Verificación y despliegue definitivos

Publicación final el **16-11-2026, 16:37:36 UTC**, versión
`47d956d5e8ac469cac74188bea4c9684`. Se verificó la descarga publicada: conserva
los 2.313.420 bytes del programa anterior y sus módulos binarios, e incorpora
Recall con los bindings anteriores heredados. Salud pública 200; reuniones
sin autenticación 401; webhook sin firma 401. El webhook firmado real ya había
quedado verificado en el primer checkpoint.

Pasan 13 pruebas de reuniones, 10 de voz/contexto/resumen/pizarra/límites,
28 del cliente nativo, seis recorridos HTTP de interfaz, workerd con D1/colas,
WebSockets y navegador con micrófono simulado, 478 regresiones de WhatsApp y
la compilación `wrangler deploy --dry-run` con los nuevos activos binarios.
No se enviaron mensajes de WhatsApp en esas regresiones.

Evidencias locales sin claves, enlaces privados, conversaciones ni medios
originales de la reunión:

- `tmp/verification/recall-meetings-20261116T163447-4367867a.json`.
- `tmp/verification/recall-voice-20261116T163635-5e7be932.json`.
- `tmp/verification/recall-native-20261116T162426-d163ea8a.json`.
- `tmp/verification/recall-ui-20261116T162457-db680939.json`.
- `tmp/verification/recall-runtime-20261116T163637-d655c5f5.json`.
- `tmp/verification/recall-voice-runtime-20261116T163640-2067f902.json`.
- `tmp/verification/melodi-whatsapp-20261116T163745-ab53278d.json`.
- `tmp/recall-release/production-verification.json` y `live-media-check.json`.

Para usarlo, iniciar sesión en Cuenta Vetsa, conservar la vinculación propia de
WhatsApp y abrir **Reuniones**. Se puede enviar un enlace, elegir una hora,
activar la voz opcional o marcar eventos de **Vetsa · Equipo**. La ejecución
alojada continúa con el ordenador apagado. El próximo ensayo visual completo
requiere una reunión activa; no se ha dejado ninguno programado para probar.
