# Identidad, agentes y presentación del chat · 15 de noviembre de 2026

## Implementación

Melodi recibe un perfil privado cifrado con DPAPI y reconoce al propietario
local como su asistente personal. El nombre no es una constante global: una
cuenta diferente no hereda el perfil local y un perfil vinculado sólo se usa
con su cuenta. El perfil no concede permisos ni sustituye la voz seleccionada.
Se conserva human-skills. La comprobación real fue una consulta escrita al
proveedor de conversación configurado, sin voz ni acciones de ordenador. El
informe conserva sólo resultados booleanos y tiempo, sin la conversación.

Se creó una vista nativa de simulación separada, con cuatro especialistas y
componentes reales del chat. No ejecuta encargos ni llama a proveedores. Se
corrigieron una carrera de carga del iframe y la exposición recursiva del
objeto de ventana al puente de pywebview; la ventana se guardó como atributo
privado. El usuario pidió cerrarla al terminar de definir la presentación.

El estado Pensando incorpora tres puntos escalonados. Los nuevos mensajes de
Melodi, incluso si llegan completos, conservan escritura progresiva y fundido
suave de sus fragmentos al actualizarse el chat. El historial restaurado se
muestra directamente; movimiento reducido evita las animaciones. La escritura
es local y no introduce espera adicional en el proveedor.

Imagen y video muestran una miniatura negra, cuatro círculos y porcentaje en
la esquina inferior derecha. El porcentaje es una **estimación por etapas
observadas**, no una medición interna del generador: empieza en 1, queda por
debajo de 100 mientras trabaja y sólo se declara 100 con resultado verificado.
Se retiraron las leyendas visibles del interior por indicación del usuario.
La adaptación conserva el crédito del CSS aportado de AbanoubMagdy1/Uiverse.

## Corrección posterior indicada por el usuario

Se sustituyeron los compañeros recoloreados por las formas Blobatar existentes.
Cada función tiene una semilla fija: redacción conserva su cara y color aunque
cambien tarea, conversación, equipo o reintento. Funciones distintas conservan
caras distintas; dos tareas de redacción comparten diseño.

La nueva barra aparece en la esquina superior derecha del chat con tantos
agentes activos como corresponda, hasta cuatro. Si hay más, «Mostrar todos los
agentes» abre un modal con el equipo completo. Hover, foco o pulsación permiten
consultar su función, encargo y fase. El modal admite Escape, cierre exterior,
restauración del foco y desplazamiento en ventanas pequeñas. Los textos se
insertan como datos con textContent y se respeta la CSP existente.

El botón de ocultar guarda una preferencia visual local y conserva el trabajo.
«Mostrar agentes» recupera el equipo actualizado. En ese modo se omiten los
avisos rutinarios de fin de agente; las solicitudes de intervención o aprobación
siguen disponibles. No se envía cancelación ni se cambia autorización alguna.

Los ojos conservan su pose sin saccades ni desplazamiento independiente; sólo
parpadean. Todo el personaje flota con giro de ±1,2 grados y desplazamiento de
menos de dos unidades SVG en un ciclo individual de 8–11 segundos. Se conserva
la pausa por visibilidad, estado, preferencias y movimiento reducido.

La miniatura ya no se desmonta ni se mueve entre contenedores en cada consulta.
Filas y tarjetas del chat conservan sus nodos y la rotación mantiene una única
animación de cinco segundos, sin escala ni reinicio por progreso. La geometría
reserva 260 × 260 px para imagen y 210 × ~373,3 px para video; se ajusta
proporcionalmente al ancho disponible en ventanas pequeñas. La escritura y los
cambios de estado no alteran sus dimensiones.

## Verificaciones

Todas las suites de esta tabla son locales y usan trabajos, servicios o
proveedores sustituidos. Los recorridos de navegador corrieron en Edge propio
sin una ventana visible ni entradas Windows. No prueban tareas de agentes reales
ni la calidad semántica de un generador. Tiempo GPU e importe sin medir.

| Suite | Resultado | Informe |
| --- | --- | --- |
| chat-presentation | 6 casos | `tmp/verification/chat-presentation-20261116T011020-04f38977.json` |
| live-conversation | 13 casos | `tmp/verification/live-conversation-20261116T011021-3918b622.json` |
| melodi-cartesia | 32 casos, regresión anterior del mismo hito | `tmp/verification/melodi-cartesia-20261116T004314-d7737e60.json` |
| chat-thinking-ui | escritura, fundido y puntos | `tmp/verification/chat-thinking-ui-20261116T010833-86e5c135.json` |
| chat-media-ui | 14 comprobaciones | `tmp/verification/chat-media-ui-20261116T010700-1eed2af0.json` |
| agent-avatars | 6 casos de identidad y assets | `tmp/verification/agent-avatars-20261116T010832-2298b04d.json` |
| agent-avatars-ui | mirada fija, parpadeo, flotación acotada, CSP, pausas y limpieza | `tmp/verification/agent-avatars-ui-20261116T010833-73893c37.json` |
| chat-agents-ui | 0/1/4/7 agentes, modal, detalles, modo oculto, identidad, teclado, CSP, 375 px | `tmp/verification/chat-agents-ui-20261116T010833-cd6548a6.json` |
| agents-preview-ui | 30 muestras de geometría constante, DOM retenido y proporciones a 320 px | `tmp/verification/agents-preview-ui-20261116T011019-69b3fc50.json` |
| workspace-agents-ui | 6 agentes, revisiones, pausas y anchos 375–1280 px | `tmp/verification/workspace-agents-ui-20261116T011321-09252fe6.json` |

Las capturas de `tmp/chat-agents-ui/` y `tmp/agent-avatars-ui/` muestran únicamente
datos sintéticos. Se revisaron visualmente la barra, el modal y el ancho pequeño.
Un hash acredita la integridad de los assets, no calidad visual o semántica.

Se conservan los fallos intermedios: fixtures con identificador ya finalizado,
espera de pausa insuficiente y carrera de carga de la simulación, además de
`workspace-agents-ui-20261116T011125-9bc96ab4.json`, que detectó la ausencia del
estado simulado del teléfono. Se añadió ese sustituto al banco; no se cambió la
transferencia para resolver el fallo. Las correcciones tienen informes nuevos.

## Propuesta de briva sans y consumo conocido

Se generó una lámina de concepto premium y elegante en
`brand/typography/concepts/briva-sans-v1.png`, con alcance descrito en su
`BRIEF.md`. Es una imagen de propuesta, **no un archivo de fuente** y no se
reemplazó la tipografía de la interfaz. Dibujar glifos, espaciado, pruebas y
compilar OTF/TTF quedan pendientes de elegir la dirección.

Consumo externo conocido del hito: una consulta de identidad al proveedor de
conversación y una generación de imagen del concepto; cero síntesis de voz y
cero llamadas telefónicas iniciadas por estas comprobaciones. El importe y
tiempo GPU se desconocen. La consulta de identidad tardó 2,531 s; no es una
garantía de latencia. No se midió tráfico de los conectores de la app abierta.
Los informes no contienen claves, conversaciones ni los medios originales.

## Estado de carga nativa

Se comprobó antes el arranque de desarrollo listo y sin operaciones ocupadas
(`tmp/chat-presentation-startup-20261115.json`). Los ajustes finales de barra,
modal, ojos y geometría están en código y verificados en navegador propio.
Su carga en la instancia nativa abierta queda pendiente de reinicio normal.
El intento de cerrar sólo la demostración no se ejecutó: la revisión automática
de permisos no pudo completarse por un límite de uso del servicio. No fue una
decisión sobre la seguridad de la acción y no se eludió el control.
La ventana puede cerrarse con «Cerrar simulación». No se declara un cierre ni
una revisión nativa final que no se hayan observado.

Comprobación posterior: el servicio de revisión volvió a estar disponible.
Brivany se cerró mediante su control privado normal, con comprobación previa de
ausencia de operaciones ocupadas, y se inició de nuevo desde desarrollo.
El nuevo proceso confirma `ready: true` y `busy: []`, y el servidor nativo
responde 200 con los nuevos JS/CSS de barra, modal, flotación y miniatura.
El 410 de una consulta sin sesión a la pantalla principal es el bloqueo
previsto de acceso web al escritorio; no se alteró esa protección. No quedan
procesos cuyo comando corresponda a la demostración. Queda así resuelta la
carga nativa pendiente del párrafo anterior. No se volvió a controlar la pantalla
ni se declara una inspección visual nativa posterior al Escape del usuario.
Informes: `tmp/chat-agents-native-restart-20261115.json`,
`tmp/chat-agents-native-assets-20261115.json` y
`tmp/chat-presentation-delivery-20261115.json`.
