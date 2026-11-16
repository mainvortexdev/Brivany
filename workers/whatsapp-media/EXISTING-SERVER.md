# Activación en el servidor existente

Esta opción quedó descartada: el propietario confirmó que no tiene servidor externo y que este PC no se usará como servidor. Se conserva como referencia para una futura infraestructura propia. El despliegue actual debe usar exclusivamente alojamiento remoto gratuito; consulte `FREE-HOSTING.md`.

En un servidor Linux con Docker Compose, `compose.yaml` construye el procesador con FFmpeg, los extractores y el clasificador de audio. Solo escucha en `127.0.0.1:8087`; el proxy HTTPS existente del servidor debe dirigir un hostname dedicado a ese puerto. Se comprobarán puerto, RAM disponible y configuración del proxy antes de cambiar el servidor. No reemplazar sitios, certificados ni servicios existentes.

Guardar un token aleatorio de al menos 32 bytes en el entorno protegido del servidor (o `.env` con permisos 600, excluido del repositorio). Usar el mismo valor para el secreto `MEDIA_PROCESSOR_TOKEN` del Worker `vetsa-public-media`. No compartir su valor en logs, mensajes ni argumentos de comandos. La URL HTTPS se configura como `MEDIA_PROCESSOR_URL`, sin credenciales ni query.

Desde el directorio `media-worker`, ejecutar `docker compose up -d --build` después de configurar el token. El servicio reinicia con Docker, limita CPU/RAM, tiene el sistema de archivos de solo lectura y almacena temporalmente los archivos en `/tmp`. Las rutas de operación y archivos exigen el token privado.

Verificaciones necesarias antes de activar el asistente:

- Imagen construida y servicio sano tras reinicio; permisos y directorio temporal correctos.
- HTTPS válido y rutas privadas inaccesibles sin token.
- Extracción real de la publicación original, con manifest y archivos que coincidan con el enlace.
- Vetsa recibe las imágenes/collages desde R2 privado; Whisper y clasificación de voz/música/canto conservan los tiempos y confianza.
- Recepción del resultado bajo el propietario, agente y evento originales; cobertura parcial declarada si corresponde.

Con la conexión comprobada, activar `PUBLIC_MEDIA_ANALYSIS_ENABLED=true` en el asistente. `PUBLIC_MEDIA_RESUME_EVENT_ID` ya identifica la solicitud original de Lila; su cron la reanuda una sola vez. El documento conserva Lila como responsable y email como canal. No declarar enviado hasta obtener el recibo del proveedor.

El Compose y la imagen Docker aún no se han ejecutado en el servidor elegido. Las pruebas locales del procesador y Workers no sustituyen esa verificación.
