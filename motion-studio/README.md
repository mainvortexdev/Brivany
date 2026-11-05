# Motor de animación de Melodi

Integración Brivany: `services/motion` y agente `motion` del chat/Live.
Bang Motion: `../integrations/bang-motion`, versión/commit fijados en el lock.

Preparación del motor (una vez):

```powershell
npm.cmd ci --ignore-scripts
node build.mjs
```

La app comprueba Node, FFmpeg/FFprobe, Playwright Core, el motor compilado y la
integridad de la habilidad antes de crear un trabajo. Usa Edge headless en
Windows; la ejecución en macOS/Linux aún no se ha comprobado. No descarga un
navegador ni instala paquetes durante un render. El flujo actual es silencioso.

Ejemplos para Melodi: «Crea un video promocional de Brivany de 24 segundos» o
«Crea una animación espacial que muestre cómo nace una habitación conceptual».
Hay dos familias de escena y copia limitada por el contrato. El modelo no genera
ni ejecuta código de animación arbitrario.

Cada trabajo conserva `motion.json`, `index.html`, assets locales, muestras PNG,
MP4, avisos de terceros y un HTML autónomo en `exports/`. El HTML puede abrirse
sin servidor y se pausa con Espacio. Los proyectos pueden verse en HyperFrames.
La exportación MP4 cotidiana usa el renderer local por fotogramas `render.mjs`.

Pruebas desde la raíz de Brivany:

```powershell
.venv/Scripts/python.exe -X utf8 -B -m tools.verify motion
.venv/Scripts/python.exe -X utf8 -B -m tools.verify motion-ui
```

La suite UI requiere `BRIVANY_PLAYWRIGHT_PATH` si Playwright no está resoluble
en Node. Reutiliza el MP4 real ya generado; el planificador y el productor son
sustituidos. `tools.check_motion_real --run` es una comprobación diferente y
usa el proveedor real: no debe ejecutarse como test rutinario.

Ver `../docs/melodi-bang-motion.md` y `REVIEW.md` para procedencia, medidas,
revisiones y límites de la primera entrega.
