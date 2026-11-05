# Backend local de Melodi para Windows

El 30 de octubre de 2026 se construyó y activó un paquete local del backend de
Cognira/Stacy que usa Brivany. El control y el compilador de modelos pueden usar
ese paquete sin consultar el checkout original ni requerir un Node global.
El adaptador de Brivany y su entorno Python siguen siendo parte de la aplicación;
esto no es todavía un instalador completo, firmado y distribuible.

## Contenido y elección

El paquete activo reside en `.local/computer/backend/<id>/`. Contiene exactamente
los módulos fijados en `config/computer-source.json`, el runtime y los archivos de
Three.js fijados en `config/computer-runtime.json`, y sus avisos. Se copiaron 101
archivos, 388648155 bytes. Las versiones observadas son Electron 44.8.0, su Node
24.22.0 y Three.js 0.186.1. No se descargaron dependencias durante esta preparación.
El directorio de Cognira no se modificó.

`active.json` elige el paquete para las nuevas sesiones de Brivany. Una selección
o paquete alterado deja el backend no disponible; no cambia silenciosamente al
checkout anterior. `BRIVANY_COGNIRA_SOURCE` conserva la prioridad si el desarrollador
elige expresamente otro directorio. Sin selección local se admite el checkout
hermano de desarrollo como antes.

El manifiesto y sus hashes se comparan con los locks del proyecto, además de
rechazar enlaces, junctions y archivos no declarados. La disponibilidad vuelve a
revisarlos antes de cada llamada nativa. El inicio de un proceso hace una lectura
completa; las consultas sucesivas reutilizan hashes sólo mientras sus metadatos no
cambien, enumerando también archivos añadidos. La identidad del directorio depende
del manifiesto. Esto detecta cambios locales respecto al snapshot revisado; no es
una firma del editor ni una defensa frente a quien controla y sustituye todo el
código y los locks del equipo.

El empaquetador usa una lista explícita. No copia el repositorio completo,
`.env`, perfiles, conversaciones ni grabaciones. Conserva los avisos de Electron,
Chromium y Three.js y la atribución a Vortex Developer/Cognira. El aviso del paquete
documenta que esta copia local autorizada por el usuario no concede una licencia
de redistribución pública de Cognira.

## Compilación y parada

El compilador utiliza el Electron del paquete en modo Node. El proceso recibe
sólo el plan conceptual y no hereda claves de proveedores, permisos de sesión,
`NODE_OPTIONS` ni rutas de módulos del entorno del usuario. La misma biblioteca y
los mismos contratos GLB/SceneManifest de Brivany validan y publican el resultado.

La cancelación termina el proceso del compilador que inició la tarea. El manejo
de stdin está separado de la espera de parada: en Windows una escritura grande a
una tubería de un hijo que no lee no puede dejar bloqueada esa espera. La prueba
usa un hijo Python real detenido sobre una entrada de 512000 bytes y comprueba
que su proceso termina. No escribe en procesos ajenos ni reintenta el modelo.

## Evidencia comprobada

`tmp/computer-bundle-real/report.json` conserva la comprobación real, sin inferencia:

- Arranque del ejecutor nativo desde el paquete y su propio Electron.
- Escritura exacta de una nota sintética nueva en su carpeta de prueba.
- Compilación y publicación local de una mesa procedural de tres piezas, con
  tres GLB válidos y procedencia conceptual. El test impidió buscar un Node global.
- El paquete conservó sus hashes después de ejecutarse y quedó activado.

`tools.verify computer-bundle` ejecuta fixtures pequeñas de integridad, selección,
exclusión de datos privados, fallo sin activación, entorno sin credenciales,
cancelación y timeout de procesos reales. Son 13 casos: 12 superados y uno de
creación de enlaces simbólicos omitido por los permisos de esta cuenta Windows.
No se interpreta esa omisión como prueba del enlace en este equipo.

`tools.verify computer` conservó sus 19 casos con proveedor/entrada nativa
sustituidos, compilando contra el paquete activo. `tools.verify computer-ui`
comprobó por HTTP y visor reales la orden live sustituida, conversación durante
la generación, vista del modelo junto a la voz, parada y márgenes de 320 a 1440 px.
La geometría usa el compilador local del paquete; los proveedores y el control
nativo de ese recorrido de UI están sustituidos. No se activó un micrófono físico.

## Preparar otra copia local

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.bundle_computer_backend
.\.venv\Scripts\python.exe -X utf8 -B -m tools.check_computer_bundle_real --activate
```

La segunda herramienta verifica el ejecutor, nota y GLB antes de activar. Se debe
reiniciar Brivany para elegir el paquete nuevo. Un cambio de dependencias requiere
revisar los locks; el empaquetador no los actualiza por su cuenta.

Este artefacto es `win32-x64`. Los adaptadores nativos de macOS/Linux, el instalador
completo y la paridad extendida con Stacy permanecen pendientes. La licencia
expirada de Office tampoco queda resuelta al empaquetar. El objetivo completo sigue
activo en `OBJETIVO_CONTROL_MELODI.md`.
