# Host privado del procesador

Worker preparado con `@cloudflare/containers` 0.3.7 y Wrangler 4.127.1, según el schema instalado. `ProcessorBackend` acepta únicamente rutas privadas autenticadas de procesado, archivos y salud. El default público devuelve 404 para operaciones. El token se guarda con `wrangler secret put MEDIA_PROCESSOR_TOKEN` mediante entrada protegida y se pasa al proceso Python por variables del contenedor.

Una instancia `standard-2` (1 vCPU, 6 GiB RAM), máximo una, recibe el tráfico de la cola serializada de este propietario. El procesamiento y la posterior descarga usan el mismo nombre de instancia. Los archivos locales son temporales: D1 y R2 conservan el estado y los archivos copiados fuera del contenedor. La instancia se suspende tras cinco minutos sin tráfico.

No está desplegado y no debe activarse ahora: el propietario pospuso el alojamiento el 8 de octubre de 2026 y prevé retomarlo con Workers Paid. La búsqueda de proveedores gratuitos terminó. Este PC no se usa como servidor de producción. La compilación del Worker y sus pruebas de acceso no verifican la imagen Docker ni su arranque; consulte `../FREE-HOSTING.md`. No contratar el plan ni activar el flag del asistente hasta que el propietario retome el paso y se verifiquen la extracción y el análisis reales.

Después de habilitar el host, desde este directorio: `wrangler deploy --keep-vars --strict`. Una imagen previamente construida en un registro puede sustituir la ruta al Dockerfile. Añadir al backend `MEDIA_PROCESSOR` apuntando al servicio `vetsa-public-media-processor`, entrypoint `ProcessorBackend`, y configurar el mismo token.

Referencias: [Container class](https://developers.cloudflare.com/containers/api/container-class/), [despliegue](https://developers.cloudflare.com/containers/guides/deploy/), [precios](https://developers.cloudflare.com/containers/platform/pricing/).
