# Siete voces completas y retraso creciente: ensayo rechazado

4 de noviembre de 2026. La prueba real
`tmp/selected-video/inline-sync-1793810199055.json` alcanzó la cobertura
mínima nueva de doce segundos. **No pasó la aceptación de continuidad**:
el retraso máximo fue 9,701346 s y su crecimiento 3,168013 s, por encima
de los límites vigentes de 8 y 3 s. No se amplían esos límites para aceptar
este resultado. El objetivo completo sigue abierto.

## Alcance comprobado

El ensayo usó Brave aislado y proveedores reales, iniciado desde el banco
integrado. No usó el perfil personal, clonación ni el prefijo de siete
segundos. Se pidió la posición 300 s del video público de Tecnonauta;
la captura efectiva comenzó en **305,472 s**. Identidad y duración se
verificaron antes de activar y al finalizar: el mismo video de 1495,781 s,
sin anuncio, a velocidad de fuente 1× y sin error de medios.

Se completaron siete voces con señal hasta el segundo relativo 13,260,
equivalente al segundo absoluto 318,732 del video. No hubo voces publicadas
perdidas dentro de esa cobertura, recuperación del original ni interrupción
de la fuente. La imagen llegó al segundo relativo 13,429333 y no registró
el fallo de decodificador del ensayo anterior. Todos los campos
`recovered_gap` son falsos: esta ausencia de fallo tampoco demuestra que se
ejercitara la rama de recuperación de huecos.

Las siete voces completas tuvieron desfases de inicio entre −17 y +13 ms
respecto a la imagen. Cinco intervalos proceden de estimaciones parciales
del ASR y dos de límites de turno; esos desfases no acreditan alineación
palabra por palabra. Las velocidades de reproducción fueron 1× o 1,18×.
La primera señal apareció a los **7,996 s desde activar**. La instrumentación
de producción confirmó siete voces completas y siete con señal; su primera
señal se midió a los 6,7529 s desde su reloj de captura. Son relojes y puntos
de detección distintos, no dos medidas intercambiables del arranque.

El banco terminó al completar la cobertura exigida. Una octava voz ya
iniciada tenía señal, pero sólo había reproducido 0,187717 s de 1,52 s;
no cuenta como completada ni extiende el intervalo verificado. El informe
no certifica la acción de detener desde WorkSpace. Tampoco hubo escucha
física nueva del usuario o verificación semántica del doblaje completo.

## Lo que aún falla

El retraso captura–imagen comenzó en 6,533333 s y terminó en 9,690667 s,
con máximo 9,701346 s. Completar audio sin cortes no basta cuando la imagen
se va quedando atrás. La segunda traducción comenzó a los 5,567 s y acabó
a los 10,062 s del reloj del protocolo: **4,495 s**. La tercera terminó antes,
a los 8,455 s, pero esperó el orden de entrega y se publicó después de la
segunda. Es evidencia de espera en la cadena; todavía no identifica por sí
sola si el retraso de esa solicitud fue TLS, cómputo del proveedor u otra causa.

Las seis primeras voces completas usaron catálogo masculino. La séptima,
del intervalo relativo 11,100–13,260 s, usó catálogo femenino a partir de
una predicción local con confianza 0,963433. No hay una referencia humana
específica de ese intervalo para declarar esa asignación correcta o errónea.
La secuencia de voces no equivale a la secuencia real de personas. Los grupos
acústicos y las abstenciones siguen necesitando comprobarse en habla natural.
La [corrección de la voz provisional](traduccion-auditiva-voz-provisional-051.md)
evita una ruta conocida de elección por pitch; no convierte todas las demás
elecciones en correctas.

## Consumo y procedencia

El informe persistido cuenta un acuse de conexión Muse y entrada de audio
iniciada, **12 intentos MT directos, 10 solicitudes TTS y 8 etapas de prosodia
en vivo iniciadas**. Esos contadores describen intentos o etapas observadas,
no diez voces necesariamente escuchadas ni ocho resultados aceptados. Parte
del trabajo anticipó contenido posterior a la cobertura completada. No hubo
solicitudes de preparación del prefijo en este recorrido profundo.

El contador de traducción anticipada de subtítulos pertenecía al estado
temporal del banco y no quedó incluido en este informe. Al revisarlo, el
servidor 49198 ya no respondía; no se reconstruye un total externo exacto
sumando sólo los contadores persistidos. El importe facturado, el uso remoto
de GPU y el tráfico incidental total son desconocidos. Esta revisión
retrospectiva no abrió nuevas solicitudes de inferencia.

Se conservan el informe original y una revisión de métricas en
`tmp/selected-video/continuity-quality-audit-1793810199055.json`, sin audio,
video ni transcripciones originales. La próxima comprobación debe medir
si una corrección concreta reduce la espera de entrega y el crecimiento
del retraso, manteniendo estos mismos límites. Sigue siendo necesaria la
prueba conjunta desde el inicio, con prefijo reutilizado, hablantes,
omisión de canciones, emoción y continuidad prolongada.

## Instrumentación posterior para comprobar el recorrido instalado

El reproductor de producción expone contadores acotados de voces iniciadas
con señal y terminadas, primera señal, velocidades y tiempos. Conserva como
máximo 32 filas numéricas de voces completadas. El medidor sólo atribuye señal
a la voz activa no pausada, sin guardar muestras de audio. La salida audible
mantiene su recorrido; la rama de medición no añade otra salida audible.
La superficie local publica esas métricas, el ancla de la fuente, la versión
del módulo y el máximo de retraso desde la primera señal, sin conversaciones
ni medios originales. También hay una marca de versión y estado de preparación
del prefijo. Leer esas marcas puede comprobar qué módulo se ejecuta; una
copia de archivos por sí sola no demuestra la recarga de Brave.

Después del ensayo real se añadió `recorder_gap_recoveries`. Sólo aumenta
cuando se aplica el salto al siguiente rango decodificado; esperar ASR o una
voz no cuenta como recuperación. La regresión comprueba cero durante esa
espera, uno tras el salto y que no se vuelva a contar el mismo hueco. El
contador no estaba en la evidencia del ensayo rechazado y no se le atribuye
retroactivamente un valor. Ni ese contador ni medir energía prueban calidad
semántica, identidad humana o escucha física.

`tools.verify workspace-sync-extension` aprobó **63 casos** en 0,489 s:
`docs/verification-history/workspace-sync-extension-20261104T165357-e0a46b5a.json`.
Incluye la medición de señal activa y la distinción entre esperar y recuperar
el hueco. Son pruebas locales con sustitutos y contadores, sin inferencia
remota ni GPU. Una invocación inicial con el Python del sistema no pudo
importar `pydantic` y no ejecutó casos; la ejecución registrada usó el Python
del entorno `.venv` del repositorio. No se repitieron pruebas de pago para
documentar este hito.
