# WorkSpace: apertura sin destellos y dimensiones definitivas

Corrección solicitada el 1 de noviembre de 2026, posterior al chat compacto.
El usuario detectó un destello claro al mostrar el selector y un reproductor de
música que aparecía compacto antes de adoptar sus medidas finales.

El backend de pywebview/WebView2 dejaba sin configurar el fondo de WinForms al
crear una ventana transparente. Su fondo claro podía quedar expuesto durante
la composición. En las superficies propias ahora se fijan tanto el fondo del
formulario como el del WebView2 a negro opaco antes de mostrarlas. El documento
declara también el esquema oscuro desde su cabecera. Las regiones nativas
siguen excluyendo el hueco entre los dos botones: el fondo oscuro no crea un
rectángulo que intercepte clics en ese espacio.

El selector utiliza su región definitiva desde el primer fotograma. Se elimina
la traslación CSS simultánea y el crecimiento de su recorte nativo; la entrada
es un fundido nativo de 180 ms. Ocultar o cerrar invalida cualquier fundido
anterior. Con movimiento reducido la entrada es inmediata. Al cambiar de tipo
de panel se retira el contenido anterior antes de actualizar la región y de
mostrar el nuevo, evitando fragmentos de la vista precedente.

Música tenía dos redimensionamientos: la apertura con `music` de 336 × 212 antes
de conocer la conexión y el crecimiento animado desde una región cerrada. La
conexión se resuelve con el estado local ya guardado, sin esperar una consulta
de reproducción a Spotify. El primer estado enviado al panel incluye esa
conexión y las medidas correctas: reproductor 720 × 232, biblioteca 720 × 404
cuando la pantalla admite esas medidas. En pantallas menores se mantienen los
límites y las medidas adaptativas existentes. La barra conserva la subvista de
música al reabrirla. Las superficies de música también tienen su región final
antes de aparecer; se usa fundido de opacidad en vez de crecimiento de tamaño.
La carga de canciones/biblioteca puede continuar sin alterar esas dimensiones.

La prueba inicial encontró otra causa: el evento nativo de carga podía preceder
a la disponibilidad del controlador del panel. Se ignoraba silenciosamente el
estado enviado y quedaba visible el CSS provisional de 336 × 148. Ahora el
panel permanece oculto hasta confirmar que su controlador recibió y aplicó la
revisión de diseño. La espera está acotada y descarta revisiones superadas; no
se expone contenido provisional si no está preparado.

## Comprobación

`work` cubre abrir/cerrar repetidamente, ocultar la vista anterior antes del
nuevo estado y resolver las medidas musicales con un proveedor que sólo ofrece
estado local. `workspace-chat-ui` conserva conversación, reapertura, Live
sustituido y cinco anchuras. La prueba nativa de WebView2 comprueba valores RGBA
reales de ambas capas, tres fundidos de alfa monotónicos de 0 a 255, región
completa antes de mostrar y entrada inmediata con movimiento reducido. También
comprueba las dimensiones iniciales del reproductor y de biblioteca y que la
conexión esté pintada en el DOM antes de mostrar.

Son ventanas propias reales con conversación, Spotify y micrófono sustituidos;
no se envía entrada al SO ni se abre un micrófono para estas pruebas. La
comprobación de RGBA y alfa detecta la causa y la secuencia de composición, pero
no constituye una medición de todos los fotogramas del compositor de Windows
ni una certificación en macOS/Linux. El motor emitió una advertencia de limpieza
de un archivo temporal de métricas en una ejecución; se conserva su informe.
No se borraron manualmente perfiles del navegador del usuario.

La suite `work` pasó 32 casos. La comprobación nativa final confirmó las medidas
iniciales tanto de región como del DOM y el estado de conexión antes de mostrar,
además de los tres fundidos y el chat. Se conservan los intentos nativos fallidos
que revelaron la carga temprana y el arnés que reaccionaba al cursor del usuario;
la geometría del arnés ahora se controla explícitamente, sin leer ese cursor.

Resultados concretos y evidencia quedan en el registro local de este hito. La
corrección se añade al histórico anterior, sin sustituir sus pruebas ni fallos.
