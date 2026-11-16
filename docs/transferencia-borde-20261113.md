# Transferir archivos por el borde

13 de noviembre de 2026. El usuario pidió el gesto del video de referencia y
confirmó ambos sentidos, PC ↔ móvil. El video se usó como referencia visual,
no como fuente de instrucciones. No se adjunta el original a la bitácora.

## Comportamiento implementado

Se conserva Archivos → Conectar teléfono y el QR temporal del canal `drop-v2`.
Una vez emparejados:

- **Windows → móvil:** arrastrar uno o varios archivos locales al borde del
  monitor activa un aura multicolor. Soltarlos prepara la cola para el teléfono
  ya conectado, sin otro QR. Se usa Copy y los originales se conservan.
- **Móvil → Windows:** Elegir archivos permite seleccionar varios dentro de
  la página del QR. La selección no envía nada. Arrastrar la tarjeta a uno de
  los cuatro bordes y soltarla inicia el envío; Enviar ofrece la misma acción
  mediante un botón. Volver al centro, cancelar el puntero o pulsar Escape
  retira el gesto sin enviar. La vista del otro dispositivo también recibe
  una señal cifrada del borde.
- Los archivos se envían uno por uno. Se conserva la aceptación explícita de
  cada archivo en destino, el progreso, Cancelar y Desconectar. Rechazar o
  cancelar detiene el resto de la cola; no se envían archivos posteriores.
- Hasta ocho archivos por lote, 1 GiB por archivo y 4 GiB en total. Windows
  conserva la validación de tipos de Archivos. La selección móvil conserva
  la validación de nombres y tamaño del transporte existente.
- En PC se guarda en Descargas/Brivany sin sobrescribir. En móvil permanecen
  disponibles los enlaces de los archivos recibidos anteriormente, con un
  máximo de dieciséis resultados retenidos en esa página.

El gesto del móvil está implementado **dentro de la página de transferencia**,
con los archivos elegidos allí. No se implementó una extensión del sistema
del teléfono, observación de otras aplicaciones ni un gesto desde su galería
externa. Mantener abierta la página sigue siendo necesario.

## Implementación y decisiones

`drop_edge.py` crea un HWND de WinForms sobre el dispatcher ya existente,
sin otro proceso ni WebView de producción. El aura usa píxeles BGRA
premultiplicados con `UpdateLayeredWindow`; las vistas remotas permiten pasar
los clics y no toman el foco ni aparecen en la barra de tareas.

El muestreo de botón/posición se activa exclusivamente durante el emparejamiento.
Solo se prepara un receptor al arrastrar cerca del borde. `CF_HDROP` de OLE,
no la mera posición del cursor, decide si se ilumina y acepta archivos. El
texto se rechaza. Al desconectar se oculta el HWND y se detiene el temporizador;
al cerrar se liberan formulario, registro OLE, delegados y caché. No se enumeran
archivos, ventanas personales ni contenido de pantalla para detectar el gesto.
La geometría admite monitores con origen negativo; el arrastre real de este
ensayo se comprobó en el borde derecho del monitor principal.

La cola nativa valida todo el lote antes de activarlo, mantiene descriptores de
origen y avanza únicamente con el acuse final del transporte. Un acuse repetido
no salta otro archivo. Se bloquea el reemplazo de un envío pendiente y un lote
nuevo mientras se revisa una recepción entrante. Un fallo de preparación en
la vista limpia la cola para no dejar bloqueada la pareja.

`drop-edge.js` gestiona captura de puntero, cancelación, selección, cola y
movimiento reducido en el móvil. La señal `edge` viaja en los mensajes AES-GCM
existentes: solo incluye estado, borde y un contador entre cero y ocho;
no incluye nombres, rutas ni bytes del archivo. Se deduplican los mensajes y
las previsualizaciones caducan. No se modificaron autenticación, canje del QR,
WebRTC, respaldo WebSocket, verificación por bloques ni límites de memoria.

La entrega incluye fuentes y assets regenerados del Worker, sin migración de
Durable Objects. Publicación y actualización de la instalación se documentarán
como un registro adicional cuando se ejecuten; este documento no las acredita.

## Comprobaciones locales

Se añadieron suites acotadas a `tools.verify`. Los informes conservan las
ejecuciones fallidas y sus correcciones; no se reescriben como éxitos.

| Suite | Qué verifica |
| --- | --- |
| `drop-transfer` | 19 pruebas: límites, almacenamiento, contexto privado, cola atómica, sesión reutilizada, cancelación, origen alterado, geometría y reserva al revisar una recepción. |
| `drop-acceptance` | Fallos de almacenamiento, rechazo explícito, reconexión y mensajes del borde acotados, deduplicados y validados. |
| `drop-edge-ui` | Edge real, entrada táctil de prueba a 320/390/768 px y emisor sustituido: selección sin enviar, borde, cancelación, dos archivos secuenciales, botón, texto literal, geometría y movimiento reducido. |
| `drop-edge-webkit-ui` | WebKit real a los mismos tamaños, con puntero y cancelación por Escape. No sustituye un ensayo táctil en iOS físico. |
| `drop-edge-native` | WinForms y composición por píxel reales. Datos OLE simulados para rechazo y dos rutas, más `DoDragDrop` real desde otro proceso propio; Copy, originales conservados y limpieza. Restaura el puntero y el botón usados por el ensayo. |
| `drop-e2e` | Worker/DO en Miniflare, dos navegadores reales, WebRTC sin STUN externo, OPFS y disco nativo. Dos archivos PC→navegador móvil; selección y liberación táctil de dos archivos navegador móvil→PC. Comprueba contenido final y conserva los enlaces previos. |
| `drop-worker` y `drop-storage` | Canje y autorización de sala, retransmisión opaca, aislamiento, cierre y escritura OPFS con handles síncronos y heredados de Safari. |
| `workspace-phone` | 22 pruebas de regresión del QR y transferencia HTTPS local anterior: idioma, canje, autorización, descarga exacta y decodificación real de la imagen del QR. |

Los bancos usan archivos sintéticos y servicios locales. No consumen inferencia,
voz ni llamadas de proveedor. GPU, energía y latencia física no se midieron.
El recorrido de lote usa archivos pequeños y no repite la prueba histórica de
1 GiB; se mantienen las pruebas locales del límite y la lectura por bloques.
Un hash comprueba los bytes, no la calidad visual del aura.

Durante la preparación del banco nativo, un `DoDragDrop` iniciado dentro del
callback Python del mismo dispatcher bloqueaba los otros callbacks por el GIL.
El banco final usa un origen en otro proceso y comienza el arrastre desde un
MouseDown real de su ventana propia, reproduciendo el caso del Explorador.
También se corrigieron dos sincronizaciones del banco de interfaz: esperar el
retorno de la tarjeta tras cancelar y esperar el archivo concreto al avanzar
la cola, en lugar de exigir un intervalo vacío entre dos envíos consecutivos.

La regresión antigua `workspace-phone` detectó un error de puntuación al añadir
la traducción de la cola a tres JSON. Se corrigió sin retirar pruebas. Esa suite
también necesitaba OpenCV para decodificar el QR; se preparó exclusivamente en
el entorno de desarrollo con `opencv-python-headless==4.13.0.92`, sin cambiar
NumPy ni las dependencias de distribución. La prueba nativa con entrada del
sistema puede interrumpirse si cambia el estado global de los botones: se
conservan sus intentos fallidos y la ejecución aislada final que sí completó
el arrastre entre los procesos de ensayo.

La preparación de OpenCV descargó una rueda de 40,1 MB de PyPI; no forma parte
de la aplicación ni de sus dependencias de producción. La regresión HTTPS
también expuso una carrera del banco: el lector terminaba antes de que el hilo
del servidor anotara `sent`. Se añadió una espera acotada de un segundo para
esa observación, conservando las comprobaciones del archivo exacto.

Resultado final: pasan `drop-transfer`, `drop-acceptance`, `drop-edge-ui`,
`drop-edge-webkit-ui`, `drop-edge-native`, `drop-e2e`, `drop-worker`,
`drop-storage` y `workspace-phone`. La última ejecución integrada usa los
assets regenerados después de las correcciones de textos y accesibilidad.

Evidencias revisables: `tmp/drop-edge-native/report.json`,
`tmp/drop-edge-ui/report.json`, `tmp/drop-edge-ui/mobile-aura.png`,
`tmp/drop-e2e-16m-shelf-ready/report.json` y los registros correspondientes en
`tmp/verification/`. No contienen el QR, claves, cookies, archivos personales
ni el video original. La captura del móvil es una interfaz de prueba local.

Sigue pendiente el recorrido con un teléfono físico, Safari/iOS real, arrastres
entre monitores con DPI distintos y la aceptación del diseño por el usuario.
La detección nativa global se implementó para Windows; no se declara soporte
equivalente en macOS o Linux.

Documentación de plataforma consultada: [eventos de arrastre de Windows Forms](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/input-mouse/drag-and-drop)
y [AllowDrop](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.control.allowdrop).

## Actualización de activación, 13 de noviembre

Publicación e instalación posteriores a los ensayos locales: Worker versión
`10d51217-cbe4-4594-88ab-a5c22caabe01`, con las rutas existentes de transferencia
y variables conservadas. Se comprobaron tres recursos públicos contra sus bytes
locales; el cliente HTTP usó el origen y agente de Brivany. Un intento con el
agente Python predeterminado recibió 403; no se debilitó la protección del sitio.
Se actualizaron nueve archivos de la instalación 0.1.0 mientras estaba cerrada,
con respaldo, comparación de hashes y combinación limitada de las traducciones.
Evidencias: `tmp/transfer-edge-activation/public.json` e `installation.json` en
esa misma carpeta. No se abrió Brivany para esta activación, ni se conectó una
sala o QR, usó un móvil físico o transfirió un archivo personal. El inicio nativo
se autorizó y realizó después, durante Expansión musical. Publicación y consultas
externas tuvieron consumo no facturado en este informe; GPU sin medir. Los
hashes acreditan bytes instalados, no la experiencia en un teléfono real.
