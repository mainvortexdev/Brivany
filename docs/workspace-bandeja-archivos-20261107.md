# WorkSpace: bandeja local de archivos

7 de noviembre de 2026. Se añade una bandeja de sesión inspirada en la entrega
de un archivo a la mascota de la referencia visual. Conserva el chat y la voz
de Melodi existentes.

[Ampliación posterior a Office, PDF y correo adjunto](#extractos-de-office-y-pdf-y-correo-con-adjunto).

## Comportamiento implementado

- El arrastre abre la bandeja, resalta el destino y recibe archivos. El selector
  nativo conserva referencias a los originales; el arrastre usa copias temporales.
- Admite ocho archivos de hasta 8 MiB, con un total máximo de 32 MiB.
  Se admiten los documentos y medios enumerados en `workspace_files.py`;
  se rechazan ejecutables, rutas, archivos ocultos y nombres inválidos de Windows.
- Lista nombre, formato, tamaño y carácter temporal. Permite retirar una entrada,
  abrirla con su aplicación y copiar su ruta. Retirar una referencia nativa nunca
  borra el archivo original. Se rechazan originales cambiados después de añadirlos.
- Preguntar prepara un borrador editable de chat. Para texto UTF-8 incluye un
  extracto de hasta 650 caracteres, señalado como datos del documento; para otros
  formatos prepara solo el nombre y explica que el contenido no se ha analizado.
  No envía preguntas ni activa inferencias automáticamente.
- Correo abre un redactor `mailto` con el nombre del archivo. Explica que hay que
  adjuntarlo manualmente y conserva la distinción entre borrador, adjunto y envío.
- La recepción emite `brivany-files-added` para el efecto de ingestión visual.
  El almacenamiento no conserva una copia de los archivos en la bitácora.

## Consumo y ciclo de vida

La bandeja no incorpora sondeos, bucles de animación ni solicitudes a proveedores.
El estado se notifica a barra y panel al cambiar y se consulta una vez al arrancar.
Los archivos elegidos con el selector se mantienen como rutas con tamaño y fecha;
no se cargan enteros en memoria. Las copias arrastradas se guardan en un directorio
temporal de sesión y se retiran al quitar el archivo o cerrar la sesión. La apertura
externa puede mantener un archivo temporal bloqueado en Windows; su limpieza no
se certifica mientras otro programa lo mantenga abierto.

La consulta de texto lee como máximo 4 KiB y no inicia análisis de PDF, Office,
imágenes, audio o video. Esos analizadores no se presentan como implementados.
Las rutas temporales copiadas son válidas únicamente durante la sesión.

## Pruebas locales del 7 de noviembre

`tools.verify workspace-files`: 12 casos aprobados, con documentos sintéticos.
Comprueban límites, rechazo de rutas/nombres peligrosos, originales preservados,
detector de cambios, limpieza temporal, borradores, ausencia de contenido privado
en instantáneas de UI, confianza del puente y correo sin envío ni adjunto implícito.
Informe: `tmp/verification/workspace-files-20261107T172659-74c66077.json`.

`tools.verify workspace-files-ui`: aprobado con Edge sin interfaz visible.
Se comprobaron selección de archivos, arrastre DOM, evento visual de recepción,
rechazo antes de transferir de formatos incompatibles y archivos grandes,
borrador editable sin envío, quitar, abrir, copiar, correo y ajuste a 320 px.
Informe: `tmp/verification/workspace-files-ui-20261107T172700-f1296a43.json`.

Se usaron el DOM y eventos de archivos reales con un puente nativo sustituido.
No certifica el diálogo físico de Windows, asociaciones de archivos ni un cliente
de correo configurado. Las llamadas de apertura y correo fueron sustituidas.
La primera invocación UI falló por una ruta antigua de Playwright; se corrigió
para usar la dependencia incluida en Codex y se ejecutó de nuevo con registro.
Ambas suites registradas consumieron cero solicitudes de proveedor y cero segundos
de GPU de inferencia; no miden CPU/RAM de la aplicación nativa completa.

## Revisión posterior de seguridad y ciclo de vida

La revisión detectó dos mejoras concretas: la limpieza temporal dependía del
cierre de proceso y un `dragenter` por cada descendiente podía repetir el cambio
nativo de panel. Se añade una llamada de limpieza a la secuencia de salida de
Desktop y se limita la expansión al primer ingreso de cada arrastre. Un panel
de archivos ya abierto no repite la solicitud de diseño al recibir el drop.

La continuación pasó 13 pruebas de backend y siete grupos de UI; conserva las
comprobaciones previas y añade cierre explícito, tres entradas anidadas con una
sola expansión y arrastre simulado entre dos documentos separados (barra/panel)
con una sola transferencia. No acredita el arrastre físico del explorador de
Windows. Informes nuevos:
`tmp/verification/workspace-files-20261107T172922-3a38bec2.json` y
`tmp/verification/workspace-files-ui-20261107T172923-26ed6e6c.json`.

Se revisaron nombres de Windows y alternate data streams, extensiones ejecutables,
límites base64 antes de decodificar, cuota total, puentes protegidos por el mismo
origen local de Desktop, identificadores opacos, conservación de originales y
render de nombres como texto. La bandeja no lee el portapapeles ni envía su
contenido; solo copia una ruta cuando el usuario pulsa ese control. Los extractos
se marcan como datos y siempre requieren revisión y envío del usuario: esa marca
no garantiza por sí sola inmunidad de un modelo a instrucciones en documentos.

## Extractos de Office y PDF y correo con adjunto

En la continuación del 7 de noviembre, **Preguntar** lee texto local de DOCX,
XLSX, PPTX y PDF con capa textual. El extracto queda editable en el mismo
compositor y deja espacio para la pregunta. Las etiquetas del documento
se escapan y el extracto se acota a 650 unidades UTF-16. La bandeja conserva
su límite de 8 MiB por archivo y solo lee el contenido tras la acción del usuario.

Word lee los párrafos del cuerpo, incluidas las tablas. Excel recorre las
hojas visibles en el orden del libro y lee texto compartido, texto inline y
valores guardados. PowerPoint sigue el orden de la presentación y separa
las diapositivas. La lectura de XML limita tamaño y número de partes, rechaza
DTD y omite relaciones externas. No se ejecutan macros ni se recalculan
fórmulas. Se extrae texto, con el formato visual fuera del alcance.
[Cadenas de Excel](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table),
[orden de hojas](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-sheets),
[orden de diapositivas](https://learn.microsoft.com/en-us/office/open-xml/presentation/how-to-open-a-presentation-document-for-read-only-access).

PDF usa pypdf fijado en las dependencias de Desktop. Abre un proceso solo al
consultar, lee hasta las primeras ocho páginas y termina la consulta a los
cuatro segundos. Los flujos descomprimidos están acotados. Windows aplica
192 MiB de memoria comprometida al proceso y Linux limita su espacio de
direcciones. Un archivo cifrado, dañado o sin texto recibe un estado específico.
Los escaneos sin capa textual requieren OCR, pendiente en este recorrido.
[Extracción PDF](https://pypdf.readthedocs.io/en/7.0.0/user/extract-text.html),
[límite de memoria en Windows](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information).

**Correo** ahora pide dónde guardar un archivo `.eml`. El mensaje lleva el
adjunto completo, asunto y cuerpo de borrador, y deja el destinatario vacío.
Se escribe de forma atómica y se solicita su apertura con la asociación del
sistema. Si la apertura falla, el archivo guardado sigue disponible. La
aplicación de correo decide cómo presentar el archivo; su apertura en el
cliente del usuario quedó pendiente. Brivany no usa una cuenta ni envía correo.
[Apertura de EML en Outlook](https://support.microsoft.com/en-us/outlook/mail/open-eml-msg-and-oft-files-in-new-outlook-and-outlook-on-the-web).

Pasaron 21 casos del backend, incluido el límite real del proceso en Windows,
el cierre por tiempo, el descarte de PDF cifrado y la comparación exacta del
adjunto. Se comprobaron también tres documentos generados por python-docx,
openpyxl y python-pptx con contenido sintético. En WebView2 propio, los botones
prepararon DOCX y PDF en el chat y escribieron MIME real con selector y
cliente de correo sustituidos. Se mantuvieron las pruebas de arrastre, diseño
estrecho y terminal. Los ensayos se ejecutaron sin solicitudes a proveedores.

[Backend](../tmp/verification/workspace-files-20261108T033959-33528fbb.json),
[recorrido WebView2](../tmp/verification/workspace-files-native-20261108T033907-57063754.json),
[archivos Office generados](../tmp/verification/workspace-office-packages-20261108T033433.json),
[UI de Archivos](../tmp/verification/workspace-files-ui-20261108T033305-139402ef.json),
[diseño](../tmp/verification/workspace-design-ui-20261108T033959-ef8ccbe4.json),
[regresión de terminal](../tmp/verification/terminal-20261108T033907-b7f6c7f8.json).
