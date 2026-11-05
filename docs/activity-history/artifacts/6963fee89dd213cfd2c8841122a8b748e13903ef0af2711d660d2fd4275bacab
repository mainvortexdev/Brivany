# Dictado del chat y una sola instancia de WorkSpace

3 de noviembre de 2026. Dos correcciones solicitadas durante la misma revisión.

## Micrófono del input

El botón del input iniciaba Live completo, incluida la preparación de TTS. Ahora
inicia dictado con el mismo propietario del micrófono que usa el chat. Live sigue
disponible en «Hablar con Melodi»; ambos modos se excluyen entre sí.

El input se transforma en una barra redondeada con cancelar, ondas del micrófono,
detener y enviar. La visualización recibe los 48 valores del analizador acústico,
con interpolación y atenuación lateral; no es una animación de voz inventada.
Detener permite revisar el texto; cancelar conserva el borrador anterior; enviar
espera el final de ASR. Si el cierre supera 3,5 s o falla, conserva el borrador y
pide revisarlo, sin enviarlo automáticamente. Se ignoran finales repetidos y
resultados tardíos después de cancelar. Cerrar el panel termina el dictado.

La prueba nativa reprodujo el bloqueo con la ventana principal oculta. El permiso
WebView2 quedaba pendiente. El clic explícito de WorkSpace concede únicamente
esa solicitud de micrófono, para el origen local de la app y durante una ventana
de 12 s; no persiste el permiso en el perfil ni cambia los permisos de Windows.
Se usa [PermissionRequested de WebView2](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2permissionrequestedeventargs).

Pruebas diferenciadas:

- UI real con micrófono/ASR sustituidos: ondas por muestras, borrador, cancelar,
  detener, envío explícito, duplicados, permiso denegado, TTS no disponible y ASR
  incompleto. Dictado a 390, 320 y 280 px; chat a cinco anchuras. Aprobado.
- WebView2 real con la app principal oculta y micrófono físico: AudioContext en
  ejecución, pista activa y 48 muestras; liberación al cancelar. ASR desactivado
  expresamente y sin grabar audio ni realizar solicitudes de inferencia.
- Muse real con entrada sintética propia de la voz offline de Windows, por
  getUserMedia y el worklet PCM de producción: conexión en 1,346 s, tres finales
  recibidos y cierre en 0,194 s. Se reconocieron las tres palabras de control.
  El micrófono físico no fue usado en esa prueba. Un primer intento de conexión
  falló; se conserva su informe separado. Dos intentos Meta conocidos, coste
  monetario desconocido. No se adjuntan audio ni transcripciones a la bitácora.
- Nueve pruebas del puente, 49 pruebas JavaScript y la integración nativa de
  chat, Live, ondas y resultados glass, aprobadas. Se conservan los fallos de
  sincronización y selectores de las primeras versiones de las pruebas.

## Duplicación de WorkSpace

Durante el reinicio de prueba quedaron dos procesos de Brivany abiertos. Se
cerró el anterior verificando su PID, ventanas propias y registro AppBar, y se
liberó su reserva de pantalla.

El arranque comprueba una instancia exclusiva antes de iniciar el servidor,
servicios o ventanas. Windows utiliza un mutex y eventos locales de sesión;
macOS/Linux tienen bloqueo de archivo e IPC Unix en un directorio privado del
usuario. Una segunda apertura avisa a la instancia existente para abrir la app
o mostrar WorkSpace y termina. El sistema operativo libera el bloqueo al cerrar
el proceso. El inicio de WorkSpace también se serializa dentro del proceso para
que los eventos simultáneos de inicio/minimización no creen dos juegos de vistas.

Tres pruebas locales en Windows verificaron ocho contendientes con un solo
propietario, activación entre procesos, reapertura después del cierre y ocho
solicitudes internas con una sola barra. Dos aperturas reales posteriores del
entry point devolvieron código 0 y conservaron el PID y handle de la barra
existentes. Reserva final comprobada: 40 px, con una sola barra visible. La rama
POSIX está implementada; no se certifica ejecución física en macOS/Linux.
