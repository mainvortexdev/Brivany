# Objetivo activo: Melodi controla el ordenador y crea mientras conversamos

Solicitud del usuario: 30 de octubre de 2026. Referencia de implementación:
`<perfil-local>\Documents\GitHub\cognira-desktop` (Stacy). Conservar la identidad,
voz y human-skills de Melodi. Spaik Iris sigue pendiente de arquitectura.

## Entregas y estado comprobado

- [x] Revisar ejecutores reales de Cognira, sin modificar ese directorio.
- [x] Conectar un backend Electron privado al escritorio de Brivany; prueba real
  de arranque, sin entrada de ratón/teclado en esa comprobación.
- [x] Implementar planificación semántica con Meta, con herramientas tipadas y
  observaciones nuevas entre pasos; no ejecutar scripts generados por el modelo.
- [x] Incorporar apertura/enfoque de aplicaciones, clic en controles observados,
  escritura literal, teclas acotadas, notas nuevas y organización de archivos en
  carpetas autorizadas. Flujos comprobados con ejecutor sustituido; verificación
  nativa de cada aplicación pendiente.
- [x] Reutilizar el ejecutor de Paint: herramientas, colores y trazos. La prueba
  real completó 300 trazos y Guardar como nativo produjo un PNG de 768×614; se
  observaron artefactos de relleno/contorno. Se registra por separado y conserva errores; no confundir integración con
  fidelidad artística o compatibilidad con todas las versiones de Paint.
- [x] Integrar órdenes al live con permiso de sesión, Detener y cancelación.
- [x] Crear modelos conceptuales mediante el compilador arquitectónico de Cognira
  y exportar GLB al contrato/biblioteca existente. Una orden sintética con router y
  planificador Meta reales produjo una mesa de cinco piezas y se conversó durante
  la petición de generación. Render real revisado; no acredita micrófono físico.
- [x] Mantener colas independientes para ordenador y modelos, conversación durante
  generación y vista del modelo junto al live sin salir de la voz.
  La barra compacta, vista incrustada y controles de voz se comprobaron dentro de
  siete tamaños, incluidos 390×568 y 640×480; ver `docs/modelo-real-y-live-melodi.md`.
- [ ] Validar una petición real completa por micrófono físico y proveedores,
  controlando consumo y sin guardar conversación ni audio.
- [x] Verificar nativamente Paint con pincel, paleta, trazos y guardado de una fixture.
- [x] Verificar nativamente escritura literal y lectura de vuelta en Bloc de notas,
  copia y movimiento de fixtures con comparación de bytes, y rechazo de sobrescritura.
  Se mantuvieron intactos los documentos personales.
- [x] Conservar recibos operativos privados sin instrucciones, texto escrito ni
  permisos; recuperar tareas interrumpidas sin reintentar al abrir de nuevo.
- [x] Comprobar en Chrome/Windows pestañas, clic, búsqueda Google y lectura de resultados,
  búsqueda de canción/artista en YouTube, pausa/reanudación con avance observado y
  entrega de acceso GitHub sin credenciales. Orden completa con router/planificador
  Meta y ejecutor nativo superada en páginas sintéticas; otros navegadores y sitios
  conservan su validación pendiente. Ver `docs/pruebas-navegador-melodi.md`.
- [ ] Validar creación Office real: el ejecutor se integró, pero Word informó que
  la licencia de esta instalación ha expirado. No se declara creación completada.
- [ ] Completar paridad con el catálogo extendido de Stacy: navegación observada,
  Office, impresión, programación, composición multimedia y adaptadores específicos.
  Las integraciones existentes de Brivany siguen conservando sus propias revisiones.
- [x] Empaquetar localmente el backend Windows con módulos y runtimes fijados, sin
  consultar el checkout original ni requerir Node global al ejecutar. Arranque,
  nota nativa y tres GLB locales comprobados; paquete activado. Ver
  `docs/backend-local-melodi.md` para evidencia, atribución y límites.
- [ ] Validar adaptadores nativos de macOS/Linux y un instalador completo. El paquete
  de control heredado actual es win32-x64; el entorno Python de Brivany sigue separado.

## Reglas de la integración

Los permisos se conceden desde la ventana nativa, duran una sesión acotada y no los
pueden ampliar el modelo, una página, un documento ni el nombre de un archivo.
Cada tarea tiene doce pasos/solicitudes de planificación como máximo, parada y
ningún replay automático de pasos. Las escrituras tratan el texto como datos
codificados; no interpolan instrucciones en PowerShell. Se rechazan rutas fuera de
las carpetas elegidas, enlaces, sobrescrituras y ejecutables. La eliminación y los
envíos no forman parte del control general; los conectores específicos mantienen
sus revisiones. El código fuente de Cognira se referencia con hashes, atribución
y sin copiar sus credenciales ni sus conversaciones.

Los modelos tienen unidades nominales, supuestos y procedencia generada. No se
presentan como capturas reconstruidas ni planos profesionales verificados.
