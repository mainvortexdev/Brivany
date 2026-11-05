# 8. Plan de implementación y evaluación

> Plan histórico de H1. La prioridad vigente y la secuencia de implementación están en [PLAN_PLATAFORMA.md](../PLAN_PLATAFORMA.md). Las referencias de este documento a Meta sin configurar o a transcripción exclusivamente manual corresponden al arranque de H1; para capacidades comprobadas ver [voz live](13-voz-live.md), [human-skills](14-human-skills.md) y [validación](../VALIDACION.md).

Actualizado el 27 de octubre de 2026 por cambio de prioridad del producto.

## 8.1 Estado actual

H0 dejó arquitectura, contratos y ejemplos. **H1 se inicia con hablar en público y frente a cámara**, usando un prototipo local. Meta Glasses es la siguiente superficie prevista; DaVinci, Blender y AutoCAD quedan fuera de este hito.

La arquitectura de producción sigue siendo el destino del diseño. El servidor local conserva borradores de human-skills y su progreso; no implementa persistencia de conversaciones, aislamiento multiusuario ni los conectores futuros. El PDF 0.1 conserva el alcance anterior; estos Markdown y [human-skills](14-human-skills.md) describen la dirección actual.

## 8.2 Secuencia por hitos

| Hito | Trabajo | Criterio para avanzar |
|---|---|---|
| H0 · Arquitectura | Contratos, decisiones y modelo lógico | Base coherente y prioridades actualizadas |
| H1 · Prueba técnica de oratoria | Práctica local, captura opcional, transcripción manual y propuesta estructurada Meta | Captura comprobada, guía útil sobre texto real y llamada Meta medida |
| H2 · Motor mínimo | Versiones, sesiones, intentos y evidencia persistentes | Recuperar una práctica y distinguir datos de juicios pedagógicos |
| H3 · Creación de skills | Demostración propia, fuentes, extracción y revisión experta | Publicar una skill revisada y trazable |
| H4 · Aprendizaje | Segunda audiencia o tema con menor ayuda | Evidencia humana de transferencia y errores registrados |
| H5 · Robustez | Permisos, interrupciones, falta de evidencia y respuestas inválidas | Recuperación sin atribuir capacidades inexistentes |
| H6 · Meta Glasses | Dispositivo y ruta elegidos, adaptador y práctica portátil | Capacidades comprobadas con hardware real |
| H7 · Otras especialidades | Evaluar conectores profesionales según prioridad | Reutilizar el motor añadiendo contenido y adaptador |

## 8.3 Alcance del primer hito

El alumno prepara una presentación breve con intención, idea, ejemplo y cierre. Puede grabarse localmente y revisar el resultado. Aporta una transcripción manual; Brivany calcula métricas descriptivas y ofrece una guía local claramente identificada.

Cuando Meta esté configurado, el alumno puede solicitar una propuesta pedagógica enviando solo la transcripción y el contexto del ejercicio con consentimiento. El servidor mantiene la clave fuera del navegador. H1 no envía audio ni video al proveedor y no incorpora transcripción automática.

El usuario confirmó acceso a Meta. Aún deben comprobarse modelo habilitado, configuración local, una llamada real, latencia y uso. No se deduce funcionamiento del proveedor a partir de una prueba simulada.

El detalle del ejercicio y la ruta de gafas están en [H1: oratoria y Meta Glasses](11-h1-oratoria-y-meta-glasses.md).

## 8.4 Cierre de H1

Para dar el hito por terminado deben existir evidencias de:

1. Cámara y micrófono funcionando en el navegador del equipo de demo, y detención efectiva de las pistas.
2. Tratamiento claro de permisos denegados y práctica sin cámara.
3. Un intento real con transcripción cuyo origen manual esté identificado.
4. Métricas coherentes con su procedencia; duración declarada diferenciada de la medida.
5. Propuesta Meta válida y útil, con modelo, latencia y uso disponibles registrados.
6. Ninguna atribución de gestos, emociones, mirada, pausas o tono que el sistema no haya observado.
7. Segundo ejercicio propuesto con cambio relevante de tema, audiencia o propósito.

**Estado: iniciado, pendiente de comprobaciones reales.** Las pruebas automatizadas y sus resultados se registran en la validación del proyecto; no sustituyen las pruebas con dispositivos y personas.

## 8.5 Ensayo de aprendizaje posterior

Una pequeña prueba exploratoria puede comparar una instrucción estática y el acompañamiento de Melodi usando tareas equivalentes, alternando el orden. Un experto define la rúbrica y revisa los resultados.

Se registran claridad del propósito, idea principal, pertinencia del ejemplo, cierre, ayudas y capacidad de resolver otra variante. Duración y conteos se conservan como descripciones del intento, no como una puntuación universal de oratoria. No se penaliza acento ni se interpreta apariencia como habilidad.

## 8.6 Ensayos técnicos prioritarios

| Caso | Resultado esperado |
|---|---|
| Permiso de cámara o micrófono denegado | Mensaje claro y alternativa de texto |
| Captura detenida | Liberar recursos y dejar de recoger datos |
| Transcripción ausente | Pedir texto; no fingir reconocimiento de voz |
| Duración ausente o inválida | No calcular una tasa engañosa |
| Transcripción manual | Origen visible y límites explícitos |
| Texto que pide cambiar las reglas del sistema | Tratarlo como contenido de la práctica |
| Proveedor sin configurar | Guía local identificada o error accionable, sin simular Meta |
| Meta devuelve JSON inválido | Rechazar respuesta y mostrar fallo recuperable |
| Solicitud de envío sin consentimiento | No llamar al proveedor |
| Falta señal audiovisual | No afirmar entonación, mirada, postura ni pausas |
| Cambio a perfil de gafas sin SDK | Mostrar capacidad futura, sin fingir conexión |
| Segundo intento | Conservar distinción entre práctica y dominio demostrado |

## 8.7 Próximos datos y decisiones

Se necesita el modelo Meta habilitado y su configuración local, una práctica autorizada y la comprobación del navegador. La clave no debe pegarse en el chat ni incluirse en documentación o repositorios.

Antes de H6 se elegirá el modelo de Meta Glasses y el teléfono disponible. La selección depende de las capacidades ensayadas; no es una compra requerida para empezar H1.

Las fechas y condiciones del hackatón se revalidarán en la fuente oficial antes de fijar el calendario de entrega. El calendario del documento 0.1 no se considera una confirmación actual del organizador.

## 8.8 Primera versión funcional del producto

Una persona puede registrar un método, revisar una skill y usarla para guiar a otra persona en una situación diferente. Melodi cita el método, reconoce información ausente y ayuda a mejorar una práctica. El sistema conserva el progreso y separa observaciones, propuestas y evaluación humana.

H1 inicia ese camino con una práctica local acotada; no entrega por sí solo toda esa versión funcional.

