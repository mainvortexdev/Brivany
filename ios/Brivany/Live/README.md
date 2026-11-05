# Melodi Live nativo

SwiftUI / AVAudioEngine, iOS 17 o posterior. Configuración suministrada por la
app: `MobileConfiguration(baseURL: URL, token: String)`. El token pertenece al
dispositivo vinculado; las credenciales de Meta y Cartesia no entran en el IPA.

`BrivanyLiveSession(configuration:)` expone `state`, `stateText`, `transcript`,
`reply`, `inputLevel`, `outputLevel`, `isMuted`, `start()`, `stop()` y
`toggleMute()`. `BrivanyLiveView(session:)` muestra la llamada y controles.

La captura solicita el micrófono explícitamente. VoiceChat usa procesamiento
de voz de iOS; AVAudioConverter calcula la relación entre la frecuencia real
del dispositivo y 24 kHz. Se emiten paquetes PCM16 mono de 80 ms sin retener
el buffer de AVAudioEngine después del callback. No se solicitan permisos de
Speech de Apple: ASR viaja al gateway por WebSocket.

El gateway HTTPS debe ofrecer `/health`, `/v1/asr` (WSS), `/v1/chat` (NDJSON) y
`/v1/speech` (PCM firmado little endian, mono 24 kHz). No hay reintentos de
inferencia. La respuesta hablada comienza por frases mientras termina el texto;
la cola de reproducción del dispositivo es acotada. La interrupción requiere
palabras reconocidas y no sólo energía. Pausar por interrupción, cambio físico
de ruta, desconexión de audífonos o segundo plano cierra los recursos, sin
reactivar el micrófono por sorpresa.

Pruebas XCTest con audio/transporte sustituidos verifican framing, PCM con
bytes partidos, finales ASR, NDJSON truncado, cancelación, silencio de micrófono,
respuestas tardías e interrupción. Deben compilarse y ejecutarse en macOS/iOS
simulador; Windows no certifica el build. La revisión de hardware y calidad
acústica permanece separada.

Referencias primarias consultadas:
- https://developer.apple.com/documentation/avfaudio/avaudioconverter
- https://developer.apple.com/documentation/avfaudio/avaudioapplication/requestrecordpermission(completionhandler:)
- https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct
- https://developer.apple.com/documentation/foundation/urlsessionwebsockettask
