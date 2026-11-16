# Herramienta compartida de lectura de publicaciones

La agente que recibe el encargo conserva su identidad, petición, fuente y destinatario durante la extracción, el análisis, los permisos de colaboración y la entrega. El asistente acusa recibo antes de ejecutar el trabajo. Un estado pendiente no representa una investigación terminada ni un documento enviado.

## Implementación

1. `cloudflare-worker/public-media-client.js` solicita una operación al entrypoint privado `MediaBackend`. Verifica propietario, agente, evento, enlace exacto y operación en cada respuesta.
2. `operations.js` cifra la petición y los resultados en D1; una cola serializada procesa descargas, checkpoints y análisis. Un lease impide dos ejecuciones simultáneas. Las operaciones tienen un plazo de 15 minutos; el procesamiento dispone de hasta 10 minutos.
3. `processor/` descarga publicaciones y reels públicos mediante gallery-dl/yt-dlp, con transporte HTTPS restringido. Extrae imágenes de carruseles, vídeo original, todos los fotogramas hasta el límite declarado, páginas de collages 4×4, audio original y segmentos WAV. Los fotogramas conservan los tiempos PTS del vídeo, incluidos vídeos con tasa variable.
4. Se copian los archivos a R2 privado. Vetsa Sight analiza bytes de imágenes/collages y OCR a través de `MediaModels`, un entrypoint privado del asistente que conserva la clave del proveedor en su entorno original. Whisper transcribe el audio. La IA recibe medios y texto como datos, sin autoridad para cambiar permisos o ejecutar instrucciones contenidas en ellos.
5. YAMNet clasifica habla, música y canto por intervalos, conservando sus coincidencias y confianza. Una transcripción por sí sola nunca prueba que haya voz hablada o que no exista música. La clasificación de baja confianza se presenta como tal. La letra cantada y el audio sin clasificación se separan del diálogo.
6. La agente prepara el informe con fuente, evidencia, tiempos y límites de cobertura. Se mantienen sus permisos vigentes, su dirección de email y los recibos de entrega existentes.

El procesador extrae hasta **3000 fotogramas y 400 MB por operación**, con hasta 20 medios y 300 segundos por vídeo. Para limitar el coste del análisis, el Worker selecciona hasta 32 collages, 20 imágenes estáticas y 10 segmentos de audio, distribuidos entre los medios y sus momentos iniciales/finales. Si no revisó todo, tanto los datos como el informe declaran cobertura parcial. Extraer todos los fotogramas no equivale a analizarlos todos.

**Alcance actual:** enlaces concretos de publicaciones, carruseles y reels. La lectura directa de un perfil completo responde `unsupported_profile`; aún requiere enumerar publicaciones y acreditar su pertenencia al perfil. La extracción anónima puede fallar si Instagram restringe la publicación. No se sustituyen imágenes inaccesibles por contenido inventado.

## Activación

El propietario pospuso el alojamiento el 8 de octubre de 2026. El camino previsto para cuando lo retome es Cloudflare Workers Paid con Containers; no se activa ni contrata ahora. La búsqueda de proveedores gratuitos terminó y este PC no se usa como servidor de producción. Consulte [FREE-HOSTING.md](FREE-HOSTING.md). El procesamiento continuo necesita un host para Python y FFmpeg:

- Cloudflare Containers: `container-host/` prepara una instancia `standard-2`, accesible mediante `ProcessorBackend`, con suspensión tras cinco minutos de inactividad. Requiere Workers Paid y confirmar entonces las tarifas y límites de cómputo, almacenamiento, IA y transferencia. Se necesita Docker compatible o una imagen construida en un registro. La preparación no concede autorización para facturación.
- `processor/Dockerfile` conserva su contrato portátil HTTPS mediante `MEDIA_PROCESSOR_URL` y el secreto `MEDIA_PROCESSOR_TOKEN`. No se busca ahora un servidor alternativo ni se envía el token por WhatsApp o a prompts.

Documentación primaria: [Containers y precios](https://developers.cloudflare.com/containers/platform/pricing/), [despliegue e imágenes preconstruidas](https://developers.cloudflare.com/containers/guides/deploy/), [entrypoints privados](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/).

Orden de conexión, únicamente cuando el propietario retome y autorice la activación:

1. Publicar el asistente con `MediaModels`, manteniendo `PUBLIC_MEDIA_ANALYSIS_ENABLED=false`.
2. Crear `vetsa-public-media-jobs` y su DLQ; aplicar `schema.sql` a `vetsa-cloud-prod`; publicar este Worker sin rutas públicas. Añadir el secreto AES-256 `MEDIA_ENCRYPTION_KEY` mediante stdin protegido, sin reutilizar la clave del proveedor.
3. Publicar el procesador en el host autorizado y conectar el mismo token privado a ambos extremos. En Containers, añadir al backend el service binding `MEDIA_PROCESSOR` hacia `vetsa-public-media-processor`, entrypoint `ProcessorBackend`.
4. Comprobar una extracción real, la procedencia, el análisis con Vetsa y el recibo de resultado. Una respuesta `/health` por sí sola no verifica extracción, visión ni audio.
5. Añadir al asistente `VETSA_PUBLIC_MEDIA` hacia `vetsa-public-media`, entrypoint `MediaBackend`; habilitar `PUBLIC_MEDIA_ANALYSIS_ENABLED=true` únicamente después de esa verificación.

## Encargo pendiente de Lila

La petición del propietario del 8 de octubre autoriza reanudar el informe original y enviarlo por email cuando la herramienta funcione. `PUBLIC_MEDIA_RESUME_EVENT_ID` identifica ese evento original; `public-media-resume.js` lo reanuda una sola vez al activar la conexión. Conserva el cifrado original, enlace, responsable y canal. No reejecuta un documento ya creado, una acción en curso ni una aprobación pendiente; no eleva niveles o concede permisos. La comunicación del envío exige la aceptación confirmada del proveedor.

## Verificación

Pruebas con SQLite real y AES cubren scope, replay, leases, cancelación, checkpoints, procedencia, lectura de bytes, cobertura parcial y tiempos globales de audio. Las pruebas Python generan vídeos reales con FFmpeg y ejecutan el clasificador CPU oficial fijado por hash. Las pruebas de proveedores IA/email utilizan dobles: no constituyen lectura real de Instagram ni entrega al propietario.

`container-host` compila el Worker con `--containers-rollout=none`; esa comprobación no construye la imagen Docker ni arranca un contenedor. La imagen y la conexión de producción deben verificarse al activar el host. Consulte `processor/README.md` para el contrato completo y sus límites.
