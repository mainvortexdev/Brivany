# Promoción Brivany / Melodi a partir de la referencia

Se produjo una composición editable de nueve escenas, manteniendo el orden
y la estructura visual del video aportado por el usuario: punto, tarjetas,
identidad sobre negro, instrucción, tablero, tres funciones, mosaico y cierre.
Los textos y gráficos hablan de Brivany. La pieza usa agentes, enfoque y
archivos; no anuncia reorganización automática de agenda ni llamadas probadas.

Proyecto: [fuentes y recorrido](../videos/brivany-reference-20261108/README.md).
Entrega local: `Exports/Brivany-Melodi-referencia-20261108/Brivany-Melodi.mp4`.
1280×720, 60 fps, 1.982 fotogramas; video de33,033333 s. El contenedor mantiene
33,045333 s por la pista original. Sin síntesis ni locución añadida.

Se verificó el runtime local de Chrome, lectura de fuentes y assets, geometría,
contraste, momentos de entrada, final y texto de instrucción. Los ensayos de
escenas son simulaciones visuales y no acciones de Melodi. Hubo una primera
revisión fallida y dos problemas visibles en el primer render; se corrigieron
el titular obstruido y el doble botón. Los informes anteriores se conservan.

El informe completo `check-delivery.json` pasa sin errores. El ajuste final
del primer plano se volvió a comprobar en `check-opening.json`. La auditoría
local `source-audit.json` contiene ocho comprobaciones y122 tweens enumerados.
Las advertencias sobre densidad, pequeños detalles de UI, estructura y
solapamientos deliberados fueron revisadas mediante capturas. Se inspecciona
el video decodificado; no se afirma coincidencia exacta de todos sus píxeles.

La pista AAC se extrae y se monta sin recodificación. Coinciden los hashes de
sus paquetes comprimidos en origen, extracción y entrega; esto demuestra
conservación de datos, no calidad semántica ni ausencia de voz evaluada por
escucha humana. Los originales no se adjuntan a la bitácora.

No se modificó el código de Brivany para crear este video. Se atendió además
el pedido paralelo de iniciarlo: proceso con `--island`, WorkSpace activo y
renderizadores de barra/panel respondiendo en el diagnóstico local. Eso no
equivale a una comprobación visual completa de sus ventanas nativas.

Render local HyperFrames0.9.23 con FFmpeg y GPU Intel. No hubo APIs de modelos,
locución, llamadas telefónicas ni publicación. Npm y el CLI realizaron tráfico
de instalación/telemetría; su cantidad y los segundos efectivos de GPU no
están medidos. Las suites de aplicación no se repiten: no se cambió código
de ejecución. La evidencia contiene solo metadatos y resultados de validación.

[Verificación de entrega](../videos/brivany-reference-20261108/delivery-verification.json):
se decodifican1.982 cuadros y1.549 paquetes/cuadros AAC; archivo de9.368.563
bytes. Se revisan nuevamente titular, botón y hoja de contacto del MP4 final.
La exportación corregida tardó115,7 s de pared; ese tiempo no es una medición
de segundos efectivos de GPU. Se conservan ambos renders en el proyecto.
