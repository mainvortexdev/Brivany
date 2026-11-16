# WorkSpace: recursos de arranque y modelos locales

7 de noviembre de 2026. Revisión adicional al objetivo de reducir recursos.

## Cambios implementados

Se retira el precalentamiento de Electron al cargar la ventana de Brivany.
`NativeRuntime.start()` ya inicia el backend cuando una acción nativa lo necesita;
el arranque de la interfaz no requiere crear ese proceso ni `ComputerService`.

El relay de la extensión sigue disponible al abrir Desktop. Su constructor ya
no carga ni ejecuta por anticipado el filtro de canción y los modelos de timbre.
Las fábricas existentes de preparación de prefijo y River inicializan el filtro
cuando reciben una traducción real; la primera inferencia de timbre abre y
conserva la sesión local. Se conservan ventanas, modelos, umbrales, validación
de integridad y selección de voz. La primera utilización puede tardar más por
cargar modelos; no se afirma que se haya reducido esa latencia.

El modelo ONNX de timbre conserva la comprobación de tamaño y SHA-256, pero usa
`hashlib.file_digest` sobre un stream. Evita materializar sus 95.387.498 bytes
como otro objeto Python completo para calcular el hash.

Se añade limpieza explícita de la bandeja de archivos también al bloque final
de cierre del contenedor Desktop.

## Evidencia local

Un proceso separado importó módulos, sin abrir servidor, ventana, cuentas o
proveedores. Su memoria residente pasó de 14.471.168 bytes a 46.108.672 al
importar `services.h1.server`, y a 50.991.104 tras importar el launcher.
El commit privado pasó de 8.577.024 a 303.980.544 y 309.420.032 bytes.
Las duraciones de importación fueron 0,6175 y 0,2558 segundos. NumPy estaba
cargado; Torch, OpenCV, ONNX Runtime y LiteRT no. No se atribuye ese commit a
una causa única ni se usa esta medición como RAM de toda la aplicación nativa.
Informe: `tmp/verification/workspace-startup-import-review-20261107.json`.

Una fixture sintética de 8 MiB produjo el mismo SHA-256 con lectura entera y
streaming. El pico de asignaciones Python medido con `tracemalloc` fue de
8.397.274 bytes con `read_bytes()` y 271.537 con `file_digest`. No mide RSS del
proceso completo ni representa una inferencia del modelo real.
Informe: `tmp/verification/workspace-streamed-hash-20261107.json`.

`tools.verify workspace-startup` pasó un recorrido de eventos `loaded` con
ventana, servicios y listener sustituidos: se inicia el relay pequeño sin crear
el backend nativo ni precalentar modelos. La fábrica del backend sigue disponible
para la primera acción explícita. Informe:
`tmp/verification/workspace-startup-20261107T173409-3ecb2974.json`.

Las pruebas de timbre añaden primera inferencia con una sesión local sustituida,
reutilización en la segunda, rechazo de un hash cambiado y prohibición de usar
`Path.read_bytes()` para verificar el modelo. Estas comprobaciones no miden
fidelidad del clasificador, voz real ni rendimiento de hardware completo.

## Oportunidades pendientes

El monitor de reducción de música enumera endpoints/sesiones de audio cada
100 ms mientras está habilitado, incluso sin reproductor local. Conviene
suspenderlo cuando no hay audio de Spotify que reducir y reactivarlo por eventos
de reproducción; requiere una política de estado y regresiones para no perder
la reducción automática. El worker de cuenta sin sesión espera 500 ms y el motor
de eventos despierta cada segundo. Son oportunidades observadas en código,
no cambios implementados en este registro.

No se ha reescrito WorkSpace en Rust: estos costes provienen de procesos y
modelos iniciados antes de necesitarlos, y pueden reducirse conservando la
arquitectura actual. Las comprobaciones descritas fueron locales, con cero
solicitudes de proveedor y cero segundos de GPU de inferencia.

## Resultados posteriores y corrección de la prueba

La suite completa `translation-voices` agotó el límite de 180 segundos y conserva
su resultado fallido en
`tmp/verification/translation-voices-20261107T173411-f9e4b174.json`.
No se ha marcado aprobada ni se repitió íntegra.

Un primer intento dirigido expuso un defecto de aislamiento en la prueba nueva:
el sustituto de `sys.modules` permitió importar la extensión nativa soxr dentro
del contexto; al salir se retiró el módulo y la prueba posterior intentó
registrarlo otra vez. El proceso abortó con un error de nanobind. Se conserva
una descripción retrospectiva de ese intento en
`tmp/verification/workspace-model-lazy-first-attempt-20261107.json`.
Se sustituyó también la extracción de características en esa fixture para
comprobar solo carga/integridad, sin reimportar el remuestreador nativo.

Después pasaron diez pruebas dirigidas con `tools.verify workspace-model-lazy`:
`tmp/verification/workspace-model-lazy-20261107T173802-b9d140f9.json`.
Eso comprueba el módulo cambiado y no sustituye la suite completa fallida.
La suite `work` pasó 43 casos:
`tmp/verification/work-20261107T173732-52fa37b2.json`.

Se integró la condición de monitorización de música: consulta únicamente si
existe una ventana del reproductor local y su instantánea SDK ya publicada
indica `playing is True`. No construye Spotify ni consulta proveedores.
El monitor usa esta condición para dormir sin enumerar sesiones cuando no hay
música local. Su política y regresión pertenecen a `MusicDucking`.
La nueva comprobación de este gate y el ciclo `loaded` pasaron dos casos en
`tmp/verification/workspace-startup-20261107T173832-82c957b2.json`.

## Medición nativa de la barra y el panel

El banco `tools.verify workspace-runtime-native` abre tres ventanas propias
con la interfaz de producción, ajustes y widgets temporales, y servicios de
cuenta y música sustituidos. Usa el inventario de procesos del entorno
WebView2 para medir CPU, memoria residente y memoria privada por tipo de
proceso junto con el host Python. El inventario excluye el proceso de fallos.
[Método de enumeración](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2environment.getprocessinfos).

El panel se ajustó a 360 × 167 px CSS, con botones de 26 px. Windows confirmó
la región de 353 × 164 píxeles físicos en esta sesión. El temporizador siguió
activo al ocultar el panel y el WebView de voz permaneció sin crear.

La apertura de paneles ahora responde a eventos del puntero de la barra.
El sondeo nativo de 200 ms se usa mientras el panel esté abierto para conservar
la detección de proximidad y la política de visibilidad del chat. También se
retiró el intervalo de traducción auditiva fuera de su vista visible. Las
pruebas de Edge comprueban apertura al pasar el cursor, cierre con Escape,
reapertura después de salir y regresar, y cero consultas de puntero en reposo.

| Escenario | Consultas de puntero antes → después | Llamadas observadas antes → después | CPU total en un núcleo antes → después |
| --- | ---: | ---: | ---: |
| Barra en reposo | 39 → 0 | 52 → 13 | 17,1 % → 9,9 % |
| Enfoque visible | 38 → 38 | 46 → 46 | 7,6 % → 5,4 % |
| Enfoque oculto | 38 → 0 | 42 → 4 | 9,5 % → 10,5 % |

Las ventanas de ocho segundos muestran la eliminación de llamadas, con
variación de CPU entre escenarios. Los conjuntos residentes sumados quedaron
entre 570 y 604 MiB y pueden contar páginas compartidas varias veces. Los
totales privados se mantuvieron entre 563 y 593 MiB. Las muestras no prueban
un ahorro global de CPU o RAM. En el banco posterior, el host Python aportó
entre 1,4 y 2,3 puntos de CPU sobre un núcleo y el resto correspondió a WebView2.
No se migró el host a Rust. No se midió tiempo de GPU ni se usaron proveedores.

[Medición anterior](../tmp/verification/workspace-runtime-native-20261108T031538-ef443434.json),
[medición posterior](../tmp/verification/workspace-runtime-native-20261108T031718-41227f84.json),
[regresión de isla](../tmp/verification/island-ui-20261108T031837-0f65ee5e.json),
[ejecución Edge](../tmp/verification/workspace-runtime-20261108T032112-91337592.json).

La repetición final volvió a contar 0, 38 y 0 consultas de puntero. La CPU
del escenario visible subió a 12,2 % de un núcleo frente al 5,4 % de la
primera medición posterior, lo que refuerza el límite de estas muestras
cortas para estimar el ahorro total.
[Medición nativa final](../tmp/verification/workspace-runtime-native-20261108T032535-1c55a0e6.json).

## Correcciones de la comprobación nativa

El banco general usaba una expectativa anterior a la selección de video en el
navegador. Se aisló su almacenamiento y se sustituyó el navegador. La prueba
ahora verifica que el clic solicita una selección y que el motor arranca
después de simular esa selección. Las medidas se toman sobre el layout para
evitar que el escalado de entrada contamine el tamaño.

Una vez corregidas las medidas, se detectó un borde de tema que reducía el
interior del resultado Glisse a 518 × 338 px. El estilo general se limitó a
los paneles correspondientes. WebView2 verificó el resultado de 520 × 340 px,
su desenfoque, desplazamiento vertical, retorno a la superficie opaca, y la
regresión de música, traducción y voz con datos sintéticos.

[Fallo previo de selección](../tmp/verification/workspace-chat-native-20261108T031922-3c54d652.json),
[medida durante la transición](../tmp/verification/workspace-chat-native-20261108T032031-5d5e7a85.json),
[borde detectado](../tmp/verification/workspace-chat-native-20261108T032244-8f1f637b.json),
[recorrido nativo aprobado](../tmp/verification/workspace-chat-native-20261108T032425-fcafc006.json).
