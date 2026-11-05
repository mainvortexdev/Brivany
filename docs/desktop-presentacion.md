# Integración de escritorio para la primera presentación

30 de octubre de 2026. Los cambios se concentran en `desktop/experience` y nuevas
herramientas de comprobación; los módulos y proveedores anteriores se reutilizan.

## Accesos

- Melodi: voz live, práctica, reunión silenciosa, inglés, contexto y ajustes.
- Espacios: biblioteca real local, captura/revisión, selección, visor, edición,
  historial, variantes, física experimental, plano, recorridos y proyectos portátiles.
- Human-skills: biblioteca, creación desde video y práctica con evidencia.
- Sous: inventario, recetas, compras, pasos revisables, visión optativa y voz.
- Práctica: cámara y revisión existentes.
- Video: traducción vigente Muse/Meta/Cartesia y archivos locales.
- Conexiones: Google Calendar, Gmail, Drive, WhatsApp, redes sociales, solicitudes
  revisadas, notas y recordatorios. Cada acción conserva sus permisos y revisión.
- Bitácora: carga automática de todas las páginas con evidencias y fallos históricos.
- Servicios y APIs: estado de configuración de voz, conversación y traducción.

El servidor carga las credenciales ya configuradas mediante el mecanismo existente.
Se reconocieron cuatro configuraciones: conversación, escucha, voz y traducción.
Esto no acredita saldo, cuota, acceso remoto vigente ni calidad de los modelos.
Google, WhatsApp y redes requieren las autorizaciones particulares aún pendientes;
la integración de Codex no las concede a Brivany. Modal necesita despliegue, pesos,
licencias y presupuesto; Spaik Iris sigue pendiente de arquitectura.

## Correcciones

El contenedor permite únicamente marcos del mismo origen. Los módulos conocidos
permiten ser enmarcados desde ese origen; las APIs conservan la validación local.
El puente nativo sólo se transmite a Espacios y expone sus operaciones ya existentes,
sin aceptar rutas arbitrarias. La navegación descarga el módulo anterior para
liberar escucha, captura y render. Los enlaces internos actualizan el menú.

El panel de Conversación se retira al abrir módulos o estrechar la ventana. Las
vistas respetan `hidden`, los menús tienen desplazamiento y las ventanas pequeñas
usan navegación por iconos con nombres accesibles. Se amplió la tipografía y se
apilaron controles e inspector cuando no caben.

La adaptación de voz de escritorio conserva el final Muse al terminar durante la
pausa acústica, permite interrupción sólo con AEC confirmado y evita activar el
estado de habla para respuestas vacías de espera. Los archivos originales de voz
se conservan; el adaptador se carga sólo desde el servidor de esta experiencia.

## Evidencia y límites

`tmp/desktop-presentation/report.json` contiene 66 recorridos: once accesos en
1440×900, 1120×760, 1024×600, 768×600, 390×844 y 320×568, además de doce endpoints
locales y el puente de proyectos con transporte nativo sustituido. Se revisaron
capturas de Melodi, Espacios y Conexiones. No demuestra funcionamiento en cualquier
pantalla ni pruebas físicas macOS/Linux, selectores o micrófono/altavoz.

Las suites `desktop`, `connections-http`, `river-ui`, `live-ui`, `spatial-ui`,
`sous-pipeline` y `human-skills-ui` superaron los recorridos y registran su
salida con `tools.verify`; son locales, con proveedores/dispositivos sustituidos.
`tools/check_desktop_live.cjs` reutiliza el recorrido live existente dentro del
marco real del escritorio. La apertura no inicia captura ni inferencias.

La suite `melodi-cartesia` observó 29 pruebas superadas y una discrepancia de
expectativa en `test_stream_emits_sentences_and_maintains_melodi_identity`: espera
dos eventos separados, mientras que el comportamiento vigente agrupa las dos
frases breves en un evento. El contenido se conserva. El fallo queda registrado;
esta entrega no reescribe el motor ni la prueba histórica para ocultarlo.

Los primeros ensayos también detectaron desbordamiento y defectos de cierre/espera
de voz; los informes fallidos se conservan y las correcciones se añaden al registro.
No se hicieron inferencias pagadas ni se conservaron conversaciones o audio del
usuario. Esta evidencia comprueba integración local y flujos simulados, no fidelidad
3D, medidas profesionales, entrega de mensajes o naturalidad de voz física.

Las exportaciones de los módulos cuentan con descargas habilitadas en el host;
la selección del destino del sistema sigue sin prueba física automatizada. El
menú compacto conserva nombres accesibles y títulos aunque oculte el texto visual.
