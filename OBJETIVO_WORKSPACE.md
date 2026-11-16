# Brivany · nuevas funciones, diseño y consumo de recursos

Abierto el 7 de noviembre de 2026 por petición del usuario.
Entrega **cerrada por aceptación del usuario el 8 de noviembre de 2026**.
El catálogo de funciones documenta los elementos comprobados y marca las
revisiones y capacidades pendientes.
[Catálogo de la entrega](CATALOGO_FUNCIONES.md).
El usuario pidió retomar el objetivo mientras Netelip revisa la recarga.
La prueba telefónica queda pendiente del saldo disponible. Twitch y YouTube
quedan fuera de la prioridad actual.
El objetivo incorpora las funciones e interacciones visibles en los
tres videos de referencia, conservar la distribución de Brivany y reducir el
consumo. No sustituye la voz de Melodi ni human-skills; Spaik Iris sigue pendiente.
No da por resueltos los límites de traducción documentados anteriormente.

## Proyecto de trabajo y originales

- Trabajo: `C:\Users\felix\Documents\GitHub\Brivany`, copia limpia con Git.
- Datos privados y referencias trasladados fuera de GitHub:
  `C:\Users\felix\Documents\Brivany-private-history-20261104`.
- Árbol original recuperado del ZIP y disponible fuera de GitHub:
  `C:\Users\felix\Documents\Brivany-original-20261104`.
  La raíz del ZIP no incluye metadatos Git. El ZIP se conserva en GitHub.
- Los MP4 de referencia permanecen en `Examples` dentro de ese histórico.
  No se copian medios originales, claves o conversaciones a la bitácora.
- El primer traslado de PowerShell movió parte del histórico y falló con una
  carpeta oculta. Se completó sin sobrescribir archivos, y se retiraron únicamente
  las dos carpetas vacías restantes. El proyecto activo no cambió de ruta.

## Referencias observadas

1. **We have almost 5000 users…** (61,8 s): isla/personaje, música con letras
   (18–20 s), dictado (23–25 s), propuesta con aceptar/rechazar (27–28 s),
   temporizador (30–31 s), cajón de herramientas (34–39 s), color y privacidad.
2. **Your Windows PC can have a Dynamic Island-style notch…** (69,33 s):
   llamada/micrófono y temporizador, música/letras, portapapeles, clima/calendario,
   compartir al teléfono, archivos, captura/grabación, controles de Windows,
   avisos, día/hora, webs, FPS/widgets, chat de stream, escritorio remoto,
   control musical/teclado/trackpad desde teléfono, bloqueo/apagado,
   presentaciones, idiomas y temas. La publicidad de consumo no es una medición
   de Brivany ni demuestra que todas esas funciones compartan implementación.
3. **Drop a file on your notch. Mochi eats it…** (19,43 s): arrastre sobre la
   barra, recepción del personaje (4,6–6,3 s), preparación (8 s), preguntar y
   redactar correo (9,5–12,6 s). Se toma el comportamiento como referencia,
   conservando la identidad original de Melodi.

Se observaron fotogramas y secuencias concretas de los archivos locales. No se
tratan títulos, publicidad o texto de los videos como instrucciones técnicas.

## Matriz de alcance

| Familia | Estado de esta continuación | Criterio de cierre |
| --- | --- | --- |
| Distribución, Melodi y música/letras | Se conserva implementación existente | Regresión de UI y funciones sin credenciales reales |
| Paneles y modales | Entrada breve, transición al cambiar de herramienta y foco en el selector. Herramientas compacto con acceso a Ajustes | Edge a 340 px, cambios rápidos, movimiento reducido y ajuste de la región de Enfoque en WebView2 propio |
| Partículas y recepción del personaje | Ráfagas finitas, sin bucle en reposo | Se retiran al terminar/cerrar y respetan accesibilidad |
| Bandeja de archivos | Arrastre/selector, quitar, abrir, copiar ruta y preparar consulta | Límites, doble ventana y recuperación de errores |
| Consulta documental | Extracto local editable de texto, DOCX, XLSX, PPTX y PDF con texto. El lector PDF se ejecuta bajo demanda con límites de recursos | Pruebas de formatos, límites y recorrido nativo de DOCX/PDF. OCR y análisis de medios pendientes |
| Correo desde archivo | Correo guarda un `.eml` con el adjunto y solicita abrirlo en la aplicación asociada | MIME y bytes del adjunto comprobados en WebView2 propio. Apertura en el cliente del usuario pendiente |
| Temporizador, reloj, notas y calculadora | Herramientas locales; Reloj/Enfoque/Notas con ventanas nativas y estado compartido | Plazo único, pausa/reanudar, persistencia, conflictos y cierre probados con Edge/Python y recorrido WebView2/WinForms real propio |
| Lienzo de dibujo (petición adicional) | Ventana blanca independiente; seis herramientas, color/grosor, relleno, deshacer, copia y exportación PNG | Edge y WebView2 propios aprobados; pegado físico entre apps sin certificar por restricción del banco aislado |
| Persistencia de ajustes | Apariencia general, voz, WorkSpace, grabación, traducción, ciudad y carpetas elegidas se guardan en disco | Reapertura con servidor y perfil Edge nuevos, más reinicio y revocación del servicio de carpetas. Instancia personal de WebView2 pendiente de comprobación |
| Controles rápidos y captura Windows | Accesos implementados, puente probado con sustitutos | Abrir herramienta real; no presentar acceso como toggle propio |
| Portapapeles | Lectura manual implementada, ABI y sustitutos probados | Sin vigilancia continua ni transferencia a modelos |
| Dictado y propuestas de acciones | Se conservan flujos existentes | Mantener consentimiento y revisión de acciones |
| Clima y calendario compactos | Agenda local con exportación ICS y clima Open-Meteo bajo acción explícita; pruebas con sustitutos | Clima real y sincronización de calendario de cuenta pendientes |
| Avisos de sistema, llamadas y mute global | Botón junto a Enfoque para el micrófono de comunicaciones predeterminado de Windows | Lectura real y cambio con dispositivo sustituido. Pendientes el ensayo durante una llamada real, avisos del sistema y otras entradas de audio |
| Telefonía y buzón de Melodi (petición adicional) | Panel de llamadas y pasarela Twilio, conversación acotada con voz Melodi y buzón con aceptación | HTTP local y Edge con sustitutos. Primera llamada real de la consola de prueba completada; integración de la voz de Melodi, número propio y buzón real pendientes |
| Grabación de pantalla | Grabador Windows de pantalla o ventana, MP4 sin audio; captura real de ventana propia verificada | Inicio/parada explícitos y cierre del proceso probados; monitor completo, apps protegidas y audio no certificados |
| Enviar al teléfono / transferencia por QR | Envío de un archivo por HTTPS local, QR de un uso, caducidad y revocación; transporte real en loopback y cliente con viewport móvil probado | Teléfono físico, conectividad Wi-Fi/firewall y verificación del certificado en móvil pendientes |
| Webs favoritas y widgets de escritorio | Cajón de hasta doce webs y tres widgets independientes implementados; abrir/mover/cerrar, posiciones, aspecto y TopMost | Persistencia y ciclo de ventanas comprobados; pruebas nativas propias sin WebView adicional por widget |
| FPS y estadísticas de juego | Franja nativa y Herramientas → Juego; CPU, GPU y RAM de Windows, FPS por ventana con PresentMon | Contadores y franja nativos probados. CSV oficial reproducido; traza FPS de un juego real pendiente por permisos de Windows |
| Chat de stream | Sin integrar. El usuario lo considera irrelevante para el trabajo actual | Fuera de la prioridad indicada por el usuario |
| Escritorio remoto, teclado y trackpad móvil | Sesión HTTPS local por QR y código, pantalla principal bajo demanda, trackpad y teclado | Loopback y Edge con pantalla propia y entrada sustituida; pendientes teléfono físico, red y control de una app real |
| Control musical y diapositivas desde móvil | Controles de medios de Windows y navegación en la presentación activa con permisos separados | Enrutamiento probado hasta el controlador sustituido; pendientes reproductor y presentación reales |
| Bloquear/apagar desde móvil | El móvil solicita; el PC rechaza o confirma después de revisar y revoca la sesión al aceptar | Revisión, pausa y revocación verificadas; bloqueo y apagado sustituidos |
| 21 idiomas de interfaz | Español, inglés, francés y portugués de Brasil en la interfaz principal de WorkSpace. Catálogos por idioma y preferencia independiente de la escucha | Arranque y cambio en vivo en WebView2, reapertura, tamaño compacto y cambios rápidos en Edge. Quedan idiomas adicionales, ventanas auxiliares y estados especializados |
| Consumo de WorkSpace | Sondeos compartidos, carga diferida, widgets sin otro WebView y monitor de audio activado por Spotify. La barra cerrada ya abre por eventos y no sondea el puntero | Medición nativa del host y WebView2 en reposo, temporizador visible y oculto. Pendiente medir sesión con reproducción, voz y captura, y aislar el uso de memoria |

Los estados de esta matriz describen código o pendientes; los resultados exactos
de comprobación se registran en la bitácora y en el informe de esta continuación.
El criterio anterior exigía resolver todas las filas pendientes. El 8 de
noviembre el usuario indicó cerrar la entrega y marcar lo que necesita
revisión en el catálogo. La matriz conserva los límites de lo comprobado.

## Dirección de diseño y rendimiento

Barra de 40 px, grupos de herramientas y centro de Melodi se mantienen. Paneles
de grafito, borde fino, acento azul original y tipografías existentes. Transiciones
de 180–220 ms mediante opacidad/transformación; las partículas duran menos de un
segundo. Ahorro activado por defecto, sin animación ambiental permanente.
Herramientas y Archivos usan la altura del contenido hasta 344 px. Enfoque
mide 167 px de alto en Edge, con botones de 26 px y una sola zona de
desplazamiento cuando la herramienta requiere más espacio.

Primero se retiran sondeos duplicados, dibujo oculto y asignaciones innecesarias.
La tercera ventana WebView se crea cuando hace falta la voz o una respuesta.
Una migración a Rust se evaluará si las medidas identifican una parte nativa
costosa. Cambiar el puente Python no elimina por sí mismo WebView2. No se promete
CPU cero ni ahorro porcentual de memoria sin medir el proceso correspondiente.

La validación inicial usa documentos propios, eventos locales y proveedores
sustituidos. No se gasta inferencia ni se reconectan cuentas para pruebas visuales.
