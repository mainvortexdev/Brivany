# Transferencia de archivos en el dominio oficial

> La ampliación a 1 GiB, la transferencia en ambos sentidos y el reinicio
> privado se documentan en [Transferencias y reinicio](brivany-transferencias-reinicio-20261110.md).
> Este registro conserva la evidencia del transporte inicial de 8 MiB.

10 de noviembre de 2026. Corrige el aviso de certificado de Safari que aparecía
al escanear una dirección privada. En Archivos → Teléfono, el QR usa
`https://brivany.vetsa.es/transfer/`. El teléfono y el PC necesitan Internet;
no necesitan compartir Wi-Fi. No se abre un servidor de archivos en la LAN,
no se cambia el firewall y no se pide instalar certificados.

## Implementación

Worker `brivany-file-transfer`, con dos rutas sobre la zona existente:
`brivany.vetsa.es/transfer` y `brivany.vetsa.es/transfer/*`. La portada,
las actualizaciones de Windows y los demás servicios se conservan. El cliente
móvil no incluye scripts externos, analítica ni fuentes remotas. `no-transform`
evita que Cloudflare inyecte su beacon de Web Analytics en esta página; no
cambia la analítica de la portada. CSP restringida al propio origen, sin CORS,
sin caché y sin reenviar referencias.

El PC cifra nombre y contenido con AES-256-GCM y una clave aleatoria por envío.
El servidor recibe únicamente el contenedor cifrado, los hashes de las
autorizaciones y el plazo. La clave de descifrado y el token de canje viajan en
el fragmento del QR, que el navegador retira del historial antes de consultar
la API. El teléfono usa Web Crypto para descifrar y descargar el archivo.
El tamaño y los metadatos técnicos del transporte siguen siendo observables
por la infraestructura; no se afirma anonimato.

Cada envío usa un Durable Object SQLite independiente. Solo admite un canje
atómico, con cookie Secure/HttpOnly/SameSite=Strict para recuperar el contenedor.
El cliente admite español, inglés, francés y portugués de Brasil. Si Safari
reutiliza la misma pestaña al escanear otro QR, se reinicia la página para
procesar el nuevo fragmento.

El límite existente se conserva en 8 MiB. El plazo es de cinco minutos desde
la creación del envío, incluyendo su subida; la comprobación del servidor y
una alarma eliminan el almacenamiento. Descargar retira el contenedor del
servidor. Cancelar, retirar el archivo de la bandeja, sustituir el envío o
cerrar Brivany solicitan su revocación. Si no hay Internet para confirmar una
cancelación, la interfaz muestra que está pendiente y conserva la posibilidad
de reintentar; el plazo del servidor sigue limitando el acceso. La revocación
no elimina una copia que el teléfono ya haya recibido.

La tarjeta muestra «Escanea para descargar», «Teléfono conectado» y
«Descarga iniciada». Esta última indica el inicio solicitado de la descarga,
no certifica que el sistema operativo la haya guardado. El PC consulta el
estado cada tres segundos únicamente durante un envío activo y deja de
hacerlo al iniciarse la descarga. No hay sondeo en reposo.

La credencial de creación del PC está en
`User Data/.local/phone/official.dpapi`, protegida por Windows DPAPI; la otra
copia está en Workers Secrets. No se incorpora al código, al instalador,
a argumentos de consola ni a los informes. Cada nueva instalación necesitará
su provisión privada; esta actualización configura el PC actual.

El antiguo transporte local se conserva para Control móvil y sus pruebas;
no se usa como alternativa automática para archivos. Las opciones de red y
certificado de Control móvil se distinguen en Ajustes.

## Verificación

El informe local `tmp/official-transfer-worker/report.json` usa el runtime
Workers/SQLite y Edge en viewport móvil. Verifica autenticación, rechazo de
origen, canje concurrente único, aislamiento entre envíos, descifrado exacto,
borrado por descarga y caducidad, cancelación, el límite de 8 MiB y la
reutilización de una pestaña con otro QR. La caducidad local se fuerza en el
almacenamiento de prueba, no se presenta como una espera real de cinco minutos.
Las suites Python cubren también cancelación durante una subida y revocación
fallida, además de la conservación de Control móvil y el despliegue reversible.

`tmp/official-transfer-deployment.json` comprueba por HTTPS las tres piezas
del cliente publicado, las dos rutas y que la huella de la portada no cambió.
`tmp/official-transfer-real/report.json` recoge exclusivamente los resultados
del recorrido remoto con contenido sintético. No contiene QR, fragmentos,
tokens, cookies ni claves. `tmp/official-transfer-native.json` valida el
arranque de la aplicación instalada y su conexión oficial cifrada sin listener
local de archivos. Los informes distinguen lo local de lo remoto.

Las pruebas remotas consumen solicitudes, ejecución, escritura temporal y
tráfico de Cloudflare. No se ha cambiado el plan de facturación ni contratado
otro servicio; no se ha medido su coste efectivo y no se declara consumo cero.
No se certifica todavía el escaneo y guardado en un iPhone físico: esa prueba
requiere el teléfono del usuario. No se ha omitido la validación TLS en el
recorrido remoto automatizado.
