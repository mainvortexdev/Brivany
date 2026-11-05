# Auditoría de casos de uso · 29 de octubre de 2026

Informe PDF: [Brivany_Auditoria_Casos_de_Uso_2026-10-29.pdf](../Brivany_Auditoria_Casos_de_Uso_2026-10-29.pdf).

Suite general: 610 pruebas Python aprobadas. 19 suites seleccionadas con controles solapados. Seis escenarios adicionales locales. Cero llamadas externas e inferencias pagadas nuevas.

La plataforma integral sigue pendiente: el PDF no acredita reconstrucción real, precisión profesional, realismo físico, 500 ms audibles o dispositivos físicos.

## Hallazgos y correcciones

- **F01 · Corregido y comprobado**: Los recorridos de presentación no se incluían en la carpeta portátil ni en el respaldo. Se conservaron configuración y revisión de escena en las versiones de proyecto; se añadieron lectura, guardado y validación del respaldo.
- **F02 · Corregido y comprobado**: Los métodos nuevos de presentación no estaban en la lista permitida del cliente de escritorio. Se añadieron get_presentation/save_presentation y un error claro cuando una ventana antigua aún no ofrece el método.
- **F03 · Corregido y comprobado**: La carpeta se marcaba como lista antes de terminar la lectura del recorrido; una llamada inmediata podía encontrar el puente ocupado. El estado listo se publica tras finalizar esa lectura. El recorrido de prueba espera la condición correcta y acepta el aviso de escena modificada.
- **F04 · Corregido y comprobado**: Un error al cargar el panel opcional de presentación podía propagarse y bloquear el visor 3D. Se aísla el fallo en su panel. Una ventana antigua conserva el visor y muestra la necesidad de reiniciar; probado expresamente.
- **T01 · Corregido y comprobado**: El selector del panel de detalles dejó de ser único al añadir presentación y Melodi. Se añadió un identificador estable y se actualizaron las pruebas de Espacios/exportación. No se atribuye este fallo al usuario final.
- **T02 · Registrado; causa no concluida**: Al ejecutar varios navegadores con WebGL por software aparecieron agotamientos de espera al iniciar. Se repitieron los recorridos afectados de forma controlada y pasaron. No se amplió el timeout para ocultar el fallo. No prueba rendimiento en GPU física.

## Evidencias

- `docs/verification-history/python-20261029T224112-5f0bfe2f.json` · Suite Python general
- `docs/verification-history/spatial-ui-20261029T223847-80e578d7.json` · Captura y edición espacial
- `docs/verification-history/floorplan-ui-20261029T224610-e9c6726e.json` · Plano 2D
- `docs/verification-history/portable-floorplan-20261029T224621-b183e290.json` · Plano portátil
- `docs/verification-history/desktop-ui-20261029T224341-91879e33.json` · Proyecto de escritorio
- `docs/verification-history/portable-presentation-20261029T224525-1bf27701.json` · Recorrido portátil
- `docs/verification-history/sous-pipeline-20261029T223453-982624ee.json` · Inventario y cocina
- `docs/verification-history/sous-catalog-20261029T223259-995699c3.json` · Recetas y compras
- `docs/verification-history/sous-voice-pipeline-20261029T213534-fccbc39a.json` · Voz de Sous
- `docs/verification-history/live-ui-20261029T224106-1c2c5584.json` · Voz y reunión silenciosa
- `docs/verification-history/human-skills-ui-20261029T223651-63e5e060.json` · Skill desde video
- `docs/verification-history/chat-requests-ui-20261029T223259-280512be.json` · Solicitudes del chat
- `docs/verification-history/social-ui-20261029T224215-644c7621.json` · Redes y campañas pausadas
- `docs/verification-history/dubbing-timing-20261029T223453-bd5721e4.json` · Doblaje y medición
- `docs/verification-history/spatial-physics-20261029T224535-d0a954fa.json` · Física sintética
- `docs/verification-history/room-dispatch-20261029T224022-22c45674.json` · Orquestación multivista
- `docs/verification-history/additional-usecases-20261029T224022-2498a3ad.json` · Usos adicionales
- `docs/verification-history/app-ui-20261029T224352-d0676a7e.json` · Interfaz y shell PWA
- `docs/verification-history/spatial-assistant-ui-20261029T213455-0679492c.json` · Melodi en el espacio

## Usos adicionales

- **Planificar una mudanza o una sala para un evento**: Dos distribuciones, aplicar y deshacer conservan objetos e historial. Límite: No comprueba espacio de paso, accesibilidad física ni medidas reales.
- **Catálogo de colección o pequeño museo privado**: Punto de interés y ficha sobreviven al proyecto portátil y a un respaldo/restauración reales. Límite: Sin audio guía curada, digitalización fotorealista, derechos de colección o enlaces públicos verificados.
- **Diario de obra, estudio o mantenimiento**: Comando tipado prepara una nota; sólo se guarda tras confirmación local y persiste al reabrir. Límite: Sin cuenta WhatsApp ni dictado real. La nota no certifica que el trabajo se realizó.
- **Guardar apuntes externos que contienen instrucciones o etiquetas**: Se conserva como cuerpo de nota, sin reinterpretarlo como herramienta. El render de texto inerte se verifica en personal-ui. Límite: Esta prueba de servicio no ejecuta HTML ni evalúa aislamiento frente a código local malicioso.
- **Asistente con permisos ausentes o retirados**: Falta de grant impide consultar Drive y no consume la aprobación; cero HTTP a cuentas. Límite: Retirada real de un permiso en Google, su propagación y renovación siguen pendientes de cuenta.
- **Checklist de viaje o preparación de equipo**: Nota y recordatorio vencido se conservan localmente sin un proveedor ni worker. Límite: Requiere abrir Brivany; no hay alarma con la aplicación cerrada ni entrega WhatsApp comprobada.

## Pendientes

- **P0 · Captura → vivienda reconstruida**: Pesos/licencias, build CUDA, Modal, presupuesto y captura real. El worker y el coordinador multivista están preparados/probados con sustitutos; falta su recorrido integrado con resultado real.
- **P0 · Plano y física profesionales**: Comparar geometría con medidas independientes, cobertura y orientación; calibrar parámetros físicos. La referencia declarada o una simulación de cajas no bastan.
- **P0 · Cuentas y chat operativo**: Autorizar Google/Meta/WhatsApp, publicar receptor HTTPS, comprobar permisos/renovación/entrega. Las solicitudes actuales necesitan revisión local; control remoto del equipo pendiente.
- **P0 · Live Traductor ≤500 ms**: Las mediciones históricas reales exceden el objetivo. Este ensayo nuevo comprueba la cadena y el medidor con upstream sustituido; no acredita calidad o latencia real.
- **P1 · Cocina cotidiana completa**: Catálogo ampliado con fuentes/localidad, reconocimiento real, voz física, pedidos y envío efectivo al chat. Los tres presets no prueban comida típica ni demanda de usuarios.
- **P1 · Distribución y dispositivos**: Instaladores/firma/macOS/iPhone/Android/Meta Glasses, cámaras/micrófonos/altavoces físicos, uso prolongado y GPU modestos. Viewports emulados no prueban esos dispositivos.
- **P1 · Compartir y operar**: Autenticación multiusuario, enlaces de visita revocables, permisos, sincronización, retención y recuperación en interfaz. El shell PWA offline no equivale a tener todas las funciones offline.
