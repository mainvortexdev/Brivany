# 35. Voz contextual de Sous, Desktop y transporte Modal

29 de octubre de 2026, America/La_Paz. Continúa el objetivo integral activo.
Esta entrega no acredita reconstrucción real, planos profesionales, conectores
activos ni el retraso audible de 500 ms.

## Sous y captura

`/sous` incorpora conversación por texto y voz reutilizando Muse, conversación
Meta por fragmentos y la voz de Melodi en Cloudflare. El usuario inicia, interrumpe
y termina explícitamente. Se silencia la entrada durante la respuesta: se usa
Interrumpir para hablar, sin interrupción automática durante la voz. Cancelar
antes de recibir permiso también libera un micrófono tardío. Abrir la página
no activa inferencia. Hay límites de treinta turnos por página, diez minutos de
escucha y 120 intentos por proceso, sin presupuesto persistente entre reinicios.

El servidor construye el contexto desde hasta 32 ingredientes y el paso actual
de la sesión real. El cliente no puede sustituir ese contexto. La conversación
no tiene herramientas ni cambia inventario, avanza pasos, compra o envía mensajes.
No se guarda historial en disco. Catálogo/recetas según localidad, pedidos y
WhatsApp siguen pendientes. Ocho pruebas de contexto/HTTP y seis controles de
navegador aprobaron con proveedores, eventos ASR y micrófono sustituidos; HTTP,
inventario, contexto y reproducción PCM son reales. No verifican calidad de
conversación con modelos, micrófono físico ni latencia audible.

Se hizo **una consulta real Meta**, sin reintentos, con una tarjeta sintética
sin alimentos y `muse-spark-1.3`. Aceptó la imagen y el esquema estructurado;
devolvió cero candidatos, como se esperaba: **2765 ms**, 761 tokens de entrada,
274 de salida, 1035 totales. Importe y tiempo GPU desconocidos. Confirma acceso
y contrato para esa consulta, no reconocimiento de cocina, frescura o seguridad.
No se enviaron fotografías privadas. `tools.check_sous_vision_real --allow-paid`
está fuera de `tools.verify` y registra su consumo real como desconocido.

La captura espacial añade HUD tipo gafas con estados, temporizador, retícula y
guía textual. La vista móvil es inmersiva por defecto y permite vista compacta;
cambiarla no pide permisos. Conserva MP4, límites y liberación de tracks.
No calcula cobertura, solapamiento o profundidad ni conecta hardware Meta Glasses.
El recorrido de 24 comprobaciones pasó con cámara/recorder sustituidos, incluidos
vertical/horizontal; no equivale a ensayar dispositivos físicos.

## Desktop y archivos reales

Pasaron ocho controles de navegador/HTTP/puente Python/GLB/SQLite/carpeta/ZIP:
guardar, editar, cancelar, exportar, reabrir, revocar enlaces y resolver conflicto
409. Selectores y transporte pywebview sustituidos; no son pruebas de controles
nativos. Se corrigieron propagación de código/estado y el evento de puente que
puede llegar antes de inicializar la página. Exportar cancelado ya no indica éxito.

Se guardó `.local/projects/interior-reference-v1` con referencias derivadas,
sin originales ni credenciales. El primer intento falló porque faltaba la carpeta
padre; se creó esa carpeta y el segundo fue válido, sin sobrescribir proyectos.

El lanzador abrió una ventana Windows/WebView2. La instrumentación opcional de
arranque leyó sólo indicadores fijos de su propio DOM: puente/controles/canvas
disponibles, 22 objetos y 124 dibujos. No pulsó controles ni leyó contenido privado.
El indicador de carpeta portátil aún no se confirmó en esa instantánea: no
acredita reapertura nativa. El helper de control del ordenador falló al seleccionar
otra ventana de ensayo tras el único reintento de recuperación; no se insistió.
**Selectores, edición y reapertura nativos siguen sin comprobar.** Tampoco se
midió GPU física ni se validaron macOS, firma o instalador.

Desktop ahora carga configuración local y prepara los seis puentes loopback de
voz/traducción; no llaman proveedores hasta activar sus controles y se cierran
al terminar. `--startup-report archivo-nuevo.json` habilita el diagnóstico de
arranque, que no es una inspección visual humana ni automatiza acciones de UI.

## Adaptador Modal, todavía sin ejecución GPU real

`services/spatial/modal_transport.py` usa el SDK fijado para consultar
`brivany-spatial/reconstruct_single_object`, enviar una intención y conservar
su FunctionCall. Observación y cancelación se dirigen a esa llamada; los estados
inciertos no se vuelven a enviar. Un timeout local no significa trabajo detenido;
la aceptación de una cancelación no acredita factura ni parada remota.

El CLI admite `submit ... --provider modal --execute`, `cancel` y conciliación
explícita. Mantiene revisión/hashes de imagen y máscara, reserva de presupuesto
y puertas de pesos, licencia, build y despliegue. El worker compara el hash de
su lock con el autorizado. `completed_remote` se distingue de `completed_test_stub`;
un acierto de caché no afirma nueva ejecución del modelo. El importe se conserva
desconocido hasta conciliación, sin calcular facturas desde tiempo de proceso.

El respaldo puede conservar/validar `modal-calls.sqlite3`; restaurarlo no reanuda
ni vuelve a enviar trabajos. SDK y proveedor pueden reintentar o reprogramar
internamente: el diario local no garantiza ejecución exactamente una vez en nube.
El lock distribuido sigue cerrado/incompleto. **No se autenticó/instaló el SDK,
desplegó GPU, descargó checkpoint ni ejecutó SAM3D en esta entrega.** Nueve pruebas
con SDK sustituido aprobaron integridad, invocación, timeout, cancelación, caché,
no replay, conciliación y conservación del diario.

Referencias oficiales consultadas: [funciones desplegadas](https://modal.com/docs/guide/trigger-deployed-functions),
[Function.spawn](https://modal.com/docs/reference/modal.Function),
[FunctionCall.get/cancel/from_id](https://modal.com/docs/reference/modal.FunctionCall).

## Evidencias y siguiente puerta

- `docs/verification-history/python-20261029T043007-fd33a3e3.json`: 386 pruebas Python
  aprobaron en ese estado. Las dos pruebas Desktop y conservación del diario
  añadidas después se verificaron en suites específicas, sin atribuirlas a él.
- `docs/verification-history/sous-voice-20261029T041921-ffeced81.json`: ocho pruebas locales.
- `docs/verification-history/sous-voice-pipeline-20261029T042048-db94d9e1.json`: seis controles.
- `tmp/sous-vision-real/20261029T042857.json`: la única consulta real Meta.
- `docs/verification-history/spatial-ui-20261029T030716-41d249f4.json`: 24 comprobaciones.
- `docs/verification-history/desktop-ui-20261029T042523-b1539a97.json`: ocho controles.
- `docs/verification-history/desktop-20261029T043352-98801e30.json`: 13 pruebas.
- `tmp/desktop-native/startup-interior.json`: arranque/render nativos observados.
- `docs/verification-history/spatial-modal-20261029T043352-491e1a88.json`: nueve pruebas offline.

Se volvió a iniciar la aplicación en `http://127.0.0.1:8765` después de comprobar
que el puerto ya estaba libre: HTTP 200 para voz Sous, módulo cliente y biblioteca.
No se forzó el cierre de la instancia cuyo reinicio combinado fue rechazado.
Las siguientes puertas siguen siendo voz/cocina real, un objeto Meta en Modal
y conectores personales/sociales. La plataforma completa permanece pendiente.
