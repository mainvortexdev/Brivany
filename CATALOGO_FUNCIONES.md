# Catálogo de funciones de Brivany

Estado de entrega del 8 de noviembre de 2026.

Este catálogo reúne lo implementado o integrado en este chat para WorkSpace,
sus herramientas y las llamadas de Melodi. El objetivo se cierra por indicación
del usuario con las revisiones pendientes que se detallan aquí.

**Comprobada** indica una verificación dentro del alcance descrito en la evidencia.
**REVISAR** indica código disponible que necesita comprobación adicional,
activación de una integración o corrección. Las pruebas con servicios
sustituidos se identifican como locales y simuladas.

## Proyecto y respaldo

| Función o entrega | Estado | Ubicación o comprobación |
| --- | --- | --- |
| Copia de trabajo con Git | Comprobada | `C:\Users\felix\Documents\GitHub\Brivany`. Es el proyecto donde se hicieron los cambios. |
| Respaldo comprimido anterior a la limpieza | Comprobada | `C:\Users\felix\Documents\GitHub\Brivany-respaldo-antes-limpieza-2026-11-04_18-17-10.zip`. |
| Original restaurado fuera de GitHub | Comprobada | `C:\Users\felix\Documents\Brivany-original-20261104`. Se restauraron y comprobaron 128.601 entradas. El ZIP carece de metadatos Git en su raíz. |
| Histórico privado y videos de referencia | Comprobada | `C:\Users\felix\Documents\Brivany-private-history-20261104`. Los tres MP4 siguen en `Examples`. |

[Restauración y evidencia](docs/workspace-diseno-y-recursos-20261107.md#restauración-del-árbol-original).

## Diseño de WorkSpace

| Función | Estado | Comportamiento y revisión |
| --- | --- | --- |
| Distribución de barra y centro de Melodi | Comprobada | Se conservan los grupos de herramientas y el personaje central. |
| Paneles compactos de Herramientas y Archivos | Comprobada | Ancho normal de 360 y 376 px. Enfoque mide 167 px de alto, con botones de 26 px en la prueba nativa. |
| Altura según el contenido | Comprobada | Las herramientas pequeñas cierran debajo de sus controles. Las listas largas se desplazan dentro del panel. |
| Selector único de herramientas | Comprobada | Sustituye las pestañas y la cabecera permanente de reloj. El engranaje abre Ajustes. |
| Entradas y cambios de herramienta animados | Comprobada | Transiciones breves de opacidad y desplazamiento. Los cambios rápidos cancelan la animación anterior. |
| Partículas y recepción de archivos por Melodi | Comprobada | Ráfagas limitadas al evento, con retirada de nodos al finalizar y compatibilidad con movimiento reducido. |
| Navegación con teclado, cierre y foco | Comprobada | Escape, etiquetas accesibles y recuperación del foco al cambiar de herramienta. Pruebas a 340 px. |
| Superficie, acento, tamaño y ahorro | Comprobada | Negro/grafito, azul/menta/ámbar/rosa, compacto/normal/grande y animaciones configurables. |
| Visor de resultados compacto | Comprobada | Tarjeta Glisse, desenfoque y desplazamiento vertical. La región nativa volvió a ocupar 520 × 340 px. |
| Conservación de chat, dictado, Live y agentes | Comprobada en regresión local | Se preservan sus controles y el recorrido de entrada al módulo existente. La voz de las pruebas visuales es sintética. |
| Identidades animadas Blobatar por agente | Comprobada en Edge | Cara estable por identidad, diferencias de silueta/color, expresiones por estado y pausas por visibilidad o movimiento reducido. Barra, detalle y avisos verificados con agentes simulados. Consumo físico sin medir. |
| Música y letras de Spotify | Comprobada en regresión local | Reproducción, pausa, siguiente/anterior, aleatorio, repetición, volumen, progreso, biblioteca, dispositivos y letras temporizadas. **REVISAR** con la cuenta y reproducción reales después de esta entrega. |
| Movimiento y ambiente musical de Melodi | Comprobada localmente | Colores de portada, ondas, baile y tratamiento de pausa y movimiento reducido. |

[Diseño, idioma y pruebas](docs/workspace-diseno-y-recursos-20261107.md),
[regresión nativa de WorkSpace](tmp/verification/workspace-chat-native-20261108T035755-2aaddfa7.json).

[Instalación de Blobatar, vistas y pruebas](docs/blobatar-agentes-20261108.md).

## Ajustes y persistencia

| Función | Estado | Comportamiento y revisión |
| --- | --- | --- |
| Guardado de preferencias en disco | Comprobada | Apariencia general, tamaño del chat, escucha, velocidad, voz baja, avisos y umbral. Se recuperan con servidor y perfil de navegador nuevos. |
| Preferencias de WorkSpace | Comprobada | Apariencia, idioma, ahorro y movimiento. El idioma de interfaz es independiente del de escucha de Melodi. |
| Preferencias de grabación | Comprobada | Fluidez de 15/30 fps y cursor. La carpeta y los límites se consultan en Ajustes. |
| Preferencias de traducción y clima | Comprobada | Idioma, voz, modo, idioma de origen para clonación y ciudad elegida. |
| Carpetas recordadas | Comprobada | Las carpetas elegidas se recuperan al iniciar y se pueden retirar de Ajustes. |
| Revocación de carpetas y permiso de control | Comprobada | Retirar una carpeta detiene la autorización de control asociada. La autorización activa y el consentimiento de clonación se gestionan por sesión. |
| Notas, temporizador y widgets de escritorio | Comprobada | Estado compartido en disco, posiciones y preferencias. Véase el apartado de herramientas. |
| Comprobación de la instancia personal instalada | **REVISAR** | Las pruebas de reapertura y las nativas usaron instancias propias de prueba. |
| Agenda y webs tras cerrar completamente Desktop | **REVISAR** | Se comprobaron recargas de vista y almacenamiento local. Falta comprobar y completar su restauración entre perfiles privados nuevos. |

[Persistencia y pruebas](docs/workspace-diseno-y-recursos-20261107.md#persistencia-de-ajustes-y-cambio-de-herramienta).

## Herramientas

| Función | Estado | Comportamiento y revisión |
| --- | --- | --- |
| Enfoque | Comprobada | Temporizador con minutos/segundos, iniciar, pausar, reanudar, restablecer y aviso al terminar. El plazo se conserva al cambiar de vista. |
| Reloj | Comprobada | Hora y fecha con formato del idioma elegido. |
| Notas | Comprobada | Hasta 4000 unidades UTF-16, guardado y coordinación entre vistas. Los conflictos muestran cargar la nota guardada o guardar la edición actual. |
| Calculadora | Comprobada | Expresiones aritméticas y paréntesis, resultado con formato local y errores controlados. |
| Widgets independientes | Comprobada | Reloj, Enfoque y Notas se abren en ventanas nativas movibles, con posiciones guardadas, opción de mantener encima y cierre conjunto. |
| Accesos a Windows | **REVISAR** | Volumen, pantalla/brillo, Wi-Fi, Bluetooth, notificaciones, privacidad del micrófono y captura de pantalla abren las herramientas del sistema. Falta completar el recorrido físico de cada acceso. |
| Portapapeles manual | Comprobada con API sustituida | Leer texto, copiar entradas y borrar el historial de sesión. **REVISAR** el recorrido físico con aplicaciones del usuario. |
| Medición puntual del anfitrión | Comprobada | Muestra CPU acumulada y memoria del proceso Python. Esa lectura cubre solo el anfitrión. |
| Agenda local | Comprobada localmente | Navegación de meses/días, eventos con hora opcional, retirada y exportación ICS. |
| Clima por ciudad | **REVISAR** | Búsqueda de ciudades, selección, consulta explícita, caché y recuperación de errores. Falta comprobar una consulta real de Open-Meteo en esta entrega. |
| Webs favoritas | Comprobada localmente | Hasta doce direcciones, añadir/quitar y abrir bajo acción del usuario. Véase la revisión de persistencia entre perfiles. |
| Micrófono de llamadas | **REVISAR** | Lectura y botón de silencio del dispositivo de comunicaciones predeterminado de Windows. Falta comprobarlo durante una llamada real. |

[Widgets nativos](docs/workspace-widgets-escritorio-20261107.md),
[agenda, clima y webs](tmp/verification/workspace-daily-ui-20261108T035309-509bc91f.json),
[lectura de micrófono y límites](docs/workspace-diseno-y-recursos-20261107.md).

## Archivos, documentos y correo

| Función | Estado | Comportamiento y revisión |
| --- | --- | --- |
| Bandeja por arrastre o selector | Comprobada localmente | Hasta ocho archivos de 1 GiB y 4 GiB totales. Importación binaria por bloques, nombres seguros y detección de cambios del original; extractores de documentos y correo conservan límites menores. |
| Abrir, copiar ruta y retirar | Comprobada con aperturas sustituidas | La retirada conserva el original. **REVISAR** asociaciones de archivos y diálogo físico de Windows. |
| Preguntar a Melodi sobre un archivo | Comprobada | Prepara un extracto editable en el chat y deja el envío a cargo del usuario. |
| Texto, Word, Excel y PowerPoint | Comprobada | Extractos de texto, DOCX, XLSX y PPTX. Sigue el orden de las hojas y diapositivas y usa valores guardados de Excel. |
| PDF con texto | Comprobada | Lectura local de hasta las primeras ocho páginas en un proceso con tiempo y memoria acotados. |
| Detección de PDF protegido, dañado o sin texto | Comprobada | El resultado informa de la limitación y conserva un borrador por nombre. |
| Correo con adjunto | Comprobada en escritura MIME | Guarda un EML con el adjunto exacto, asunto y cuerpo, sin destinatario. **REVISAR** su apertura y presentación en el cliente de correo del usuario. |
| Análisis de imágenes, audio, video y PDF escaneado | Pendiente | La bandeja admite esos archivos para otras acciones. OCR e interpretación de su contenido quedan pendientes. |

[Formatos, límites y recorrido nativo](docs/workspace-bandeja-archivos-20261107.md#extractos-de-office-y-pdf-y-correo-con-adjunto).

## Lienzo y grabación

| Función | Estado | Comportamiento y revisión |
| --- | --- | --- |
| Ventana independiente de dibujo | Comprobada | Lienzo blanco y barra de iconos compacta. |
| Herramientas de dibujo | Comprobada | Lápiz, marcador, borrador, línea, rectángulo y elipse. Colores, grosor y relleno. |
| Edición y navegación del lienzo | Comprobada | Deshacer/rehacer, limpiar, cambiar dimensiones, zoom, desplazamiento y atajos. |
| Copiar dibujo como PNG | **REVISAR** | Generación de PNG y formatos Windows implementada. Falta certificar el pegado físico entre aplicaciones del usuario. |
| Exportar dibujo | Comprobada | PNG con fondo blanco, guardado atómico, cancelación y revisión de cambios antes de cerrar. |
| Grabar pantalla o ventana | Comprobada con ventana propia | Captura Windows mediante FFmpeg y salida MP4, inicio/parada explícitos e indicador en la barra. |
| Calidad y límites de grabación | Comprobada | 15/30 fps, cursor, hasta 1080p, 30 minutos o 2 GB, carpeta Vídeos/Brivany y conservación del parcial si falla el MP4. |
| Audio y captura de aplicaciones protegidas | **REVISAR** | El grabador actual produce video sin audio. Monitor completo, contenido protegido y audio requieren trabajo o comprobación adicional. |

[Lienzo y pruebas](docs/workspace-lienzo-20261107.md),
[grabación y límites](docs/workspace-grabacion-panel-limpio-20261107.md).

## Teléfono y control remoto

| Función | Estado | Comportamiento y revisión |
| --- | --- | --- |
| Transferencia PC ↔ teléfono | Comprobada con navegadores; recepción física confirmada | QR en brivany.vetsa.es con HTTPS válido, aceptación por archivo, WebRTC y respaldo WSS cifrado. Límite 1 GiB, bloques verificados y reanudación; Descargas/Brivany en el PC. Ensayo de 1 GiB en Chromium, no certificado en iPhone. |
| Sesión de transferencia | Comprobada | Canje único del QR en diez minutos, sesión de seis horas, dos roles autenticados, revocación y eliminación de recepciones parciales al cancelar. |
| Pantalla móvil en cuatro idiomas | Comprobada con navegadores | Español, inglés, francés y portugués de Brasil. Progreso, Guardar archivo, envío al PC y avisos concretos de error. |
| Certificado de transferencias | Comprobado en dominio oficial | HTTPS público válido, sin certificado local ni requisito de compartir Wi-Fi. El control móvil conserva su configuración local independiente. |
| Recepción en el iPhone del usuario | Confirmada por el usuario; **REVISAR 1 GiB físico** | Tras corregir la cancelación, el usuario confirmó la descarga. Alternativa acotada a 16 MiB para visores restringidos; archivos mayores requieren disco permitido. No se conoce el tamaño de la prueba física. |
| Enviar el archivo ya arrastrado | Comprobada con puente nativo y WebKit | Conserva el archivo seleccionado al conectar el teléfono; Enviar utiliza esa entrada sin volver a abrir el selector. |
| Reinicio privado de Brivany | Comprobado en instalación real | API privada de loopback con capacidad cifrada DPAPI, guardado de chat/borrador, cierre normal y reapertura. Bloquea tareas activas y delega en el actualizador firmado cuando procede. |
| Vinculación de control móvil | Comprobada en loopback | QR, código y permisos separados de teclado, pantalla, música, diapositivas y energía. Revocación y caducidad. |
| Pantalla principal desde el móvil | **REVISAR** | Vista bajo demanda implementada. La prueba usa imágenes sintéticas; falta el recorrido con móvil físico y pantalla real. |
| Teclado, texto Unicode y trackpad | **REVISAR** | Enrutamiento y ABI comprobados con controlador sustituido. Falta controlar una aplicación real desde un móvil físico. |
| Música y diapositivas desde el móvil | **REVISAR** | Acciones multimedia y de navegación implementadas. Falta comprobar reproductor y presentación reales. |
| Bloquear o apagar desde el móvil | **REVISAR** | Petición y confirmación en el PC, con revocación previa. Las pruebas sustituyeron las acciones de energía. |

[Transferencia actual y reinicio](docs/brivany-transferencias-reinicio-20261110.md),
[control móvil y permisos](docs/workspace-control-movil-20261107.md).

## Llamadas de Melodi

| Función | Estado | Comportamiento y revisión |
| --- | --- | --- |
| Panel de llamadas | Comprobada localmente | Número y encargo, revisión, confirmación, consulta de estado, cancelación y recibos. |
| Destinos sin registro manual previo | Comprobada | Se prepara el número de cada llamada directamente. El perfil anterior se conserva. |
| Telefonía con Telnyx | **REVISAR** | Desde el 11 de noviembre sustituye a Twilio y Netelip. API para configurar la cuenta y SIP/RTP desde el equipo, sin webhook público. Pruebas locales con Telnyx sustituido; falta la primera llamada real. |
| Credenciales persistentes | **REVISAR** | La conexión de Telnyx se guarda cifrada con Windows al ejecutar `tools.setup_telnyx provision`. La clave API queda en `.env`. Falta guardarla en el equipo del usuario. |
| Muse, Meta y voz de Melodi | **REVISAR** | Flujo de conversación, audio progresivo, interrupciones y acuses implementados y probados con sustitutos. Falta una conversación telefónica real estable. |
| Rapidez comparable a Live | **REVISAR** | No quedó acreditada en llamadas públicas. |
| Agenda desde una llamada | Pendiente de integración | Doce turnos simulados confirmaron que la voz telefónica no despacha herramientas. Google permite consultar/crear por una ruta separada; buscar huecos, reorganizar y desplazar eventos siguen pendientes. |
| WhatsApp Calling directo a Meta | Pendiente de integración | El usuario ya tiene número registrado directamente en Meta. Falta vincularlo con esta copia y habilitar voz. Las llamadas salientes requieren permiso del destinatario, temporal o permanente; se estudia SIP para salientes sin ese trámite. |
| Salida por cliente oficial de WhatsApp | **REVISAR** | Canal, pasarela, revisión, simulación vocal y adaptadores de UI Automation/audio virtual implementados. Pasaron 26 pruebas nuevas y recorridos del panel y una ventana propia. Cliente WhatsApp, compatibilidad de cuenta, audio y llamadas reales pendientes. |
| Selección y recibos de llamada persistentes | Comprobada localmente | Conserva en disco el canal y los últimos recibos por vía. Restaurar el panel no vuelve a marcar. |
| Buzón de voz | **REVISAR** | Interfaz, reproducción y rutas implementadas con pruebas simuladas. Conexión real del buzón pendiente; las entrantes actuales se mantienen en el móvil del usuario. |
| Número propio como identificador de salida | Pendiente | El usuario aplazó su verificación. Debe avisarse y obtener su indicación antes de una prueba que lo muestre. |
| Saldo y número emisor en Telnyx | **REVISAR** | El usuario indicó que recargó créditos. Falta elegir número emisor (comprado en Telnyx o propio verificado) y confirmar que la cuenta permite llamar a República Dominicana. |

La conversación telefónica estable sigue como revisión prioritaria de esta
entrega. Los intentos registrados no permitieron acreditarla.
[Migración a Telnyx y primera llamada](docs/melodi-telnyx-20261111.md). Histórico: [Netelip](docs/melodi-sip-netelip-20261107.md).

[Auditoría de agenda, alternativas de coste y WhatsApp](docs/melodi-agenda-whatsapp-auditoria-20261108.md).

[Estudio de salida mediante el cliente oficial de WhatsApp](docs/melodi-whatsapp-cliente-alternativa-20261108.md).

[Implementación del canal, pruebas y límites reales](docs/melodi-whatsapp-cliente-implementacion-20261108.md).

## Juego, idiomas y consumo

| Función | Estado | Comportamiento y revisión |
| --- | --- | --- |
| Franja de estadísticas de juego | Comprobada en ventana propia | Ventana nativa sin otro WebView, activación/cierre y contadores del equipo. |
| CPU, GPU y RAM | Comprobada con contadores Windows | Lecturas de uso del equipo. |
| FPS por ventana con PresentMon | **REVISAR** | Integración, preparación y análisis de datos implementados. La captura ETW real devolvió acceso denegado en el ensayo; falta una partida real. |
| Cuatro idiomas de WorkSpace | Comprobada | Español, inglés, francés y portugués de Brasil, cambio en vivo, persistencia y formato de números y fechas. |
| Catálogos por idioma | Comprobada | Solo se carga el elegido y se descartan respuestas tardías de selecciones anteriores. |
| Cobertura lingüística completa | **REVISAR** | Faltan otros idiomas de la referencia, ventanas auxiliares, algunos estados especializados y revisión por hablantes nativos. |
| Reducción de actividad en reposo | Comprobada en muestras acotadas | Carga diferida, sondeos compartidos, paneles ocultos sin trabajo periódico de puntero y traducción. |
| Widgets sin WebView adicional | Comprobada | Ventanas WinForms para reloj, notas y temporizador. |
| Modelos y reproductor bajo demanda | Comprobada localmente | Se evitan precalentamientos innecesarios y lecturas completas del modelo para calcular su hash. |
| Reducción de música durante voz | Comprobada localmente | Monitor condicionado al estado del reproductor, con restauración del volumen. |
| CPU/RAM/GPU de toda la aplicación | **REVISAR** | Se midieron escenarios nativos breves con variación entre muestras. Falta una medición integral con voz, música y captura activas. |

[Juego y permisos](docs/workspace-juego-20261107.md),
[idiomas](docs/workspace-diseno-y-recursos-20261107.md#francés-y-portugués-de-brasil),
[recursos y medidas](docs/workspace-arranque-recursos-20261107.md).

## Pendientes que quedan registrados al cierre

Además de las filas **REVISAR**, quedan pendientes la sincronización con un
calendario de cuenta, los avisos del sistema, el OCR y el análisis de medios,
las temperaturas del equipo y la ampliación a los 21 idiomas anunciados en
la referencia. Twitch y YouTube quedaron fuera de la prioridad indicada por
el usuario. La aplicación conserva su arquitectura actual; la migración a
Rust no se implementó.

Los informes enlazados conservan el alcance de cada ensayo. La bitácora de
construcción mantiene los cambios y los fallos históricos.
[Bitácora](docs/17-bitacora.md).

## Creador audiovisual de Melodi — ampliación del 9 de noviembre de 2026

| Función | Estado | Alcance comprobado |
| --- | --- | --- |
| Video por escenas desde el chat | Comprobada con Meta real | Melodi escribió y exportó un video vertical de 15 s con su voz, cine y música. El plan no se escribió manualmente para la prueba. |
| Revisión de videos propios | Comprobada con Meta real | Dos revisiones exportadas; se conservaron los proyectos, recursos y voces no modificadas. |
| Análisis de referencia | Comprobada con un video real | Doce cuadros, cortes y energía de audio. Amplía el análisis de medios mencionado entre los pendientes anteriores. No analiza cada fotograma ni garantiza réplica perfecta. |
| Cine y música | Comprobada | Catálogo inicial de seis películas y tres pistas con atribución, más archivos seleccionados. No es búsqueda global de películas y canciones. |
| Ilustraciones desde referencias | Comprobada con Meta Muse Image real | Generación y edición reales, con guía de marca cuando se solicita. PNG visible en el chat. |
| Fidelidad visual y datos en ilustraciones | **REVISAR cada entrega** | Una edición inventó una tarjeta de video. La historia entregada recibió una corrección final de Codex; no se presenta como salida íntegra de Melodi. |
| Réplica exacta universal | No garantizada | Las referencias se observan por muestras y la composición tiene un contrato acotado. |

[Uso, pruebas y límites del creador](docs/melodi-creadora-video-ilustraciones-20261109.md).
