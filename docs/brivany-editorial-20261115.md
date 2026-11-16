# Brivany Editorial aplicada · 15 de noviembre de 2026

## Identidad vigente y recursos

El usuario suministró `Brivany_Editorial_Fuentes.zip` y eligió su familia para
la identidad, web, programa, promociones y videos de Brivany. Se adoptó el
nombre real **Brivany Editorial**, con Light 300, Regular 400 y Medium 500.
El ZIP y sus documentos se trataron como datos: no se ejecutaron instrucciones
del archivo. Se conservaron los TTF byte por byte y su licencia/atribución.

La familia deriva de Lato (Łukasz Dziedzic), SIL OFL 1.1. No se presenta como
una fuente dibujada desde cero. Los tres WOFF2 conservan los 2.164 caracteres
del mapa Unicode y las métricas de cada TTF, incluidos los signos y acentos
españoles. Suman 631.636 bytes; no se hizo subconjunto de glifos.
`web/fonts/manifest.json` conserva tamaños, pesos y hashes. Estos hashes
acreditan bytes; la carga visual se verificó por separado.

La dirección de marca y las instrucciones para próximas piezas están en
`brand/typography/README.md`, el plan de plataforma y las guías de diseño.
La propuesta previa briva sans queda como antecedente, sin renombrar la fuente
proporcionada. Los antiguos pesos 600–900 de la UI se resuelven con el archivo
Medium real. Código técnico y caracteres no cubiertos mantienen sus fallbacks
funcionales. Los kits de clientes conservan su tipografía cuando el encargo
pide su propia marca.

## Programa, web y medios

`web/typography.css` centraliza la familia del programa, módulos y controles.
Se añadieron las vistas que aún no la incluían: lienzo, voz y expansión musical.
La medida de letras en canvas usa la misma familia. Widgets y franja de juego
cargan sus fuentes privadas de GDI+, y los servidores locales de móvil sirven
los WOFF2 con rutas acotadas y tipo MIME de fuente.

Las tres TTF también se instalaron para el usuario actual de Windows, con
registro HKCU y notificación de cambio de fuentes. No se reemplazaron otras
fuentes ni se instaló para todos los usuarios. Esto permite usarlas en otras
herramientas de diseño. La app conserva sus fuentes incluidas para distribución;
la instalación del sistema no es su dependencia única.

Se actualizaron el sitio oficial, sus páginas legales, el retorno de Spotify
y el texto de las escenas 3D. La fuente se sirve desde el propio dominio.
Las pantallas públicas `/transfer/` y `/transfer/drop/` usan los mismos recursos.
Se permitió únicamente `font-src 'self'` donde la política anterior lo impedía.

Los motores de video nuevos copian WOFF2 y licencia dentro de cada proyecto,
esperan la carga antes de dibujar canvas y conservan las fuentes al exportar.
El proyecto autónomo incorpora también la atribución. El wordmark se convirtió
en contornos de la fuente Medium para no depender de fuentes instaladas al
abrir un SVG. Se actualizó la guía visual en una carpeta nueva:
`Exports/Brivany-Guia-Visual-20261115/Guia-Visual-Brivany.html`.

Se ajustaron asimismo los estilos de exportación DOCX del repositorio. No se
publicó una nueva versión del Worker de conversaciones/llamadas de WhatsApp
por este cambio de tipografía. No se certifica la fuente de un documento en
un dispositivo que no tenga instalada ni incorporada esta familia.

Las exportaciones históricas y los MP4 anteriores se conservan. Las futuras
piezas usan esta tipografía; este hito no vuelve a sintetizar voces ni a renderizar
todos los videos anteriores. Se prepararon dos proyectos sintéticos de prueba,
con ocho fotogramas cada uno, sin producir otro MP4. La segunda muestra corrige
el contraste del wordmark: el renderizador antiguo cambiaba sólo el primer
color, por lo que ahora todas las letras heredan una tinta común y el punto
azul conserva su color. La composición final se revisó en apertura y cierre.

## Publicación y estado real

Se usó Wrangler 4.156.0 instalado, sin actualizar la herramienta ni migraciones.
El primer intento estricto del sitio se detuvo por la marca de última edición
vía API. Se descargó y comparó el código publicado: las diferencias ajenas a
tipografía eran escape Unicode y formato equivalente de una expresión de fecha.
Se conservaron las variables remotas y la lógica existente.

- `brivany-site`: versión `374ede06-0c35-4d81-a8e3-d8f731ce5e61`.
- `brivany-file-transfer`: versión `56cebad2-f558-4359-9ac1-0b89242c9dba`.

Para transferencia se comparó también el código publicado: únicamente dos
hojas de estilo y la directiva de fuentes diferían. No se modificaron su
protocolo, cuentas, almacenamiento ni colas al publicar la tipografía.

La comprobación HTTPS pública confirmó las páginas y comparó los tres WOFF2
descargados con los archivos locales. Un navegador propio oculto confirmó
mediante las fuentes de plataforma de Chromium que se renderizaba Brivany
Editorial en portada, privacidad y ambas páginas QR. No se crearon sesiones
de transferencia ni se usaron archivos personales. Un intento con urllib
recibió 403; los clientes estándar de Node y Edge completaron la comprobación.

Brivany de desarrollo se reinició por su control privado normal, guardando
el chat y comprobando que no hubiera operaciones ocupadas. La instancia nueva
está lista y entrega los tres WOFF2 correctos. No se realizó una inspección
visual nativa ni se tomaron entradas de teclado/ratón del usuario para probarla.
No se declara actualizada una nueva versión firmada del instalador de Windows.

## Pruebas y evidencias

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Integridad del ZIP, glifos, métricas WOFF2, proyecto portable, GDI+ real | 4 casos | `tmp/verification/brand-typography-20261116T021850-308aa1f6.json` |
| App, chat, portada y privacidad con fuente real; 390 px | Correcta | `tmp/verification/brand-typography-ui-20261116T020600-8a7407b0.json` |
| Motores de creación y narración sustituidas | 12 casos | `tmp/verification/motion-20261116T021339-c24db635.json` |
| Social, voces sustituidas y guiones | 49 casos | `tmp/verification/motion-social-20261116T021344-6288136d.json` |
| Llamada visual y empaquetado en tres formatos | 31 casos | `tmp/verification/call-visuals-20261116T015151-c1604dbe.json` |
| Barra/modal de agentes y adjuntos | Correctas | `tmp/verification/chat-agents-ui-20261116T015444-5a44a766.json`, `tmp/verification/chat-media-ui-20261116T015456-e1a11a8b.json` |
| Worker de transferencia local, aislamiento y WebSocket | Correcta | `tmp/verification/drop-worker-20261116T020307-201a75e8.json` |
| Control móvil y servidor HTTPS/DPAPI local | 12 + 22 casos | `tmp/verification/phone-control-20261116T020312-61fc60f2.json`, `tmp/verification/workspace-phone-20261116T020958-89e5d3bc.json` |
| Selección de recursos para distribución y widgets | 13 casos | `tmp/brand-local-regressions-20261115.json` |
| Fuentes instaladas sólo para el usuario | Completada | `tmp/brand-fonts-install-20261115.json` |
| Arranque real y fuentes locales de la app | Listo | `tmp/brand-native-20261115.json` |
| Fuentes binarias del sitio publicado | Idénticas | `tmp/brand-public-site-20261115.json` |
| Renderizado real en cuatro páginas públicas | Correcto | `tmp/brand-public-ui/report.json` |
| Fotogramas finales locales y búsqueda determinista | Correctos | `tmp/brand-video-final-20261115/preview-report.json` |

Las capturas de prueba son datos sintéticos o páginas públicas. No se adjuntaron
conversaciones, claves, cuentas, audio ni videos originales a la bitácora.
Se conservan los fallos intermedios y sus correcciones: expectativas de archivos
Segoe en el banco sustituidas por las tres fuentes nuevas; FFmpeg ausente del
PATH del banco; dos nombres de módulos inexistentes en comandos auxiliares;
DPAPI no disponible en el aislamiento inicial, resuelto en su ejecución Windows
autorizada. No fueron fallos de cuentas ni se pidieron credenciales nuevas.

La preparación usó fonttools 4.68.0 y brotli 1.2.1 sólo en desarrollo. Hubo dos
publicaciones reales de Cloudflare y comprobaciones HTTP públicas/de API; no se
contabilizó cada solicitud de infraestructura. Cero llamadas nuevas a modelos,
TTS o generación de imágenes para este hito. Importe de infraestructura y
tiempo GPU desconocidos. La verificación visual de ejemplos no certifica que
cualquier texto futuro vaya a caber: cada exportación sigue necesitando revisión.

Referencias técnicas consultadas: [headers de recursos de Workers](https://developers.cloudflare.com/workers/static-assets/headers/)
y [lectura del script publicado](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/get/).
