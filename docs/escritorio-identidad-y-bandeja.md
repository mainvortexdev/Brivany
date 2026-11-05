# Brivany: escritorio, identidad y bandeja

31 de octubre de 2026, hora de La Paz. La interfaz vigente es la aplicación de
escritorio. La web de presentación se desarrollará en otro hito. Las páginas
públicas de privacidad y condiciones y los retornos OAuth se conservan porque
forman parte de las conexiones ya configuradas.

## Cambios implementados

- Conexiones conserva las cuentas y sus permisos. Se retiran de su interfaz el
  formulario técnico de Google, las operaciones manuales, las solicitudes del
  chat de WhatsApp, los borradores sociales, los recordatorios y el pie antiguo.
  No se borran las autorizaciones ni los motores de esos servicios.
- Se retiran el contador y el panel permanente de agentes. Los trabajos en
  segundo plano conservan el aviso temporal de finalización y «Ver resultado»,
  así como su revisión y autorización. El primer ensayo encontró botones
  superpuestos en ese aviso; se corrigió su distribución y se repitió la suite.
- Windows incorpora un icono residente en el área de notificaciones, con «Abrir
  Brivany», «Melodi WorkSpace» y «Salir de Brivany». Cerrar la ventana principal
  mantiene la aplicación en segundo plano cuando la bandeja está disponible;
  salir desde su menú libera las ventanas y el icono. Esto no instala un servicio
  de Windows ni configura inicio automático con el sistema.
- La identidad elegida por el usuario es `brivany.` con punto azul `#0071e3` y,
  como icono reducido, la `b` con punto azul de los recursos originales. Se genera
  el ICO nativo a partir de ese recurso, sin sustituirlo por el emblema verde.
- La decisión tipográfica final sustituye la petición intermedia de Georgia en
  todo: Georgia en títulos principales y Segoe UI en texto y controles. Se aplica
  al escritorio, sus módulos y las páginas legales públicas. Código y atajos
  conservan una fuente monoespaciada.
- El arranque de escritorio crea una sesión privada del renderizador. Las
  antiguas rutas locales de portada, chat, Conexiones y módulos no presentan una
  edición de navegador: responden HTTP 410 sin la sesión del host nativo. El host
  recibe su cookie HttpOnly y redirige a una URL limpia. Se ajustan también las
  ventanas auxiliares de WorkSpace, captura y Spotify. Los recursos compartidos
  se conservan porque forman parte de la aplicación de escritorio. Esta medida
  retira la interfaz de navegador; no se presenta como un rediseño de seguridad
  de todas las APIs locales.
- El retorno Google ya no invita a abrir Conexiones en el navegador. Indica
  cerrar la pestaña y volver a Brivany. Las dos pestañas locales de prueba se
  cerraron; las de Google Cloud se conservaron.

La actualización tipográfica pública se publicó en `brivany.example`, versión
Cloudflare `3084cb10-6342-48ac-a6dd-4c4fbd47cf77`. No se creó la futura web de
presentación ni se retiraron los enlaces legales necesarios para Google.

## Pruebas y límites

Las suites `connections`, `computer-images-agents-ui`, `island-ui`, `tray`,
`desktop`, `work`, `desktop-ui-session`, `connections-http` y `spotify` pasaron
después de los cambios correspondientes. Los ensayos UI usan proveedores,
audio y puentes sustituidos; comprueban navegación, revisión de resultados,
tipografía y geometría en varios tamaños, sin acreditar audio físico ni control
completo de cuentas reales.

La comprobación nativa aislada de bandeja usa WinForms/NotifyIcon y WebView2
reales, con una ventana propia. Verifica apertura, paso a WorkSpace, salida y
liberación de recursos. La comprobación aislada de sesión usa WebView2 real con
páginas sintéticas: ventana principal, iframe del módulo, ventana auxiliar,
URLs limpias y rechazo de clientes ordinarios. Ambas pruebas carecen de cuentas,
modelos, captura de pantalla y audio; no llaman a proveedores externos.

Tras reiniciar la aplicación real se verificó, mediante metadatos de sus propias
ventanas y API local de solo lectura:

- modo `desktop-only`, bandeja activa y WorkSpace activo;
- barra visible de 1280 × 40 px y reserva superior de 40 px; panel inicialmente
  oculto y ventanas WorkSpace excluidas de la barra de tareas;
- seis rutas locales de interfaz devuelven 410 a clientes sin sesión;
- Calendar, Gmail y Drive conservan sus tres autorizaciones reales.

La inspección de accesibilidad de la ventana real anterior confirmó la interfaz
simplificada. La herramienta de captura nativa no pudo obtener una imagen y la
entrada por coordenadas no estuvo disponible; no se atribuye a esa herramienta
una comprobación visual nativa que no realizó. Los informes geométricos tampoco
demuestran por sí solos calidad visual. No se ha probado esta bandeja en macOS o
Linux ni se declara su implementación equivalente en esos sistemas.

El informe preliminar `tmp/ui-cleanup/ui-final.json` etiquetó erróneamente las
cuatro tarjetas de cuenta como cuatro cuentas Google: incluía WhatsApp. Se
conserva ese informe y se corrige aquí con la lectura final específica de los
tres conectores Google, sin guardar identificadores de cuenta o contenido.

Antes del último reinicio se hizo una consulta real de reproducción de Spotify
para evitar interrumpir una escucha activa: no había reproducción activa. El
tráfico externo de fondo de la app y del navegador no se midió; no se declara
consumo global cero. Las consultas finales de estado son locales y no vuelven a
leer mensajes, archivos ni eventos de Google. No se cambiaron permisos ni se
ejecutaron escrituras o envíos.

Evidencia principal:

- `tmp/connections/report.json`
- `docs/verification-history/computer-images-agents-ui-20261101T022704-8d49f379.json`
- `docs/verification-history/desktop-20261101T024845-e9922720.json`
- `docs/verification-history/desktop-ui-session-20261101T024401-66c5970e.json`
- `tmp/tray-native/report.json`
- `tmp/native-ui-session/report.json`
- `tmp/ui-cleanup/desktop-only-final.json`
- `tmp/ui-cleanup/desktop-only-windows.json`

El objetivo general de control del ordenador continúa pausado por indicación del
usuario; este hito no lo declara terminado ni reanuda la arquitectura de extensión
de navegador y Office.
