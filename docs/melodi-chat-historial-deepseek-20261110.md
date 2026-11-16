# Chat persistente y actividad de Melodi

Se conserva el diseño compacto de Brivany y se incorpora un índice de
conversaciones en la barra lateral. Cambiar de módulo, abrir Ajustes, crear otra
conversación y reiniciar la app conserva los mensajes, borradores, tareas y
referencias a los resultados.

El historial se guarda en SQLite dentro de la carpeta de datos del usuario.
Tanto el contenido como los títulos del índice se cifran con Windows DPAPI para
el usuario actual. Los registros largos se comprimen y dividen antes de cifrar;
el índice no necesita descifrar todas las conversaciones. La vista carga los
últimos 120 mensajes y permite mostrar los anteriores; no los elimina al cambiar
de vista. Los límites actuales son 5.000 mensajes por conversación, 2.000 tareas,
8 MB por registro y un índice de 1.000 conversaciones.

## Actividad visible

Las confirmaciones de tareas creativas explican el alcance y los siguientes
pasos. Los ejecutores registran resúmenes públicos del plan, las decisiones
extraídas de la composición validada y las herramientas realmente ejecutadas.
No se muestra razonamiento privado ni se simula una secuencia de trabajo.
Las tareas de equipo muestran sus agentes y el estado de cada uno.

La línea de actividad usa el tiempo real transcurrido; al finalizar indica
«He trabajado durante…» y permite desplegar el registro. Los estados activos
tienen un brillo que recorre la frase. El texto se revela progresivamente con
un fundido breve. Se respeta la preferencia de movimiento reducido.

Los videos completados aparecen directamente en el chat, con controles nativos
y sin el panel o título decorativo. La ruta permite seleccionar el archivo en
el Explorador. La lectura de la vista previa utiliza un ticket privado de un
solo uso que caduca a los 60 segundos y se emite desde el puente nativo, sin
habilitar control del ordenador. El nombre del modelo no aparece en el chat.

## Proveedor de conversación

El chat general usa `deepseek-ai/DeepSeek-V4-Flash` en SiliconFlow a través del
relay privado `brivany-melodi-chat` en Cloudflare Workers. El relay exige un
secreto de cliente, fija el modelo, limita la entrada y la salida y transmite
la respuesta por streaming. No registra mensajes ni respuestas. Las trazas
operativas no incluyen el contenido del chat.

La clave de SiliconFlow y el secreto de cliente se conservan en un registro
DPAPI privado de Brivany. El secreto del proveedor también está configurado
mediante Workers Secrets; no se incorporó al código ni al archivo de Wrangler.
La sesión de desarrollo disponible no tenía permisos para AI Gateway; se usó
Workers para realizar el paso por Cloudflare solicitado. Meta sigue disponible
para los planificadores y las capacidades visuales existentes.

Una prueba real de conversación atravesó Brivany → Cloudflare → SiliconFlow y
recibió una respuesta completa en 1,64 s. Es una muestra breve, no un benchmark
de latencia. No se midió su importe facturado. El informe local está en
`tmp/melodi-deepseek-real.json`, sin credenciales.

Fuentes técnicas: [SiliconFlow Chat Completions](https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions),
[Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Contexto y correcciones del creador

Melodi recibe fichas de Brivany, Cognira Desktop y Vetsa AI basadas en el código
y la descripción de sus proyectos. Las fichas distinguen una descripción de
producto de un rendimiento medido. El chat recibe la ruta y el estado de los
resultados observados, por lo que puede contestar dónde se guardó una entrega.

El primer tráiler del usuario se conservó en su carpeta original. Su duración
real era 30 segundos aunque la petición indicaba un minuto. Se corrigió la
interpretación de minutos y se exige el formato horizontal o vertical solicitado.
No se regeneró ese video automáticamente. Se añadió una conversación marcada
como recuperada desde el proyecto y el archivo existentes; no se presenta como
una recuperación íntegra de los mensajes que se habían perdido.

## Validación

- Pruebas Python: historial cifrado, reapertura, varios chats, conversaciones
  largas sin truncado, credenciales privadas, streaming compatible, creación
  por escenas, duración/formato, progreso público, orquestación y restauración.
- Navegador real con servicios simulados: actividad, agentes, borrador en
  Ajustes, nueva conversación, selección de conversaciones anteriores y recarga.
  Verifica el MP4 embebido con controles y la acción de la ruta al Explorador.
- Relay: tres pruebas locales de autorización, límites y transmisión al proveedor.
- La carga local guarda un manifiesto reversible y conserva la versión y los
  datos del usuario. Su estado final se registra tras la comprobación instalada.

Estado final: 97 pruebas Python aprobadas, tres pruebas del relay y el recorrido
de navegador con servicios simulados aprobado. La comprobación en la instalación
real restauró una conversación con dos mensajes, mostró un reproductor dentro
del chat y verificó cero etiquetas de modelo. Informe:
`tmp/chat-native-installed-v2.json`. La app se volvió a abrir normalmente.

La persona de Melodi y las actualizaciones de sus ejecutores usan primera
persona. Los nombres de productos, agentes y las atribuciones de autoría en
los metadatos se conservan como identificadores, no como una voz externa.

El último respaldo del ajuste de persona está en
`.local/motion-runtime-backups/20261110T042401Z-1ca89b05/manifiesto.json`.
