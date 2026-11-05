# Human-skills: del video a la práctica

27 de octubre de 2026. Primer flujo funcional en `/human-skills`.

Brivany busca ampliar lo que una persona puede aprender, recordar y aplicar. La unidad concreta es una habilidad delimitada: observar una técnica, practicarla con guía, reducir el apoyo y trasladarla a otra situación. La aspiración de aumentar capacidades humanas se expresa en ese ciclo; no como una promesa de dominio por ver un video ni de resultados sobrehumanos ya demostrados.

## Experiencia implementada

1. Seleccionar un MP4 y, opcionalmente, indicar qué se quiere aprender.
2. Revisar la vista previa y autorizar el envío de ese video a Meta.
3. Melodi analiza las imágenes y el audio disponible en una única solicitud.
4. Brivany valida la propuesta y guarda un borrador con entre uno y seis pasos, referencias al video y ejercicios.
5. Practicar con guía, con pistas o por cuenta propia; registrar manualmente los criterios revisados y realizar una tarea de transferencia.
6. Reabrir, exportar como JSON o eliminar la habilidad desde la biblioteca local.

Cada paso distingue la observación del video de los ejercicios propuestos por el modelo. Sus tiempos son aproximados, se comprueba que estén dentro de la duración, y se puede abrir el tramo en el original. El navegador comprueba el hash SHA-256 antes de reproducir una referencia: otro archivo no se hace pasar por la fuente.

El borrador no se publica automáticamente y registrar un intento no certifica competencia. Una fuente sin técnica suficiente genera un estado explícito de evidencia insuficiente. El contenido del video, incluso sus instrucciones habladas o escritas, se trata como material de análisis y no modifica permisos, identidad ni herramientas.

## Modelo y presupuesto

Se usa `muse-spark-1.2` para video y audio integrado mediante `POST /v1/responses`, con `input_video` y una URL de datos MP4. La documentación de Meta advierte limitaciones de audio en 1.3; esta decisión es específica del análisis de videos y no cambia la conversación live. No se añade otra llamada de transcripción, Wonder ni SAM sin una necesidad comprobada.

- Una llamada de generación por análisis; sin reintentos, reparaciones ni cambios automáticos de modelo.
- Video máximo de cinco minutos y 25 MiB; una operación activa por servidor.
- 4500 tokens de salida como techo compartido con razonamiento, esfuerzo `low`, timeout de 120 segundos.
- La misma combinación de video, objetivo, modelo y versión de instrucciones recupera el borrador existente sin otra llamada, incluso después de reiniciar.
- Dos envíos idénticos durante el procesamiento recuperan el mismo trabajo.
- Los ejercicios y el registro de progreso son locales y no llaman al modelo.
- El consumo informado por Meta se guarda con la skill y se muestra en «Sobre esta skill». No se transforma en un precio monetario estimado sin conocer la tarifa efectiva.

La configuración opcional `BRIVANY_HUMAN_SKILLS_MODEL` permite elegir el modelo de análisis; por defecto 1.2. Reutiliza la clave Meta ya guardada. La falta de acceso o cuota produce un error visible, sin consumir llamadas de sustitución. Cambiar el objetivo o eliminar el borrador puede dar lugar a un nuevo análisis solicitado expresamente.

## Datos y arquitectura

El servidor local recibe el archivo por una ruta con origen y consentimiento explícitos. `ffprobe` comprueba duración y presencia de video con protocolo local restringido y timeout. El archivo temporal se elimina al terminar esa comprobación; el contenido se mantiene en memoria durante el análisis. Brivany no conserva el MP4 en la biblioteca. La llamada usa `store:false` y no crea archivos remotos por Files API; esto no equivale a garantizar ausencia total de retención del proveedor.

Los borradores y su progreso se guardan de forma atómica en `.local/human-skills/`, excluido de Git. El hash, nombre y duración de la fuente permanecen con la skill; los medios se vuelven a seleccionar al abrir las referencias. El límite local es de 100 habilidades. Los trabajos en curso viven en memoria: cerrar la página no los cancela, pero reiniciar el servidor interrumpe su seguimiento y no los reenvía automáticamente. No es un backend multiusuario.

| Archivo | Responsabilidad |
|---|---|
| `contracts/human_skills.py` | Contrato del borrador, límites y tramos de evidencia |
| `packages/providers/human_skills.py` | Única llamada multimodal y validación de salida estructurada |
| `services/h1/human_skills.py` | Trabajos, validación de medios, deduplicación y biblioteca |
| `web/human-skills.html`, `.js`, `.css` | Creación, fuentes, práctica y progreso |

El contrato experimental `HumanSkillDraft` acompaña al contrato histórico `SkillManifest`; no atribuye revisión experta ni compatibilidad con conectores profesionales. Exportar el JSON no publica una skill. La voz conversacional todavía no recibe automáticamente estas habilidades como contexto. Las sesiones habladas basadas en una skill, la evaluación de nuevos intentos por video y la adaptación a Meta Glasses son continuaciones pendientes.

## Comprobación realizada

Se ejecutó una sola llamada real con una demostración sintética de nueve segundos y 38 743 bytes, sin audio. El modelo extrajo los tres pasos visibles —idea, ejemplo y cierre—, con tramos 0–3, 3–6 y 6–9 segundos. La generación tardó 8281 ms y declaró 1908 tokens de entrada y 1690 de salida: 3598 en total. La skill quedó guardada como borrador. No se realizaron comparaciones pagadas ni reintentos.

El resultado demuestra el recorrido de video visual a borrador estructurado para ese ejemplo. No prueba todavía calidad sobre narraciones, movimientos rápidos, tutoriales extensos o habilidades físicas. Los ejercicios siguen requiriendo revisión. Informe local: `tmp/human-skills-test/real-check.json`; fuente sintética: `tmp/human-skills-test/demo-sintetica-oratoria.mp4`.

Las pruebas sin llamadas externas cubren el contrato, duración, modalidad ausente, salida incompleta, errores de cuota, consentimiento, origen, deduplicación concurrente, persistencia tras reinicio, progreso manual, borrado y pantalla responsive. Para repetir solo las pruebas gratuitas:

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m unittest discover -s tests -p 'test_human_skills*.py'
node tools/check_human_skills_ui.cjs
```

El segundo comando requiere Playwright, Edge, servidor activo y el archivo sintético preparado; simula todas las rutas de creación y no llama a Meta. Sus variables de entorno coinciden con las de [VALIDACION](../VALIDACION.md).

Fuentes oficiales: [video y audio](https://dev.meta.ai/docs/video-understanding), [Responses API](https://dev.meta.ai/docs/protocols/responses), [salida estructurada](https://dev.meta.ai/docs/structured-output).
