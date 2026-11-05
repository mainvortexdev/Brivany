# Evitar heredar timbre de una coincidencia acústica débil

4 de noviembre de 2026. El ensayo real
`tmp/selected-video/inline-sync-1793816151318.json` completó quince voces y
31,700 s de fuente, sin recuperación del original. Siguió fallando por retraso
máximo de 9,478528 s y crecimiento de 5,190528 s. El prefijo confirmó captura de
7015 ms y preparación posterior de 5016 ms; prosodia y timbre local se solaparon.
Su resultado no acredita todavía buena atribución de hablantes ni naturalidad.

La pieza 7,00–8,42 s se asoció con el grupo acústico 3 mediante una similitud de
0,6603 y reutilizó su timbre femenino almacenado, sin ejecutar una nueva
inferencia local. En dos ensayos anteriores, fragmentos cercanos de esa misma
fuente habían obtenido timbre masculino mediante inferencia independiente.
Esto demuestra el camino de herencia y una contradicción entre evidencias; no
establece por sí solo quién habla ni que todos los tramos femeninos sean errores.

## Dos correcciones implementadas

Una pieza distinta sólo puede reutilizar timbre si su asociación acústica es
`matched` y la similitud alcanza 0,77. Ese valor deriva del umbral existente
0,65 más su margen conservador 0,12; no es una garantía calibrada de identidad
ni de género. Una coincidencia menor vuelve a analizar el audio de esa pieza.
El análisis propio que origina un grupo nuevo sigue disponible. Se mantiene
el máximo de ocho piezas distintas por evidencia almacenada.

Cuando una inferencia nueva y fiable contradice el estilo establecido de un
grupo, la pieza usa su estilo independiente con categoría provisional, marcada
como `local_timbre_conflict`. No sigue presentando el estilo anterior como una
coincidencia segura. La caché se vacía y queda pendiente: esa muestra contraria
no se propaga a otras piezas como si fueran observaciones independientes.

Una nueva inferencia que coincide con el estilo anterior resuelve la duda y
restablece su caché. Dos observaciones contrarias con identificadores de
evidencia distintos confirman el cambio de estilo y permiten reutilizarlo.
Repetir una misma observación no lo confirma. Si falta una nueva evidencia
mientras existe conflicto, la categoría permanece provisional. No se usan tono,
letras ASR ni proximidad temporal para resolverlo.

Además, el modo con agrupación acústica omite la espera de 200 ms por una
etiqueta ASR. La asociación ya terminó y esas etiquetas sólo anotan el grupo;
no pueden identificar una pieza sin clave acústica. La ruta nativa conserva
su espera y la posibilidad de recibir una etiqueta tardía. En el ensayo había
aproximadamente 220 ms evitables entre MT y TTS en varias piezas sin grupo.
Eliminar esa espera no demuestra que el retraso global disminuya en la misma
cantidad ni resuelve los excesos de duración del audio sintetizado.

No se añaden solicitudes ASR, MT o TTS. Las coincidencias débiles o los
conflictos pueden ejecutar más análisis locales de timbre; se mantienen los
dos trabajos acotados y el modelo serial con un hilo de CPU. No se declara
un consumo de CPU nuevo medido ni cero coste de procesamiento.

## Pruebas y límites

Las regresiones locales cubren 0,6603, el límite 0,7699/0,77, origen de un grupo,
caducidad después de ocho piezas incluso tras seleccionar voces, conflicto y
resolución por ambas ramas, y repetición de una misma evidencia. Un recorrido
River con protocolos sustituidos arranca con un grupo de timbre femenino,
presenta una coincidencia de 0,6603 y verifica una inferencia nueva masculina
con salida provisional. Otro recorrido de piezas desconocidas de 400/880 ms
rechaza cualquier intento de esperar etiquetas ASR en modo acústico.

La primera ejecución dirigida conservó una expectativa antigua: esperaba que
la pieza contraria mantuviera el catálogo anterior. Se actualizó para exigir
el catálogo independiente provisional y la ausencia de reutilización hasta
resolver el conflicto. Los datos y los resultados reales anteriores permanecen
sin modificar. Estas pruebas no acreditan el género de las personas, precisión
universal del modelo ni la corrección de todos los tramos del video real.

`tools.verify` registró 96 pruebas `sync-relay` aprobadas en
`docs/verification-history/sync-relay-20261104T182542-9064eda1.json` y 65 pruebas
`river-translation` aprobadas en
`docs/verification-history/river-translation-20261104T182542-768e1672.json`. El segundo
informe conserva avisos de cierre de servidores Muse y HTTP locales durante
cancelaciones; las aserciones aprobaron. Los protocolos de prueba no hicieron
llamadas a APIs externas de traducción. Se reutilizaron además las muestras
sintéticas propias existentes para la inferencia local de agrupación acústica.

## Corrección posterior de concurrencia y evidencia antigua

La revisión después de esas suites descubrió bordes que la primera versión no
cubría. Dos análisis contrarios antes de la primera petición TTS aún podían
reemplazar la caché porque faltaba un estilo establecido. Además, un contexto
anterior con evidencia almacenada podía llegar después de una contradicción,
borrar el estado pendiente y restaurar una caché antigua. Se conserva la
validación anterior con su alcance; no acredita estos bordes corregidos después.

Ahora la primera inferencia independiente establece la referencia de catálogo
antes de TTS. La evidencia recuperada de caché lleva procedencia explícita hasta
la selección de voz. Cada grupo conserva hasta dieciséis identificadores de
evidencia observada; al abrir un conflicto se recuerda qué observaciones ya
existían. Un resultado almacenado o un resultado independiente anterior al
conflicto no puede resolverlo, reabrirlo después de resolverlo ni sustituir una
referencia más nueva reiniciando el límite de ocho piezas.

Resolver el conflicto exige una observación independiente nueva compatible con
la referencia o dos observaciones contrarias distintas. Los contextos anteriores
pueden conservar su categoría para esa pieza, pero la presentan provisional
cuando contradice la referencia o existe duda pendiente. No alteran por ello
el estado ya confirmado para las piezas siguientes.

Se corrigió también otro borde: una coincidencia acústica débil acompañada de
timbre incierto no debe heredar una categoría segura. Puede conservar la voz
anterior para esa pieza, con estado provisional y fuente
`weak_acoustic_timbre`. La referencia global permanece intacta; una coincidencia
fuerte sí puede conservar su categoría anterior ante una inferencia incierta.
La prioridad manual sigue vigente.

Las nuevas regresiones incluyen dos inferencias contradictorias antes de TTS,
finalización fuera de orden, evidencia almacenada anterior a una contradicción,
resultado independiente antiguo después de resolverla y coincidencia débil con
confianza 0,70. Una ejecución dirigida inicial detectó además una expectativa
que aún no incluía el nuevo indicador de procedencia en la caché; se actualizó
para exigirlo. No se reinterpretan como evidencia nueva las repeticiones de una
misma observación y no se acredita identidad humana.

La revisión independiente aprobó estos tres casos y 22 comprobaciones
dirigidas. Las suites posteriores registraron 96 pruebas de `sync-relay` y
68 de `river-translation`, ambas aprobadas. Sus informes son
`docs/verification-history/sync-relay-20261104T183416-6da67a95.json` y
`docs/verification-history/river-translation-20261104T183416-142dfb86.json`.
Los avisos de cierre en protocolos locales siguen en el segundo informe.
El [ensayo real 065](traduccion-auditiva-ensayo-065.md) confirmó el nuevo
análisis en las diez coincidencias débiles observadas y conservó el fallo
de retraso general.
