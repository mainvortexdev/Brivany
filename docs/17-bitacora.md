# 17. Bitácora local y evidencias

16 de noviembre, edición privada Jon Demo 0.2.1. Cuenta con presupuesto compartido
de 5 USD en servidor, claves nuevas de Meta/Cartesia/Deepgram cifradas, activación
por equipo y revocación. Instalador con invitación limitada, backend verificado y
Node/FFmpeg; auditoría sin credenciales conocidas ni perfiles. Instalar, abrir,
activar cuenta, sondear backend y desinstalar pasan en perfil separado. Se conserva
la versión pública 0.2.0 y el OAuth oficial de Google por usuario.

Las pruebas reales descubren y corrigen PCM convertido a texto en el proxy
WebSocket. Una frase sintética pasa por Muse, Ink-2 y Deepgram, traducción y voz
Cartesia; el recorrido River termina con PCM de salida. Los primeros rechazos y
una interrupción intermedia permanecen registrados. Saldo reservado restante:
3,4316 USD; factura real y GPU desconocidas. WhatsApp se publica conservando el
servicio y Recall, con cuenta demo por usuario, PC aislado y Telnyx propio API +
número. Quedan pendientes la primera orden desde el teléfono del evaluador, la
captura/escucha física y una llamada real; no se declaran verificadas. Notas de voz
de WhatsApp fuera de la demo. [Guía, pruebas y límites](demo-jon-20261116.md).

16 de noviembre, preparación de la vista previa pública 0.2.0 con instalador
Windows y README de prueba. Contacto cambiado a daniel@vetsa.es y publicado en
la web oficial; se conservan los servicios OAuth de Google para las cuentas del
equipo. Instalación, arranque WebView2 y desinstalación reales en perfil aislado,
con preferencias conservadas; auditoría del paquete sin rutas privadas ni
credenciales configuradas. Pasan contratos, historial, vinculación y dependencias.
Limpieza de cachés identificadas y archivo original de fuentes preservado fuera
de Git. No se acredita aprobación de Google ni prueba completa de proveedores.
[Cambios, comprobaciones y límites](publicacion-20261116.md).

14 de noviembre, sonido de los videos de Melodi más suave. El usuario encontró
molestos los efectos y notó que la música empezaba fuerte y bajaba de golpe. La
mezcla ahora hace un fundido de entrada, baja la música de forma gradual y
anticipada a la voz, y usa menos efectos, más blandos y ~6 dB más bajos. Video de
Casa Selva Azul regenerado sin llamadas externas; revisor sin bloqueos.

14 de noviembre, Melodi hace un video para un cliente: «How to book» de Casa
Selva Azul, 9:16, voz de Melodi en inglés, con la tipografía, los colores y el
logo de casaselvaazul.com. La capacidad suma kits de marca de cliente (fuera
del repositorio), idioma inglés, formato corto de 12–22 s y siete
ilustraciones de reserva. Se leyó la web (5 páginas) y se descargaron el logo y
las fuentes Cormorant Garamond y Montserrat (OFL, con licencia). El guion sigue
la numeración y los botones reales de la web, no da precios porque la web no
los publica y deja claro que es una solicitud. Resultado: 18,2 s en lugar de
15 (seis pasos legibles), 0 bloqueos del revisor, 97 % de acierto de una
transcripción independiente. Consumo: 27 llamadas a Meta (20 rechazadas por el
contrato), 8 voces de Cartesia y 3 transcripciones de Deepgram; importe no
consultado. Sin audición humana ni publicación.
[Entrega](../Exports/Casa-Selva-Azul-Como-Reservar-20261114/LEEME.md).

13 de noviembre, transferencia por el borde PC ↔ móvil. El usuario confirmó
ambos sentidos: receptor OLE y aura por píxel en Windows tras conectar por QR,
selección táctil dentro de la página del teléfono, botón alternativo y cola
acotada. Pasan 19 pruebas locales y recorridos de interfaz, arrastre real entre
procesos propios y contenido bidireccional con Worker local y archivos
sintéticos. Se conservan los fallos intermedios del banco y sus correcciones.
Sin inferencia ni proveedor real; GPU sin medir. No se acredita aún un móvil
físico, publicación ni actualización de la instalación.
[Entrega, pruebas y límites](transferencia-borde-20261113.md).

Comprobación posterior del mismo hito: también pasan WebKit, la sala Worker,
el almacenamiento de Safari y las 22 regresiones de QR/HTTPS. Se corrigió la
puntuación de tres catálogos de idiomas y la sincronización de un ensayo HTTPS;
OpenCV 4.13 se preparó solo en desarrollo (descarga de 40,1 MB). Los fallos
intermedios permanecen registrados. Publicación y reinicio siguen pendientes.

12 de noviembre, tercera revisión de los videos de Melodi. Los subtítulos
copiaban la forma hablada («Más en vetsa punto es») y el plano «Mantengo su voz
al traducir» de la historia dejaba la mitad inferior vacía hasta que terminaba
la clonación; el revisor sólo medía la ocupación con el plano montado. Se
añadió a la capacidad la conversión hablada→escrita para subtítulos y SRT
(«vetsa.es», «@», «%») con bloqueo de formas habladas en pantalla, la
ocupación se mide también al inicio de cada plano y el kit de clonación es una
tarjeta que llena el alto desde el principio. Mismos guiones; 0 llamadas a Meta
y Cartesia, 3 transcripciones de Deepgram (importe no consultado). 43 pruebas
de `motion-social`. Sin audición humana ni publicación.

12 de noviembre, segunda revisión de los videos de Melodi (independiente).
Señaló verticales con el 40 % inferior vacío e ilustraciones de ~40 % del
ancho, un gancho de reel estático, antetítulos redundantes y pleonasmos, una
tarjeta «Lukas · Deutsch» con frase en inglés, llamadas a la acción sin destino
y etiquetas sin tilde. Se corrigió la capacidad: plantillas verticales a toda
la altura con ilustración a todo el ancho seguro, gancho obligatorio con
ilustración en movimiento ya visible en el fotograma 0, revisor que bloquea
franjas vacías, ilustraciones estrechas y ganchos estáticos, y reglas de texto
(`social_copy.py`) para redundancia, pleonasmos, idioma de los ejemplos,
destino real («Más en vetsa.es», «enlace en la bio») y tildes. El revisor
bloqueó dos renders intermedios (reel y YouTube) hasta corregir las
plantillas. Versión regenerada: 0 bloqueos; acierto de una transcripción
independiente 100/97,2/98,9 %. Consumo: 24 llamadas a Meta (14 en intentos
rechazados), 21 voces de Cartesia, 6 transcripciones de Deepgram; importe no
consultado. 41 pruebas de `motion-social`. Sin audición humana.
[Detalle](melodi-videos-redes-20261111.md#composición-gancho-y-textos-revisión-del-12-de-noviembre).

11 de noviembre, revisión de los tres videos de Melodi y corrección de la
capacidad. La revisión encontró: la voz solo 9,5–12 dB sobre la música (1–2 dB
en pasajes suaves), absolutos que prometían de más («Entiende cada palabra»,
«para no perderte nada», «sin esfuerzo»), la duración citada en el texto de
YouTube, un error de concordancia y etiquetas de kits pequeñas en el reel. Se
corrigió la capacidad, no solo los videos: mezcla con más atenuación y hueco
en la banda de la voz (16–19 dB), reglas nuevas del contrato, zona segura de
TikTok en el reel y un revisor automático (`social_review.py`) que bloquea la
entrega por textos fuera de zona, recortados, pequeños o tapados, voz fuera de
su plano o voz poco clara. Versión regenerada: 0 bloqueos; una transcripción
independiente de las mezclas (Deepgram) acierta 94,7/98,9/98,9 % y los
subtítulos quedan a ≤ 180 ms (p95) de la voz oída. Consumo: 3 llamadas a
Meta, 3 voces de Cartesia y 8 transcripciones de Deepgram; importe no
consultado. Pasan 36 pruebas de `motion-social`. Sin audición humana.
[Detalle](melodi-videos-redes-20261111.md#revisión-automática-antes-de-entregar).

11 de noviembre, Melodi crea videos para redes (edición 4). Nueva ruta en
`services/motion`: Melodi (planificador Meta) elige tema, escribe guion,
titulares y texto de publicación y elige entre 15 kits de ilustración animada;
el código local valida el plan con reglas de honestidad (nada de «al
instante», latencias, cifras de usuarios ni clonación inmediata), cronometra
cada plano con su voz real de Cartesia, sintetiza música y efectos en los
instantes visuales, renderiza con Edge sin red y entrega MP4, portada,
subtítulos, texto, capítulos y miniatura de YouTube. Formatos: historia de
Instagram, reel Instagram/TikTok y YouTube 16:9. Pasan `motion-social` (33
pruebas locales, voz sustituida), `motion` y las suites del router.
Prueba real: tres videos en `Exports/Melodi-Redes-20261111/` (16,8 s, 38,0 s
y 1:46; −14 LUFS). Consumo: 21 llamadas de planificación a Meta (6 en intentos
fallidos) y 25 solicitudes de voz a Cartesia; importe no consultado. Fotogramas
y portadas revisados; audio medido, no escuchado. Sin publicación. Hallazgo:
devolver el Timeline de GSAP desde `page.evaluate` hacía caer el renderizador.
[Capacidad, pruebas y límites](melodi-videos-redes-20261111.md).

11 de noviembre, voz live sin respuesta (WorkSpace y chat). Diagnóstico local:
Muse acepta la sesión y transcribe, y Meta responde en 3,2 s. Abriendo la
ventana con depuración WebView2 local, `getUserMedia` falla con
«Requested device not found»: Windows no tiene ningún micrófono activo (los
auriculares Bluetooth G300, G-7000 y siindoo-H6 y la entrada Realtek están
desconectados). No es un fallo de Brivany. El chat ahora explica en español que
no hay micrófono conectado en lugar del error del navegador; comprobado en la
ventana real. Brivany reiniciado sin el puerto de depuración.

11 de noviembre, prueba con video real (95 s de YouTube, descargados con
permiso a `tmp/`). Solo reconocimiento: Deepgram Flux confirma cada cláusula
0,73–0,88 s (mediana) después de decirse, frente a 1,70 s de Ink-2. Se adopta
Flux. Se corrigieron dos fallos que solo aparecieron con habla real: el
separador de cláusulas se atascaba cuando Flux reescribía la puntuación de un
turno largo (ahora cuenta palabras), y el ping de websockets cerraba la conexión
con Deepgram. Hallazgo: la cuota gratuita de Groq (200.000 tokens al día) se
agotó hoy con las pruebas. Con el prompt anterior equivale a ~10–20 min de
Directa diarios; se compactó el prompt del intérprete. La cadena completa en
video real queda pendiente de cuota.
[Detalle](directa-latencia-20261111.md#prueba-con-video-real).

11 de noviembre, Deepgram Flux en la Directa. Con la clave aportada por el
usuario (solo en `.env`) se midieron Nova-3 y Flux en el mismo banco. Flux
confirma cada cláusula en ~1,2 s frente a ~2,3 s de Ink-2. Al empezar a hablar
o tras una pausa, la traducción suena 1,7–2,5 s después frente a 2,8–3,2 s; con
habla continua, la ganancia baja a ~0,2 s porque domina la cola de voz. Nova-3
no mejoró a Ink-2. La Directa usa Flux cuando el destino es español o francés e
Ink-2 cuando es inglés (Flux solo entiende inglés). Pasan 5 pruebas nuevas
del adaptador y las suites de traducción.
[Mediciones](directa-latencia-20261111.md#deepgram-misma-tarde).

11 de noviembre, Directa más rápida. Un banco con narración local y la cadena
real (Ink-2, Groq, Cartesia) mostró que el retraso crecía con habla rápida,
porque el español dura más que el original, y que confirmar cada cláusula costaba
unos 3 s. Cambios: traducción de intérprete con presupuesto de tiempo, velocidad
de voz hasta 1,5×, descarte de cláusulas que llevan más de 3 s esperando y
confirmación con 6 palabras desde el último parcial de Ink. Retraso medio al
final de cláusula: de 7,85 a ~5,5 s con habla rápida y de 4,56 a ~3,9 s con
habla natural. El límite restante es Ink-2, con parciales ~1,5 s por detrás.
Pasan river-translation 123 y el resto de suites de traducción.
[Medición y límites](directa-latencia-20261111.md).

11 de noviembre, primera prueba real correcta del doblaje programado en el Brave
del usuario (extensión 0.6.2, pestaña nueva). La extensión recibió 3.068.993
bytes de subtítulos de YouTube: 3.260 frases con el tiempo de cada palabra. Las
envió a Brivany y la selección quedó como `timeline_only`, con el reloj del
video. La Directa tradujo con Groq en 234–657 ms, con un caso de 3,2 s, y
sintetizó con Cartesia en 0,5–1,2 s. Cada frase se reprodujo en su momento.
Solo la primera, a 7,48 s, llegó 2 s tarde porque la traducción se inició con
el video ya avanzado. El usuario confirma que funciona. La causa del fallo
anterior es probablemente la pestaña con el código de la versión previa, ya
que una recarga de la extensión no lo renueva en las pestañas abiertas. No está
demostrado.

11 de noviembre, extensión 0.6.2 y registro de selecciones. La prueba con 0.6.1
no dejó diagnóstico en el Brave del usuario: la extensión estaba cargada y con
permiso en YouTube, pero la página nunca habló con ella. Se añaden un registro
`worker_started` en la extensión y, en Brivany,
`.local/translation/timeline-events.jsonl`, con selección, subtítulos, reloj,
cierre y etapas del doblaje programado, sin texto. Pasan selected-video 16,
sync-relay 108, river-translation 120, workspace-translation 16,
translation-voices 28 y la extensión 97. Brivany reiniciado; franja de AppBar
limpiada. Pendiente la prueba del usuario.

11 de noviembre, extensión 0.6.1: diagnóstico del corte. En la prueba del
usuario Brave no abrió ninguna conexión con Brivany. Brivany sí acepta la línea
de tiempo: una simulación local de la extensión quedó seleccionada con sus
subtítulos. En Brave aislado, YouTube contestó 200 con 0 bytes a la petición de
subtítulos de su propio reproductor, así que la extensión nunca tuvo
transcripción que enviar. Se añaden un registro local de diagnóstico, sin texto
ni audio, en `chrome.storage.local` y la petición de la pista original cuando
la que llega es una traducción automática de YouTube (`tlang`). Pasan 97 pruebas
de la extensión. Pendiente: leer el diagnóstico del Brave real. Si YouTube
también entrega vacío allí, valorar una API externa de transcripción (p. ej.
Supadata) como respaldo.

11 de noviembre, extensión 0.6.0 silenciosa y doblaje programado. Sin clic
ni textos, la extensión envía a Brivany los subtítulos completos de YouTube, con
el tiempo de cada palabra, y el reloj del video. La Directa traduce y sintetiza
por adelantado y entrega cada frase al inicio de su primera palabra. En la
medición real llegó 9–39 ms tras ese inicio y comprimió sin cambiar el tono.
Falta la prueba en el Brave del usuario.
[Diseño, pruebas y límites](extension-silenciosa-doblaje-programado-20261111.md).

11 de noviembre, extensión 0.5.0: vuelve el modo de traducción en Brave. Se
corrigieron el arranque forzado en «solo transcripción» y un módulo no accesible
que impedía preparar el inicio. Brave aislado aprobado: inicio de 10 s preparado
antes de activar, traspaso exacto y 3 voces. Pendiente la prueba con un video
real y vigilar el bloqueo del PC del 4 de noviembre.
[Reactivación y pruebas](brave-prefijo-10s-groq-20261111.md#reactivación-del-modo-de-traducción--extensión-050).

11 de noviembre, modo video de Brave: inicio preparado de 10 s, traducción
anticipada a español e inglés, Groq para traducir y clonación desde el inicio.
Pasan 108 pruebas de sync-relay, 109 de River y 90 de la extensión. La prueba en
Brave aislado mostró que la extensión activa es la 0.4.11, solo de
transcripción, así que estos cambios no actúan hasta reactivar el modo de
traducción. [Cambios y hallazgo](brave-prefijo-10s-groq-20261111.md).

11 de noviembre, la voz clonada ya no vuelve a una de catálogo. Los grupos de
hablantes se mantienen durante las reconexiones y los trozos cortos o dudosos
siguen al hablante más probable, solo para elegir la voz. 5 pruebas nuevas.
[Causas y corrección](clonacion-automatica-voces-20261111.md#corrección-la-voz-clonada-volvía-a-una-de-catálogo).

11 de noviembre, Groq (Qwen 3.8 27B) traduce la Directa. En la sesión real
Ink-2 → Groq → Sonic, cada cláusula sonó entre 0,46 y 0,57 s después de estar
lista; con Meta se acumulaban hasta 5,1 s. Meta sigue en los modos sincronizados.
[Medición e implementación](groq-traduccion-rapida-20261111.md).

11 de noviembre, Ink-2 sustituye a Muse en la traducción Directa. Cartesia
escucha y habla y Meta traduce. Los hablantes se distinguen por agrupación
acústica local. Prueba real de River: 6 cláusulas completas, primera voz antes
de acabar la frase; Meta sigue siendo el cuello de botella. 8 pruebas nuevas.
[Implementación y medición](ink2-cadena-prueba-20261111.md#implementación-ink-2-sustituye-a-muse-en-la-traducción-directa).

11 de noviembre, cadena Ink-2 → Meta → Sonic (estilo Pocket Interpreter).
Ink-2 cerró cada frase en unos 0,3 s y Sonic habló a los 0,3 s, pero Meta tardó
1,2–1,75 s: de 1,78 a 2,37 s del fin de voz a la traducción audible. No es voz
a voz nativa. Gemini Live (953 ms en octubre) sigue siendo la referencia.
[Resultados](ink2-cadena-prueba-20261111.md).

11 de noviembre, prueba de Soniox. Ofrece transcripción con traducción en un
solo WebSocket, voz en tiempo real y clonación persistente; no tiene voz a voz
en una sola API. La prueba real no se completó: la cuenta respondió 402 por
saldo agotado. Sin voces creadas.
[Documentación y resultado](soniox-prueba-20261111.md).

11 de noviembre, ritmo de la traducción Directa. La voz iba palabra a palabra
con pausas porque se enviaba cada palabra a Cartesia; ahora se envían frases y
la velocidad sube con el retraso (1,1–1,35). La casilla de clonación reinicia la
traducción en vez de quedar bloqueada. Pruebas simuladas correctas; falta escucha real.
[Causa y cambios](clonacion-automatica-voces-20261111.md#corrección-tras-la-primera-prueba-real-del-usuario).

11 de noviembre, clonación automática de voces en YouTube. Cada hablante
agrupado por audio se clona en Cartesia en segundo plano tras 10 s de voz
limpia y su traducción pasa a esa voz. Se elimina al terminar salvo que se
marque Mantener; las guardadas se listan y se pueden borrar. 12 pruebas nuevas
y las suites River y sync-relay correctas, todo simulado; falta prueba real.
[Cambio, pruebas y límites](clonacion-automatica-voces-20261111.md).

11 de noviembre, Cartesia clonó una voz sintética en 4,3 s y habló español con
primer audio entre 0,18 y 0,65 s por WebSocket (coseno local 0,755–0,817);
SiliconFlow no bajó de 1,7 s ni sin clonar. Voz temporal borrada.
[Latencias y límites](siliconflow-clonacion-prueba-20261111.md).

11 de noviembre, prueba real de clonación en SiliconFlow. Cuatro llamadas con
referencias sintéticas en línea, sin subir voces. fish-speech-1.5 clonó al
español en 2,8 s (coseno local 0,793); CosyVoice2 tardó 7,3 s (0,936), devolvió
MP3 pese a pedir PCM y no ofrece streaming efectivo. Un 500 se debe a un
defecto del script. Consumo estimado inferior a 0,01 USD, no verificado.
[Resultados y límites](siliconflow-clonacion-prueba-20261111.md).

4 de noviembre, ensayo real 073. Muse Spark 1.2 completó quince voces hasta
31,700 s con un máximo de 7,745 s. El crecimiento de 3,452 s mantuvo el
resultado fallido. Se compararon seis solicitudes de frases propias antes
del cambio de modelo y se conservaron sus tiempos y tokens.
[Comparación e implementación](traduccion-auditiva-modelo-072.md),
[recorrido real y consumo](traduccion-auditiva-ensayo-073.md).

4 de noviembre, continuaciones 070–071. La imagen espera si tarda el inicio
de una voz y se retira únicamente relleno exterior casi mudo del PCM.
Pasaron 102 pruebas del relay y 77 de extensión. En el ensayo real se
retiraron 1,149 s en quince voces completadas, pero la espera remota mantuvo
el retraso fuera del criterio. Se preserva el ensayo fallido.
[Cambio y prueba propia](traduccion-auditiva-relleno-070.md),
[recorrido y consumo](traduccion-auditiva-ensayo-071.md).

4 de noviembre, ensayo real 069. Quince voces completaron 31,380 s con señal
y sin reserva original. Una voz se publicó por delante de la anterior y se
reprodujo en orden. El tercer turno del prefijo siguió excediendo su duración.
El retraso bajó frente a 065 y volvió a superar ambos límites, con máximo
8,167 s y crecimiento de 3,879 s. Se conserva el resultado fallido y el consumo.
[Publicación, duración y comparación](traduccion-auditiva-ensayo-069.md).

4 de noviembre, continuación 068. El relay entrega una voz lista por delante
de una pendiente y libera un puesto para la siguiente. Brave mantiene el orden
de reproducción. El traductor recibe un rango orientativo de palabras para
las frases de al menos un segundo, con prioridad para el contenido completo.
Pasaron 96 pruebas del relay, 76 de la extensión y 35 del traductor. Se descartó
acelerar los huecos por su escaso ahorro en las mediciones previas.
[Cola y límites](traduccion-auditiva-cola-068.md),
[guía de duración y fidelidad](traduccion-auditiva-guia-lexica-068.md).

4 de noviembre, ensayo diagnóstico real 067. Aprobó los mismos límites de
continuidad en una ventana acotada de 16 s. Nueve voces completaron 17,454 s
con señal. El retraso máximo fue 6,587 s y creció 2,235 s. La tercera síntesis
del prefijo recibió su último bloque a 688 ms y el fin se midió en 0 ms
redondeados después. El alcance de 31 s anterior, el perfil personal y el
video completo siguen pendientes.
[Medición de síntesis, alcance y consumo](traduccion-auditiva-sintesis-real-067.md).

4 de noviembre, continuación 066. La extensión recupera el arranque en
navegaciones autorizadas y espera la raíz del documento. WorkSpace negocia
un informe de compilación activa sin guardar datos del sitio. Brave aislado
comprobó la recuperación y un recorrido propio con prefijo, canción omitida
y cinco voces a 1×. El ensayo real anterior mantiene su fallo de retraso.
Se registran por separado el último bloque de voz y el fin de síntesis.
[Arranque, distribución, pruebas y alcance](traduccion-auditiva-arranque-066.md).

4 de noviembre, corrección posterior 063. La revisión de concurrencia evita
que una evidencia antigua borre una contradicción nueva. Las coincidencias
débiles sin timbre fiable mantienen provisional la voz de esa pieza.
Pasaron 96 pruebas de sync-relay y 68 de River. En el ensayo 065, las diez
coincidencias débiles con voz completada recibieron análisis nuevo.
[Corrección y evidencia](traduccion-auditiva-cache-timbre-063.md#corrección-posterior-de-concurrencia-y-evidencia-antigua).

4 de noviembre, ensayo real 065. Dieciséis voces completaron 31,460 s con
señal y sin reserva de audio original. Las diez coincidencias acústicas por
debajo de 0,77 registraron nueva evaluación de timbre. Hubo ocho voces de
catálogo masculinas y ocho femeninas, con cinco provisionales. La atribución
humana sigue pendiente y la continuidad volvió a fallar, con 10,949 s de
retraso máximo y 6,416 s de crecimiento. Se registran los intentos de
proveedores y los recursos observados del banco y del equipo.
[Voces, retraso, recursos y consumo](traduccion-auditiva-ensayo-065.md).

4 de noviembre, seguimiento personal 064. Tras llevar el video a cero y
reproducir, una lectura a 24,938 s no encontró marcas de preparación del
prefijo ni traducción activa. El servicio seguía emparejado y disponible,
con cero prefijos completos o reutilizados; eso no cuenta todos los intentos
facturables. La causa no está demostrada y no hubo doblaje personal nuevo.
[Observación posterior y límites](traduccion-auditiva-visual-y-carga-064.md#observación-posterior-no-apareció-el-prefijo-en-la-pestaña-personal).

4 de noviembre, verificación posterior 064. El banco mostró las fases del
ensayo 062 y su explicación de simultaneidad sin solaparse a 443 px; la tabla
permite desplazamiento horizontal. Se observó una instancia nativa nueva con
una extensión emparejada y cero sesiones activas, sin forzar el cierre de la
anterior ni recargar la extensión. Los intentos de abrir WorkSpace mediante
el control no quedaron comprobados y no hubo doblaje personal nuevo.
[Presentación, carga nativa y límites](traduccion-auditiva-visual-y-carga-064.md).

4 de noviembre, ensayo real 062. La comprobación directa del video permitió
abrirlo y medir la preparación: 12,059 s de pared, siete segundos de contenido
y análisis local/remoto solapados. Quince voces completaron 31,700 s con señal,
sin recuperar el original. El ensayo volvió a fallar por retraso de 9,479 s
y crecimiento de 5,191 s. La atribución humana sigue pendiente: una voz fue
masculina y catorce femeninas. Se conservan los fallos previos de apertura.
[Fases reales, límites y consumo](traduccion-auditiva-fases-reales-062.md),
[apertura directa y regresiones 061](traduccion-auditiva-apertura-061.md).

4 de noviembre, intento real 060. Tras restablecerse el control, el banco
integrado pudo abrirse e iniciar una prueba nueva; el intento anterior
deshabilitado se conserva. La apertura del video agotó su plazo antes del
doblaje. No hubo sesión de traducción, pero sí una preparación automática
y un intento Muse batch. Faltan identidad, prefijo utilizable y voces;
este fallo no mide las mejoras 058–059 ni supone consumo externo nulo.
[Resultado, ausencias y consumo](traduccion-auditiva-apertura-060.md).

4 de noviembre, continuaciones 058–059. Los restos estables pueden enviarse
antes cuando llevan tres segundos pendientes, conservando tres palabras al
final y al menos 1,8 segundos de audio. La preparación solapa un trabajador de
timbre con dos análisis de prosodia y publica únicamente duraciones numéricas.
Pasaron 94 pruebas sync y siete comprobaciones dirigidas posteriores. El banco
distingue la espera previa de la duración de contenido; su nueva presentación
no quedó comprobada visualmente. El siguiente ensayo no se inició porque el
control indicó que el navegador local estaba deshabilitado en Work. No se
acredita una mejora real por estos cambios.
[Restos estables](traduccion-auditiva-resto-estable-058.md),
[preparación paralela, integración y límites](traduccion-auditiva-preparacion-paralela-059.md).

4 de noviembre, ensayo real 057 con ritmo medido. Catorce voces completaron
31,700 s con señal, sin recuperar el original ni perder voces publicadas
dentro de esa cobertura. El retraso máximo fue menor que en el ensayo previo,
pero volvió a fallar: 9,560 s y crecimiento de 5,256 s. Las solicitudes y
segmentaciones difieren; no se atribuye la mejora observada a una causa única.
El alcance integral, las voces humanas y el video completo siguen pendientes.
[Ensayo, comparación y consumo](traduccion-auditiva-ensayo-057.md),
[matriz de aceptación sin reducir el objetivo](traduccion-auditiva-aceptacion-057.md).

4 de noviembre, continuaciones 055–056. La guía de ritmo usa las duraciones
ya generadas por cada voz y conserva el texto. Pasan 81 pruebas sync y 62 de
River; su efecto real sigue pendiente. El banco correlaciona solicitudes
paralelas mediante índices numéricos, sin conservar identificadores, texto ni
audio: 68 pruebas de extensión y cinco de saneamiento aprobadas. Se distinguen
las esperas remotas y la duración de las voces; no se añaden solicitudes
duplicadas sin evidencia de que mejoren el resultado.
[Ritmo medido](traduccion-auditiva-duracion-medida-055.md),
[diagnóstico por solicitud](traduccion-auditiva-diagnostico-solicitudes-056.md).

4 de noviembre, carga nativa pendiente. La revisión automática rechazó detener
la instancia de prueba para reiniciarla, indicando únicamente «blocked by
policy». El proceso seguía abierto con cero sesiones de video activas. No se
ejecutó el reinicio ni se acreditó la carga del último ajuste de ritmo en esa
instancia; el código y las pruebas locales se conservan.

4 de noviembre, ensayo real 055 desde el inicio. La apertura preparó siete
segundos antes de activar y el ASR continuó exactamente desde ese límite,
sin solapamiento ni voces duplicadas. Trece voces completaron 31,620 s con
señal. El ensayo falló: retraso máximo 11,516 s, crecimiento 7,228 s y
2,365 s de audio original no clasificado como canción. Once voces fueron
femeninas y dos masculinas, sin correspondencia humana verificada.
[Prefijo comprobado, fallos y consumo](traduccion-auditiva-prefijo-real-055.md).

4 de noviembre, continuación 054. Los turnos cortos, el consejo ausente y
el modelo pendiente ya no convierten el tono de voz en una asignación segura.
Se mantiene la voz elegida manualmente y se distinguen dos grupos acústicos
provisionales. Pasan 76 pruebas de sincronización y 62 de River; la comprobación
real de continuidad y atribución sigue abierta.
[Voz sin evidencia y alcance](traduccion-auditiva-voz-ausente-054.md).

4 de noviembre, continuación 053 de empaquetado. Se actualizan los veinte
archivos de distribución con la confirmación de carga del selector y las
mediciones numéricas de audio y recuperación. El banco conserva esas medidas
sin texto ni PCM. Integridad de archivos y pruebas locales no acreditan recarga
del trabajador instalado ni calidad semántica del doblaje.
[Ensayos y límites de la comparación](traduccion-auditiva-comparacion-053.md).

4 de noviembre, comparación real 053 tras preparar ambos transportes. Seis
voces completaron 12,460 s con señal, pero el ensayo volvió a fallar:
8,341 s de retraso y 4,053 s de crecimiento. El primer audio tardó 9,479 s.
La segunda solicitud MT fue más breve; los tramos y tiempos remotos difieren
y no acreditan una mejora global atribuible a TLS. Se detectó además un turno
corto incierto marcado como voz no provisional.
[Comparación, defecto y consumo](traduccion-auditiva-comparacion-053.md).

4 de noviembre, continuación 053 del enlace personal. La solicitud normal
de Work aceptó la selección, pero no inició captura durante una ventana de
60 s: cero bytes PCM, eventos o voces. El ensayo falló; conexión y selección
no acreditan que el módulo cargara. La instantánea 0.4.8 conserva veinte
archivos y permisos; su recarga en Brave sigue sin comprobarse.
[Banco personal, resultado y consumo](traduccion-auditiva-enlace-personal-052.md).

4 de noviembre, continuación 052. Siete voces del video real completaron
13,260 s con señal y desfases de inicio de −17 a +13 ms. El ensayo se rechazó:
el retraso alcanzó 9,701 s y creció 3,168 s. La segunda traducción tardó
4,495 s y retuvo la entrega de la siguiente. La atribución humana de voces
y el recorrido integral siguen sin certificar.
[Métricas, consumo y límites](traduccion-auditiva-continuidad-052.md).

4 de noviembre, continuación 052 del transporte. Los dos traductores del
trayecto sincronizado preparan sus conexiones antes del audio, sin abrir
inferencias para ese calentamiento. Se evita un establecimiento tardío en
el segundo trabajador. Sync-relay pasó 72 casos y River 59; la reducción de
latencia con proveedores reales aún requiere un ensayo posterior.
[Cambio, cancelación y evidencia](traduccion-auditiva-transporte-052.md).

4 de noviembre, continuación 051. Una abstención del modelo conserva su
incertidumbre y usa una voz de catálogo provisional cuando falta evidencia
confiable. Se corrige también el desacuerdo entre categoría e ID real de voz,
y se conserva el timbre preparado con expresividad desactivada. River pasó
59 pruebas y sync-relay 69; son comprobaciones locales, sin inferencia nueva.
[Correcciones y evidencia](traduccion-auditiva-voz-provisional-051.md).

4 de noviembre, continuación 050 del búfer. Se corrige la recuperación de
huecos pequeños sin reiniciar la voz activa. Un nuevo ensayo real terminó
dos frases, con retraso máximo de 6,437 s y crecimiento de 0,464 s, sin cortar
la fuente ni recuperar el original. No acredita haber alcanzado un hueco real
ni resuelve las voces: la primera quedó femenina por reserva tonal y la
segunda masculina. El objetivo completo sigue abierto.
[Recuperación, ensayo corto y límites](traduccion-auditiva-huecos-050.md).

4 de noviembre, continuación 050 de duración y verificación. La guía de
velocidad usa la traducción pronunciada y el banco rechaza cobertura vacía.
Se preservan las 62 pruebas aprobadas y una ejecución posterior con dos errores
por un evento nuevo anterior al error esperado; la comprobación dirigida
posterior no equivale a otra suite completa. También se conserva un intento
que agotó la apertura del video sin iniciar proveedores de traducción.
[Duración y aceptación](traduccion-auditiva-duracion-050.md),
[secuencia posterior y consumo](traduccion-auditiva-integracion-049.md#continuación-050-dos-frases-completas-no-cierran-el-objetivo).

4 de noviembre, integración y prueba real posterior. El paquete 0.4.8 contiene
veinte archivos comprobados y respaldo previo; su recarga en Brave no está
verificada. Desde el minuto cinco se midió una voz masculina con señal, pero
la copia de imagen se detuvo antes de completar la primera frase. El ensayo
falló y no acredita estabilidad ni correspondencia humana de hablantes. Se
conserva también un fallo posterior de cancelación en la suite sync-relay.
[Integración, consumo, publicación y pendientes](traduccion-auditiva-integracion-049.md).

4 de noviembre, continuidad local de hablantes. Se añaden grupos acústicos por
pieza, compartidos entre prefijo y vivo, sin equiparar letras de dos sesiones
ASR. Música y muestras ambiguas no entrenan grupos; las voces permanecen
provisionales. Pruebas locales con voces propias y sustitutos, con límites de
calibración en español natural. [Cambio y evidencias](traduccion-auditiva-hablantes-locales-049.md).

4 de noviembre, revisión del timbre. El clasificador compacto alternaba voces
en los tramos de los minutos cinco y quince. Se incorpora un modelo local
alternativo con incertidumbre explícita y CPU acotada; sus predicciones no
establecen la identidad de una persona. Se conservan los ensayos fallidos y
la falta de verificación integral. [Modelo, mediciones y límites](traduccion-auditiva-timbre-048.md).

4 de noviembre, diagnóstico independiente de la fuente. Tres perfiles aislados
sin extensión reprodujeron el vaciado de YouTube a los 43–44,5 s de un video
de 24:55; la causa sigue sin demostrarse. El banco comprueba identidad,
duración, ancla y pérdida de fuente, y no acepta ese vaciado como fin normal.
[Comprobaciones reales sin traducción y regresión local](traduccion-auditiva-fuente-048.md).

4 de noviembre, preparación anticipada y revisión de calidad. La extensión
prepara siete segundos antes de activar y continúa desde ese límite. Se
conservan los ensayos fallidos y la corrección del criterio de continuidad.
La escucha del fragmento resultó clara y natural, pero el usuario confirmó
asignaciones femeninas incorrectas al presentador masculino. El ensayo de
31,7 s también acumuló 10,415 s de retraso. El objetivo continúa abierto.
[Preparación, continuidad y límites](traduccion-auditiva-inicio-047.md).

4 de noviembre, rendimiento de Brivany en reposo. Una verificación completa
del bundle nativo se repetía en los sondeos de estado. La corrección redujo
el consumo observado de 1,993 a 0,050 núcleos; las acciones conservan su
verificación de integridad. [Cambio y medición](traduccion-auditiva-rendimiento-048.md).

4 de noviembre, banco de Traducción auditiva. Se registra el nuevo aviso de
Meta y la lentitud reportada en Brave. La versión 0.4.6 recupera turnos ante
demoras de Meta y reduce la carga de captura. El banco integrado ejecutó un
ensayo real del video de Tecnonauta. Dos frases llegaron a Web Audio a 1,166×
y 1×. Ambas recibieron timbre femenino. [Cambios, consumo y evidencia](traduccion-auditiva-banco-046.md).

4 de noviembre, estabilidad de Traducción auditiva en Brave. Se registran las
voces trabadas y lentas, la atribución incorrecta y el bloqueo del PC reportado
por el usuario. La extensión 0.4.5 limita la captura, evita pausas repetidas y
devuelve el reproductor ante fallos. Brivany adelanta la entrada a Muse y la
síntesis, corrige la asignación de timbres y guarda diagnósticos sin contenido.
Pruebas con Brave aislado y proveedores sustituidos. Quedan pendientes el
ensayo con el video del usuario y la causa exacta del bloqueo de Windows.
[Cambios, pruebas y límites](traduccion-auditiva-estabilidad-045.md).

4 de noviembre, recuperación de Traducción auditiva. Se documentan el turno
abierto que retenía la imagen, el hueco del grabador y la recuperación con
audio original. Se prueban selección única, espera en pausa y reanudación del
doblaje. [Cambios y pruebas](traduccion-auditiva-recuperacion-044.md).

4 de noviembre, continuación. Extensión 0.4.3 con imagen y doblaje en la
misma pestaña, margen inicial de cuatro segundos y voz a velocidad natural.
Se comprueban tres turnos con voces propias y tres tramos del video público
en Brave aislado. Sigue pendiente el objetivo de latencia para frases largas.
[Cambios, pruebas y límites](traduccion-auditiva-en-pestana-043.md).

4 de noviembre, continuación. Traducción auditiva activa la extensión desde
WorkSpace con acceso concedido al sitio. La transcripción visible es opcional
y se guarda en Ajustes. Se corrigen desbordamiento de entrada a Muse y rechazo
de bloques agrupados. Prueba real de 42 s con dos voces sintéticas propias y
salida WinMM comprobada, con coste desconocido.
[Cambios, pruebas y alcance](traduccion-auditiva-workspace-042.md).

4 de noviembre, corrección posterior: se reproduce un fallo de lectura nativa
que mostraba el error genérico del enlace. Extensión 0.4.1 confirma recepción
desde Brivany, limita bloques pendientes y negocia protocolo antes de capturar.
Pruebas locales y trayecto completo Brave aislado → proveedores → WinMM
registrados por separado, con voz propia y coste desconocido de los ensayos reales.
[Corrección, evidencias y límites](traduccion-auditiva-acuse-nativo.md).

4 de noviembre: auditoría de registros, copias de evidencia, documentación e
informes. Cadena y 1.767 snapshots iniciales íntegros. Se completan referencias
documentales y se recuperan 118 informes históricos con metadatos depurados,
conservando fallos y resultados no concluyentes como retrospectivos.
[Alcance, reconciliación y comprobación](auditoria-bitacora-2026-11-04.md).

4 de noviembre, continuación: extensión 0.4.0 une transcripción y traducción
progresivas, comparte ASR y corrige cancelación por ACK/ráfagas. Pruebas locales,
Brave con demoras provocadas y ensayo propio con APIs reales diferenciados.
[Implementación y límites](traduccion-progresiva-video.md).

4 de noviembre: se corrige la apertura del reproductor vacío desde la extensión.
Pin por video, YouTube único automático, transcripción silenciosa y fuente
seleccionada para WorkSpace. Dos tonos propios comprobaron audio separado en
Brave aislado. [Cambios, fallos y evidencia](videos-seleccionados-y-transcripcion-silenciosa.md).

3 de noviembre, continuación: Brave 0.2.0 prepara frases futuras desde los
subtítulos disponibles sin hablar antes del ASR ni inferir identidad de un nombre
de subtítulo. Caché acotada, cancelación y alternativa de audio verificadas con
sustitutos; carga de extensión y pistas de video propias verificadas en Brave
real aislado. [Implementación, fallos conservados y límites](brave-traduccion-anticipada.md).

3 de noviembre: traducción continua con agentes de hablantes y clonación en
segundo plano, permiso explícito, caché temporal por sesión y limpieza de IDs
propios. Filtro local de canto, con fallo a cappella inicial preservado y cinco
casos controlados reales tras corregir. Protocolos, UI y cancelación sustituidos;
clonación personal real y fidelidad pendientes. [Implementación y límites](traduccion-canciones-y-voces-temporales.md).

1 de noviembre, siguiente dirección del usuario: comandos suficientes con 65
aprobados; se detiene su ampliación, conservando el rechazo de CLIP antes de su
ejecución y el portapapeles intacto. Agentes de medios y soporte conectados al
chat/voz: extracción y traducción de video probadas con Melodi real y una muestra
propia, lectura del manual oficial Epson contrastada, búsqueda de controladores
en Windows Update sin instalaciones durante la comprobación. Interfaz de medios
verificada en tres anchuras con sustitutos. La nueva instalación física de un
controlador queda sin certificar. [Implementación y siguiente web pública](melodi-medios-documentacion-y-web.md).

1 de noviembre, comprobación posterior: Office quedó instalado sin activar por
elección del usuario, con seis aplicaciones firmadas por Microsoft y apertura
real de Word/Excel/PowerPoint. Se conservan los intentos interrumpidos y se
distingue instalación de licencia. La checklist alcanzó 64 aprobados, con
CHKDSK sólo de lectura revisado. El ensayo completo de clonación y evidencia por
Melodi y una muestra EXE C# sí pasaron; uso dentro del IDE, checklist completa y
macOS continúan pendientes. [Office y equipo](terminal-equipo-y-office.md#cierre-comprobado-de-esta-instalación),
[pruebas de terminal](terminal-melodi.md#comprobaciones-posteriores-del-1-de-noviembre).

1 de noviembre: consultas reales de tiempo de arranque, virtualización y
hardware conectadas a Melodi. Esperas cancelables de apagado con pruebas de
reloj/acción sustituidas, sin apagar el equipo. Instalador Office por productos
y apps, herramientas Microsoft firmadas y descarga oficial en curso, sin
activación. El usuario confirmó no tener licencia y eligió instalar sin activar.
[Implementación y alcance](terminal-equipo-y-office.md).

1 de noviembre, corrección de alcance solicitada por el usuario: se retiran
servidores y administración empresarial del catálogo de Melodi. Selección
activa: 190 comandos de escritorio y 231 atajos, más el índice macOS preliminar.
Se conservaron los 36 aprobados durante la migración y sus recibos; los retirados
no se aprobaron. La checklist continúa con comandos de escritorio útiles.
[Alcance vigente](terminal-melodi.md#alcance-vigente-corregido-por-el-usuario).

1 de noviembre: nuevo objetivo de terminal. Catálogo documentado y checklist
secuencial con recibos/revisión, especialista del chat, bloqueo del registro y
copia aislada de ProjectFixture-Trading-Operator. Compilación y salud local comprobadas;
captura real y corrección del guardado en Bloc de notas. El catálogo no equivale
a miles de ejecuciones aprobadas. Se conservan los fallos de PS1, limpieza del
test y plan incompleto. [Implementación y límites](terminal-melodi.md).

31 de octubre: reintento de acceso al navegador integrado confirmado y Brivany
iniciado con WorkSpace. El argumento de inicio ya no fuerza Pantalla desplegada;
`work` pasó 26 pruebas locales. La inspección nativa confirma barra y reserva,
sin acreditar todavía toda la interacción de arranque. Google y el diagnóstico
del corte de audio siguen pendientes con el objetivo general pausado.
[Alcance y evidencia](workspace-reinicio-intencional.md).

Spotify ya tiene un retorno HTTPS desplegado en
`https://brivany.example/spotify/callback`, con PKCE nativo y puente temporal en
Cloudflare. Se configuró el Client ID público y se corrigió un rechazo de
certificados en el transporte Python hacia Spotify, manteniendo TLS verificado.
Se distinguen pruebas locales, puente HTTPS con proveedor sustituido y transporte
Spotify real sin credenciales; la autorización de la cuenta queda en el usuario.
[Implementación y alcance](spotify-retorno-https.md).

31 de octubre: WorkSpace compacto con curvas en cuatro esquinas, herramientas
solo de texto, ojos en una zona central propia, apertura por intención y cambio
rápido entre paneles. Música muestra un botón de vinculación; su Client ID de
editor sigue pendiente de registrar/configurar. [Cambio y pruebas](melodi-workspace-compacto.md).

También se preparó `https://brivany.example` como Custom Domain de un Worker
independiente, con una página temporal de preparación. DNS público y HTTPS 200
se comprobaron; la web oficial queda para el siguiente hito. Código y despliegue
declarativo en `official-site/`, sin exponer el servidor local ni un callback OAuth
en la web pública.

Nueva revisión de Melodi WorkSpace: negro opaco, herramientas horizontales,
panel anclado al cursor, ojos itinerantes con reposo y reproductor Spotify con
vinculación PKCE, dispositivos y letra local. Se retiraron las tarjetas y los
módulos de Voz/Tareas de esta superficie. Las pruebas locales y la comprobación
nativa se distinguen de la vinculación Spotify real, que sigue pendiente del
usuario. [Implementación, evidencias y límites](melodi-workspace-premium.md).

Melodi WorkSpace reemplaza el nombre Mini Melodi e incorpora una barra superior
de ancho completo con reserva AppBar de 40 px en Windows y panel flotante
independiente. Ventanas propias ya maximizadas/nuevas respetaron la franja; el
despliegue no amplió la reserva y salir restauró el área anterior. Se conservan
transparencia, proximidad tolerante, ojos ocasionales y exclusión de la barra de
tareas. [Arquitectura, pruebas y límites](melodi-workspace.md).

Mini Melodi: isla nativa superior con expansión por proximidad, tolerancia de
salida, ojos ocasionales y transparencia regulable. La arquitectura de extensión
y Office quedó postergada por indicación del usuario. Se distinguen UI sustituida
y comprobación real de región/alfa de ventana, sin activar audio ni modelos.
[Diseño, comportamiento y comprobaciones](mini-melodi-isla.md).

Actualización del 30 de octubre: Edits MCP, habilidades desde voz live, Work y
esperas de Melodi. Ensayos reales aislados de MCP/exportación y ventanas nativas;
reloj, detección/traducción y entregas se verificaron con sustitutos. Audio físico
y Drive/WhatsApp reales siguen pendientes. Se conserva también el fallo y la
corrección de una expectativa antigua de agrupación de frases.
[Implementación, evidencias y límites](melodi-edits-work-eventos.md).

Actualización del 30 de octubre: chat de escritorio, referencias visuales y
agentes locales con resultados revisables. UI y voz sustituidas se distinguen
de visión Meta y Paint reales con imágenes sintéticas. No acredita hardware live
ni gestión completa de Google.
[Implementación, pruebas y límites](melodi-chat-imagenes-agentes.md).

El hito 55 incorpora expresividad live, chistes por turnos y pausas silenciosas.
La interrupción automática se habilita con AEC confirmado, conserva un pre-roll
local acotado y el contexto efímero. Las suites usan señales/modelos sustituidos;
la comprobación HTTP local usa casos sintéticos conocidos sin inferencia. Una
síntesis real separada aceptó `[laughter]`, con importe desconocido, sin guardar
audio nuevo. No acredita naturalidad ni interrupción con hardware físico.
[Comportamiento, pruebas y límites](55-melodi-expresiva-y-turnos.md).

El hito 54 cambia el ritmo inicial a 1,05, enviado a Cartesia con reproducción
PCM nativa, y despacha el final Muse sin esperar el medidor. Suites locales
con sustitutos y una síntesis real separada, sin retries; importe desconocido.
[Cambio y alcance](54-melodi-ritmo.md).

El hito 53 simplifica Melodi a Comenzar y elimina la segunda espera acústica
después del final de Muse. `live-ui`, `app-ui` y `javascript` verifican inicio,
ruido continuo, reproducción y cancelación con sustitutos. La herramienta
separada `tools/check_melodi_real.cjs --allow-paid` ejecutó una única sesión
real con fixture sintética reutilizada: Muse, una respuesta Meta y una síntesis
Cartesia, con PCM reproducido por el navegador. Importe desconocido; sin prueba
física de micrófono/altavoz ni conservación de conversación/audio nuevo.
[Alcance y resultados](53-melodi-un-boton.md).

El hito 52 cambia la voz de Melodi a Cartesia con IDs propios de español e
inglés. `melodi-cartesia` recorre protocolos WebSocket/HTTP locales con servidor
de voz sustituto; `live-ui` usa micrófono/ASR/Meta/TTS sustituidos y verifica el
idioma y la interrupción. No hacen inferencia pagada ni prueban micrófono o
altavoz físico. La prueba live real queda al usuario. [Detalle](52-melodi-cartesia-live.md).

El hito 51 conecta la traducción vigente a `/dubbing` y al arranque compartido
web/Desktop. `brivany-translation` comprueba rutas, factories y estado local;
`main-navigation` requiere el servidor principal activo y solo lee portada/UI;
`river-ui` recorre YouTube sustituido y un archivo sintético realmente decodificado
dos veces, con modelos/dispositivo sustituidos. No consumen inferencia externa.
Las herramientas de UI de doblaje anteriores son históricas y no acreditan la
página sustituida. [Integración y resultados](51-traduccion-integrada.md).

El hito 50 retira las cuotas de aplicación de la página de traducción por
petición expresa del usuario. `river-translation`, `river-ui` y
`meta-translation` siguen siendo pruebas locales con modelos sustituidos.
Los relojes acelerados no acreditan una reproducción real larga.
`tools.check_river_voices --check-access` consulta dos metadatos reales sin
síntesis y queda fuera de `tools.verify`. [Cambios y evidencia](50-traduccion-continua-y-voces.md).

Desde el hito 49, `river-translation` y `river-ui` usan traducción Meta Spark
sustituida. `meta-translation` prueba su transporte SSE y presupuesto local;
`native-audio` comprueba además regulación de ráfagas y cancelación con driver
sustituido. No hacen inferencia externa. Los registros del recorrido Groq
anterior permanecen como histórico. [Cambio, pruebas y límites](49-meta-cartesia-y-ritmo-de-audio.md).

`river-translation` y `river-ui` verifican la ruta Muse → Groq → Cartesia con
proveedores, YouTube/captura y salida de dispositivo sustituidos; no consumen
inferencia externa. La comprobación manual `tools.check_river_access
--check-access` sí consulta dos endpoints reales de metadatos y queda fuera de
`tools.verify`. La herramienta `tools.check_river_real --allow-paid` tampoco
pertenece a esas suites: consume una sesión real con una única fixture sintética
aprobada, sin retries ni conservación de audio/transcripción. El importe queda
desconocido hasta contrastar facturación. [Arquitectura y resultados](48-muse-llama-cartesia.md).

27 de octubre de 2026. Abrir [Bitácora](http://127.0.0.1:8765/activity) con el servidor habitual de Brivany. Permite buscar, filtrar por tipo/estado, revisar evidencias, cargar páginas anteriores y exportar lo consultado como JSON.

## Qué se registra

Actividades de desarrollo: ideas pendientes, decisiones, implementaciones y resultados de pruebas. Cada registro conserva fecha de anotación UTC (la web muestra La Paz), resumen, estado, consumo conocido y evidencias opcionales. Una prueba con resultado necesita al menos una evidencia adjunta. Un valor de consumo desconocido permanece sin registrar; no se convierte a cero.

Las evidencias se copian al registrarlas y se identifican con SHA-256. Cambiar el archivo original después no altera la copia conservada. La web comprueba hash y tamaño al consultar, muestra si falta o cambió la copia y bloquea servir una evidencia alterada. El contenido adjunto permite revisar la afirmación: un hash por sí solo no confirma su corrección ni la precisión de un modelo.

Los registros se añaden en transacciones SQLite, enlazando cada entrada al hash anterior. Esta cadena detecta ciertas alteraciones accidentales; **es local, no está firmada y no es una auditoría independiente**. Quien controla el disco puede sustituir la base completa o recalcular la cadena; borrar el último tramo tampoco se detecta sin una referencia externa conservada. La aplicación no ofrece edición o borrado de entradas; una corrección se registra como otra actividad.

El histórico empieza al crear esta bitácora. Las etapas anteriores pueden incorporarse como retrospectivas que enlazan informes existentes y lo indican expresamente. No se inventan fechas de ejecución ni pruebas pasadas. La fecha visible es la de registro, no necesariamente la del trabajo descrito.

## Guardado y límites

Base: `.local/activity/activity.sqlite3`. Evidencias: `.local/activity/artifacts/<sha256>`. Todo permanece en el equipo y está excluido de Git. No registra conversaciones, audio, videos originales, secretos o sesiones de uso automáticamente. Es una herramienta de desarrollo, distinta de un historial del usuario de Melodi.

Cada entrada admite ocho evidencias de hasta 2 MiB, dentro del proyecto y con extensiones de documento, código, informe o PNG. Se rechazan rutas externas y carpetas ocultas, incluida `.local`; `.env` tampoco es una evidencia admitida. La API es solo de lectura, aplica la protección local de Host/origen y conserva `no-store`. La PWA guarda el shell de la vista, no los registros ni las evidencias. No hay publicación, cuentas ni sincronización remota todavía.

## Registrar cambios e ideas

Desde la raíz del proyecto:

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.activity idea --status pending --title "Nueva capacidad" --summary "Alcance previsto; pendiente de implementación."
.\.venv\Scripts\python.exe -X utf8 -B -m tools.activity implementation --status implemented --title "Cambio terminado" --summary "Qué cambió y su alcance comprobado." --evidence docs/17-bitacora.md --external-calls 0 --gpu-seconds 0
```

Los tipos son `idea`, `decision`, `implementation` y `test`. Los estados son `pending`, `implemented`, `passed` y `failed`; solo las pruebas usan `passed`/`failed`. Para una corrección, añadir un registro que mencione el ID anterior.

## Pruebas con registro automático

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify python
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify spatial
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify spatial-worker
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify spatial-vendor
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify spatial-ui
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify spatial-local
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify javascript
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify contracts
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify activity-ui
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify app-ui
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify activity-local
```

Elegir la suite que resuelva la duda del cambio; no es necesario ejecutar todas siempre. El comando conserva inicio/fin, duración, argumentos, código de salida y salida de consola en `docs/verification-history/`, guarda una copia en la bitácora y termina con el código real de la prueba. Un fallo también queda registrado. Límite por suite: 180 segundos; salida conservada hasta 100 000 caracteres. Las suites listadas son locales con proveedores simulados y no consumen inferencia Meta/Modal. No ejecutar pruebas de proveedor real a través de este comando sin actualizar primero esa declaración.

`javascript` incluye las ventanas de energía del doblaje. `dubbing-timing`
recorre la interfaz, AudioWorklet y relay reales con upstream de traducción
simulado; requiere Playwright/Edge y FFmpeg, sin inferencias pagadas. Conserva
referencias de energía y timestamp estimado del dispositivo, sin acreditar audio
físico ni el objetivo de 500 ms. El ensayo real de `tools/measure_dubbing_browser.cjs`
exige `--allow-paid`, usa una sola fixture sintética fija y una sesión sin
reintentos; su informe se registra explícitamente como prueba real, fuera de
estas suites gratuitas.

`dubbing-stream-timing` usa el mismo recorrido simulado con dos frases sintéticas
de hash fijo. Requiere preparar antes la fixture con
`python -m tools.prepare_dubbing_stream_fixture` en un equipo con Windows Zira y
FFmpeg; el WAV debe coincidir con la versión aprobada. Rechaza fuentes distintas
antes de abrir la sesión. No debe confundirse una salida rápida del proveedor
simulado con traducción real. [Preparación y evidencia](27-doblaje-por-fragmentos.md).

`openai-translation-pipeline` comprueba el mismo reproductor contra un stub
OpenAI exclusivo de loopback: frames, ráfaga de salida, subtítulos y cierre.
No usa la clave real ni evalúa un modelo. `http` ejecuta las pruebas locales de
la API y los formularios en directorios temporales. Ambas registran cero
llamadas externas. El ensayo real con OpenAI exige credencial separada y
`--allow-paid`; queda fuera de estas suites.

`dubbing-review-pipeline` y `dubbing-review-rejection` usan el upstream OpenAI
simulado para comprobar la conservación optativa y su rechazo sin repetir una
sesión. Solo pueden conservar la salida de las fixtures sintéticas aprobadas;
los WAV quedan fuera de la bitácora. [Detalle y límites](29-revision-audio-sintetico.md).

`activity-ui` necesita Playwright y Edge como las otras comprobaciones de interfaz; acepta `BRIVANY_PLAYWRIGHT_PATH` y `BRIVANY_BROWSER_CHANNEL`. Comprueba archivos reales de la interfaz con datos simulados; la lectura de API y evidencia reales se comprueba aparte.

`activity-local` requiere servidor activo y al menos un registro con evidencia. Comprueba la página y API reales, descarga una evidencia y compara su SHA-256; conserva capturas de móvil/escritorio. Solo hace lecturas locales y no verifica el significado de los informes.

`spatial` comprueba contratos, cola, almacenamiento, presupuesto y worker con
modelos sustituidos. `spatial-worker` revisa la definición preparada sin importar
el SDK Modal ni ejecutar GPU; `spatial-vendor` verifica hashes e imports locales.
`spatial-ui` recorre servidor temporal, SQLite y WebGL reales, mueve un objeto
con el control de ejes y prepara seis fotogramas de un video sintético. Permite
renderizado por software. `spatial-local` requiere el servidor activo en 8765
y comprueba solo lecturas, selección y adaptación en la instalación disponible.
Las capturas de pantalla muestran geometría procedural de demostración. Estas
suites no invocan modelos ni demuestran reconstrucción, medidas, física o
funcionamiento en dispositivos físicos. [Alcance del visor](31-infraestructura-y-visor.md).

La continuación espacial agrega pruebas de historial persistente, variantes,
exportación, revisión manual y recuperación offline dentro de `spatial`. El
respaldo se comprueba con fixtures temporales y sondas de servidor simuladas;
no se copia la instalación privada real. La revisión de imagen no acredita
reconocimiento, cobertura ni fidelidad. [Métodos y límites](32-revision-y-edicion-espacial.md).

## API y archivos

Las suites `spatial-render`, `spatial-physics`, `sous-ui`, `sous-pipeline` y
`desktop` verifican los nuevos componentes locales. El render permite WebGL por
software y la física usa parámetros asumidos. Sous usa proveedores sustituidos;
`desktop` comprueba servicios y puente sin ventana nativa. No consumen inferencia
externa y no acreditan reconstrucción, reconocimiento, realismo físico ni
compatibilidad con dispositivos físicos. [Alcance y evidencia](34-render-local-sous-y-proyectos.md).

`sous-voice` y `sous-voice-pipeline` prueban contexto/HTTP y conversación con
proveedores/micrófono sustituidos. `desktop-ui` usa archivos reales con selector
nativo sustituido; `spatial-modal` usa un SDK sustituido, sin autenticación ni
GPU. La consulta real `tools.check_sous_vision_real --allow-paid` queda fuera de
`tools.verify`: hace una solicitud pagada como máximo, registra tokens e importe
desconocido y no utiliza fotos del usuario. [Entrega y límites](35-voz-sous-desktop-y-modal.md).

`google-oauth`, `personal-providers`, `connections-http`, `connections`,
`whatsapp-gateway`, `sous-catalog`, `floorplan-ui`, `plan-settings` y
`portable-floorplan` usan cuentas/modelos/transportes externos sustituidos.
OAuth comprueba cifrado DPAPI real sólo de secretos sintéticos. Las pruebas de
planos usan geometría y medidas de demostración; no certifican escala, física,
precisión arquitectónica ni selectores nativos. No son pruebas de entrega de
WhatsApp ni autorizaciones Google reales. [Alcance](36-conexiones-planos-y-catalogo.md).

| Recurso | Función |
|---|---|
| `GET /api/activity?before=<secuencia>` | Hasta 200 registros más recientes; cursor para anteriores e integridad de la cadena |
| `GET /api/activity/<id>/evidence/<índice>` | Copia conservada; texto plano o PNG, después de verificar su hash |
| `services/activity.py` | Registro transaccional y copias de evidencias |
| `tools/activity.py` | Anotación explícita desde terminal |
| `tools/verify.py` | Ejecución acotada de una suite y registro del resultado |
| `web/activity.html`, `activity.css`, `activity.js` | Vista responsive, filtros y exportación |

La exportación JSON conserva metadatos, hashes y URLs locales de lo cargado. No incluye automáticamente los bytes de las evidencias ni toda la base si quedan páginas por consultar. Para respaldo completo se deben conservar la base y su carpeta de artefactos juntas; este respaldo y su restauración siguen pendientes de automatización.

Las suites `spatial-ingest`, `ingest-ui`, `personal-notes`, `personal-ui`, `social` y `social-ui` comprueban publicación local de resultados, recordatorios/notas y borradores/revisión social. Usan geometría generada y transportes SDK/Graph sustituidos; no acreditan reconstrucción, alarmas del sistema, cuentas, visibilidad o gasto real. `connections-http` incorpora los endpoints sociales privados. [Detalle del hito](37-resultados-3d-recordatorios-y-redes.md).

`spatial-room`, `spatial-room-render`, `spatial-assistant`, `spatial-assistant-ui`, `presentation`, `presentation-ui` y `chat-requests` prueban geometría conocida, comandos/contexto y recorridos privados con datos generados y proveedores sustituidos. `request-latency-local` mide HTTP/SQLite temporal, sin pintado, red remota ni audio. El control `TurnBudget` se comprueba en `javascript`; su cancelación no acredita latencia del proveedor. [Hito38](38-multivista-asistencia-y-solicitudes.md), [respuesta](39-tiempo-de-respuesta.md).

La auditoría del 29 de octubre reúne resultados locales y sustituidos en [docs/40-auditoria-casos-de-uso.md](40-auditoria-casos-de-uso.md). `portable-presentation` comprueba carpeta, cámara, revisiones, ZIP y puente nativo sustituido; `chat-requests-ui` usa mensajes sintéticos firmados y proveedores sustituidos. `additional-usecases` recorre seis usos exploratorios locales y no prueba demanda de mercado. `live-ui` y `human-skills-ui` preservan audio/modelos sustituidos; `room-dispatch` usa SDK Modal sustituido. El PDF se conserva en la raíz; su manifiesto/validación/render son evidencia admisible, sin ampliar la lista de extensiones para adjuntar PDFs arbitrarios a la bitácora.

`room-ingest` y `room-ingest-ui` comprueban resultados multivista, cámaras, fuentes
firmadas, biblioteca, render, respaldo y portabilidad con geometría sintética y
SDK Modal sustituido. No ejecutan proveedores ni GPU de inferencia. Un resultado
rápido de fixture o su coherencia de hashes no acredita reconstrucción real,
precisión profesional ni dispositivos físicos. [Hito41](41-ingreso-multivista-y-portabilidad.md).

`palabra-live`, `youtube-source` y `youtube-dubbing` comprueban protocolo, captura,
iframe sustituido y salida separada con datos sintéticos; no se ejecuta inferencia
externa. La herramienta `check_youtube_embed_real` queda fuera de esas suites:
consulta el iframe público real sin Play ni traducción y sí hace tráfico de red
normal de YouTube. [Uso y evidencia](44-youtube-live-con-palabra.md).

La comprobación de control del navegador del 30 de octubre usa perfiles nuevos de
Chrome/Windows. Google y lectura de resultados, pestañas/clic, búsqueda de canción y
artista en YouTube, pausa/reanudación y entrega de acceso GitHub quedaron comprobados
nativamente dentro del alcance descrito. Una orden completa pasó por HTTP, router y
planificador Meta y actuó en páginas sintéticas con el ejecutor real. No acredita
credenciales, micrófono/altavoz físicos ni todos los navegadores. Se conservan fallos,
coste desconocido y pruebas sustituidas por separado. [Detalle y repetición deliberada](pruebas-navegador-melodi.md).

La preparación local del backend de Melodi del 30 de octubre empaqueta los módulos
fijados de Cognira con Electron/Three.js, sin copiar perfiles ni claves. Arrancó el
ejecutor, escribió una nota sintética y publicó tres GLB con el runtime incluido,
sin Node global ni inferencia. El paquete quedó activado; una alteración no habilita
un fallback silencioso. Las suites locales comprobaron también cancelación del
compilador y el recorrido sustituido de live/visor. macOS/Linux y el instalador
completo siguen pendientes. [Evidencia y alcance](backend-local-melodi.md).

La prueba sintética de creación 3D del 30 de octubre recibió cuatro respuestas de
Meta y publicó una mesa de cinco piezas mientras otra conversación se respondía.
Importe desconocido; no se usaron micrófono, Muse ni Cartesia. La inspección visual
encontró el micrófono fuera de pantalla y el visor detrás de la biblioteca: se
conserva ese resultado y se añade la corrección de barra, vista incrustada y estado
de voz visible. La escena se reutilizó sin nueva inferencia para verificar siete
tamaños y los cierres de opciones/contexto. [Resultados y límites](modelo-real-y-live-melodi.md).


31 de octubre: reproductor Spotify horizontal, biblioteca paginada y letras
automáticas con LRCLIB y respaldo Lyrics.ovh. Se retiraron la importación local
LRC/TXT y la desconexión de WorkSpace; las cuentas se gestionan en Conexiones.
Permisos de biblioteca desplegados en el puente HTTPS; autorizaciones anteriores
requieren ampliar acceso para biblioteca y conservan reproducción. Se distinguen
pruebas sustituidas, geometría Windows real y proveedores HTTPS anónimos reales:
LRCLIB devolvió 502 y el respaldo respondió 200. No acredita toda la cobertura de
letras ni reproducción física de la cuenta. [Implementación y límites](spotify-biblioteca-letras.md).


31 de octubre: portadas mosaic corregidas, distinción de reproducción actual e
historial, ondas ambientales/degradados de portada y teleprompter de tres filas.
Se eliminan enlaces, controles de letra y paginación visibles. Se incorpora host
nativo aislado del SDK como dispositivo Brivany, con permisos publicados. Windows
real admitió Widevine; registro/audio de la cuenta requieren ampliar autorización
Premium. No se confunden fixtures con reproducción física. [Implementación,
pruebas y límites](spotify-workspace-dispositivo.md).


31 de octubre, hora de La Paz: corregido audio local del SDK mediante host fuera
de pantalla renderizado; usuario confirmó audibilidad. Controles directos,
permanencia de ondas cinco minutos, nuevo personaje, letras con tiempos de
SyncLRC y cola multipista con continuidad. Se retira Recientes y se conserva el
histórico de fallos. La prueba real final pasó anterior/siguiente, progreso,
volumen, aleatorio, repetición y cambio natural de pista sin orden next.
[Implementación, evidencia y límites](spotify-audio-personaje-continuidad.md).


31 de octubre: Melodi musical incorpora audífonos y baile suave/rítmico/animado,
con estimación local de metadatos y letra temporizada, sin captura de audio ni
inferir BPM real. Letras con transiciones de filas y mezcla progresiva de paleta
entre canciones; conserva permanencia de ondas y movimiento reducido.
[Implementación, pruebas y límites](melodi-musica-expresiva.md).


31 de octubre: proyecto Google independiente Brivany, web pública de privacidad y
condiciones publicada y enlaces registrados en Google. Se corrigió el retorno
OAuth con emisor `iss` y se vincularon realmente los tres servicios de la cuenta
personal indicada, separada de la administradora. Las consultas reales de Gmail,
Drive y Calendar pasaron con permisos de lectura; no se guardó contenido privado
en evidencias ni se ejecutaron escrituras. El estado de Google continúa siendo de
prueba. [Proyecto y web](google-proyecto-y-web-legal.md),
[vinculación real, pruebas y límites](google-vinculacion-real.md).


31 de octubre: se simplifican Conexiones y los avisos de agentes; Brivany incorpora
bandeja residente Windows con el icono original `b` y punto azul. La combinación
vigente es Georgia para títulos y Segoe UI para texto y controles. Por petición
del usuario se retira la edición local de navegador y se cierran sus pestañas;
el renderizador se conserva dentro de la ventana nativa. WorkSpace y las tres
autorizaciones Google siguen activos tras el reinicio. Se mantienen las páginas
legales públicas, dejando la web de presentación para después. Se distinguen las
suites con sustitutos, los ensayos nativos aislados y las lecturas de estado de
la aplicación real. [Implementación, correcciones y límites](escritorio-identidad-y-bandeja.md).


31 de octubre: WorkSpace se reduce a Traducir, Música y Abrir app; se retiran la
hora y los accesos señalados. Traducir reúne selección de área, acceso a video y
detección de idioma del audio sin el texto ornamental. Chat sin símbolo de barras
ni «Estoy contigo», controles SVG unificados y botones sin contornos de foco.
Pasaron `work` (28 pruebas), UI del chat y UI de WorkSpace con sustitutos; se
conservan los fallos previos y la corrección de la zona central a ancho pequeño.
[Implementación y límites](workspace-traduccion-y-controles.md).


31 de octubre: logo completo a la izquierda y accesos directos Traducción auditiva
y Selección de área en WorkSpace; se retiran el modal intermedio, el detector de
idioma y Explicar. Reducción gradual de la música local de Brivany ante otros
sonidos, con exclusiones de juegos y sin grabar audio. Por la última indicación,
su control se retira de la barra y queda activado por defecto en Ajustes de la
app. Se distinguen simulaciones, detección Core Audio real con tono sintético y
estado real de la app reiniciada; se conserva el primer fallo del comprobador.
[Implementación, evidencia y límites](workspace-accesos-y-musica-automatica.md).

1 de noviembre: web oficial publicada en https://brivany.example, conservando
Worker, dominio, páginas legales y retorno OAuth. Georgia/Segoe UI, modelos 3D
operables de ordenador, móvil y gafas, habitación con selección y movimiento
limitado de silla, exportación PNG, instrucciones copiables y extracción WAV
local en el navegador. Anchos 320/390/768/1280 sin desbordamiento; pruebas HTTP
en producción, extracción real de un video propio y suite OAuth aislada de 34
casos. Se conserva el primer fallo de descarga PNG y su corrección a Blob.
Móvil/gafas son conceptos; la instalación física de drivers continúa sin
certificarse. Brivany está ejecutándose con WorkSpace visible y panel oculto.
[Implementación, evidencia, publicación y límites](web-oficial-interactiva.md).

1 de noviembre, continuación del objetivo de terminal: se corrige la detección
que confundía Antigravity 2.x con Antigravity IDE. Melodi abre una copia local
existente, prepara un workspace independiente y ejecuta una configuración
observada del depurador, sin escribir comandos en una terminal ni capturar el
ratón. Pasó el ensayo real por planificador y adaptador nativo, salud HTTP y
fuente Git limpia; captura nueva en Escritorio/Evidencia Melodi. Se verificaron
parada, nuevo arranque y reconocimiento de sesión activa sin repetir F5.
Quedan los tres fallos previos y sus correcciones, incluidas espera de arranque
lenta y conversión del handle UIA. Suites: terminal 44, terminal-ide 11, computer
24 y computer-native 30; los sustitutos no cuentan como comandos aprobados.
Seis planificaciones reales, importe desconocido y red total no medida. Brivany
reiniciado con WorkSpace activo y panel con región vacía; cerrados sólo dos
servidores de prueba propios. Checklist sin avanzar: 65 aprobados. No se declara
cumplimiento de 2.000 comandos, macOS ni navegación Regedit.
[Implementación, fallos, evidencia y límites](terminal-ide-real.md).

1 de noviembre, entrega posterior solicitada por el usuario: Normal y Acceso
completo en Ajustes, guardados por el backend; revisión concreta para papelera
y sobrescritura en ambos modos, y para movimientos en Normal. Caducidad, un uso,
revocación y comprobación de contenido/identidad. Copia anterior al sustituir;
papelera sin borrado permanente alternativo. La limpieza conversacional de
temporales sólo prepara una vista previa, sin retirar archivos. Interfaz local
con sustitutos comprobada entre 320 y 1280 px; transporte nativo y papelera real
comprobados aparte con documentos sintéticos propios. Se preserva el primer
fallo de dependencia de Playwright y su corrección con el runtime ya disponible.
Se revisó Cognira Remote Host sin modificarlo: su documentación distingue control
humano remoto de aceptación automática de UAC. No se instala servicio SYSTEM,
no se acepta UAC ni se cambia el registro. El selector no otorga acceso global
administrativo y no certifica macOS/2.000 comandos. El usuario solicita esperar
instrucciones al cerrar esta entrega.
[Implementación, evidencias y límites](modos-acceso-y-aprobaciones.md).

1 de noviembre, nueva petición: Bang Motion MIT 1.19.0 fijado por commit,
licencia y hashes. Agente motion conectado al chat y la ruta Live, con cola
independiente y planes tipados; no ejecuta código del modelo. Dos videos reales
de 24 s/1080p/30 fps: WorkSpace y habitación conceptual, con Georgia/Segoe UI y
logo propio. Cuatro planificaciones reales, importe desconocido; renders
iniciales de 67,532 y 70,453 s, ensayo conjunto de 151,188 s. Se conservan fallo
inicial de configuración, rechazo del analizador a bibliotecas empaquetadas y
revisión editorial. El MP4 reveló una superposición en el cierre que el check
técnico no detectó: corregida opacidad anidada y añadida comprobación de píxel,
sin nueva inferencia. Se conservan versiones anteriores. Productor/puente
sustituidos para QA de interfaz, MP4 reproducido realmente y cuatro anchuras
comprobadas. Sin ratón, UAC, micrófono físico, publicación ni música de referencia.
Música y locución ausentes en esta entrega; sólo dos familias de escena y
compatibilidad real Windows. [Implementación y resultados](melodi-bang-motion.md).

Corrección del mismo hito: una regresión UI mostró que una respuesta de estado
vacía o antigua podía cerrar la aprobación visible. Se conserva ese fallo y se
añade la corrección: mantener la solicitud hasta decisión/caducidad/cancelación,
descartar respuestas fuera de orden y recuperar el estado por el puente nativo
si caducó el grant HTTP. La nueva prueba `observe([])` pasa. Ocho pruebas de
política y siete de archivos, incluida protección frente a Guardar/autoguardado
genérico, y rechazo de rutas HTTP de autoaprobación. Brivany reiniciado con
Normal y control desactivado; WorkSpace visible y panel con región vacía. No
hubo aprobación UAC ni cambios de archivos del usuario. El usuario pidió quedar
en espera; no se certifica como logrado el acceso UAC automático.

1 de noviembre, corrección creativa solicitada: se rehacen las dos promociones
con mundos más expresivos: cintas 3D reactivas al PCM/filmstrip y construcción
arquitectónica con despiece, materiales y cámara. Se añade locución opcional
por la voz española ya configurada de Melodi/Cartesia, cuatro frases acotadas,
duraciones reales sin truncación, AAC en MP4 y transporte sincronizado en HTML.
Ocho llamadas reales a TTS, cero nueva inferencia de planificación, importe
desconocido. Los ajustes visuales reutilizan el audio, sin nuevas llamadas.
Doce pruebas de motion y reproducción/decodificación del MP4 en chat a cuatro
anchuras; proveedor/puente sustituidos en esa suite. HyperFrames y FFprobe
comprobados, fotogramas finales inspeccionados y loudness medido. Se conservan
las versiones rechazadas, el fallo del parser de loudness y la corrección de
cruces de cintas. Sin micrófono, escucha humana, música ajena ni publicación.
[Implementación, evidencia y límites](melodi-motion-con-voz.md).

1 de noviembre, hito posterior de WorkSpace: selector de dos botones sin título
ni X, chat compacto, Live existente, onda de voz y pulso. Se corrige el HTTP 410
causado por borrado de cookies entre ventanas privadas, manteniendo el cierre de
la interfaz web. Spotify prioriza la sesión de cuenta/móvil frente al SDK viejo,
retiene biblioteca durante 429 y guarda un punto protegido de canción/posición
para el próximo arranque; se retira el sustituto de escuchas recientes. Ducking
excluye la mezcla de FxSound, conserva el navegador original y baja al 12 % por
petición posterior. Las ondas de música y voz se comprueban en WebView2 real con
señal sintética; la cuenta y los picos del sistema se consultan de forma acotada,
sin PCM ni micrófono físico. Se conservan intentos fallidos de los arneses y
sus correcciones. Coste externo desconocido; pruebas locales sin inferencia.
[Implementación, evidencia y límites](workspace-chat-live-y-spotify.md).



1 de noviembre, corrección posterior de apertura: fondos nativos de WinForms y
WebView2 fijados a negro antes de mostrar, selector con forma definitiva y
fundido de 180 ms en vez de recorte creciente. Se retira la vista anterior al
cambiar de panel. Música resuelve conexión y subvista localmente para abrir con
dimensiones definitivas, sin el reproductor compacto provisional. Se añaden
comprobaciones de RGBA, alfa, movimiento reducido y tamaño inicial, con ventanas
reales y servicios sustituidos; no se certifican todos los fotogramas del
compositor ni otras plataformas. [Corrección y alcance](workspace-apertura-sin-destellos.md).

1 de noviembre, traducción auditiva directa solicitada: un clic inicia captura
de salida desde WorkSpace sin abrir `/dubbing`. Original al 12 % después del
punto de captura y restauración al detener. Ruta Windows/FxSound separa la voz
traducida para no recapturarla. Se corrigió el análisis de voz por inicio de
turno y se probaron dos frases propias en español traducidas al inglés con
voces masculina y femenina. Se distinguen ventanas nativas/servicios sustituidos
y pipeline real. La última prueba completó tres segmentos; no certifica escucha
física ni clasificación infalible. Se conservan ensayos previos incompletos y
fallo inicial de sincronización UI. Consumo conocido y coste desconocido están
detallados; sin audio del usuario adjunto. El objetivo de terminal sigue pausado.
[Implementación, pruebas y límites](workspace-traduccion-auditiva.md).

1 de noviembre, corrección posterior del rechazo de ritmo en WorkSpace:
reproducida la ráfaga tras una demora de 360 ms. Reloj compartido de PCM sin
recuperación en ráfagas, bloque pendiente conservado durante pausa y receptor
que mide llegada en vez de procesamiento. Se mantiene el rechazo de un envío
realmente acelerado. Pasaron 56 pruebas locales, dos ensayos de 35 s con siete
demoras provocadas (uno con WASAPI real) y la regresión WebView2 nativa. Los
proveedores/salida de estos ensayos fueron sustituidos; sin llamadas externas
ni PCM/transcripciones guardados. Reiniciado con WorkSpace activo; se conserva
el fallo inicial. [Corrección, evidencia y límites](workspace-ritmo-traduccion.md).


1 de noviembre, continuidad audible posterior: corregidas serialización MT/TTS, pausa ASR externa, doble buffering Cartesia, reloj WASAPI y cierre SSE completo sin EOF. Diez ensayos reales preservan fallos y una fuente insuficiente; el final de video terminó sin error y el usuario confirmó fluidez y voces distinguibles. Labels y voces estables por hablante. 118 pruebas locales, UI/nativo, consumo conocido e importe desconocido. La anticipación A/V y extensión son el hito siguiente, no acreditado por estas pruebas. [Evidencia y límites](workspace-traduccion-continuidad.md).

2 de noviembre, anticipación audiovisual y espera: incorporados modos
Preproducción/Navegador, relay local revocable y extensión Chromium con búfer
acotado. Preparación de proveedores/TLS adelantada y análisis Meta de prefijo
en paralelo. Siete ensayos propios reales, incluido un fallo conservado:
el último preparó en 5,78 s, primera voz a 7,12 s desde clic; **no acredita el
máximo de seis segundos**. Las pruebas locales de UI, WebView2, relay y carga
de extensión se distinguen de instalar/capturar en Brave del usuario, pendiente.
Emoción consultiva y tiempos de procesamiento ASR, sin promesa labial. Consumo
conocido e importe desconocido documentados. El usuario retiró el objetivo de
terminal. [Implementación, métodos, evidencia y límites](workspace-traduccion-sincronizada.md).

2 de noviembre, diseño de iPhone en curso: referencia ProjectFixture App consultada sin
modificarla; vista local interactiva con compositor, menú/historial de chats,
cinco módulos, Live al estilo ProjectFixture, iconos Lucide y ajustes con documentos
internos. Pruebas aisladas de controles/historial/legal y tres tamaños pasaron;
no activaron micrófono ni APIs. Base SwiftUI y gateway candidatos, aún sin
compilación iOS ni validación física. Quince pruebas sustituidas del gateway
pasaron. A petición del usuario **no se genera el IPA hasta terminar el diseño**;
workflow protegido con opción manual desactivada por defecto. No se creó repo
ni se publicaron fuentes. [Estado y límites](iphone-diseno-en-curso.md).

2 de noviembre, cuenta Brivany y control entre dispositivos: servicio publicado,
sesiones protegidas, host Windows saliente automático y selección de equipo
común a chat/Live. Cuenta propia de prueba iniciada en escritorio y vista móvil.
29 pruebas del gateway, 7 del host, UI aislada y regresiones pasaron; consulta
real de encendido por chat y por ASR con voz sintética terminaron en Windows.
Selección con segundo host simulado comprobada y fixture revocado. Reconexión
tras reinicio confirmada. Se conservan fallos de fetch, selección y test UI.
Consumo real e importe desconocido documentados, sin audio ni claves adjuntos.
Política pública actualizada. Fuente iOS sin compilar/probar físicamente;
**no se genera IPA**. [Implementación, evidencias y límites](cuenta-brivany-y-control-entre-dispositivos.md).

Revisión posterior del mismo hito: 30 pruebas de gateway y 8 del host; se añadió
aislamiento de elección por conversación y se corrigió la ruta del chat de
escritorio ya armado para usar también la cuenta compartida. Cerrar sesión
limpia seguimientos antes de cambiar de cuenta. Pasaron además 30 regresiones
de voz/conversación con sustitutos. Se conservan los registros anteriores.

Cierre posterior: nueve pruebas del host incluyen un acuse que llega después de
cerrar sesión, sin iniciar tareas nuevas. Confirmada de nuevo la reconexión real
con el código final, sin inferencias adicionales. Documentos internos de la vista
móvil sincronizados con la política pública. Se mantiene iOS físico pendiente.

3 de noviembre: Melodi coordina equipos con dependencias, ejecución concurrente,
revisión estructurada Meta y corrección acotada de artefactos; incorpora imagen
Muse y búsqueda documentada. Dos documentos reales terminaron aceptados con
2,828 s de solapamiento; imagen/documento/investigación propios se reevaluaron
sin regenerarlos. Se conservan rechazos e intentos fallidos. Consumo conocido:
27 peticiones a Meta; factura e internos de búsqueda sin cuantificar.

WorkSpace muestra miniagentes completos, pulso azul y salida suave al terminar;
el trabajo evita el sueño de Melodi. Instalado Glisse 0.5.0 para resultados en
panel glass compacto, con ajuste de texto, scroll exclusivamente vertical y
barras ocultas. CSS local compatible con CSP, lectura temporal de medios y
restauración del fondo nativo comprobados. Pasaron la suite de orquestación,
UI de agentes/visor, visor WebView2 y regresión de chat/voz sustituida; se
conservan también sus fallos iniciales. Sin nuevo micrófono físico ni IPA.
[Cambios, pruebas reales/locales y límites](melodi-orquestadora-y-agentes.md).

3 de noviembre, continuación: chat compacto de 148 a 404 px con «Pensando…»,
expansión suave y cierre tolerante al salir, sin cortar Live. Melodi despierta
por trabajo/escucha/respuesta y confirma encargos sin exponer acuses del PC.
Se corrigen mutex sobre llamadas de ventana y notificaciones bloqueantes de
WebView2; idiomas con botones, reinicio cancelable y salida silenciada antes de
limpieza de proveedores. Estrés nativo y parada de dispositivo con PCM cero
pasaron, distinguidos de calidad audible de una nueva traducción real.

Letras consultadas sin bloquear pista anterior y con caché; estado musical
directo desde SDK. La pista del usuario no obtuvo tiempos de los proveedores;
una pista de referencia sí cargó en 0,391 s. Se retira el aviso de letra no
disponible sin inventar sincronización. Aplicación nativa propia de facturas e
inventario completó dos borradores y reutilizó una receta de cuatro pasos con
datos nuevos; el usuario no tiene un programa comercial para probar. Inicio
de app de prueba en segundo plano sin borde/cursor/foco comprobado. Se conservan
fallos de UIA, pruebas, foco y primer plan incompleto. Tres peticiones Meta y
ocho consultas públicas de letras conocidas, importe sin medir.
[Implementación, evidencias y límites](workspace-fluidez-y-aprendizaje.md).

Corrección posterior: el chat de WorkSpace ya no se oculta por mover el cursor.
Se oculta suavemente al escribir en otra app en modo Automático; Manual permanece
abierto hasta ×/Escape. Ambos modos con ejemplos en Ajustes, elección persistida,
señal Windows sin guardar teclas/texto y desactivada fuera del chat. Pruebas de
interfaz, puente nativo, política y hook aprobadas; fallo del cursor simulado
conservado. Apertura sencilla restringida a un inicio verificado, sin foco añadido.
[Pruebas y alcance](workspace-fluidez-y-aprendizaje.md).

Cierre de comprobación: Brivany reiniciado y cuenta/dispositivo en línea, barra y
reserva de 40 px, WorkSpace sin estilo de barra de tareas. Una lectura adicional
al servicio de dispositivos; sin inferencia ni acciones. Expectativa fallida del
sondeo de panel cerrado conservada en tmp/workspace-fluidez-runtime.json.

3 de noviembre, corrección de apertura y respuestas: Word había fallado antes
de ejecutarse por el plan de coordinación. Ruta directa, agente de instalación,
respuesta final en el chat, input adaptable y aprendizaje progresivo de recetas.
Word real abierto minimizado sin tomar foco; nuevas consultas compuestas de
Windows elegidas por Meta y respuestas cotejadas con hechos actuales. Se distinguen
prueba propia, real, sustitutos, consumo conocido y límites de disponibilidad.
[Implementación y evidencias](melodi-aperturas-y-diagnostico-adaptable.md).

3 de noviembre, cierre de interacción: confirmaciones naturales/contextuales,
aviso glass bajo Melodi cuando el chat está cerrado, texto de tres líneas y
ventana física de 420x80. Se corrigió el backdrop que excedía la tarjeta pese
al recorte aparente: nuevas pruebas miden el viewport nativo. Diagnóstico
compuesto por Meta y ejecutado con datos reales, respuesta final en WebView2.
Diez inferencias conocidas de prueba; coste monetario sin medir y fallos sin
contador diferenciados de consumo cero. [Evidencia](melodi-aperturas-y-diagnostico-adaptable.md).

3 de noviembre, operaciones nuevas en programas y reanudación. El recibo del
caso Paint mostró una apertura seguida de una revisión rechazada y una
investigación incompleta. El agente que debía escribir nunca arrancó. Ahora la
inspección del programa puede usar sus controles y una captura de la ventana
observada. La documentación se consulta cuando el encargo la necesita. Una
investigación incompleta puede tener un segundo intento de sólo lectura.

Una intervención de escritorio conserva los recibos en memoria, libera el
control nativo y deja en espera a los agentes que dependen de ella. Continuar
desde el chat o la barra vuelve a observar la aplicación con la autorización
vigente. Se probó la continuación con una aplicación simulada. Para el ensayo
real de Paint, Melodi redactó un poema sintético, abrió el PNG nuevo, verificó
la ventana y aprobó el resultado. El lienzo contiene texto rasterizado. Los
intentos anteriores se conservan como fallidos. Hubo 14 llamadas Meta
registradas entre los ensayos de Paint, con coste monetario desconocido.

3 de noviembre, corrección de Paint y de la capa de voz. La nueva petición de
boxeo falló antes de dejar un paso verificado. El recibo anterior no conservó
la excepción específica. La acción actual abre un lienzo nuevo, identifica la
herramienta Texto por accesibilidad, dibuja el cuadro y lee el valor exacto del
editor de Paint. Deja el cuadro abierto para editar y no crea un PNG. Se
confirmó en Paint clásico en español. Tres ensayos nativos detectaron el
límite de UI Automation y un problema de comprobación de coordenadas. El
cuarto verificó texto multilínea con acentos sin llamadas de inferencia.
La prueba completa de boxeo con Meta y Paint pasó con tres llamadas. Un ensayo
completo anterior falló con dos llamadas. Coste monetario desconocido.

La onda de WorkSpace usa un fondo transparente en Windows y sólo se muestra
con señal de voz y con los paneles cerrados. La prueba nativa con señal
sintética confirmó que se oculta durante silencio y al abrir el chat. Los
avisos glass se comprobaron por separado en la misma suite.
La verificación final consulta también la visibilidad del HWND en el arranque.
WebView2 podía exponer la ventana inicial a pesar de la opción de arranque
oculta. Ahora se enlaza con región vacía y se oculta antes de publicar el estado.

3 de noviembre, búsqueda web de Melodi. Se verificó la herramienta web_search
de Meta en Responses API y se corrigió la entrega del texto con citas al chat
y a WorkSpace. El proveedor comprueba llamada de búsqueda, respuesta final
completa y fuentes públicas HTTPS. Se separan los errores de falta de
búsqueda, respuesta incompleta y ausencia de citas. Hay un único reintento de
evidencia. Meta admite hasta cuatro operaciones internas de búsqueda por
solicitud y se conserva el presupuesto global de planificación.

Las pruebas reales incluyeron documentación Microsoft y el clima de Las
Terrenas. Una respuesta de clima llegó correctamente por la cuenta, pero
usó el día UTC. Ese defecto se registra separado de la prueba de transporte.
El proveedor recibe ahora la hora local y UTC, junto a la instrucción de
comprobar la fecha en el lugar consultado. Un ensayo posterior reconoció
el 3 de noviembre local. Fuentes y metadatos de prueba se guardan sin
conversaciones originales. El coste monetario de Meta no fue medido.

La comprobación posterior encontró que el coordinador cambiaba «hoy» por una
fecha absoluta equivocada. Las búsquedas sencillas reciben ahora la pregunta
original, y la planificación y revisión reciben la hora local. Los resultados
brutos de Meta pueden traer fragmentos vacíos. Se añade una lectura de hasta
dos páginas citadas, con límites de tamaño, tiempo, redirecciones y direcciones
públicas. Los extractos se usan durante la revisión y se retiran de la memoria
del trabajo al terminarla. Si faltan las citas de la respuesta, se admite una
síntesis basada sólo en fuentes realmente recuperadas y leídas. El modelo
selecciona índices de esas fuentes y el ejecutor rechaza índices inventados.

El cierre real por cuenta y escritorio pasó con fecha local 2026-11-03,
respuesta y tres fuentes, en 32,97 s. El host registró cinco solicitudes
externas y la prueba catorce llamadas a la cuenta. El tráfico del gateway y el
importe facturado no se midieron en ese contador. Se conservan los ensayos
fallidos de fecha, ausencia de citas y revisión sin extractos. La suite
orchestration pasó 27 pruebas, account-host 11 y la interfaz comprobó fuentes
en ambos chats, apertura voluntaria del enlace y rechazo de un esquema de URL
inseguro. No hubo captura de micrófono en estas pruebas.

3 de noviembre, corrección posterior por petición del usuario: fuentes ocultas
en las respuestas normales y procedencia recuperable al preguntar, sin otra
llamada al modelo. Ruta breve de búsqueda con una llamada Meta, sin clasificación,
planificación ni lectura adicional de páginas. Pruebas reales completas de
4,781–5,985 s, sin caché: mejora frente a 32,97 s, sin acreditar máximo fijo de
cinco segundos. Suites locales y UI aprobadas, gateway publicado y escritorio
reiniciado. Coste monetario desconocido; sondeos y límites registrados en
[búsqueda rápida y procedencia](melodi-busqueda-rapida-y-procedencia.md).

3 de noviembre, revisión del micrófono de WorkSpace: el input ahora dicta con
ondas de las muestras acústicas y controles de cancelar/detener/enviar. Se
reprodujo y corrigió el permiso pendiente de WebView2 con la app principal
oculta. Captura física local, ASR real con voz sintética propia e interfaz
probados por separado; coste de dos intentos Meta desconocido. Durante el
reinicio de prueba se duplicó la barra: se cerró la instancia sobrante y se
incorporó exclusión entre procesos y serialización interna. Tres pruebas de
instancia y dos reaperturas reales conservaron una sola barra y sus 40 px.
[Cambios, pruebas y límites](workspace-dictado-e-instancia-unica.md).


4 de noviembre, continuaciones 074–079. La reproducción en la pestaña conserva
el tono entre 1 y 1,25×; la comprobación propia completó dos tonos de un segundo
en ventanas de 0,8 s y pasaron 78 pruebas de extensión. Se actualizaron los
veinte archivos de distribución manteniendo ID y permisos. La extensión
personal confirmó versión 0.4.9, pero su preparación automática no quedó
comprobada: el módulo informó «unavailable».

El ensayo 075 terminó con rechazo de Cartesia. Una única solicitud propia
posterior confirmó HTTP 402 por cuota; se detuvo la síntesis hasta el aviso del
usuario. Se incorporaron mensajes seguros para cuota y concurrencia. Tras
restablecerse la cuota, el único ensayo real nuevo 078 completó trece voces
hasta 31,9294 s y volvió a fallar: retraso de 9,569062 s, crecimiento de
4,635729 s y cierre por acumulación de entrada. ENDPOINTING fusionó el prefijo
en un solo turno; se retiró ese experimento y se conserva DIARIZATION.

Se preservan ambos fallos, los conteos de solicitudes y el importe desconocido.
No se cambiaron planes ni sobrecostes. El control del ordenador se detuvo al
no poder verificar la URL de Brave y no se eludió el bloqueo. La continuidad
completa y la atribución humana de hablantes siguen pendientes.
[Implementación, ensayos, consumo y límites](traduccion-auditiva-cierre-acotado-074-079.md).

Comprobación posterior 079: tras retirar ENDPOINTING, pasaron 103 pruebas de
sync-relay y 78 de extensión, registradas por tools.verify sin llamadas externas.
Los informes finales y el alcance se añaden al mismo documento 074–079.


4 de noviembre, continuación 080–081 y pausa solicitada. Se conserva el
prefijo ya capturado al buscar, pausar o cambiar velocidad. Un fallo antes de
enviar prefix-start permite recuperar en eventos de disponibilidad, con un
máximo de dos preparaciones locales por fuente y sin repetir automáticamente
un intento ya enviado. El recorrido propio de Brave con video codificado,
protocolos sustituidos y búsqueda al inicio reutilizó una sola preparación,
continuó desde 7000 ms, omitió música y completó cuatro voces nuevas.
Evidencia: tmp/selected-video/inline-sync-1793828501005.json.

El consejo de timbre exige ahora acuerdo entre los dos modelos locales ya
instalados cuando el modelo primario propone una categoría. Desacuerdo o
corroboración insuficiente conserva incertidumbre; una voz estable se mantiene
como provisional. No añade llamadas a proveedores. Las dos muestras propias
existentes conservaron sus categorías de catálogo con tiempos de 674,25 y
491,02 ms. No es validación humana del video público. Evidencia:
tmp/selected-video/local-timbre-consensus-owned-081.json.

Pasaron 83 pruebas de extensión, 26 de voces, 70 de River y 104 de sync-relay,
registradas por tools.verify. La primera comprobación integrada de desacuerdo
no agotaba la caché del sustituto y observó su referencia masculina; se corrigió
la preparación de esa prueba para consumir ocho piezas y comprobar inferencia
nueva. No se modificaron resultados anteriores. Los cambios 080–081 están en
el código fuente: no se certifica su carga en el perfil personal ni una nueva
publicación del ZIP. No hubo nuevas solicitudes pagadas en esta continuación.

El usuario pidió detener las pruebas y pasar a preparar un video de Brivany.
El objetivo de traducción quedó pausado, sin marcarlo completo. Quedan abiertos
la continuidad integral, la atribución humana, el prefijo personal y la carga
nativa de los últimos cambios. Se responde primero al posicionamiento del
producto, distinguiendo capacidades presentes y visión espacial futura.


4 de noviembre, guion representativo de Brivany. Se redactó una película de
180 s, once escenas, con locución propuesta de Melodi, arquitectura sencilla,
casos de uso y plan de motion. Se mantuvieron los datos de Microsoft WTI 2025
(80 % de encuestados sin tiempo o energía) y Gallup 2026/datos 2025 (40 % con
estrés el día anterior), sin atribuir causalidad a IA ni crecimiento anual.
El inventario retrospectivo contrastó 1.215 informes de tools.verify con la
bitácora, incluidos 185 con salida no cero y regresiones repetidas. Una ronda
reciente seleccionada de cuatro suites reúne 283 casos aprobados; no equivale
a funciones únicas ni certifica funcionamiento integral.

La investigación visual en paralelo recomendó HyperFrames, GSAP, Three.js y
FFmpeg existentes, conservando el personaje original. El compositor cotidiano
limitado a 18/24/30 s requiere una composición nueva para 180 s. Se propone
acabado comercial y escenas ideales identificadas como ilustración; no se
cambia el historial de fallos ni se afirma perfección, clonación instantánea o
reunión presencial ya verificada. No se generaron medios, voz ni renders en
esta fase. La consulta de usage de HyperFrames informó cuota del entorno,
no saldo de Cartesia. Guion, narración, fuentes, inventario y plan visual:
Exports/Brivany-presentacion-3min/. La película queda por producir tras revisar
el guion, conforme al orden solicitado.


4 de noviembre, producción del video Brivany · A tu ritmo. Composición ilustrada
de tres minutos a 1080p/60, voz original de Melodi y partitura local. La ampliación
incorpora agentes, ordenador, investigación, herramientas Meta, Sous como primera
human-skill de Brivany y Meta Glasses como próxima etapa. No es una captura real
del producto. Se reutilizaron siete capítulos y se generaron cuatro nuevos: total
de producción 15 solicitudes Cartesia, 3.569 caracteres, sin reintentos; importe
facturado desconocido. HyperFrames se actualizó de 0.8.79 a 0.9.13 y pasó check
con 13 avisos estructurales. Tres rondas de crítica corrigieron encuadres y textos.
La exportación y las comprobaciones del MP4 siguen pendientes en este registro.
[Evidencia de producción](../tmp/brivany-film-production-20261104.json).


4 de noviembre, entrega del video Brivany · A tu ritmo. Exportado MP4 de 180,000 s,
1920×1080/60 fps y 10.800 fotogramas. Pasaron formato/color, duración, sonoridad,
alineación de audio en ocho puntos (cero muestras de desfase frente al WAV) y
lectura completa de audio/video. Se corrigió un desplazamiento de −256 muestras
observado en el extracto inicial mediante empaquetado del WAV original; ambos
resultados se conservan. Se inspeccionó la hoja de 24 fotogramas del MP4 final.
La revisión estilística del extracto conserva un fallo de cola estática y doce
avisos: el corte terminaba dentro de una pausa de lectura, no al final del film.
No se declara aprobado todo el análisis estilístico ni se certifica la aplicación.
El render/entrega no hicieron nuevas peticiones de voz; total de producción
15 solicitudes, 3.569 caracteres, importe desconocido. Solo se registra metadata,
sin adjuntar audio ni videos originales. [Evidencia de entrega](../tmp/brivany-film-delivery-20261104.json).


4 de noviembre, versión inglesa de Brivany. Voz de Melodi y textos en inglés.
Exportación de 180 s a 1080p/60, decodificación completa y sincronía comprobada en
ocho puntos. Once solicitudes Cartesia, 2.419 caracteres y ningún reintento.
Importe facturado desconocido. Los medios se entregaron por separado.

4 de noviembre, preparación de la entrega. Credenciales retiradas, 26 variables
explicadas y ocho rutas comprobadas sin claves. Google aceptó la revocación OAuth.
Spotify se desvinculó localmente. La revocación remota de Spotify y el cierre
remoto de la cuenta Brivany no se confirmaron. Los servidores locales se detuvieron.

4 de noviembre, cierre de WorkSpace. El cierre de la ventana y Salir desde la
bandeja comparten la secuencia de salida. Se libera la reserva antes del cierre
de WebView. Una ventana propia comprobó el ciclo real de y=0 a y=40 y regreso a
y=0 en Windows. La suite work pasó 40 pruebas. La entrega conserva la bitácora
depurada y los informes, con los originales históricos guardados por separado.


7 de noviembre, nuevas funciones y ahorro de WorkSpace. El histórico original
se trasladó fuera de GitHub. Se incorporaron bandeja, herramientas locales,
portapapeles manual, paneles con movimiento breve y partículas finitas. Se
difieren Electron, modelos y la tercera WebView de voz; el medidor de audio
descansa sin música local. Pasaron 44 casos de Work y los recorridos de Edge
registrados. La suite completa translation-voices y el recorrido nativo amplio
conservaron timeout180s; no equivalen a capacidades certificadas. Comparación
local de8,5s:101→59 llamadas en reposo y676→0RAF de voz, con límites de CPU/RAM.
[Implementación y evidencias](workspace-diseno-y-recursos-20261107.md).

7 de noviembre, continuación de Agenda, Clima y Webs. Calendario local con
eventos y exportación ICS, hasta doce webs y clima por ciudad elegida sin
geolocalización ni sondeo. Pasaron seis casos de calendario/URLs, seis de
protocolo de clima y Edge con HTML real y transportes sustituidos. El primer
fixture HTTP no seguro carecía de randomUUID; se corrigió a loopback, sin
cambiar el producto para ocultar el fallo. No se consultó clima real ni una
cuenta de calendario. [Informe](../tmp/verification/workspace-daily-milestone-20261107.json).

El usuario solicita además una promoción similar a un MP4 de50s. El video se
produce en HyperFrames con materiales propios reutilizados, y por petición
expresa omite el rótulo de demostración visual; el usuario añadirá el contexto
en la descripción. El objetivo de funciones permanece activo.

7 de noviembre, entrega de Brivany · Melodi, contigo. MP4 de 50,000 s a
1920×1080/30, 1.500 fotogramas, H.264/AAC y color BT.709. Diseño minimalista sin
rótulo de demostración visual, por indicación expresa del usuario. Se reutilizan
voz de Melodi y música propias; cero solicitudes nuevas de voz o generación de
medios de pago. El tiempo local de GPU y el importe histórico no se midieron.
HyperFrames 0.9.20 pasó check sin errores, con avisos estilísticos y una
observación informativa de 3 px durante una transición. La decodificación
completa, duración, sonoridad y sincronía en ocho puntos pasaron; se revisaron
ocho fotogramas del MP4. Son comprobaciones reales del archivo local, no de la
ejecución en vivo de la app. Se entregan video, portada y composición editable;
no se publica externamente ni se cierra el objetivo de funcionalidades.
Solo metadata en la [evidencia de entrega](../tmp/brivany-promo-delivery-20261107.json).

7 de noviembre, grabación local de WorkSpace. Se implementó captura explícita
de pantalla o ventana con FFmpeg, 15/30 fps, hasta 1080p, sin audio ni subida.
Inicio/parada, nombre único, recuperación del MKV y cierre del proceso propio.
Pasaron 14 casos sustituidos y una captura GDI real de ventana sintética propia:
52 fotogramas a 640×360, 3,466 s, decodificación completa y proceso cerrado.
La primera comprobación nativa falló por exigir FPS medios exactos tras remux;
se conserva, junto al primer fallo de nombre accesible en la prueba de interfaz.
No se capturó el escritorio personal ni se llamó a proveedores. GPU desconocida.

7 de noviembre, corrección visual solicitada con Foto 1. Herramientas reemplaza
las pestañas por un selector y deja el reloj como herramienta opcional. La
apariencia, fluidez, cursor y datos de destino quedan en Ajustes → Melodi
WorkSpace. Grabar muestra fuente, contador y acción principal; se retiran textos
auxiliares y controles inactivos. El panel normal se reduce de 360 a 280 px.
Pasaron 45 casos de Work y Edge para ajustes entre ventanas, grabación, widgets,
diseño y agenda/clima/webs con puentes sustituidos. Se comprobó que cambiar
ajustes conserva notas y el deadline del temporizador; se revisaron las imágenes
a 340 px. No equivale a cargar el código en una instancia personal ya abierta.
El objetivo general permanece activo. [Cambios y evidencia](workspace-grabacion-panel-limpio-20261107.md).

Corrección de contabilización del mismo hito: tools.verify registra GPU
desconocida en suites de interfaz. Los ceros históricos de diseño/agenda no
acreditan GPU nula; se conserva el histórico y se añade esta aclaración.

7 de noviembre, envío local de archivo al teléfono. La bandeja incorpora una
tarjeta QR de un archivo y agrupa acciones secundarias en «⋯», conservando el
panel limpio. Red y huella del certificado quedan en Ajustes. HTTPS aislado,
canje de un uso, cookie restringida, vencimiento a cinco minutos y revocación
al cancelar/quitar/cerrar. La clave local se protege con DPAPI. No se instala
confianza ni se cambia el firewall; tampoco se concede control del ordenador.

Pasaron 17 casos con TLS loopback y DPAPI reales, 13 de archivos, 45 de Work y
Edge para teléfono/archivos/ajustes/diseño. Un navegador con viewport móvil
descargó exactamente el archivo propio de 2.120 bytes. El QR renderizado a
340 px se decodificó correctamente. Esto no es prueba en teléfono físico ni de
Wi-Fi/firewall; el navegador de pruebas omite el aviso del certificado. No se
hicieron peticiones a proveedores durante las pruebas; se preparó Segno 1.6.6
y se reutilizó Cryptography 50.0.2. GPU/CPU/RAM totales no medidos. El objetivo
sigue activo. Solo metadata, sin tokens, QR, cookies o claves en la evidencia.
[Implementación, comprobaciones y pendientes](workspace-telefono-qr-20261107.md).

Corrección del mismo hito: la retirada concurrente de un archivo durante la
generación del QR podía dejar activo el envío recién creado. Se reprodujo en
loopback con un archivo propio. Se coordinaron lectura, asignación y retirada;
los informes fallidos se conservan. La prueba se afinó para comprobar el
resultado de revocación, sin exigir una estrategia de bloqueo concreta.

La revisión posterior conserva 20 casos aprobados: incluye caducidad automática
con un temporizador real de plazo reducido y retirada tardía del archivo anterior
sin cancelar el envío de otro. Se conserva la evidencia anterior y se añade
el [informe de corrección](../tmp/verification/workspace-phone-correction-20261107.json).

7 de noviembre, Lienzo solicitado por el usuario. Herramientas abre una ventana
blanca independiente con lápiz, marcador, borrador, línea, rectángulo y elipse,
color/grosor/relleno, deshacer/rehacer, copiar imagen PNG y exportar. Barra de
iconos sin textos decorativos. Crear/cerrar protege dibujos sin salida elegida.
Creación diferida, buffers reutilizados e historial vectorial limitado, sin
bucle de fotogramas en reposo ni llamadas a modelos.

Pasaron 15 casos de salida/puente/propiedad de memoria, 2 de historial, Edge con
comprobación de píxeles y PNG, y WebView2 real propio con exportación de dibujo
sintético. En el ensayo nativo se sustituyó solo la selección del destino por
una ruta propia. Regresión de widgets aprobada. Se conservan dos fallos de UI
y dos intentos fallidos de crear una estación privada para probar el portapapeles
(acceso denegado 5); ninguno abrió el portapapeles personal. La copia usa Win32
con PNG/image/png/CF_DIB y se verificó con HGLOBAL real y consumidor sustituido;
el pegado físico entre aplicaciones queda pendiente. Sin proveedores ni audio;
GPU/CPU/RAM totales no medidos. El objetivo general continúa activo.
[Implementación, pruebas y límites](workspace-lienzo-20261107.md).

7 de noviembre, widgets de escritorio. Reloj, Enfoque y Notas se abren desde un
icono contextual en Herramientas. Ventanas WinForms sobre el dispatcher existente,
sin otro WebView por widget; posiciones, tamaño/acento y mantener encima en
Ajustes. Un modelo local sincroniza barra/panel/ventana, con una sola alarma del
temporizador y un aviso de finalización. La nota conserva borradores ante
ediciones simultáneas y se recupera una entrega pendiente sin sobrescribir otra
versión. Se mantiene la revisión del texto mostrado durante respuestas tardías.
Se retiran etiqueta visual y contador innecesarios de Notas; se preservan sus
nombres accesibles y el límite de texto.

Pasaron 25 casos de estado/servicio/puente, Edge con dos vistas y Python real,
WinForms propio y un recorrido completo WebView2→puente→widgets→WebView2.
Regresiones: 45 de Work, 2 de arranque, widgets y Ajustes. El recorrido completo
conservó un solo WebView del banco al abrir las tres ventanas. Se comprobó que
cerrarlas retira repintados y que el cierre general guarda la nota. Notas y
trayectos sintéticos propios, sin datos personales ni proveedores.

Medición separada del proceso Python/CLR del banco: aproximadamente 78 MiB;
intervalos de unos 3 s con 0/3/0 repintados en reposo/temporizador/cerrado y CPU
observada 0,000/0,000/0,016 s. Los ceros redondeados no demuestran CPU nula ni
esos valores representan todo Brivany o un porcentaje de ahorro. GPU desconocida.
La medición integral y las demás familias pendientes siguen abiertas.
[Implementación y límites](workspace-widgets-escritorio-20261107.md).

7 de noviembre, corrección de concurrencia de widgets. Un acuse tardío solo
retira la recuperación si coinciden texto y revisión. El cierre concurrente
con la alarma evita un error tardío cuando el modelo ya está cerrado. Pasaron
26 casos de estado/servicio y la regresión de dos vistas Edge con Python real.
Informes `desktop-widgets-20261107T204433-97dd1e77.json` y
`desktop-widgets-ui-20261107T204433-c59ded43.json`.

7 de noviembre, micrófono junto a Enfoque y monitor de Spotify en espera.
El icono de Enfoque consulta Core Audio al abrir la herramienta y permite
silenciar o reactivar la entrada predeterminada de comunicaciones de Windows.
La operación verifica el dispositivo y el estado antes de cambiarlo y lee el
resultado después. Un cambio externo observado pide volver a pulsar. Mantiene
el plazo del temporizador y no abre un flujo de audio.

Pasaron ocho casos, incluidos lectura de estado Core Audio real y verificación
ABI de SetMute/GetMute con un dispositivo simulado. Edge comprobó estado,
recuperación de un estado obsoleto y panel de 340 px. El ensayo no cambió el
micrófono físico. El estado se refresca al abrir Enfoque o recuperar el foco.
Las aplicaciones con otro micrófono y los cambios externos mientras el panel
conserva el foco tienen límites distintos de los cambios hechos en Brivany.
[API de Windows](https://learn.microsoft.com/en-us/windows/win32/coreaudio/using-a-communication-device).

El monitor de reducción de música ya no arranca con Desktop. La primera
reproducción local confirmada por el SDK lo activa. Una pausa o pérdida del
reproductor libera las sesiones de audio y deja el worker en espera de un
evento. La prueba del worker real sustituyó el medidor y confirmó que no
volvía a consultar el estado al pasar el antiguo intervalo de 500 ms. Pasaron
14 casos de reducción, 39 de Spotify, 3 del fundido de volumen, 2 de arranque
y 45 de Work. Sin reproducción ni peticiones a proveedores en estas pruebas.
GPU total desconocida en Edge. Sigue pendiente la medición de todo WorkSpace.
[Informes del hito](../tmp/verification/workspace-call-and-audio-idle-20261107.json).

7 de noviembre, telefonía y buzón de Melodi. Se implementó el panel Llamadas,
preparación por orden escrita, revisión antes de marcar y pasarela separada
con verificación de webhooks, recibo persistente y control de cancelación.
La conversación por turnos usa la voz existente de Melodi. El buzón avisa y
pide aceptar antes de grabar. Pasaron 11 casos con HTTP de loopback, Twilio,
voz y modelo sustituidos y el recorrido Edge a 340 px con audio sintético.
El primer ensayo de UI falló al interpretar un número entre paréntesis y se
conserva. Se comprobó que el ajuste corrige el recorrido desde el chat.

La prueba oficial de Twilio admite República Dominicana y ofrece un número
compartido con 75 minutos por 30 días. La consola requiere verificar el
destino y la modalidad de prueba bloquea grabación con `<Record>`. No había
configuración de telefonía en el entorno y la consola no se pudo abrir con el
control de navegador. La llamada personal queda pendiente de esa verificación.
No se iniciaron llamadas, consumos de proveedor de voz/modelo, compras ni
publicación de la pasarela. GPU total desconocida en Edge. Evidencias sin
números reales, credenciales, clips ni conversaciones.
[Implementación, prueba y límites](melodi-telefonia-20261107.md).

7 de noviembre, Control móvil. Herramientas vincula un teléfono por QR de un
uso, código y permisos por separado para entrada, pantalla, música,
diapositivas y energía. La vista de pantalla se pide al activarla y la
decisión de energía queda en el PC. La desconexión retira los permisos antes
de cerrar el servidor. El envío de archivos conserva su servicio independiente.

Pasaron 12 casos con HTTPS de loopback y efectos Windows sustituidos. Edge
recorrió el enlace a 340/390 px, incluidos control de pantalla propia, texto
Unicode y confirmación de bloqueo sustituido. Se conservó el primer fallo de
un selector de pruebas. Pasaron las regresiones de envío de archivos, Ajustes,
diseño, Work y arranque. No se cambió el estado de energía ni se capturó el
escritorio personal. Pendientes teléfono físico, red y controles reales.
[Comprobaciones y límites](workspace-control-movil-20261107.md).

7 de noviembre, primera llamada real de Twilio. El usuario completó el registro
con Google y verificó el teléfono por SMS. Se seleccionó el plan limitado y se
marcó una vez desde el número de prueba de Twilio a un destino verificado de
República Dominicana. La plantilla de audio de muestra validó transporte.
El registro indicó `Completed` y 15 s; el contador pasó de 75 a 74 minutos
gratuitos. La pasarela, la voz de Melodi y el buzón no participaron en esta
llamada. Sin compras ni tarjeta. Se guarda solo el resultado, sin datos de
contacto, identificadores de Twilio, códigos ni audio.
[Primera prueba real](melodi-telefonia-20261107.md#primera-llamada-real-de-prueba).

7 de noviembre, modo de conversación de prueba de Twilio. Se confirmó el
campo Custom TwiML URL y los 74 minutos de voz disponibles. La pasarela limita
la llamada de consola a un emisor, un destino, dos turnos y un modelo local.
Las únicas rutas públicas son los webhooks firmados y el WAV de esa sesión.
Pasaron 12 casos de telefonía y Edge con efectos sustituidos. La consulta de
catálogo de la voz española de Cartesia confirmó que está activa. La consulta
administrativa devolvió 401 y el saldo queda sin verificar. Los conectores
Cloudflare sintéticos se registraron y se cerraron; el nombre no resolvió
desde el equipo durante la prueba HTTPS. La consulta de DNS pública tampoco
devolvió resultado. Sin segunda llamada, grabación, síntesis ni inferencia.
[Preparación y pendientes](melodi-telefonia-20261107.md#conversación-breve-desde-la-consola-de-prueba).

7 de noviembre, franja de Juego. Se añadieron CPU, GPU y RAM con contadores de
Windows y FPS de la ventana elegida mediante PresentMon. Edge verificó el
panel a 340 px y detención de consultas al ocultarlo. WinForms propio mostró
lecturas reales y cerró el sampler. La variante inicial tomó el foco; se
corrigieron los estilos en la creación de la ventana y se conserva el fallo.
PresentMon oficial reprodujo 53 filas de un ETL público, separadas por proceso.
El ensayo en vivo con un proceso propio devolvió acceso denegado. Pendientes
FPS durante un juego real, temperatura y chat conjunto Twitch/YouTube. Se
usaron medios propios o públicos en las comprobaciones; el consumo total de
Brivany queda sin medir.
[Implementación y verificaciones](workspace-juego-20261107.md).

7 de noviembre, corrección de la prueba de conversación. El usuario indicó
usar Meta y canceló la descarga del modelo local propuesto. Se detuvieron
las transferencias y se retiraron ambos archivos parciales de `.local`.
La pasarela vuelve a usar Meta y la voz de Melodi por Cartesia. El usuario
confirmó cuota de voz suficiente. Una petición real de cada proveedor, con
texto sintético, produjo 84 caracteres y 4,64 s de voz. Meta tardó 4,157 s y
Cartesia 2,406 s. El coste facturado es desconocido. Se ajustó la espera de los
webhooks a esos tiempos, con el trabajo de voz fuera del bloqueo de estado.

Pasaron 14 casos, incluidos formulario local con rechazo de otro origen,
DPAPI real y carga del registro cifrado. Una prueba HTTPS sintética del túnel
devolvió 200. El control del navegador quedó desactivado o sin respuesta.
Se preparó un formulario temporal para la credencial existente de Twilio y
una única solicitud REST con duración limitada. Continúan pendientes la
credencial y la segunda llamada. Sin audio, conversación, enlaces privados
ni datos de contacto en las evidencias.
[Comprobación real de APIs](../tmp/verification/melodi-meta-cartesia-preflight-20261107.json),
[telefonía local](../tmp/verification/telephony-20261107T232541-fb8ee3c2.json).

7 de noviembre, corrección posterior de telefonía, con pruebas del 8 UTC.
El navegador integrado volvió a estar disponible y la credencial existente
se guardó con DPAPI desde loopback. Se corrigió la política de referencia
del formulario; Edge verificó el POST nativo con credenciales ficticias.
La consola limitada envió webhooks sin firma: su modo explícito comprueba
la llamada activa por REST autenticada antes de aceptar esa sesión temporal.
El servidor normal conserva la firma obligatoria.

Cuatro llamadas reales duraron 5, 5, 24 y 40 segundos; el contador gratuito
bajó de 74 a 70 minutos. La experiencia siguió fallando: el usuario oyó el
saludo y después una respuesta sin continuidad. No se interpreta `Completed`
como conversación lograda. La solicitud REST acotada fue rechazada. Se
conservan el fallo local de cierre de socket en Windows, su corrección y
el fallo posterior de contrato al añadir el indicador de tiempo real.

Ante el requisito de responder como Live, se implementó un adaptador continuo
con Muse, Meta y la voz Cartesia existente, PCM progresivo, interrupción y
acuses de reproducción. Se activa solo por configuración explícita. Pasaron
17 pruebas de telefonía, seis del adaptador con WebSockets reales y proveedores
sustituidos, y Edge para el formulario y panel. No se descargaron modelos.

Dos muestras sintéticas de APIs reales midieron primer PCM a 4,329 s en el
nuevo flujo y 3,078 s en el Live actual. No incluyen ASR, salida física ni red
telefónica y no demuestran igualdad de latencia. Cada una usó una petición
Meta y una Cartesia, con 74 y 104 caracteres de voz. En las llamadas y su
preparación hubo tres respuestas Meta y ocho síntesis Cartesia: 894 caracteres
conocidos más una respuesta de longitud no registrada. Importe y tokens
facturados desconocidos. No hubo compras; se cerraron los túneles temporales.

La cuenta gratuita bloquea Media Streams y ConversationRelay. La activación
de telefonía continua y su comprobación física quedan pendientes de una cuenta
compatible y de la decisión del usuario sobre ampliación y número. Se
registran alcance, tarifas de referencia y promociones sin activar pago.
[Implementación y límites](melodi-llamadas-live-20261107.md),
[fallo real](../tmp/verification/melodi-phone-live-gap-20261107.json),
[telefonía](../tmp/verification/telephony-20261108T000835-2be79fa8.json),
[puente continuo](../tmp/verification/telephony-realtime-20261108T001016-b4084f2d.json).

8 de noviembre UTC, comprobación posterior de activación. El navegador
integrado mostró que ampliar esta cuenta de Twilio requiere añadir fondos.
No se continuó la ampliación ni se facilitaron datos de facturación. El
importe y el número propio siguen sin comprar; se mantiene pendiente la
prueba telefónica del puente continuo.

7 de noviembre, continuación SIP con informes del 8 UTC. Se priorizaron las
llamadas sobre las otras funciones y se preparó un trabajador PJSUA2 aislado,
sin descargar modelos de IA ni usar dispositivos físicos de audio. El registro
real de Línea SIP Netelip obtuvo estado 200 sin llamadas telefónicas ni
solicitudes de IA; su importe facturado se desconoce. La conexión del trabajador
con el panel y la conversación Live sigue pendiente.

Pasó `tools.verify telephony-sip-native` con SIP/RTP entre dos procesos locales
y señal sintética en ambos sentidos. La primera señal fue 31 ms y el envío
completo 156 ms por sentido; no miden latencia pública ni de Melodi. Se registran
retrospectivamente dos fallos previos sin medios y la corrección del objeto
SWIG, cuenta de prueba y puertos RTP. Los informes iniciales se sobrescribieron;
el banco ahora usa nombres únicos y separa primera señal de envío completo.
Un marcador local de RTP no acredita escucha remota.

Se verificaron alternativas para evitar alquilar numeración: identificador
propio sujeto a aprobación de Netelip, o llamadas con número oculto. El móvil
dominicano aún no está validado. Se contrastó la tarifa pública de Zadarma y
se distinguieron identificador, recepción SIP y portabilidad. No se enviaron
documentos, compraron números, recargó saldo ni inició portabilidad.
[Implementación, fallos, pruebas y fuentes](melodi-sip-netelip-20261107.md).

7 de noviembre, integración posterior de telefonía con informes del 8 UTC.
El usuario mantendrá las entrantes en su móvil prepago y pospuso su validación
como identificador. Exige aviso y autorización antes de una llamada real que
muestre ese número. No se pidió código, inició llamada pública, contrató
numeración ni envió documentación en esta continuación.

Se conectó el panel al motor SIP con revisión de un uso, recibos que evitan
remarcado, cancelación y cierre al salir. El flujo Live admite PCM de 24 kHz
con Muse, Meta y Cartesia; los acuses SIP significan envío local, no escucha.
Se preparó un formulario local de conexión con DPAPI y se ocultó el buzón de
Melodi cuando las entrantes siguen en el móvil. No se guardó una credencial
SIP real; los perfiles de prueba fueron ficticios y temporales.

Pasaron 9 pruebas SIP, incluidas dos llamadas nativas de loopback con dos
turnos y proveedores de IA sustituidos, 6 del flujo continuo y 17 de telefonía.
Edge aprobó los controles y el formulario SIP con rechazo de otro origen.
Se conserva un fallo inicial por dependencia Playwright no localizada,
resuelto usando la copia ya instalada. Sin operador ni IA real en estos
ensayos. El navegador agotó su espera: activación de cuenta, saldo vigente y
conversación pública siguen pendientes; no se acredita latencia igual a Live.
[Implementación posterior y evidencias](melodi-sip-netelip-20261107.md#integración-posterior-panel-y-voz-live).

Corrección de consumo del mismo hito: el registro de implementación consignó
GPU 0, pero el tiempo de GPU de Edge no se midió y es desconocido. Se conserva
el registro anterior y se añade esta corrección; siguen siendo cero las
llamadas al operador y a las APIs de IA de los ensayos locales descritos.

7 de noviembre, preparación posterior de conexión, con informe del 8 UTC.
El navegador integrado volvió a responder y el usuario restableció la sesión
de Netelip. La conexión local quedó preparada sin guardado de credencial ni
llamada; se pidió autorización para el guardado cifrado. Se separó registro
de marcación en `NativeSIP.connect()` y se preparó una herramienta de registro
real sin destinos, aún sin ejecutar. Volvieron a pasar las 9 pruebas SIP
locales. La voz existente está disponible en el respaldo, pero no cargada en
el entorno activo; no se extrajeron claves ni se invocaron APIs de IA.
[Preparación y alcance](melodi-sip-netelip-20261107.md#preparación-posterior-de-conexión-sin-llamada).

7 de noviembre, guardado autorizado de SIP, con informes del 8 UTC. El usuario
autorizó guardar la credencial de Netelip cifrada con Windows en este PC. El
formulario confirmó el guardado sin marcar. Una comprobación real del perfil
mediante `NativeSIP.connect()` obtuvo registro SIP 200, con destinos vacíos;
se cerró el trabajador al terminar. Cero llamadas PSTN y solicitudes de IA en
esta comprobación; importe del registro desconocido.

Se restauró del respaldo la configuración de voz Meta/Cartesia que admite la
aplicación, fuera de Git y sin publicar claves ni archivos de configuración.
El puente de escritorio real cargó el perfil y devolvió salida habilitada y
entrantes en el móvil. El banco sustituyó la comprobación de origen de ventana;
no acredita una ventana física ni conversación pública. Registro automático
por llamada y destinos persistentes no requieren repetir un trámite manual.
Identificador propio y prueba telefónica autorizada siguen pendientes.
[Guardado, registro y preparación](melodi-sip-netelip-20261107.md#guardado-autorizado-y-registro-real-del-perfil).

7 de noviembre, destinos sin registro e intentos reales con informes del 8 UTC.
El usuario rechazó una lista de teléfonos permitidos. Se retiró del perfil,
entorno SIP y formulario; un número nuevo pasa directamente a revisión. Se
migró el perfil existente sin pedir de nuevo credenciales. El trabajador recibe
solo el destino confirmado de esa llamada, automáticamente y sin alta manual.

Dos intentos reales autorizados con identificador oculto recibieron progreso
183 y rechazo 603 a 6,73 y 6,50 s, sin respuesta confirmada. El usuario indicó
que el primero no sonó. No se logró conversación. El primer intento procesó
indebidamente medios tempranos: una sesión ASR, un intento Meta y una síntesis
Cartesia de 63 caracteres. Se corrigió la espera de llamada contestada y la
presentación de 183 como marcando. El segundo no inició respuesta ni síntesis;
otra sesión ASR analizó transitoriamente el aviso previo y detectó referencia
a saldo. No se guardó audio ni conversación. Facturación y tokens desconocidos.

El panel mostró US$0,02 de saldo, US$0,0959/min para el móvil y recarga mínima
de US$5 con impuestos mostrados de cero. El saldo equivale aproximadamente a
12,5 s; no acredita por sí solo la causa del rechazo. El historial estaba vacío.
Se pidió autorización para recargar, sin pagar, comprar número ni contratar
suscripción. Pasaron 11 pruebas SIP locales y Edge, con nuevo destino sin alta,
perfil anterior, espera de respuesta y proveedores de IA sustituidos. Pendiente
saldo suficiente para la prueba y conversación pública correcta.
[Implementación, consumo, fallos y evidencias](melodi-sip-netelip-20261107.md#destinos-sin-registro-previo-y-primeros-intentos-reales).

7 de noviembre, estado de la recarga con informe del 8 UTC. El usuario informó
que recargó. Transacciones de Netelip mostró PayPal pendiente de revisión, con
US$5 de crédito y US$0,52 de gestión, total US$5,52. Tras actualizar, el saldo
disponible seguía en US$0,02. La ayuda del proveedor señala revisión manual de
PayPal y una espera publicada de hasta ocho horas. No se conservan datos del
pedido o facturación. No se hizo otro pago ni llamada ni petición a los
proveedores de voz. La prueba queda pendiente de la aprobación de Netelip.
[Estado de pago y alcance](melodi-sip-netelip-20261107.md#recarga-del-usuario-pendiente-de-revisión).

7 de noviembre, continuación de WorkSpace con informes del 8 UTC. El usuario
reactivó el objetivo mientras se revisaba el saldo y pidió persistencia de
ajustes. Se guardan en disco General, voz, WorkSpace, grabación, traducción y
ciudad. Las carpetas elegidas se recuperan tras reiniciar y se pueden revocar
desde Ajustes. El permiso de control y el consentimiento de clonación siguen
limitados a la sesión. El selector anima solo la herramienta visible durante
160 ms, cancela cambios interrumpidos y respeta movimiento reducido.

Pasaron Edge con dos servidores y perfiles nuevos, diseño a 340 px, seis
casos de sesión de escritorio y 34 de control. Pasaron también 45 casos de
WorkSpace, 14 de reducción de música, 20 de teléfono y 26 de widgets. Se
conservan dos fallos de selectores o sincronización de prueba y un sustituto
de control desactualizado, corregidos antes del resultado final. Sin llamadas
externas en estos ensayos. El consumo completo y la instancia personal de
WebView2 siguen pendientes de medición y comprobación.

La copia activa es la de GitHub y el histórico se comprobó fuera de GitHub.
Están presentes el respaldo y los tres videos en la ubicación indicada.
[Cambios, alcance y evidencias](workspace-diseno-y-recursos-20261107.md#persistencia-de-ajustes-y-cambio-de-herramienta).

7 de noviembre, paneles compactos. Herramientas y Archivos se estrechan y
ajustan su altura al contenido. Enfoque mide 167 px de alto en Edge, frente
a 280 px antes del cambio, y los botones pasan de 34 a 26 px. Grabación
reduce espacios y Archivos permite desplazar la lista al superar el tope.
Pasaron la prueba visual con datos sintéticos y 46 casos de WorkSpace.
No se invocaron proveedores externos. [Medidas, pruebas y alcance](workspace-diseno-y-recursos-20261107.md#paneles-compactos).

7 de noviembre, restauración del original. La verificación distinguió
el código del ZIP de los datos privados y videos ya trasladados. Se
restauraron las 128.601 entradas del ZIP en `Documentos\Brivany-original-20261104`
con comprobación de CRC y tamaño, sin sobrescribir otros proyectos.
Se confirmó el repositorio activo dentro de GitHub y los tres videos fuera.
[Rutas y evidencia](workspace-diseno-y-recursos-20261107.md#restauración-del-árbol-original).

7 de noviembre, recursos y regresión nativa. WebView2 propio confirmó la
geometría de Enfoque y el temporizador al ocultar el panel. El sondeo de
puntero en reposo baja de 39 a cero en ocho segundos. La traducción auditiva
solo mantiene su temporizador de consulta al estar visible. Se separaron
las medidas de Python y WebView2. El consumo de CPU varió entre escenarios
y las muestras no acreditan ahorro global de memoria. Se corrigió el borde
del tema que reducía el panel Glisse y pasó el recorrido nativo de regresión.
Sin proveedores, micrófono ni entrada física. [Mediciones y alcance](workspace-arranque-recursos-20261107.md#medición-nativa-de-la-barra-y-el-panel).

7 de noviembre, Archivos con extractos y adjunto. Preguntar lee DOCX, XLSX,
PPTX y PDF textual bajo demanda y abre el extracto editable. El lector PDF
ejecuta hasta ocho páginas en un proceso con tiempo y memoria acotados.
Correo genera MIME con el adjunto y sin destinatario, en la ruta que el
usuario elige. Pasaron 21 casos de backend, Edge y WebView2 propio con datos
sintéticos. En WebView2 se sustituyeron el selector y el cliente de correo.
Sin proveedores ni envío. [Formatos, límites y pruebas](workspace-bandeja-archivos-20261107.md#extractos-de-office-y-pdf-y-correo-con-adjunto).

7 de noviembre, idioma independiente de WorkSpace. Se añadió español e
inglés para la interfaz principal. La preferencia persistente cambia la
barra y el panel de WebView2 propio durante la sesión. Edge comprobó
reapertura, formato numérico y conservación de nota, nombre de archivo y
plazo del temporizador. Pasó la regresión nativa general con servicios
sustituidos. Sin solicitudes a proveedores. Quedan idiomas, estados y
ventanas auxiliares por localizar. [Alcance y pruebas](workspace-diseno-y-recursos-20261107.md#idioma-de-workspace).

8 de noviembre, cuatro idiomas de WorkSpace. Se añadieron francés y
portugués de Brasil con 408 mensajes por catálogo. Solo se carga el elegido
y los cambios rápidos descartan respuestas antiguas. WebView2 propio
comprobó arranque en francés y cambios en barra y panel. Edge verificó
persistencia, temporizador, notas, archivos y permisos móviles a 340 px.
Pasaron llamadas y control móvil con acciones sustituidas. Sin proveedores
ni llamadas públicas. Otros idiomas y la revisión lingüística nativa quedan
pendientes. [Catálogos y evidencia](workspace-diseno-y-recursos-20261107.md#francés-y-portugués-de-brasil).

8 de noviembre, pantalla de descarga móvil. El QR conserva el idioma de
WorkSpace y el nombre original del archivo. Pasaron 22 casos de protocolo
y Edge móvil con HTTPS de loopback en cuatro idiomas, incluyendo descarga
exacta, reapertura y errores de conexión o sesión. Teléfono físico pendiente.
[Cambios y pruebas](workspace-telefono-qr-20261107.md#idioma-de-la-pantalla-móvil).

8 de noviembre, cierre por aceptación. El usuario pidió crear el catálogo
de todas las funciones entregadas y marcar las que necesitan revisión.
Se creó [CATALOGO_FUNCIONES.md](../CATALOGO_FUNCIONES.md) con rutas, alcance,
evidencias y pendientes explícitos. Se cierra el objetivo de esta entrega
por su indicación, conservando como revisión prioritaria la conversación
telefónica estable. El siguiente encargo es comprobar agenda durante llamadas
simuladas y estudiar la integración de llamadas de WhatsApp.

8 de noviembre, auditoría de agenda y vías de llamada. Se añadió el recorrido
local `phone-calendar-audit`: doce turnos en PCM y mu-law llegaron a la
conversación sin despachar propuestas ni acciones de calendario. Se conserva
el resultado no preparado con salida 1; no se marca implementada la agenda
telefónica. Pasaron 79 pruebas de telefonía, SIP, OAuth, proveedores y chat,
además de Conexiones en Edge. Se corrigió la secuencia de acuses del banco y
se repitió Conexiones con Playwright ya instalado tras dos fallos del entorno
de pruebas, conservando los informes anteriores. Sin llamadas públicas,
solicitudes a IA o cambios de calendario. El usuario confirmó número de
WhatsApp Business directo a Meta y pidió evitar permisos técnicos por destino
y minimizar coste. Se investigaron fuentes oficiales: WhatsApp saliente
requiere permiso, potencialmente permanente; SIP/Netelip admite salida oculta
sin comprar DID. Número registrado y habilitación de voz quedan diferenciados.
La conexión WhatsApp local está pendiente y no se consultó la cuenta remota.
[Auditoría y evidencias](melodi-agenda-whatsapp-auditoria-20261108.md).

8 de noviembre, investigación ampliada de salida WhatsApp. El usuario definió
Meta/WhatsApp Business para WhatsApp y Netelip para telefonía directa y pidió
coste mínimo sin solicitud técnica previa al destinatario. Se documentó una
alternativa candidata: llamadas normales del cliente oficial y puente de audio
con Melodi. La gratuidad de esas llamadas está documentada por WhatsApp; la
automatización, el audio y la compatibilidad del número API son hipótesis sin
validar. Se leyeron metadatos de dispositivos de audio sin capturar sonido; no
se observó endpoint VB-CABLE y el inventario Appx no pudo ejecutarse por el módulo.
No se instaló software ni se alteró cuenta, número o proveedor. Sin llamadas,
mensajes o consumo de APIs de IA. Se mantiene pendiente el candidato y se
registran las condiciones de una futura prueba local antes de llamar.
[Fuentes, arquitectura y límites](melodi-whatsapp-cliente-alternativa-20261108.md).

8 de noviembre, canal del cliente WhatsApp implementado y probado localmente.
El usuario autorizó implementación con ensayos simulados y dejó la llamada
real y Meta real para después. Se añadieron pasarela por canal, revisión con
modo ligado al encargo, recibos sin remarcado, persistencia atómica, dos buses
de audio virtual y UI Automation con comprobación de destinatario y controles.
Se reutiliza la voz Live con acuse de envío virtual, sin afirmar escucha remota.
El panel compacto ofrece Vía WhatsApp y Simulación, y el comando explícito
por WhatsApp prepara su revisión. Se conservaron las rutas SIP/Twilio.
Pasaron 26 pruebas nuevas, 17 de telefonía, 6 de streaming y 11 de SIP; además,
Edge recorrió panel-puente-pasarela, dos turnos sintéticos, reapertura sin
almacenamiento del navegador, cancelación e idiomas. UI Automation invocó
controles de una ventana WPF propia y rechazó otra llamada activa.
Dos fallos iniciales del banco nativo se corrigieron: carga de WPF desde el
runtime local y validación por ventana/token/PID real en lugar del lanzador.
Los informes anteriores se conservan. La GPU de las ventanas quedó sin medir.
No hubo llamadas públicas, acceso a WhatsApp real, APIs de IA/voz, captura
personal, instalación de drivers ni descarga de modelos. El modo real queda
bloqueado y pendiente de calibración, cuenta y audio; la API entrante de Meta
y la agenda telefónica conservan su estado pendiente.
[Implementación, límites y pruebas](melodi-whatsapp-cliente-implementacion-20261108.md).

8 de noviembre, Blobatar instalado por petición del usuario. Se fijó 2.7.0
con licencia MIT y esbuild 0.28.2 para desarrollo. El adaptador DOM local usa
identidad del agente para silueta, color y ritmo, mantiene la cara entre
reintentos y cambia expresión según estado. Se integró en barra, detalle y
avisos con limpieza y pausa fuera de vista, documento oculto o movimiento
reducido. Ahorro limita las capas animadas. El bundle no incorpora otro
framework ni bucles por fotograma. Se conservaron revisión y controles.
La revisión visual detectó ojos desplazados por atributos de estilo bloqueados
por CSP; se corrigió mediante CSSOM sin cambiar la política y se aisló el SVG
de las reglas de iconos. La prueba nueva comprueba contención de los ojos y
cero violaciones de estilos. Pasaron seis pruebas y dos recorridos de Edge
con seis trabajos simulados, varios anchos, reintentos, retirada y preferencias.
Los assets suman 24.468 bytes sin comprimir; GPU y consumo físico sin medir.
La instalación consultó npm con scripts deshabilitados. Los ensayos no usaron
proveedores de IA/voz ni encargos reales. Versión, licencia, tamaños y pruebas
quedan registrados; un hash no se usa como prueba de calidad visual.
[Implementación, capturas y evidencias](blobatar-agentes-20261108.md).

8 de noviembre, promoción por escenas a partir del video aportado por el
usuario. Se reconstruyen nueve escenas con identidad de Brivany y contenido
de Melodi, agentes, enfoque y archivos. Se conserva audio AAC sin recodificar
y no se añade locución. HyperFrames0.9.23 valida la composición en Chrome;
una auditoría local verifica ocho condiciones y enumera122 animaciones.
La primera revisión fallida y el primer render se conservan: se corrigieron
entradas, geometría, colisiones, el titular tapado y un botón duplicado.
La comparación visual y la conservación de audio se documentan por separado;
no se afirma identidad píxel a píxel ni funcionalidad real por una simulación.
Se reinició además Brivany con WorkSpace activo por petición paralela.
No se usaron proveedores de IA/voz, modelos descargados ni llamadas reales.
Npm/telemetría tuvieron tráfico; total externo y tiempo efectivo GPU sin medir.
[Producción y límites de comprobación](promo-brivany-referencia-20261108.md).

8 de noviembre, segunda referencia promocional. Se preparó una composición
de dos paneles y se reemplazaron las formas básicas rechazadas por el usuario
mediante una visualización arquitectónica generada con ImageGen. Después el
usuario eligió únicamente el lado de Melodi. Se entrega en1080×1080, con seis
escenas,719 cuadros y audio AAC original sin locución añadida. Se conserva el
proyecto doble y el arte generado, que queda fuera de la selección final.
Pasan validación de Chrome y nueve comprobaciones locales; el render tarda
59,5 s. Ante el bloque rojo visto por el usuario en el editor, se revisan el
PNG fuente, capturas y cuadros decodificados a6,4/6,65 s: el MP4 es normal.
No se declara arreglado el editor ni demostrada su causa. Una generación de
imagen tuvo consumo no informado; tráfico total y tiempo GPU sin medir.
No hubo llamadas, publicaciones ni cambios en código de la aplicación.
[Entrega, selección, evidencia y límites](promo-melodi-version-unica-20261108.md).

8 de noviembre, primera pieza profesional de traducción auditiva. Se
reconstruyó el panel blanco animado con el video aportado como referencia.
El guion cita W3Techs y PLOS One, con locución de Melodi y fragmentos de
Blender acreditados. El ensayo retrospectivo generó una primera voz en
español. Tras la revisión del usuario se cotejó el diálogo, se sintetizó
una toma masculina madura con subtítulo y se rotuló como doblaje editado.
Una solicitud de voz para esta corrección, importe sin medir. Se compuso
música original local, se quitó el distintivo y se concentraron los créditos
en el cierre. HyperFrames pasó sin errores y el archivo decodificó 1.620
cuadros, 54 s y audio estéreo de −16,1 LUFS. Se inspeccionaron ocho cuadros.
Clonar la voz de Proog queda pendiente de consentimiento expreso del actor.
[Producción, pruebas y alcance](promo-brivany-traduccion-auditiva-20261108.md).

12 de noviembre, Melodi centrada al activar voz en el chat, con tres ondas
escalonadas detrás durante la reproducción PCM. Se conserva el personaje de
WorkSpace, Muse/Meta/Cartesia, el historial y el borrador. Se corrigen el estado
de configuración antiguo, el límite de 12 s inferior al del servidor, el inicio
fallido sin explicación y la activación tardía tras cancelar. Pasan 51 pruebas
JavaScript, nueve del puente, interfaz en Edge e historial/recuperación. Una
prueba nativa previa abrió y liberó el micrófono sin ASR; una conexión real de
control a Muse respondió en 0,750 s sin audio. Importe de esa conexión desconocido.
El primer fallo del banco AudioWorklet se conserva y se documenta su corrección.
Se aplica el cambio con respaldo a la instalación local y reinicio normal; no
se publica un instalador nuevo. La conversación y escucha física completas
siguen sin comprobarse. [Implementación, pruebas y límites](melodi-voz-central-20261112.md).

12 de noviembre, corrección posterior de Live a partir del código de Vetsa App.
Se trasladan sus reglas de cierre por pausa, agrupación de fragmentos, generación
y síntesis concurrentes e interrupción. Se corrige el retorno prematuro de voz
que retiraba respuestas y perdía su controlador. Las conversaciones ordinarias
evitan otra inferencia previa; acciones y human-skills conservan sus recorridos.
Se preparan dieciséis señales de Melodi, variadas sin repetición y reutilizadas
desde disco, además de la guía contextual abierta para las respuestas.
El ejecutor instalado no encontraba un backend verificado: se instala un paquete
local permitido de 104 archivos y pasa el sondeo nativo. La app reinicia con
backend activo y dieciséis señales disponibles, sin repetir la orden del usuario.
Pasan las suites y el recorrido de interfaz; se conservan los fallos de los bancos.
Tres mediciones reales confirmaron nueve solicitudes de proveedor y variación
de primera señal de audio; el banco costó dieciséis síntesis nuevas. Importe y
GPU desconocidos. Un ensayo real inicial perdió sus métricas al cerrar el doble;
su consumo se registra como desconocido, separado de esas cifras confirmadas.
[Cambios, evidencias y límites](melodi-live-vetsa-20261112.md).


12 de noviembre, preparación real de Telnyx para la primera llamada de Melodi.
La clave existente fue aceptada y se crearon el perfil de salida y la conexión
SIP «Brivany Melodi», con emisor verificado, destinos DO/US, una llamada
simultánea, límite diario US$5 y tarifa máxima US$0,30/min. Se comprobaron esos
valores por lectura de API y se guardó el perfil cifrado con DPAPI. El primer
registro falló antes de contactar con Telnyx: una variable de la prueba entre
pares ocultaba el constructor de URI. Se corrigió y añadió registro nativo de
loopback sin marcar; check-sip también devuelve ahora fallo real por JSON y
código de salida. Pasaron 14 pruebas de telefonía, 7 de SIP y 7 de conversación
con proveedores sustituidos. El segundo registro real recibió SIP 200. Se
conservan el fallo y la corrección; 16 solicitudes REST Telnyx conocidas, dos
intentos de inicio SIP y ningún número marcado ni proveedor de IA utilizado.
Saldo visible US$14,79 antes y después del aprovisionamiento; facturación y GPU
sin medir. El control del portal terminó por no poder verificar la URL. La
configuración se comprobó por API/SIP, sin certificar la pantalla final ni
actualizar la instalación activa. La llamada PSTN y la conversación siguen
pendientes. [Configuración, pruebas y límites](melodi-telnyx-configuracion-20261112.md).


12 de noviembre, primer intento real de Telnyx para conversar con el usuario.
Un solo marcado autorizado a su línea personal, emisor verificado y registro
SIP 200. La terminación devolvió 404 / Q.850 1 antes de respuesta confirmada;
no se abrió la conversación ni se usaron Muse, Meta o Cartesia. El CDR posterior
coincide con destino, conexión y perfil y declara UNALLOCATED_NUMBER, ruta Intra,
segundos facturados 0 y coste US$0. El usuario confirma que la línea recibe
llamadas normales; el mensaje genérico inicial no demuestra número incorrecto.
La primera consulta de detalle estaba vacía y otra lectura falló por comunicación.
Se conocen seis intentos REST en total, uno fallido; paquetes SIP y GPU sin medir.
No hubo segundo marcado, audio ni transcripciones guardados, compra ni envío a
soporte. La conversación y la causa de rechazo del operador siguen pendientes.
[Intento, diagnóstico, evidencia y límites](melodi-telnyx-primera-prueba-20261112.md).

13 de noviembre, corrección de arranque y Spotify. Se confirma el documento
nativo abierto sin inicializar scripts ni iframe; un reinicio normal recuperó
el historial. Se añadió recuperación nativa de un único intento antes de que
inicie el chat, con prueba WebView2 de scripts 503 y conservación del control
de la página una vez inicializada. Se corrigió el dominio de vinculación de
Spotify, se retiró el ID personal de entorno y el configurador de la interfaz,
se comprueba la cuenta antes de aceptar el nuevo acceso y se separan renovación
y recuperación de música entre cuentas. Pasan 43 pruebas Spotify, 26 de estado,
26 de recuperación, dos de recursos y recorridos locales nativos y visuales.
Se conservan los fallos intermedios y un timeout del banco antiguo de cuenta.
La instalación queda actualizada y el nuevo arranque confirma chat/compositor,
dos conversaciones y 17 mensajes en la conversación abierta. Cinco consultas
HTTPS explícitas conocidas, cuatro de ellas en un flujo retirado sin cuenta,
tokens ni audio. Tráfico de fondo, importe agregado y GPU sin medir; ninguna
inferencia solicitada por los ensayos. Acceso universal pendiente de aprobación
de Spotify; no se certifica aún consentimiento ni reproducción de una cuenta
real. [Cambios y evidencias](arranque-spotify-20261113.md).

Registro posterior de Expansión musical: casilla a 60 segundos de inactividad,
Spotify/YouTube, vista previa y dos estilos, Luna y órbita y Tipografía ámbar.
Se corrigieron el estado de la vista previa tras pausa y el margen de las bandas
inclinadas. Instalación musical actualizada con respaldo y casilla activada;
los acompañantes del equipo permanecen preparados en código y ensayos sintéticos,
sin activar su nueva interfaz nativa. Las pruebas de temporizador, composición,
protocolo, extensión y Edge están registradas; YouTube personal, audio físico,
recarga de extensión y minuto real siguen pendientes tras la interrupción del
control visual. Sin originales adjuntos ni inferencia; descargas y GPU sin
contabilizar. [Implementación y límites](expansion-musical-20261113.md).

Corrección posterior al registro de transferencia del mismo día: se publicó
la versión 10d51217-cbe4-4594-88ab-a5c22caabe01 del Worker y se actualizaron
nueve archivos de la instalación cerrada con respaldo. Tres assets públicos
coinciden con los bytes locales. No se usaron QR, sala ni archivos personales en
esa comprobación; móvil físico pendiente. Esta actualización no reescribe los
registros previos que dejaban publicación e instalación pendientes. El importe
público no se midió. [Evidencia ampliada](transferencia-borde-20261113.md).

Corrección adicional del mismo hito de arranque/Spotify: se conserva el acceso
DPAPI anterior si falta el caché de identidad al retirar la configuración de
entorno. Pasan 44 pruebas Spotify. Se aplicó un respaldo e instalación adicional
del servicio y se confirmó otro arranque con chat/compositor y los mismos
contadores de historial. La observación nativa encontró el chat; el control de
ventana no obtuvo geometría/captura para navegar a Conexiones. Se mantiene pendiente
consentimiento, audio real y acceso público aprobado por Spotify. Evidencias
ampliadas en [el documento del hito](arranque-spotify-20261113.md).

13 de noviembre, Spotify para uso inmediato en Development. El usuario autorizó
la aplicación de su captura y confirmó daniel@vetsa.es como contacto; indicó que
no existe empresa registrada. Se comprobó que el servicio publicado ya coincide
con esa aplicación y callback, sin rotación de claves. Se prepararon origen,
contacto, modo de acceso explícito y consentimiento renovado en el servidor;
metadatos y aviso de prueba en el cliente conservan compatibilidad con el servicio
anterior. Pasan 46 pruebas Spotify, 37 de Worker y el recorrido visual aislado.
Siete consultas reales verifican el relay con autorización/cuenta sintéticas,
retirada y cero peticiones a Spotify; dos consultas iniciales adicionales al
sitio. Documentación, tráfico de fondo, GPU e importe agregado sin medir.
No se publicó el sitio: el índice activo difiere del local y no debe sustituirse
contenido ajeno a Spotify. El ID ya activo permite el uso actual; metadatos y
consentimiento nuevos del Worker quedan preparados. Se respetó la transferencia
y solo tras la autorización posterior de reinicio se guardó/cerró normalmente
Brivany, aplicaron tres archivos con respaldo y confirmó chat/compositor e
historial. Acceso público pendiente de empresa, elegibilidad y aprobación de
Spotify; no se presentó formulario ni usó una cuenta real en los ensayos.
[Configuración, instalación y límites](spotify-development-20261113.md).

13 de noviembre, migración real de WhatsApp a Melodi. El código canónico y los
adaptadores se trasladan de Vetsa-Asistant a Brivany con respaldo protegido de
los cambios locales previos, configuración remota y tablas pertinentes. El bot
y sus antiguas personalidades se retiran del servicio activo. Se conservan el
número, Worker, colas, D1 y R2; la cola se pausa y reanuda sin purgar mensajes.
Se publican el runtime de una Melodi y el proxy del sitio oficial conservando
los assets existentes. Copia idempotente de 26 tablas y 50 elementos de esquema,
con recuentos comprobados y cero infracciones de claves foráneas en la consulta
real. Se instalan siete archivos con respaldo, cierre y arranque normales.
Hay 39 skills y 39 herramientas estructuradas, con aislamiento de usuarios,
permisos de un uso y métricas empresariales reservadas al operador. Pasan 339
pruebas de publicación, 34 del puente/cuenta/HTTP, cinco del sitio y 37 de
regresión Spotify. La suite histórica de múltiples personalidades conserva
fallos y fixtures pendientes; no se presenta como aprobada. La inspección
visual nativa de Conexiones no pudo completarse por el control de ventana.
Importe agregado, tráfico de fondo y GPU sin medir; no se solicitó inferencia
como ensayo. [Implementación, pruebas y límites](melodi-whatsapp-migracion-20261113.md).

Corrección del mismo hito: los primeros enlaces Google fallaron en el POST
porque los constructores OAuth todavía exigían el correo fijo que se había
retirado. Se corrigió y se añadió el recorrido completo, incluidos tres ensayos
HTTP reales con enlaces de prueba separados de los distribuidos. Se mantienen
los resultados anteriores y los recibos de entrega/lectura. El titular conectó
Calendar. El aviso posterior de Drive/Gmail es la verificación externa de
Google; no se confunde con un fallo del servidor. Se limitan los permisos nuevos
a lectura de archivos existentes, documentos propios, lectura de correo y
borradores/envíos solicitados. Se guardan en Cloud Console nueve permisos y
justificaciones de Desktop y WhatsApp. La solicitud final no se envió: falta
demostración actualizada del cliente web y no hay evaluación CASA completada.
Se avisó por WhatsApp y se solicita consentimiento para preparar una prueba con
archivo y borrador ficticios. No se contrataron evaluaciones ni se adjuntan
credenciales, conversaciones o videos originales al registro.
[Preparación y requisito pendiente](google-whatsapp-verificacion-20261113.md).

Corrección posterior del retorno OAuth, 13 de noviembre: la autorización real
detectó otra comparación de Drive contra el correo fijo vacío y que Gmail no
persistía los scopes concedidos. Ambas corregidas y publicadas en la versión
9cb30c5513c3411c9918b710b0ac6492, con 341 pruebas locales aprobadas. El usuario
detuvo el control visual antes de repetir el consentimiento; no se declaró
la conexión completa. El 14 de noviembre informa que envió personalmente la
solicitud de verificación de Google y aporta su progreso en revisión.

14 de noviembre, continuación: puente nativo saliente de Brivany para el
ordenador, diario de una ejecución por orden, resultados privados y respuestas
de aprobación por WhatsApp. Se implementa programación por canal, conservando
Telnyx y añadiendo medios WebRTC de Calling API. Pasan inicialmente 355 pruebas
de servicio y doce del host, incluido DTLS/Opus en loopback con PCM sintético.
Sin marcar teléfonos en esos ensayos; publicación, instalación y habilitación
real de Meta se comprobarán aparte. aiortc 1.16.0 y dependencias de PyPI se
instalan en desarrollo; descargas e importe agregado no contabilizados.
[Alcance, pruebas y límites](melodi-whatsapp-escritorio-llamadas-20261114.md).

14 de noviembre, comprobación y publicación del mismo hito. Puente del ordenador
y programación por canal publicados e instalados en la ruta real `app/`, con
respaldo y conservación de datos. Se corrige expresamente la afirmación anterior
de instalación de siete archivos: la copia previa no apuntaba al cliente activo.
Se añaden adjuntos privados, devolución de resultados, cancelación en cola,
recuperación idempotente de despachos, expiración y delegación acotada al equipo
de Melodi. Pasan 360 pruebas del servicio, 17 del host, 34 de cuenta/HTTP, cinco
del sitio, 29 de Call Control, 30 de coordinación y 34 de ordenador. Telnyx real
confirma disponibilidad; no se marcó. Meta rechaza activar llamadas con 138015
(límite de mensajería mínimo 2.000); avisos de bloqueo y requisitos leídos por el
titular en WhatsApp. El primer diagnóstico real remoto falló; se conserva el
resultado y no se afirma causa resuelta. Un diagnóstico aislado y un segundo
recorrido remoto tras reinicio normal pasaron (284 y 268 procesos), sin inferencia.
Computer Use no pudo capturar la ventana ni tras recuperar; no se certifica
control gráfico visible. Se creó el avatar blanco solicitado con image_gen,
guardado en Exports/Melodi-WhatsApp, sin modificar el perfil público. Importe,
tráfico de fondo y GPU agregados sin medir; Google continúa en revisión externa.
[Implementación y límites](melodi-whatsapp-escritorio-llamadas-20261114.md),
[requisitos oficiales de Meta](meta-llamadas-requisitos-20261114.md).

14 de noviembre, corrección posterior del mismo hito. Se aísla el cambio de
cuenta del host retirando tareas y referencias anteriores; se corrige cancelar
una llamada cuando el despacho reservó su orden pero aún no guardó el vínculo.
Pasan 361 pruebas del servicio y 18 del puente, sin marcar teléfonos. Corrección
publicada en `3c6ae90be84a4d5a8bc832cb4207d1b8` e instalada con cierre y arranque
normales; los 24 archivos del cliente activo coinciden con el origen. Ocho
comprobaciones públicas pasan, con latido real y disponibilidad Telnyx. Meta
confirma lectura de los tres avisos, incluido el de funciones operativas. El
bloqueo 138015 continúa; sin llamada pública, aprobación de Google ni certificación
visual nueva. Se preserva el primer fallo remoto y su causa sin certificar.
Infraestructura y consumo agregado no contabilizados.
[Corrección y evidencia](melodi-whatsapp-escritorio-llamadas-20261114.md).

14 de noviembre, solicitud del titular: se añade `LICENSE` en la raíz con el
texto estándar MIT y copyright 2026 Daniel Luna. README enlaza la licencia del
código original y conserva el alcance de los avisos de terceros. Se comprueba
contra el texto de Open Source Initiative; no requiere pruebas de ejecución.
La creación es local y no declara que GitHub ya haya incorporado la licencia
ni que Anthropic haya aceptado la solicitud.

14 de noviembre, dirección posterior del titular: se retira WhatsApp Calling y
se publica el servicio de llamadas telefónicas `brivany-calls` en Brivany.
Horarios en alarmas SQL persistentes, Telnyx sin dependencia del PC y voz exacta
de Melodi exclusivamente en Cartesia. El chat conserva los pedidos y las
aprobaciones. Se incorpora control por voz del PC vinculado mediante RPC privado,
sin ampliar el propietario ni la instrucción pronunciada. El PC debe seguir
encendido para ejecutar sus tareas. Un resultado incierto no vuelve a marcar.

Pasan los recorridos locales de alarmas, persistencia, firma, interrupción,
WebSocket y voz, con proveedores sustituidos. Comprobaciones reales de solo
lectura confirman Telnyx, acceso a la voz Cartesia, SQL y ordenador; las rutas
públicas exigen firma y sesión. Se recupera un vínculo del operador hallado con
502 bytes a cero, conservándolo y retirando exclusivamente su dispositivo previo.
El vínculo nuevo pasa lectura DPAPI, latido y diagnóstico remoto de solo lectura.
La causa de la corrupción no se ha establecido.

La prueba funcional real con frase sintética pasa Cartesia, Muse, transcripción
y diagnóstico del ordenador. Se corrigen la respuesta del modelo y un parámetro
de razonamiento rechazado. La comprobación aislada posterior del modelo pasa:
una herramienta elegida, 902 tokens de entrada y 303 de salida según el proveedor,
sin ejecutar una acción desde ese modelo de prueba. Se reutilizan los resultados
anteriores de audio y escritorio. El titular condiciona la llamada real a terminar
las comprobaciones; hasta este registro no se ha marcado. Coste agregado de
infraestructura, lecturas, síntesis e inferencia sin medir. El aviso de servicio
en nube tiene recibo de entrega por WhatsApp. Se conserva Google en su revisión
externa. [Implementación, correcciones y límites](melodi-llamadas-cloud-20261114.md).

14 de noviembre, preparación de la solicitud de Claude for Open Source: se
guardan los tres textos en inglés sobre alcance, uso de la suscripción y datos
adicionales, describiendo la adopción temprana sin inventar métricas. El formulario
no se envía desde esta tarea. [Borrador](claude-oss-solicitud-20261114.md).

14 de noviembre, prueba telefónica posterior. Después de pasar las verificaciones
previas se hizo un único intento autorizado al titular, a las 16:18 UTC. Telnyx
registra quince segundos de espera, causa `timeout` y SIP 487, sin respuesta.
Voz, transcripción y pedidos al PC: cero. Se conserva el recibo interno inicial
`media_disconnected` junto a la corrección basada en el proveedor; no se declara
superada la conversación ni el control desde el teléfono.

Se publica espera de 45 segundos, temporizadores de voz desde la respuesta y
estado «sin respuesta». Pasan 27 pruebas de llamadas y 361 de WhatsApp; once
comprobaciones públicas confirman cuatro bundles y la configuración. No se
remarca. Brivany había quedado cerrada tras el fallo de memoria de Windows; se
inició de nuevo con vínculo cifrado íntegro y volvió a verificarse disponible.
Causa del cierre y coste agregado sin certificar. Aviso actualizado entregado por
WhatsApp a las 16:31:53 UTC. Queda pendiente atender una llamada para completar
la prueba. [Resultado y evidencia](melodi-llamadas-cloud-20261114.md).

15 de noviembre, servidor e interfaz de desarrollo iniciados desde el código.
Se comprueba el estado privado `ready=true`, sin tareas ocupadas, y se habilitan
en el entorno del proceso los binarios de video ya instalados. Comprobación local:
motor de escenas disponible, ruta de referencia seleccionada y encargo de 931
caracteres válido para el contrato del chat. La ruta de la interfaz nativa no se
reabre externamente: su sesión protege la navegación. No se genera todavía MP4.

Se revisan seis muestras de la referencia privada, de 98,1 segundos y 720×1280 a
30 fps: fondo negro y dos esferas de neón. Se prepara el encargo para el chat con
Melodi como asistente personal de Daniel Luna y una recreación de llamada a una
clínica dental para limpieza bucal. No se ejecuta una llamada ni reserva real.
El original y las muestras no se adjuntan a la bitácora. La separación futura por
usuario de nombre y número queda registrada como decisión pendiente, sin compra
de números ni cambio de producción. Sin generación de proveedor iniciada desde
esta tarea; tráfico de fondo no medido. [Decisión](identidad-asistentes-20261115.md),
[encargo](../Exports/Melodi-Daniel-Luna-Dentista/ENCARGO_CHAT.md).

15 de noviembre, correcciones del chat reportadas por el usuario. Se alinean
los plazos del cliente y del servidor, se entrega historial acotado al resumen y
a sus agentes, se evita duplicar la respuesta en la actividad y se muestran
resultados concretos. Las preguntas explicativas no abren tareas de instalación.
Videos y audios se adjuntan por selector o arrastre, con transferencia local,
validación y errores visibles que conservan la selección anterior.

Pasan 37 pruebas de ordenador, 30 de coordinación, 10 de conversación y 63 de
JavaScript, además de los recorridos locales de adjuntos, indicador de espera y
voz con proveedores sintéticos. El ejecutor nativo confirma su arranque sin
entrada al ordenador; no se repiten los pedidos de Paint/YouTube. El cierre de
desarrollo conserva el chat y no fuerza procesos. Sin inferencia real iniciada
por estas pruebas; GPU y tráfico de fondo sin medir. La interacción completa y
la calidad de una nueva generación quedan para la prueba del usuario.
[Cambios, evidencias y límites](chat-adjuntos-resumen-20261115.md).

15 de noviembre, revisión de adjuntos y fallo de creación de video. Tarjetas
compactas arriba del texto, con miniatura local y sin peso, según la corrección
del usuario. La barra del textarea se oculta conservando el desplazamiento.
Al enviar, el adjunto pasa al mensaje y sale del borrador; la selección propia
del mensaje conserva el archivo para la tarea e impide heredarlo al siguiente.

El análisis de referencia había terminado, pero el JSON del plan de escenas
falló antes de entrar al bloque de corrección. Ese bloque ahora incluye la
generación del borrador, con hasta tres intentos y errores legibles. Voz y
exportación esperan un plan válido. Pasan las pruebas locales de selección,
miniaturas, recuperación, chat y voz; la suite de video pasa 46 casos y omite dos
por falta de FFmpeg en su PATH. Reinicio normal confirmado con el nuevo asset.
Sin inferencia iniciada por estas pruebas, sin repetir la generación privada;
GPU y tráfico de fondo sin medir. [Evidencias y límites](chat-miniaturas-plan-video-20261115.md).

15 de noviembre, reintento contextual del video y controles de ventana. Se
confirma retrospectivamente un reintento de 30 segundos sin referencia, frente
al encargo original de 98. Ahora se identifica el pedido desde el chat y se
conserva su contexto cifrado por conversación; los recibos no guardan el texto.
Se recuperó el pedido antiguo y su adjunto idéntico sin generar otro video.

Por petición expresa, minimizar y cerrar mantienen la ventana en la barra de
tareas, sin activar WorkSpace. La X propia de WorkSpace permite cerrarlo y volver
al chat. La salida completa sigue en la bandeja. Pasan seis pruebas de reintento,
37 de ordenador, 47 de WorkSpace, dos de arranque y once comprobaciones de UI
simulada. Desarrollo reiniciado normalmente y disponible. No se inicia inferencia
para estas verificaciones; generación final y minimización física pendientes de
prueba del usuario, GPU y tráfico de fondo sin medir.
[Cambios, correcciones del banco y evidencias](reintento-video-ventanas-20261115.md).

15 de noviembre, corrección de la llamada visual rechazada. Nuevo modo finito
con esferas huecas y actividad del PCM, geometría medida en la referencia y sólo
nombres breves. Se separan los interlocutores de Cartesia conservando el ID de
Melodi. El usuario eligió 98 segundos con diálogo ampliado, sin música y con
efecto suave de llamada: revisión exportada con 22 turnos y pausas de 0,227 s.
Original conservado, MP4 y ZIP editable nuevos y resultado añadido al chat cifrado.

El chat muestra una vista negra animada durante la creación. Las preguntas
ordinarias escritas omiten la clasificación adicional; una prueba real dio el
primer texto en 2,109 s, sin garantizar latencia constante. Pasan regresiones de
contrato, voces, mezcla finita, conversación, ordenador y UI. Se corrigió una
mezcla temporal sin límite reutilizando sus voces y suprimiendo sólo ese WAV.
Consumo conocido: dos borradores Meta, 22 síntesis Cartesia, una consulta de
catálogo y una pregunta sintética; importe y GPU sin medir. No se iniciaron llamadas
telefónicas. Revisión visual de muestras realizada; audición humana y fidelidad
exacta sin certificar. [Entrega, pruebas y límites](video-llamada-voces-carga-20261115.md).

15 de noviembre, nueva referencia y guion de Melodi con Dr. Esteban. A petición
del usuario se reemplazan los 98 segundos anteriores por los 88,142948 segundos
exactos de la referencia. Se conserva el diálogo transcrito, adaptando nombres;
se retiran las menciones de demostración y datos ficticios. Voz masculina
Cartesia distinta, voz exacta de Melodi, tono inicial local y efecto telefónico
suave, sin música. Giro continuo en reposo y al hablar, con fase global y sin
reinicio entre turnos. Se incorpora el soporte al contrato y al renderizador.

Pasan 30 pruebas de llamada y 32 de Cartesia; regresión audiovisual: 49 casos,
dos omitidos. Comprobación real de las 18 escenas y comparación textual del
guion; MP4 de 17 turnos y ZIP nuevos, resultado añadido al chat cifrado y
desarrollo reabierto normalmente. Se conservan fallos del banco y un render
propio cancelado para corregir un salto de giro. Consumo conocido: una
transcripción Deepgram completada tras un intento 401 (envío autorizado por el
usuario), 22 síntesis Cartesia y 1.175 caracteres, con reutilización de fragmentos.
Importe y GPU desconocidos; sin nuevas llamadas telefónicas. La escucha humana
y la fidelidad visual exacta siguen sin certificar.
[Cambios, entrega y evidencias](video-referencia-dr-esteban-20261115.md).

15 de noviembre, cadencia nativa y risitas del diálogo. El usuario detectó
vocales alargadas y pausas excesivas. Se elimina el estiramiento por `atempo`:
los 19 fragmentos hablados conservan su PCM y velocidad, y se calcula el montaje
alrededor de ellos. Se añaden seis risitas suaves con las mismas voces Cartesia,
sin alterar el guion ni los 88,142948 s. La separación añadida es 353 ms tras cada
fragmento; la mayor pausa interna medida, incluyendo los bordes de voz, es 750 ms.

Pasan 31 pruebas de llamada y 47 de 49 casos audiovisuales, con dos omitidos;
comprobación de movimiento y MP4 correctas. Dos muestras con el modelo de audio
actual no muestran vocales estiradas ni artefactos; una consulta anterior al
modelo 1.2 no pudo evaluar el audio y se conserva como tal. Son comprobaciones
automáticas, sin audición humana. Nuevos MP4 y ZIP, resultado añadido al chat
cifrado y desarrollo reabierto. Consumo nuevo: dos síntesis Cartesia, 20 caracteres,
tres consultas de evaluación Meta y tres de catálogo; importe y GPU desconocidos.
Los originales y las entregas previas se conservan.
[Corrección, mediciones y límites](video-voces-nativas-20261115.md).

15 de noviembre, identidad personal y presentación del chat. Perfil local
cifrado y aislado por cuenta para reconocer al propietario de Melodi, con una
consulta real de reconocimiento correcta. Se abrió una simulación nativa de
agentes sin ejecutar encargos, se incorporaron puntos junto a Pensando y
escritura progresiva con fundido para mensajes nuevos. Miniaturas negras de
imagen/video con cuatro círculos y porcentaje estimado por etapas, sin leyendas
interiores. Propuesta visual de briva sans creada como imagen, sin fuente
compilada ni sustitución en la interfaz. Consumo conocido: una consulta de chat
y una generación de imagen; importe y GPU desconocidos, sin TTS ni llamadas.
[Implementación, pruebas y alcance](chat-identidad-agentes-20261115.md).

Corrección posterior del mismo hito: la miniatura conserva tarjeta, nodo,
dimensiones y animación de cinco segundos sin escalado ni reinicios. Las caras
Blobatar quedan fijas por función; mirada estable, parpadeo y flotación suave.
La barra del chat muestra hasta cuatro agentes, con modal para todos, detalles
por hover/foco y modo oculto persistente que no detiene las tareas. Pasan las
pruebas de barra/modal, movimiento y CSP, 30 muestras de geometría durante
escritura/progreso, proporciones a 320 px y regresión de WorkSpace. Se conserva
el fallo del banco por estado de teléfono ausente y su nueva ejecución correcta.
La carga nativa final sigue pendiente de reinicio. El cierre de la demostración
no se ejecutó por fallo de revisión automática de permisos debido a límite de
uso; no se eludió ese control. Sin proveedores externos en estas correcciones;
GPU sin medir. [Evidencias y límites](chat-identidad-agentes-20261115.md).

Comprobación posterior: recuperada la revisión de permisos, Brivany se reinició
por su control privado normal y confirmó listo, sin operaciones ocupadas. Su
servidor entrega los nuevos assets de barra/modal, flotación y miniaturas.
No quedan procesos de la demostración. El acceso sin sesión a la pantalla
continúa rechazado, como está previsto. Se resuelve la carga pendiente del
registro anterior; no hubo nueva interacción de control de pantalla ni una
inspección visual nativa final. Sin llamadas a proveedores para esta comprobación.
[Estado y evidencias](chat-identidad-agentes-20261115.md).

15 de noviembre, Brivany Editorial adoptada como tipografía oficial por elección
del usuario. TTF suministradas intactas y WOFF2 con glifos y métricas conservados,
licencia y atribución de Lato/OFL preservadas. Aplicadas a programa, módulos,
widgets, expansión musical, web, QR y motores de nuevas promociones/videos.
Familia instalada para el usuario de Windows y nueva guía visual, conservando
las exportaciones anteriores. App de desarrollo reiniciada normalmente.

Publicado el sitio y el Worker de transferencia, tras comparar su código remoto
y conservar sus variables. Verificados los tres archivos públicos y su uso real
en portada, privacidad y las dos páginas QR. Pasan integridad, GDI+, UI, motores
de medios, agentes, adjuntos y regresiones móviles. La inspección de fotogramas
detectó que el wordmark sólo aclaraba su primera letra: se corrigió con tinta
heredada para todas las letras y se revisó otra muestra final. Se conservan los
fallos intermedios del banco y sus ejecuciones correctas. Sin nueva inferencia,
TTS ni generación de imágenes; dos publicaciones reales, importe y GPU sin medir.
No se declara un instalador firmado nuevo ni revisión visual nativa final.
[Implementación, pruebas y límites](brivany-editorial-20261115.md).

15 de noviembre, portal privado de correo publicado en software.vetsa.es/correo.
Dos bandejas corporativas sobre el Gmail ya autorizado; Reply conserva el hilo,
permite texto propio y adjuntos de hasta 5 MiB, y evita retransmitir resultados
inciertos. Remitentes comprobados en el servicio de correo existente, sin ampliar
permisos Google. Pasan 40 pruebas Gmail/portal y tres del bundle exacto; revisión
visual de escritorio/móvil y PNG sintético. Ambas bandejas y configuración de envío
comprobadas en producción. No se creó borrador ni se envió correo real. Publicación
acotada preservando recursos y ajustes del Worker. Consultas reales: coste no
medido. [Entrega y límites](vetsa-correo-20261115.md).

16 de noviembre, encargo de informes de entrega de correo en WhatsApp. Melodi
localiza el correo del proveedor sobre el Gmail ya autorizado, abre su adjunto
comprimido reconociendo el envoltorio por su contenido —gzip, zip o JSON suelto—,
comprueba la forma del informe agregado y traduce cada causa a una frase
corriente con su recuento y el servidor afectado, sin siglas ni direcciones de
los servidores emisores. El tick programado avisa por su cuenta, una sola vez
por informe, reservando antes de enviar; un envío fallido lo devuelve a la cola
y un buzón sin conectar no avanza la marca de revisión. Un adjunto que no abre
se declara en lugar de resumirse. La herramienta de conversación reutiliza la
intención y el permiso de lectura de correo existentes, sin ampliar permisos de
Google. Se añade la nota de voz con la voz exacta ya seleccionada de Melodi,
enviada sólo a petición y confirmada sólo con el recibo real; sale como audio
mp3, no como burbuja nativa. Su registro pasa a contar consecuencias en vez de
mecanismos internos. La cota del catálogo del planificador sube de 40 a 48, que
estaba exactamente en su límite y rompió 24 pruebas antes de corregirse. Pasan
384 pruebas locales de publicación y 35 de whatsapp-cloud, con proveedores
simulados, y el bundle se construye sin publicar. Sin cuentas reales de Google,
sin mensajes de WhatsApp, sin síntesis real de voz y sin consumo medido ni
conocido. Queda comprobarlo con un informe real del buzón.
[Implementación, pruebas y límites](informes-entrega-correo-20261116.md).

16 de noviembre, comprobación con el buzón real. Nueve informes de Google sobre
vetsa.es, uno por día; se abrieron tres adjuntos reales (5, 8 y 12 de noviembre,
311 bytes cada uno) y el lector los reconoció, descomprimió y explicó sin
cambios. Tres detalles del formato real que no se conocían: el adjunto llega con
el tipo propio application/tlsrpt+gzip, que la detección por contenido ya cubría;
el identificador del asunto usa puntos en vez de dos puntos y se lee bien; y la
norma declarada de vetsa.es está en modo de prueba, de modo que un informe sin
fallos no demuestra que el correo viaje exigiendo protección. Lo último se
incorporó al análisis y se dice en una línea aparte. El contenido exacto del
informe del 12 queda fijado como prueba de regresión. Pasan 386 pruebas locales.
Sólo lectura y descarga de adjuntos: no se envió correo ni se modificó ningún
mensaje o etiqueta; tres descargas y cuatro consultas de Gmail, coste no medido.
Un informe real con fallos sigue sin verse: esa rama se prueba con datos
construidos. [Implementación, pruebas y límites](informes-entrega-correo-20261116.md).

16 de noviembre, nota de voz nativa y publicación. La burbuja de WhatsApp exige
Ogg con Opus en un solo canal y la marca voice en el envío; el proveedor de voz
sólo entrega raw, wav y mp3, así que la codificación se hace en el Worker con
libopus compilado a WebAssembly y un contenedor Ogg escrito a mano. Síntesis real
comprobada: 13,52 s y 40.794 bytes, que ffprobe lee como ogg/opus mono a 48 kHz,
ffmpeg decodifica sin errores y volumedetect confirma voz y no silencio.

El titular observó que Melodi le respondía «Hola, Brivany». La causa era que su
camino de respuesta autónoma no recibe ningún nombre verificado y su voz sólo
tenía la prohibición de no suponer nombres: tomó el único nombre propio a la
vista, el de la aplicación. Ahora el nombre del titular se resuelve desde la
configuración, nunca desde el mensaje, y su voz le pide usarlo cuando suene
natural y prohíbe de forma expresa usar Brivany, Melodi o Vetsa como su nombre.

Antes de publicar se detectó que el publicador del repositorio adjuntaba un solo
archivo: con dos módulos en el bundle, el Worker se habría caído al arrancar. Se
corrigió para adjuntar todos los módulos que el bundle nombra. Respaldo previo
tomado; publicado con 56 bindings heredados en modo estricto, assets conservados
y los dos módulos subidos. Ambas rutas responden después de publicar. La clave de
voz no existía en el Worker y se añadió como secreto. Pasan 394 pruebas locales.
Queda comprobar en real que Melodi envíe la nota de voz por WhatsApp.
[Implementación, pruebas y límites](informes-entrega-correo-20261116.md).


15 de noviembre, navegación del chat, revisiones de imágenes y presencia de agentes.
El chat abre abajo, conserva la lectura al subir y ofrece flecha de regreso.
Títulos locales y renombrado manual, Mostrar más/menos, barras sin flechas y
Conexiones/Bitácora dentro de Ajustes. Brillo azul, espera y fundido al terminar,
sin aviso de éxito dentro de la app; notificación nativa solo en segundo plano.
El tooltip ya no se reinserta en cada actualización. Los contadores de imagen y
video arrancan en 1 y avanzan como estimación acotada, sin atribuir al proveedor
un porcentaje que no proporciona. Escritura más suave, edición de la imagen
verificada del mismo chat y conservación del original. Icono de Brivany desde
la creación de la ventana y bloqueo de reinicio durante tareas activas.
Pruebas locales, Edge aislado y lectura del icono nativo; sin generación real
de la imagen del usuario, proveedores ni captura del escritorio. GPU sin medir.
Las notificaciones se probaron con componentes sustituidos.
[Implementación, verificación y límites](chat-navegacion-ediciones-20261115.md).

Comprobación final del mismo hito: versión de desarrollo reiniciada por el
canal privado, chat guardado y disponibilidad confirmada. Recursos servidos
coincidentes con la revisión y título/icono nativos de Brivany comprobados sin
captura ni entrada de sistema. Los ensayos nuevos cubren el tooltip estable
en ambos lugares, el avance estimado sin contador del proveedor y notificación
única en segundo plano con apertura del chat. Entrega de alertas de Windows
simulada, no se emitió una notificación ficticia al usuario.

16 de noviembre, dos correcciones vistas en producción. La nota de voz llegó al
teléfono del titular como burbuja nativa y se escucha bien, pero el turno dijo
que no pudo confirmar si había llegado: el ejecutor firma su recibo con estado
«sent» y el verificador exigía «completed» a toda herramienta no declarada, así
que descartaba un recibo válido. No falló el envío ni Meta; la comprobación de
honestidad funcionaba sobre un recibo con forma no reconocida. Se declara la
herramienta junto a gmail.send y se añade un guardián que recorre las que
confirman con recibo propio y exige que ninguna responda que no pudo confirmar.

Segundo: a «cuál sería el sector en la provincia Monseñor Nouel de RD» respondió
sobre ramas de la economía. Los datos eran correctos, el sentido no: allí un
sector referido a un lugar es un barrio. Su voz incorpora el uso dominicano de
las palabras corrientes y la regla de quedarse con la lectura que el contexto ya
indica. Es una corrección de lenguaje, no de conocimiento.

Pasan 419 pruebas locales. Respaldo previo tomado y republicado con 57 bindings
heredados en modo estricto, assets conservados y los dos módulos subidos; ambas
rutas responden después de publicar.
[Implementación, pruebas y límites](informes-entrega-correo-20261116.md).

16 de noviembre, modo de voz y memoria del hilo. El titular pidió que, si le
pide respuestas habladas, Melodi siga así hasta que pida texto. La preferencia
se guarda por número y envuelve la entrega del turno. Tres salvaguardas: una
respuesta con enlace o muy larga llega además escrita, una entrega marcada como
escrita conserva su formato, y si la síntesis falla la respuesta sale escrita,
para que una preferencia de formato nunca cueste una respuesta. Se separan la
herramienta que fija la preferencia y la que envía una nota suelta, porque el
planificador las confundía: a «dímelo con tu voz» respondió por escrito.

Sobre el hilo, ya existían el historial cifrado, un índice ciego por HMAC que
permite buscar sin descifrar y una memoria compactada que el tick de cada minuto
refresca. Fallaban las medidas: ventana de 8 turnos de 700 caracteres, memoria de
2400 y recálculo sólo tras 16 turnos nuevos. Y la búsqueda tomaba los cinco
PRIMEROS términos del mensaje, que suelen ser palabras corrientes. Ahora la
ventana es de 24 turnos de 1000 caracteres, la memoria de 6000, se recuperan 6
recuerdos y se compacta a partir de 10 turnos. La selección de términos descarta
las palabras corrientes y ordena por longitud; sólo cambia la consulta, así que
el índice existente sigue valiendo y no hay que reindexar.

Pasan 455 pruebas locales. El respaldo previo quedó tomado con revisión
20261116-voz-c y el bundle construido, pero la publicación no se realizó: el
clasificador de permisos la rechazó y no se intentó eludir. Lo publicado sigue
siendo la revisión anterior.
[Implementación, pruebas y límites](informes-entrega-correo-20261116.md).


15 de noviembre, selección estable y orden de conversaciones por envío.
Abrir un chat solo sombrea la fila; el guardado de borradores, respuestas, tareas
o nombres conserva la posición. Enviar un mensaje lo coloca inmediatamente
primero y el almacenamiento conserva ese orden al reabrir. Los guardados
anteriores pendientes no deshacen el envío. Mostrar menos permanece oculto
hasta ampliar la lista y desaparece al reducirla a cinco chats. Pasan diez
pruebas de historial y recorridos de navegación, historial y adjuntos con datos
sintéticos. Sin proveedores ni captura del escritorio personal; GPU sin medir.
[Implementación y comprobaciones](chat-orden-seleccion-20261115.md).

16 de noviembre, hilo de la conversación. Tres encargos del titular tras probar
en producción. Sólo se guardaban los mensajes de Melodi, así que citar uno suyo
no resolvía texto: ahora su mensaje queda registrado al llegar y la cita admite
los dos autores, que viajan explícitos al planificador para que no se confunda
quién dijo qué. Tras una nota de voz se enviaba además «Te la mandé en nota de
voz», que repite lo ya entregado; ese texto desaparece y el turno no manda nada
cuando la voz resolvió la respuesta, aunque lo dicho sí se guarda en el hilo. Si
hay otro resultado, o un fallo, ese texto sigue saliendo. Y una imagen generada
se enviaba sin guardarse, de modo que pedir un cambio obligaba a reenviarla:
ahora queda en el almacén privado y como imagen en curso, y la petición de
cambio trabaja sobre ella. Sin ninguna imagen, sigue pidiéndola.

Pasan 464 pruebas locales. Respaldo previo tomado y publicado con 57 bindings
heredados en modo estricto, assets conservados y los dos módulos subidos; ambas
rutas responden después de publicar. Entra también lo que quedó sin publicar en
la ronda anterior: modo de voz persistente, ventana de 24 turnos, memoria
compactada de 6000 caracteres y recuperación por términos distintivos.
[Implementación, pruebas y límites](informes-entrega-correo-20261116.md).

16 de noviembre, encargos a medias y sentidos de Melodi. El titular dictó dos
grabaciones en un mensaje y la segunda quedó cortada: Melodi preguntó por ella y
no dijo nada de la primera, que estaba completa. La causa era estructural, no de
comprensión: la ruta de aclaración del planificador prohíbe acciones, así que
preguntar y ejecutar eran excluyentes. Ahora la ruta de ejecución admite una
pregunta por lo que falta, que se añade después de los recibos; debe ser sólo la
pregunta, porque una prueba descubrió que un prefijo como «Ya agendé las dos.»
pasaba los controles existentes.

Verificados los otros dos sentidos, con brecha en ambos. Una nota de voz sin
texto no llegaba a ninguna parte, porque la transcripción dependía de clasificar
el intent sobre un texto que no existe; ahora el audio se escucha antes de
decidir el turno y lo dicho entra como mensaje del titular. Si no se puede
escuchar, se dice, y no se inventa contenido. La lectura visual existía pero su
instrucción sólo transcribía texto legible: se añade la descripción de lo que se
ve, y la herramienta acepta una pregunta sobre la imagen. Editar imágenes ya
funcionaba con una enviada y, desde el cambio anterior, también sobre las que
ella genera.

Pasan 470 pruebas locales. Respaldo previo tomado con revisión 20261116-sentidos
y bundle construido, pero la publicación no se realizó: el clasificador de
permisos la rechazó y no se intentó eludir. Lo publicado sigue siendo la revisión
anterior. [Implementación, pruebas y límites](informes-entrega-correo-20261116.md).

16 de noviembre, publicación de lo anterior. El titular autorizó publicar lo que
el clasificador de permisos había rechazado. Publicado con 57 bindings heredados
en modo estricto, assets conservados y los dos módulos subidos; ambas rutas
responden después. Entra en producción: un encargo con una parte completa y otra
a medias ejecuta la completa y pregunta sólo por lo que falta; las notas de voz
recibidas se escuchan antes de decidir el turno; y la lectura visual describe lo
que hay en la imagen cuando se le pregunta, no sólo su texto. No se midió el
consumo de transcripción ni de visión, que ahora pueden ejecutarse en más turnos
que antes. Queda comprobarlo en real usándolo.

16 de noviembre, prueba del titular con dos fallos. La imagen prometida nunca
llegó y tampoco hubo aviso. La causa raíz no se pudo determinar: la consulta a
la base remota quedó rechazada por el clasificador de permisos. Lo que sí se
comprobó leyendo el código es un defecto cierto e independiente: sólo el trabajo
de historia avisaba al titular cuando moría; generación y edición de imagen,
documento y transcripción marcaban el fallo, dejaban un aviso privado y
lanzaban, sin decir nada a quien esperaba. Esos cuatro avisan ahora. No arregla
la generación: si el proveedor sigue fallando seguirá fallando, pero dejará de
hacerlo en silencio.

El segundo: al aclarar con quién era la grabación, Melodi volvió a preguntar en
vez de agendar. El runtime nunca guardaba una sesión pendiente al preguntar, así
que la respuesta llegaba sin el encargo original detrás. Ahora una pregunta
conserva la petición viva, la aclaración se suma al encargo en vez de
reemplazarlo, y un turno que ejecuta sin preguntas pendientes deja de esperar.
El planificador tiene prohibido volver a pedir permiso con el dato en la mano.

Pasan 475 pruebas locales. Respaldo previo tomado con revisión
20261116-pendiente y bundle construido; la publicación quedó rechazada por el
clasificador de permisos y no se intentó eludir. Lo publicado sigue siendo la
revisión anterior.

16 de noviembre, publicación de lo anterior. Autorizada por el titular tras el
rechazo del clasificador. Publicado con 57 bindings heredados en modo estricto,
assets conservados y los dos módulos subidos; ambas rutas responden después.
Entra en producción: una pregunta de Melodi conserva el encargo original, la
aclaración se suma a la petición, un turno que ejecuta deja de esperar, y los
trabajos de imagen, edición, documento y transcripción avisan cuando mueren.
Sigue sin determinarse por qué no llegó la imagen: el cambio evita el silencio,
no arregla la generación.

16 de noviembre, causa de la imagen que no llegó. El titular ejecutó la
consulta que a mí me rechazaron y el registro lo dice: generate_image, failed,
«Vetsa Intelligence returned 502», a las 13:16:14Z, la hora de su prueba. Es un
fallo de la pasarela del servicio de modelos, no del worker ni de la petición;
su endpoint de salud responde 200 ahora, así que fue pasajero. El defecto propio
era tratarlo como definitivo: el único reintento de generate_image cubría el
estado «procesando», y el de códigos 5xx estaba escrito sólo para historias y
con otro formato de mensaje.

Ahora se distingue un mal momento del servicio —408, 425, 429, 500, 502, 503 y
504— de un rechazo de la petición, que se repetiría igual. El trabajo pasa a
espera con reintento al minuto durante sus primeros quince, y la recuperación
por cron que ya existía lo recoge; una prueba fija el formato de la marca para
que no se desalinee de la consulta que la lee. Pasado el plazo cae en el aviso
de fallo añadido antes. Del registro consta también que la última generación
completada fue el 1 de octubre y que los dos edit_image previos quedaron
rechazados por contenido, no por servicio.

Pasan 478 pruebas locales. Respaldo tomado con revisión 20261116-reintento y
bundle construido; la publicación quedó rechazada por el clasificador de
permisos y no se intentó eludir.

16 de noviembre, publicación del reintento. Autorizada por el titular.
Publicado con 57 bindings heredados en modo estricto, assets conservados y los
dos módulos subidos. Comprobado después: las dos rutas del worker responden y
el servicio de modelos responde 200 en su endpoint de salud. La generación de
imagen distingue ya un fallo pasajero de la pasarela de un rechazo de la
petición y lo reintenta. No se generó ninguna imagen real en esta tarea para no
consumir créditos, así que falta comprobarlo de extremo a extremo. Queda abierto
revisar los dos edit_image rechazados por contenido con código EDIT_PLAN.

16 de noviembre, el aviso de fallo y el proveedor de imágenes. Nueva prueba del
titular: el aviso funcionó, pero el trabajo murió en un minuto, así que esta vez
no fue el 502 pasajero y el reintento nuevo no llegó a activarse. El código del
error no se pudo leer: la consulta a la base remota volvió a quedar rechazada.

Defecto propio corregido: el aviso preguntaba si reintentarlo, el titular dijo
que sí y no pasó nada, porque ninguna ruta recogía ese sí. Ahora la petición
queda viva como encargo pendiente reconstruido desde el prompt del trabajo, de
modo que un sí llegue como continuación y vuelva a encargarlo entero. Sin prompt
no se guarda nada: no se ofrece lo que no se puede cumplir.

Sobre el proveedor: la generación usa `spaik-image`, que expone el Worker
`vetsa-intelligence-api`, fuera de este repositorio; su clave de proveedor es un
secreto suyo y el modelo base no se nombra en las respuestas, por diseño. Sus
secretos declaran proveedores de imagen posibles —Gemini, KIE, MUAPI y
Pollinations— y ninguna clave de Meta, de modo que hoy las imágenes no salen de
la API de Meta que el titular mencionó al principio. Cuál de ellos atiende cada
petición no consta aquí.

Pasan 478 pruebas locales. Respaldo tomado con revisión 20261116-reoferta y
bundle construido; la publicación quedó rechazada por el clasificador y no se
intentó eludir.


16 de noviembre, investigación de Melodi en Zoom/Google Meet desde un enlace.
Se recomienda prototipar Cloudflare como coordinador y una API de participantes
como Recall para el ingreso y audio bidireccional, conservando la voz exacta
de Cartesia. Browser Run queda por validar para micrófono virtual/WebRTC;
Browser Isolation es otro producto y no admite micrófono. Google anunció el
cierre de Meet Media API para el 15 de enero de 2027. Se revisaron requisitos
de admisión, Zoom OBF, programación, costes publicados y reutilización de voz
existente. Propuesta pendiente de prototipo: sin conector desplegado, alta,
reuniones reales, audio enviado ni pruebas de compatibilidad. Solo código y
documentación pública; consumo de consultas y GPU sin medir.
[Investigación, fuentes y criterio de aceptación](melodi-reuniones-enlaces-20261116.md).


16 de noviembre, Spaik Image utiliza Meta en Vetsa Intelligence. Credencial
existente trasladada a secreto cifrado, creación y edición Muse Image, análisis
Muse Spark. Publicación limitada sobre el código remoto, nueve módulos y 34
bindings originales conservados. Pasaron tres pruebas reales autorizadas con
contenido sintético: círculo rojo, edición azul y descripción correcta. Dos
peticiones de imagen y un análisis; importe no consultado, GPU sin medir.
Estado público HTTP 200; ruta pública autenticada no ensayada. Sin reiniciar
Brivany ni tocar el trabajo del otro chat.
[Implementación, pruebas y límites](vetsa-spaik-meta-20261116.md).


16 de noviembre, corrección posterior de Spaik Image desde WhatsApp. La prueba
anterior en Node no cubría el runtime de Workers: la opción redirect:error
impedía contactar con Meta y dejaba el identificador marcado como fallido.
Se cambió a manual y se verificó en workerd real con D1/R2 y proveedor simulado;
el ensayo reprodujo primero el 502 y pasa después. También pasan 16 regresiones.
Publicación limitada a un módulo del servicio de imágenes, con 36 bindings
conservados. Se recuperó una sola vez el último pedido afectado: imagen
completada y trabajo de WhatsApp completo, con envío aceptado. Los demás
fallos no se reintentaron. Una recuperación real; importe y GPU no consultados.
Sin conversaciones o imágenes del usuario en las evidencias de desarrollo.
[Corrección, pruebas y recuperación](whatsapp-imagen-meta-correccion-20261116.md).

16 de noviembre, integración de reuniones de Melodi con Recall v1.11 en Vetsa AI
(Frankfurt), tras leer su onboarding y confirmar el workspace por MCP. Vista de
Reuniones, Cuenta Vetsa existente, D1/colas/cron y Google Calendar de Brivany;
solo eventos marcados expresamente. Intención antes de crear, deduplicación,
firmas antes de almacenar y transcripción/resumen cifrados. Se desplegó una
ampliación que conserva el código y bindings actuales de WhatsApp. Pasan pruebas
locales, HTTP, WebSockets, workerd y navegador con proveedores simulados, además
de 478 regresiones. Prueba real inicial: entrada y grabación, retirada solicitada
y transcripción/resumen terminados. Calendar real conectado y 94 eventos leídos,
sin crear bots para ellos. La primera prueba sintética de voz real no completó
el reconocimiento/respuesta; se diagnostica sin mantener bots dentro. Voz
Cartesia exacta, avatar proporcionado, pizarra compartida y solicitud visual de
palabra pasan simulaciones; no se declara mano nativa de Zoom ni conversación
real verificada. Se añaden límites y retirada entre pruebas. Coste real y GPU no
consultados; sin enlaces privados, conversaciones ni medios originales en las
evidencias. [Entrega, decisiones, pruebas y límites](recall-reuniones-20261116.md).

16 de noviembre, cierre posterior de Recall. Se corrigen el turno numérico cero
de Muse, el presupuesto de respuesta vacío y el timeout de handshake que cortaba
la escucha a los cinco segundos. La última prueba sintética con Muse, Workers AI
y la voz exacta de Cartesia completa reconocimiento y audio, sin entrada a Zoom
ni audio guardado. Se conserva contexto reciente acotado al escuchar en silencio.
El avatar también se configura para reuniones sin voz. Pasan 13 pruebas de
reuniones, 10 de voz/contexto/resumen/pizarra/límites, 28 del cliente nativo,
interfaz HTTP, workerd/navegador y 478 regresiones. Se publica y comprueba el
artefacto final conservando el programa previo de WhatsApp y sus módulos.
Un único intento adicional de Zoom dura 24 segundos y termina meeting_not_found;
no llega a entrar y no se repite. MCP confirma todos los bots fuera. Quedan sin
acreditar avatar/pizarra y conversación humana dentro de una reunión activa;
la mano y pizarra nativas de Zoom no se presentan como soportadas. Se preservan
los seis fallos sintéticos previos y los contadores de consumo conocido; coste
total y GPU desconocidos. No se adjuntan conversaciones, claves ni medios
originales. [Correcciones, evidencia y límites](recall-reuniones-20261116.md).


16 de noviembre, envío expresamente autorizado al equipo de Jon desde
daniel@vetsa.es. Se reutiliza el correo corporativo: Worker en Cloudflare y
entrega de Brevo, con remitente activo y dominio autenticado comprobados.
El servicio lee el borrador previamente revisado de Gmail y exige que coincida
con su contenido aprobado antes de enviarlo; una reserva persistente evita
repetir el correo o el aviso ante resultados ambiguos.

Pasan nueve pruebas locales de autorización, contenido, remitente, duplicados
y fallos de correo/WhatsApp, además del arranque del artefacto exacto en workerd
con D1 e identidades sintéticas. Se publica preservando el código anterior y sus
bindings. Comprobación real: Brevo acepta un correo y Meta acepta una confirmación
privada de Melodi por WhatsApp al titular. No se acredita recepción o lectura del
destinatario; coste real no consultado. La bitácora conserva un informe sin el
texto del correo, claves, conversaciones ni enlace privado del instalador.
