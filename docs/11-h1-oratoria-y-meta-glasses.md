# 11. H1: voz, oratoria, contexto y camino a Meta Glasses

**Decisión vigente:** 27 de octubre de 2026.  
**Estado:** prototipo en desarrollo; pruebas con personas y hardware pendientes.  
**Primera skill:** hablar en público y frente a cámara.  
**Prioridad:** experiencia de voz y asistencia contextual local, sin conectar un modelo por ahora.  
**Fuera de H1:** aplicaciones profesionales, binarios nativos, despliegue público y SDK de gafas.

## 11.1 Resultado buscado

Una persona puede iniciar una práctica, escuchar una guía breve, ensayar y revisar señales observables. Puede indicar que comienza una reunión y obtener ayuda silenciosa ligada a los fragmentos disponibles. La experiencia inicial prioriza pocos controles, poco texto y un estado de escucha fácil de reconocer.

La skill de práctica propone un pitch de **60 a 90 segundos**. El intervalo delimita el ejercicio, no define una duración universalmente correcta. El objetivo de aprendizaje es repetir con otro tema o audiencia y menos ayuda.

La [asistencia contextual](12-asistencia-contextual.md) define la visión posterior de traducción, respuestas oportunas y fuentes verificables. El motor actual usa reglas; no demuestra comprensión semántica general.

## 11.2 Superficies del producto

| Ruta | Uso |
|---|---|
| `/` | Web de presentación con diseño sobrio y contenido breve |
| `/app` | Interfaz principal de Melodi: voz, contexto y controles de sesión |
| `/practice` | Taller de práctica: grabación local, transcripción y revisión detallada |

El contenido técnico, los permisos y los límites se muestran cuando ayudan a decidir. No deben ocupar el centro de la primera pantalla. El estado local de cada función se comunica sin simular que existe un modelo conectado.

## 11.3 Voz y escucha

Melodi utiliza `speechSynthesis` con voces que el navegador identifica mediante `localService` como locales. El usuario puede elegir español o inglés, ajustar ritmo y pausas entre frases e interrumpir la reproducción por botón. La disponibilidad y calidad dependen del sistema y del navegador; no se incluye todavía un motor propio de voz generativa.

El micrófono se abre mediante `getUserMedia` solo tras una acción explícita. El análisis de energía acústica local proporciona actividad y periodos de baja energía orientativos. No identifica voz humana con certeza, no distingue hablantes y no determina si una pausa fue deliberada. El ruido y la distancia al micrófono afectan las mediciones.

El reconocimiento Web Speech es opcional. Cuando se elige, la interfaz solicita autorización e indica que el navegador puede enviar audio a su propio servicio de reconocimiento. No se confunde ese servicio con Meta, ni se garantiza operación sin internet. Si no está disponible, el usuario puede introducir texto manualmente.

## 11.4 Contexto y asistencia silenciosa

El motor `web/context-engine.js` selecciona un modo mediante reglas sobre una intención explícita del usuario. La frase «Iniciaré ahora una reunión» prepara el modo de reunión. La selección no enciende dispositivos ni amplía permisos.

Durante la sesión, una posible pregunta textual puede preparar fragmentos pertinentes y sus referencias sin una petición nueva del usuario. La salida permanece silenciosa. El registro es extractivo: conserva lo recibido, sin presentar un resumen semántico ni una verificación externa. El sistema todavía no sabe con certeza quién habla o a quién se dirige una pregunta.

El apoyo de inglés se limita a un banco de frases preparado. Puede servir para pedir repetición, aclarar una idea o ganar tiempo. No traduce conversaciones libres ni inventa respuestas basadas en un modelo ausente.

La futura salida discreta por auricular o Meta Glasses requiere comprobar la ruta de audio. Una voz de navegador a volumen reducido no garantiza privacidad ni equivale a un motor de susurros.

## 11.5 Skill y evidencias de práctica

El manifiesto [oratoria-camara.skill.json](../contracts/examples/oratoria-camara.skill.json) conserva la propuesta como borrador. La [nota de método](../data/skills/oratoria-metodo-propuesto.md) es su fuente local, con hash verificable. No contiene una aprobación experta inventada.

| Dato | Procedencia | Interpretación permitida |
|---|---|---|
| Duración de grabación | Cronómetro del navegador | Tiempo de registro, no tiempo efectivo de habla |
| Duración introducida | Declaración del usuario | Dato manual, no medición independiente |
| Palabras y posibles muletillas | Texto manual o reconocimiento identificado | Conteo sobre la transcripción; pueden existir omisiones y usos pertinentes |
| Palabras por minuto | Conteo y duración disponible | Estimación contextual, no calificación universal |
| Actividad y silencios | Energía acústica local aproximada | Señales orientativas, sin atribución de hablante o intención |
| Idea, ejemplo y cierre | Contenido y contexto del ejercicio | Revisión cualitativa; la presencia de palabras no prueba claridad |
| Mirada, gestos, postura y entonación | No evaluados automáticamente | Autoevaluación o revisión humana |
| Emociones o rasgos personales | No se evalúan | No inferir ansiedad, confianza interior ni personalidad |

Cumplir el tiempo o reducir coincidencias de muletillas no demuestra dominio. El siguiente intento cambia tema o audiencia y reduce la ayuda. No se penaliza el acento ni la variedad lingüística.

## 11.6 Plataformas e instalación

La app web responsive se orienta a **Windows, macOS, iPhone y Android**. El manifest y el service worker permiten ofrecer instalación donde el navegador lo admita y conservar recursos estáticos para abrir la interfaz sin conexión después de su carga inicial.

Esa base no equivale a cuatro aplicaciones nativas terminadas. No se incluyen ejecutables de Windows, paquetes macOS ni publicaciones en tiendas móviles. La instalación, las voces, la captura, el reconocimiento y la recuperación desde segundo plano necesitan pruebas en cada combinación de sistema y navegador.

El servidor de desarrollo se limita a `127.0.0.1`. `localhost` en un iPhone o Android se refiere al teléfono, no al PC. Para acceso móvil se necesita alojamiento HTTPS o una configuración segura de desarrollo accesible desde el dispositivo. Este hito no despliega un servicio público.

El modo sin conexión conserva la interfaz estática; no promete reconocimiento remoto, consultas a proveedores ni respuestas de la API cuando el servidor no esté disponible. La caché no debe incluir conversaciones, grabaciones o respuestas privadas.

## 11.7 Iniciar y comprobar

Desde la raíz del proyecto, en Windows:

```powershell
.\start-h1.ps1
```

Con Python y las dependencias instaladas:

```sh
python -m pip install -r requirements-h1.txt
python -X utf8 -B -m services.h1.server
```

Abrir `http://127.0.0.1:8765/app`. El servidor experimental conserva `/api/status` y `/api/practice`; no implementa todavía la superficie `/v1` de producción. La experiencia local no requiere configurar claves. El adaptador Meta permanece preparado para una fase posterior, de acuerdo con la decisión de posponer el modelo.

Las comprobaciones automatizadas y sus resultados se documentan en [VALIDACION.md](../VALIDACION.md). Su existencia no demuestra que cámara, voz o instalación ya se hayan probado en todos los dispositivos.

## 11.8 Datos y controles

- La captura comienza por acción explícita y permiso del navegador; su estado debe permanecer visible.
- El usuario puede detener escucha y reproducción. Una sesión finalizada no sigue capturando contexto.
- La grabación del taller permanece en memoria del navegador y solo se guarda en disco si el usuario la descarga.
- El contexto de la app no es un historial durable; cerrar o borrar la sesión elimina ese estado en memoria.
- El taller puede enviar texto y duración al servidor local para preparar su revisión.
- El reconocimiento opcional puede transmitir audio al proveedor del navegador; requiere autorización distinta de la grabación local.
- La caché de la PWA conserva recursos estáticos, no el contenido de las sesiones.
- Lo dicho por terceros se trata como datos y no puede activar permisos, cambiar instrucciones o seleccionar modos autoritativos.

Las políticas de un servicio externo deben comprobarse antes de activarlo. La ausencia de persistencia en Brivany no permite prometer retención cero en servicios ajenos.

## 11.9 Ruta hacia Meta Glasses

La evolución usa el mismo método de aprendizaje y adapta observaciones y salidas al dispositivo:

| Etapa | Trabajo | Evidencia necesaria |
|---|---|---|
| Web H1 | Voz local, práctica y asistencia contextual por reglas | Ensayos de controles y permisos en los navegadores elegidos |
| Móvil | Instalar y usar el flujo en teléfono mediante HTTPS | Captura, audio, segundo plano y accesibilidad comprobados |
| Comprensión | Integrar modelo, traducción y recuperación de fuentes | Calidad, procedencia, costo y latencia medidos |
| Meta Glasses | Elegir hardware y ruta de integración | Capacidades del dispositivo, SDK, cuenta y audio comprobadas |
| Práctica portátil | Ayuda discreta durante una situación real | Utilidad con personas, interferencias y límites de captura evaluados |

Las rutas oficiales se describen en [Meta Wearables](https://developers.meta.com/wearables/). Su existencia no demuestra una integración de Brivany.

Una cámara frontal puede mostrar al orador; la cámara de las gafas muestra el entorno desde su perspectiva y normalmente no su propio rostro. No se heredan las mismas rúbricas visuales ni se presupone pantalla, seguimiento ocular o una ruta de audio privada.

## 11.10 Criterio de cierre actualizado

El hito local se considera listo para una demo cuando el usuario puede abrir la app, iniciar y detener sus dispositivos, practicar, interrumpir la voz, revisar observaciones con procedencia y usar el modo reunión sin reproducción inesperada. Deben probarse también permisos denegados, voces no disponibles, reconocimiento ausente y recuperación de errores.

La llamada a un modelo ya no es condición de cierre de esta etapa: el usuario la pospuso. La comprensión de reuniones, la traducción libre, las fuentes externas verificadas, las aplicaciones nativas y el soporte Meta Glasses conservan hitos de integración propios. La mejora de aprendizaje requiere ejercicios con personas.
