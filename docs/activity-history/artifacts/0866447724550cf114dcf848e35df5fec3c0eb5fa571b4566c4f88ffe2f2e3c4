# Auditoría de bitácora · 4 de noviembre de 2026

Se revisaron todos los registros locales existentes, sus copias, los 103
documentos Markdown iniciales y los informes de suites. La revisión encontró
1.292 entradas y 1.767 snapshots únicos, sin errores de encadenamiento, copias
ausentes o alteradas. Ningún informe de `tmp/verification` estaba sin registrar.

## Referencias completadas

Había 16 documentos sin snapshot directo y 18 con contenido posterior a su
última copia. Se incorporaron 33 mediante ocho registros documentales
retrospectivos. El restante era el índice vivo `17-bitacora.md`, que se captura
al cerrar esta auditoría. Incluyen diseño inicial, decisiones/supuestos,
modelos/conectores, voz y latencia, control/terminal, WorkSpace, Spotify,
iPhone, infraestructura, Motion, medios y web.

Registrar un diseño no lo convierte en capacidad entregada. Se conservan IPA
sin generar, plataformas/hardware pendientes, comandos sin recibo no aprobados,
calidad geométrica no certificada y estados históricos de cuentas. La dirección
vigente sigue en `PLAN_PLATAFORMA.md`.

Se localizaron también 120 informes cuyo contenido no estaba adjunto. Dos eran
pruebas nuevas de este turno y se registraron directamente. Los 118 históricos
restantes se recuperaron en 24 registros por área/resultado: 69 declaraban
aprobación, 20 fallo y 29 no tenían clasificación concluyente. No se ejecutaron
otra vez ni se sustituyó un fallo por el resultado de una versión posterior.

La recuperación adjunta metadatos depurados: ruta relativa/huella del original,
resultado declarado, flags y mediciones/consumo informados. No copia conversaciones,
respuestas de proveedor, claves, errores privados, audio ni videos. Un hash
conserva referencia, no demuestra calidad ni convierte el informe en comprobación
actual. Índice: `tmp/activity-reconciliation/index.json`.

## Cambios y pruebas actuales

La extensión 0.4.0 tiene implementación y evidencia propias en
[traducción progresiva](traduccion-progresiva-video.md). Se registraron por separado
las pruebas locales, Brave aislado con demoras y un ensayo acotado con voz
sintética propia, APIs reales y salida nativa. Coste monetario no medido sigue
desconocido. No se presenta YouTube personal o escucha física como verificados.

La corrección de fixtures sin `route`, la cola/ACK y la retirada de indicadores
al reintentar quedan incorporadas junto con fallos y aprobaciones posteriores.
No se reescribe la base histórica.

## Comprobación reproducible

`tools.audit_activity` sólo lee la base y evidencias. Comprueba cadena, copias,
versiones documentales e informes de suites:

```powershell
.venv/Scripts/python.exe -X utf8 -B -m tools.audit_activity --output tmp/bitacora-audit-after.json
```

El cierre adjunta el informe resultante. La cadena no es una firma digital ni
una evaluación funcional de todas las capacidades. Ninguna prueba pendiente se
aprobó por tener archivos. Las incorporaciones usan `tools.activity` y mantienen
el orden histórico.

El auditor comprueba también cambios de contenido en informes ya adjuntos,
no sólo sus nombres. Se ensayó con bases desechables: detectó versiones nuevas,
archivos sin registrar, copias ausentes/alteradas y cadena rota, sin modificar
la base auditada. El primer ensayo falló al limpiar un SQLite abierto en Windows;
se conserva ese fallo y el resultado posterior con cierre explícito.

La entrega 0.4.0 quedó empaquetada y sus 16 archivos coinciden con el código
fuente. Se actualizaron las carpetas descomprimidas de distribución, incluida
la ruta 0.3.0 para instalaciones existentes; su ZIP histórico se conserva.
Metadatos nativos confirman una barra WorkSpace y conexión loopback operativa.
El navegador personal no fue recargado: su acceso sigue deshabilitado en Work.
