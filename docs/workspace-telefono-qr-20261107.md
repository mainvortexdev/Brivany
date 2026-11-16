# WorkSpace · archivo al teléfono por QR

> Actualización del 10 de noviembre: el transporte local descrito en este
> registro histórico fue sustituido para archivos por HTTPS en el dominio
> oficial. Véase [Transferencia oficial cifrada](workspace-telefono-oficial-20261110.md).
> La transferencia de archivos ya no requiere aceptar un certificado local.

7 de noviembre de 2026. Continuación del objetivo activo. Se incorpora la
transferencia PC → teléfono de un archivo de la bandeja. No es control remoto
del ordenador ni vinculación permanente de un dispositivo.

En Archivos, el menú «⋯» contiene Abrir, Ruta, Correo y Teléfono; Preguntar y
Quitar permanecen directos. Esto evita añadir otra fila de botones a cada
archivo. Se retiraron también el subtítulo y la explicación permanente de la bandeja;
el tamaño de cada archivo y los avisos de cada acción se conservan. Los límites
completos están en Ajustes; la zona de arrastre conserva «Hasta 8 MiB».
Teléfono abre una tarjeta con nombre, QR y cancelar. La barra indica
un envío activo mediante un punto. Un engranaje lleva a la configuración de
red/certificado en Ajustes → Melodi WorkSpace. No se añaden instrucciones largas
ni opciones de red al cajón de herramientas.

## Transporte y permisos

Solo al solicitar un envío se crea un servidor HTTPS separado, enlazado a una
IPv4 local elegida, nunca a 0.0.0.0. Se elige automáticamente una dirección si
solo se detecta una privada; si hay varias, se elige en Ajustes. No se configuran
reglas de firewall, router, túneles ni servicios externos. La detección local
del equipo devolvió una candidata, sin iniciar un servidor LAN de prueba.

Cada QR contiene una autorización temporal para **un archivo**. El token viaja
en el fragmento de la URL, se consume una sola vez y el cliente retira el
fragmento de su historial. La sesión utiliza una cookie Secure, HttpOnly y
SameSite=Strict. Se rechazan Host/origen ajenos y no se habilita CORS. El servidor
no expone el puente nativo, cuentas, chat ni otras rutas del proyecto.

La autorización y el servicio vencen a los cinco minutos. Cancelar, quitar el
archivo compartido, sustituir el envío o cerrar Brivany revoca el acceso y retira
el servidor. Esto impide nuevas lecturas; no borra lo que el receptor ya descargó.
La tarjeta se actualiza por eventos nativos, sin sondeo periódico.

La bandeja entrega una copia inmutable de hasta 8 MiB y comprueba cambios del
archivo durante la lectura. El servidor mantiene un solo archivo en memoria y
lo libera al cancelar/caducar. Admite hasta ocho conexiones, plazos de socket,
descarga por tramos y descarga como adjunto. No guarda el contenido del envío
en otro archivo ni lo analiza con un modelo.

El certificado es local/autofirmado y persiste para cada IP. Su clave se guarda
protegida por DPAPI del usuario de Windows. Los PEM temporales se eliminan antes
de abrir el listener. En la primera conexión, el usuario debe comparar la huella
SHA-256 mostrada en Ajustes con la del certificado que presenta el navegador del
teléfono. No se instala una autoridad de confianza ni se acepta un certificado
automáticamente en el dispositivo.

Se usan [Cryptography](https://cryptography.io/en/latest/x509/tutorial/) 50.0.2 y
[Segno](https://segno.readthedocs.io/en/stable/) 1.6.6, declarados en las
dependencias de Desktop y cargados al compartir. El nuevo paquete Segno es de
76 kB de descarga; esta cifra no mide la memoria del programa ni el total de
dependencias. El certificado y el QR se generan localmente.

## Evidencia y límites

Pasaron 20 casos del protocolo con un archivo propio, TLS real en loopback,
cliente que confía en el certificado concreto, protección DPAPI real en Windows,
autorizaciones concurrentes, un solo canje, descarga exacta, ranges, rechazo de
origen/Host, cierre, caducidad y reversión de errores. Se comprobó que el QR
generado decodifica a la autorización asignada; no se guardó el valor en el
informe de pruebas. Se reprodujo además una carrera: quitar el archivo desde
otra vista durante la preparación podía dejar activo el nuevo envío. La lectura
y el registro de la autorización ahora se coordinan con la retirada. La prueba
de comportamiento final pasó después de corregirlo. Se conservan los dos
informes fallidos: el primero imponía una espera concreta; se afinó para exigir
solo el resultado relevante, que no quede una autorización activa.
Se comprobó también la retirada automática con un temporizador real de 0,2 s,
sin llamar al método de expiración ni sondear la API durante la espera.
Es una prueba del ciclo automático con plazo reducido, no una espera real de
cinco minutos.

El recorrido Edge empleó HTML/CSS/JS reales y el servidor HTTPS de producción
en loopback. El puente de la bandeja se sustituyó con un único archivo sintético.
El cliente con viewport móvil descargó exactamente 2.120 bytes, con el nombre
correcto; el PC recibió los estados y canceló el servicio. Se decodificó también
el QR del fotograma renderizado a 340 px, no solo la imagen original. Se
inspeccionaron la tarjeta compacta y la página de descarga.
Los menús se cierran al elegir una acción y el foco vuelve al disparador al
cancelar el QR, sin llevar el foco a una vista oculta por una caducidad.
La automatización omite el aviso del certificado en su contexto de prueba; no acredita su
aceptación física en un móvil.

Pasaron además 13 casos de archivos, 45 de Work y los recorridos de archivos,
Ajustes y diseño integrado. Las pruebas no hicieron solicitudes a proveedores;
solo hubo transporte local y la preparación de dependencias/documentación.
No se midieron CPU/RAM integrales ni segundos de GPU. No se usa «cero consumo»
como conclusión.

Quedan pendientes un teléfono físico autorizado, alcance real por Wi-Fi y
firewall, la verificación del certificado desde ese teléfono y carga del código
en una instancia personal ya abierta. El envío en red IPv6 no está implementado.
El objetivo general permanece activo. Los permisos de futuros controles móviles
deberán ser distintos: este QR de archivo no concede teclado, pantalla ni apagado.

La bitácora adjunta solo metadata. Los envelopes de prueba, tokens, cookies,
claves y QR con autorizaciones no se adjuntan como evidencia.
[Informes y alcance exacto](../tmp/verification/workspace-phone-milestone-20261107.json).

La revisión posterior comprueba además que una retirada tardía del archivo
anterior no cancela el envío de otro archivo. Ambas operaciones usan la misma
coordinación de la bandeja. [Comprobación posterior](../tmp/verification/workspace-phone-correction-20261107.json).

## Idioma de la pantalla móvil

8 de noviembre. La acción Teléfono transmite el idioma activo de WorkSpace.
La página de descarga dispone de español, inglés, francés y portugués de Brasil.
El servidor entrega sus siete mensajes funcionales en la respuesta inicial.
El nombre y los bytes del archivo conservan su valor original. El idioma de
una transferencia queda fijado al generar su QR.

Las descargas, reapertura de página, recuperación de sesión mediante cookie
y avisos de desconexión o sesión terminada pasaron con Edge en viewport móvil
y HTTPS real de loopback. Se verificaron los bytes de un archivo sintético en
los cuatro idiomas. Pasaron 22 casos de protocolo, incluida la conservación de
la transferencia actual al rechazar un idioma desconocido. La prueba no
acredita conexión desde un teléfono físico, alcance Wi-Fi ni aceptación del
certificado en ese dispositivo. No hubo solicitudes a proveedores.

[Protocolo y HTML inicial](../tmp/verification/workspace-phone-20261108T052516-ffac9f3a.json),
[recorrido móvil en cuatro idiomas](../tmp/verification/workspace-phone-ui-20261108T052421-bc952dcb.json).
