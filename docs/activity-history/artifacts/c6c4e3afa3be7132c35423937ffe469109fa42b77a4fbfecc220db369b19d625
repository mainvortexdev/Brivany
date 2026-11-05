# Traducción auditiva · recepción nativa confirmada · 4 de noviembre

El usuario informó silencio y «No se pudo iniciar el enlace sincronizado» en
YouTube. La revisión anterior había comprobado por separado el navegador con
servidor sustituido y el proveedor con una fuente nativa; no cubría todo el
trayecto entre ambos. No se certificó la sesión personal de YouTube.

## Fallo reproducido y corrección 0.4.1

Una pausa artificial de 650 ms en la lectura nativa, mientras el cliente enviaba
PCM cada 80 ms, reprodujo exactamente el mensaje genérico. Los ACK del cliente
confirmaban `socket.send`, no la recepción por Brivany. Los bloques acumulados
se consumían juntos y el limitador de 300 ms los rechazaba como aceleración.
El ensayo demuestra este defecto de transporte, sin establecer por sí solo que
fuera la causa de aquella sesión personal.

La extensión espera ahora `audio-ack` del proceso nativo, con secuencia ordenada
y cuatro bloques de 80 ms pendientes como máximo. La ruta con ACK admite un
margen acotado de 400 ms para esos bloques y jitter; conserva el rechazo de
inundaciones reales. Las rutas anteriores mantienen su margen de 300 ms.
La cola no omite voz para ocultar retrasos. Pausar el video sigue siendo una
discontinuidad explícita, que retira los bloques todavía no enviados.

La conexión declara protocolo de video 2 y disponibilidad de traducción
progresiva antes de capturar. Una app antigua en memoria recibe instrucciones
de reinicio. La preparación del audio tiene un plazo propio de 20 segundos.
Se conserva el primer error y no se sobrescribe al cerrar el socket. Los errores
de entrada conocidos se muestran de forma específica; los inesperados conservan
sólo etapa, código y clase, sin copiar texto del video o datos del proveedor.

El diagnóstico de salida expone contadores de bytes y posición del dispositivo
bajo demanda, sin PCM, texto, credenciales o identificadores de dispositivo.

## Pruebas y límites

- Reproducción local previa: `tmp/selected-video/native-stall-before.json`.
  Sin proveedores, fallo conservado.
- `tools.verify selected-video`: 14 pruebas. Incluye pausa de lectura de 650 ms,
  ACK ordenados, inundación real rechazada y preparación agotada diferenciada.
- `tools.verify workspace-sync-extension`: 33 pruebas. Confirma que enviar no
  produce un ACK, que una app antigua se rechaza antes de capturar y que el
  primer error no es sustituido por el cierre de conexión.
- `tools.verify sync-relay`: 24; `workspace-translation`: 14;
  `river-translation`: 34. Los avisos de desconexión del fixture durante el cierre
  no cambiaron su resultado aprobado.
- Brave real aislado, dos videos propios: `tmp/selected-video/probe-1793769509805.json`.
  Mantiene 1.600 ms de demora de conexión, 450 ms de bloqueo del renderer y añade
  650 ms de retención del ACK nativo. Selección, audio separado, subtítulos,
  cancelación y YouTube único bajo fixture propio aprobados; sin llamadas externas.
- Ensayo completo real anterior a la corrección:
  `tmp/selected-video/native-extension-1793769133007.json`. Comprobó eventos de
  transcripción/traducción con la app real, pero no certificaba salida audible.
- Ensayo completo real tras reiniciar con protocolo 2:
  `tmp/selected-video/native-extension-1793769616504.json`. Brave aislado y
  extensión con conexión nativa real, Muse/Meta/Cartesia y WinMM. Dos muestras
  españolas sintéticas propias reutilizadas, 19 segundos como máximo, sin
  micrófono ni regeneración de fuentes. Texto progresivo y traducción recibidos;
  215.040 bytes traducidos entregados y consumidos según la posición de WinMM,
  sin error. Primer audio observado a 7,017 s desde la activación del ensayo,
  que programa la primera voz dos segundos después de preparar su video.
  No representa una garantía de latencia menor de seis segundos.

Los dos ensayos completos usan APIs reales; el importe y número agregado de
llamadas no se midieron y permanecen desconocidos. No se adjuntan audio, video
ni transcripciones originales a la bitácora. Longitudes de texto y contadores
no certifican fidelidad semántica. La posición de WinMM prueba consumo del
dispositivo, no que una persona lo escuchara físicamente.

La versión 0.4.1 se entrega en código y carpetas de distribución existentes,
con ID estable. Los ZIP anteriores se conservan. Brivany se reinició con la
corrección; recargar la extensión y la pestaña del video sigue siendo necesario.
El control de Brave personal se detuvo al no poder verificar su URL de forma
segura; no se continuó por otro mecanismo ni se utilizó su perfil en las pruebas.
