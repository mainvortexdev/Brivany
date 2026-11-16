# WorkSpace · funciones, movimiento y recursos

7 de noviembre de 2026. Primera implementación del
[objetivo activo](../OBJETIVO_WORKSPACE.md). Se conserva la distribución de
herramientas, la voz de Melodi y las funciones existentes. No se da por
implementado todo lo anunciado en los videos de referencia.

## Cambios

Se trasladó el histórico original a
`C:\Users\felix\Documents\Brivany-private-history-20261104`. La copia con Git
permanece en `C:\Users\felix\Documents\GitHub\Brivany`. El primer movimiento
de PowerShell se completó parcialmente por una carpeta oculta; el segundo
movió las carpetas restantes sin sobrescribir y retiró solo carpetas vacías.
Los quince archivos de Examples permanecen fuera del proyecto activo.

WorkSpace incorpora Archivos y Herramientas en el grupo derecho de la barra;
las herramientas anteriores y el centro de Melodi conservan sus posiciones.
Los paneles usan grafito, un borde fino y entradas de 180–220 ms. Las partículas
son efímeras: hasta doce nodos, seis en ahorro, y se retiran al terminar/cerrar.
No se ejecuta un sistema de partículas continuo. Se respetan las preferencias
de movimiento reducido; el diálogo principal mantiene su gestión nativa del
foco, Escape y cierre por fondo.

La bandeja recibe documentos por arrastre/selector, permite abrir, copiar la
ruta y preparar una pregunta editable. Un extracto de texto no se presenta como
análisis de PDF, Office o medios. El correo abre un borrador: hay que adjuntar
el archivo manualmente, y no se envía. Límites, confianza y limpieza:
[bandeja de archivos](workspace-bandeja-archivos-20261107.md).

Herramientas añade temporizador con pausa/reanudación y deadline persistido,
reloj, notas de hasta 4.000 caracteres, calculadora sin eval y apariencia con
tema, cuatro acentos, tres tamaños, movimiento y ahorro. Sistema abre los
ajustes de sonido/pantalla/red/Bluetooth/avisos/micrófono y el capturador de
Windows; no muestra un acceso como si hubiera cambiado el ajuste. Copias lee
el portapapeles solo por acción explícita y conserva hasta diez textos en
memoria; no lo vigila ni lo transfiere a proveedores. El diagnóstico puntual
etiqueta CPU acumulada/RSS del anfitrión Python y excluye WebView2.

## Recursos

La barra comparte instantáneas con el panel. Se retiran sondeos duplicados,
actualizaciones sin cambios y RAF de voz mientras no hay contenido visible.
Las ventanas ocultas descansan y el cierre cancela las tareas. Las preferencias
se aplican también a la vista de voz creada posteriormente.

La tercera WebView de voz se crea al primer uso, conservando un host ligero
para el anclaje. Se prueba la cancelación de creación y de enlace concurrentes
con el cierre. No se bloquea la interfaz durante operaciones nativas para
proteger esa carrera: se revalida época, host y sesión y se evita mostrar una
respuesta si WorkSpace ya está inactivo.

Electron y los modelos de audio ya no se precalientan al abrir Desktop. La
primera acción que los necesita puede tardar más. El hash del ONNX se calcula
por streaming, manteniendo su tamaño y SHA-256. El monitor COM de audio solo
enumera sesiones mientras la instantánea SDK indica música local reproduciéndose;
se libera en el mismo hilo al pausar. Véanse
[arranque y límites](workspace-arranque-recursos-20261107.md).

En dos páginas Edge locales con puentes sustituidos se midió:

| Escenario, ventana de unos 8,5 s | Antes | Después |
| --- | ---: | ---: |
| Llamadas en reposo | 101 | 59 |
| RAF en reposo | 676 | 0 |
| Llamadas con música/trabajo | 113 | 71 |
| RAF con música/trabajo | 683 | 0 |
| CPU de procesos del navegador, reposo | 0,779 s | 0,224 s |
| CPU de procesos del navegador, activo | 1,453 s | 0,531 s |

Son muestras cortas secuenciales, sin carga del equipo controlada. La diferencia
CPU incluye el breve recolector inicial de memoria y no es un porcentaje
garantizado ni una medición integral de Desktop. Las sumas de working sets de
ocho procesos fueron 472,4→464,1 MB en reposo y 543,9→536,0 MB activo; pueden
contar páginas compartidas varias veces. No representan memoria privada ni pico.
Una lectura CIM anterior falló y produjo cero aparente: está invalidada por el
informe de corrección, no se usa como consumo real.

La fixture de hash de 8 MiB mantuvo el SHA y redujo el pico de asignaciones
Python de 8,40 MB a 0,27 MB. No es una medida de la RAM total de Brivany.
No se migra a Rust en este hito: los costes encontrados son procesos/modelos
anticipados y actividad repetida, resueltos sobre la arquitectura existente.

## Comprobaciones y fallos conservados

Pasaron 44 casos de WorkSpace, 13 de archivos, cinco de widgets, ocho de
controles, trece de reducción de música, dos de arranque y diez dirigidos de
timbre. Pasaron los recorridos Edge de archivos, widgets, chat, traducción,
preferencias de voz y diseño integrado; los nombres exactos e informes se
recogen en `tmp/verification/workspace-milestone-20261107.json`.

La integración usa HTML/CSS/JS reales y puentes nativos sustituidos. Comprueba
temporizador real de un segundo, borrador sin envío, limpieza de partículas,
geometría a 340 px y movimiento reducido. Se revisaron doce capturas locales
de las seis pestañas a 1366 y 340 px. Se corrigieron un doble desplazamiento en
Sistema, el tamaño que solo cambiaba en la apertura siguiente y un recorte de
controles de música causado por ampliar la cabecera común.

Se conservan los fallos anteriores: preparación temporal de una prueba de
carga de módulos, caché de traducción antigua al reabrir, expectativas del
toolbar anterior, plazo del sondeo de música, y comprobación de movimiento
reducido antes de recibir su evento. Las correcciones añaden nuevos informes;
no reescriben resultados fallidos.

`translation-voices` completa agotó 180 segundos. Diez casos dirigidos posteriores
no convierten esa suite en aprobada. `workspace-chat-native` también agotó 180
segundos, sin diagnóstico de fase disponible: el recorrido amplio de WebView2
sigue pendiente, aunque pasan las comprobaciones locales y del navegador.
No se acredita arrastre físico, cliente de correo real, dispositivo móvil,
micrófono real ni carga del código en una instancia personal ya abierta.

No hubo inferencias ni llamadas a proveedores en las pruebas de este hito. Los
originales de audio/video y datos personales no se adjuntaron a la bitácora.
Las funciones móviles, calendario/clima, juegos, stream y grabación propias
siguen abiertas en la matriz; el objetivo no se marca terminado.

## Persistencia de ajustes y cambio de herramienta

El usuario pidió conservar los ajustes entre sesiones. El servidor de Desktop
escucha en un puerto local asignado al iniciar y WebView2 usa un perfil privado.
Los cambios de tema, texto del chat, voz y escucha, apariencia de WorkSpace,
grabación, modo e idiomas de traducción y ciudad del clima se guardan ahora en
un archivo local. Cada respuesta de guardado incluye la versión confirmada.
Los documentos autorizados de Desktop reciben los valores al cargar. Solo se
envían cambios explícitos al servidor, sin un sondeo adicional. El primer cambio
incorpora los valores válidos que sigan disponibles en la sesión anterior.
Si el archivo no se puede leer, los valores se conservan en disco y el guardado
informa del error. Restablecer General mantiene los ajustes de las otras áreas.

Las carpetas elegidas explícitamente se guardan en el servicio nativo. Al
reabrir se vuelve a verificar que existan y que sus rutas carezcan de enlaces.
El usuario puede quitar una carpeta desde Ajustes. Esto revoca el permiso de
control vigente y cancela las tareas asociadas a esa autorización. La
autorización de control de una sesión y el consentimiento para clonar voces
caducan al cerrar. La grabación, captura y el clima requieren sus acciones
habituales para empezar. Los ajustes ya persistentes de red, reloj, modo de
acceso, ocultación del chat y reducción de música conservan su almacenamiento.

El selector de Herramientas muestra una transición de 160 ms mediante opacidad
y desplazamiento de 5 px. Un cambio rápido cancela la animación anterior y
devuelve el foco al selector si estaba dentro de la herramienta saliente.
Al terminar, cambiar de panel o desactivar el movimiento, se liberan las
animaciones. El modo de movimiento reducido omite la transición.

Edge comprobó dos instancias sucesivas del servidor local con puertos y perfiles
distintos. Las pantallas reales recuperaron ajustes de General, Voz, WorkSpace,
Grabación, Traducción y Clima. Se usaron datos sintéticos para los puentes de
voz y clima. El servicio de ordenador real comprobó que la carpeta se recupera
tras reiniciar y que quitarla invalida el permiso anterior. Se probaron el
rechazo de otro origen, el rechazo sin autorización del escritorio y el
rechazo de un valor inválido. El recorrido de diseño aprobó a 340 px con
cambios rápidos, teclado y movimiento reducido.

[Reinicio y ajustes](../tmp/verification/workspace-settings-ui-20261108T025603-421da99c.json),
[acceso local](../tmp/verification/desktop-ui-session-20261108T025603-85b9a18b.json),
[carpetas](../tmp/verification/computer-20261108T025514-546ef4d5.json),
[diseño](../tmp/verification/workspace-design-ui-20261108T025603-1fbeee4e.json).

También pasaron 45 pruebas de WorkSpace, 14 de reducción de música, 20 de
teléfono y 26 de widgets nativos. Se conservan tres fallos de prueba: un
selector de etiqueta demasiado estricto, una comprobación de casilla antes de
confirmarse y un sustituto del ordenador desactualizado ante el parámetro
`refresh`. Se corrigieron los bancos correspondientes. Los ensayos de este
hito no invocaron servicios externos. GPU de interfaz y recursos totales de
la aplicación nativa quedan sin medir. El reinicio de la instancia personal
de WebView2 sigue pendiente.

[Primer selector](../tmp/verification/workspace-settings-ui-20261108T024859-1f79b9ec.json),
[casilla asíncrona](../tmp/verification/workspace-settings-ui-20261108T025412-0b5cffa7.json),
[sustituto anterior](../tmp/verification/computer-20261108T025135-0e6c4fb1.json).

## Paneles compactos

Herramientas y Archivos ajustan la altura a lo visible. El WebView mide el
contenido con un observador de tamaño y la ventana nativa aplica esa altura
a su región. Solo se ajusta el panel activo. Las listas largas se desplazan
dentro de un único contenedor con un tope de 344 px, o menos si la pantalla
tiene menos espacio. El cambio de tamaño no añade sondeos ni animación nativa.

En Edge, Enfoque pasa de 280 a 167 px de alto, y el ancho normal de
Herramientas de 500 a 360 px. A 340 px de pantalla, el panel queda en
324 × 167 px, con botones de 26 px y unos 12 px bajo los controles.
Archivos pasa de 440 a 376 px de ancho normal. La zona vacía para soltar
archivos se convirtió en una fila compacta. Grabación reduce la altura del
reloj y la separación entre fuente, opciones y acciones.

La prueba local de Edge usa los archivos de interfaz reales y un puente
nativo sustituido. Verifica ajuste de altura, desplazamiento hasta el
último de doce archivos y ausencia de solicitudes de tamaño repetidas.
Dos ejecuciones iniciales fallaron por un límite de altura de prueba
demasiado estricto y una medida tomada durante la transición. La verificación
de WorkSpace pasó 46 casos, incluido el rechazo de tamaños fuera de rango
y de medidas recibidas tras cambiar de panel. También pasaron las pruebas
locales de widgets, archivos, grabación, ajustes, agenda, teléfono y llamadas.
Se usaron datos sintéticos y cero llamadas a proveedores externos.

[Diseño a 340 px y escritorio](../tmp/verification/workspace-design-ui-20261108T030757-b78e97d3.json),
[geometría y puente](../tmp/verification/work-20261108T030611-8c353cf3.json),
[grabación](../tmp/verification/workspace-recording-ui-20261108T030611-2ef55260.json),
[archivos](../tmp/verification/workspace-files-ui-20261108T030611-712127ab.json),
[ajustes](../tmp/verification/workspace-settings-ui-20261108T030639-0fa4f364.json).

Comprobaciones posteriores en Edge: el panel separado de 780 × 404 px
propone su altura y la barra se mantiene oculta sin enviar solicitudes de
tamaño. Pasaron también la suite general de isla y los escenarios de
ejecución simulada. En esos escenarios el panel oculto no llamó al puente.
No se midió el proceso WebView2 de la instancia personal.

[Panel separado y captura compacta](../tmp/verification/workspace-design-ui-20261108T031036-e622925c.json),
[isla](../tmp/verification/island-ui-20261108T030758-e489986c.json),
[ejecución](../tmp/verification/workspace-runtime-20261108T030757-a4654c1f.json).

## Restauración del árbol original

La revisión posterior distinguió el árbol de código guardado en el ZIP de los
videos y el estado privado trasladados con anterioridad. Se extrajo el ZIP
completo en una ubicación temporal de Documentos y se renombró al finalizar a
`C:\Users\felix\Documents\Brivany-original-20261104`. Se comprobaron CRC y
tamaño de las 128.601 entradas, con 13.519.975.676 bytes extraídos. Cuatro
archivos de código y documentación coinciden byte a byte con el ZIP.

El ZIP carece de `.git` en su raíz. El repositorio activo sigue en
`C:\Users\felix\Documents\GitHub\Brivany` y se verificaron allí los metadatos
Git. Los tres videos de referencia están en el directorio `Examples` de
`Brivany-private-history-20261104`, fuera de GitHub. No se sustituyó ningún
archivo del repositorio activo, del histórico privado o del ZIP.

[Informe de restauración](../tmp/verification/workspace-original-restore-20261108T032337.json).

## Idioma de WorkSpace

**Ajustes → Melodi WorkSpace → Idioma de WorkSpace** permite elegir español
o inglés. La elección se guarda mediante el mismo archivo de ajustes de
Desktop, en un grupo independiente. Las instalaciones con ajustes anteriores
obtienen español como valor inicial. Restablecer General conserva el idioma
de WorkSpace y el ajuste de escucha sigue bajo Voz y conversación.

El catálogo se carga con las vistas de WorkSpace. Traduce la barra, los
controles principales de Melodi, Archivos, Herramientas, grabación, música
y traducción auditiva. También aplica etiquetas accesibles, nombres de
herramientas, números, fechas y calendario. Los controles que reciben
contenido del usuario conservan el texto original. Cambiar de idioma actualiza
los controles visibles sin reiniciar el temporizador ni recargar las vistas.
Quedan por localizar estados especializados, ventanas auxiliares y los
otros idiomas de la referencia. El selector solo ofrece los dos idiomas
incorporados en este recorrido.

Edge comprobó español → inglés → español, el límite de 340 px y la
reapertura con otro perfil y puerto. Conservó una nota, un nombre de
archivo y el plazo activo, y reformateó el resultado de la calculadora.
WebView2 propio confirmó que una preferencia escrita desde la ventana
principal llega a la barra y al panel abiertos y se recupera del disco.
Pasaron la regresión nativa general y las suites de isla, grabación,
agenda, sesión y diseño. Se usaron datos sintéticos y servicios sustituidos,
sin solicitudes a proveedores.

Los informes previos conservan un selector de prueba que necesitó etiqueta
explícita y un arranque que no encontró el controlador de isla en una
ejecución concurrente. El banco comprueba ahora la respuesta y el montaje
de los controladores antes de interactuar. El fallo concurrente del visor
Glisse no se reprodujo en la ejecución nativa posterior.

[Reapertura y vista a 340 px](../tmp/verification/workspace-settings-ui-20261108T035838-86d818bf.json),
[preferencia en WebView2](../tmp/verification/workspace-locale-native-20261108T035727-a6845647.json),
[sesión](../tmp/verification/desktop-ui-session-20261108T035535-455eb51b.json),
[regresión nativa](../tmp/verification/workspace-chat-native-20261108T035755-2aaddfa7.json),
[primer selector](../tmp/verification/workspace-settings-ui-20261108T035309-6eda98d9.json),
[arranque concurrente](../tmp/verification/workspace-settings-ui-20261108T035535-c01959bd.json).

## Francés y portugués de Brasil

8 de noviembre. Se añadieron francés y portugués de Brasil al selector de
WorkSpace. Los tres catálogos traducidos contienen las mismas 408 entradas.
El español conserva los textos originales de la interfaz. El servidor adjunta
solo el catálogo elegido a la vista de WorkSpace. Cambiar el idioma carga
su JSON local y aplica los mensajes juntos. Una selección posterior cancela
la anterior para evitar que una respuesta retrasada sustituya el idioma actual.

Se incorporaron estados de llamada, buzón y revisión de permisos móviles.
Al cambiar de idioma se mantienen los datos del formulario y los permisos
seleccionados. Las fechas de los mensajes de voz usan el formato elegido.
Quedan otros idiomas, ventanas auxiliares y estados de servicios por localizar.
Estas traducciones se revisaron en código y en la interfaz con ejemplos
sintéticos. La revisión lingüística por hablantes nativos sigue pendiente.

La prueba HTTP verificó todos los catálogos, la igualdad de claves y variables,
el arranque con la traducción guardada y la ausencia de catálogos en la ventana
principal. En WebView2 propio, WorkSpace arrancó en francés y alternó los
cuatro idiomas en barra y panel. Edge verificó el temporizador activo, notas,
nombres de archivos, permisos pendientes, fechas, apertura con otro perfil y
vistas de 340 px. Las capturas de Enfoque muestran los botones completos.
Las suites de llamadas y control móvil pasaron con acciones sustituidas.
Los ensayos no solicitaron servicios externos ni realizaron llamadas públicas.

La primera ejecución del recorrido francés → portugués intentó consultar
Archivos mientras el reloj estaba abierto. Se corrigió el paso del banco
antes de repetirlo. El resultado fallido queda conservado.

[Reapertura y cambios rápidos](../tmp/verification/workspace-settings-ui-20261108T051909-b7195fe2.json),
[catálogos y arranque HTTP](../tmp/verification/desktop-ui-session-20261108T051909-a9030c18.json),
[cuatro idiomas en WebView2](../tmp/verification/workspace-locale-native-20261108T051702-3452b282.json),
[control móvil](../tmp/verification/phone-control-ui-20261108T051909-33f330c9.json),
[llamadas](../tmp/verification/telephony-ui-20261108T051909-0dcc84ba.json),
[primer recorrido](../tmp/verification/workspace-settings-ui-20261108T051613-be45e0e2.json).
