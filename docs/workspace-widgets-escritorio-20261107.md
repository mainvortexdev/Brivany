# Widgets de escritorio · 7 de noviembre de 2026

Se completa la familia de widgets independientes de las referencias: Reloj,
Enfoque y Notas pueden abrirse desde el icono de ventana junto al selector de
Herramientas. Calcular y las demás herramientas conservan su distribución.
Cada tipo reutiliza una sola ventana; cerrarla no borra su estado local.

## Comportamiento y diseño

Ventanas pequeñas de grafito, borde fino, esquinas redondeadas, tipografía del
sistema, controles funcionales y cierre discreto. Aparecen sin tomar el foco de
la aplicación que se esté usando y no crean entradas adicionales en la barra
de tareas. Se pueden mover desde el encabezado. Se guardan sus posiciones y se
ajustan al área disponible de los monitores cuando se abren o cambia su tamaño.

Se conserva la configuración necesaria en Ajustes → Melodi WorkSpace: «Mantener
encima» y «Cerrar todas». Acento, superficie y tamaño siguen las preferencias
existentes. El panel de notas oculta la etiqueta visual auxiliar y solo muestra
el contador al acercarse al límite; las etiquetas accesibles se conservan. La
nota nativa no mantiene una barra de desplazamiento visible si el texto cabe.

Las tres ventanas usan WinForms y el dispatcher que ya tiene Brivany. No crean
otro WebView ni un proceso por widget. Se construyen solo al usar el icono; el
modelo compartido de datos puede existir antes sin crear ventanas.

## Estado compartido y cierre

- Un modelo local coordina nota y temporizador entre barra, panel y ventanas.
  Migra la copia anterior de localStorage una sola vez. Cambiar preferencias o
  abrir otra vista no vuelve a importar una nota antigua ni reinicia el plazo.
- Las notas admiten 4000 unidades UTF-16. Las revisiones detectan ediciones
  concurrentes; se conserva un borrador por editor. Solo en conflicto aparecen
  «Cargar actual» y «Guardar ésta». No se sobrescribe un texto simultáneo de forma
  silenciosa. Una repetición idéntica tras perder un acuse es idempotente.
- El controlador conserva la revisión del texto mostrado durante una respuesta
  tardía. Un cambio remoto recibido mientras se escribe no se convierte en una
  autorización implícita para reemplazarlo. La prueba de esta carrera conserva
  ambas ediciones hasta una elección explícita.
- Ediciones aún sin acuse se recuperan desde una entrada local acotada por vista.
  Se retira tras el acuse o una resolución explícita. No garantiza supervivencia
  a todo fallo del equipo ni sustituye una copia de seguridad.
- El temporizador tiene un plazo absoluto y una sola alarma nativa. Pausar,
  reanudar, restablecer y terminar se reflejan en todas las vistas. Solo la barra
  emite el aviso de finalización; el panel no lo duplica. No hay alarmas JavaScript
  adicionales cuando está conectado el modelo nativo.
- El reloj visible se repinta al cambiar el minuto; el temporizador visible,
  cuando cambia el segundo. Las notas no tienen un sondeo. Al cerrar los widgets
  se elimina el timer de repintado. El guardado agrupa ediciones próximas y su
  único worker termina después de quedar inactivo.
- El estado privado vive en `.local/widgets/state.json`, excluido de Git, con
  escritura temporal y sustitución atómica. El cierre general guarda el último
  estado y cierra las ventanas antes de destruir la ventana principal. Un archivo
  ilegible se conserva y no se reemplaza por una migración antigua.

No se registran textos de notas en la bitácora, no se vigila el portapapeles y
estas funciones no invocan modelos ni servicios remotos.

## Verificación

Todos los datos son notas sintéticas propias. No se usaron cuentas, micrófono,
audio, videos de referencia, teclado físico ni captura del escritorio personal.

1. **25 casos locales** (`desktop-widgets`): estado, persistencia, migración,
   plazo, alarma antigua, reapertura, límite UTF-16, origen, filtro de borradores,
   cierre, preferencias y construcción diferida. Se valida que una conexión
   adicional conserva la misma alarma y que un temporizador antiguo inválido
   no impide recuperar una nota válida.
2. **Edge y Python reales** (`desktop-widgets-ui`): dos páginas de producción
   conectadas al modelo/puente real por pipe privado; solo las ventanas se
   sustituyen. Edición compartida, conflictos, respuestas tardías, recuperación
   tras un fallo de entrega simulado, plazo real, aviso único, Ajustes y 340 px.
   No se observaron RPC de widgets durante el intervalo de reposo comprobado.
3. **WinForms real** (`desktop-widgets-native`): tres ventanas propias, controles
   de pausa/reanudación, nota y resolución de conflicto, desplazamiento para
   nota larga, posición, apariencia, TopMost, no tomar el foco y cierre sin
   repintados posteriores. Capturas mediante DrawToBitmap de los controles
   propios, sin capturar otras aplicaciones.
4. **Recorrido nativo completo** (`desktop-widgets-webview-native`): WebView2
   real con los módulos de herramientas de producción, guardia de origen,
   puente, modelo y WinForms reales. El icono abre Notas; ediciones viajan del
   renderer a la ventana y de vuelta. Pausa/reanudación nativas y final del
   temporizador actualizan el renderer. Tres widgets mantienen el número de
   ventanas WebView en **una**, la propia del banco. El cierre del puente guarda
   la última nota, retira ventanas y timers. El banco usa una shell de
   herramientas propia: no es certificación de una sesión personal ya abierta.
5. Regresiones aprobadas: **45 casos de Work**, **2 de arranque**, interfaz de
   widgets anterior y Ajustes entre vistas. `git diff --check` aprobado.

Los helpers acabaron y no quedaron procesos del banco de widgets al comprobar
la lista de procesos. No se terminaron procesos de otras aplicaciones.

## Medición local acotada

`desktop-widgets-resources-native` reutiliza el banco WinForms y observa tres
intervalos de unos tres segundos, con una sola llamada de su driver de prueba
al terminar cada intervalo. Mide el contador CPU y working set del proceso
Python aislado, incluyendo su CLR y las ventanas propias; **no** incluye una
sesión completa de Brivany, sus WebView2 ni todas las condiciones de uso.

| Estado | Intervalo | CPU de proceso observada | Repintados de widgets |
| --- | ---: | ---: | ---: |
| Tres widgets abiertos, temporizador detenido | 3,026 s | 0,000 s | 0 |
| Temporizador en marcha | 2,997 s | 0,000 s | 3 |
| Todos cerrados | 3,003 s | 0,016 s | 0 |

El working set del banco permaneció aproximadamente entre 77,9 y 78,1 MiB.
Son muestras cortas de un proceso propio; los valores de CPU redondeados a cero
no acreditan consumo absolutamente nulo. Tampoco permiten atribuir toda esa RAM
a los widgets ni anunciar un porcentaje de ahorro de la aplicación. GPU total
desconocida. Durante las pruebas no hubo peticiones a proveedores ni descargas
de dependencias. La medición integral de WorkSpace sigue pendiente.

Informes exactos y rutas de capturas propias en
`tmp/verification/desktop-widgets-milestone-20261107.json`.
El objetivo general de las referencias continúa activo.
