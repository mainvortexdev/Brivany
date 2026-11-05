# Melodi musical: audífonos, baile y transiciones

31 de octubre de 2026, hora de La Paz. Ajuste de presentación de Melodi WorkSpace,
conservando los servicios, controles Spotify, cola, voz y human-skills.

## Comportamiento

Mientras Spotify confirma reproducción de música, Melodi lleva audífonos con aro
oscuro y detalles verde suave, unidos al cuerpo para que no se separen al moverse.
Sonríe y usa balanceo, pasos laterales o pequeños saltos. El movimiento queda dentro
de su área central y no intercepta herramientas ni cambia la región nativa.
Al pausar se retiran los audífonos y se vuelve al reposo normal; las ondas siguen
con la permanencia de cinco minutos ya implementada. No se duerme mientras hay
reproducción activa. Movimiento reducido o Animaciones desactivadas conservan los
audífonos estáticos y detienen baile, animación de letras y mezclas de color.

La selección de baile **estima** el carácter del tema con metadatos públicos y
la densidad de palabras de la letra temporizada en una ventana local. Distingue
suave, rítmico y animado, con variaciones estables por canción. Sin datos usa un
balanceo neutral. No es detección acústica de BPM ni reconocimiento fiable del
mood real: no se graba música, no se usa micrófono ni se invoca inferencia de pago.
No se depende del endpoint Spotify Audio Features, marcado como deprecado en su
documentación. La estimación es un recurso expresivo, no una afirmación sobre el
estado del usuario ni una orden inferida del contenido de las letras.

El teleprompter conserva tres filas. Al cambiar una línea se reutiliza su identidad
temporal para animar su desplazamiento, opacidad y desenfoque durante 360 ms.
Saltos de posición o tema tienen una entrada corta, sin arrastrar texto por todo
el panel. Se cancelan animaciones anteriores para no acumular elementos, y al
cerrar se liberan animaciones y ciclos pendientes.

Los dos colores de portada se interpolan localmente durante 1,8 segundos. Si otra
canción llega antes, la mezcla parte del color que se está viendo, sin volver al
color inicial ni aplicar un salto. La escala de las ondas también cambia de forma
progresiva según la expresión seleccionada. Se preservan las políticas de pausa,
retirada suave de las ondas y legibilidad de controles sobre el degradado.

## Código y comprobación

- `desktop/experience/music-motion.js`: estimación pura, interpolación cancelable
  de paleta y animación de filas mediante Web Animations API; sin red ni persistencia.
- `character.css` y `work-widget.html`: audífonos, sonrisa, manos y coreografía de
  amplitud limitada; movimiento reducido y ajuste de animaciones.
- `island.js`: vinculación al estado real de reproducción, prevención del sueño
  mientras suena música, carga de letra existente y limpieza al cerrar.
- `workspace-music.css`: escala gradual de ondas y máscara suave del teleprompter.

La suite `tools.verify island-ui` usa puente y Spotify sustituidos y no reproduce
música real. Comprueba audífonos visibles al reproducir/retirados al pausar,
coreografía y estimación en fixtures suaves y animados, ausencia de baile con
movimiento reducido, interpolación intermedia de colores y retarget, animación
real de filas con limpieza, límites en ocho anchos y recorridos previos de
reproducción, letras y cola. Se inspeccionan capturas sintéticas; no se adjuntan
portadas, letras, conversaciones ni audio reales a la bitácora.

La activación en Windows requiere recargar las superficies. El reinicio de
revisión preserva, cuando está sonando música, el contexto o la cola observada y
solicita reanudar en la posición observada. El informe solo conserva estados,
rutas y recuentos. Eso no prueba recuperación sin ninguna interrupción audible.
El tráfico interno del SDK no se mide; no se usa modelo de pago. macOS/Linux
conservan el frontend, pero no se declaran verificados nativamente por este hito.
