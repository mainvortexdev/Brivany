# Validación de Brivany

Continuación del 29 de octubre (La Paz): [ingreso multivista y portabilidad](docs/41-ingreso-multivista-y-portabilidad.md). Suite completa de 655 pruebas Python aprobada, seguida de controles focalizados de importación/color y recorridos reales locales en navegador con modelos/SDK sustituidos. Las suites se solapan; no se suman como pruebas únicas. Sin nueva inferencia remota; precisión profesional y reconstrucción real pendientes.

Actualización del 29 de octubre de 2026: [auditoría de casos de uso](docs/40-auditoria-casos-de-uso.md), con 610 pruebas Python aprobadas y 19 suites seleccionadas, controles solapados. El texto posterior conserva resultados históricos del 27 de octubre; no debe usarse su conteo como estado actual. Informe: [PDF](Brivany_Auditoria_Casos_de_Uso_2026-10-29.pdf).

27 de octubre de 2026. Base local de voz, human-skills, preparación espacial y bitácora.

## Resultado comprobado

- **107 pruebas Python**: procedencia y límites de la práctica, incertidumbre,
  consentimiento de envío, servidor HTTP local, relay Muse real en loopback con upstream simulado,
  contrato Melodi PCM y adaptador Meta con transporte simulado.
- Incluye **9 pruebas del relay de doblaje** con upstream simulado en loopback:
  consentimiento, límites, formato/ritmo, concurrencia, cancelación, cierre con
  drenaje, tiempo máximo y errores sin reintentos. Dos comprobaciones HTTP nuevas
  cubren clave separada/persistente y estado sin atribuir mediciones inexistentes.
- De ese total, **15 pruebas espaciales** comprueban contratos, hashes, límites,
  escala/física declaradas, paquetes y publicación sin carpeta parcial ante fallo;
  **6 de bitácora** comprueban persistencia, snapshots, concurrencia, cambios de
  evidencia/cadena, exclusión de rutas privadas y API HTTP local de lectura.
- **10 escenarios de bitácora en navegador** con API simulada: listado, evidencia,
  filtros, contenido escapado, búsqueda, exportación, móvil/escritorio, error,
  vacío y paginación. Sin llamadas externas ni mutaciones HTTP.
- Formulario local de clave Meta: campo password, borrado tras enviar, respuesta sin clave,
  escritura atómica de .env y protección de origen. La prueba de UI intercepta el guardado;
  nunca reemplaza una credencial real.
- **22 pruebas JavaScript**: selección contextual explícita, citas de fragmentos,
  contexto preparado, parciales corregidos, orden de turnos y preguntas excluidas como evidencia,
  deduplicación, memoria acotada, muletillas, pausas acústicas, PCM 24/44.1/48 kHz,
  reproducción con bloques impares y cancelación de voz/ASR; preparación de la siguiente frase
  durante reproducción, pausas sin solapamientos y audio programado limitado a dos segundos.
- **15 comprobaciones live en navegador**: ausencia de clave bloquea captura,
  permisos, AudioWorklet real con señal sintética, parciales, final Muse → Melodi,
  supresión de eco, interrupción, cierre con último fragmento, hablantes/reunión silenciosa y limpieza;
  contexto preparado, ayuda provisional, retractación, final confirmado y tarjeta visible en móvil.
- **11 escenarios de navegador** en Microsoft Edge headless con audio, voces y
  reconocimiento simulados: permiso inicial, modo reunión silencioso, guía local,
  voz con pausas, inicio/parada, respuestas tras pausa, borrado, frases bilingües,
  taller conectado a la API, shell PWA offline y ausencia de errores JavaScript.
- **15 pruebas de human-skills incluidas en Python**: contrato, proveedor simulado,
  consentimiento y origen, límites de video y evidencia, errores sin reintentos,
  deduplicación concurrente y tras reinicio, persistencia, progreso y borrado.
- **11 escenarios de human-skills en navegador**, con API simulada: consentimiento,
  creación y consulta del trabajo, fuentes con SHA-256, niveles de ayuda, progreso manual,
  exportación, recarga, archivo incorrecto, borrado y vistas responsive.
- Vista responsive comprobada en 320, 390, 768 y 1440 px; sin desbordamiento
  horizontal. Capturas de escritorio, móvil y landing revisadas visualmente.
- **11 manifiestos/ejemplos aceptados**, **18 casos inválidos rechazados**,
  **27 esquemas actualizados**, **23 operaciones HTTP propuestas** revisadas
  estructuralmente y **292 referencias de esquema** resueltas.
- Enlaces Markdown locales comprobados. El validador ya permite la interfaz y
  lee UTF-8 explícitamente en Windows.

La paleta de la interfaz usa blanco, negro, grises y azul según los tokens de
[apple.com](https://www.apple.com/). Los componentes e identidad son de Brivany.

## Límites

No se probaron micrófonos/cámaras físicos, calidad audible de voces instaladas,
precisión de reconocimiento con personas, instalación real en iPhone/Android/macOS
ni Meta Glasses. Las pruebas de audio usaron una señal sintética y mocks; ninguna
activó dispositivos del usuario. Separadamente se llamó a Cloudflare real con frases sintéticas
para comprobar Melodi y medir latencia; resultados en `tmp/live-latency.json` y `tmp/playback-latency.json`.

Muse y Muse Spark 1.3 ya se verificaron con la clave guardada por el usuario. Inglés ofrece frases preparadas, no
traducción libre. Reunión recupera fragmentos por coincidencias léxicas y detecta
preguntas textuales, con etiquetas de hablantes de Muse (sin identificar personas/destinatarios) y sin verificar hechos
externos. El resumen es extractivo. Las pausas reflejan actividad acústica
aproximada; las muletillas son candidatos sobre texto. No se califica dominio,
emoción, acento ni presencia automáticamente.

La PWA conserva exclusivamente recursos estáticos en caché. Conversaciones y
grabaciones permanecen en memoria, salvo una descarga decidida por el usuario.
Muse envía audio a Meta; Melodi envía texto a Cloudflare; el ASR del navegador puede usar otro proveedor.
Todos se seleccionan explícitamente. Las voces locales siguen disponibles sin sustitución oculta.

El servidor H1 escucha solo en loopback. No es el backend de producción ni
implementa la API `/v1`, persistencia de conversaciones, autenticación multiusuario o despliegue.
Los borradores de human-skills y su progreso sí persisten localmente; sus videos no se conservan.
La revisión OpenAPI no sustituye un validador completo ni pruebas de sus rutas.
DBML sigue siendo un modelo lógico, sin migraciones PostgreSQL.

## Reproducir

```sh
python -X utf8 -B tools/build_contracts.py
python -X utf8 -B tools/build_speaking_skill.py
python -X utf8 -B tools/validate_contracts.py
python -X utf8 -B -m unittest discover -s tests -v
node --test tests/context-engine.test.cjs tests/voice-engine.test.cjs tests/live-voice.test.cjs
```

Para los escenarios de navegador, iniciar el servidor con `start-h1.ps1` y
ejecutar `node tools/check_ui.cjs`. Requiere Playwright y un navegador Chromium.
`BRIVANY_PLAYWRIGHT_PATH` admite una instalación existente de Playwright;
`BRIVANY_BROWSER_CHANNEL=msedge` permite usar Microsoft Edge instalado.
`BRIVANY_TEST_URL` cambia la URL local de prueba. `node tools/check_live_ui.cjs` prueba la conexión live con proveedores simulados.

Las capturas temporales se guardan en `tmp/ui/`. Los PDF se conservan como
documentos históricos y no reflejan el alcance actual.

## Apertura de la interfaz

La interfaz responde en `http://127.0.0.1:8765/app` y el contexto del navegador compartido
por el usuario confirma que fue abierta. El control automatizado del navegador sigue deshabilitado
en Work. El usuario creó la clave y la guardó mediante el formulario local sin pasarla por el chat.
Se comprobó su persistencia y carga en otro proceso. No se cambiaron los ajustes de Work.

## Proveedores reales y latencia

Muse transcribió tres frases sintéticas correctamente; final en 285–368 ms tras la última actividad.
La salida Celeste sola tuvo 879 ms de mediana hasta programar voz en el navegador (5 muestras).
El recorrido real Muse → Spark 1.3 → Celeste → navegador tuvo 4286 ms de mediana y 4599 ms de
máximo en tres muestras, sin hardware físico. El primer texto de Spark (1709–3051 ms) domina
la espera. No se garantiza fluidez instantánea. Se corrigió la confusión del modelo entre el
nombre de la aplicación y el del usuario. Informes reproducibles en `tmp/`; detalles en
[voz live](docs/13-voz-live.md).

La ruta silenciosa de reunión se midió por separado con Muse real en DIARIZATION y una pregunta
sintética completa de 6,852 s. Tres hechos de prueba ya estaban registrados manualmente. La primera
cita provisional apareció 2256–2575 ms después de comenzar la pregunta, 4277–4596 ms antes de su
final. Desde el parcial útil hasta la oportunidad de pintado transcurrieron 17–25 ms; se midió
con `requestAnimationFrame`, sin pantalla física. No hubo llamadas de respuesta al modelo ni TTS.
Esto prueba recuperación anticipada de citas existentes, no generación o verificación instantánea
de respuestas desconocidas. Informe: `tmp/meeting-latency.json`; reproducción:
`node tools/measure_meeting.cjs` con la muestra sintética preparada.

Fluidez de voz: tres comparaciones alternadas con Cloudflare real redujeron el intervalo de actividad
entre frases de 1150 a 416 ms de mediana (PCM: 794 a 89 ms), conservando la pausa intencional.
Se probó además liberar el bloqueo de síntesis antes de anunciar EOF, para que la siguiente petición
no encuentre una operación ya terminada todavía ocupando el servidor. Informe: `tmp/voice-fluency.json`.

Doce solicitudes sintéticas compararon versiones de Spark e instrucciones compactas; todas finalizaron.
Se mantuvo Spark 1.3 con las instrucciones compactas. La comparación completa antes/después de tres
muestras por variante pasó de 4290 a 4155 ms de mediana hasta programar la primera voz: mejora pequeña
frente a la variabilidad, sin garantía de respuesta instantánea. Informes: `tmp/model-comparison.json`,
`tmp/conversation-before-fluency.json` y `tmp/conversation-after-fluency.json`.

## Human-skills desde video

Una sola solicitud real a Spark 1.2 procesó una demostración sintética de nueve segundos sin audio
y generó tres pasos con referencias correctas a sus tres pantallas. Tardó 8281 ms y usó 3598 tokens
(1908 entrada, 1690 salida). Se guardó en la biblioteca local. No se repitió la llamada ni se compararon
modelos; las demás comprobaciones fueron simuladas. Informe: `tmp/human-skills-test/real-check.json`.
La prueba no establece calidad con audio ni videos complejos. [Método y límites](docs/14-human-skills.md).

## Preparación espacial S1

Se preparó el MP4 sintético existente de nueve segundos con FFmpeg: seis JPEG,
cuatro hashes únicos y dos duplicados exactos. Se generaron manifiesto, plan Modal
desactivado, preflight y ZIP sin el video original. Evidencias en
`tmp/spatial-capture-s1/`, conservadas también en la bitácora.

El paquete comprueba extracción y trazabilidad; no representa una habitación real,
no evalúa cobertura/nitidez y no contiene una reconstrucción 3D. Los 180 segundos GPU
del plan son un límite declarativo pendiente de ejecutor. No hubo inferencias Meta
ni Modal en S1. [Arquitectura y reproducción](docs/15-plataforma-espacial.md).

## Bitácora de construcción

`/activity` funciona con el servidor local. Las seis pruebas Python de bitácora
usan almacenamiento temporal y HTTP real en loopback; las diez de interfaz usan
API simulada. Una comprobación adicional abrió la página y API reales, consultó
13 entradas existentes en ese momento y descargó una evidencia cuyo SHA-256
coincidió. Capturas reales en `tmp/ui/activity-local-1440.png` y
`tmp/ui/activity-local-390.png`; informe en `tmp/ui/activity-local-check.json`.

La actualización del shell PWA y los enlaces pasaron los 11 escenarios existentes
de la app con proveedores simulados. Los informes de suites ejecutadas en esta
etapa están en `tmp/verification/` y como copias persistentes en la bitácora.

El histórico incorporado distingue retrospectivas y nuevas comprobaciones.
Persistencia, hashes y cadena local no constituyen una auditoría independiente ni
prueban el significado de los informes. La verificación real del doblaje, reconstrucción
GPU y física interactiva siguen pendientes. Esta ampliación no hizo nuevas
llamadas de inferencia Meta/Modal. [Registro y límites](docs/17-bitacora.md).

## Traducción y doblaje: primera integración

La suite completa de 107 pruebas Python pasó tras añadir adaptadores y controles
HTTP. La prueba en navegador usa un MP4 sintético de cuatro segundos con señal de
audio, AudioWorklet real y API/WS simulados. Pasaron 19 escenarios del selector Palabra/ElevenLabs, entre ellos
consentimiento, guardado de clave interceptado (nunca reemplaza una real), PCM,
subtítulos, pausa/búsqueda/idioma, drenaje, cancelación y vistas responsive.
Informe `tmp/ui/dubbing-check.json`; capturas `tmp/ui/dubbing-390.png` y
`tmp/ui/dubbing-1440.png`. El propio informe indica API simulada e inferencia no
medida. [Integración y protocolo](docs/18-traduccion-video-live.md).

Se creó la clave Palabra en la sesión del usuario, con su autorización, y se guardó
en `.env` mediante el formulario local. El primer ensayo real de 4,28 s completó
entrada/salida/cierre; primer audio a 3110 ms desde el primer PCM y conexión previa
de 2234 ms. No se recibieron métricas internas de inferencia. No están verificados
naturalidad, precisión bilingüe, máxima inferencia de 500 ms ni retraso físico
audible. El informe y sus límites están en la bitácora y en el documento de doblaje.

La segunda muestra real completada, tras corregir configuración y tolerar ausencia
de metadatos opcionales, dio 2906 ms hasta primer audio y 725,21 ms de cola estimada
máxima de reproducción. Un intento intermedio falló antes de enviar audio. No se
verifica inferencia interna; los campos de cola efectiva no fueron devueltos. Los
tres informes están conservados en la bitácora. La clave volvió a cargarse en otro
proceso, comprobando persistencia sin imprimir el secreto.

## Prototipo de traducción Meta por segmentos

La suite completa pasó **131 pruebas Python** tras integrar la ruta modular,
incluyendo siete del adaptador MT, catorce de segmentación/relay y dos de su
medidor. Informe `tmp/verification/python-20261028T001455-c6cfe22b.json`. Los 24
escenarios UI usan API/WS simulados. Una prueba integral adicional recorre UI,
HTTP, WebSocket y AudioWorklet reales con ASR/MT/TTS sustituidos en loopback:
101 paquetes PCM, dos traducciones y dos síntesis; la primera traducción ocurrió
antes de terminar el video. Informe
`tmp/verification/modular-pipeline-20261028T001455-1944393e.json`.

El rechazo HTTP inicial se conserva como resultado fallido. Una consulta de
catálogo posterior confirmó autenticación de lectura y modelo listado, sin
inferencias. Un único reensayo de texto produjo traducción en **1344 ms** de
petición (red y servicio), sin medir inferencia interna. Informe
`tmp/translation-measurements/20261028T001027-fa3b6e22.json`.

La cadena real Muse → segmentación → M2M100 → Melodi completó un único ensayo
EN→ES de audio sintético de 2,344 s: **5937 ms** desde el primer PCM de entrada
hasta el primero traducido; conexión previa de 672 ms, petición MT de 2907 ms y
petición TTS hasta primer PCM de 562 ms. Una petición MT y una TTS iniciadas,
3,56 s de salida, cola estimada máxima de 435 ms. Informe
`tmp/dubbing-measurements/20261028T001543-4e4e5473.json`. No es una comparación
controlada con Palabra ni un percentil. Inferencia interna, calidad bilingüe,
audio físico, retraso semántico y coste facturado siguen sin medir. **No se ha
demostrado cumplir 500 ms.**

## Gemini Live y diagnóstico de latencia

La suite completa pasó **151 pruebas Python** tras añadir Gemini, transporte
persistente MT y tiempos por etapa: `tmp/verification/python-20261028T003953-79b17a6c.json`.
La interfaz pasó 29 escenarios con API/WS simulados, incluido el modal de clave
Google, permisos, cambio de proveedor y aviso de finalización no verificada:
`tmp/verification/dubbing-ui-20261028T004056-fd27b133.json`.
El recorrido integral con Google simulado pasó con UI/HTTP/WS/AudioWorklet reales:
`tmp/verification/gemini-pipeline-20261028T003953-373d3af2.json`. No mide el modelo.

La clave Google aportada por el usuario se guardó en `.env` y se cargó en el
servidor sin imprimirla. Una única sesión real confirmó acceso y produjo primer
audio a **3171 ms** sobre la misma muestra sintética EN→ES de 2,344 s. Recibió
107 bloques y 8,95 s de PCM. **Falló `dubbing_drain_timeout`** al no confirmar el
final antes del plazo. Informe `tmp/dubbing-measurements/20261028T004531-ee8c89f9.json`.
Estimación por tarifas de audio: $0.004906 antes de cuota gratuita; cargo real
desconocido. Inferencia interna y máxima de 500 ms siguen sin verificar. No se
ha repetido el ensayo para buscar una cifra favorable. [Detalles](docs/24-voz-a-voz-nativa.md).

Tras añadir diagnóstico de señales sin datos privados y enlace directo al modal,
la última suite pasó **154 pruebas Python** y la UI **30 escenarios**. Informes
`tmp/verification/python-20261028T005031-6d22f173.json` y
`tmp/verification/dubbing-ui-20261028T005031-aa1beb87.json`. Las ampliaciones se
comprobaron sin nuevas inferencias. El informe real fallido conserva su resultado;
las nuevas pruebas simuladas no lo convierten en un éxito del proveedor.

## Cierre local de Gemini y observación PCM

La nueva política Gemini no exige IDLE para una traducción continua. Espera al
menos 4 s después del último reenvío y permite cierre por 750 ms sin contenido
nuevo, o al alcanzar un presupuesto nominal de 12 s. El cierre local no confirma
que el proveedor tradujo toda la entrada. Se probaron controles, heartbeats,
audio tardío, cola pendiente, error y desconexión antes del plazo.

Pasaron **167 pruebas Python** (`tmp/verification/python-20261028T010441-704eadb9.json`)
y la prueba integral de navegador con Google simulado sin señales de final
(`tmp/verification/gemini-pipeline-20261028T010441-3cfceeeb.json`). Nueve pruebas
de observación PCM comprueban energía en ventanas y paquetes partidos sin
persistir el audio; no reconocen habla ni miden inferencia.

Una única sesión real con la misma muestra de 2,344 s obtuvo primer PCM a
**3390 ms**, **1031 ms después del último PCM enviado**, y cerró localmente a
12078 ms del fin de entrada por presupuesto de recepción. Recibió 10,1 s PCM;
el primer cruce RMS >0.005 llegó con el primer paquete. Informe
`tmp/dubbing-measurements/20261028T010638-e2e9124e.json`. Estado funcional `passed`,
con `session_closed_locally:true`, `provider_finalization_verified:false` y
`full_translation_verified:false`. Inferencia, calidad y máximo de 500 ms no
verificados; estimación $0.005510 y factura desconocida. [Límites](docs/24-voz-a-voz-nativa.md).

## Revisión de integridad con fixture sintética

La revisión opcional, limitada a un WAV de ruta/hash fijos, encontró una omisión
en el texto de salida: «Esta habitación tiene», frente al original con «two
windows». Un único ensayo posterior con 2 s de silencio final optativo produjo
«Esta habitación tiene dos ventanas.». Primer PCM a 3297 ms desde inicio y
953 ms después del último PCM original; no desplaza el origen de latencia al
silencio añadido. El cierre local siguió sin confirmar el final del proveedor.

Informe `tmp/dubbing-measurements/20261028T013411-7d825576.json`; voz sintética y
texto en `tmp/synthetic-dubbing-review/1cbba689-9bf3-4f4e-9420-237d0bcaa589/`.
La comparación textual es concreta; naturalidad, audio inteligible, precisión
general y máximo de 500 ms siguen sin verificar. El audio no se adjunta a la
bitácora, solo hashes/informes. [Método y límites](docs/25-integridad-del-doblaje.md).

Pasaron **180 pruebas Python** y **31 escenarios UI**. Un informe previo registra
dos abortos locales WinError 10053; las pruebas afectadas pasaron aisladas y la
suite completa pasó sin navegador concurrente. Evidencias:
`tmp/verification/python-20261028T013012-09d33128.json` (fallido),
`tmp/verification/python-20261028T013228-3b75710e.json` (aprobado),
`tmp/verification/dubbing-ui-20261028T013012-d76a0978.json` (aprobado).

## Retraso audible y entrega de ráfagas · 28 de octubre de 2026

El usuario precisó que 500 ms corresponde al retraso audible. El nuevo medidor
compara energía original y traducida en el mismo reloj de audio, separando el
silencio final del archivo. La fixture WAV tiene unos 744 ms finales bajo el
umbral RMS; las cifras anteriores de 250/203 ms después del archivo no prueban
esa espera desde el final del habla.

El relay Palabra divide las ráfagas en bloques de hasta 40 ms y limita el
adelanto a 300 ms sin descartar PCM. Pasaron **20 pruebas de Palabra** y
**31 pruebas Node**, incluidas nueve específicas de energía/tiempo. La interfaz
pasó **32 escenarios**; la estimación de energía no convierte el objetivo de
500 ms en verificado. El recorrido de reloj en navegador con upstream simulado
también pasó sin llamadas externas.

Evidencias locales:

- `tmp/verification/palabra-20261028T015524-7a34f7b7.json`.
- `tmp/verification/javascript-20261028T115318-93e3f858.json`.
- `tmp/verification/dubbing-ui-20261028T115851-d80f4472.json`.
- `tmp/verification/dubbing-timing-20261028T115352-0c9c7d86.json`.
- `tmp/verification/contracts-20261028T115851-49a92a0e.json`.

Una única sesión real de Palabra normal pasó por el video, AudioWorklet, relay
y reproductor de Brivany. Programó 67 bloques sin activar el límite de cola;
recibió el subtítulo completo «Esta habitación tiene dos ventanas.».
Estimaciones de energía: **2579 ms inicio→inicio**, **1099 ms desde fin de
energía original→inicio traducido**, **336 ms desde fin del archivo** y
**3519 ms fin→fin**. El timestamp del dispositivo fue válido; no se capturó
loopback físico. No demuestra calidad audible ni alineación semántica general.

Informe `tmp/browser-dubbing-measurements/real-1793188472520.json` y análisis
posterior `tmp/browser-dubbing-measurements/analysis-1793188472520.json`.
Entrada 2,362667 s, salida 2,640208 s; una sesión sin reintentos. Estimación a
tarifa previamente consultada: $0.001575; cargo real desconocido. **El objetivo
audible de 500 ms sigue sin cumplirse ni verificarse.**
[Método, comparación y límites](docs/26-retraso-audible.md).

## Habla continua y correlación de fragmentos

Se añadió identidad de parte e intervalos relativos de entrada a los eventos
Palabra; la interfaz correlaciona esos datos con energía programada, muestra
cobertura parcial y deja desconocidas las marcas no utilizables. Se solicita
`only_confirm_by_silence:false` sin asumir que el proveedor lo aplicó.
Pasaron **24 pruebas Palabra**, **41 Node** y **35 escenarios UI**. El recorrido
con dos frases y upstream simulado también pasó, sin inferencias pagadas:

- `tmp/verification/palabra-20261028T121914-8001daaa.json`.
- `tmp/verification/javascript-20261028T122006-e65cdc51.json`.
- `tmp/verification/dubbing-ui-20261028T122006-d0caae1c.json`.
- `tmp/verification/dubbing-stream-timing-20261028T121251-032e5a37.json`.

Una sola sesión real con dos frases sintéticas, separadas por 260 ms de baja
energía, produjo el texto completo de ambas y 122 bloques de salida. La voz
traducida empezó **3483 ms después del inicio original** y **223 ms después de
la última energía original**; no empezó mientras seguía la fuente. Solo 1 de
2 partes pudo correlacionarse: 3583 ms desde inicio según proveedor y 1023 ms
desde su final. No se conoce retroactivamente el motivo de la segunda falta
de correlación. El ajuste solicitado fue ausente en `get_task`, por lo que
continúa sin confirmarse su aplicación.

Entrada capturada 3,477333 s, salida 4,800417 s; una sesión, sin reintentos.
Estimación a tarifa previamente consultada: $0.002318; cargo real desconocido.
Informe `tmp/browser-dubbing-measurements/real-1793189631971.json` y análisis
`tmp/browser-dubbing-measurements/analysis-1793189631971.json`.
La comprobación funcional pasó; **500 ms audibles no se cumplieron ni se
verificaron**. No hubo loopback físico ni evaluación de inteligibilidad o
alineación semántica independiente. [Detalle y siguiente decisión](docs/27-doblaje-por-fragmentos.md).

## OpenAI Translate conectado, modelo real pendiente

Se conectó el adaptador dedicado al selector, formulario privado, CSP y relay
propio. Guarda exclusivamente `BRIVANY_OPENAI_API_KEY`, valida la selección de
fuente como expectativa y declara autodetección del proveedor. Agrupa 200 ms de
entrada y conserva el último fragmento sin padding; entrega bloques de hasta
40 ms con adelanto acotado. Serializa cancelación y cierre, y no acepta
`session.closed` como cierre verificado antes de solicitar `session.close`.

La suite completa pasó **204 pruebas Python**; la interfaz **39 escenarios**.
El recorrido UI/HTTP/WS/AudioWorklet real con OpenAI simulado recibió una ráfaga
de 126730 bytes más cola, programó 69 bloques y cerró una sesión, sin perder
los deltas que comparten `elapsed_ms`. Esas marcas no se usan como identidad
semántica ni inferencia. No se ejecutaron inferencias reales de OpenAI.

- `tmp/verification/python-20261028T123304-bed68f41.json`.
- `tmp/verification/dubbing-ui-20261028T122745-1f36a319.json`.
- `tmp/verification/openai-translation-pipeline-20261028T123257-b27d87f3.json`.
- `tmp/verification/http-20261028T122939-12e6bf7e.json`.

La configuración local se comprobó mediante booleanos, sin imprimir secretos:
OpenAI no tenía clave. Faltan acceso real, latencia, integridad audible y coste
facturado de ese motor. **El objetivo de 500 ms sigue sin verificarse ni lograrse**;
la velocidad del stub no acredita velocidad del modelo. [Fuentes y próximo ensayo](docs/28-openai-traduccion-continua.md).

## Revisión optativa antes de otra inferencia

Se amplió el helper de revisión a las dos fixtures sintéticas aprobadas y se
conectó al medidor de navegador mediante `--review-synthetic`. Valida la fuente
antes de abrir el navegador; convierte una instantánea de bytes verificados y
conserva PCM de salida junto con una traza numérica de programación. El audio
no se adjunta a la bitácora.

Pasaron **16 pruebas del helper**, el recorrido positivo de conservación y el
rechazo de revisión sin interrumpir el cierre funcional. La prueba positiva
conservó **130570 bytes PCM** y **69 buffers** con hash y tamaños coincidentes;
la negativa mantuvo los 167168 bytes de entrada y un cierre, sin otra sesión.
Los **7 casos del medidor** también pasaron. Todo usó proveedores simulados,
sin inferencias reales ni evaluación de calidad de voz.

- `tmp/verification/synthetic-review-20261028T124449-22d4f453.json`.
- `tmp/verification/dubbing-review-pipeline-20261028T125549-4f45470d.json`.
- `tmp/verification/dubbing-review-rejection-20261028T125018-0915bdcf.json`.
- `tmp/verification/dubbing-measure-20261028T125133-330471ab.json`.

La inspección de entorno solo leyó metadatos: Windows 10.0.19045, por debajo
del mínimo 20348 publicado para loopback por proceso. No se activó captura,
micrófono ni reproducción de prueba en esa inspección. No se demuestra
imposibilidad absoluta ni soporte funcional de aislamiento; tampoco se mide
sonido físico. **Los 500 ms audibles siguen pendientes**. [Método y límites](docs/29-revision-audio-sintetico.md).

## Infraestructura local y primer visor espacial · 28 de octubre de 2026

Se entregó una biblioteca local con cola SQLite, recuperación tras reinicio,
cancelación cooperativa, caché verificada, enlaces de archivos de quince minutos
y presupuesto transaccional sin saldo supuesto. El visor carga cuatro GLB
procedurales de **Estudio de luz**: entorno fijo, sillón, mesa y lámpara. Permite
explorar, seleccionar, mover, girar, guardar y restaurar. La procedencia es
`generated_demo`, sin captura asociada ni reconstrucción atribuida a Meta.

La preparación de MP4 genera seis fotogramas y conserva un estado separado de
reconstrucción pendiente. El video temporal se elimina al terminar o cancelar.
El factory y runner Modal están preparados con dispatch desactivado; imagen,
pesos, licencias, presupuesto remoto y ejecución GPU continúan pendientes.
[Entrega y límites](docs/31-infraestructura-y-visor.md),
[cuentas y accesos separados](docs/30-accesos-pendientes.md).

Resultados locales comprobados:

- **254 pruebas Python aprobadas** en la suite completa final.
  [Informe](tmp/verification/python-20261028T155555-d828c23c.json).
- **23 pruebas HTTP aprobadas**, incluida la llegada tardía del cuerpo,
  respuesta antes del drenaje, límites de 128 KiB/200 ms y framing inválido.
  [Informe](tmp/verification/http-20261028T155531-b8c4076d.json).
- **55 pruebas espaciales**: contratos, trabajos, caché, limpieza, concurrencia,
  presupuesto, API y worker con modelo sustituido.
  [Informe](tmp/verification/spatial-20261028T154829-14a40af4.json).
- **11 comprobaciones de navegador** con servidor temporal, SQLite y WebGL
  reales: arrastre del eje del objeto con posición persistida, edición numérica,
  restauración, navegación, seis fotogramas sintéticos, alternativa sin WebGL y
  anchos 320/390/768/1440. Renderizado por software permitido.
  [Informe](tmp/verification/spatial-ui-20261028T154330-edafc33d.json).
- **Instalación activa**: lectura de API y GLB, selección y adaptación, sin
  mutaciones, micrófono ni solicitudes externas.
  [Informe tras reiniciar el servidor](tmp/verification/spatial-local-20261028T155729-ab7cc077.json),
  [escritorio](tmp/ui/spatial-local-1440.png), [móvil](tmp/ui/spatial-local-390.png).
- **Integridad vendor**: SHA y cierre de imports locales de Three.js 0.180.0.
  [Informe](tmp/verification/spatial-vendor-20261028T153745-fc82ccae.json).
- **Worker offline**: sintaxis, hashes, configuración y bloqueos; no construye
  imagen ni ejecuta SDK/modelo.
  [Informe](tmp/verification/spatial-worker-20261028T155109-ec8fa9bf.json).
- **Contratos**: 11 ejemplos, 18 rechazos, 27 esquemas y 23 operaciones HTTP.
  Se comprobaron también 149 enlaces Markdown tras completar la documentación.
  [Informe](tmp/verification/contracts-20261028T155756-3e467fd2.json).
- **Regresión UI**: 11 comprobaciones de app, 10 de bitácora y 39 de doblaje
  con proveedores simulados.
  [App](tmp/verification/app-ui-20261028T154801-a7a130cb.json),
  [bitácora](tmp/verification/activity-ui-20261028T154801-94f767f5.json),
  [doblaje](tmp/verification/dubbing-ui-20261028T154646-129fbace.json).

Se conservaron fallos iniciales y sus correcciones: parser vendor que contaba
imports de comentarios, publicación de estado terminal antes de limpiar el
video temporal y cierre HTTP con cuerpo rechazado aún sin consumir en Windows.
Los informes fallidos permanecen en la bitácora; un pase posterior no los borra.
La primera suite completa ejecutó 250 pruebas y falló una con WinError 10053;
el [informe conservado](tmp/verification/python-20261028T155109-b76e930a.json)
permitió reproducir el cierre temprano y añadir cuatro pruebas de regresión.

Estas pruebas no gastaron inferencia de modelos ni GPU remota. No evalúan
captura real, fidelidad geométrica, escala métrica, física, calidad de voz o
dispositivos físicos. El límite de cancelación local es cooperativo entre
operaciones acotadas de FFmpeg. **La implementación se detiene en el visor**;
voz, cuentas, APIs y Spaik Iris quedan para la siguiente sesión autorizada.

## Continuación local: captura, revisión, edición y orquestación · 28 de octubre

El usuario autorizó seguir la checklist dejando su intervención pendiente.
Se implementaron selección rectangular manual de hasta tres objetos con hashes
de fotograma/máscara, referencia de longitud declarada, entrada PNG/máscara de
un objeto y señales orientativas de imagen. No se ejecutó segmentación ni
reconstrucción de Meta. La captura optativa de cámara usa sólo video y requiere
un clic expreso; se probó con stream de canvas y un grabador sustituido.

Se añadieron historial persistente de cien estados, veinte variantes,
exportación ZIP, carga GLB acotada, render al cambiar y recuperación del visor.
La portada muestra la escena procedural identificada. El respaldo offline CLI
valida hashes, SQLite y referencias antes de restaurar a una carpeta nueva.
No se respaldaron datos privados reales. El orquestador local conecta paquetes
revisados con presupuesto, identidad estable y transporte sustituto; conserva
consumo desconocido y no reenvía al reiniciar o restaurar. El adaptador real
sigue pendiente y el CLI no puede despachar a Modal.

- **295 pruebas Python aprobadas** en la suite completa final, incluidas 12 de
  orquestación y 14 de respaldo/restauración.
  [Informe](tmp/verification/python-20261028T210141-0bafe816.json).
- **23 comprobaciones UI** con servidor temporal, SQLite, WebGL y conversión
  PNG reales. Incluyen historial/variantes, arrastre, exportación, revisión
  persistida, paquete de objeto, invalidación del enlace anterior, recuperación
  tras evento sintético de pérdida de contexto y captura de cámara sustituida.
  [Informe](tmp/verification/spatial-ui-20261028T205747-358aa0b7.json),
  [revisión de escritorio](tmp/ui/spatial-review-1440.png),
  [revisión móvil](tmp/ui/spatial-review-390.png).
- **Regresión de app y portada**: 11 comprobaciones, anchos
  320/390/768/1440, shell PWA y proveedores simulados.
  [Informe](tmp/verification/app-ui-20261028T210141-70689503.json).
- **Lectura de instalación activa y portada** sin mutaciones, micrófono o
  llamadas externas. La escena dibuja geometría antes de anunciar estar lista.
  [Informe final de instalación activa](tmp/verification/spatial-local-20261029T000604-1c8f7dbd.json),
  [visor](tmp/ui/spatial-local-1440.png), [portada](tmp/ui/landing-spatial-1440.png).
- **Contratos y enlaces**: 11 ejemplos, 18 rechazos, 27 esquemas, 23 operaciones
  contractuales y 170 enlaces en la comprobación de cierre documental.
  La cifra de operaciones no enumera las nuevas rutas del prototipo: esas se
  comprueban en la suite HTTP espacial real.
  [Informe](tmp/verification/contracts-20261029T000532-a9056bf0.json).

Los fallos y correcciones permanecen registrados. El primer selector UI era
ambiguo al haber dos bloques `scene-details`; otro stub de cámara impedía
redefinir `getUserMedia`. Ambos se corrigieron en el verificador, sin maquillar
salidas de proveedor. Una prueba MP4 de un fotograma detectó rango YUV del
encoder JPEG; se fijó el formato y se comprobó el fallback con sus advertencias.
La revisión independiente detectó un ZIP visible tras editar por puntero,
corregido con invalidación explícita. La inspección visual detectó una escena
vacía tras volver de captura: se corrigió render antes de disponibilidad y se
añadió la transición. Los pases previos no acreditaban ese caso.

Una comprobación de instalación y una regresión UI fallaron al estar el servidor
local detenido; no acreditaban un fallo funcional del visor. Se inició de nuevo
el servidor y se repitió la lectura real, con resultado aprobado. Los informes
de conexión rechazada se conservan, sin sustituirlos por resultados positivos.

Todas las verificaciones de este avance fueron locales, con cero inferencias
de modelos y cero GPU remota. Los importes de fixtures son sintéticos, no cargos
reales. No acreditan cámara física, dispositivos Apple/Android, cobertura,
escala métrica, geometría reconstruida, física, voz ni 500 ms audibles.
[Alcance de interfaz y respaldo](docs/32-revision-y-edicion-espacial.md),
[orquestación y límites](docs/33-orquestacion-local.md).
