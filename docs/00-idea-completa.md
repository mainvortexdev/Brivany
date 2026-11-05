# Brivany y Melodi

Actualizado el 27 de octubre de 2026. Primera habilidad: hablar en público y frente a cámara. Dirección del producto: aprendizaje y asistencia contextual, con evolución explícita hacia Meta Glasses.

## La idea del producto

Brivany es una plataforma para crear, compartir y aprender habilidades prácticas. Su unidad principal es la skill humana: un método explicado, revisado y preparado para adaptarse a otra persona. Melodi acompaña al usuario durante la práctica y, en la visión del producto, también cuando necesita aplicar ese conocimiento en una situación real.

La primera habilidad es **hablar en público y frente a cámara**. Una persona prepara una intervención breve, la practica, recibe observaciones y prueba otra variante con menos ayuda. El aprendizaje se demuestra al adaptar el método a otro tema, audiencia o situación.

La asistencia contextual amplía esa experiencia. Si el usuario anuncia «Iniciaré ahora una reunión», Melodi debe preparar el contexto, permanecer en silencio y ofrecer ayuda oportuna. Si necesita desenvolverse en inglés, la evolución prevista incluye comprender la conversación, traducir y proponer cómo responder. El objetivo es que el usuario se mantenga conectado con lo que ocurre, sin pedir cada ayuda de nuevo.

## El problema que resuelve

Ver una explicación no garantiza poder comunicar una idea ante una cámara, seguir una reunión en otro idioma o responder a una pregunta difícil. Brivany conecta un método con el contexto del usuario y conserva las fuentes que respaldan la ayuda.

La visión exige distinguir lo conocido de lo que falta. Un fragmento de reunión permite revisar qué se dijo; una respuesta factual necesita fuentes que realmente respalden sus afirmaciones. Si no hay evidencia suficiente, Melodi indica el límite y ayuda a pedir aclaración.

## Qué recibe cada persona

**El experto** podrá registrar su método, corregir una skill, definir variantes y publicar una versión revisada. Conserva autoría, fuentes y condiciones de uso. El flujo de creación completo corresponde a hitos posteriores al prototipo técnico.

**El alumno** recibe una práctica guiada, observaciones explicables y un siguiente ejercicio. Durante una conversación, la asistencia deberá ayudarle a comprender y responder sin sustituir sus decisiones ni presentar una tarea asistida como dominio independiente.

**Una escuela o equipo** podría organizar una biblioteca de métodos y observar dificultades comunes. Esa aplicación se evaluará después del primer flujo funcional.

## Experiencia de creación prevista

1. El experto elige una habilidad delimitada y materiales que puede compartir.
2. Demuestra un ejemplo y explica decisiones y criterios.
3. Brivany propone pasos, fuentes y preguntas pendientes.
4. El experto corrige el borrador y define adaptaciones permitidas.
5. Añade un ejercicio de transferencia y criterios de evaluación.
6. Publica una versión revisada vinculada al contenido exacto.

La skill inicial de oratoria sigue en borrador. No se presenta como un curso aprobado por un experto ni se fabrica una revisión humana.

## Primera experiencia de voz

La interfaz principal es una app web de poco texto, centrada en Melodi, el estado de escucha y los controles esenciales. La web de presentación explica el producto; un taller separado permite grabar y revisar una práctica con más detalle.

El prototipo usa voces locales disponibles en el navegador, selección de español o inglés, ritmo ajustable, pausas entre frases e interrupción por botón. El micrófono se activa solo por una acción explícita. La actividad y los silencios estimados por energía acústica orientan la práctica, sin demostrar quién habla ni interpretar emociones.

La transcripción puede introducirse manualmente. El reconocimiento Web Speech es opcional y puede enviar audio al proveedor del navegador; requiere autorización específica. El conteo de posibles muletillas se basa en el texto disponible y no supone que cada coincidencia sea un error de expresión.

La conexión a un modelo está pospuesta por decisión del usuario. Las respuestas locales siguen reglas y contenido preparado. La fluidez conversacional, el timbre de voz y la calidad de la escucha deben probarse en cada entorno; no se anuncian como equivalentes a un sistema de voz generativo.

## Contexto y reuniones

El motor local puede elegir un modo mediante reglas sobre una intención explícita. En reunión conserva silencio, organiza un registro extractivo y prepara fragmentos relacionados con posibles preguntas textuales. No identifica automáticamente a quién se dirige la pregunta, no verifica hechos externos y no interpreta todo el entorno.

El apoyo inicial de inglés es un banco de frases preparado para pedir repetición, aclarar o ganar tiempo. La traducción libre, el resumen semántico y las respuestas complejas con fuentes consultadas son capacidades posteriores, sujetas a integración y evaluación.

El diseño completo y sus límites se detallan en [asistencia contextual](12-asistencia-contextual.md). La selección de habilidad no amplía permisos. Lo dicho por terceros se analiza como contenido y no cambia instrucciones ni configuración.

## Aprendizaje y presencia

La voz de Melodi y la forma de hablar del alumno se trabajan por separado. Melodi debe respetar pausas, permitir interrupciones y acompañar con brevedad. El alumno puede revisar ritmo, posibles muletillas y silencios con sus limitaciones, y pedir revisión humana del contenido y la presencia ante cámara.

No se deducen personalidad, ansiedad, confianza interior ni competencia profesional a partir de voz o imagen. No se penalizan acentos ni variedades lingüísticas. Completar una tarea con asistencia y poder repetirla de forma independiente siguen siendo resultados distintos.

## Plataformas y Meta Glasses

Brivany se orienta a **Windows, macOS, iPhone y Android**. La primera implementación es una web responsive instalable mediante manifest y service worker. Sus recursos estáticos pueden conservarse para abrir la interfaz sin conexión tras una carga inicial; la disponibilidad de captura, reconocimiento e instalación depende del navegador. No hay todavía binarios nativos ni una matriz de hardware homologado.

El servidor de desarrollo solo escucha en el PC. Un teléfono necesita una dirección HTTPS accesible; `localhost` en el teléfono no apunta al ordenador. El despliegue público no forma parte de este hito.

**Meta Glasses es una evolución explícita**, con observaciones y salidas adaptadas a las capacidades del dispositivo. Una cámara frontal puede mostrar al orador; la cámara de las gafas muestra su perspectiva del entorno y no su propio rostro. El acompañamiento discreto deberá comprobar rutas de audio, permisos, latencia y utilidad. Un volumen bajo no equivale por sí solo a un susurro privado.

La ruta de incorporación está en [H1 y Meta Glasses](11-h1-oratoria-y-meta-glasses.md). H1 no incorpora un SDK de gafas ni declara compatibilidad comprobada con ellas.

## Expansión y objetivo del hackatón

DaVinci Resolve, Blender y AutoCAD permanecen como dominios futuros. Sus ejemplos contractuales sirven para estudiar la extensibilidad del diseño, sin integrarlos en el primer hito actual.

La demo debe mostrar una práctica útil y el comportamiento de asistencia silenciosa, dejando visible qué se basa en reglas, qué señales se recibieron y qué integraciones siguen pendientes. La prueba relevante será una mejora concreta y una segunda intervención con menos ayuda, no una promesa de comprensión universal.

La biblioteca, las rutas de aprendizaje, la distribución entre espacios y el modelo comercial se desarrollarán después de validar el uso. Autoría, licencias y revisión se conservan desde el diseño.
