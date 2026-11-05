# 37. Resultados al visor, recordatorios y redes

29 de octubre de 2026, America/La_Paz. Continúa el objetivo integral de 72 horas.
Esta entrega conecta recorridos locales de producto; no acredita una vivienda
reconstruida, cuentas reales, precisión profesional ni 500 ms de retraso audible.

## Del resultado de reconstrucción al visor

Espacios permite consultar explícitamente resultados completos guardados para una
captura y añadir un objeto al visor. Consultar no ejecuta ni observa una llamada
remota, descarga pesos o consume inferencia. Sin un diario de dispatch la lista
queda vacía y no crea ese diario. La publicación es una operación local separada
del comando que autoriza una reconstrucción GPU.

`SpatialIngestService` comprueba el resultado `completed_remote`, la llamada Modal
original, identidad de petición, reserva y estado del consumo. Antes de publicar
revalida captura, revisión, paquete, fotograma, máscara y GLB. Los hashes esperados
vinculan el botón con el resultado consultado. Conservar diarios locales no es
prueba independiente de que se ejecutó un modelo ni de calidad geométrica.

El resultado se publica como una escena editable de **un solo objeto**, con
unidades relativas, posición inicial del modelo, superficies ocultas inferidas,
sin alineación a la habitación ni parámetros físicos medidos. La escala declarada
de la captura no se convierte automáticamente en escala verificada. Reimportar
el mismo trabajo conserva las ediciones y no crea otra escena. El respaldo valida
`scene_imports` y rechaza una reconstrucción que haya perdido su vínculo de origen.
Se corrigió la etiqueta de biblioteca para distinguirla de la demostración.

Pasaron quince pruebas locales y cinco controles de navegador: consulta,
publicación, GLB firmado y hash de sus bytes, rechazo sin firma, WebGL, edición,
reapertura y ZIP. Usan GLB generado y SDK Modal sustituido; **no hubo reconstrucción
real, inferencia GPU ni comparación con una vivienda**. Las credenciales Modal,
pesos, licencias, build CUDA y presupuesto siguen siendo necesarios.

## Recordatorios y notas privadas

Conexiones permite crear, posponer, completar o cancelar recordatorios con revisión
optimista. Se guardan en `.local/personal`, separados de la bitácora de desarrollo.
La fecha conserva el instante UTC y la declaración con zona horaria. Abrir la
pantalla consulta datos; no arranca un worker de entrega.

La página actualiza su lista cada quince segundos y puede mostrar avisos locales
vencidos. «Avisarme aquí» solicita permiso de notificación sólo al pulsarlo y
limita avisos repetidos por recordatorio/generación mientras permanece abierta.
El permiso y la entrega de notificación del sistema no se verificaron. No hay
alarma de sistema con la aplicación cerrada ni servicio de fondo instalado.
«Comprobar avisos» registra vencimientos localmente de forma explícita.

El servicio prepara entrega WhatsApp con consentimiento por recordatorio,
destinatario propio, ventana de atención y límite diario. La instancia web no
habilita ese transporte ni scheduler. Una entrega incierta no se repite. No se
promete entrega mientras falte el receptor autorizado y la ventana comprobada.

Las notas pueden escribirse, archivarse y tomar una instantánea de la lista de
compras pendiente de Sous con su revisión. «Revisar para WhatsApp» sólo prellena
la acción: todavía requiere revisar y confirmar el envío. El endpoint también
admite una nota de actividad de una sesión real existente; no permite sustituir
su contexto desde el cliente. No hay pedidos de comida ni compras automáticas.

Pasaron dieciséis pruebas del servicio y nueve controles de interfaz con SQLite,
HTTP y navegador reales en carpetas temporales. Una instancia nueva comprobó
persistencia. No solicitaron notificaciones ni enviaron mensajes. Las capturas de
390 px se corrigieron y regeneraron a ese ancho; la primera etiqueta de captura
correspondía a 768 px. El histórico anterior se conserva.

## Facebook, Instagram y campañas pausadas

Conexiones incorpora cuentas y permisos declarados, formularios privados de token,
borradores con revisión y consultas explícitas. Guardar configuración o tokens
no afirma que una cuenta esté conectada. Descubrir páginas, leer publicaciones,
consultar métricas o campañas sólo llama a Meta después de pedir esa consulta.
Se limitan resultados y no se sigue paginación automáticamente. Los resultados
de lectura son efímeros y se eliminan campos de token de la respuesta mostrada.

La revisión muestra el texto, destino y contenido actual del borrador. Usa el
diario de aprobaciones existente y parámetros exactos, sin un segundo sistema de
permisos. Facebook admite texto. Instagram separa crear el contenedor de publicar;
la segunda revisión se vincula al contenedor que devolvió la primera acción.
Cambiar el borrador invalida su revisión. Resultados inciertos no se vuelven a
enviar automáticamente. Aceptación del proveedor no demuestra visibilidad.

La imagen de Instagram es una referencia JPEG declarada mediante URL HTTPS de un
host permitido y hash. **Todavía no se descargan ni comprueban sus bytes, formato,
hash o disponibilidad pública.** No hay carga automática de fotografías privadas.
Las IP privadas se rechazan al configurar hosts; se corrigió una excepción que
podía ocultar ese rechazo.

La única escritura publicitaria crea una campaña **PAUSED**. Presupuesto, moneda,
objetivo, categorías y público declarado se guardan y revisan; el público aún no
se aplica a un conjunto de anuncios. No se crean creatividades/anuncios ni se
activan campañas o gasto. La moneda declarada requiere comprobación del usuario
y su coincidencia local antes de ejecutar. No se verificó contra cuenta real.

Pasaron veintiocho pruebas sociales, doce HTTP de Conexiones y nueve controles de
interfaz con revisión compartida. El recorrido social usó seis llamadas Graph
sustituidas; cero publicaciones, cuentas o campañas reales. Continúan pendientes
OAuth/cuentas sociales, permisos efectivos, medios comprobados, visibilidad y
los componentes y activación de anuncios.

Fuentes oficiales consultadas: [versión Graph del SDK Meta](https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/facebook_business/apiconfig.py),
[API de páginas](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py),
[Instagram](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/iguser.py)
y [ejemplo de campaña pausada](https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/examples/AdAccountCampaignsPostCategories.py).
Estas fuentes no acreditan acceso de la cuenta ni compatibilidad real del endpoint.

## Verificación y evidencia

- `docs/verification-history/spatial-ingest-20261029T164740-9f20713d.json`: quince pruebas.
- `docs/verification-history/ingest-ui-20261029T171541-0aaae039.json`: cinco controles.
- `docs/verification-history/personal-notes-20261029T170901-4dfdf2ae.json`: dieciséis pruebas.
- `docs/verification-history/personal-ui-20261029T171017-6caf5f1d.json`: nueve controles.
- `docs/verification-history/social-20261029T165336-9a58bfca.json`: veintiocho pruebas.
- `docs/verification-history/social-ui-20261029T171017-0bb1d148.json`: nueve controles.
- `docs/verification-history/connections-http-20261029T170610-09317abd.json`: doce pruebas.
- `docs/verification-history/connections-20261029T171126-b46fa156.json`: siete controles de regresión.
- `docs/verification-history/whatsapp-gateway-20261029T164212-4b885f58.json`: quince pruebas,
  incluida salida por Ctrl+C sin esperar `shutdown()` en el hilo del listener.
- `docs/verification-history/python-20261029T171932-a34353f3.json`: **534 pruebas Python**
  aprobadas en el estado final del hito.
- `docs/verification-history/gemini-provider-20261029T172116-a5493a7a.json`: dieciocho
  pruebas Gemini sin API real. El fallo previo de la suite general
  `python-20261029T171028-ac2febf3.json` era una carrera de observación del test:
  `input-ended` local no implica que el hilo upstream ya haya leído EOF. La
  prueba fuerza ahora ese intercalado y sincroniza el evento dentro del mismo
  límite de dos segundos, comprobando un EOF y cero bytes de entrada. No se
  cambiaron el proveedor ni sus límites para conseguir el resultado.
- `tmp/runtime-readiness-20261029.json`: HTTP 200 para las cuatro pantallas
  principales y tres módulos nuevos, sin inferencia. Google aún sin cliente,
  cuentas sociales sin conectar y Modal `prepared_not_deployed`. Tras comprobar
  libre el puerto se inició una nueva instancia local; no se cerraron procesos
  existentes para reemplazarla.

Las pruebas de este hito son locales y usan datos sintéticos; no hicieron llamadas
externas ni consumieron inferencia GPU. Las notas/borradores del usuario se guardan
como datos privados de producto; sus bases y conversaciones no se adjuntan como
evidencias de desarrollo. El objetivo integral sigue activo y pendiente de sus
validaciones reales.
