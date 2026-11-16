# Melodi centrada en el modo de voz

12 de noviembre de 2026. Corrección del arranque y nueva vista Live en el chat
de escritorio. Se conserva la identidad de Melodi de WorkSpace y el motor
Muse → Meta → Cartesia; no se cambian las voces, las claves ni las preferencias.

## Diagnóstico y corrección

La instalación abierta tenía configuradas escucha y síntesis. Una prueba nativa
local pudo abrir y liberar el micrófono. La conexión real de control con Muse
respondió `ready` en 0,750 s, sin enviar PCM. No se capturó la excepción del
intento original del usuario: estos resultados no identifican su causa exacta.

Se corrigieron fallos reproducibles en el cliente:

- El chat conservaba la configuración de su carga inicial. Cada activación
  consulta ahora el estado actual, mientras desbloquea el audio en el clic.
  La consulta inicial tardía no sobrescribe esa configuración más reciente.
- Live cancelaba a los 12 s, aunque el relay admite 15 s de apertura y otros
  15 s de espera de acuse. El cliente Muse espera hasta 32 s y la operación
  completa tiene un límite de 35 s, con cancelación explícita disponible.
- Un inicio que devolvía `false` podía terminar sin explicación y dejar recursos
  activos. Ahora libera captura y medidor, muestra el fallo y permite reintentar.
- Cancelar invalida la consulta y el arranque pendientes, detiene la respuesta y
  evita que una captura tardía reactive el modo de voz.

## Vista y movimiento

La vista aparece al comenzar la conexión y sitúa a Melodi en el centro del área
de conversación. Se reutiliza el personaje CSS existente, ampliado. Hay estados
de conexión, escucha, preparación de respuesta, habla y error, con controles para
cancelar, terminar, reintentar o volver al chat. El historial y el borrador se
conservan al salir.

Tres ondas circulares se expanden detrás de Melodi, con inicios escalonados.
Se activan cuando el reproductor comienza a programar PCM, no mientras espera
la respuesta o la síntesis. Se detienen al vaciar la reproducción, interrumpir o
cerrar. Es una indicación del reproductor: no mide la salida del altavoz físico
ni representa amplitud o latidos fisiológicos. La alternativa de voz local usa
los eventos de inicio y fin del sintetizador.

Las ondas animan únicamente transformación y opacidad, se pausan con la vista
oculta y quedan estáticas con movimiento reducido. No se añade un bucle de
JavaScript para el personaje ni para las ondas.

## Pruebas y límites

- `tools.verify javascript`: 51 pruebas aprobadas, incluidas espera del PCM,
  cancelación del pulso y liberación de un inicio ASR fallido.
  Informe `tmp/verification/javascript-20261112T153132-c7b18191.json`.
- `tools.verify workspace-chat`: nueve pruebas del puente aprobadas.
  Informe `tmp/verification/workspace-chat-20261112T153328-13cf9c78.json`.
- `tools.verify chat-voice-ui`: Edge propio, WebAudio y AudioWorklet reales,
  micrófono sintético y transportes ASR/modelo/TTS sustituidos. Verifica la
  configuración renovada, error y reintento, acuse válido a los 12,55 s,
  ausencia de ondas antes del PCM, interrupción, cancelación pendiente,
  movimiento reducido, pausa oculta y anchos de 320/390 px y escritorio.
  Informe `tmp/verification/chat-voice-ui-20261112T153328-7dfdec3e.json` y
  capturas sintéticas en `tmp/chat-voice-ui/`.
- Regresiones de historial y recuperación del shell aprobadas:
  `tmp/chat-history-ui/report.json` y `tmp/shell-recovery-ui/report.json`.
- Comprobación nativa previa a la edición, `tools.verify
  workspace-microphone-native`: micrófono físico y WebView2 reales, contexto
  `running`, pista `live`, 48 muestras de nivel y liberación al cancelar. ASR
  desactivado y audio no conservado. No prueba conversación ni altavoz.
  Informe `tmp/verification/workspace-microphone-native-20261112T152632-2628b6f9.json`.
- `tmp/live-handshake-20261112.json`: una conexión real al proveedor a través
  de la instalación abierta. Cero bytes de audio, cero turnos de modelo y cero
  peticiones TTS; importe de esa conexión desconocido. Registrada por separado
  con `tools.activity`, fuera de las suites simuladas.

La primera versión del nuevo banco UI falló al intentar interceptar la carga
del AudioWorklet sin un servidor. Se corrigió el banco para servir el módulo
real por HTTP en loopback. El fallo permanece en
`tmp/verification/chat-voice-ui-20261112T153112-70cfea19.json`; las ejecuciones
posteriores aprobadas no sustituyen ese registro.

Las pruebas locales no solicitaron inferencia real. El tiempo de GPU de los
recorridos gráficos no se midió. Una conversación completa con el micrófono,
ASR, modelo, voz y altavoz reales sigue sin comprobarse en esta entrega.

## Instalación local

Se copiaron únicamente los cinco archivos de chat y motor de voz modificados a
la instalación existente, con respaldo previo bajo `.local/voice-fix-backup-*`.
El informe `tmp/voice-install-patch-20261112.json` conserva las rutas relativas y
los hashes de copia, que verifican integridad y no calidad visual. El reinicio
privado normal confirmó la salida de la instancia anterior y el nuevo arranque
con chat listo, compositor visible e historial disponible (`healthy: true`),
sin iniciar voz. Informe `tmp/voice-installed-startup-20261112.json`. Esto es
una corrección de la instalación local, no una publicación del instalador.
