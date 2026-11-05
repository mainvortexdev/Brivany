# Cuenta Brivany y control entre dispositivos

2 de noviembre de 2026. Petición: iniciar sesión con la misma cuenta en móvil y
ordenador, conectar automáticamente y permitir encargos desde chat o Live. Con
varios ordenadores, preguntar cuál. Se creó una cuenta propia de prueba.

## Implementación disponible

Gateway publicado en `https://mobile.brivany.example`, versión
`b7459168-abab-4001-b559-6acdd73eb825`. Una instancia Durable Object/SQLite por
cuenta separa perfil, sesiones, dispositivos y tareas. Alta administrativa de
cuentas; esta entrega no incluye registro público ni recuperación de contraseña.
No se reutilizan sesiones de Google/Spotify como credenciales Brivany.

Contraseñas con scrypt N=32768/r=8/p=3, sal aleatoria y pepper del servidor.
Sesiones aleatorias de 32 bytes, verificador guardado en servidor, vencimiento
de 30 días y revocación. Windows guarda la sesión mediante DPAPI; el código iOS
la guarda en Keychain. Ninguna clave de Meta, Muse o Cartesia llega al cliente.
El almacén de este host Python todavía sólo implementa Windows; la conexión
equivalente de escritorio macOS/Linux queda pendiente de su almacén seguro y
pruebas. No se declara compatibilidad de ejecución física en esas plataformas.

`services/brivany_account.py` abre WSS saliente al iniciar Brivany con una sesión
guardada, reconecta con espera y anuncia disponibilidad. No necesita publicar
puertos del PC. Un equipo conectado se selecciona automáticamente; con varios
la tarea queda pendiente de la elección. Las elecciones se separan por sesión
y conversación. Un nombre desconocido o desconectado no se sustituye por otro
equipo. El modelo no puede decidir un equipo que el usuario no ha elegido.

El chat y el texto reconocido en Live comparten `control_computer` y
`choose_computer`. El broker entrega una sola vez y el host espera el acuse
antes de llamar al ComputerService existente. Recibos locales evitan repetir
comandos tras reconectar. Una entrega no confirmada pasa a estado incierto sin
repetición automática. El gateway no ofrece shell remoto ni ejecuta programas.
Se mantienen registro protegido, aprobaciones de borrar/sobrescribir y UAC.

Ajustes del escritorio y código SwiftUI permiten iniciar/cerrar sesión y ver
ordenadores. La vista de iPhone `http://127.0.0.1:8788/` usa un proxy local:
el navegador recibe perfil/estado, nunca tokens. Historial separado por cuenta,
respuestas asociadas a su conversación y seguimiento independiente de tareas.
Los equipos revocados se ocultan de la lista normal. La vista de diseño sigue
sin capturar micrófono: el campo de Live prueba la ruta etiquetada como voz.

La cuenta `pruebas@brivany.test` quedó iniciada en Windows y en esa vista móvil.
La contraseña aleatoria está únicamente en el archivo privado local de
credenciales, fuera de la bitácora y de las fuentes públicas. No se preinstala
esa contraseña ni una sesión en el código iOS.

El estado/instrucción/resultado resumido del broker caduca a las 24 horas y se
limpia con alarma Durable Object, también sin solicitudes entrantes. Las
sesiones caducadas tienen limpieza programada; una interrupción del proveedor
puede retrasarla. Perfil y dispositivos permanecen hasta eliminar la cuenta.
La política pública se actualizó y publicó, versión del sitio
`2e2e192e-50df-4aba-85c4-d57a008d133b` (incluida la corrección de fecha
estructurada). La vista de diseño usa copias internas sincronizadas desde la
misma fuente. El audio no se archiva en el broker.

## Pruebas y evidencia

Las suites se ejecutaron con `tools.verify`; sus informes y fallos históricos
se conservan en `docs/verification-history/`. No se adjuntan credenciales ni contenido
original de usuarios. Los mensajes de estas pruebas fueron muestras propias.

- `mobile-gateway`: 30 pruebas Node con proveedores sustituidos; hash/login,
  selección por chat/voz, aislamiento de cuentas, revocación, entrega única,
  acuses inciertos, rechazo de streams truncados y purga de caducados.
  Informe `mobile-gateway-20261102T131133-bc9e0502.json`.
- `account-host`: 9 pruebas Python; acuse antes de ejecución, no duplicar tras
  reinicio, permisos del ejecutor conservados, cancelación de tareas propias y
  cifrado/descifrado real DPAPI. La ruta ya armada del chat también conserva
  selección por cuenta. El acuse que llegue después de cerrar sesión tampoco
  inicia una tarea. Informe `account-host-20261102T131337-16ac2a7e.json`.
- `account-preview`: navegador aislado con servidor/proveedores sustituidos;
  cambiar de chat durante respuesta, seguimiento de dos tareas, elegir equipo,
  ruta de voz, ocultar revocado, conservar campos del login y separar cuentas.
  Informe `account-preview-20261102T130008-4701ab88.json`.
- `ios-preview`: diseño, controles, historial, legal interno y anchuras
  393/375/430. Informe final `ios-preview-20261102T131508-f8e37ac9.json`.
- Regresión conversación/WorkSpace/host: 16 pruebas Python pasaron; la suite
  `workspace-chat` volvió a pasar sus tres pruebas. Comprobaciones sintácticas,
  build del sitio y dry-run de ambos Workers pasaron. Workerd local validó
  lectura autenticada con el código final; para el binario local se usó fecha
  CLI 2026-10-30, sin cambiar la fecha de producción 2026-11-02.
- `melodi-cartesia`: 30 pruebas de conversación y voz pasaron con sustitutos;
  informe `melodi-cartesia-20261102T130944-45078257.json`.

Pruebas con servicios reales:

| Evidencia en `tmp/account-remote/` | Resultado y límite |
| --- | --- |
| `real-chat-20261102T124456.json` | Meta → broker → Windows real consultó tiempo de encendido; tarea terminada. |
| `real-voice-20261102T124621.json` | Voz sintética propia → Muse real → Meta → Windows real; tarea terminada. Respuesta Cartesia de 7,6 s con PCM no silencioso. No usa micrófono ni acredita escucha física. |
| `selection-20261102T124830.json` | Un Windows real y segundo host claramente simulado: pregunta antes de entregar, elige destino correcto en rutas chat/voz. El segundo host no ejecutó acciones de SO y fue revocado. No equivale a dos PC físicos. |
| `post-restart.json` | Tras reiniciar, Windows reconectado y vista móvil autenticada en la misma cuenta; política pública actualizada. Sólo consultas de estado, sin inferencia. |
| `post-restart-final.json` | Confirmación posterior al reinicio con las correcciones finales del host; una cuenta y un ordenador conectados. |

Se preservan tres intentos iniciales de chat rechazados antes de alcanzar el
proveedor por `redirect: error`, opción no admitida por fetch de Workers. Se
cambió a `manual` y se rechazan redirecciones sin reenviar credenciales. Otros
tres intentos reales alcanzaron Meta pero quedaron preguntando por un equipo
genérico; se corrigió la selección basada en la elección real del usuario.
Las pruebas posteriores de chat y voz ejecutaron la consulta correctamente.

El primer `account-preview` falló por superposición de las rutas sustituidas
del propio test: `/commands/*` interceptaba `/commands/select`. Se corrigió el
fixture y se conserva `account-preview-20261102T125856-02fb6ff7.json` como fallo.
No se reescribe como éxito ni se atribuye al servicio real.

Consumo conocido de las comprobaciones reales: seis solicitudes de enrutamiento
Meta que sí alcanzaron el proveedor, tres planificaciones del host (incluida una
consulta estructurada de diagnóstico), una conexión Muse ASR y dos peticiones
Cartesia. Los intentos anteriores al fetch no son inferencias. Hay además
autenticación, Cloudflare/DO, documentación y despliegues. Importe monetario no
calculado. Las suites sustituidas no consumieron inferencia pagada.

## Límites de esta entrega

El fuente SwiftUI incorpora login, lista de equipos, conversación UUID, rutas
chat/voz y borrado de la conversación en memoria al cambiar de cuenta. Se añadió
un XCTest para finales ASR numéricos que lleguen fuera de orden. Estas fuentes
siguen **sin compilación Xcode ni prueba en iPhone físico**. No se generó IPA,
respetando la instrucción del usuario de terminar primero el diseño. El
prototipo no equivale a una app instalada. Tampoco se certifica sincronización
de historiales entre dispositivos: se comparte cuenta/control, no todos los
mensajes locales.

Las pruebas de control usaron una consulta del sistema, sin mover/borrar
archivos, instalar software ni cambiar el registro. Su éxito verifica el
recorrido, no todas las tareas posibles del ordenador. El host tiene que estar
abierto, conectado y con los permisos locales que requiera cada capacidad.

Fuentes primarias usadas para la implementación:

- [Alarms de Durable Objects](https://developers.cloudflare.com/durable-objects/api/alarms/).
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/).
- [node:crypto en Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).
- [Tool calling de Meta](https://dev.meta.ai/docs/tool-calling).
- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
