# 5. Captura, Meta Glasses y conectores futuros

## 5.1 Adaptadores por capacidades

El motor de aprendizaje trabaja con observaciones y evidencia normalizadas. La fuente puede ser un navegador, un móvil, unas gafas o una aplicación profesional. Cada adaptador debe declarar lo que puede observar y la procedencia de cada dato; compartir marca o tipo de dispositivo no demuestra compatibilidad.

| Operación conceptual | Resultado esperado |
|---|---|
| `probe` | Dispositivo, versión, permisos y capacidades disponibles |
| `observe` | Datos actuales, intento y procedencia de cada señal |
| `stop` | Detener captura y liberar los recursos disponibles |
| `validate` | Comprobación registrada sobre evidencia autorizada |
| `recover` | Recuperación posible después de una interrupción |

Estos nombres describen el diseño de Brivany, no métodos garantizados de un SDK. Las acciones sobre aplicaciones, sus checkpoints y su recuperación quedan para adaptadores posteriores.

## 5.2 Primera fuente: navegador

El primer hito usa cámara y micrófono del navegador solo después de una acción del alumno y del permiso correspondiente. La grabación se revisa localmente. Audio y video no se transmiten al servidor ni al proveedor de modelos, y no se persisten por el prototipo.

La transcripción se pega manualmente. Su origen permanece visible y no se trata como una lectura directa del audio. Si el alumno no graba, puede probar el ejercicio con texto y una duración declarada, identificada como tal.

El adaptador debe contemplar permisos denegados, ausencia de dispositivos, captura detenida y formatos de grabación disponibles. La presencia de botones no prueba funcionamiento en todo navegador: se verificará el equipo usado para la demo.

## 5.3 Evolución a Meta Glasses

**Decisión de producto:** llevar Melodi desde la práctica frente a cámara hasta una experiencia de aprendizaje portátil en Meta Glasses. No depende de implementar primero DaVinci, Blender o AutoCAD.

Meta publica rutas de desarrollo para gafas mediante Device Access Toolkit, web apps y Meta AI Connectors. Su existencia está documentada; el encaje de cada ruta en Brivany se comprobará por dispositivo y caso de uso. [Fuente oficial](https://developers.meta.com/wearables/).

Ruta propuesta para Brivany:

1. Validar en navegador el ejercicio, la utilidad de la guía y la segunda variante.
2. Elegir modelo de gafas, teléfono y ruta de integración según capacidades reales.
3. Implementar un adaptador que declare entradas, salidas, permisos, disponibilidad y fallos.
4. Reutilizar las skills y Melodi conservando la procedencia de cada observación.
5. Probar práctica portátil con participantes informados antes de habilitar uso más amplio.

No se promete que toda gafa tenga pantalla ni que una misma ruta ofrezca todos los sensores. Las funciones de cámara, audio, voz y presentación de pistas necesitan pruebas independientes. El acceso a la API de modelos no demuestra acceso o compatibilidad del SDK de gafas.

## 5.4 Diferencia entre cámara frontal y perspectiva del usuario

Una webcam puede mostrar al orador, si encuadre y consentimiento lo permiten. La cámara de unas gafas muestra normalmente lo que hay delante de quien las lleva; no muestra su propio rostro.

Por tanto, la futura experiencia de gafas puede centrarse en instrucciones de práctica y contexto disponible, pero no debe aprobar gestos, postura o contacto visual del usuario con imágenes que no lo muestran. La orientación de la cabeza tampoco acredita seguimiento de los ojos. Una señal ausente permanece desconocida.

La cámara del usuario puede incluir a otras personas. La práctica debe permitir limitar la captura y detenerla; no se intenta deducir emociones, atención o acuerdo del público a partir de rostros.

## 5.5 Fuentes técnicas para el siguiente adaptador

Los repositorios oficiales de DAT para [iOS](https://github.com/facebook/meta-wearables-dat-ios/) y [Android](https://github.com/facebook/meta-wearables-dat-android/) son puntos de partida para prototipos y ejemplos. Se consultaron el 27 de octubre de 2026; no se incorporó el SDK al proyecto.

Antes de habilitarlo se documentarán dispositivo/firmware, sistema móvil, versión del SDK, permisos, formato de señales, interrupciones, latencia y ruta de salida. Una simulación sirve para desarrollar, pero no sustituye la prueba del hardware.

## 5.6 Aplicaciones profesionales aplazadas

| Dominio futuro | Uso previsto del motor | Condición para retomarlo |
|---|---|---|
| DaVinci Resolve | Skills de edición y color con contexto real | Decisión de producto y prueba de edición/API |
| Blender | Skills de modelado y verificadores geométricos | Conector ensayado y unidades normalizadas |
| AutoCAD | Skills de dibujo, capas y cotas | Licencia, plataforma y API comprobadas |

Los ejemplos existentes de Blender y DaVinci son material contractual de arquitectura. No representan conectores instalados ni prioridades del primer hito.

## 5.7 Homologación de una fuente

Se habilita una capacidad solo después de comprobar identidad del dispositivo, permisos, procedencia, vigencia, interrupción, errores y una práctica completa. La ficha del adaptador registra exactamente lo ensayado y su fecha. Cambios de dispositivo, navegador, firmware o SDK pueden requerir una nueva prueba.

