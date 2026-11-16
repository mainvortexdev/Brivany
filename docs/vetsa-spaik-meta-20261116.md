# Spaik Image con Meta en Vetsa Intelligence

16 de noviembre de 2026. A petición del usuario se copió la credencial existente
de Brivany al secreto cifrado `META_API_KEY` del Worker `vetsa-intelligence-api`.
La clave no se incluyó en código, respuestas, argumentos de proceso o evidencias.

Spaik Image genera y edita con `muse-image-1.0`, y analiza con `muse-spark-1.3`.
Se conserva el contrato `/v1/generate`, `model: "spaik-image"`, `contents` y
`options`. Sin imagen se genera; con `image` o `imageBase64` se edita; el modo
explícito `options.mode: "analyze"` analiza sin generar. Las referencias van
en línea y no se suben a almacenamiento público. Las respuestas indican Meta.
Los errores no incluyen contenido del proveedor ni claves, no se siguen
redirecciones y no hay reintentos automáticos de generación. Un `requestId`
explícito conserva el resultado en el D1/R2 existente y evita repetir una
petición en curso. Las tareas KIE anteriores conservan su ruta original.

Se actualizaron en Vetsa-Intelligence el adaptador `meta-image.js`, la ruta de
Spaik Image, las pruebas y `PROVIDERS.md`. Para publicar se partió del código
real desplegado, conservando los otros módulos binarios y las 34 vinculaciones
originales. No se publicaron otros cambios pendientes del repositorio.
Publicación: `0df590f65e22472ba7877a9b4601cfbe`. La lectura administrativa
posterior confirma los nueve módulos y la presencia del secreto. El endpoint
público de salud respondió HTTP 200 a Node: imagen habilitada y proveedor Meta.
Un sondeo anterior con urllib de Python recibió 403; el servicio no se modificó
para eludir políticas de acceso. La ruta pública autenticada no se ejercitó.

## Pruebas reales autorizadas

Tres solicitudes directas con el mismo adaptador publicado, no simuladas:

| Función | Modelo | Resultado | Tiempo observado |
| --- | --- | --- | --- |
| Crear | muse-image-1.0 | Círculo rojo sobre blanco, PNG válido | 9,769 s |
| Editar | muse-image-1.0 | Círculo cambiado a azul, PNG válido | 11,650 s |
| Analizar | muse-spark-1.3 | «Un círculo azul sobre un fondo blanco.» | 3,504 s |

Se inspeccionaron visualmente ambos resultados. Estas muestras verifican el
ejemplo simple; no acreditan fidelidad geométrica exacta ni todos los casos de
edición. Son tiempos individuales, no una garantía de latencia.
Consumo: dos generaciones/ediciones de imagen y un análisis; importe facturado
no consultado, GPU sin medir. No se enviaron archivos personales. Resultados en
`tmp/vetsa-meta/real-tests/`, informe en `report.json`.

También pasan pruebas simuladas de contratos, límites, fallo sin reintento,
respuestas incompletas, conservación del modelo público, tareas KIE pendientes
y reutilización de imágenes guardadas. El banco inicial de Miniflare no llegó
a iniciar un Worker ni llamó al proveedor por incompatibilidad de su interfaz.
Se sustituyó por la prueba real del adaptador. Los primeros intentos de subida
fueron rechazados por empaquetado binario; después se publicaron los bytes
originales de cada módulo y se verificaron contra la versión desplegada.

Referencias técnicas: [Meta Image](https://dev.meta.ai/docs/image-generation),
[secretos de Workers](https://developers.cloudflare.com/workers/configuration/secrets/).
