# Modos de acceso y revisión de archivos

1 de noviembre de 2026. Entrega del selector solicitado por el usuario. No
implementa aceptación automática de UAC ni acceso administrativo ilimitado.

## Comportamiento implementado

En Ajustes → Ordenador y agentes hay dos opciones, guardadas por el backend en
este equipo. El modo inicial es **Normal**. Un archivo de preferencias inválido
vuelve a Normal. El selector no es una preferencia del navegador ni una concesión
de privilegios Windows. Cambiarlo revoca la sesión anterior, cancela sus tareas
y descarta preparaciones pendientes.

| Operación admitida | Normal | Acceso completo |
|---|---|---|
| Consultas y creación de archivos nuevos | Con autorización de sesión y alcance vigente | Igual |
| Mover un documento personal a un destino nuevo | Aprobación concreta | Autónomo dentro de carpetas autorizadas |
| Enviar un archivo a la papelera | Aprobación concreta | Aprobación concreta |
| Sustituir un archivo existente | Aprobación y copia de la versión anterior | Aprobación y copia de la versión anterior |
| UAC, credenciales y permisos de cuentas | Intervención humana | Intervención humana |
| Registro, shell libre y borrado permanente | Bloqueados | Bloqueados |

«Acceso completo» conserva el nombre pedido por el usuario; la propia interfaz
explica que se limita a operaciones admitidas y carpetas autorizadas. No eleva
Brivany, no instala un servicio SYSTEM, no modifica políticas UAC ni habilita
control del escritorio seguro. macOS/Linux no adquieren control nativo por este
selector. Las instalaciones conservan su flujo del sistema y sus condiciones.

La limpieza conversacional de temporales se restringió a vista previa: su
ejecutor antiguo de cuarentena no se llama desde el chat sin una revisión
específica. Esta entrega no incorpora todavía una interfaz de aprobación para
ese lote de temporales. Las recetas de checklist siguen limitadas a sus propios
archivos sintéticos; no conceden permiso sobre documentos personales.

## Revisión de una acción concreta

`file_action_prepare` obtiene tamaño, identidad de archivo, tiempos y SHA-256
antes de esperar. El planificador sólo conoce `delete_file`, `replace_file` y
`move_file`; no recibe herramientas para aceptar su propia aprobación.

El servidor guarda la continuación en memoria, termina la sesión de control
nativo y muestra origen y destino mediante texto literal. «Más tarde» no
ejecuta ni rechaza. «Rechazar» cancela. Aceptar usa el puente de la ventana
confiable, sin una ruta HTTP de aprobación. La autorización dura cinco minutos,
se consume una vez y necesita que siga vigente la sesión de control. Reiniciar,
desactivar o cambiar de modo no reanuda acciones pendientes.

El ticket del adaptador nativo no se expone en el resultado público ni se
persiste. `file_action_commit` vuelve a inspeccionar el archivo: si cambió,
caducó, salió del alcance o se convirtió en enlace, detiene la operación. El
ejecutor general no admite eliminación/sustitución directa, ni botones de
sobrescritura/Guardar, ni control de la propia interfaz de Brivany o de UAC.
La edición genérica de documentos existentes en Notepad/Word/Excel/PowerPoint
se detiene para evitar autoguardado sin revisión. Los adaptadores de documentos
nuevos siguen disponibles; editar un archivo existente requiere una copia y la
aprobación de su sustitución. La evidencia TXT usa su adaptador privado, que
primero crea e identifica un archivo nuevo; esa excepción no es un parámetro
admitido en los pasos del modelo.
La organización desde el Explorador también usa las herramientas de archivos,
no Cortar/Pegar mediante clics genéricos. No se certifica una detección semántica
de todas las acciones destructivas de cualquier aplicación de terceros.

Sólo se admiten archivos personales regulares de hasta 128 MiB, de tipos
documentales o multimedia, sin enlaces duros ni simbólicos. No admite carpetas,
ejecutables, scripts, archivos ocultos, configuración ni directorios protegidos
del sistema. La ruta interna `.local` del workspace sigue siendo utilizable.

Eliminar usa `electron.shell.trashItem`, sin alternativa de borrado permanente
si falla. Sustituir conserva primero una versión en
`workspace/file-versions/`; el recibo incluye `backup_path`. Se comprueban
contenido e identidad antes de escribir y el hash posterior. Un fallo durante
la escritura conserva la copia de recuperación y no se presenta como éxito;
no se certifica transacción atómica frente a cortes del sistema o un editor
externo escribiendo simultáneamente.

## Cognira Remote Host y UAC

Se revisaron, sin modificarlos, `docs/remote-administrator-access.md` y la cabecera
de `native/admin-bridge/CogniraAdminBridge.cs` en `cognira-desktop`. Describen una
instalación administrativa inicial y un servicio/cliente protegido para control
remoto autorizado. El documento dice expresamente: «No se desactiva UAC ni se
pulsa Sí automáticamente». La decisión corresponde al usuario remoto. También
conserva pendiente la prueba positiva del servicio/UAC en el equipo destino.
No se considera esa arquitectura evidencia de autoaprobación por Stacy.

Microsoft documenta el [escritorio seguro de UAC](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works#securing-the-elevation-prompt)
y la separación/ACL de los [servicios y su interfaz](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services).
Un ayudante administrativo de verbos restringidos requeriría una instalación
consentida y revisión propia; queda como alternativa de arquitectura, no como
servicio instalado o capacidad implementada. No se implementó tampoco el lote
de diagnósticos mencionado inicialmente: el usuario dirigió después el trabajo
al selector de modos y a las aprobaciones por archivo.

## Comprobaciones y límites

- `computer-access`: ocho pruebas con planificador/adaptador sustituidos;
  modos, persistencia, aprobación exacta, rechazo, caducidad, revocación,
  reinicio sin replay, fallo por archivo cambiado, temporales sólo en preview y
  rechazo HTTP de autoaprobación/cambio de modo incluso con grant de control.
- `computer-files`: siete pruebas Node con archivos sintéticos reales y papelera
  sustituida; protección de rutas/enlaces, destino nuevo, copia de recuperación,
  expiración, ticket de un uso y fallo de papelera sin borrado alternativo.
- `computer-access-ui`: servidor y página reales, puente/planificador/operaciones
  nativas sustituidos. Selector, backend, posponer, rechazar y aceptar una vez;
  anchuras 1280, 768, 390 y 320 sin desbordamiento horizontal. Capturas PNG
  inspeccionadas. El primer intento falló por no resolver Playwright; se reutilizó
  el paquete existente del runtime con `BRIVANY_PLAYWRIGHT_PATH`, sin instalarlo.
  Una regresión posterior detectó que una respuesta parcial/vacía de estado
  cerraba la revisión. Se corrigió conservando aprobaciones pendientes hasta una
  cancelación/finalización explícita o su caducidad; se descartan respuestas
  fuera de orden y un grant antiguo vuelve al estado del puente nativo. La
  suite posterior comprueba que `observe([])` no cierra la decisión.
- Regresión: `computer` 24, `computer-native` 30, `computer-images-agents` 15 y
  `terminal` 44. No representan nuevos comandos de la checklist.
- Comprobación real separada: `tools.check_computer_access_real --run` llama al
  transporte nativo Electron y verifica reemplazo/copia y papelera Windows
  sobre archivos sintéticos creados exclusivamente para esa prueba. La aceptación
  del fixture es simulada por la herramienta: no se presenta como aprobación del
  usuario sobre sus archivos. No solicita UAC ni envía entrada GUI.

Informes en `docs/verification-history/computer-access-*`, `computer-files-*`,
`computer-access-ui-*`, `tmp/computer-access-ui/` y
`tmp/computer-access-real/latest.json`. Estas pruebas no invocan modelos ni
APIs externas; la investigación documental sí usó la web. No prueban un servicio
elevado, autoaprobación UAC, acceso global al sistema ni ejecución en macOS.

La petición de cerrar el objetivo se registra como dirección del usuario. No
se certifican capacidades no logradas: la autoaprobación UAC no está implementada,
y el objetivo histórico no acredita 2.000 comandos, macOS ni navegación Regedit.
El usuario ya había dado por suficientes los 65 comandos aprobados; no se
reanuda la ampliación de la checklist.

## Estado al cerrar esta entrega

Brivany se reinició con WorkSpace después de corregir la carrera de estado. La
comprobación local HTTP devuelve modo Normal, control desactivado,
`uac_auto_approval=false`, aprobación obligatoria para borrar/sustituir/mover y
registro protegido. Los metadatos de la instancia de desarrollo PID 7952
confirman barra visible de 40 px, fuera de la barra de tareas, reserva superior
y panel con región vacía. La ventana principal está en segundo plano.
`tmp/computer-access-real/live-status.json` conserva sólo este estado y
metadatos propios, sin cookies ni tokens. El adaptador nativo se carga con la
política actual cuando se solicita una acción; no se activó control autónomo ni
se aprobó ninguna acción sobre archivos del usuario durante su ausencia.
