# Brivany · Plan de la plataforma espacial

16 de noviembre, evaluación privada de Brivany 0.2.1 para el equipo de Jon.
Traducción auditiva prioritaria; Meta, Cartesia y Deepgram mediante cuenta demo
limitada a 5 USD compartidos en servidor, claves separadas y revocables.
Instalador privado con backend verificado y runtime de video; vínculo Vetsa,
WhatsApp y PC por usuario. Telnyx con API y emisor propios. La versión pública
no contiene invitaciones ni claves. Se conservan los límites de Google y las
capacidades aún no acreditadas en la [guía de evaluación](docs/demo-jon-20261116.md).

16 de noviembre, reuniones de Melodi mediante Recall v1.11 en Vetsa AI,
Frankfurt. Vista Reuniones con enlace Meet/Zoom, entrada inmediata o programada,
Calendar con selección expresa por evento, transcripción y resumen cifrados.
Backend alojado en Cloudflare y ampliación del servicio existente sin sustituir
el código publicado de WhatsApp. Voz opcional de Cartesia con la identidad de
Melodi, escucha silenciosa y respuesta al llamarla. Pizarra propia compartida y
solicitud visual de palabra; no se declaran controles nativos de mano o pizarra
de Zoom. Las comprobaciones reales y las capacidades aún no acreditadas se
detallan en [la entrega de reuniones](docs/recall-reuniones-20261116.md).

15 de noviembre, Brivany Editorial elegida por el usuario como tipografía de
toda la marca, web, programa, promociones y nuevos videos. Light 300, Regular
400 y Medium 500 del paquete suministrado; fuentes locales y licencia preservada.
La dirección vigente está en [identidad tipográfica](brand/typography/README.md).

13 de noviembre, Melodi sustituye al runtime de Dona en WhatsApp. Código y
adaptadores trasladados a `workers/whatsapp*` dentro de Brivany, con el número,
colas y almacenamiento existentes. Vinculación por cuenta Vetsa y código enviado
desde el teléfono, aislamiento por usuario y aprobaciones concretas del titular.
La instalación nativa se actualizó con respaldo y reinicio normal. Calendar
conectado por el titular; revisión de acceso a datos de Drive/Gmail preparada,
pendiente de demostración nueva y del proceso de Google/CASA. No se declara
acceso público de Google aprobado. [Migración, pruebas y límites](docs/melodi-whatsapp-migracion-20261113.md).

13 de noviembre, transferencia por el borde en ambos sentidos, por petición
expresa del usuario. Aura nativa de Windows tras emparejar por QR, selección
táctil dentro de la página del móvil y cola de hasta ocho archivos. Pasan
pruebas locales de contenido y arrastre OLE entre procesos propios; teléfono
físico, publicación y actualización de la instalación quedan por comprobar.
[Implementación y límites](docs/transferencia-borde-20261113.md).

12 de noviembre, primer intento PSTN de Telnyx autorizado por el usuario.
Registro SIP 200, pero la terminación devolvió 404 / Q.850 1. El CDR confirma
el destino solicitado y declara UNALLOCATED_NUMBER, ruta Intra y coste US$0.
El usuario confirma que la línea recibe llamadas normales; la causa del rechazo
debe aclararse con el operador. No hubo conversación ni un segundo marcado.
[Prueba y diagnóstico](docs/melodi-telnyx-primera-prueba-20261112.md).

12 de noviembre, configuración real de Telnyx para Melodi: perfil de salida y
conexión SIP con credenciales, emisor verificado y límites comprobados por API.
Se corrigió un fallo previo al registro y Telnyx respondió SIP 200. Pasan 28
pruebas locales en Windows. La primera llamada PSTN y la conversación real
siguen pendientes; no se marcó ningún número ni se cambió la instalación activa.
[Configuración, corrección y evidencias](docs/melodi-telnyx-configuracion-20261112.md).

12 de noviembre, Live adopta las reglas de turnos de Vetsa, generación y voz
solapadas, interrupción durante preparación y dieciséis señales variadas de
escucha, junto con muletillas contextuales. Se repara el ejecutor ausente de la
instalación y se confirma su arranque nativo. Las mediciones reales de proveedor
varían; la conversación física completa y la igualdad de latencia siguen sin
certificarse. [Implementación, pruebas y consumo](docs/melodi-live-vetsa-20261112.md).

12 de noviembre, vista central de voz con Melodi y ondas detrás durante la
reproducción. Se corrigen configuración antigua, plazos incompatibles, arranque
fallido sin explicación y cancelación tardía. Pasan pruebas locales y la conexión
de control real con Muse; la conversación física completa sigue sin comprobarse.
[Cambios, instalación local y evidencia](docs/melodi-voz-central-20261112.md).

12 de noviembre, cuenta compartida de Vetsa y Cognira incorporada a Brivany
Desktop. Acceso y gestión en ventanas nativas aisladas, PKCE, sesiones revocables
y persistencia DPAPI. El soporte central ya está publicado y la instalación local
actualizada. Pasaron pruebas del servidor, del cliente y de renderizado nativo;
el inicio con la cuenta y el dispositivo reales del usuario queda por probar.
[Entrega, seguridad y evidencia](docs/cuenta-vetsa-20261112.md).

8 de noviembre, Blobatar para el equipo de Melodi. Se instaló la versión
MIT 2.7.0 y se integró en barra, detalle y avisos, con identidad estable entre
reintentos, expresiones por estado y pausas por visibilidad o movimiento reducido.
Pasaron seis pruebas y dos recorridos en Edge con agentes simulados. Se corrigió
la inserción de estilos de ojos bajo la CSP sin modificar la política de seguridad.
Los assets suman 24.468 bytes sin comprimir; consumo físico sin medir.
[Instalación, evidencia y límites](docs/blobatar-agentes-20261108.md).

8 de noviembre, implementación autorizada del canal del cliente WhatsApp.
Se añadieron pasarela, revisión, recibos persistentes, simulación vocal y
adaptadores experimentales de UI Automation y audio virtual. Pasaron 26 pruebas
nuevas, 34 regresiones unitarias y recorridos de panel y controles nativos
propios. El modo inicial es simulación, con llamadas reales deshabilitadas.
El usuario reserva las llamadas públicas y la conexión real de Meta para otra
fase. Cuenta, controles reales, dispositivos y compatibilidad del número API
siguen por verificar. Se conserva la arquitectura Meta/WhatsApp y Netelip.
[Entrega y evidencias](docs/melodi-whatsapp-cliente-implementacion-20261108.md).

8 de noviembre, arquitectura definida por el usuario: Meta/WhatsApp Business
para llamadas de WhatsApp y Netelip para telefonía convencional entrante y
saliente. Se estudia una tercera vía de salida mediante el cliente oficial de
WhatsApp y audio virtual, aprovechando sus llamadas normales por Internet.
Es un candidato para prototipo, sin automatización ni compatibilidad de cuenta
comprobadas. El requisito de permiso de las salientes por API se mantiene.
No se migra el número ni se hacen llamadas reales en esta fase.
[Alternativa investigada y límites](docs/melodi-whatsapp-cliente-alternativa-20261108.md).

8 de noviembre, auditoría posterior al cierre de WorkSpace. Doce turnos de
agenda en los dos formatos telefónicos no despacharon herramientas: consultar,
agendar, buscar huecos, hacer espacio, reorganizar y desplazar siguen sin
acceso desde la llamada. El usuario reserva las llamadas reales para después.
Ya tiene un número de WhatsApp Business registrado directamente en Meta y
prioriza coste mínimo sin pedir permiso técnico a cada destinatario. WhatsApp
saliente conserva su requisito de permiso; estudiar Meta directa y mantener
SIP como alternativa para ese criterio. No se habilitan llamadas ni pagos.
[Auditoría, pruebas y alternativas](docs/melodi-agenda-whatsapp-auditoria-20261108.md).

8 de noviembre, cierre de esta entrega por indicación del usuario.
El [catálogo de funciones](CATALOGO_FUNCIONES.md) enumera las implementaciones
y marca las revisiones pendientes. La conversación telefónica pública,
las pruebas con dispositivos físicos y las demás limitaciones quedan
registradas para los recorridos posteriores solicitados.

7 de noviembre, prioridad corregida por el usuario: detener las otras funciones
de Brivany hasta que Melodi pueda mantener llamadas correctamente y con rapidez
comparable a Live. Twitch/YouTube no son relevantes para este hito. La vía elegida
es SIP con Netelip, conservando Muse, Meta y la voz Cartesia. El objetivo amplio
de WorkSpace permanece en pausa; no se activan pagos sin decisión del usuario.

7 de noviembre, continuación de telefonía: el usuario mantiene las entrantes
en su móvil y aplaza validar su identificador de salida. Se requiere aviso y
autorización antes de una llamada real que muestre su número. Panel, SIP y voz
Live están conectados en código y probados localmente con IA sustituida; quedan
pendientes la activación de la cuenta y la conversación telefónica real.
[Estado y evidencias](docs/melodi-sip-netelip-20261107.md#integración-posterior-panel-y-voz-live).

7 de noviembre, activación posterior: el perfil SIP se guardó con DPAPI tras
autorización del usuario y Netelip aceptó su registro con estado 200, sin
marcar. Se recuperó la configuración de voz Meta/Cartesia del respaldo y el
puente local detectó la salida habilitada. No se ha comprobado una conversación
PSTN ni la latencia pública. Se mantiene pendiente el identificador propio y
el aviso al usuario antes de cualquier prueba que muestre su número.
[Activación y límites](docs/melodi-sip-netelip-20261107.md#guardado-autorizado-y-registro-real-del-perfil).

7 de noviembre, corrección posterior: llamadas SIP sin registrar previamente
cada destinatario. El número se indica en el encargo y se confirma; el perfil
anterior se conserva sin volver a pedir credenciales. Dos intentos públicos
terminaron con rechazo 603 antes de respuesta confirmada. Se corrigió el inicio
de voz durante medios tempranos. Saldo observado US$0,02 y tarifa móvil
US$0,0959/min; se consultó al usuario la recarga mínima de US$5, sin efectuarla.
La conversación telefónica correcta y su rapidez siguen sin comprobarse.
[Intentos y correcciones](docs/melodi-sip-netelip-20261107.md#destinos-sin-registro-previo-y-primeros-intentos-reales).

7 de noviembre, recarga posterior: el usuario informó que pagó. Netelip muestra
la operación PayPal pendiente de revisión y mantiene US$0,02 disponibles.
Se espera su aprobación antes de repetir la llamada; no se hizo un pago nuevo.
[Estado de recarga](docs/melodi-sip-netelip-20261107.md#recarga-del-usuario-pendiente-de-revisión).

7 de noviembre, el usuario reactivó el objetivo de WorkSpace mientras se
aprueba el saldo. Pidió conservar los ajustes al cerrar Brivany. Se guardan
en disco las preferencias de interfaz, voz, grabación, traducción y clima.
Las carpetas elegidas se recuerdan y pueden quitarse en Ajustes. Edge comprobó
la restauración desde un perfil vacío y otro servidor local. Se añadieron
transiciones breves al cambiar de herramienta y se comprobó el movimiento
reducido. La prueba telefónica sigue pendiente de saldo disponible.
[Ajustes y comprobaciones](docs/workspace-diseno-y-recursos-20261107.md#persistencia-de-ajustes-y-cambio-de-herramienta).

7 de noviembre, continuación de WorkSpace. Se restauró fuera de GitHub el
árbol del ZIP original, separado de la copia activa y del histórico de videos.
WebView2 verificó el panel compacto y se eliminó el sondeo de puntero con la
barra cerrada. El panel Glisse volvió a ocupar su región completa y la
regresión nativa pasó con servicios sustituidos. El objetivo sigue activo.
[Medición nativa](docs/workspace-arranque-recursos-20261107.md#medición-nativa-de-la-barra-y-el-panel).

7 de noviembre, continuación de Archivos. Preguntar prepara extractos de
Office y PDF con texto, y Correo guarda un EML con el adjunto original. Se
conservaron el compositor editable, la distribución compacta y la revisión del
usuario. WebView2 probó ambos recorridos con documentos sintéticos. OCR y
apertura en el cliente personal quedan pendientes.
[Alcance y evidencias](docs/workspace-bandeja-archivos-20261107.md#extractos-de-office-y-pdf-y-correo-con-adjunto).

7 de noviembre, idioma de WorkSpace. El español y el inglés se pueden elegir
en Ajustes y se conservan en disco de forma independiente a la escucha de
Melodi. Edge y WebView2 comprobaron actualización en vivo, estado y reapertura.
Quedan idiomas, ventanas auxiliares y estados por localizar.
[Alcance y pruebas](docs/workspace-diseno-y-recursos-20261107.md#idioma-de-workspace).

8 de noviembre, WorkSpace incorpora francés y portugués de Brasil. Se carga
solo el catálogo elegido y se preservan los formularios al cambiar de idioma.
La apertura nativa y los cambios rápidos pasaron con documentos y servicios
de prueba. Quedan otros idiomas, revisión lingüística y ventanas auxiliares.
[Ampliación y evidencia](docs/workspace-diseno-y-recursos-20261107.md#francés-y-portugués-de-brasil).

7 de noviembre, nueva prioridad del usuario: incorporar funciones e interacciones
de tres videos de referencia a WorkSpace, conservar la distribución de Brivany
y reducir CPU, memoria y actividad en segundo plano. El objetivo permanece activo;
no se marcan como listas las funciones móviles, de sistema o de juegos pendientes.
[Objetivo, referencias y matriz de alcance](OBJETIVO_WORKSPACE.md).

7 de noviembre, Melodi prepara llamadas telefónicas con revisión local y buzón
de voz. La pasarela y el panel se prueban con telefonía y modelos sustituidos.
La primera llamada gratuita depende de verificar el destino en la consola de
prueba. [Implementación y conexión](docs/melodi-telefonia-20261107.md).

4 de noviembre, continuación. Traducción 0.4.4 conserva una sola selección
y recupera la reproducción del video cuando una intervención tarda demasiado.
[Alcance y comprobaciones](docs/traduccion-auditiva-recuperacion-044.md).

4 de noviembre, continuación. Traducción 0.4.3 sincroniza imagen y voz dentro
de la pestaña de Brave. Se prueban voces diferenciadas, reproducción natural y
cierre al final. Siguen abiertos el tiempo de espera en intervenciones largas
y la comprobación de voces en todos los tramos del video de referencia.
[Cambios y evidencia](docs/traduccion-auditiva-en-pestana-043.md).

4 de noviembre, continuación. Traducción 0.4.2 arranca la extensión desde
WorkSpace en la pestaña autorizada. La transcripción sigue alimentando el
doblaje con texto visible configurable. Se prueban ritmo de recepción, capacidad
de entrada a Muse y traducción audible en WinMM durante un ensayo de 42 s.
[Implementación y pruebas](docs/traduccion-auditiva-workspace-042.md).

4 de noviembre, corrección posterior: traducción 0.4.1 con ACK de recepción
nativa y protocolo negociado; corrige rechazo de bloques acumulados tras pausas
de lectura. Ensayo completo con Brave aislado, APIs reales y consumo de audio
WinMM comprobado; YouTube personal y escucha física siguen sin certificar.
[Corrección y evidencia](docs/traduccion-auditiva-acuse-nativo.md).

4 de noviembre, continuación: extensión 0.4.0 inicia transcripción progresiva
y traducción juntas con ASR compartido; corrige ACK anticipado y ráfagas.
Prueba real propia: primer audio nativo a 5,688 s antes del fin del productor.
No certifica fidelidad completa ni escucha de YouTube personal.
[Cambios y evidencia](docs/traduccion-progresiva-video.md).

4 de noviembre: extensión 0.3.0 con pin por video y selección automática de
YouTube único visible. Transcripción silenciosa sin ventana nueva, conexión
de Origin fijo y audio separado para WorkSpace. Pruebas locales/Brave aislado;
perfil personal pendiente de recargar tras detenerse el control por URL no
verificable. [Alcance](docs/videos-seleccionados-y-transcripcion-silenciosa.md).

3 de noviembre, continuación: extensión Brave 0.2.0 con lectura autorizada de
subtítulos disponibles, MT anticipada acotada y reutilización sólo tras confirmar
la frase en ASR. Separación y clones siguen basándose en audio real. Carga y
pistas nativas probadas en Brave aislado; perfil personal y latencia real nueva
sin certificar. [Alcance y pruebas](docs/brave-traduccion-anticipada.md).

3 de noviembre, continuación de traducción: filtro local de canciones y agentes
en segundo plano para muestras limpias/asociación y clonación autorizada, caché
por sesión y cambio de voz en frases posteriores. Protocolos y cancelación
probados con sustitutos; filtro con cinco muestras controladas reales. Fidelidad
de una clonación personal real pendiente. [Alcance y evidencia](docs/traduccion-canciones-y-voces-temporales.md).

3 de noviembre: consultas web breves por una sola llamada Meta; citas ocultas
y procedencia disponible bajo petición. Recorrido real de aproximadamente
5–6 s, con variación del proveedor. [Evidencia y límites](docs/melodi-busqueda-rapida-y-procedencia.md).

1 de noviembre, continuidad audible y hablantes comprobados con APIs reales y confirmación del usuario. Siguiente petición: preproducción de cinco segundos y extensión con búfer A/V de cuatro segundos para sincronizar imagen y traducción. No equivale a sincronía ya probada. [Evidencias](docs/workspace-traduccion-continuidad.md).

1 de noviembre, corrección posterior de traducción WorkSpace: plazos nativos
sin ráfagas tras pausa y validación de llegada independiente del procesamiento.
Ensayos locales de 35 s con demoras provocadas y captura WASAPI; se mantienen
cola y límites. [Evidencia](docs/workspace-ritmo-traduccion.md).

1 de noviembre, siguiente prioridad: Traducción auditiva inicia directamente
desde WorkSpace, sin navegar al módulo. Captura de salida, inglés/Auto inicial,
voces por turno y original de fondo al 12 %, con ruta separada probada en el
Windows/FxSound de este equipo. Ensayo real de dos frases españolas y pruebas
de interfaz/nativo distinguidas. Terminal continúa en pausa.
[Implementación y límites](docs/workspace-traduccion-auditiva.md).

1 de noviembre, revisión de WorkSpace: selector de conversación, chat compacto
y visualización Live con el motor existente; reparación de sesión nativa,
sincronización Spotify/móvil y biblioteca, ducking con FxSound y recuperación
protegida de canción/posición. Se distinguen comprobación nativa, pruebas
sustituidas y lecturas reales de cuenta. El objetivo anterior sigue en pausa.
[Implementación y límites](docs/workspace-chat-live-y-spotify.md).

Revisión posterior del 1 de noviembre: el usuario rechaza la primera dirección
visual de motion. Se rehacen ambas familias con cintas 3D/cámara y arquitectura
ensamblada, e incorporan locución por la voz de Melodi ya configurada.
[Revisión y resultados](docs/melodi-motion-con-voz.md).

Nueva petición, 1 de noviembre: se integra Bang Motion como creador local
controlado de animaciones desde chat/Live, con agente y cola independientes.
Dos familias iniciales y dos promociones reales de Brivany en 1080p/30 fps,
proyectos HTML, revisión de fotogramas y latencia medida. Se conserva el
objetivo anterior en pausa. [Alcance, pruebas y entregas](docs/melodi-bang-motion.md).

1 de noviembre, dirección posterior: dos modos en Ajustes, Normal y Acceso
completo, con política real de revisión por archivo. Mover es autónomo en
Acceso completo dentro del alcance autorizado; papelera y sobrescritura siempre
esperan aprobación. UAC y registro conservan sus límites. El usuario pide cerrar
esta entrega y esperar instrucciones; no se certifica autoaprobación UAC.
[Implementación, revisión de Cognira y pruebas](docs/modos-acceso-y-aprobaciones.md).

Actualizado el 29 de octubre de 2026. Este plan sustituye la secuencia de prioridades de `docs/08-plan.md`; la voz de Melodi y human-skills son la base reutilizable.

Dirección de interfaz actualizada el 31 de octubre: Brivany se usa desde su
aplicación de escritorio y Melodi WorkSpace; la edición local de navegador se
retira. La web pública de presentación será un hito posterior. Se conservan los
enlaces legales y retornos OAuth de los servicios vinculados. Identidad
`brivany.`/`b` con punto azul y tipografía Georgia con Segoe UI.
[Implementación y alcance comprobado](docs/escritorio-identidad-y-bandeja.md).

**Dirección vigente, 1 de noviembre:** el usuario dio por cumplido el objetivo
anterior y abrió el [objetivo de terminal de Melodi](OBJETIVO_TERMINAL_MELODI.md).
Incluye comandos Windows/macOS, checklist secuencial revisada y clonación con
ejecución local y evidencia. El registro queda protegido. Este cambio de
prioridad no convierte pruebas simuladas anteriores en comprobaciones reales.
Se conserva el [objetivo integral anterior](OBJETIVO_72_HORAS.md) como histórico.
El usuario precisó después que el catálogo debe centrarse en comandos y atajos
de escritorio de uso cotidiano, más algunos avanzados útiles; se excluyen
autoridades certificadoras, dominios y administración empresarial de servidores.

Posteriormente el usuario acepta como suficiente el alcance de comandos y
prioriza videos (ver, extraer audio y traducir), manuales/controladores y, una
vez comprobados, la web pública de Brivany con interacciones 3D y publicación.
[Dirección, implementación y evidencia](docs/melodi-medios-documentacion-y-web.md).

1 de noviembre, actualización posterior: web oficial de presentación publicada
en `https://brivany.example`, con Georgia/Segoe UI, estudio 3D interactivo,
instrucciones editables y extracción de audio en el navegador. Mantiene las
páginas legales y OAuth. Los conceptos móvil/gafas se distinguen del escritorio
en desarrollo. [Implementación y comprobaciones](docs/web-oficial-interactiva.md).

Reanudación posterior del objetivo de terminal: corregida la detección de
Antigravity IDE y comprobada la apertura y ejecución real de ProjectFixture desde su
depurador mediante Melodi. Conserva origen limpio, espera de salud, protección de
configuración y ausencia de captura del ratón; la app se reinició con WorkSpace.
No certifica 2.000 comandos ni macOS. [Evidencia y límites](docs/terminal-ide-real.md).

**Brivany convierte espacios reales en mundos 3D interactivos donde Melodi ayuda a explorar, diseñar y aprender a usar lo que nos rodea.**

El escritorio incorpora el 30 de octubre un chat minimalista, Ajustes, referencias
visuales y especialistas locales de ordenador, espacial, redacción y consultas,
con colas independientes y revisión de resultados. Voz y human-skills conservan
sus motores. Google admite consultas revisadas, no gestión completa de cuentas;
render fotorrealista, hardware live simultáneo y control macOS/Linux siguen
pendientes. [Alcance comprobado](docs/melodi-chat-imagenes-agentes.md).

La misma adaptación incorpora Cognira Edits por MCP, catálogo de capacidades y
human-skills en el chat live, acompañante nativo Work y esperas persistentes por
hora o finalización de tareas. Las entregas exportación → Drive → WhatsApp
requieren revisar y activar el flujo. MCP/exportación y ventanas Work tienen
ensayos nativos aislados; audio físico y entregas de cuentas reales siguen
pendientes. [Implementación y límites](docs/melodi-edits-work-eventos.md).

El usuario priorizó después [Mini Melodi](docs/mini-melodi-isla.md): superficie
nativa de Work centrada arriba, con proximidad, cierre tolerante, miradas breves y
transparencia. La extensión de navegador y el nuevo trabajo oculto de dibujo y
Office quedan pendientes; esta entrega no los marca como terminados.

Su evolución vigente es [Melodi WorkSpace](docs/melodi-workspace.md): barra de
ancho completo que reserva espacio del escritorio Windows y panel independiente
que se superpone al desplegarse. La reserva y su liberación se comprobaron con
ventanas nativas propias maximizadas; otros sistemas siguen sin esa comprobación.

La revisión visual vigente es [WorkSpace premium](docs/melodi-workspace-premium.md):
negro opaco, herramientas horizontales, despliegue junto al cursor, ojos móviles
con reposo y Spotify Connect mediante PKCE. La reproducción y letras locales se
probaron con sustitutos; la cuenta Spotify real requiere vinculación del usuario.

El 31 de octubre evoluciona a [WorkSpace compacto](docs/melodi-workspace-compacto.md):
ojos centrales separados de herramientas de texto, paneles pequeños, curvas
completas y apertura con intención. Se preparó `brivany.example` con una página
temporal; la web oficial será otro hito. El registro de Spotify y su Client ID
público siguen pendientes del usuario/editor para habilitar la vinculación real.

Actualización: el usuario registró la app Spotify y proporcionó su Client ID
público. Se desplegó el [retorno HTTPS](docs/spotify-retorno-https.md) en el dominio,
con puente temporal y tokens en el escritorio. Se corrigió la validación de
certificados del transporte nativo. La vinculación de la cuenta se confirma
después de que el usuario autorice de nuevo; los ensayos del puente no la simulan
como realizada.

La primera demostración objetivo es una habitación capturada con un móvil: recorrerla, seleccionar hasta tres objetos, moverlos con colisiones y pedir a Melodi una explicación o una skill vinculada a un objeto y a sus fuentes. La fidelidad visual, la precisión de medidas y la física se evaluarán por separado. El producto comienza en web para Windows, macOS, iPhone y Android; Meta Glasses y robótica se incorporan tras validar las capacidades necesarias.

`[x]` significa implementado o documentado y comprobado dentro del alcance indicado. `[ ]` significa pendiente. Los hitos expresan dependencias, sin fechas de entrega ni créditos del evento asumidos.

## Secuencia y comienzo del frontend

| Hito | Entrega | Puerta para avanzar |
|---|---|---|
| S0 | Alcance y selección técnica | Roles, licencias y límites identificados |
| S1 | Paquete de captura trazable | Video → fotogramas, manifiesto y plan sin inferencia |
| S2 | Infraestructura Modal y diseño de experiencia | Acceso a pesos, presupuesto y trabajo cancelable; wireframes del nuevo frontend |
| S3 | Un objeto reconstruido y primer visor | Artefacto 3D válido con procedencia; visor funcional sobre el contrato de escena |
| S4 | Reconstrucción de habitación | Geometría y cámaras consistentes; revisión de cobertura y escala |
| S5 | Experiencia espacial integrada | Captura, trabajos, visor, edición y Melodi usables en escritorio y móvil |
| S6 | Interacciones físicas | Colisiones y parámetros explícitos, escala comprobada y simulación estable |
| S7 | Objetos, manuales y human-skills | Identidad verificable y ayuda respaldada por fuentes |
| S8 | Herramientas inmobiliarias y operación | Presentación compartible, permisos, conservación y costes controlados |
| S9 | Traducción de video en vivo y nuevas superficies | Flujo incremental medido; adaptadores de gafas y robótica evaluados por separado |
| S10 | Demo y validación final | Recorrido reproducible con evidencia de utilidad, límites, latencia y consumo |

**El diseño del nuevo frontend comienza en S2**, en paralelo a la preparación de Modal. **La implementación del visor empieza en S3** al disponer de un contrato y un artefacto válidos; podrá usar una escena de prueba identificada mientras se conecta la reconstrucción. La integración completa de captura y edición llega en S5. La bitácora local se implementa desde ahora como herramienta de seguimiento, sin esperar al visor.

## S0 · Dirección y decisiones

- [x] Priorizar inmobiliarias y arquitectos, conservando voz y human-skills.
- [x] Definir reconstrucción visual, objetos editables y simulación como componentes distintos.
- [x] Revisar candidatos Meta: SAM 3.1 para máscaras, SAM 3D Objects para objetos y VGGT-1B-Commercial para geometría multivista.
- [x] Identificar restricciones de licencia y distinguir pesos comerciales de variantes de investigación.
- [x] Reservar Spaik Iris como proyecto pendiente con arquitectura por aportar por el usuario.
- [ ] Confirmar condiciones, fecha de entrega y criterios del hackatón en su fuente oficial.
- [ ] Solicitar y confirmar créditos Modal y el saldo utilizable; fijar presupuesto monetario por trabajo y total.
- [ ] Elegir una habitación y tres objetos de la primera demo, además del móvil disponible.

## S1 · Primera tarea: captura y contrato espacial

- [x] Crear contratos estrictos para captura, plan de reconstrucción y escena.
- [x] Registrar hashes SHA-256 de video y fotogramas, tiempos de muestreo solicitado y dimensiones.
- [x] Preparar MP4 de hasta 60 s y 25 MiB, con 2–8 fotogramas JPEG y lado máximo de 1280 px.
- [x] Generar manifiesto, preflight, plan declarativo para Modal y ZIP sin el video original.
- [x] Distinguir referencia de longitud declarada de geometría métrica verificada.
- [x] Registrar duplicados exactos y dejar revisión de calidad y cobertura pendiente.
- [x] Validar referencias entre objetos, artefactos, fotogramas y propiedades físicas.
- [x] Comprobar contratos y empaquetado con pruebas locales y decodificación FFmpeg de una muestra sintética de nueve segundos.
- [ ] Ensayar una captura real de habitación; la muestra sintética solo comprueba preparación del paquete.
- [x] Añadir señales locales de luminancia, exposición, nitidez orientativa y cambio de píxeles; conservar duplicados y revisión pendiente. Comprobado con imágenes y video sintéticos.
- [x] Resolver seek vacío en clips de un fotograma con un único fallback local explícito, registrando sus límites; no verifica timestamps reales ni cobertura.
- [ ] Seleccionar vistas por solapamiento geométrico, movimiento de cámara, cobertura y orientación; las señales actuales no certifican captura suficiente.
- [x] Añadir captura optativa solo de video desde la cámara, vista previa, límites y parada/liberación de tracks; MP4 según soporte del navegador. Recorrido comprobado con cámara y grabador sustituidos, sin hardware real.
- [x] Añadir vista inmersiva tipo gafas, temporizador, estados y guía textual; probada con captura sustituida. No mide cobertura ni conecta Meta Glasses.
- [ ] Validar captura guiada en móviles físicos e incorporar evaluación de cobertura, profundidad y calibración del dispositivo cuando existan.

La tarea implementada está en [contratos](contracts/spatial.py), [preparación](services/spatial/capture.py) y [CLI](tools/prepare_spatial_capture.py). El estado producido es `prepared_not_reconstructed`: no existe aún una escena reconstruida ni un worker GPU desplegado. La interfaz de Espacios ya permite preparar el paquete y revisar sus seis fotogramas localmente.

## S2 · Modal, almacenamiento y diseño

- [ ] Configurar cuenta, SDK autenticado y secretos de Modal; acceder a checkpoints y aceptar licencias. Separado para el usuario en [accesos pendientes](docs/30-accesos-pendientes.md).
- [x] Fijar versión/hash del SDK y commits/hashes de fuentes de modelos en un lock, sin descargar pesos.
- [ ] Completar hashes de checkpoints, digest de imagen y lock de dependencias CUDA, y comprobar el build real.
- [x] Preparar factory Modal y runner específico SAM3D con dispatch desactivado; L40S candidata, entradas revisadas y GLB acotado. No construido ni desplegado.
- [x] Separar campos de verificación de pesos/proceso, descarga y arranque; los tiempos no observados y la factura quedan desconocidos.
- [x] Declarar mínimos cero, máximo uno, buffer cero y retries de aplicación cero en el factory; aplicación real pendiente de despliegue. No garantiza ausencia de rescheduling del proveedor.
- [x] Implementar cola local de un worker con estados persistentes, progreso, cancelación cooperativa, timeout, recuperación y limpieza; sin reintentos.
- [x] Implementar presupuesto/reservas atómicas locales, límites, conciliación y bloqueo de consumo desconocido. Configuración sin tarifa/saldo inventados y sin habilitar dispatch remoto.
- [ ] Conectar reserva, autorización, idempotencia y cancelación remotas al ejecutar el primer trabajo Modal y medir consumo real.
- [x] Conectar paquete revisado, identidad persistente y presupuesto en un orquestador local probado con transporte sustituto; conservar consumo desconocido y cancelación cooperativa entre instancias sin replay.
- [x] Implementar adaptador SDK Modal y conectarlo al CLI con `--provider modal --execute`, identidad durable, cancelación de la misma llamada y consumo desconocido. Comprobado con SDK sustituido.
- [ ] Validar el adaptador contra una función Modal desplegada con pesos, licencia, build y presupuesto comprobados; la configuración distribuida sigue cerrada.
- [x] Crear caché local verificada por hashes/versión y claves de caché del worker por entrada, parámetros y versión. El volumen real de pesos sigue pendiente.
- [x] Guardar artefactos privados locales con enlaces firmados de 15 minutos; eliminar video temporal tras preparación/cancelación. Las capturas preparadas permanecen locales; retención y borrado remotos pendientes.
- [x] Diseñar e implementar biblioteca, entrada de captura, revisión de fotogramas, estado de trabajo y visor.
- [x] Mantener blanco, negro, grises y azul; escena dominante y detalle progresivo.

El contrato declara seis fotogramas, hasta tres objetos y 180 segundos GPU para la primera prueba propuesta. El runtime preparado limita el proceso y el factory declara ese timeout, **sin ejecución GPU que lo valide y sin promesa de coste total**. Imagen, pesos y presupuesto incompletos bloquean la ejecución remota. La primera inferencia real se limitará a un solo objeto para resolver compatibilidad, salida y coste. [Infraestructura](docs/31-infraestructura-y-visor.md).

## S3 · Un objeto y primer visor

- [x] Implementar selección manual de hasta tres objetos, etiquetas corregibles, máscara rectangular binaria, revisión explícita y hashes del fotograma/máscara. No ejecuta segmentación Meta.
- [x] Preparar entrada local de un objeto como PNG, máscara y procedencia; no es dispatch ni reconstrucción.
- [ ] Seleccionar y revisar un objeto real de la captura del usuario; evaluar si la máscara manual basta o necesita segmentación precisa.
- [ ] Ejecutar una reconstrucción acotada SAM 3D Objects en Modal.
- [ ] Registrar parámetros, versión, duración, consumo y errores sin reintentos invisibles.
- [ ] Convertir la salida a un artefacto admitido por el visor; comprobar orientación, transformaciones, texturas y hash.
- [x] Publicar un resultado completo con recibos/captura/GLB revalidados en biblioteca editable, sin nuevo dispatch y conservando cambios al reimportar; probado con SDK sustituido y GLB generado. Reconstrucción real y fidelidad pendientes.
- [ ] Distinguir superficies observadas y reconstruidas por inferencia, incluyendo partes ocultas.
- [x] Implementar visor GLB local: orbitar, acercar, desplazar cámara, seleccionar, inspeccionar, enfocar y restablecer vista; comprobado con geometría procedural identificada.
- [x] Presentar procedencia generada, limitaciones y escala no verificada junto a los objetos; falta recibir resultados inferidos reales.
- [ ] Comparar el resultado con imágenes originales antes de reconstruir más objetos.

## S4 · Habitación y composición de escena

- [x] Preparar runner multivista comercial y retroproyección/triangulación/GLB con huecos explícitos; catorce pruebas numéricas y render sintético, sin checkpoint/GPU reales.
- [x] Conectar recibos multivista a biblioteca/visor, cámaras estimadas, revisión de fotogramas y proyecto portátil con manifiesto exacto; validado con SDK/modelo sustituidos, sin reconstrucción real. [Hito41](docs/41-ingreso-multivista-y-portabilidad.md).
- [ ] Estimar cámaras, profundidad y correspondencias con el checkpoint comercial seleccionado.
- [ ] Alinear vistas, revisar errores de reproyección y refinar cuando la evidencia lo justifique.
- [ ] Crear fondo visual del cuarto y geometría de suelo, paredes y aperturas necesarias.
- [ ] Separar instancias de objetos y evitar duplicarlos en el fondo al moverlos.
- [ ] Representar huecos y zonas inferidas; permitir revisar o recapturar áreas insuficientes.
- [ ] Comprobar escala con longitudes medidas y registrar error, método y persona o sensor que la verificó.
- [ ] Definir límites de polígonos, texturas y representación visual según dispositivo.
- [ ] Guardar versiones del espacio y asociación con las capturas que las originaron.

## S5 · Aplicación espacial

- [x] Construir biblioteca local, entrada desde archivo MP4 y captura de cámara optativa según soporte MP4, responsive. Guía por cobertura y validación de móvil físico siguen pendientes.
- [x] Añadir revisión local de captura, selección rectangular de objetos y referencia de longitud declarada; escala sin verificar.
- [x] Mostrar progreso, cancelación y estados de preparación local; recuperación de trabajo interrumpido sin reintentar.
- [x] Integrar edición de la demo: seleccionar, mover/girar con ejes o posición numérica, persistir con revisión y restaurar distribución.
- [x] Añadir deshacer/rehacer persistente de hasta cien estados, revisión monotónica y restauración deshacible; comprobado en escena procedural.
- [ ] Integrar una habitación reconstruida real con el historial y la edición.
- [x] Conectar texto/voz existente al contexto de escena/objeto del servidor y comandos locales, con movimiento revisado y Deshacer; probado con Meta/Muse/TTS sustituidos, voz física y carpetas portátiles pendientes.
- [ ] Diseñar confirmaciones solo para acciones que realmente lo requieran, como borrar un espacio.
- [x] Añadir controles del visor por ratón/táctiles, teclado, foco visible y lista/inspector textual sin activar voz. Prueba de dispositivos físicos pendiente.
- [x] Acotar cargas GLB, evitar render redundante en reposo y recuperar la escena guardada tras un evento simulado de pérdida de contexto, desactivando antes la manipulación.
- [x] Mostrar GLB progresivamente con hash, límites por bloques, cancelación y progreso; pruebas locales con geometría generada, sin medición de GPU física. [Hito43](docs/43-carga-progresiva-del-visor.md).
- [ ] Medir memoria GPU, carga progresiva, rendimiento y pérdida real de contexto gráfico en equipos modestos y dispositivos físicos.
- [ ] Verificar el flujo en Windows, macOS, iPhone y Android; registrar soporte real por navegador.
- [x] Actualizar la web de presentación con el visor procedural identificado, sus funciones locales y la reconstrucción remota pendiente.

## S6 · Física e interacción

- [x] Integrar Rapier local con gravedad, cajas de colisión, pausa, caída y restauración en una previsualización experimental; escala y materiales asumidos, sin acreditar fidelidad física.
- [ ] Construir colliders simplificados separados de la representación visual; un splat no es una malla de colisión.
- [ ] Habilitar dinámica solo con escala métrica comprobada y masa declarada.
- [ ] Etiquetar masa, fricción, elasticidad e inercia como desconocidas, asumidas o medidas según corresponda.
- [ ] Añadir gravedad, suelo, contactos y límites de manipulación; comprobar estabilidad y penetraciones.
- [ ] Incorporar articulaciones de puertas o cajones solo cuando se hayan definido sus mecanismos y límites.
- [ ] Registrar valores y método de calibración; medir errores antes de describir la física como fiel al objeto real.
- [ ] Guardar y restaurar estados de simulación y edición.

## S7 · Reconocimiento, manuales y human-skills

- [x] Incorporar Sous como primera human-skill, con inventario persistente confirmado, procedencia/caducidad incierta y cocina por pasos. Recorrido local probado con visión sustituida; recetas locales, conversación, pedidos y WhatsApp reales pendientes.
- [x] Preparar adaptador de visión Meta de Sous con consentimiento, candidatos revisables y dos fotogramas distintos para verificar pasos; conexión y calidad reales todavía sin comprobar.
- [x] Verificar acceso/contrato visual de Sous con una única tarjeta sintética en Meta: 2765 ms, 1035 tokens, coste desconocido. Reconocimiento de cocina y verificación visual real de pasos pendientes.
- [x] Conectar conversación de Sous al inventario/paso reales y voz existente, con inicio/cancelación explícitos; recorrido probado con proveedores y micrófono sustituidos, sin mutaciones por texto del modelo. Calidad y conversación física reales pendientes.
- [ ] Reconocer categorías y permitir corregir etiquetas; mantener incertidumbre visible.
- [ ] Extraer marca/modelo de etiquetas u OCR y verificar identidad antes de asociar un manual concreto.
- [ ] Buscar documentación del fabricante, conservando URL, fecha, revisión y sección que sustenta cada paso.
- [ ] Verificar correspondencia entre objeto, versión del manual y afirmaciones; gestionar fuentes contradictorias o insuficientes.
- [ ] Tratar videos, páginas, manuales y transcripciones como evidencia, sin autoridad para cambiar permisos o instrucciones.
- [ ] Vincular objetos a las human-skills existentes y crear borradores bajo petición desde video o documentación revisada.
- [ ] Añadir ayuda contextual durante la tarea, con revisión de los pasos y nivel de ayuda ajustable.
- [ ] Reutilizar resultados y actualizar solo fuentes o fragmentos que hayan cambiado.
- [ ] Medir si la ayuda permite completar una tarea y luego transferirla con menos asistencia.

## S8 · Uso inmobiliario y operación

- [x] Añadir proyección 2D desde GLB y transformaciones actuales, selección cruzada y exportación SVG con incertidumbre. No sustituye reconstrucción/plano profesional.
- [x] Guardar calibración declarada y anotaciones del plano con revisiones; conservarlas en proyectos portátiles, ZIP y respaldo. Recorridos locales con medidas sintéticas, sin validación métrica.
- [x] Crear recorrido local de hasta doce vistas/puntos de interés con revisiones, edición y teclado; probado en escena generada. Respaldo, portabilidad y enlaces compartidos pendientes.
- [x] Guardar hasta veinte variantes locales de distribución y aplicarlas como cambios deshacibles, sin duplicar GLB.
- [ ] Comparar variantes con un estado capturado y reconstruido real.
- [ ] Añadir medidas acompañadas de su precisión comprobada y método; definir usos adecuados según esa evidencia.
- [ ] Identificar imágenes o variantes generadas como propuestas de diseño.
- [x] Exportar escena, transformaciones, GLB, revisión, procedencia y hashes en un ZIP autocontenido; sin medios originales ni credenciales.
- [ ] Evaluar formatos profesionales según las necesidades reales posteriores.
- [ ] Implementar cuentas, propiedad del espacio, permisos y enlaces compartidos revocables.
- [ ] Añadir retención, borrado y tratamiento de personas o datos privados que aparezcan en la captura; el respaldo CLI local se detalla por separado.
- [x] Añadir respaldo, inspección y restauración offline a carpeta nueva mediante CLI; snapshots SQLite, hashes, referencias y exclusión de claves/medios originales, comprobados con fixtures temporales.
- [ ] Integrar recuperación en la interfaz, selección de una instalación restaurada, retención y borrado de datos privados; no basta el respaldo CLI para completar la operación multiusuario.
- [ ] Instrumentar costes, tiempos por fase, errores y disponibilidad sin guardar secretos en la bitácora.
- [x] Crear bitácora local de actividades, implementaciones y pruebas con copias de evidencia, hashes y registro automático de suites locales. [Uso y límites](docs/17-bitacora.md).

## S9 · Traducción en vivo, Meta Glasses y robótica

- [x] Incorporar YouTube oficial y campo de enlaces, captura de audio en vivo de la pestaña propia, escucha separada y selección EN/ES/FR con Palabra. Iframe real disponible; recorrido de traducción probado con proveedores/captura sustituidos. Audio real, calidad y 500 ms pendientes. [Hito44](docs/44-youtube-live-con-palabra.md).

- [x] Implementar primera ruta de voz a voz: video local → PCM → API dedicada → subtítulos y audio, con límite de sesión, cancelación y prueba simulada.
- [x] Añadir configuración local de clave independiente de Meta y ensayo real acotado preparado; objetivo ≤500 ms visible como no verificado.
- [x] Definir primera fuente: MP4 local; Palabra ES↔EN y ruta Meta modular inicial EN→ES.
- [x] Conectar Muse incremental → cláusulas estables → M2M100 Meta → subtítulos provisionales/finales y correcciones por segmento.
- [x] Preparar candidato nativo Google Gemini Live Translate con credencial separada, sin usarlo automáticamente al abrir la página.
- [x] Conectar OpenAI Translate al selector, formulario privado y relay con frames de 200 ms, salida acotada y prueba integral simulada. [Acceso real pendiente](docs/28-openai-traduccion-continua.md).
- [ ] Configurar acceso API a un siguiente motor de emisión continua y medir una sesión real de dos frases; OpenAI no tenía clave local al comprobarse.
- [x] Guardar la clave Google y comprobar acceso con una única muestra real: primer audio a 3171 ms.
- [x] Corregir la espera de fin de Gemini con cierre local acotado; ensayo funcional con primer PCM a 3390 ms. No confirma flush del proveedor.
- [ ] Validar integralidad, calidad y retraso respecto al contenido; el usuario precisó un máximo de **500 ms de retraso audible**, aún sin verificar.
- [x] Detectar final de frase omitido en la muestra sintética y probar 2 s de silencio final optativo; la comparación textual concreta conserva «dos ventanas». [Evidencia](docs/25-integridad-del-doblaje.md).
- [ ] Añadir alineación temporal semántica de subtítulos y voz con el video y validarla en contenido hablado.
- [x] Añadir voz traducida opcional, volumen original independiente y cola de audio acotada.
- [x] Gestionar pausa, búsqueda, cambio de idioma y cancelación sin publicar resultados de una sesión anterior; reinicio explícito, sin reconexión automática.
- [x] Añadir medición de energía de ambas voces en el mismo reloj, distinguir silencio final y verificar una sesión real de interfaz con Palabra: 2579 ms de inicio a inicio y 1099 ms desde fin de energía original; estimaciones, sin loopback físico. [Evidencia](docs/26-retraso-audible.md).
- [x] Correlacionar partes de Palabra con sus marcas de entrada y energía PCM, señalar cobertura parcial y ensayar dos frases sintéticas con pausa de 260 ms. La voz comenzó tras el final del habla; 1 de 2 partes correlacionadas y máximo estimado observado de 3583 ms. [Método y límites](docs/27-doblaje-por-fragmentos.md).
- [x] Preparar revisión optativa con PCM y traza de las fixtures sintéticas aprobadas, preflight de origen y pruebas de conservación/rechazo sin repetir proveedor. [Evidencia](docs/29-revision-audio-sintetico.md).
- [ ] Completar medición de salida con alcance adecuado y revisión del contenido correspondiente; el host actual no acredita loopback aislado y guardarlo como WAV no equivale a medir sonido al oído.
- [ ] Medir retraso del subtítulo y de la voz por fragmentos correspondientes, precisión y estabilidad; lograr y verificar el objetivo audible de 500 ms.
- [ ] Controlar coste por minuto, segmentos duplicados y caché; comprobar idiomas y modelos habilitados antes de elegir proveedor.
- [ ] Validar capturas y reproducción por navegador; el soporte de audio compartido no se presupone en todos los móviles.
- [ ] Elegir hardware y SDK de Meta Glasses; probar captura, controles y salida en el dispositivo real.
- [ ] Evaluar exportación de escenas a MuJoCo con parámetros, articulaciones y formatos apropiados para un gemelo de simulación.
- [ ] Validar simulación y diferencias respecto al mundo real antes de cualquier conexión a actuadores.

Palabra completó dos muestras sintéticas reales: primer audio a 3110 y 2906 ms.
Meta modular completó otra EN→ES: primer audio a 5937 ms, petición MT de 2907 ms
y TTS hasta primer PCM de 562 ms. Las muestras no constituyen una comparación
controlada. El criterio vigente es 500 ms de retraso audible y sigue **sin verificar**;
el ensayo posterior en navegador excede esa referencia incluso usando el final
de energía original. [Medición vigente](docs/26-retraso-audible.md),
[integración y límites](docs/18-traduccion-video-live.md),
[ruta modular y evidencia](docs/22-traduccion-modular-meta.md). ElevenLabs conserva
su adaptador preparado; crear su clave y comprobar acceso Enterprise siguen
pendientes del control de navegador deshabilitado. Fuentes externas en vivo,
hardware Meta Glasses y robótica son extensiones posteriores.

## S10 · Demo y criterios de entrega

- [ ] Reproducir captura → reconstrucción → revisión → interacción → ayuda de Melodi con un espacio real.
- [ ] Documentar cobertura, fidelidad comparada, error de escala, fallos de colisión y límites conocidos.
- [ ] Medir tiempo total, arranque en frío, inferencia, descarga, carga del visor y respuesta de ayuda.
- [ ] Conservar consumo y presupuesto real de la muestra; repetir pruebas pagadas solo ante una decisión o fallo que lo justifique.
- [ ] Comprobar errores relevantes: captura insuficiente, máscara incorrecta, falta de memoria, timeout y pérdida de conexión.
- [ ] Preparar una escena precalculada como respaldo claramente identificada; distinguirla de la ejecución en vivo.
- [ ] Registrar comandos, resultados y artefactos verificables en la bitácora.
- [ ] Ensayar presentación y entrega según requisitos oficiales confirmados del hackatón.

## Conexiones personales y Sous · Avance integral

- [x] Construir Conexiones con autorización Google de escritorio PKCE, grants separados y tokens cifrados DPAPI Windows; probado con intercambios sustituidos.
- [x] Implementar REST de agenda, borradores/búsqueda Gmail, metadatos Drive y envío revisado al WhatsApp propio; contratos probados sin cuentas reales.
- [x] Implementar receptor WhatsApp aislado con firma, deduplicación, cola acotada y respuesta optativa al chat propio; pruebas locales sin mensajes reales.
- [x] Añadir localidad declarada, tres propuestas curadas y lista de compras persistente a Sous; no autenticidad culinaria verificada ni precios inventados.
- [x] Añadir recordatorios y notas locales persistentes, posponer/completar/cancelar y snapshot de compras Sous; avisos requieren página abierta, entrega WhatsApp y alarma en segundo plano pendientes.
- [x] Añadir borradores sociales, consultas explícitas y revisión exacta para Facebook/Instagram/campañas PAUSED; contratos e interfaz comprobados con Graph sustituido, sin cuentas ni gasto real.
- [ ] Autorizar cuentas reales, configurar cliente Google/número WhatsApp/proxy HTTPS y verificar permisos, renovación y entrega reales.
- [ ] Conectar conversación WhatsApp con recordatorios/agenda/correo/Drive y control autorizado del equipo; no basta el transporte de texto.
- [ ] Conectar Instagram/Facebook, revisión/publicación y anuncios con presupuesto y permisos reales.
- [ ] Completar recetas locales respaldadas por fuentes, pedidos/compras y anotación de Sous en WhatsApp.
- [ ] Validar almacenamiento protegido macOS, OAuth móvil y recorridos de cuentas en dispositivos reales.

Estado y evidencia: [Conexiones, planos y catálogo](docs/36-conexiones-planos-y-catalogo.md) y [resultados 3D, recordatorios y redes](docs/37-resultados-3d-recordatorios-y-redes.md).

## Spaik Iris · Pendiente

- [x] Reservar el nombre y la intención de un modelo propio de generación de imágenes.
- [ ] Recibir y documentar la arquitectura que el usuario tiene en mente.
- [ ] Definir problema, datos y derechos, evaluación, presupuesto y estrategia de entrenamiento después de esa definición.

No se ha diseñado, entrenado ni conectado Spaik Iris. [Nota de alcance](docs/16-spaik-iris-pendiente.md).

## Evidencia y siguiente tarea

**Expresividad y turnos, hito 55:** [Melodi escucha, espera e interactúa](docs/55-melodi-expresiva-y-turnos.md).
Personalidad live cálida, risa nativa y catálogo inicial de chistes con pregunta
y espera. Pausas explícitas sin voz; interrupción automática con AEC confirmado,
pre-roll limitado y contexto conservado durante la interrupción. Protocolos e
interfaz comprobados con sustitutos y una síntesis real aceptada; naturalidad
y comportamiento del micrófono/altavoces reales pendientes de prueba física.

**Ritmo de Melodi, hito 54:** [ritmo 1,05 y respuesta directa al final Muse](docs/54-melodi-ritmo.md).
Control nativo Cartesia, PCM a rate 1 y pausa entre frases de 60 ms. Protocolos
e interfaz probados con sustitutos; una síntesis real aceptó el nuevo parámetro.
No hay comparación controlada de latencia total ni verificación física.

**Inicio vigente de Melodi, hito 53:** [Comenzar activa escucha y respuesta](docs/53-melodi-un-boton.md)
sin casillas ni ajustes previos. El final de Muse ya no espera una segunda pausa
acústica local que podía bloquearse con ruido. AudioContext de salida preparado
en el clic. Una sesión real con fixture sintética reutilizada completó Muse →
Meta → Cartesia y reproducción PCM en navegador: una conversación, una síntesis,
sin reintentos; importe desconocido. Micrófono y altavoz físicos no comprobados.

**Voz vigente de Melodi, hito 52:** [Cartesia en español e inglés con los IDs
indicados por el usuario](docs/52-melodi-cartesia-live.md), integrada en live,
vista previa, Sous y asistente espacial. Inglés admite conversación con idioma
propagado a Meta y TTS. Protocolos/cancelación comprobados localmente con
sustitutos; servidor principal actualizado. La prueba física queda al usuario,
sin síntesis pagada ejecutada en esta entrega.

**Integración vigente en el producto, hito 51:** [web y Desktop comparten la ruta
Muse → Meta Spark → Cartesia](docs/51-traduccion-integrada.md) en `/dubbing`, con
acceso desde portada/Melodi/Espacios y soporte de YouTube y archivo local.
Los motores de traducción anteriores ya no se arrancan. Servidor principal 8765
comprobado; 8767 solo redirige. Recorridos locales con modelos sustituidos;
calidad, captura real de YouTube y audio físico permanecen sin acreditar.

**Traducción vigente, hito 50:** por petición del usuario se eliminaron las cuotas
diarias, duración y fragmentos; [voz explícita y reproducción continua](docs/50-traduccion-continua-y-voces.md)
con pausa de ritmo, selección Daniel/Skylar y continuidad tras cierre HTTP normal.
Comprobación local con modelos/dispositivo sustituidos y relojes acelerados;
catálogo Cartesia real confirmado con dos GET. Voz física y reproducción larga
real siguen pendientes. No se reiniciaron ni borraron las reservas históricas.

**Ruta de traducción vigente desde el hito 49:** se sustituyó Groq por
[Muse Spark de Meta y se reguló la salida de Cartesia](docs/49-meta-cartesia-y-ritmo-de-audio.md).
Muse Voice Transcribe conserva el reconocimiento. La ráfaga de cuatro segundos
se reproduce en pruebas locales con cola de aplicación ≤240 ms y parada
cancelable. Nueva combinación real, calidad y latencia física pendientes;
se conserva un inicio diario al usuario, sin nuevos ensayos pagados.

La ruta anterior [Muse → Groq → Cartesia](docs/48-muse-llama-cartesia.md)
dispone de página local `/translate`, tres controles, streaming por fragmentos y
límites persistentes. Tras un 403 inicial, nueva clave y catálogo comprobados;
el usuario autorizó un modelo vigente al no ofrecerse Llama. Qwen 3.8 sin
razonamiento pasó un único ensayo real de 2,344 s con Muse y Cartesia: primer
audio 3.109 ms, TTS 187 ms. Dos inicios diarios restantes; importe desconocido.
Calidad, captura real de YouTube, eco y latencia física siguen sin acreditarse.

La base incluye voz live, human-skills, Sous, preparación espacial y biblioteca/visor 3D con demostración e interpretación manual del interior. Hay render local con calidad ajustable, física experimental, proyectos portátiles y contenedor Desktop preparado. Hay cola, almacenamiento, caché, presupuesto local y runner/factory Modal preparados. La reconstrucción real, el build CUDA y el despliegue Modal siguen pendientes; la física experimental no acredita parámetros reales. Las pruebas de captura usan videos sintéticos y las del visor GLB modelados; no acreditan una habitación reconstruida.

La continuación local se centra en completar el recorrido Desktop, la integración de Sous y los conectores. Cuando estén disponibles [los accesos](docs/30-accesos-pendientes.md), pesos y presupuesto, se podrá probar un solo objeto real con el worker. El objetivo integral activo incluye voz y traducción, cuyo retraso audible de 500 ms sigue sin verificarse. La [primera entrega](docs/31-infraestructura-y-visor.md) conserva su alcance histórico; el [estado comprobado posterior](docs/34-render-local-sous-y-proyectos.md) distingue lo implementado de las pruebas reales pendientes.

[Revisión y edición implementadas, métodos y límites](docs/32-revision-y-edicion-espacial.md). Las funciones locales adicionales no marcan como terminadas la reconstrucción real, la física, el reconocimiento automático o el soporte de hardware físico.

[Orquestación local, presupuesto y recuperación sin reejecución](docs/33-orquestacion-local.md). El transporte sustituto no prueba el comportamiento de Modal ni el gasto real.

[Voz de Sous, captura tipo gafas, Desktop y adaptador Modal](docs/35-voz-sous-desktop-y-modal.md): arranque/render de ventana Windows comprobados por instrumentación; controles nativos, despliegue GPU, integraciones y mediciones profesionales siguen pendientes.

El ingreso de resultados al visor, los recordatorios/notas locales y borradores sociales están comprobados dentro del alcance de [hito 37](docs/37-resultados-3d-recordatorios-y-redes.md). La siguiente puerta sigue siendo reconstrucción real con pesos/presupuesto, captura y medición profesional, cuentas verificadas y conversación/traducción con calidad y latencia medidas.

El [hito 38](docs/38-multivista-asistencia-y-solicitudes.md) añade preparación multivista, recorridos, Melodi espacial y solicitudes del chat propio para revisión local. Los [tiempos de respuesta y espera acotada](docs/39-tiempo-de-respuesta.md) distinguen medición real histórica, operación local y límites del cliente; no acreditan 500 ms de traducción audible.

## Auditoría de recorridos · 29 de octubre de 2026

[Informe PDF](Brivany_Auditoria_Casos_de_Uso_2026-10-29.pdf) y [hallazgos verificables](docs/40-auditoria-casos-de-uso.md): 610 pruebas Python, 19 suites seleccionadas sin sumarlas como pruebas únicas, seis usos adicionales locales. Corregidos portabilidad del recorrido, allowlist Desktop, estado prematuro de apertura y aislamiento del panel de presentación. Los timeouts de prueba bajo concurrencia gráfica quedan registrados con causa no concluida. Reconstrucción real, medición profesional, cuentas, hardware y traducción audible siguen pendientes.


31 de octubre: reproductor Spotify horizontal, biblioteca paginada y letras
automáticas con LRCLIB y respaldo Lyrics.ovh. Se retiraron la importación local
LRC/TXT y la desconexión de WorkSpace; las cuentas se gestionan en Conexiones.
Permisos de biblioteca desplegados en el puente HTTPS; autorizaciones anteriores
requieren ampliar acceso para biblioteca y conservan reproducción. Se distinguen
pruebas sustituidas, geometría Windows real y proveedores HTTPS anónimos reales:
LRCLIB devolvió 502 y el respaldo respondió 200. No acredita toda la cobertura de
letras ni reproducción física de la cuenta. [Implementación y límites](docs/spotify-biblioteca-letras.md).


31 de octubre: portadas mosaic corregidas, distinción de reproducción actual e
historial, ondas ambientales/degradados de portada y teleprompter de tres filas.
Se eliminan enlaces, controles de letra y paginación visibles. Se incorpora host
nativo aislado del SDK como dispositivo Brivany, con permisos publicados. Windows
real admitió Widevine; registro/audio de la cuenta requieren ampliar autorización
Premium. No se confunden fixtures con reproducción física. [Implementación,
pruebas y límites](docs/spotify-workspace-dispositivo.md).


31 de octubre, hora de La Paz: corregido audio local del SDK mediante host fuera
de pantalla renderizado; usuario confirmó audibilidad. Controles directos,
permanencia de ondas cinco minutos, nuevo personaje, letras con tiempos de
SyncLRC y cola multipista con continuidad. Se retira Recientes y se conserva el
histórico de fallos. La prueba real final pasó anterior/siguiente, progreso,
volumen, aleatorio, repetición y cambio natural de pista sin orden next.
[Implementación, evidencia y límites](docs/spotify-audio-personaje-continuidad.md).


31 de octubre: Melodi musical incorpora audífonos y baile suave/rítmico/animado,
con estimación local de metadatos y letra temporizada, sin captura de audio ni
inferir BPM real. Letras con transiciones de filas y mezcla progresiva de paleta
entre canciones; conserva permanencia de ondas y movimiento reducido.
[Implementación, pruebas y límites](docs/melodi-musica-expresiva.md).

2 de noviembre: traducción con búfer audiovisual, modos Preproducción y
Navegador, relay local y extensión Chromium preparados. La última prueba propia
real preparó en 5,78 s; primera voz a 7,12 s desde clic, por lo que el máximo de
seis segundos solicitado aún no está acreditado. Instalación y captura autorizada
en Brave del usuario pendientes. Emoción consultiva, voces estables por sesión;
sincronía de marcadores ASR no certifica labios. El usuario retiró el objetivo
de terminal; la continuación vigente es traducción.
[Cambios, métodos, consumo y límites](docs/workspace-traduccion-sincronizada.md).

2 de noviembre, dirección iPhone: diseño SwiftUI inspirado en ProjectFixture App,
prioridad voz Live y revisión mediante vista local de iPhone. Prototipo con
historial, módulos y ajustes comprobado en navegador aislado; voz física,
hardware Meta Glasses y traducción iOS no acreditados. Base nativa/gateway en
curso. El usuario pospone el IPA hasta terminar el diseño.
[Estado de esta fase](docs/iphone-diseno-en-curso.md).

2 de noviembre, dirección posterior: cuenta Brivany compartida entre móvil y
ordenador, conexión automática al iniciar sesión y elección explícita si hay
varios equipos. Gateway publicado y host Windows conectados; chat y voz
sintética real ejecutaron consulta en este PC. Vista móvil autenticada y pruebas
de aislamiento/selección pasaron. iPhone nativo sigue sin compilar ni prueba
física; se mantiene la prohibición de generar IPA durante el diseño.
[Implementación y límites](docs/cuenta-brivany-y-control-entre-dispositivos.md).

3 de noviembre, continuación antes de avanzar en iPhone: Melodi orquestadora
con equipos, dependencias, revisión Meta, imagen y búsqueda; prueba real de dos
documentos concurrentes aceptados. WorkSpace incorpora miniagentes completos y
resultados compactos Glisse, scroll vertical sin barras y fondo nativo probado.
Entrada del ordenador sigue serializada entre agentes que comparten foco;
voz física e iPhone nativo no se certifican. No se genera IPA durante el diseño.
[Implementación, consumo, fallos conservados y pruebas](docs/melodi-orquestadora-y-agentes.md).

3 de noviembre, revisión posterior: WorkSpace compacto/adaptable y cierre suave,
presencia de Melodi ligada al trabajo, confirmaciones naturales y aperturas
sencillas sin capturar cursor. Traducción con publicación nativa no bloqueante,
cambio de idioma cancelable y parada inmediata de salida comprobada con PCM
cero. Aprendizaje automático de procedimientos de aplicaciones, con manual e
inspección en paralelo, revisión y recetas locales observadas. Ensayo nativo
propio de facturas/inventario, sin dominio comercial certificado. Letras con
caché concurrente; ausencia de tiempos se distingue de demora de red.
[Cambios y alcance verificado](docs/workspace-fluidez-y-aprendizaje.md).

Corrección del cierre del chat: salir con el cursor no lo oculta. Automático
atiende escritura en otra app en Windows; Manual espera ×/Escape. Ajustes incluye
ambas opciones con ejemplos y persistencia. Aperturas sencillas terminan tras
el inicio verificado sin enfocar ventanas. Ver docs/workspace-fluidez-y-aprendizaje.md.

3 de noviembre, continuación: aperturas sencillas directas con comprobación de
instalación, resultados de tareas devueltos al chat, aprendizaje progresivo de
procedimientos y consultas Windows componibles para preguntas nuevas. Word real,
cuenta/host, UI nativa y dos diagnósticos con Meta comprobados; no certifica
dominio universal de aplicaciones ni ejecución macOS. Ver
[alcance y evidencias](docs/melodi-aperturas-y-diagnostico-adaptable.md).

3 de noviembre, cierre: confirmación contextual, resultado final en el chat y
aviso glass compacto cuando está cerrado. El backdrop se acota con el tamaño
real de la ventana. Diagnóstico componible probado con Meta, Windows y WebView2;
hechos actuales y permisos existentes conservados. Ver
docs/melodi-aperturas-y-diagnostico-adaptable.md.

3 de noviembre, ampliación de escritorio. Melodi puede combinar observación de
controles y de una ventana concreta con especialistas cuando el encargo lo
requiere. Las intervenciones de escritorio pueden pausarse y continuar desde
el progreso comprobado mientras la sesión siga activa. El primer caso de
regresión es un lienzo con texto en Paint. Ver [bitácora](docs/17-bitacora.md).

3 de noviembre, consultas web. Melodi usa búsqueda de Meta con comprobación de
evidencia y fuentes que llegan al chat y WorkSpace. Las preguntas temporales
incluyen el reloj local y deben comprobar el día del lugar consultado.
Pruebas reales de documentación y clima, con corrección temporal registrada
en la [bitácora](docs/17-bitacora.md).

13 de noviembre, actualización posterior: transferencia por borde publicada e
instalada con respaldo; móvil físico pendiente. Expansión musical instalada y
activada por petición del usuario, con variantes lunar y ámbar, casilla de
inactividad y pruebas locales; fuentes personales y audio real sin certificar.
La interfaz nueva de acompañantes se mantiene en código para revisión posterior.
Se recuperó el chat bloqueado y se instaló recuperación nativa antes de su
inicialización. Spotify usa el servicio real de Brivany y autorización individual
sin campo de Client ID; se comprueba la identidad y se aíslan cambios de cuenta.
El acceso público sin lista de cuentas depende de aprobación de Spotify, y el
SDK exige Premium. No se acreditan aún consentimiento ni reproducción reales.
[Arranque y Spotify](docs/arranque-spotify-20261113.md),
[Expansión musical](docs/expansion-musical-20261113.md).

13 de noviembre, Spotify Development para uso inmediato: se conserva la identidad
de aplicación expresamente autorizada, verificada en el servicio publicado.
Contacto confirmado daniel@vetsa.es. Se aplicó compatibilidad de modo al cliente
y se verificó su nuevo arranque después de terminar la transferencia y autorizar
el reinicio. Servidor con metadatos/consentimiento preparado en código, publicación
separada del sitio pendiente. El acceso público requiere elegibilidad y aprobación
de Spotify; el usuario informa que aún no existe empresa registrada.
[Entrega y evidencia](docs/spotify-development-20261113.md).

14 de noviembre, Melodi en WhatsApp. El código y el servicio canónicos residen
en Brivany. Se publica e instala el puente saliente para tareas del ordenador,
adjuntos privados, resultados y aprobaciones por tarea, junto a llamadas
programadas por canal. Telnyx confirma configuración disponible; no se ensayó
una llamada pública. Meta rechaza Calling API con 138015 y queda como dependencia
externa pendiente, incluida la certificación de la suscripción `calls`. Google
está en revisión presentada por el titular, no aprobado. El segundo diagnóstico
real del puente pasa; se conserva el primer fallo sin atribuir una causa no
certificada. Avatar blanco de Melodi generado para perfil, sin publicación.
[Evidencia y alcance](docs/melodi-whatsapp-escritorio-llamadas-20261114.md).

14 de noviembre, corrección posterior: aislamiento al cambiar de cuenta y
cancelación durante recuperación del despacho de llamadas, publicados e instalados.
Pasan 361 pruebas del servicio y 18 del puente; instalación activa y latido
comprobados. Aviso operativo y requisitos leídos por WhatsApp. Se conserva Meta
138015 como bloqueo externo y la llamada pública y el control gráfico como
comprobaciones pendientes; el primer fallo remoto no se declara resuelto.

14 de noviembre, cambio posterior solicitado por el titular: WhatsApp Calling se
retira del flujo activo. Las llamadas telefónicas y su programación se trasladan
a `workers/calls/` y Cloudflare Durable Objects, usando la aplicación Telnyx
existente. Funcionan sin depender del PC; la voz se fija exclusivamente a la voz
seleccionada de Melodi en Cartesia. WhatsApp sigue siendo el canal de pedidos y
aprobaciones. Se incorpora control del ordenador durante la conversación mediante
su puente privado, con identidad por llamada e instrucción. Para ejecutar acciones
en el ordenador, Brivany debe estar abierta. La primera activación se limita al
titular original y su número. Las comprobaciones de voz, transcripción, modelo y
diagnóstico remoto quedan registradas; la prueba telefónica está condicionada a
completar las verificaciones, por petición expresa del usuario. Google continúa
en revisión externa. [Alcance y evidencia](docs/melodi-llamadas-cloud-20261114.md).

14 de noviembre, prueba posterior: un único intento después de las verificaciones
previas termina por espera sin respuesta; no se prueba conversación ni control
desde el teléfono. Se publica espera de 45 segundos y clasificación «sin respuesta».
Pasan 27 pruebas de llamadas y 361 de WhatsApp, con publicación verificada.
Aviso actualizado entregado por WhatsApp. Queda pendiente atender una llamada;
no se remarca automáticamente. [Resultado](docs/melodi-llamadas-cloud-20261114.md).

15 de noviembre, nueva dirección de identidad: Melodi es la asistente personal de
Daniel Luna. Para el acceso público, cada usuario tendrá otro asistente con nombre
y número propios, resueltos por cuenta y con aislamiento de herramientas y datos.
El aprovisionamiento individual queda pendiente; el número compartido actual no
se declara convertido en números por usuario. Se conserva la voz de Melodi y los
human-skills. [Decisión y alcance](docs/identidad-asistentes-20261115.md).

16 de noviembre, encargo del titular en WhatsApp. Melodi encuentra el informe de
entrega de correo que envía el proveedor, abre su adjunto comprimido y lo explica
en palabras corrientes; el aviso llega solo, una vez por informe, y un adjunto que
no abre se declara en lugar de resumirse. Se añade la nota de voz con su voz
exacta, enviada sólo a petición, y una regla de registro que le pide contar
consecuencias en vez de mecanismos internos. 384 pruebas locales y 35 de
whatsapp-cloud en verde, con proveedores simulados; sin cuentas reales, sin
mensajes enviados y sin consumo medido. Falta comprobarlo con un informe real y
añadir la burbuja nativa de nota de voz.
[Resultado](docs/informes-entrega-correo-20261116.md).


16 de noviembre, Melodi en reuniones por URL (investigación, pendiente de
prototipo). Entrada a Zoom/Google Meet desde chat o WhatsApp, coordinación
remota y voz exacta de Cartesia. Candidato inicial: API de participante con
Cloudflare; Browser Run requiere comprobar audio bidireccional. No usar la
Meet Media API en retirada como base nueva. Sin despliegue ni ingreso real
confirmado. [Opciones y aceptación](docs/melodi-reuniones-enlaces-20261116.md).
