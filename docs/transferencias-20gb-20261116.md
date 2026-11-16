# Transferencias de 1.000 archivos y 20 GB

16 de noviembre de 2026. Petición del usuario: enviar más de cien archivos desde
su iPhone y aumentar la subida a 20 GB; después, publicar los cambios en GitHub
para la evaluación del equipo de Jon.

## Comportamiento

- Hasta 1.000 archivos y 20.000.000.000 bytes en total por lote, también como
  máximo de un archivo individual. Las etiquetas usan GB decimales.
- El selector del móvil permite añadir archivos en varias selecciones sin
  descartar lo ya elegido. Elegir no envía: se mantiene Enviar y el gesto al borde.
- El PC muestra «Recibir N archivos» y autoriza ese lote una sola vez. El resumen
  cifrado identifica lote, posición, número y bytes; cambiarlo, excederlo o saltar
  posiciones detiene el envío. Cancelar, rechazar o fallar retira los pendientes
  y la autorización automática. Un lote nuevo requiere otra confirmación.
- Los originales se conservan y el destino sigue siendo Descargas/Brivany, sin
  sobrescribir archivos. Se mantiene la verificación SHA-256 de cada bloque.
- Bloques de 256 KiB, ventana de hasta 2 MiB y un único archivo activo. La cola
  de PC abre el descriptor del siguiente archivo al necesitarlo; 1.000 archivos
  no mantienen 1.000 descriptores abiertos. El teléfono lee File.slice por bloques.
- La espera inicial de WebRTC se comparte entre los archivos; no se repiten
  1,2 segundos de espera por cada archivo pequeño al usar el relé.
- El QR sin canjear dura diez minutos; la pareja, 24 horas. Se debe mantener
  Safari y Brivany abiertos. La suspensión de Safari por iOS puede pausar el envío.

## Cuenta demo e instalación

La edición privada 0.2.2 genera el QR a través de la cuenta demo autenticada.
Un binding RPC permite al gateway solicitar una sala al servicio existente de
transferencia; la credencial global permanece exclusivamente en el servidor.
Se limita la frecuencia por dispositivo y se rechazan nuevas salas al revocar
la cuenta. La sala ya emitida conserva su plazo y el control de desconexión.
No se copian credenciales de Daniel al instalador ni se crea una ruta pública
para obtenerlas. La configuración DPAPI existente del PC de Daniel se conserva.

Se publican solo brivany-file-transfer y la ampliación de brivany-demo, conservando
bindings, secretos, compatibilidad y recursos; WhatsApp/Recall no se sustituyen.
El proceso nativo de desarrollo se reinició mediante su control privado después
de confirmar que estaba libre de tareas. El código fuente y el instalador usan
la versión 0.2.2. La descarga privada mantiene el ticket y la caducidad enviados
por correo; la invitación y el presupuesto de IA siguen siendo los mismos.

## Evidencia y límites de comprobación

- 22 pruebas de drop-transfer: cola de 1.000 fuentes con un descriptor, recepción
  segura, cancelación, QR demo y lectura al final de un archivo disperso de 20 GB.
  Se comprueban límites y offsets de 64 bits; no se ha transmitido ese archivo completo.
- 21 pruebas de workspace-files, 17 de distribución, 10 de demo-native y 15 de
  demo-cloud. El test de descarga comprueba sustituir el ejecutable conservando
  el enlace, rangos, hash y revocación.
- drop-edge-ui y drop-edge-webkit-ui: selección y envío simulado de 1.000 archivos,
  límites de bytes, anchos 320/390/768, cancelación, desbordamiento y textos.
- drop-e2e-mass: 150 archivos sintéticos elegidos en dos selecciones (100 + 50),
  una confirmación y contenido completo comprobado en disco nativo, con navegador
  real y Worker local. También se conserva el recorrido de ida y vuelta y OPFS.
  El mismo lote de 150 pasa con WebKit real; su vista restringida usa la alternativa
  en memoria de hasta 16 MiB para recibir el archivo pequeño de ida, y sus 150
  archivos se envían por bloques al disco nativo. El banco amplía a ocho minutos
  el plazo del recorrido masivo y cierra también el proceso WebKit al terminar.
- drop-acceptance y drop-worker: lotes alterados, orden, acumulación, offsets
  mayores de 4 GiB, errores, sala aislada y relé opaco en el runtime de Workers.
- demo-transfer: artefactos exactos publicados, RPC entre servicios, sesión
  requerida, creación oficial y rechazo tras revocación, con credenciales sintéticas.
- Comprobación real del dominio: límites, recursos públicos exactos y QR creado
  y revocado; sin archivos personales. Instalador privado: instalación, apertura,
  backend, QR real por cuenta demo, límites y desinstalación en perfil aislado,
  con sesión de prueba reutilizada para no ocupar otro dispositivo y preferencias conservadas.

Los informes se conservan en tmp/verification, tmp/drop-e2e-16m-shelf-ready-mass,
tmp/transfer-limits-20261116 y los informes de auditoría/aceptación de Exports.
No contienen credenciales ni el enlace privado. La auditoría del paquete revisó
11 valores privados conocidos y 14.237 entradas: ningún valor de proveedor o
ruta privada encontrados; una sola invitación limitada, deliberada. El ejecutable
sigue sin firma Authenticode. Sus hashes identifican bytes, no certifican la UX.

Se mantienen los intentos fallidos: dependencia de PDF ausente (instalada desde
requirements-documents), origen HTTP del banco sin randomUUID, fecha del runtime
local más antigua y el primer lote que superó el tiempo del banco. La espera
por archivo se corrigió y los recorridos finales pasan. El runtime local usa
compatibilidad 2026-10-19; no se cambian por ello las fechas de producción.

No se acredita todavía el envío de 20 GB completos ni una selección de 1.000
archivos en un iPhone físico. GPU y coste efectivo de Cloudflare no medidos.
Las pruebas no llaman modelos generativos, sintetizadores, ASR ni teléfonos;
se descargó reportlab de 2 MB para la suite existente de documentos. Los accesos
reales de metadatos, QR e instalación usan la infraestructura de Cloudflare.

Referencias: [WebSockets con Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
y [límites de Workers](https://developers.cloudflare.com/workers/platform/limits/).
Los archivos no se envían como un único cuerpo HTTP de 20 GB: se usa el transporte
cifrado por bloques ya existente, con WebRTC y relé WebSocket.

## Entrega comprobada

El instalador 0.2.2 (497.832.556 bytes) está publicado en la misma descarga privada
enviada por correo; HEAD y descarga parcial comprueban metadatos, versión y rango.
SHA-256: `6ae9140b406b0e5a2e32f97d043946596d0547ad49c0bbc360711b1cceee5949`.
El gateway final vuelve a crear y revocar una sala con la sesión demo real.
La cuenta conserva 5 USD de presupuesto y 3,4316 USD de saldo reservado disponible.
La auditoría de Git comprueba 14 valores privados conocidos, sin coincidencias
ni artefactos privados preparados. Los informes no incluyen el ticket de descarga.
