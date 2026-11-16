# Blobatar para los agentes de Melodi

8 de noviembre de 2026. Instalado **Blobatar 2.7.0**, con licencia MIT,
desde el registro npm y fijado en el paquete y su lockfile.
[Proyecto original](https://github.com/Alain00/blobatar),
[versión del registro](https://registry.npmjs.org/blobatar/2.7.0).
La licencia se conserva en
[agent-avatars.LICENSE.txt](../desktop/experience/agent-avatars.LICENSE.txt).

## Integración

- Cada agente obtiene un SVG por su tipo e identidad estable `agent_key`;
  se usa `id` cuando no existe esa clave. Renombrar la tarea o reintentarla
  conserva la cara cuando mantiene la identidad del agente.
- Cambian la silueta, el color y los tiempos de movimiento. Hay variantes
  por función y diferencias entre trabajadores paralelos de una misma función.
- El estado selecciona expresiones de trabajo, resultado, error, espera o
  descanso. Los estados activos animan; los demás también pueden animar al
  pasar el puntero o recibir foco de teclado.
- Los avatares aparecen en la barra de agentes, el detalle del seleccionado
  y sus avisos de resultado. Se conservan distribución, revisión y controles.
- La figura SVG se reutiliza entre actualizaciones; no se reconstruye cada
  vez que llega el estado de las tareas.
- Se pausan fuera de vista, con el documento oculto y al desactivar movimiento.
  Se respeta `prefers-reduced-motion`; ahorro reduce las capas de movimiento.
  Al retirar un agente se eliminan observación y escuchas del avatar.

La generación y las animaciones son locales. No se suben identificadores,
imágenes o encargos a Blobatar. El adaptador no añade un bucle JavaScript por
fotograma ni consultas a proveedores. Su bundle no contiene React, Vue o Glisse.

## Archivos y compilación

[Fuente del adaptador](../desktop/experience/ui/agent-avatars.js),
[compilador](../desktop/experience/ui/build-avatars.mjs),
[estilos de integración](../desktop/experience/agent-avatars.css) y
[manifiesto de distribución](../desktop/experience/agent-avatars.manifest.json).

La interfaz de adaptación `blobatar/internal` está fijada a 2.7.0. Cambiar la
versión requiere revisar su contrato; la compilación rechaza otra versión.
Se añadió esbuild 0.28.2 como dependencia de desarrollo local. El compilador
del visor existente usa ahora esa dependencia y su fuente se comprobó en
memoria sin regenerar el visor de resultados.

Comando utilizado para generar los archivos del avatar:

```text
npm run build:avatars --prefix desktop/experience/ui
```

Distribución comprobada: **14.972 bytes de JavaScript**, **8.029 bytes del CSS
de Blobatar** y **1.467 bytes del adaptador CSS**; total **24.468 bytes** sin
comprimir. El manifiesto guarda versión, licencia, integridad npm, tamaños y
hashes de los archivos. Eso acredita procedencia y consistencia; la revisión
visual y las pruebas de interfaz acreditan el comportamiento descrito abajo.
No se midió CPU, memoria o GPU de una sesión real.

## Corrección visual y CSP

La inspección visual encontró ojos desplazados en el panel. El SVG de Blobatar
incluía atributos `style` que la política `style-src 'self'` rechazaba, dejando
sin aplicar el origen de transformación de los ojos. El adaptador los separa
del marcado y aplica las tres propiedades admitidas mediante CSSOM. No se
modificó la política de seguridad de la aplicación.

También se aislaron tamaño, relleno y trazo del SVG para que las reglas de los
iconos de la barra no alteren las caras. Se comprobó la posición de los ojos
dentro de su figura con CSP estricta, además de revisar las capturas.

## Verificación

| Comprobación | Resultado y evidencia |
| --- | --- |
| Identidad, reintentos, diferencias, semillas sin HTML, versión, licencia y tamaño | 6 pruebas pasaron. [Informe](../tmp/verification/agent-avatars-20261108T064555-ea564e8e.json). |
| CSS animado, aviso real, CSP, contención de ojos, visibilidad, movimiento reducido y limpieza | Pasó en Edge con DOM y trabajos propios. [Informe](../tmp/verification/agent-avatars-ui-20261108T064555-0645606a.json). |
| WorkSpace con seis agentes y grupos de uno, tres y cinco | Pasó a 375, 640, 800, 1024 y 1280 px, incluyendo selección, cancelación, resultado, reintento y retirada. [Informe](../tmp/verification/workspace-agents-ui-20261108T064555-c9090a20.json). |

[Vista de la barra y detalle](../tmp/workspace-agents/team-detail.png),
[galería de caras](../tmp/agent-avatars-ui/gallery.png) y
[expresiones y aviso](../tmp/agent-avatars-ui/expressions.png).

Las pruebas usaron trabajos simulados y no ejecutaron agentes con IA real.
No consumieron APIs de IA o voz. La instalación sí descargó paquetes públicos
de npm, con scripts de instalación deshabilitados. Las pruebas de Edge no
hicieron solicitudes externas. La GPU de las ventanas queda sin medir.

Los archivos están integrados para el siguiente arranque de Brivany. El
comportamiento con trabajos reales y el consumo físico pueden revisarse en
una sesión posterior; no se atribuyen a estos ensayos resultados de ese alcance.
