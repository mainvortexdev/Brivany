# Equipo de marketing de Melodi

- **Melodi** investiga perfiles y contenidos que estén disponibles públicamente. Informa señales visibles, formatos y patrones con enlaces; no presume acceso a métricas privadas de competidores.
- **Melodi** analiza las métricas que la cuenta profesional conectada permita consultar: contenido reciente, Reels y Stories vigentes. Avisa cuando un dato no está disponible. El análisis de anuncios queda pendiente de conectar la cuenta publicitaria y sus permisos.
- **Melodi** inicia ambas tareas en paralelo y sintetiza sus conclusiones, recomendaciones de contenido y una forma medible de probarlas. Se activa cuando Daniel pide revisar un perfil, una estrategia o el rendimiento de Instagram por WhatsApp.

## Configuración de investigación pública

La clave no va en `wrangler.jsonc`, en el código ni en un mensaje de WhatsApp. Cuando exista una clave de búsqueda, guardarla como secreto desde este directorio:

```powershell
npx wrangler secret put EXA_API_KEY
```

Wrangler solicitará el valor de forma interactiva. Sin ese secreto, Melodi aún puede revisar las métricas conectadas y Melodi indicará con claridad que la búsqueda pública está pendiente.

La investigación usa material público indexado y puede no encontrar cada post o perfil. Los datos de Insights dependen de la autorización actual de Meta. No se infieren alcance, retención, conversiones ni rendimiento de anuncios de otra cuenta a partir de likes públicos.
