# Melodi: Cognira Edits, voz, Work y esperas

30 de octubre de 2026. Implementación en los adaptadores Desktop y servicios
locales de Brivany. Se conservan los motores originales de voz, human-skills,
espacios y traducción. Los repositorios Cognira se consultaron sin modificarlos.

## Edición de video por MCP

Se revisaron `cognira-desktop/electron/services/editsMcpClient.cjs`,
`stacyEditsAgent.cjs` y el contrato del editor independiente en
`cognira-edits/electron/services/editsMcpServer.cjs`, `editsAutomation.cjs` y
`editsGoogleDrive.cjs`. Brivany implementa su cliente local en `services/edits`:
descriptor privado del editor, PID vivo, endpoint exacto 127.0.0.1/mcp,
autenticación bearer y JSON-RPC con IDs comprobados. No copia tokens ni cuentas.
El descriptor no se añade a la bitácora. No hay reintentos automáticos de comandos.

El chat ofrece un selector nativo de medios/proyectos. Una selección autoriza
esos archivos, no toda su carpeta. También se pueden usar las carpetas concedidas
en Ajustes. «Edita el video seleccionado…» inicia el agente de edición en su
propia cola, sin ocupar el ratón. Si falta información, queda para intervención.
«Busca ese video en YouTube» conserva el agente de navegador.

Se habilitan 30 herramientas locales del catálogo real: proyectos, medios,
secuencias, clips, color, subtítulos, montaje y exportación. Los análisis que
invoque el editor pueden consumir sus servicios: no se presupone coste cero.
Los IDs se obtienen de observaciones; se comprueban cambios concurrentes y se
guarda una copia independiente. Los clips de la secuencia original se protegen
exigiendo duplicarla antes de modificarlos. Los trabajos largos se esperan por
`job_status`; sólo se publica una exportación existente y no vacía, dentro de la
salida autorizada. Esto no certifica su calidad artística ni la intención del montaje.

## Capacidades en el mismo chat live

Texto y finales de transcripción usan el mismo coordinador: ordenador/navegador,
modelado conceptual, redacción, consultas personales revisadas, Edits, habilidades
y esperas. Las colas son independientes; el ordenador conserva una sola acción
nativa a la vez. Los avisos de finalización respetan la pausa del usuario.

El catálogo de Ajustes incorpora los módulos y las human-skills existentes,
Sous y práctica. Al seleccionar una habilidad, Melodi recibe su borrador y
progreso observado. Sus controles se abren junto al chat sin sustituir el nodo
del micrófono. Abrir módulos no inventa avances ni certifica dominio. Se limita
el contexto de bibliotecas grandes indicando el recorte. No se ejecutan archivos
SKILL.md de Codex como código ni se atribuyen capacidades de plugins no conectados.

## Work en segundo plano

Se activa desde la barra superior, Ajustes → Modo Work o una petición a Melodi.
Abre una ventana nativa flotante y oculta la principal, conservando su sesión.
Volver al chat muestra la principal. Cerrar la principal durante Work la oculta;
salir del acompañante termina Work y vuelve al chat. No instala un servicio del
sistema ni mantiene Brivany ejecutándose después de terminar su proceso.

«Seleccionar región de pantalla» toma una imagen en RAM, permite marcar una
región y enviarla al chat para explicar o traducir su texto. Se muestra la captura
antes de enviar; cancelar libera los píxeles. Sólo la región elegida se adjunta
al servicio de visión, con los límites ya existentes de referencias visuales.
La selección se reinicia al redimensionar para evitar coordenadas obsoletas.

La escucha del sistema se activa por separado y con aviso explícito. Usa la
salida del dispositivo, no el micrófono ni una pestaña aislada. Puede contener
sonidos de otras aplicaciones. El live del chat sigue teniendo su propio permiso
de micrófono. La captura usa SoundCard 0.4.6; se revisaron su
[documentación](https://soundcard.readthedocs.io/en/latest/) y el modelo
[WASAPI loopback de Microsoft](https://learn.microsoft.com/windows/win32/coreaudio/loopback-recording).
Se convierten todos los canales a PCM mono 24 kHz para evitar la limitación de
captura de un solo canal documentada por SoundCard en Windows.

Con detección activada, Muse recibe audio para transcribir y Meta clasifica
fragmentos; no se conserva la transcripción. Una detección suficiente de otro
idioma ofrece traducir y espera respuesta. El audio previo permanece hasta
120 segundos en RAM, sin archivo original antes de aceptar. Se conserva todo
el pre-roll disponible, sin cortar por la marca de tiempo de la transcripción.
Si ya se perdió un inicio, se indica expresamente.

Aceptar abre un WAV temporal con el pre-roll y los paquetes futuros recibidos.
«Finalizar grabación y traducir» detiene la captura y procesa la grabación usando
River/Muse/Meta/Cartesia, respetando ritmo, contrapresión y el último paquete
parcial. El límite de esta grabación temporal es 60 minutos; alcanzarlo detiene
la captura y registra la pérdida, sin ocultarla. La voz traducida se escucha al
terminar para impedir que vuelva a entrar en la captura. Las respuestas habladas
del chat también se suspenden mientras se conserva audio; el texto sigue activo.
La salida contiene voz traducida, no una reconstrucción de música o todos los
sonidos originales.

Se comprueban secuencias, discontinuidades comunicadas por el driver, inicio
parcial y bytes de entrada procesados. Estos controles no pueden garantizar
cero pérdida del dispositivo ni traducción semántica completa. El original se
elimina después de confirmar el procesamiento completo; los temporales restantes
se limpian al salir de Work normalmente. Un cierre brusco del proceso puede
dejar temporales en `.local/work`; la purga tras un cierre brusco queda pendiente.
No se incorporan audio ni capturas del usuario a la bitácora de construcción.

## Esperar una hora o un evento

«A las 18:00 crea una nota…» prepara una espera de un solo uso, con fecha y zona
explícitas; el coordinador usa America/La_Paz. «Cuando termine esta exportación,
súbela a la carpeta X de Drive y envíame el enlace por WhatsApp» vincula una tarea
observada. También puede preparar un flujo que empiece editando y después entregue.

Las reglas persisten en SQLite con sello de integridad y revisión concurrente;
su autoridad queda separada del token temporal del chat. Una tarea diferida sólo
recibe su objetivo, tipo y carpetas concedidas. Las entregas externas quedan en
borrador hasta revisar los pasos y activar ese flujo una vez. Se pueden revisar
y cancelar desde Agentes; se avisa al terminar o necesitar intervención.

El flujo de video exige un archivo exportado con recibo sellado y comprueba su
ruta, tamaño y hash antes de subir. El hash sólo acredita integridad. La carpeta
se resuelve por ID o por un nombre inequívoco. Se espera el identificador de
transferencia real del MCP y una carga completa con enlace verificado. Sólo
entonces se propone y ejecuta el WhatsApp al destinatario propio configurado y
con opt-in, usando el servicio de integraciones existente. La aceptación de la
API no prueba entrega al teléfono. Las cuentas del editor y de WhatsApp deben
estar conectadas y su ejecución habilitada; no se completan logins por inferencia.

Brivany debe permanecer abierta, incluso en Work. Un reinicio conserva esperas,
pero no repite un paso de resultado incierto. Una hora vencida por más de 60 s
queda como perdida y requiere nueva instrucción; no se ejecuta fuera de horario.
Si la tarea origen falla, se detiene el flujo. Una cancelación no revierte una
transferencia o envío ya iniciado. No hay disparadores de eventos arbitrarios de
otras aplicaciones: ahora se admiten hora y finalización de trabajos de Brivany.

## Evidencias y alcance de las pruebas

- `edits-mcp`: 10 pruebas de protocolo, edición aislada y contexto de habilidades,
  con servidor/editor/planificador sustituidos.
- `events`: 13 pruebas con reloj virtual, MCP y WhatsApp sustituidos. Incluyen
  el adaptador real y las puertas de IntegrationService: espera, sello, reinicio,
  carga completa, enlace `url` del contrato real, carpeta ambigua, archivo
  cambiado, cambio de sesión y un único mensaje. Ninguna entrega real.
- `work`: 13 pruebas con PCM/píxeles/ventanas sustituidos. Conservación byte a
  byte, pérdidas declaradas, consentimiento, pre-roll, último paquete, limpieza,
  cierre nativo y recuperación tras error de captura.
- `computer`: 22 pruebas, incluyendo autoridad diferida después de caducar la
  sesión del chat y contexto acotado para bibliotecas grandes.
- `computer-images-agents`: 15 pruebas; `desktop`: 21; `melodi-cartesia`: 30.
  Una expectativa antigua exigía separar dos frases muy cortas, aunque el live
  ya las agrupa para conservar ritmo. Se corrigió la prueba para comprobar texto
  completo, orden y ausencia de duplicación, conservando el motor de voz.
- `work-events-ui`: HTTP y DOM reales en Edge headless, con proveedores y puente
  nativo sustituidos. Transcripción → edición, habilidad junto al mismo micrófono,
  revisión/activación/cancelación de espera, Ajustes, Work y selector en ventanas
  estrechas. Capturas sólo de fixtures.
- `tmp/work-native/report.json`: ventanas Windows/WebView2 **reales**, con DOM
  del acompañante, vuelta al chat y cierre. Sin capturar pantalla ni audio ni
  hacer inferencia; consumo de red de fondo no medido.
- `tmp/edits-mcp-real/fixture-24d90f69/report.json`: editor empaquetado y MCP
  **reales**, perfil de prueba aislado y video sintético de 2 s. Duplicó secuencia,
  ajustó contraste y exportó 60 fotogramas a 30 fps con audio; conservó la secuencia
  original. Planificador sustituido; cero inferencias solicitadas, consumo de red
  de fondo desconocido. No acredita calidad artística ni análisis semántico.

Las suites se ejecutan con `python -m tools.verify <suite>` y registran su informe.
Los dos ensayos nativos reales son herramientas explícitas separadas, sin
grabación privada. La prueba física de loopback, detección/voz live simultáneas,
calidad de traducción, entrega real Drive/WhatsApp y control nativo macOS/Linux
siguen pendientes. No se enviaron mensajes ni archivos reales del usuario.
