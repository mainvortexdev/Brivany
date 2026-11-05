# Terminal de Melodi: implementación y pruebas

1 de noviembre de 2026. Objetivo activo en `OBJETIVO_TERMINAL_MELODI.md`.

## Alcance vigente corregido por el usuario

Después de alcanzar el primer comando de autoridades certificadoras, el
usuario excluyó ese tipo de administración y pidió comandos/atajos de uso
cotidiano y algunos avanzados. Se retiraron 4.580 entradas del inventario
activo. La selección Windows contiene ahora 190 entradas; mantiene 231 atajos
y 46 nombres macOS preliminares. El registro sigue bloqueado por la política,
aunque sus comandos ya no formen parte del catálogo activo.

Los 36 comandos aprobados conservaron sus recibos y revisiones. La migración
guardó una instantánea antes de retirar elementos; no los aprobó ni simuló su
ejecución. La checklist continúa con comandos útiles añadidos, comenzando por
Get-FileHash. Esta corrección de alcance sustituye el inventario amplio de la
sección histórica que sigue; no acredita 2.000 ejecuciones.

## Catálogo y ejecución

El catálogo inicial indexa 4.757 entradas Windows/PowerShell, 231 atajos de
Windows y 46 nombres de herramientas macOS. Las entradas de Windows incluyen
módulos de Windows Server que este equipo no tiene instalados. No representan
4.757 ejecutables nativos ni 4.757 pruebas aprobadas. El conjunto macOS es
preliminar; no acredita ejecución en un Mac.

Fuentes: índice oficial Windows Commands, documentación Microsoft PowerShell,
artículo oficial de atajos de Microsoft y Shell Scripting Primer de Apple.
Cada entrada conserva fuente y plataforma. La documentación descargada es dato
no confiable y nunca se evalúa como código.

`docs/terminal-checklist.md` es la vista numerada del estado actual. SQLite
conserva la puerta secuencial y cada ejecución genera un recibo independiente.
El siguiente elemento no se ejecuta mientras el anterior necesite revisión o
haya fallado. Las revisiones incluyen motivo, criterios y hash del recibo.
Consultar ayuda no aprueba el comando cuya ayuda se consultó. Los elementos del
registro figuran prohibidos y nunca se aprueban.

El primer intento de Get-Date como PS1 fue rechazado por la política del equipo.
Se rechazó el recibo y se mantuvo su histórico. La implementación usa ahora
comandos individuales predefinidos con PowerShell `-Command`, sin cargar PS1,
modificar ExecutionPolicy ni usar Bypass, eval o código generado por el modelo.

## Especialista del chat

El enrutador del chat y voz live admite `terminal`. El modelo elige operaciones
tipadas, nunca una línea libre de shell. El especialista comparte el dueño de
ventanas con el agente de ordenador y deja independientes las demás colas.
Los hijos reciben un entorno acotado sin claves Brivany. Esto es una política
del despachador, no una sandbox del sistema operativo para código arbitrario.

Se bloquean comandos, argumentos y herramientas de registro en el transporte.
Regedit no se modifica ni se automatiza desde la UI general. La orientación
explica alto riesgo y responsabilidad del usuario. Abrir una ruta de Regedit
con una petición explícita sigue pendiente de un adaptador de solo navegación.
No se elude UAC ni se cambian medidas de seguridad para completar una prueba.

## Proyecto real y evidencia

Se clonó ProjectFixture-Trading-Operator, commit
`57b3878cc09eaffab9789fdcc438753895995e08`, mediante Git del equipo. El acceso
web anónimo no acreditaba disponibilidad; el gestor Git existente sí permitió
la clonación autorizada. La copia de origen se conserva limpia y se ejecuta una
copia de trabajo independiente. No se hizo push.

Python/Flask: entorno virtual, instalación real de requirements, compileall
correcto y servidor original servido mediante un adaptador de presentación en
loopback. No hubo un error de sintaxis que reparar en esa revisión. La vista
local bloquea operaciones financieras y llamadas API salvo salud; no se usaron
las credenciales de servicio clonadas ni cuentas de trading.

La primera captura real muestra la pantalla de acceso del proyecto y tiene
1144 × 741 px. No acredita acceso autenticado a trading. El ensayo nativo
detectó un problema de guardado del Bloc de notas: la escritura estaba
verificada pero el archivo seguía vacío. Se conservó como fallo. La corrección
resuelve Guardar por el menú observado, incluyendo el menú Win32 cuando no hay
proveedor UIA; el ensayo posterior confirmó el TXT guardado byte a byte.

La detección encontró Antigravity instalado. Una solicitud de apertura del IDE
no acredita por sí sola que el proyecto se haya ejecutado dentro de su terminal.

La primera llamada real del especialista eligió inspeccionar el entorno aunque
la petición requería clonar y arrancar. Ese resultado es insuficiente: no se
considera prueba de clonación cumplida. Se añadió validación de la operación y
una corrección limitada del plan; el ensayo completo se registra por separado.

## Alcance de pruebas

`tools.verify terminal`: 11 pruebas locales de política, rutas, entorno, bloqueo
Git push, catálogo, puerta secuencial, rechazo de falsos aprobados y enrutador.
El primer ensayo de la suite falló por cerrar SQLite después de limpiar la
carpeta temporal del test; se corrigió el orden de limpieza y pasó.
Las pruebas de recibos sintéticos no se cuentan como comandos Windows aprobados.

Git/docs/pip usaron red real; bytes totales y coste externo no medidos. El primer
ensayo nativo de adaptadores no llamó a modelos. La planificación real por Meta
se contabiliza aparte, con importe desconocido. No se guardan claves, audio,
conversaciones ni archivos de credenciales en la bitácora.

Pendiente: ampliar recetas verificables, ejecutar/revisar la checklist completa,
verificación macOS, elevación legítima con intervención cuando el sistema la
exija, empaquetado de ejecutables, limpieza acotada de temporales y reparación
de compilación con casos reales o sintéticos claramente diferenciados.

## Comprobaciones posteriores del 1 de noviembre

El ensayo completo del enrutador y especialista reales de Melodi sí terminó la
clonación solicitada, preparación, arranque, captura y TXT escrito y guardado
desde Bloc de notas. Trabajo `76d4c328-9543-4a10-9842-a875af3ec44d`;
`tmp/terminal-project-real/latest.json`. La copia de origen permanece limpia y
no se publicó ningún cambio. La captura muestra la pantalla de acceso, sin
trading ni autenticación. Las evidencias del usuario están en
`<local-path>/Desktop/Evidencia Melodi/`. Las dos llamadas de modelo (ruta y
plan de especialista) tienen coste desconocido; dependencias y Git usaron red
real. Se conserva el fallo previo del plan incompleto. La apertura efectiva y
ejecución dentro de Antigravity siguen sin quedar acreditadas.

También se creó y ejecutó un EXE de una muestra C# propia mediante el
planificador real y el compilador de Windows: salida exacta «Melodi executable
verified», código 0 y fuente sin cambios. El archivo de evidencia es
`tmp/terminal-build-real/Executable-Fixture-b3bc2d65.json`. Esa muestra no acredita
conversión de cualquier proyecto ni el backend Python/PyInstaller. El producto
no ejecuta automáticamente los binarios que compila. Una llamada de modelo,
importe desconocido.

La limpieza de temporales antiguos incluye cuarentena recuperable y comprobación
de rutas/huellas; las pruebas sólo afectaron muestras propias. No se limpiaron
temporales personales. La reparación acotada de sintaxis pasó casos sintéticos;
la revisión real de ProjectFixture compiló sin necesitarla. Se mantienen las restricciones
de registro y la falta de comprobación macOS.

La checklist ya tiene 64 comandos ejecutados y revisados, incluido CHKDSK de
sólo lectura. Ni los 190 comandos activos, ni los 231 atajos, ni el índice macOS
son una certificación de dominio completo o 2.000 ejecuciones. El objetivo
general sigue abierto. Office y consultas del PC tienen su
[registro específico](terminal-equipo-y-office.md#cierre-comprobado-de-esta-instalación).

1 de noviembre, comprobación posterior del IDE: se corrigió la confusión entre
gestor Antigravity y Antigravity IDE. El planificador y adaptador nativo ya
abrieron la copia de ProjectFixture en el editor, iniciaron su configuración observada y
verificaron salud HTTP. La parada y el nuevo arranque también se comprobaron;
la copia de origen sigue limpia. Los fallos previos y límites de macOS se
conservan. [Implementación y evidencia real](terminal-ide-real.md).
