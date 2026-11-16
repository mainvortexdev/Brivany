# Adjuntos compactos y corrección del plan de video

15 de noviembre de 2026. El usuario pidió tarjetas pequeñas, encima del texto,
con miniatura y sin mostrar el peso del archivo. El compositor mantiene su
estética, oculta la barra del textarea y conserva el desplazamiento del texto.
Los videos compatibles muestran un fotograma local; los audios y formatos que
el navegador no decodifica tienen un icono. No se reproduce el video ni se envía
su contenido a un proveedor para crear la miniatura. Cada tarjeta permite quitar
ese archivo de forma individual.

Al enviar, las tarjetas salen inmediatamente del borrador y quedan en el mensaje
del usuario. Los archivos se identifican por selecciones propias del servidor,
no por rutas aportadas por el navegador. El servidor congela la selección del
mensaje antes de clasificarlo; la tarea conserva esos archivos al vaciarse el
borrador. Un mensaje posterior con selección vacía no hereda el video anterior.
Los fallos previos a la aceptación permiten recuperar la tarjeta para un intento
manual. Cambiar de conversación o cuenta limpia el borrador; una subida tardía
no vuelve a incorporarse después de ese cambio. No se borran originales.

El fallo de creación mostrado por el usuario ocurrió después del análisis de
referencia: existe su perfil medido, pero no se llegó a guardar el plan de
escenas. El recibo informa dos llamadas de planificación; no se conserva la
respuesta original del proveedor y no puede afirmarse retrospectivamente si fue
truncamiento o sintaxis inválida. No se certifica su coste monetario.

El planificador ahora detecta respuestas truncadas y transforma el JSON inválido
en un diagnóstico legible. La creación del borrador estaba fuera del bloque que
corregía el plan, de modo que ese fallo saltaba las correcciones existentes.
Ahora entra en ese bloque con un máximo total de tres borradores, feedback y
composición compacta. No repara fragmentos de JSON ni ejecuta código generado.
El análisis de referencia se conserva durante esos intentos. La voz y la
exportación comienzan únicamente después de validar un plan completo. Una
repetición del error termina con un mensaje legible y no una excepción del parser.

## Evidencias y límites

- `computer`: 37 pruebas; transferencia HTTP local y selección congelada por
  mensaje, sin herencia al siguiente y con recuperación manual. Informe
  `tmp/verification/computer-20261115T214258-292d280f.json`.
- `motion-social`: 48 casos, 46 pasados y dos omitidos porque FFmpeg no estaba
  en el PATH del banco. Los nuevos casos comprueban JSON inválido/truncado,
  recuperación con feedback y parada tras tres fallos sin sintetizar voz.
  Informe `tmp/verification/motion-social-20261115T214258-1b63ef2b.json`.
- `chat-media-ui`: nueve comprobaciones en Edge propio sin ventana visible,
  con un clip sintético creado localmente en canvas/MediaRecorder. Comprueba
  miniatura decodificada, tarjeta arriba del texto, ausencia del peso y de barra
  visible, envío sin tarjeta residual, retirada individual y recuperación.
  Informe `tmp/verification/chat-media-ui-20261115T214645-7d1ff337.json`.
- `chat-thinking-ui`, `chat-voice-ui`, `orchestration` y `live-conversation`
  pasan; los dos últimos suman 40 pruebas. Informes de esta ejecución en
  `tmp/verification/`, a las 21:46–21:48 UTC.
- Se inspeccionaron capturas sintéticas a 1280×720 y 390×720. Están en
  `tmp/chat-media-ui/compositor-desktop.png` y `compositor-mobile.png`.
- Reinicio normal de desarrollo, `ready=true`, ninguna operación ocupada y
  nuevo asset servido sin etiqueta de peso:
  `tmp/chat-attachments-ready-20261115.json`.

Las pruebas descritas no hicieron inferencia ni llamadas externas a proveedores.
No se generó un nuevo video con la referencia privada ni se probó su calidad
final: queda para la nueva prueba del usuario. Tráfico de fondo de Brivany y GPU
sin medir. No se adjuntan conversaciones, audio ni video originales a la bitácora.
