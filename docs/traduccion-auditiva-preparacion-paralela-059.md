# Preparación inicial: análisis solapados y tiempos de fase · 059

La preparación conservaba una espera evitable: después de transcribir los siete
segundos y clasificar sus turnos, esperaba los dos análisis remotos opcionales
de prosodia antes de iniciar todos los análisis locales de timbre. El modelo
local no necesita el resultado remoto para analizar el audio; sólo la decisión
de combinación necesita ambas respuestas.

Ahora un único trabajador local analiza secuencialmente los turnos de habla
mientras progresan, como máximo, los dos análisis remotos existentes. No se
añaden llamadas, muestras ni modelos. El modelo conserva su límite de un hilo
de inferencia y no se crea una cola de trabajo local por turno. Al cancelar,
termina la inferencia local ya iniciada y se comprueba la cancelación antes de
iniciar la siguiente. Los análisis remotos conservan sus plazos y cancelación.

La combinación mantiene la regla anterior: un resultado local disponible,
incluso incierto, se conserva como evidencia local; si el modelo no está
disponible y el consejo remoto tiene timbre fiable, se conserva ese consejo.
Emoción y registro permanecen separados. No se cambia el corte de siete
segundos, la recuperación de intervenciones incompletas ni la distinción entre
etiquetas de sesiones ASR diferentes.

El filtro completo de canciones sigue ejecutándose antes de Muse y de los
análisis de voz. Una apertura clasificada con suficiente evidencia como música
o canto no abre esos servicios. Esta corrección no introduce reconocimiento
en streaming ni vuelve a enviar el prefijo a otro ASR.

## Medición

`PreparedPrefix.preparation_metrics` es una tupla inmutable de pares
`(nombre, milisegundos)`; su representación ordinaria no la incluye. Todos los
valores generados son números finitos no negativos obtenidos con un reloj
monótono. Se informan sólo las fases realmente ejecutadas:

- `content_gate_ms`: construcción y filtro completo inicial de canciones.
- `asr_ms`: una llamada ASR del prefijo.
- `turn_classification_ms`: lectura de turnos confirmados y clasificación de
  sus intervalos.
- `prosody_ms`: tiempo de pared de los análisis remotos existentes.
- `local_timbre_ms`: tiempo de pared del trabajador local único.
- `postprocess_ms`: tiempo de pared desde la respuesta ASR hasta completar
  clasificación, análisis y combinación.
- `total_ms`: preparación del servidor, desde la entrada del PCM completo.

La captura previa del navegador no forma parte de `total_ms`. Prosodia y timbre
se solapan; sus tiempos no se suman para obtener el tiempo de pared. Una
apertura de canción sólo tiene `content_gate_ms` y `total_ms`; no se rellenan
falsos ceros de ASR o análisis que no se hicieron. Un resultado ASR sin turnos
tampoco informa fases de prosodia o timbre.

El ensayo real anterior de referencia guardó 14,230 s de preparación total
desde el inicio de captura; otra prueba posterior informó 15,673 s. Esos
informes no contienen esta separación de fases, de modo que no se atribuye toda
esa espera a Muse ni se declara una reducción real por esta modificación.
El siguiente ensayo deberá medir sus fases con el mismo video y conservar
resultado, límites y consumo, sin guardar texto ni audio original en la bitácora.

## Comprobaciones locales

Se añaden barreras entre un análisis local y los dos remotos: prueban el
solapamiento sin depender de umbrales frágiles de velocidad. El máximo local
observado en el caso es uno y el remoto dos. Se comprueba también cancelar
después de la primera inferencia sin iniciar la segunda; conservar la regla de
confianza; omitir trabajo y métricas no ejecutadas en canciones y ausencia de
habla; y representar los tiempos mediante tuplas sin datos de contenido.

`tests.test_prefix_translation` pasa sus catorce casos con transportes y análisis
sustituidos. No se hacen nuevas inferencias pagadas. El éxito local no acredita
latencia real, atribución correcta de hablantes ni fidelidad del doblaje.

## Integración y resultado registrado

La suite admitida `sync-relay` aprobó 94 casos en
`docs/verification-history/sync-relay-20261104T174736-4cdb151c.json`. Incluye los casos
de esta preparación, el corte de restos estables 058 y el transporte de métricas.
La comprobación dirigida posterior del transporte y saneamiento pasó siete
casos. La sintaxis del JavaScript del banco y del probe también se comprobó.
Estos resultados son locales; no se abrieron servicios de traducción nuevos.

El mensaje `prefix-ready` sólo añade una lista cerrada de duraciones finitas
no negativas. `capture_receive_ms` mide la recepción del prefijo en el servidor
y tiene límite de doce segundos; no sustituye la duración del audio, que sigue
siendo exactamente siete segundos. Se conservan los constructores anteriores,
la autenticación, el vínculo con el video, la caducidad y la cancelación.
El probe y el banco vuelven a filtrar los campos. Datos no enumerados, texto,
PCM y credenciales no se incorporan a estas métricas.

El banco muestra la espera previa completa cuando exista `elapsed_ms`, aparte
de los siete segundos de contenido. Puede mostrar reconocimiento, clasificación,
timbre y prosodia cuando el nuevo informe los mida. Aclara que los dos últimos
trabajos se solapan y que sus tiempos no se suman. Esa presentación pasó revisión
de sintaxis, pero no se verificó visualmente después de este cambio.

Se preparó una instancia para el siguiente ensayo, sin iniciarlo. Al intentar
abrirla en el navegador integrado, el control respondió que el uso local del
navegador estaba deshabilitado en los ajustes de Work. No hubo ejecución real
del banco ni consumo nuevo de proveedores en ese intento. No se usó otro
mecanismo para eludir esa restricción. Por tanto, el ahorro real del solapamiento,
las nuevas fases y el corte 058 siguen pendientes de medición. El último ensayo
real continúa siendo el 057, rechazado por retraso, sin atribución humana de
voces ni verificación del video completo.

## Continuación posterior: apertura recuperada y fases reales 062

Después de restablecerse la sesión de control, una apertura normal del banco
integrado pudo ejecutarse. El primer intento nuevo, 060, agotó la apertura
antes del doblaje con un intento Muse del prefijo; se conserva separado.
La comprobación directa del video incorporada en 061 pasó sus regresiones
locales y el siguiente ensayo real 062 pudo confirmar identidad y reproducción.
Estos resultados posteriores no reescriben el intento anterior deshabilitado.

El ensayo real `inline-sync-1793816151318.json` conservó 2344 ms de prosodia,
1969 ms de timbre local y 2359 ms de posprocesado, evidencia del solapamiento
medido. La espera completa del navegador fue 12,059 s y la preparación del
servidor 5,016 s, aparte de la recepción de siete segundos. La reducción frente
a otro ensayo no se atribuye íntegramente a este cambio: las respuestas remotas
y los intervalos difieren. El resultado global volvió a fallar por retraso,
sin atribución humana o continuidad de todo el video acreditadas.
[Fases, quince voces, consumo y límites](traduccion-auditiva-fases-reales-062.md).
