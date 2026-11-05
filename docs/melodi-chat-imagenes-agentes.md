# Melodi: chat, imágenes y agentes locales

30 de octubre de 2026. Actualización aislada en `desktop/experience`,
`desktop/computer` y `services/computer`. Se conservan los motores y archivos
originales de voz, espacios y human-skills.

## Interfaz

El escritorio abre un chat con mensajes, respuesta incremental, Enter/Shift+Enter,
imágenes y botón Live. Se retiran del chat la práctica, métricas, esfera,
eslóganes, breadcrumbs, perfil de demostración y panel fijo de control. Práctica
conserva su módulo separado. Un resultado puede abrirse junto al chat y cerrarse
sin reemplazar el micrófono.

Ajustes se abre sobre la conversación existente. Reúne apariencia y texto del
chat; idioma, ritmo, volumen bajo, respuesta tras pausa, umbral y avisos de voz;
control, carpetas y parada; estado de servicios y entrada local de claves
Meta/Muse/Cartesia; acceso a cuentas, traducción, proyectos y bitácora. Las
preferencias se guardan localmente, sin credenciales. La apariencia se aplica a
la ventana, chat y Ajustes nuevos; otros módulos conservan su presentación.

El live reutiliza Microphone/MuseCapture y VoiceOutput/MelodiOutput, con suspensión
durante salida e interrupción condicionada al AEC. Abrir el chat no captura audio.
Los ajustes de escucha se aplican al reiniciar Live. Navegar conserva mensajes en
memoria de la ventana y detiene la escucha de la vista que se abandona.

## Imágenes

Pegado o selector PNG/JPEG/WebP, hasta cuatro referencias con vista previa,
selección activa y retirada. El servidor decodifica, normaliza orientación y
transparencia, elimina metadatos y limita el lado a 1600 píxeles. Conserva PNG sin
pérdidas cuando cabe y comprime imágenes grandes; la imagen procesada puede
diferir del original. Permanecen en memoria, caducan a los 30 minutos y se purgan
al acceder al almacén o cerrar el servicio, no mediante borrado de archivos.

La consulta envía píxeles a Meta al enviar el turno y no activa el ordenador por
sí sola. Una orden de acción produce primero un ticket efímero de un uso. El
cliente comprueba cancelación y generación de sesión antes del permiso nativo y
su ejecución: una clasificación tardía no actúa por sí sola tras borrar imágenes.
Retirar una referencia también invalida sus tickets pendientes; un trabajo ya
iniciado conserva la referencia necesaria hasta terminar o cancelarse.

«Dibújalo» envía la imagen activa al ejecutor Paint de Cognira: lienzo vacío,
lápiz, colores, trazos nativos y comparación del PNG guardado con su plan
cuantizado. No pega la imagen como sustituto del dibujo. El diseño 3D utiliza las
referencias y publica geometría conceptual local; «plano» abre la representación
de planta. Una foto no acredita profundidad, escala, fidelidad ni dimensiones
constructivas.

## Agentes en segundo plano

Especialistas locales de ordenador, espacial, redacción y consultas: una cola de
un worker por tipo y hasta ocho encargos activos por tipo. Sólo un trabajo ocupa
ratón/teclado; cancelar uno en espera no interrumpe al propietario actual. Modelos
y redacción avanzan por separado. No son despliegues de agentes remotos.

Redacción produce texto y HTML con contenido escapado sin requerir Office. Los
recibos guardan estados/rutas sin prompts, voz o imágenes originales. Al cerrar
se interrumpen las tareas y no se reproducen al arrancar. Se puede revisar y
marcar un resultado. El monitor permanece al cambiar de módulo.

Avisos visuales de finalización, fallo o intervención. En live, la salida de voz
compartida espera que no haya respuesta pendiente, salida en curso ni fragmento
de usuario sin terminar, y 2,2 segundos sin actividad acústica. Se puede
desactivar en Ajustes. Un turno silencioso que pide esperar al usuario también
retiene los avisos hasta su siguiente intervención.

Consultas personales prepara `calendar.list`, `gmail.search` o `drive.search`.
Se revisan parámetros concretos antes de ejecutar, con la configuración de
ejecución y OAuth existentes. No se persisten resultados privados del proveedor.
Mover Drive, leer cuerpos de Gmail, enviar correo o gestionar cuentas por
completo no se implementa aquí; las peticiones fuera del catálogo indican el
límite.

## Pruebas y consumo

- `computer-images-agents`: 15 pruebas locales. Origen y permisos, claves sin
  eco, píxeles sustituidos, tickets, cancelación, colas, documento mientras otro
  agente trabaja y Google con transporte sustituido.
  `docs/verification-history/computer-images-agents-20261030T212615-d117fb4d.json`.
- `computer-images-agents-ui`: Edge headless, HTTP local real, pegado mediante
  ClipboardEvent/DataTransfer, compilación GLB real, planos y revisión de
  documentos. Micrófono dentro de 1440×844, 1120×760, 768×844, 390×844, 320×844,
  390×568 y 640×480. Ajustes también cabe en 320×568 y cambia tema/tamaño sin
  reemplazar el chat. Live usa WebAudio silencioso, Muse y salida sustituidos;
  comprueba transcripción→chat y aviso único tras terminar un pensamiento.
  `docs/verification-history/computer-images-agents-ui-20261030T212447-4e5615a6.json`.
- Regresión `computer`: 20 pasadas; `computer-native`: 30 pasadas;
  `computer-bundle`: 12 pasadas y una omitida por permiso de symlink Windows.
- Visión real: tres solicitudes Meta, dos con píxeles sintéticos. Identificó
  rectángulo naranja a la izquierda y círculo azul a la derecha sin describirlos
  en la pregunta, y publicó dos GLB con supuestos explícitos.
  `tmp/computer-reference-real/fixture-812e935b/report.json`. Importe facturado
  desconocido, sin reintentos de tarea.
- Paint real: referencia sintética 64×64, tres colores, 192 trazos y PNG guardado
  comparado satisfactoriamente con el plan cuantizado, sin reparación.
  `tmp/computer-reference-real/fixture-388cb126/report.json`. Cero solicitudes de
  inferencia de esta prueba; no acredita calidad artística ni fotos complejas.
- Backend local verificado `0e902343e34f8ac5b25c2eb90f3a8a15`: 104 archivos,
  388674883 bytes; incluye tres módulos de referencia Paint fijados por hash.
  Cognira original no cambia.

Los fallos intermedios se conservaron en la bitácora. Se corrigieron la
sincronización del recibo final, selectores de pruebas, tipografía heredada y
ancho de Ajustes mediante cambios y verificaciones posteriores.

Pendiente: portapapeles físico, micrófono/altavoz físico, live real simultáneo con
acción nativa, resolución arbitraria, lector de pantalla, render fotorrealista,
control nativo macOS/Linux y operaciones adicionales de Google y otros servicios.
Los mocks no acreditan esas capacidades.
