# Prueba de Soniox: traducción voz a voz y clonación

11 de noviembre de 2026. Prueba real **no completada**: la cuenta no tiene saldo.

## Qué ofrece Soniox según su documentación

- **Transcripción con traducción en el mismo flujo.** Un WebSocket
  (`wss://stt-rt.soniox.com/transcribe-websocket`, modelo `stt-rt-v6`) transcribe
  y traduce a la vez con `translation: {type: one_way, target_language: en}`.
  Cada token lleva `translation_status` (`original`/`translation`). Dice que la
  traducción puede empezar antes de que termine la frase, sin cifras de latencia.
- **Voz en tiempo real** (`wss://tts-rt.soniox.com/tts-websocket`, `tts-rt-v2`):
  PCM 24 kHz, velocidad 0,7–1,3, voces multilingües.
- **Clonación:** `POST /v1/voices` con un clip de hasta 2 min crea una voz
  persistente (UUID) que se procesa «en segundos». Máximo 20 voces por
  organización. No admite referencia en línea.
- **Voz a voz traducida en una sola API:** no existe. Su guía «STS translation»
  encadena los dos WebSockets (STT+traducción y TTS) en el código de la
  aplicación. Aun así son dos pasos en lugar de los tres actuales
  (Muse → Meta → Cartesia).
- **Precio publicado:** STT en tiempo real 0,12 USD/h con la traducción
  incluida; TTS unos 0,70 USD por hora de voz generada. Precio de la clonación no
  publicado.

## Resultado

Se preparó un clip sintético en español (voz Helena de Windows, 12,1 s) y un
script con tope de llamadas: transcripción y traducción a ritmo real, clonación
de esa voz, síntesis en inglés con el clon y con la voz «Daniel», y borrado de
la voz.

La primera conexión respondió `402 organization_balance_exhausted`:
«Organization balance exhausted. Please either add funds manually or enable
autopay.» El script se detuvo ahí; no se creó ninguna voz ni se sintetizó audio.
Una segunda conexión de diagnóstico, de 80 ms de silencio, confirmó el mismo
error. Consumo: ninguno conocido, ya que el servidor rechazó por falta de saldo.
La clave funciona: la autenticación fue aceptada y el rechazo es de saldo.

Pendiente: repetir el mismo script cuando la cuenta tenga saldo. Clip y script
reutilizables en `tmp/soniox-probe-20261111/` (no versionado).
