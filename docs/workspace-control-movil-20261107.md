# WorkSpace · Control móvil

En **Herramientas → Control móvil**, «Vincular teléfono» abre un QR. El móvil
debe estar en la misma red. El código de seis dígitos aparece en el teléfono y
se introduce en el PC al elegir los permisos. Todos comienzan desmarcados.
El QR es de un uso y caduca a los dos minutos. La sesión dura diez minutos
desde la autorización y se puede terminar desde cualquiera de los dos equipos.

- **Escritorio** permite activar la vista de la pantalla principal y, con el
  permiso de entrada, usar trackpad, clics, teclas y texto. La vista de pantalla
  se pide a demanda y admite clics si ambos permisos están concedidos.
- **Música** envía teclas multimedia de Windows al reproductor activo.
- **Diapositivas** envía navegación a la presentación que esté en primer plano.
- **Energía** pide bloqueo o apagado. El PC pausa los controles mientras se
  decide. Confirmar cierra la sesión antes de solicitar la acción a Windows.

La red y la huella SHA-256 se muestran en **Ajustes → Melodi WorkSpace →
Teléfono**. Control móvil y el envío de archivos tienen certificados, puertos y
permisos separados. El certificado es local y autofirmado. La conexión física
depende del navegador, el Wi-Fi y el firewall de los equipos.

El servicio abre un puerto local al solicitar un QR y lo cierra al cancelar,
vencer la sesión o cerrar WorkSpace. La aplicación de PC recibe cambios por
eventos. El móvil consulta el estado mientras la vista está visible. Pide un
JPEG de hasta 960 × 600 solo al activar la pantalla. Al ocultarla, salir de
Escritorio o perder la conexión, se retira la imagen y se detiene la captura.
Las acciones de entrada se acotan y el trackpad agrupa el movimiento.

## Verificación

Doce pruebas de servicio y ABI con HTTPS real en loopback, pantalla sintética
y efectos Windows sustituidos. Edge con panel de PC a 340 px y viewport móvil
de 390 px verificó emparejamiento, cinco permisos, pantalla, trackpad, Unicode,
música, diapositivas, rechazo de apagado, confirmación de bloqueo y cierre.
La primera prueba de Edge se conserva. Falló porque el selector de prueba de
Música coincidía también con el botón de la barra. El recorrido posterior
distingue casilla y botón. Una prueba adicional cubre la desconexión entre la
revocación del permiso y el cierre del servidor.

Pasaron también 20 casos de envío de archivos y las regresiones de envío en
Edge, Ajustes, diseño, Work y arranque. Se usaron datos propios. Quedan por
probar la conexión desde un teléfono físico, la confianza del certificado en
ese navegador y el control de aplicaciones reales. El ensayo no ejecutó
bloqueo, apagado ni captura de la pantalla personal. CPU, RAM y GPU totales
quedan sin medir. [Informes](../tmp/verification/phone-control-milestone-20261107.json).
