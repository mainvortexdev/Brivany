# Melodi · Bang Motion y primeras promociones

1 de noviembre de 2026. Se incorpora
[Bang Motion](https://github.com/bangtutorial/bang-motion), habilidad MIT de
Bang Tutorial, versión 1.19.0, revisión
`c1aa65e921c970d858705fcb4a53a8294d1a4131`.
La copia vive en `integrations/bang-motion`, sin modificar su código. El lock
registra origen, licencia y hashes de los documentos utilizados. Se conservan
sus créditos y los de las dependencias en los proyectos y exportaciones.

## Qué puede hacer ahora

El router del chat y la misma ruta que recibe texto del Live reconocen creación
de promos, animaciones y motion graphics. Despachan `motion`, con cola propia,
independiente del ratón y de terminal/ordenador. La conversación puede continuar;
el aviso de finalización permite revisar el MP4 en el chat. Hay controles para
abrir video, proyecto HTML y carpeta. No necesita Cognira Edits abierto.

El planificador produce textos y selecciona una composición, nunca comandos,
scripts, HTML ni JavaScript ejecutable. El contrato limita caracteres,
duración, cadencia y estilos. La petición original conserva su familia visual,
duración y fps. Actualmente hay **dos familias** de composición: WorkSpace/UI
y construcción espacial conceptual. No equivale a generar cualquier escena de
After Effects o una película arbitraria. Ambas admiten variación de textos y
18/24/30 segundos a 30/60 fps; la primera prueba se hizo a 24 s y 30 fps.

`services/motion` valida el plan y crea un proyecto nuevo por UUID. El motor en
`motion-studio` usa GSAP/Three.js fijados por package-lock y un tiempo de escena
único. Se aplica el enfoque de Bang Motion: mundo continuo, un protagonista,
transiciones motivadas y texto breve, con la identidad real de Brivany. Se tomó
ritmo de los ejemplos Coucou/TwoCode, sin reutilizar sus videos, música o logos.
Se conserva Georgia con Segoe UI y el SVG original del wordmark con punto azul.

Los proyectos son compatibles con la línea temporal HyperFrames y contienen
una exportación HTML autónoma en `exports/Brivany-animation.html`, que reproduce
en bucle y permite pausa con Espacio/reinicio con R. El generador y el render
funcionan sin red. Se bloquean peticiones del navegador fuera del proyecto y
los procesos hijos no heredan las claves de proveedores. El modelo sigue
necesitando el proveedor Meta ya configurado para decidir el plan.

El render local transmite fotogramas a FFmpeg, evitando miles de PNG intermedios.
Mantiene sólo muestras de revisión. Windows Job Objects conserva el árbol de
procesos para cancelarlo; la cancelación de un encargo no concede permisos ni
interactúa con UAC. Cada MP4 se verifica con FFprobe: 1920×1080, cadencia,
duración y existencia. No se sobrescriben medios previos del usuario.

## Prueba real y tiempos

`tools.check_motion_real --run` probó dos peticiones por la ruta real
`chat_turn` → ticket → agente → render. Usó cuatro planificaciones reales
(dos de intención y dos creativas); importe desconocido. El intento anterior
falló antes de enviar la petición por no cargar configuración local; se corrigió
el helper usando el mismo cargador del escritorio. No se guardaron claves ni
conversaciones privadas. No se activó micrófono, TTS o control GUI.

| Video | Lenguaje visual | Plan creativo | Render local inicial |
|---|---|---:|---:|
| A tu ritmo | WorkSpace, conversación, encargo y resultado animado | 2,125 s | 67,532 s |
| Hazlo espacio | Plano, paredes, mobiliario y aproximación 3D | 1,656 s | 70,453 s |

Cada salida tiene 720 fotogramas. El ensayo completo de ambos, incluido router,
exportación y verificación, duró 151,188 s. Estos tiempos son del equipo Windows
actual; no incluyen instalar dependencias, desarrollar la integración ni revisar
o corregir arte. No son garantía universal de latencia.

Se reutilizó el plan del primer video para corregir su petición de ejemplo y
quitar el nombre del motor del cierre, sin inferencia nueva. La revisión del
MP4 reveló después una superposición: la opacidad de un hijo sustituía la del
grupo. Se corrigió multiplicándolas y se añadió una comprobación de píxel que
exige que la interfaz anterior desaparezca al cerrar. Se conserva la revisión
anterior y se exporta otra carpeta nueva; tampoco requirió inferencia nueva.

Las piezas definitivas y HTML están en `Exports/Brivany-entrega/`. Son silenciosas,
sin locución: el catálogo musical de HeyGen no tiene una sesión vinculada. No
se reutilizó la música de referencias ni se pidió al usuario autenticar para
poder continuar con el encargo principal. La advertencia `film_silent` se mantiene
expresamente. No se ha publicado ni enviado ningún video a terceros.

## Verificación

- `motion`: siete pruebas locales de contrato, fuente/licencia, cancelación,
  escape de texto, prohibición de sobrescritura y coordinación de chat/Live con
  render/planificador sustituidos. La conversación simulada continúa mientras
  el agente está ocupado y la cola del ratón queda libre.
- `motion-ui`: servidor/página y MP4 reales; productor, planificador y puente
  sustituidos. Se verifican metadatos, avance de reproducción, abrir video,
  proyecto y carpeta, y anchuras 1120/768/390/320 sin desbordamiento horizontal.
- Regresión: `computer` 24 y `computer-images-agents` 15.
- HyperFrames 0.8.229: comprobación de ambas familias sin errores de lint,
  runtime o layout. Las bibliotecas quedaron en un vendor `.min.js` separado
  del código propio después del primer fallo del analizador, que atribuía sus
  relojes/UUID internos al contenido. El HTML autónomo quedó fuera de las
  composiciones para evitar duplicar la raíz.
- El render compara fotogramas tras buscar tiempos fuera de orden. Ese chequeo
  acredita repetición de píxeles en la misma sesión, no calidad artística.
- Se inspeccionaron muestras de los proyectos y fotogramas decodificados de los
  MP4. La superposición se detectó aquí; un check técnico aprobado no certifica
  los píxeles dentro de un canvas. Los textos en canvas se revisaron visualmente;
  el auditor DOM no puede certificar su contraste o legibilidad.

Informes: `tmp/motion-real/`, `tmp/motion-ui/`, `tmp/motion-design/latest.json`
y `docs/verification-history/motion-*`. Los resultados iniciales, revisiones y fallos
quedan conservados; el informe `delivery.json` identifica la entrega vigente.
La última revisión eliminó además las mejillas que sobrevivían al fundido del
personaje; la comprobación del cierre ahora examina tanto el área del panel
como la del personaje. Se conservan los informes anteriores, sin reescribirlos.

Límites: hardware de voz simultáneo no probado en esta entrega; sólo su ruta de
coordinación de software. macOS/Linux no ejecutados. Escenas 3D conceptuales,
sin fidelidad geométrica o realismo físico certificado. Dos familias iniciales,
sin importación arbitraria de personajes/footage ni editor visual completo.
La red total de instalación/investigación no se midió; la inferencia real tiene
importe desconocido. La creación/revisión local no añade inferencia por frame.
