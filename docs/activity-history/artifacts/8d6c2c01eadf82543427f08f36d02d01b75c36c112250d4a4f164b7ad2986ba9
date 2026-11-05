# Traducción auditiva desde WorkSpace · 0.4.2

El botón **Traducción auditiva** pide a la extensión que seleccione el video de
la pestaña activa del navegador conectado. Se conserva la selección automática
cuando hay un solo video visible en YouTube y el pin cuando hay que elegir entre
varios. La primera vez se concede el permiso desde el icono de la extensión en
el sitio correspondiente. La orden local autenticada vence en cinco segundos.
Si hay más de un navegador conectado, Brivany solicita dejar uno para evitar
seleccionar una pestaña ambigua. Se conserva el arranque desde el propio icono.

La extensión captura el audio del elemento seleccionado. Muse transcribe de
forma progresiva y separa hablantes. Meta traduce los fragmentos y Cartesia
sintetiza la voz asignada a cada hablante. Los subtítulos disponibles siguen
sirviendo para anticipar fragmentos que después confirma la transcripción.
Con clonación autorizada, las muestras reales se procesan en segundo plano y
las voces temporales disponibles se usan en frases posteriores.

**Ajustes → Melodi WorkSpace → Mostrar transcripción en el navegador** se
activa de forma predeterminada. El cambio llega a la sesión en curso y se
guarda localmente como una preferencia booleana. La transcripción sigue
alimentando la voz mientras su texto está oculto.

Una demora de 750 ms en el envío a Muse reproducía «Se acumuló demasiado audio
de entrada. Sesión detenida». El productor nativo espera ahora capacidad antes
de retirar el siguiente bloque de la cola de captura. Los controles y la parada
tienen prioridad. Una prueba larga posterior detectó un segundo rechazo en la
entrada de la extensión, a los 18,45 s. El receptor con ACK retiene un bloque
hasta recuperar margen de ritmo y lo confirma después de aceptarlo. Conserva
las colas acotadas y el rechazo de ráfagas de la ruta antigua sin ACK.

## Comprobaciones

- Las suites locales verifican el puente autenticado, permisos y vencimiento,
  ajustes persistentes, control de voz y secuencia de ACK. La regresión de
  entrada continua transmite 420 bloques con tres demoras de 750 ms y comprueba
  integridad de los bloques, una sola sesión de ASR y parada inmediata.
- La interfaz se probó con puente sustituido. La barra solicita arranque en el
  navegador, conserva el idioma elegido y ofrece parada en cinco anchos. El
  ajuste se verificó en tres anchos y tras recargar la vista.
- Brave aislado y video propio con transporte sustituido verificaron la orden
  de WorkSpace, selección única en una página de prueba con URL de YouTube,
  elección por pin, ocultación y reaparición del texto con audio en curso.
  Informe `tmp/selected-video/probe-1793772136739.json`. Los ensayos previos
  conservan las carreras observadas de comprobación y la corrección del idioma.
- Primer ensayo real con el nuevo flujo de entrada, a partir de voces sintéticas
  propias reutilizadas. Windows consumió 103.680 bytes traducidos antes del
  rechazo de ritmo. Informe `tmp/selected-video/native-extension-1793771280350.json`.
- Tras corregir la espera de ACK, la prueba real recorrió Brave aislado, Brivany,
  Muse, Meta, Cartesia y WinMM durante 42,02 s. Ambas frases llegaron al dispositivo,
  con la segunda después de los 28 s. El dispositivo consumió 207.360 bytes de
  traducción sin error. El primer audio se observó a 8 s desde el inicio del
  ensayo, que programa la primera voz fuente con 2 s de espera. Informe
  `tmp/selected-video/native-extension-1793772171042.json`.

Las pruebas reales usaron dos muestras sintéticas propias, sin micrófono ni
clonación. El coste y el número agregado de llamadas permanecen desconocidos.
La evidencia registra eventos y contadores, sin incluir medios ni transcripciones.
Quedan pendientes la comprobación en el YouTube del usuario y la escucha física.

Brivany quedó iniciado con el nuevo receptor. El paquete 0.4.2 contiene 17
archivos verificados contra el código fuente. Las carpetas de distribución ya
usadas se actualizaron para que baste recargar la extensión y luego la pestaña.
