# Brivany · Objetivo integral de 72 horas

Estado del objetivo del chat: **activo**, creado y verificado con la herramienta
de objetivos. La creación anterior fue rechazada por el objetivo de voz en pausa;
esa tentativa no constituyó un objetivo nuevo. El registro actual incluye la
plataforma completa, sin marcar como terminado el trabajo anterior.

Inicio del plazo solicitado: **28 de octubre de 2026, 21:00:47, America/La_Paz**.
Meta de cierre de implementación e integración: **31 de octubre de 2026,
21:00:47, America/La_Paz** (1 de noviembre, 01:00:47 UTC).
Los días posteriores se dedican a perfeccionar, medir y preparar la presentación.
Es una meta de ejecución: el tiempo transcurrido no demuestra cumplimiento.

## Alcance que debe probarse

- [ ] Captura profesional de viviendas, lugares y construcciones desde móvil;
  interfaz de captura tipo gafas y adaptación al hardware Meta Glasses cuando
  esté disponible. Validar grabación y controles en dispositivos físicos.
- [ ] Modelos de Meta orquestados para reconstrucción multivista, plano completo
  con detalles y objetos editables. Revisar escala, precisión, cobertura, zonas
  ocultas e incertidumbre; no presentar dimensiones inferidas como medidas.
- [ ] Visualizador ejecutado **localmente en el dispositivo del usuario**:
  materiales, iluminación, sombras, interacción, física y calidad ajustable;
  medir rendimiento y consumo de recursos en los dispositivos objetivo.
- [ ] Procesamiento pesado en infraestructura adecuada (Modal preparado), sin
  imponer inferencia de modelos grandes al teléfono u ordenador del usuario.
- [ ] Aplicación de escritorio que cree, guarde y reabra el proyecto íntegro en
  el ordenador; artefactos y versiones portables, transferencia opcional y
  presentación inmobiliaria interactiva.
- [ ] Chat único de Melodi mediante WhatsApp Business: recordatorios, agenda,
  Gmail, Drive y control autorizado del ordenador con acciones acotadas.
- [ ] Instagram y Facebook para administración de redes y anuncios, con
  permisos, presupuestos y publicación comprobados explícitamente.
- [ ] **Sous como primera human-skill**: inventario, incertidumbre, recetas
  según localidad/comida típica, cocina interactiva con voz, listas, pedidos y
  anotación en el chat propio de WhatsApp. Preservar la habilidad de oratoria.
- [ ] Live Traductor para video: voz inteligible casi en tiempo real al idioma
  elegido y medición del retraso audible por fragmentos correspondientes.
- [ ] Frontend, cuentas, APIs, pruebas de integración y recorridos reales con
  los accesos disponibles, sin repetir pruebas pagadas sin una duda concreta.
- [ ] Evidencia de funcionamiento, consumo y límites en la bitácora; separar
  fixtures, replay, interpretación manual e inferencia real.

## Orden de ejecución

1. Cerrar los recorridos ya en implementación: interior basado en referencias,
   render local, física experimental, Sous y proyectos locales. Conservar los
   límites de procedencia de cada resultado.
2. Conectar y comprobar proveedores/cuentas: reconstrucción Meta/Modal, voz,
   WhatsApp y conectores personales/sociales. Preparar primero resultados y
   formularios revisables; solicitar únicamente la intervención indispensable.
3. Ensayar flujos completos y persistencia, resolver errores, medir rendimiento,
   latencia y coste. Preparar respaldo reproducible sin sustituir pruebas reales.

Las implementaciones parciales se detallan en `PLAN_PLATAFORMA.md`. Esta lista
conserva sin marcar los requisitos integrales mientras no haya prueba suficiente
del recorrido completo. Una escena procedural no acredita reconstrucción;
una prueba de Rapier no mide materiales reales; un mock de API no acredita una
cuenta conectada; una PWA o carpeta portable no es una aplicación nativa instalada.

## Dependencias explícitas

Credenciales, licencias/checkpoints, autorizaciones de cuenta y gasto, hardware,
capturas reales y medidas de referencia requieren evidencia o intervención
concreta. Se implementa lo independiente mientras se completan; no se inventan
saldos, fechas, resultados de piloto ni permisos. Spaik Iris conserva pendiente
la arquitectura del usuario y no sustituye los casos de uso anteriores.
