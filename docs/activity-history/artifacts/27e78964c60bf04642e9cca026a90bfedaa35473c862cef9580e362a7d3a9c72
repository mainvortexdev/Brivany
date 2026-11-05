# 9. Registro de decisiones

Actualizado el 27 de octubre de 2026. Las decisiones de producto más recientes sustituyen la prioridad de DaVinci del paquete 0.1.

La nueva prioridad espacial se define en [la checklist](../PLAN_PLATAFORMA.md). ADR-003, ADR-010 y ADR-017 describen la primera etapa de aprendizaje; ADR-020 conserva la decisión de diferenciar guía local y modelo, pero su referencia a una conexión Meta pospuesta quedó superada por la [integración live](13-voz-live.md).

| ID | Decisión | Razón | Revisión futura |
|---|---|---|---|
| ADR-001 | Producto Brivany y agente Melodi | Identidad del producto | Solo por decisión de producto |
| ADR-002 | Arquitectura modular con API, worker y adaptadores | Separar pedagogía, modelos y fuentes | Desplegar conforme se validen los hitos |
| ADR-003 | Enseñanza como modo inicial | El resultado principal es aprendizaje humano | Demostraciones cuando el dominio lo requiera |
| ADR-004 | Skills revisadas e inmutables al publicar | Trazabilidad entre método y alumno | Revisión por pares y distribución |
| ADR-005 | Motor de sesión determinista | Las transiciones requieren evidencia y reglas | Implementar en H2 |
| ADR-006 | Evidencia directa antes de inferencias | Saber qué se midió y qué se propone | Añadir señales tras calibrarlas |
| ADR-007 | Desconocido explícito | No aprobar por ausencia de evidencia | Calibrar rúbricas por dominio |
| ADR-008 | Adaptadores por capacidades | Dispositivos y versiones difieren | Perfiles homologados |
| ADR-009 | Meta detrás de un adaptador | Uso trazable sin acoplar la skill a un modelo | Medir modelos disponibles con el mismo ejercicio |
| ADR-010 | Una habilidad funcional primero | Concentrar la prueba de transferencia | Oratoria inicial; otras profesiones después |
| ADR-011 | PostgreSQL y medios privados para producción | Consistencia y retención controlada | H1 local no necesita persistencia |
| ADR-012 | Outbox y trabajos persistentes en producción | Recuperación sin prometer entrega perfecta | H2 y siguientes |
| ADR-013 | Interfaz local autorizada para iniciar H1 | La práctica frente a cámara necesita interacción | Sustituye la limitación documental de H0 |
| ADR-014 | Sin código arbitrario dentro de skills | El contenido no adquiere permisos | Extensiones revisadas aparte |
| ADR-015 | Aprendizaje separado de tarea completada | La ayuda no demuestra dominio independiente | Evaluación longitudinal |
| ADR-016 | Sin entrenamiento propio inicial | Evaluar modelos y contenido revisado | Ajustar solo con evidencia de necesidad |
| ADR-017 | Hablar en público y frente a cámara es la primera skill | Prioridad explícita del usuario | DaVinci, Blender y AutoCAD aplazados |
| ADR-018 | Meta Glasses es una evolución explícita | Practicar con Melodi en el contexto cotidiano | Probar hardware, SDK y capacidades antes de anunciar soporte |
| ADR-019 | Captura local y procedencia explícita de la transcripción | Distinguir texto manual, ASR local y servicios remotos del navegador | La ampliación de voz reemplaza la restricción inicial a transcripción manual; probar cada modalidad y su autorización |
| ADR-020 | Guía local diferenciada de propuesta de un modelo | Hacer visible qué motor produjo cada resultado | Conexión a Meta pospuesta por el usuario; no atribuir IA generativa al flujo local |
| ADR-021 | Rúbricas adaptadas a la perspectiva del dispositivo | La cámara de gafas no observa el rostro del portador | Combinar fuentes solo cuando estén disponibles |
| ADR-022 | No inferir emociones ni rasgos personales | Evaluar el ejercicio sobre evidencia pertinente | Mantener revisión humana de criterios cualitativos |
| ADR-023 | Seleccionar skills según contexto autorizado | Reducir la necesidad de elegir herramientas durante una conversación | H1 usa intención explícita y reglas; inferencias ambiguas no cambian permisos |
| ADR-024 | Reuniones silenciosas con ayuda proactiva visible | Mantener al usuario conectado con la conversación sin interrumpirla | Voz discreta solo con salida autorizada y hardware comprobado |
| ADR-025 | Contenido de terceros sin autoridad de configuración | Una transcripción puede contener instrucciones que no son del usuario | Verificar destinatarios y atribución antes de habilitar comandos por voz |
| ADR-026 | Respuestas con procedencia por afirmación | Permitir revisar qué sustenta cada ayuda | Fragmentos de sesión y fuentes externas tienen estados de evidencia distintos |
| ADR-027 | Voz natural y evaluación del habla como capacidades separadas | Mejorar tanto la experiencia de Melodi como la práctica del alumno | Pausas acústicas y muletillas léxicas son aproximaciones; no califican rasgos personales |
| ADR-028 | Traducción libre y fuentes externas requieren integraciones verificadas | No confundir frases preparadas con comprensión o búsqueda real | Conectar modelos y recuperación después de validar el flujo local |
| ADR-029 | Escucha limitada a una sesión activa y controlable | El contexto disponible depende de una autorización concreta | Probar pausa, cierre, retirada de permiso y recuperación por dispositivo |
| ADR-030 | Plataforma espacial para inmobiliarias y arquitectos | Nueva dirección explícita del usuario | Conservar voz y human-skills como capacidades reutilizables |
| ADR-031 | Inferencia 3D intensiva en Modal | Evitar requerir GPU de inferencia en el ordenador o móvil | Validar un objeto, versiones, licencia y consumo antes de ampliar |
| ADR-032 | Procedencia, escala y física declaradas por separado | La apariencia reconstruida no demuestra dimensiones ni propiedades físicas reales | Calibrar y medir cada propiedad antes de presentarla como verificada |
| ADR-033 | Pruebas pagadas acotadas y sin reintentos automáticos | Preservar créditos y resolver decisiones concretas | Aplicar límites efectivos en el ejecutor Modal y medir consumo real |
| ADR-034 | Bitácora local con evidencias conservadas | Hacer revisables cambios, resultados y límites de las pruebas | Cadena local sin firma; no equivale a auditoría independiente |
| ADR-035 | Traducción de videos en vivo como capacidad pendiente | Nueva idea explícita del usuario | Flujo incremental y latencia medida antes de anunciar disponibilidad |
| ADR-036 | Spaik Iris pendiente de arquitectura del usuario | Proyecto propio futuro de generación de imágenes | Sin entrenamiento ni arquitectura inventada en esta etapa |
| ADR-037 | API dedicada de voz a voz para la primera ruta de doblaje | Reducir etapas secuenciales y conservar la voz habitual de Melodi | Adaptador OpenAI comprobado con simulación; proveedor real y máximo de 500 ms sin verificar; comparar otra API solo con una pregunta técnica concreta |

La [capacidad de asistencia contextual](12-asistencia-contextual.md) desarrolla estas decisiones y sus criterios de aceptación. Una implementación local de reglas no demuestra comprensión universal, diarización, traducción libre ni latencia instantánea.

## Alternativas consideradas

**Integrar aplicaciones profesionales en H1:** no corresponde a la primera habilidad solicitada. Los contratos de esos dominios se conservan como referencias de extensión.

**Exigir gafas desde el comienzo:** retrasaría la validación del ejercicio. El flujo se prueba en navegador y se diseña el adaptador portátil por separado.

**Usar la misma rúbrica visual en webcam y gafas:** mezcla perspectivas diferentes. Cada criterio declara qué evidencia necesita.

**Presentar la transcripción manual como automática:** ocultaría una capacidad pendiente. El origen manual debe mostrarse y sus métricas se interpretan con ese límite.

**Escucha permanente para conocer todo el contexto:** excede la sesión necesaria y confunde disponibilidad con autorización. Se trabaja con entradas declaradas, activación explícita e incertidumbre visible.

**Leer toda sugerencia en voz alta durante una reunión:** puede interrumpir o exponer contenido. La salida inicial es silenciosa; una voz de bajo volumen no se considera privada por sí sola.

**Marcar una respuesta como verificada por incluir un enlace:** una URL puede ser irrelevante o no respaldar la afirmación. La recuperación y la correspondencia con la fuente deben comprobarse.

**Puntuación única de oratoria:** mezcla duración, contenido y juicios subjetivos. Se usan observaciones explicables y revisión cualitativa.

**Microservicios desde el inicio:** añade operación antes de comprobar utilidad. El diseño conserva límites para ampliar después.

