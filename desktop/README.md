# Brivany Desktop

Contenedor de escritorio con pywebview 6.2.1. Su servidor HTTP se inicia únicamente
en `127.0.0.1` con puerto efímero. No ejecuta inferencias ni activa cámara o
micrófono al abrirse. Carga configuración local y prepara puentes loopback de
voz/traducción; se conectan a proveedores sólo al activar sus controles.

Web y Desktop comparten `start_application_bridges`: Muse para la escucha de
Melodi y el relay Muse Voice → Meta Spark → Cartesia para `/dubbing`. Los motores
de traducción anteriores ya no se arrancan. El enlace del visor y el de Melodi
abren esa página integrada; admite YouTube según soporte de captura del host y
videos locales sin compartir pantalla. La captura real de YouTube en WebView2 y
la salida física deben comprobarse por separado; las pruebas del lanzador son
locales, sin inferencia.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
.\.venv\Scripts\python.exe -X utf8 -B -m desktop.launcher --check
.\.venv\Scripts\python.exe -X utf8 -B -m desktop.launcher
```

Las dependencias se instalaron en `.venv` desde PyPI. Windows tiene .NET Framework
4.8 y Edge WebView2 156.0.4314.50: se comprobó la carga de los ensamblados sin crear
una ventana. `--check` repite esta consulta en un proceso aislado e informa sólo
versiones y disponibilidad. Después se comprobó arranque/render de una ventana
Windows mediante indicadores internos: 22 objetos y 124 dibujos. Selectores,
edición y reapertura nativos siguen pendientes.
Windows requiere Edge WebView2; este lanzador rechaza el fallback MSHTML.
El empaquetado, firma,
instalador y validación física de macOS siguen pendientes. La licencia de
pywebview es BSD-3-Clause; su distribución tiene sus propios avisos.

El visor puede consultar `window.pywebview.api.status()` después del evento
`pywebviewready`. El puente expone solamente:

- `pick_project_folder()`: selector nativo de una carpeta portátil existente.
- `save_current_project(scene_id)`: selector de carpeta padre, crea una carpeta
  nueva de nombre generado con el proyecto completo y la abre. Incluye
  referencias derivadas; excluye fotos originales, videos y credenciales.
- `save_open_project(expected_revision, objects, title)`: guarda una nueva
  revisión del proyecto ya elegido, aplicando la validación existente.
- `get_floorplan(expected_revision, parameters=null)`: proyecta GLB verificados
  de la carpeta abierta, sin leer rutas elegidas por JavaScript. Si no se pasan
  parámetros, usa las referencias, anotaciones, zonas inciertas y altura de corte
  guardadas en el proyecto; una configuración explícita es sólo previsualización.
- `save_floorplan(expected_revision, parameters)`: conserva esa configuración
  en una nueva revisión portátil. No cambia las transformaciones ni la revisión
  geométrica de la escena. Una revisión concurrente se rechaza con estado 409.
- `export_open_project()`: selector nativo de un ZIP nuevo fuera del proyecto.

No acepta rutas de archivos ni órdenes del sistema por JavaScript. Revisa el
origen y la ruta del visor antes y después de cada selector. Un proyecto abierto
se sirve directamente desde su carpeta verificada: no necesita importarse en
`.local`. Los GLB usan enlaces opacos de la sesión, que se invalidan al abrir
otro proyecto. El servidor revalida hashes antes de servirlos.

El campo opcional `plan_config` de cada revisión conserva calibración declarada,
anotaciones y zonas inciertas al reabrir, editar o exportar ZIP. Los proyectos
anteriores sin ese campo usan valores predeterminados y siguen admitidos. Crear
una carpeta desde la biblioteca incorpora la configuración del plano en la misma
instantánea SQLite de la escena. Una medida declarada y sus residuales no
certifican escala métrica, cobertura ni precisión arquitectónica.

El valor `native_application:false` dentro del manifiesto portátil describe el
formato de datos original y no se reescribe al abrirlo en este contenedor.
Las pruebas sin GUI verifican puente, selección, almacenamiento y HTTP; no
demuestran ejecución de una ventana nativa ni compatibilidad física entre OS.

`--startup-report ruta-nueva.json` habilita instrumentación de carga de la propia
aplicación, sólo lectura de indicadores DOM sin clics, contenido privado ni APIs
de proveedores. No es una inspección visual humana ni prueba interacción nativa.
[Evidencia y límites actuales](../docs/35-voz-sous-desktop-y-modal.md).

Fuentes oficiales consultadas:
[uso y puente](https://pywebview.flowrl.com/guide/usage.html),
[API](https://pywebview.flowrl.com/api/),
[release 6.2.1](https://pypi.org/project/pywebview/6.2.1/),
[código de FileDialog y settings](https://github.com/r0x0r/pywebview/blob/6.2.1/webview/__init__.py).
