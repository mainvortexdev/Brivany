# Transferencias de 1 GB y reinicio privado

10 de noviembre de 2026. Amplía Archivos → Teléfono para transferir en ambos
sentidos. El límite por archivo es **1 GiB (1.073.741.824 bytes)**, superior a
1 GB decimal; la bandeja admite hasta ocho entradas y 4 GiB en total. También
admite vídeos MOV/MKV, HEIC, archivos ZIP/7z/RAR y binarios de datos BIN.
El selector conserva las demás restricciones de nombres y tipos.

## Uso

Con un archivo en la bandeja, Teléfono prepara el QR. Sin archivo, Conectar
teléfono permite emparejar para recibir. El QR abre
`https://brivany.vetsa.es/transfer/drop/` con HTTPS válido. El destinatario
acepta cada archivo y ve progreso; desde la misma página puede enviar uno al
PC. Este pide aceptación y guarda en Descargas/Brivany. Nunca sobrescribe un
archivo existente: añade un sufijo y conserva el original. Ruta del archivo
selecciona el resultado en el Explorador.

Arrastrar o añadir un archivo lo deja seleccionado en la bandeja. Conectar
teléfono conserva esa selección; tras escanear el QR, Enviar reutiliza el
archivo preparado sin abrir el selector de Windows. Si hay varios archivos,
se puede seleccionar otro en la bandeja antes de conectar. El selector solo
se abre al pulsar Enviar archivo si la bandeja está vacía. La selección se
conserva en las actualizaciones de estado y se sustituye si se retira el archivo.

El QR se consume una vez y caduca a los diez minutos. La sesión emparejada
puede durar hasta seis horas, para permitir archivos grandes y nuevos envíos.
Cancelar un archivo elimina su copia parcial; Desconectar o cerrar Brivany
termina la sesión. El teléfono debe mantener abierta la página durante la
transferencia. No requiere cuenta ni instalar Brivany en el teléfono.

## Transporte y memoria

Los dispositivos intentan conectar por WebRTC DataChannel. Si la red impide
esa vía, usan el respaldo WebSocket del dominio oficial. Puede pasar del
respaldo a la conexión directa tras vaciar los bloques pendientes, evitando
que las dos rutas reordenen los datos. La sesión puede reconectar y continuar
desde el último bloque guardado y verificado mientras ambas páginas sigan
abiertas; no se promete recuperación tras cerrar el navegador o el programa.

Los mensajes y bloques se cifran con AES-256-GCM usando una clave aleatoria
del QR. También se autentica la señalización WebRTC; los DataChannels añaden
DTLS. Cloudflare solo conserva la autorización, el plazo y las conexiones de
la sala. Los archivos grandes no se almacenan en SQLite ni se suben enteros
antes de mostrar el QR. Cada pareja tiene un Durable Object independiente y
dos roles autenticados; la barra nativa refleja estados pero solo el panel
mantiene la conexión, evitando que las dos ventanas se expulsen mutuamente.

Las lecturas y escrituras son de hasta 256 KiB, con una ventana de hasta
2 MiB pendiente de confirmación. Cada bloque lleva SHA-256 y el receptor lo
confirma después de escribirlo. Se comprueba tamaño y modificación del origen
durante la lectura. Los archivos grandes se escriben por bloques en disco,
sin construir un ArrayBuffer o Blob con todo su contenido en RAM.

En Windows, el canal binario reutiliza el servidor privado de la aplicación,
la sesión nativa y una autorización de la transferencia; solo expone el
archivo seleccionado y las recepciones aceptadas. Evita serializar cada bloque
como Base64 a través de pywebview. Arrastrar archivos grandes a la bandeja usa
la misma idea, con una copia temporal en disco por bloques. Los extractores de
documentos y el exportador de correo conservan sus límites independientes de
lectura, para no cargar adjuntos de 1 GB en memoria.

En el teléfono se usa un Worker y OPFS para escribir en disco; al terminar se
ofrece Guardar archivo. El navegador gestiona su cuota y debe haber espacio.
Las copias temporales OPFS anteriores a doce horas se limpian al volver a
abrir la página. Un navegador privado puede imponer una cuota inferior al
límite del programa; el cliente muestra el error de espacio y elimina la
recepción parcial. No se afirma cifrado en reposo de los archivos que el
usuario ya aceptó guardar en sus dispositivos.

### Corrección tras la prueba del iPhone

El usuario informó que la web abría y mostraba Recibir, pero el PC indicaba
Envío cancelado al aceptar. Se reprodujo una cancelación en WebKit para
Windows: no expone RTCPeerConnection y la negociación opcional abortaba el
archivo. La falta de WebRTC y los errores SDP/ICE ahora conservan el canal
cifrado alternativo. Esta reproducción no identifica por sí sola la causa
exacta en el iPhone del usuario.

Un fallo al preparar el almacenamiento también se convertía en un rechazo
voluntario. Ahora se diferencia del botón Rechazar, se transmite solo un
código de error permitido y ambos dispositivos conservan el aviso concreto,
incluso después de actualizar el estado nativo. No se envían excepciones,
rutas ni mensajes internos del dispositivo al otro extremo.

La estimación de cuota es opcional y no bloquea OPFS cuando no está disponible
o el navegador la rechaza. Se esperan también las operaciones asíncronas de
los access handles de Safari anteriores. Si un visor QR restringe OPFS o los
Workers, los archivos de hasta **16 MiB** pueden recibirse con una alternativa
en memoria estrictamente acotada. El límite general sigue en 1 GiB, pero
archivos mayores requieren almacenamiento en disco permitido por el navegador.
No se eleva el consumo de RAM a 1 GiB para sortear esa restricción.

Pruebas de esta corrección: 16 MiB en ambos sentidos con WebKit y almacenamiento
restringido, descarga y SHA-256 independientes; pruebas de rechazo frente a
fallos de recepción y de los access handles asíncronos. WebKit para Windows
rechazó OPFS con UnknownError en el perfil privado usado: su ensayo emplea la
alternativa de 16 MiB y no certifica recepción de 1 GiB en iOS. La prueba física
del iPhone se repitió y el usuario confirmó que recibió el archivo. No se
conoce el tamaño recibido en esa prueba física; no certifica 1 GiB en iOS.
El recorrido posterior `tmp/drop-e2e-16m-webkit-shelf-ready/report.json` verifica
un archivo arrastrado de 1 KiB, conexión posterior, Enviar sin selector y
recepción completa con hash. Este último recorrido usa puente nativo y WebKit
reales en el PC, sin teléfono físico ni consumo remoto.

## Reinicio para cargar cambios

Se incorpora `/api/desktop/lifecycle`, accesible solo desde loopback con una
capacidad privada por proceso. El registro de control está en
`User Data/.local/runtime/control.dpapi`, cifrado con Windows DPAPI. El cliente
rechaza redirecciones, proxies y PID reutilizados; la respuesta de estado no
incluye la credencial ni conversaciones.

El reinicio espera la persistencia del borrador y el historial, solicita la
salida normal y abre la aplicación cuando el proceso anterior terminó. Si
hay una llamada, grabación, transferencia incompleta o lienzo sin guardar,
se bloquea el reinicio. Un fallo de guardado conserva la aplicación abierta.
Si hay una actualización firmada ya preparada, se delega en el actualizador
existente. El mecanismo no termina procesos a la fuerza ni cambia tokens,
ajustes, chats o la carpeta de datos del usuario.

El agente puede usar `python -m tools.manage_brivany status`,
`stop --wait`, `restart --workspace --wait` y `start --workspace` desde el
repositorio. La instalación también admite `Brivany.exe --restart`,
`--restart --island`, `--stop` y `--status`. Para parches locales se puede
cerrar, aplicar el despliegue reversible y abrir, sin depender del identificador
de ventanas del control externo. El cliente incluye una preparación inicial
para versiones sin este mecanismo: verifica el ejecutable y solicita el
cierre normal de su ventana principal, sin forzar procesos.

## Evidencia

- `tmp/drop-e2e-1g/report.json`: archivo real sintético de 1 GiB PC → navegador
  móvil → PC, con perfiles de navegador normales, OPFS, API binaria nativa y
  WebRTC reales. La descarga y el archivo final del PC coinciden en SHA-256.
  Se transfieren dos veces 1.073.741.824 bytes; no se sustituye el contenido
  por un contador. Los perfiles y archivos grandes del ensayo se eliminan.
- `tmp/drop-e2e-16m-relay-interrupt-real/report.json`: recorrido real por
  HTTPS/WSS oficiales con 16 MiB por sentido, respaldo forzado y un corte
  provocado. Verifica reanudación, contenido final, API privada y propietario
  único de la conexión entre barra y panel. No omite TLS ni usa archivos
  personales. El tráfico remoto cifrado de ese ensayo figura en su informe.
- `tmp/drop-worker/report.json`: runtime Workers/DO, canje único concurrente,
  autenticación, aislamiento, reenvío opaco en ambos sentidos y cancelación.
- `tests/test_drop_transfer.py` y `tests/test_drop_http.py`: límites, origen
  modificado, digest/posición, aceptación previa, importación por bloques,
  guardado sin sobrescritura, sesión de escritorio y capacidad privada.
- `tests/test_lifecycle.py`: autenticación, DPAPI, orden guardar/esperar/cerrar,
  conservación ante fallo, bloqueo por actividad y delegación al actualizador.

La primera prueba de 1 GiB en un contexto privado de Edge alcanzó su cuota
alrededor de 800 MiB y se canceló; se conserva ese informe separado. La prueba
completa pasó con almacenamiento normal en disco. El pico de Python observado
es memoria trazada del ensayo, no RAM total del programa o del navegador.

La comprobación remota tiene consumo de tráfico, solicitudes y ejecución;
no cambia el plan de facturación y no se declara coste o consumo cero. No se
ha probado todavía un iPhone físico ni una transferencia de 1 GB a través de
una red móvil real. Los informes no contienen QR, claves, cookies, credenciales
ni contenido personal.
