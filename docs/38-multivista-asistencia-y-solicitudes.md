# 38. Multivista, presentación y asistencia espacial

29 de octubre de 2026. El objetivo integral permanece activo. Esta entrega usa
pruebas locales con datos sintéticos y proveedores sustituidos, sin nueva
inferencia pagada ni ejecución GPU de reconstrucción.

## Habitación multivista preparada

`workers/spatial_room.py` y `workers/spatial_room_modal.py` preparan la ejecución
de VGGT-1B-Commercial sobre 2–8 fotogramas. El lock independiente distribuido está
cerrado: todavía faltan pesos/hashes, licencia, acceso, CUDA construido, SDK
autenticado, despliegue y presupuesto. El flujo de objeto anterior no acepta este
contrato; falta ligar el despacho durable y el ingreso del resultado de habitación.

El runner carga un checkpoint local con `strict=True` y emplea las cabezas
oficiales de cámaras y profundidad; no descarga pesos. La preparación comprueba
hashes, orden temporal y reserva monetaria antes de producir una petición privada.
La petición contiene PNG en bytes y no puede devolverse al navegador ni registrarse
como evidencia. Sin reserva la preparación sólo devuelve preflight.

La geometría se construye por retroproyección `Rᵀ(p−t)` desde cámaras OpenCV,
con cambio de base `[x,-y,-z]` para el visor. Triangula muestras contiguas dentro de
cada vista, excluyendo padding, confianza baja, profundidad inválida y saltos de
profundidad. Exporta posiciones, normales, RGBA e índices GLB, con muestreo
adaptativo y límites de 180 000 vértices/300 000 triángulos. Conserva cámaras y
estadísticas de muestras omitidas. No fusiona vistas, rellena huecos, inventa
paredes, calibra escala métrica, separa instancias o asigna física.

Pasaron catorce pruebas numéricas y tres controles de render con arrays/cámaras
conocidos, GLB sintético y WebGL real. La escena de prueba está identificada como
generada: no acredita una habitación reconstruida ni fidelidad profesional.

Fuentes oficiales revisadas: [modelo comercial](https://huggingface.co/facebook/VGGT-1B-Commercial),
[invocación fijada](https://github.com/facebookresearch/vggt/blob/a288dd0f14786c93483e45524328726ab7b1b4ce/demo_colmap.py),
[convenciones geométricas](https://github.com/facebookresearch/vggt/blob/a288dd0f14786c93483e45524328726ab7b1b4ce/vggt/utils/geometry.py)
y [preprocesamiento](https://github.com/facebookresearch/vggt/blob/a288dd0f14786c93483e45524328726ab7b1b4ce/vggt/utils/load_fn.py).
La revisión de fuentes no demuestra compatibilidad del checkpoint real, todavía
sin descargar.

## Presentación inmobiliaria local

Espacios permite guardar hasta doce vistas con título, nota y objeto relacionado,
editar/reordenar/eliminar puntos y sustituir una cámara por la vista actual. El
recorrido se guarda con revisión propia y vínculo a la revisión de escena. Los
cambios concurrentes se rechazan. La presentación recorre las cámaras con botones
y teclado; deshabilita edición y física durante el recorrido sin cambiar geometría.

Son vistas de la geometría disponible, no una captura ni recorrido fotorealista
verificado. Se guarda en `presentation.sqlite3`; la conservación en respaldo,
proyectos portátiles y enlaces públicos sigue pendiente. La presentación de una
carpeta portátil no se anuncia como admitida. Pasaron ocho pruebas del servicio y
siete controles de navegador con GLB/SQLite/HTTP/WebGL reales y escena generada.

## Melodi dentro de Espacios

El contexto de conversación se construye en el servidor desde escena, revisión
y objeto seleccionado; el navegador no puede sustituirlo. Incluye procedencia,
escala y limitaciones. Recibe metadatos, no fotografías o cámara, y no inventa
marca/modelo, manuales, fuentes, medidas o realismo. Se limita el tamaño del
contexto y los intentos por proceso; el contador no es presupuesto persistente.

Seleccionar, enfocar e identificar una etiqueta son comandos deterministas
locales. Una orden numérica completa puede preparar un movimiento: la interfaz
presenta coordenadas/unidades/revisión y exige aplicar explícitamente. Usa el
historial existente para Deshacer. La propuesta vence, es de uso único y rechaza
una edición concurrente. El modelo no tiene herramientas ni interpreta su propia
respuesta como autorización para modificar el espacio.

Texto y voz reutilizan Meta, Muse y Melodi en Cloudflare con consentimiento e
interrupción explícitos. Abrir no llama modelos ni activa el micrófono. El contexto
de carpetas portátiles y la medición de voz física siguen pendientes. Pasaron
quince pruebas de servicio/HTTP y seis controles de navegador con modelo
sustituido. La primera prueba de conversación integrada detectó `Illegal invocation`
al desregistrar temporizadores de navegador; se corrigió el enlace de `clearTimeout`
en el presupuesto compartido y los recorridos de Espacios/Sous posteriores pasaron.

## Solicitudes del chat propio

El receptor admite opcionalmente `--allow-action-requests`, junto al permiso de
respuesta y `chat_requests_enabled` en Conexiones. Un comando explícito puede
preparar una nota, recordatorio local, consulta de agenda/Drive/Gmail, evento o
borrador de correo. Fechas requieren ISO con zona; no se adivinan expresiones como
«mañana» o «en un rato». El texto normal conserva la conversación sin activar
acciones. Los comandos no necesitan inferencia de un modelo.

El mensaje debe pasar firma, tiempo, deduplicación y consentimiento del chat propio.
Los campos solicitados se guardan en una base privada distinta de la bitácora;
no se conserva el mensaje original ni el teléfono. Conexiones los muestra para
revisar y confirmar localmente. Agenda/correo/Drive siguen el diario de aprobación
exacta existente; notas/recordatorios tienen claim durable y revisión. Una escritura
incierta no se repite. El mensaje WhatsApp no concede autorización remota.

No se envían acciones de cuenta automáticamente, no se mandan correos, no se
ejecutan comandos del sistema ni se han creado recordatorios por una cuenta real.
El usuario aún necesita revisar en su ordenador: autorización remota y control del
equipo siguen pendientes. Tampoco hay entrega programada WhatsApp habilitada por
esta pantalla. Quince pruebas de solicitudes y diecisiete del receptor aprobaron
con SQLite/HMAC/HTTP reales y transportes sustituidos. La interfaz de solicitudes
está implementada pero su recorrido completo aún requiere un E2E específico.

## Evidencia

- `docs/verification-history/spatial-room-20261029T210957-08cc6d7c.json`.
- `docs/verification-history/spatial-room-render-20261029T210957-79244e70.json`.
- `docs/verification-history/presentation-20261029T212212-3e67315a.json`.
- `docs/verification-history/presentation-ui-20261029T212212-29bf6cf1.json`.
- `docs/verification-history/spatial-assistant-20261029T211308-fbc507f4.json`.
- `docs/verification-history/spatial-assistant-ui-20261029T213455-0679492c.json`.
- `docs/verification-history/chat-requests-20261029T213134-52b0cff2.json`.
- `docs/verification-history/whatsapp-gateway-20261029T212443-fc87936b.json`.
- `docs/verification-history/python-20261029T213625-d9d73118.json`: 588 pruebas Python
  aprobadas en el estado final registrado.
- `tmp/runtime-hito38.json`: disponibilidad HTTP local tras reemplazar únicamente
  la instancia de desarrollo que inició esta tarea, comprobando antes su PID y
  línea de comando. No se iniciaron conversaciones ni trabajos remotos.

La infraestructura de Modal, geometría numérica y pruebas sustituidas no reemplazan
reconstrucción real, evaluación de fidelidad, precisión de planos, física, cuentas,
hardware o traducción audible de 500 ms. Estos requisitos siguen pendientes.
