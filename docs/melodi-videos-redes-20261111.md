# Melodi crea videos para redes (edición 4)

11 de noviembre de 2026. Melodi puede producir, de principio a fin, una
**historia de Instagram**, un **reel de Instagram/TikTok** o un **video largo
horizontal para YouTube**: elige el tema (o habla de sus capacidades),
escribe el guion y los textos, elige ilustraciones animadas, pone su voz,
compone música y efectos, y entrega MP4, portada, subtítulos y texto para
publicar. No publica nada: la decisión de subirlo es del usuario.

## Qué existía y qué faltaba

Antes había dos rutas: las dos familias de Bang Motion (`service.py`) y el
compositor de escenas por elementos (`story_service.py`, edición 3). La edición
3 dejaba al modelo posicionar texto y formas en porcentajes con seis
ilustraciones estáticas, música de un catálogo de tres pistas y sin efectos,
subtítulos, portada ni texto de publicación. Los videos de mejor calidad
(«El idioma ya no es una barrera») se habían montado a mano en HyperFrames.

La edición 4 conserva esas rutas y añade una específica para redes que recoge
la calidad de las piezas hechas a mano en código de confianza.

## Cómo funciona

| Paso | Quién | Dónde |
| --- | --- | --- |
| Detectar destino (historia, reel, YouTube) | Router determinista | `services/computer/planner.py`, `social_service.detect_destination` |
| Tema, guion, titulares, kits, música, texto de publicación | Melodi (planificador Meta) | `SOCIAL_PROMPT` en `services/motion/social_service.py` |
| Validación y reglas de honestidad, con reintento guiado | Código local | `services/motion/social_contract.py` |
| Voz de Melodi con marcas de palabra | Cartesia, voz española configurada | `social_audio.melodi_voice` (caché por texto) |
| Duración de cada plano a partir de la voz real, cortes en la rejilla del tempo | Código local | `social_service.shot_timing` |
| Composición: planos, kits animados, subtítulos, transiciones | Runtime de confianza | `services/motion/assets/social-runtime.js` |
| Efectos en el instante exacto de cada evento visual | El runtime los anota en `window.__sfx` | `social_audio.effects` |
| Música original por estado de ánimo y tempo | Síntesis local numpy/scipy | `social_audio.score` |
| Mezcla con la música bajo la voz, −14 LUFS, −1,5 dBTP | FFmpeg loudnorm en dos pasadas | `social_audio.mix` |
| Render fotograma a fotograma, en paralelo | Edge sin interfaz + FFmpeg, sin red | `services/motion/social_render.mjs` |
| Portada sin subtítulos, SRT, texto, capítulos de YouTube, miniatura | Código local | `social_service.SocialService.run` |

El plan es un JSON por planos: `layout` (statement, kit, end), `theme`
(paper, night, blue, soft), `kicker`, `headline` (≤ 8 palabras), `accent`
(fragmento del titular en azul), `body`, `kit`, `labels`, `narration`,
`transition` (wipe, push, cut), más `music` {mood, bpm}, `cta` y `publish`.
El modelo no escribe HTML, código, rutas ni URLs; todo texto se inserta con
`textContent`.

### Kits de ilustración animada

`melodi`, `languages`, `counter`, `dubbing`, `voice_clone`, `speakers`,
`meeting`, `chat`, `live_voice`, `agents`, `summary`, `workspace`,
`checklist`, `video_maker` y `logo`. Usan la geometría de Melodi y de los
personajes de color de los videos anteriores, tarjetas con volumen, entradas
de 0,2–0,4 s y asentamiento sin rebote. Melodi mueve la boca al ritmo de las
palabras de su voz. Cada kit se diseña en 864×760 y se escala al hueco del
formato.

### Formatos y zonas seguras

| Destino | Tamaño | Duración final | Planos | Reservado para la interfaz de la red |
| --- | --- | --- | --- | --- |
| Historia de Instagram | 1080×1920/30 | 8–20 s | 3–5 | 250 px arriba, 340 px abajo |
| Reel Instagram/TikTok | 1080×1920/30 | 20–50 s | 5–10 | 220 px arriba, 470 px abajo, 160 px a la derecha (unión Reels + TikTok) |
| YouTube horizontal | 1920×1080/30 | 75–240 s | 9–28 | márgenes de 90/130 px |

### Revisión automática antes de entregar

`services/motion/social_review.py`. Tras renderizar, el modo `audit` de
`social_render.mjs` mide en cada plano (35 % y 85 %) y en cada subtítulo la
caja real, el tamaño de letra efectivo y el desborde de todo texto visible.
Bloquea la entrega (y deja `review.json`) si un texto sale de la zona segura
de la plataforma, queda recortado, por debajo del tamaño mínimo (titular 56
px, subtítulo 44/36 px, cuerpo 34/28 px) o tapado por un subtítulo; si la voz
empieza antes del corte o invade el plano siguiente; si faltan palabras en los
subtítulos; o si la voz queda menos de 15 dB (mediana) sobre música y efectos.
Las etiquetas pequeñas de los kits y la velocidad de lectura generan avisos.

La mezcla atenúa la música unos 11 dB bajo la voz, le resta 6 dB en 1–4 kHz
mientras Melodi habla y también baja los efectos. Antes de este ajuste la voz
quedaba solo 9,5–12 dB por encima (1–2 dB en los pasajes suaves).

Prueba independiente opcional (con coste): `tools.produce_social_videos
listen <proyecto>` envía la mezcla final a Deepgram nova-3, calcula el acierto
de palabras frente al guion (sin tildes) y el desfase entre subtítulos y voz
oída. Aprueba con ≥ 90 % y p95 ≤ 250 ms.

### Composición, gancho y textos (revisión del 12 de noviembre)

- **Vertical a toda la altura.** Titular arriba, ilustración a todo el ancho
  seguro y el alto restante, subtítulos al pie de la zona segura y un
  «escenario» de fondo que llega hasta el borde inferior (zona de la interfaz
  de la red, sin texto). En vertical el cuerpo de texto no se muestra y todos
  los planos llevan ilustración. Kits de Melodi, voz live, resumen, lista y
  logo agrandados; en 16:9 el cierre pone el logo al lado del titular.
- **Gancho.** El primer plano debe usar layout `kit` con una ilustración que
  no sea el logo. Entra con zoom y rayos en movimiento y su animación arranca
  0,55 s adelantada: en el fotograma 0 (el que se ve en el feed) ya está
  completa, y sigue moviéndose.
- **Revisor de composición** (`review_composition`, `review_hook`). Bloquea si
  en un plano ya montado queda una franja vacía mayor del 16 % del alto útil
  (24 % en 16:9; la banda de subtítulos cuenta como ocupada), si la
  ilustración mide menos del 70 % del ancho (o del 85 % del ancho útil en el
  reel, cuya zona segura deja el 77 %), si en el primer segundo cambia menos
  del 12 % de la imagen o si la ilustración del gancho ocupa menos del 60 %.
- **Reglas de texto** (`social_copy.py`, aplicadas por el contrato con todos
  los fallos a la vez para que Melodi corrija en un solo intento):
  antetítulos de relleno («Hola soy yo», «Mira esto») o que repiten palabras
  del titular; pleonasmos (dos palabras con la misma raíz: «gancho que
  enganche»); en los kits `meeting` y `dubbing`, `labels[0]` debe estar en otro
  idioma y `labels[1]` en español, y la tarjeta toma el nombre y el idioma de
  la frase citada; `cta` con «vetsa.es» y la locución final con «vetsa punto
  es», «enlace en la bio» o «en la descripción»; nunca «descarga en vetsa»;
  etiquetas con tildes (#Traducción); formas que asumen el género de quien ve.
- **Forma escrita en subtítulos.** `social_copy.written_words` convierte lo
  que dice la voz en su forma escrita para los subtítulos incrustados y el SRT:
  «vetsa punto es» → «vetsa.es», «x arroba y punto com» → «x@y.com», «14 por
  ciento» → «14 %», sin tocar la prosa («el punto es que…»). El revisor bloquea
  cualquier forma hablada visible en pantalla o en el SRT.
- **Ocupación al inicio de cada plano.** La franja vacía se mide en todos los
  instantes auditados (35 % y 85 % de cada plano y cada subtítulo), no sólo con
  el plano montado. El kit `voice_clone` es ahora una tarjeta que llena el alto
  desde el principio, con la pista de destino en espera hasta que termina la
  clonación.
- La estimación de duración usa 2,9 palabras/s (medido ~3,0 a velocidad 1,05);
  la comprobación estricta se hace con la voz real.

### Videos para clientes, inglés y formato corto (14 de noviembre)

- **Kit de marca del cliente**: carpeta con `brand.json` (nombre, web y sus
  formas habladas, lema, colores, temas, tipografías, logo y logo claro) más los
  archivos y licencias. `tools.produce_social_videos plan|render --brand <carpeta>`
  o, en la app, una carpeta en `<workspace>/motion/brands/` cuya web aparezca en
  la petición. El runtime usa sus fuentes, colores, acentos y logo; Brivany sólo
  aporta el estilo de composición y movimiento. Los kits de cliente se guardan
  fuera del repositorio (`.local/melodi-social/brands/`).
- **Datos del cliente**: `--facts <archivo>` con lo leído de su web; Melodi sólo
  puede afirmar esos datos. En la app aún no hay un paso automático que lea la
  web: hay que aportar el archivo o los datos en la petición.
- **Idioma**: `language` es/en (voz española o inglesa de Melodi en Cartesia,
  2,9 y 2,6 palabras/s); reglas de promesas exageradas también en inglés
  (instant booking, guaranteed, best price, free cancellation…).
- **Formato `short`**: vertical 12–22 s, 4–8 planos, zonas seguras de Reels,
  TikTok y Shorts. La duración pedida se convierte en presupuesto de palabras y
  número recomendado de planos.
- **Kits nuevos**: `villa`, `web_button`, `date_picker`, `stay_picker`,
  `details_form`, `confirmation` y `brand_logo`; todo texto viene de `labels`.
- **Cierre de cliente**: `cta` con su web y la locución final con su forma
  hablada («casa selva azul dot com»); los subtítulos la escriben
  («casaselvaazul.com») y el revisor bloquea formas habladas visibles.

### Sonido más suave (14 de noviembre, a petición del usuario)

Los efectos resultaban molestos y la música empezaba fuerte y bajaba de golpe al
entrar la voz. Ahora la música entra en fundido (1,6 s), la atenuación bajo la voz
empieza 0,3 s antes y es gradual (ataque 0,22 s, recuperación 0,6 s), no hay clics
de tecleo ni «ticks» agudos, se descartan efectos a menos de 0,45 s del anterior y
los que quedan son suaves, filtrados y ~6 dB más bajos.

### Reglas de honestidad que valida el contrato

Rechaza y devuelve a Melodi para que corrija: traducción «instantánea», «al
instante» o «sin retraso»; absolutos como «cada palabra», «no perderte nada» o «sin esfuerzo»; citar la duración en el texto de publicación; latencias en milisegundos; cifras de usuarios;
«todos los idiomas del mundo»; clonación instantánea (tarda unos segundos con
una voz nueva); «perfecto» o «100 %»; correos y enlaces en pantalla; titulares
que repiten la locución o superan ocho palabras; planos `kit` sin
ilustración. Las capacidades presentables y sus límites están en
`services/motion/assets/CAPABILITIES.json`; conviene actualizarlo cuando
cambie el producto. La web de Vetsa no enlaza aún una descarga de Brivany: no
se inventan URLs.

## Cómo pedirlo

En el chat o la voz de Melodi:

- «Crea una historia de Instagram en video promocionándote, con tu voz».
- «Crea un reel para Instagram y TikTok; elige tú un tema que enganche».
- «Crea un video largo horizontal para YouTube sobre lo que puedes hacer».

Una historia sin palabras de video («crea una historia de Instagram con esta
imagen») sigue yendo al generador de imágenes. Para producir con revisión del
guion antes del render (lo usado para los tres videos de esta entrega):

```powershell
.venv\Scripts\python.exe -X utf8 -B -m tools.produce_social_videos plan "<petición>"
.venv\Scripts\python.exe -X utf8 -B -m tools.produce_social_videos plan "<petición>" --revise <plan.json> --direction "<indicaciones>"
.venv\Scripts\python.exe -X utf8 -B -m tools.produce_social_videos render <plan.json> --export Exports\<carpeta>
```

Ambas etapas usan servicios externos con importe desconocido; no son pruebas
rutinarias. Los proyectos, planes y caché de voz quedan en `.local/melodi-social/`
y los informes en `tmp/motion-social/`.

## Pruebas

`tools.verify motion-social` (45 pruebas, sin llamadas externas; la voz es un
sustituto): contrato, rechazo de código y campos extra, reglas de honestidad,
correos y enlaces, tiempos sobre la rejilla del tempo, subtítulos que no
cruzan planos, SRT, capítulos de YouTube, revisor de maquetación, sincronía y mezcla, rutas del router, música y efectos,
reintento con realimentación y un proyecto completo sin render. También pasan
`motion` y las suites de intención e imagen que usan el router.

## Hallazgos técnicos

- `page.evaluate(() => tl.seek(t))` devolvía la línea de tiempo de GSAP y
  Playwright intentaba serializarla: el renderizador se caía («Target
  crashed»). Ahora la llamada no devuelve nada.
- `page.route` y `waitForFunction` también provocaron caídas en este equipo;
  el aislamiento de red se hace con `--host-resolver-rules` y un proxy nulo,
  y la espera con sondeo explícito.
- La unión de tramos paralelos deja una cadencia media de 30,0016; la
  verificación usa `r_frame_rate` y una tolerancia de 0,02.

## Límites

- Las ilustraciones explican funciones; no son capturas del producto.
- El audio se midió (sonoridad, pico, relación voz/fondo, decodificación
  completa) y un reconocedor independiente lo transcribió con 94,7–98,9 % de
  acierto; **no hubo audición humana** en esta sesión.
- Las revisiones de guion de esta entrega se pidieron con indicaciones
  escritas de la sesión de desarrollo; el texto final lo escribió Melodi.
- En la app, la ruta `motion` crea el video sin pausa intermedia para revisar
  el guion; la revisión por etapas existe en la herramienta de producción.
  Una revisión pedida en el chat («cambia el titular del reel») aún no
  reutiliza el plan social anterior.
- macOS y Linux no se probaron. El render usa Microsoft Edge instalado.
