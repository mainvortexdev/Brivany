# 1. Objetivo, alcance y capacidades

## 1.1 Objetivo del proyecto

Construir Brivany como una plataforma de transferencia de habilidades: un experto registra cómo resuelve una tarea, revisa la skill generada y la comparte; otra persona recibe acompañamiento de Melodi para aplicar ese conocimiento en una situación diferente.

**Prioridad fijada el 27 de octubre de 2026:** hablar en público y frente a cámara. El primer hito inicia una práctica local de oratoria; Meta Glasses es una evolución explícita del producto. Las integraciones con aplicaciones profesionales quedan aplazadas.

**Resultado central:** el alumno realiza una práctica y consigue resolver una variante con menos ayuda. Completar un ejercicio y adquirir una habilidad son resultados distintos.

## 1.2 Problema y propuesta

Un tutorial puede explicar una estructura sin ayudar al alumno a adaptarla a su tema, audiencia y objetivo. Brivany conserva el método, los pasos y los criterios; Melodi usa esa estructura para acompañar una práctica contextualizada.

Una skill es un paquete de aprendizaje versionado. Incluye objetivos, conocimientos previos, recursos, decisiones, errores frecuentes, criterios de evaluación y referencias al método original. No constituye una certificación profesional.

## 1.3 Actores

| Actor | Responsabilidad |
|---|---|
| Creador experto | Demostrar, explicar criterios, revisar contenido y delimitar usos |
| Alumno | Elegir objetivo, autorizar captura, practicar y resolver variantes |
| Revisor | Aprobar contenido y rúbricas dentro de una especialidad |
| Administrador del espacio | Gestionar miembros, permisos, retención y presupuestos |
| Melodi | Interpretar contexto, explicar y proponer ayuda; no aprobar su propio contenido |
| Motor de sesión | Mantener estados y transiciones conforme a reglas |
| Adaptador de captura | Declarar capacidades y procedencia de observaciones |

En H1 no se implementa todavía el sistema completo de roles ni publicación. El ejercicio inicial es un borrador; una revisión sintética o generada no sustituye a un experto.

## 1.4 Capacidades por etapa

| Capacidad | Alcance técnico H1 | Evolución pendiente |
|---|---|---|
| Práctica | Ejercicio breve de oratoria y segundo intento con variación | Skills expertas revisadas y rutas |
| Captura | Cámara y micrófono del navegador bajo permiso; revisión local | Captura móvil y adaptador Meta Glasses |
| Texto de práctica | Transcripción pegada por el alumno y marcada como manual | Transcripción automática validada |
| Métricas | Duración y conteo de palabras, con procedencia explícita | Señales de audio calibradas por idioma y contexto |
| Guía | Guía local identificada y adaptador Meta opcional | Contexto multimodal y memoria de aprendizaje |
| Evaluación | Observaciones descriptivas y propuestas de mejora | Rúbrica experta y evaluación de transferencia |
| Medios | En memoria del navegador; sin carga ni persistencia de audio/video | Almacenamiento privado y retención elegida |
| Sesiones | Solicitud de práctica local sin historial durable | Motor persistente, intentos y recuperación |
| Wearables | Ruta de integración documentada | Prueba de capacidades del hardware y SDK elegidos |
| Aplicaciones profesionales | Fuera de H1 | DaVinci, Blender y AutoCAD por hitos posteriores |

La tabla define el alcance del trabajo; una capacidad se declara comprobada solo después de pasar sus pruebas. El acceso confirmado por el usuario a Meta aún debe verificarse con la configuración local y una llamada real.

## 1.5 Primera skill y fronteras

**Hablar en público y frente a cámara:** preparar y presentar una idea con propósito, ejemplo y cierre en aproximadamente 60 a 90 segundos. Esa duración es un parámetro del ejercicio, no una norma universal de buena comunicación. El alumno puede adaptarla a su situación.

La primera práctica se realiza frente a cámara o como ensayo de una presentación a público. La cámara es opcional; una práctica de texto permite probar el flujo sin fingir observación audiovisual. La segunda variante cambia tema, audiencia o propósito y reduce la ayuda.

La claridad del mensaje y la adecuación del ejemplo requieren una rúbrica cualitativa. Los conteos no acreditan esas cualidades. La transcripción manual puede omitir muletillas y pausas, por lo que tampoco acredita fluidez vocal.

**Meta Glasses:** siguiente superficie de experiencia, condicionada a pruebas por dispositivo. Su vista en primera persona sirve a otro contexto de observación y no demuestra gestos o mirada del propio orador.

## 1.6 Exclusiones del primer hito

- Conectores con DaVinci Resolve, Blender, AutoCAD u otras aplicaciones profesionales.
- Integración activa con gafas, overlays o asistencia continua durante una presentación real.
- Transcripción automática o evaluación de audio/video que no estén implementadas y verificadas.
- Inferir emociones, ansiedad, personalidad o confianza interna a partir de voz, rostro o gestos.
- Penalizar acento, variedad del idioma o características personales como sustituto de criterios del ejercicio.
- Publicar una skill sin revisión o presentar una recomendación de IA como competencia demostrada.
- Base de datos, cuentas multiusuario y persistencia de grabaciones.

## 1.7 Indicadores del producto

1. Capacidad de comunicar una idea a una audiencia distinta con menos ayuda.
2. Recomendaciones incorrectas o que atribuyen al audio/video algo no observado.
3. Tiempo hasta una sugerencia útil y latencia de la llamada al modelo.
4. Número y tipo de ayudas usadas por intento.
5. Revisión humana de intención, idea, ejemplo y cierre.
6. Costo de inferencia y esfuerzo del experto para revisar contenido.

Los umbrales y resultados necesitan medición. Ninguna mejora de aprendizaje se declara demostrada en H1 por ejecutar una prueba técnica.

