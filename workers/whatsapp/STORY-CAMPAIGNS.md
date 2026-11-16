# Campañas semanales de historias de Melodi

La API de Vetsa expone `spaik-image` para generación/edición de imágenes. `spaik-vision-v2` devuelve 410 y no se usa. La clave del proveedor se mantiene solo como secreto del Worker `vetsa-intelligence-api`; el modelo base nunca se menciona en las respuestas de Melodi o Melodi.

## Activación pendiente

En el proyecto hermano `Vetsa-Intelligence/cloudflare-worker`, configurar el secreto sin guardarlo en archivos ni mensajes:

```powershell
npx wrangler secret put KIE_API_KEY
```

La variable interna no secreta `KIE_IMAGE_MODEL` está configurada como `nano-banana-pro`; el nombre público continúa siendo **Spaik Image**. `GET https://api.vetsa.es/health` debe mostrar `imageReady: true`. Sin clave, la campaña falla en modo cerrado y no se programa.

La publicación de historias comienza en modo **aprobación previa**. Melodi crea la imagen con Spaik Image, envía la vista previa por WhatsApp y solo publica después de que el propietario la apruebe. Si el propietario dice que ya no pida confirmación para publicar historias, se guarda una preferencia exclusiva de su número y las futuras historias se publican a la hora programada tras enviar la vista previa. Puede volver a activar la aprobación previa por WhatsApp. La preferencia no afecta publicaciones del feed, reels ni respuestas.

Daniel envía una o más fotos suyas a Melodi por WhatsApp con la instrucción de guardarlas como referencias para las historias. Se almacenan en R2 privado, no en el sitio público. Luego pide: «Melodi, crea y publica historias para Instagram durante toda la semana». Se crean 28 espacios, desde el día siguiente: 08:30, 11:30, 15:30 y 19:30 en `America/Santo_Domingo`. La primera y segunda historia forman el bloque matutino; tarde y noche tienen una cada una. Los cuatro pasos diarios son filtro, contexto, valor y cierre.

El cron genera la imagen hasta una hora antes. Solo los espacios con una imagen válida se someten a publicación. Una solicitud fallida se marca `needs_review` y no se reintenta automáticamente, para evitar cargos duplicados en un fallo ambiguo. Los identificadores de operación de Instagram se guardan antes de solicitar la publicación; si la cola tarda, el cron reconcilia el estado sin crear otra operación. El propietario puede pedir estado o pausar la campaña por WhatsApp.

## Límites conocidos

- La imagen generativa puede cometer errores de texto o alterar rasgos. No se garantiza fidelidad perfecta; requiere una prueba real y revisión de las primeras imágenes antes de confiar una campaña completa.
- La integración existente de Instagram publica fotos como historias. No envía stickers nativos de encuesta, preguntas o enlaces. La pregunta y CTA se expresan visualmente en la pieza; la interacción nativa debe agregarse manualmente si se necesita.
- Nunca se publica sin cuenta de Instagram y credenciales operativas, referencia del propietario y clave de imágenes. La campaña no usa fotos de perfil ajenas como referencia.
- El contenido evita métricas, resultados de clientes o actividades del día no proporcionados por Daniel. Las recomendaciones de horarios son un experimento editorial, no una afirmación garantizada sobre el algoritmo.
