# Consultas del equipo, apagado y despliegue de Office

1 de noviembre de 2026. Ampliación solicitada durante el objetivo de terminal.

## Lecturas del equipo

Se añadió una consulta CIM de sólo lectura para Windows, con fecha de lectura,
recibo y resultado estructurado. No lee números de serie, cuentas, claves ni
registros mediante Regedit. El tiempo se identifica como tiempo desde el último
arranque del kernel: suspensión/inicio rápido pueden conservarlo y no se vende
como medición independiente de todas las horas físicas de encendido.

La virtualización distingue habilitación del firmware, soporte del procesador
e hipervisor activo. Un dato ausente no se interpreta como deshabilitado. Las
especificaciones incluyen modelo, CPU, RAM instalada, GPU y capacidad del disco;
RAM utilizable e instalada se mantienen distintas.

Comprobación real: Dell OptiPlex 7040, Windows 10 Home de 64 bits, Intel i7-6700,
4 núcleos/8 hilos, 12 GiB instalados, Intel HD Graphics 530 y SSD Apacer de 512 GB.
Windows informó virtualización de firmware habilitada y ningún hipervisor activo.
La prueba real del enrutador y planificador Meta eligió el especialista correcto
y respondió las tres consultas desde una lectura nueva. Coste de esas dos
llamadas desconocido; no se usó síntesis ni ASR.

## Apagado

La espera queda guardada, es cancelable y requiere Brivany abierta. Al arrancar
Brivany, un apagado vencido se marca omitido: no apaga inesperadamente por una
petición antigua. Una reclamación exclusiva evita duplicar el envío entre
trabajadores. Ejemplos, preguntas hipotéticas y negaciones no programan nada.

Se usa una capacidad interna exacta de Windows `shutdown /s /t 0` al vencer la
espera. No se usa `/f`: las aplicaciones pueden impedir un apagado sin guardar.
No se usa el timeout del comando para la espera, porque Microsoft documenta que
un timeout positivo implica cierre forzado. El despachador general continúa
bloqueando shutdown arbitrario. No se fuerza elevación ni se evaden permisos.

Pruebas locales: reloj y acción del sistema sustituidos, cancelación, una sola
ejecución, reinicio con espera vencida y argumentos del adaptador. **No se envió
un apagado real ni se verificó apagado físico** durante estas pruebas.

## Office

Se inspeccionaron fotogramas espaciados del video de referencia y dos momentos
concretos (127 y 184 segundos). Muestra Office Deployment Tool y el producto
Office LTSC Professional Plus 2021 por volumen. El final muestra instalación,
no una licencia ni prueba de activación perpetua. Se contrastó con documentación
oficial. El usuario confirmó no disponer de licencia y eligió instalar Office
sin activar para activarlo después.

Se implementó selección de Word, Excel, PowerPoint, Outlook, OneNote y Access,
o la suite, con productos retail admitidos. La configuración no importa claves,
no usa servidores de activación externos, no desinstala productos previos, no
cierra aplicaciones forzosamente y no acepta automáticamente el acuerdo de
licencia. Las firmas Authenticode de la descarga y setup deben ser válidas y de
Microsoft. La ejecución posterior usa las opciones documentadas de ODT.

La descarga del paquete oficial ODT se verificó. Su autoextractor exige
elevación incluso al extraer y CreateProcess devolvió 740. Se leyó el CAB
embebido del paquete firmado con `expand.exe`, sin ejecutar una instalación
elevada ni eludir UAC; setup extraído también tiene firma Microsoft válida.
Se inició descarga oficial con el producto `O365HomePremRetail`, en español,
64 bits, `AUTOACTIVATE=0`. La descarga de la suite y su instalación se anotan por
separado: archivos presentes no acreditan instalación ni activación.

La instalación actual necesita comprobar el proceso final, los ejecutables
instalados y cualquier intervención de Windows/EULA. No se declara completada
mientras esa evidencia falte. Tráfico y tamaño total efectivo no medidos; la
suite usa red real. No se adjunta el video original ni información de licencia
a la bitácora.

Corrección durante la prueba: el padre inicial agotó su plazo de 900 segundos,
pero se confirmó vivo el worker Microsoft que había relanzado. Se conservó el
fallo del padre y se abrió un observador del mismo PID/imagen/configuración,
sin reiniciar la descarga. Las siguientes descargas admiten una hora y los
procesos nuevos de terminal usan un Job Object propio de Windows: una prueba
real con un hijo sintético confirmó que la cancelación detiene también ese hijo.
Esto controla procesos hijos propios, no servicios del sistema ni una sandbox
de seguridad para código arbitrario.

Suite local ampliada: 34 pruebas de terminal/política, reparación acotada,
limpieza recuperable, consultas, apagado simulado, XML Office y cancelación real
de un árbol de procesos de prueba. Se conserva también el fallo previo de
validación de una ruta ZIP normalizada por Python; la corrección usa su nombre
original antes de extraer. La interfaz de resultados conserva el micrófono y
se ajustó en 1120, 390 y 320 píxeles con puente/modelos sustituidos.

Fuentes:

- [Office Deployment Tool](https://www.microsoft.com/en-us/download/details.aspx?id=49117).
- [Opciones de configuración](https://learn.microsoft.com/en-us/deployoffice/office-deployment-tool-configuration-options).
- [Productos admitidos](https://learn.microsoft.com/en-us/previous-versions/troubleshoot/microsoft-365/microsoft-365-apps/office-suite-problems/product-ids-supported-office-deployment-click-to-run).
- [Activación por volumen](https://learn.microsoft.com/deployoffice/vlactivation/plan-volume-activation-of-office).
- [Shutdown](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/shutdown).

## Cierre comprobado de esta instalación

Actualización posterior, 1 de noviembre: terminó la instalación oficial de
`O365HomePremRetail` de 64 bits en español. Se comprobaron Word, Excel,
PowerPoint, Outlook, OneNote y Access, versión 16.0.20527.20112, con firmas
Authenticode válidas de Microsoft. Los procesos de configuración terminaron.
Word abrió mostrando «Error de activación de productos»; Excel y PowerPoint
también abrieron. No se inició sesión, compró una licencia ni solicitó activación.
La presencia de los seis ejecutables no acredita que todas sus funciones estén
disponibles sin licencia. El usuario eligió expresamente instalarlos sin activar.

Se conservan los intentos anteriores que agotaron su plazo. El primer configure
sin elevación quedó interrumpido y no se contó como éxito. Se continuó con el
instalador Microsoft mediante la elevación normal de Windows, sin automatizar
UAC. Para futuras instalaciones, el adaptador detecta primero si necesita esa
elevación y evita repetir el intento sin privilegios durante quince minutos.

Evidencias finales: `tmp/office-video-review/installation-final.json`,
`installed-binaries-verification.json` y `install-completion-events.json` en la
misma carpeta. Una comprobación posterior por el despachador real de Melodi
confirmó las firmas y una lectura nueva del equipo:
`tmp/office-video-review/dispatcher-post-install.json`. Esa comprobación usó un
plan determinista sustituido, no una nueva llamada al modelo. La suite registrada
`terminal` pasó 37 pruebas locales; recibo
`docs/verification-history/terminal-20261101T130326-8b0421a0.json`.

Además terminó el CHKDSK de sólo lectura: `chkdsk C:` sin opciones de reparación,
token elevado comprobado, salida 0 y mensaje final sin problemas ni sectores
defectuosos. Se revisó explícitamente su recibo
`80037b33-ab48-454e-ab1a-d1c83b4e8dfe` antes de aprobar el elemento 64. Se conserva
el rechazo anterior por falta de privilegios; la elevación no equivale por sí
sola a un aprobado. No se reparó el volumen ni se apagó el equipo.
