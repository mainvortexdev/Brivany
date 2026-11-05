# 4. Melodi y los modelos

## 4.1 Rol de Melodi

Melodi es la agente integrada de Brivany. Mantiene continuidad pedagógica, interpreta lo que el alumno intenta conseguir y explica decisiones dentro del alcance de una skill. El motor de sesión mantiene el estado autoritativo; Melodi propone cómo ayudar.

El primer diseño usa una única orquestación con roles internos y herramientas tipadas. No necesita una red de agentes autónomos ni entrenamiento de un modelo fundacional para empezar.

## 4.2 Entradas por turno

1. Objetivo de la sesión y versión fijada de la skill.
2. Paso activo, parámetros y nivel de ayuda.
3. Última observación autorizada y diferencias relevantes respecto a la anterior.
4. Mensaje del alumno, cuando exista.
5. Errores e intentos recientes, con referencias a evidencia.
6. Fragmentos pertinentes de la explicación experta y documentación de la aplicación.
7. Herramientas efectivamente disponibles y límites del modo actual.

El contexto se selecciona por relevancia. No se transmite todo el escritorio, la biblioteca completa ni la grabación entera en cada turno.

## 4.3 Salida estructurada

Melodi devuelve una propuesta con:

- Explicación para el alumno.
- Tipo de intervención: explicar, preguntar, proponer herramienta, proponer verificación o escalar.
- Referencias a pasos y fuentes que respaldan la intervención.
- Datos que faltan y supuestos que necesita confirmar.
- Acción propuesta, si corresponde, con nombre de herramienta y argumentos.

La salida se valida contra el contrato. Una respuesta mal formada puede repararse una sola vez con un presupuesto acotado. Si sigue fallando, la sesión se pausa con un estado recuperable. El modelo no devuelve campos que permitan atribuirse una aprobación humana.

## 4.4 Modos de sesión

| Modo | Operaciones permitidas por diseño |
|---|---|
| `coach` | Leer contexto autorizado, explicar y solicitar comprobaciones; el alumno actúa |
| `demonstrate` | Mostrar una operación delimitada en una copia o ejercicio recuperable |
| `assist` | Ejecutar operaciones solicitadas y autorizadas en el proyecto permitido |
| `assess` | Observar y evaluar un ejercicio; registrar cualquier ayuda solicitada |

El modo inicial es `coach`. El cambio de modo es una operación explícita, auditable y sujeta a permisos. En evaluación, una demostración del agente invalida la clasificación del intento como independiente; el trabajo puede conservarse como práctica.

## 4.5 Asignación de modelos

| Función | Candidato basado en documentación | Condición antes de utilizarlo |
|---|---|---|
| Interpretar demostraciones y contexto multimodal | Muse Spark o Muse Wonder | Ensayo de precisión, costo y latencia en las tareas reales |
| Razonamiento complejo y propuestas de herramientas | Muse Wonder | Acceso a API confirmado y límite de costo por sesión |
| Control visual de escritorio | Computer tool de Muse Wonder | Driver propio, autorización, observación reciente y recuperación |
| Transcribir narración | Muse Voice Transcribe | Compatibilidad de idioma y transporte comprobada |
| Segmentar objetos físicos o regiones visuales | SAM 3.1 | Necesidad real; no es requisito del primer tutor de escritorio |
| Generar imágenes de apoyo | Muse Image | Contenido ilustrativo señalado como tal; no evidencia del proyecto |
| Inferencia local futura | Modelo open-weight compatible | Ensayos en el hardware objetivo; no se promete ejecución local universal |
| Voz de salida | Adaptador de síntesis por decidir | La transcripción de Meta no se trata como síntesis de voz |

La documentación consultada confirma modalidades e interfaces, no el desempeño en colorización, CAD o modelado. Los identificadores y permisos se configuran por despliegue; la disponibilidad se comprueba con una llamada de prueba antes de habilitar una capacidad. Muse Wonder Full no se presupone disponible a través de Model API.

## 4.6 Adaptador de modelos

Interfaz interna propuesta:

- `describe_capabilities()`: modalidades, límites, herramientas y versión efectiva.
- `extract_skill(segments, schema)`: borrador con fuentes y preguntas.
- `propose_guidance(context, schema)`: propuesta pedagógica tipada.
- `analyze_visual_evidence(context)`: candidato de evaluación con argumentos y fuentes.
- `transcribe(audio_ref)`: transcripción y marcas temporales disponibles.
- `propose_computer_action(context)`: acción visual, solo si el proveedor la soporta.

No todos los modelos deben implementar todas las operaciones. Una capacidad no disponible se declara expresamente. El router conserva proveedor, modelo, versión, parámetros, duración y costo de cada llamada. Los prompts y las rúbricas se versionan por separado de la skill.

## 4.7 Herramientas de Melodi

Herramientas iniciales de lectura: obtener paso, recuperar fuente, inspeccionar observación, consultar capacidades y solicitar verificación. Las herramientas de escritura pasan por la política de acciones y por un conector registrado.

El catálogo de herramientas contiene nombre, versión, esquema de argumentos, permisos, riesgo, precondiciones y verificador de poscondición. En el prototipo, una skill del creador solo puede elegir herramientas previamente aprobadas. No puede añadir una herramienta que ejecute shell o código arbitrario.

## 4.8 Memoria

- **Sesión:** objetivo, paso, datos recientes y resumen acotado. Se recupera de la base de datos.
- **Aprendizaje:** historial de ejercicios y nivel de ayuda, separado por alumno y dominio.
- **Contenido:** skills revisadas y documentación con versión, autoría y permisos.
- **Preferencias:** idioma y nivel de explicación, editables por el usuario.

Las recomendaciones nuevas no se convierten automáticamente en conocimiento experto permanente. Una mejora de skill pasa por revisión y genera otra versión.

## 4.9 Comportamiento ante incertidumbre

Melodi debe distinguir una observación del conector de una inferencia visual. Si no sabe qué versión está abierta, qué proyecto está activo o qué significa un parámetro, pregunta o solicita una lectura. Si las fuentes discrepan, conserva la discrepancia y pide revisión.

En colorización, la valoración final debe separar restricciones técnicas de intención estética. En arquitectura, completar un ejercicio de dibujo no acredita la validez constructiva de una solución. El producto debe expresar el alcance de la skill y de su comprobación.

## 4.10 Rendimiento y costo

La primera estrategia es captura por evento o solicitud, diferencias de estado, caché de fuentes y respuestas breves. Un flujo continuo de video hacia el modelo no es requisito de la arquitectura. El procesamiento prolongado de una demostración ocurre en el worker.

Cada sesión tiene un presupuesto configurado, contador de llamadas y límite de intentos. Los umbrales se fijan después del primer ensayo de consumo; no se presupone que los créditos del evento estén habilitados en la cuenta. Si el presupuesto se agota, se conserva el progreso y se detienen nuevas inferencias de pago.

