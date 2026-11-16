# Distribución de Windows

El instalador se genera desde Windows x64 con Python 3.12 y las dependencias de `requirements-desktop.txt`. Requiere además `packaging`, Inno Setup 6 y el bootstrapper oficial de WebView2 en `.local/build-tools/MicrosoftEdgeWebview2Setup.exe`. Estas herramientas de construcción no se publican en Git.

Prepara las dependencias JavaScript con `npm --prefix motion-studio ci` y compílalas con `npm --prefix motion-studio run build`. Conserva sus licencias.

```powershell
.\.venv\Scripts\python.exe -m pip install packaging
.\.venv\Scripts\python.exe -X utf8 -B -m tools.build_windows --iscc 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify windows-release
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify windows-installer
```

`tools.build_windows` copia una lista permitida de fuentes y dependencias, genera el lanzador `Brivany.exe`, el ZIP de actualización y el instalador en `Exports/Brivany-Windows-VERSION/`. Añade `.env.example` y la licencia; no copia `.env`, perfiles ni credenciales. La clave de firma de actualizaciones permanece protegida con DPAPI en `.local/distribution/`.

La prueba del instalador instala, abre y desinstala una copia con registro y perfil aislados; conserva las preferencias sintéticas y no reemplaza la instalación habitual. La auditoría local verifica el manifiesto firmado y busca rutas privadas y valores de secretos configurados. No prueba los servicios de IA ni sustituye una auditoría de seguridad independiente.

Publica el **instalador** y sus SHA-256 en GitHub Releases. El ZIP es para el actualizador: no es una edición portable. Publicar una Release no actualiza por sí solo el canal HTTPS `windows/stable.json`; ese despliegue es independiente. La firma Ed25519 de actualizaciones no es una firma Authenticode del ejecutable.

No se incluye el backend Cognira ni Node.js/FFmpeg en la vista previa 0.2.0. Mantén `Exports/`, `.local/`, `.venv/`, caches y originales fuera del repositorio.
