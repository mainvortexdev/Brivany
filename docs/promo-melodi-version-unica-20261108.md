# Melodi: nueva referencia y selección de una sola versión

Se adapta la secuencia del segundo video aportado por el usuario. La primera
revisión contenía dos paneles sincronizados. Después de rechazar las formas
básicas del lienzo, el usuario pidió conservar exclusivamente la versión de
Melodi de la derecha. Esa es la entrega final:1080×1080, seis escenas,
719 cuadros a60000/1001fps. Video11,995317 s; audio/contenedor12,074 s.

Entrega local: `Exports/Melodi-Brivany-20261108/Melodi-Brivany.mp4`.
[Proyecto, cambios y reproducción](../videos/brivany-melodi-solo-20261108/README.md).
[Metadatos de entrega](../videos/brivany-melodi-solo-20261108/delivery-verification.json).

Se retiran el panel izquierdo, marco y rótulos. La imagen se amplía930→1080
uniformemente. Se conservan esquina de ventana/cursor, iconos cromáticos,
instrucción, documento/resultados, icono pequeño y cierre de Melodi sobre negro.
El audio AAC original se monta sin recodificar y conserva el hash de paquetes.
No se sintetizó ni se añadió locución. La comparación de hashes acredita datos,
no semántica, ausencia de voz por escucha humana ni coincidencia visual exacta.

Durante la revisión anterior se generó una visualización arquitectónica para
reemplazar las tres apariciones del lienzo básico. Herramienta integrada
ImageGen: una solicitud, consumo no informado. El usuario seleccionó después
la mitad derecha; ese arte pertenece al panel descartado y queda guardado,
sin reaparecer las formas básicas. [Prompt y procedencia](../videos/brivany-dual-20261108/ART_PROMPT.md).
Es arte conceptual, no una prueba de generación desde la aplicación ni un
proyecto constructivo físicamente validado.

HyperFrames0.9.23 pasa runtime, geometría y contraste en Chrome. Una auditoría
local comprueba nueve condiciones y enumera31 tweens: solo un panel por escena,
sin formas básicas, imágenes cargadas, texto de instrucción completo,
secuencia de tarjetas y cierre. No envía instrucciones a Melodi. El MP4
decodifica719 cuadros. Las pequeñas etiquetas y recortes de la ventana son
parte de la composición y se revisaron en capturas.

El usuario observó un bloque rojo y colores corruptos en la vista previa.
La captura PNG fuente coincide con la original local y las capturas de Chrome
la muestran normal. También se inspeccionaron cuadros decodificados del MP4
a6,4 y6,65 s: el panel de agentes se ve normal. Se documenta la diferencia,
sin atribuir una causa técnica que no se ha demostrado y sin afirmar que se
corrigió el editor de vista previa. El archivo exportado es la entrega revisada.

El render final duró59,5 s de pared con captura screenshot y GPU Intel.
Segundos efectivos de GPU y tráfico externo total sin medir. La renderización
doble se interrumpió al cambiar el usuario la selección. Se conserva el
proyecto previo; no se hicieron llamadas ni se publicaron archivos. No se
cambió código de la aplicación; no correspondía repetir suites de aplicación.
No se adjuntan originales de audio, video ni conversaciones a la bitácora.
