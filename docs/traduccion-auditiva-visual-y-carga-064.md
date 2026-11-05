# Verificación visual del banco y arranque nativo observado · 064

4 de noviembre de 2026. Esta continuación conserva las limitaciones
registradas antes del [ensayo real 062](traduccion-auditiva-fases-reales-062.md).
La revisión posterior comprobó su presentación en el navegador integrado y
el estado público de una nueva instancia nativa. No inició otra traducción.

## Presentación de las fases

Se inspeccionaron el árbol de accesibilidad y una captura del banco 49204.
La interfaz mostró la preparación completa **12,06 s**, recepción **7,02 s**,
ASR **2,59 s**, clasificación **0,02 s**, timbre **1,97 s** y prosodia
**2,34 s**. Son redondeos de las métricas guardadas en el ensayo, no otras
mediciones de latencia. El texto aclara que timbre y prosodia se ejecutan
simultáneamente y que sus duraciones no se suman.

En el ancho observado de 443 px no hubo solapamiento de esos elementos; la
tabla dispuso de desplazamiento horizontal. Esta revisión acredita esa
presentación y ese ancho, no todas las resoluciones ni accesibilidad exhaustiva.
La captura temporal `tmp/selected-video/bank-prefix-phases-062.png` permanece
local y **no se adjunta a la bitácora**. La evidencia registrada conserva sólo
las cantidades y la nota de observación, sin fotogramas originales del video.

La comprobación visual no recalifica el ensayo 062: continúa rechazado por
retraso y sin atribución humana o escucha física verificadas. Tampoco inicia
otra sesión de proveedores para mostrar los resultados ya existentes.

## Nueva instancia nativa, sin recarga forzada

Se comprobó que el proceso anterior 8744 ya no existía y que el puerto normal
48217 estaba libre. Se inició el launcher oficial con `--island`, que creó
el proceso 5620 y su hijo 21976. El relay ocupó 48217 y la interfaz HTTP local
quedó en 58536. No se detuvo por la fuerza la instancia anterior ni se recargó
la extensión instalada.

La lectura pública de `/api/desktop/runtime` mostró una extensión emparejada,
Work conectado, cero sesiones de traducción activas, cero prefijos en caché y
sin último fallo informado. Es evidencia de arranque y enlace en ese momento.
Un puerto abierto o un emparejamiento no prueban que se haya cargado el módulo
de captura ni que se produzca doblaje en el perfil personal.

Una activación posterior mediante el launcher oficial sin `--island` trajo
la ventana Brivany 12782798. Su árbol de accesibilidad expuso el botón
«Abrir Melodi WorkSpace», índice 46 de aquella lectura. Dos intentos de clic
de control por accesibilidad fallaron por la caché de referencias del control;
una captura de la ventana nativa agotó su plazo. No se declara que el panel
se abriera a partir de esas acciones ni que ese fallo del control demuestre
un defecto de la lógica de traducción.

No se inició captura o doblaje nuevo en el perfil personal. La comprobación
del recorrido Work → extensión → audio sigue pendiente. Las solicitudes aquí
descritas fueron controles locales, lecturas del estado público y presentación
de resultados existentes, sin nuevas solicitudes de inferencia de traducción.
No se contó todo el tráfico incidental del ordenador. La evidencia numérica
está en `tmp/selected-video/visual-and-native-state-064.json`; no incluye
credenciales, transcripciones, audio ni capturas del video.

## Observación posterior: no apareció el prefijo en la pestaña personal

Se abrió una pestaña nueva de Brave, 863156743, mediante la URL normal del
video de referencia, sin parámetro de posición. YouTube reanudó alrededor
del segundo 286. Se pausó con los controles, la tecla 0 llevó el tiempo
visible a cero y se pulsó reproducir. Esta observación es distinta del ensayo
aislado 063 y no inició manualmente una herramienta de traducción.

Una lectura de DOM, sólo de observación, encontró el video reproduciéndose
en **24,937585 s**, duración 1495,781 s, datos disponibles (`readyState=4`)
y velocidad 1×. No estaban presentes las marcas `prefix_build` ni
`prefix_state`, y `active_translation` era falso. Se pausó posteriormente
alrededor del segundo 40. La preparación inicial no se hizo visible en ese
recorrido. La ausencia de esas marcas no demuestra su causa ni confirma por
sí sola todas las condiciones de elegibilidad, como el estado de volumen
durante el inicio.

La consulta pública local de las **18:31:14,082 UTC** confirmó relay disponible
en 48217, un navegador emparejado, Work conectado, modo automático disponible,
cero sesiones activas y sin video inline activo ni último fallo informado.
El estado del prefijo era `active=false`, `cached=0`, `completed=0`, `reused=0`.
Es una instantánea del servicio. Sus contadores de resultados completos o
reutilizados no son un contador de todos los intentos ASR, errores o llamadas
facturables, por lo que no se declara consumo remoto cero. El importe y el
número total de intentos de proveedor de este intervalo son desconocidos.

El emparejamiento y la disponibilidad del puerto continúan sin probar que el
módulo de preparación se cargara en la página. No hubo nuevo doblaje personal
ni audio traducido comprobado. Los dos GET de estado realizados para esta
anotación fueron lecturas locales; no activaron herramientas ni enviaron audio
a proveedores. La evidencia enumerada se guarda en
`tmp/selected-video/personal-prefix-observation-064.json`, sin estado privado,
credenciales, transcripciones o medios originales. El resultado se añade
como observación fallida posterior y no modifica la verificación visual
anterior de la página del banco.
