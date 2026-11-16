# Brivany · Melodi

Una aplicación de escritorio para conversar con Melodi, trabajar con agentes y usar herramientas de voz, imágenes, video y traducción.

[Web](https://brivany.vetsa.es/) · [Demostración](https://youtu.be/iVE8Vx5Wseg) · [Descargar para Windows](https://github.com/mainvortexdev/Brivany/releases/tag/v0.2.0) · [Contacto: daniel@vetsa.es](mailto:daniel@vetsa.es)

**Vista previa 0.2.0.** Algunas integraciones necesitan cuentas, permisos y servicios adicionales. La descarga no incluye claves de API ni acceso de pago a los proveedores.

## Evaluación privada del equipo de Jon

La edición **Brivany Jon Demo 0.2.1** se facilita mediante un enlace privado con
caducidad. Incluye una cuenta de demostración y acceso temporal a Meta, Cartesia
y Deepgram a través del servidor de Brivany. **No contiene sus claves API.** El
presupuesto compartido de la evaluación es de **5 USD**, con reservas
conservadoras antes de cada petición; no es un saldo independiente por equipo.
El acceso se revoca al terminar la evaluación. El instalador privado incluye el
backend verificado del ordenador, Node y FFmpeg; la descarga pública 0.2.0 sigue
siendo la edición para configurar proveedores propios.

Para la evaluación, sigue la [guía de prueba](docs/demo-jon-20261116.md):

1. Instala la edición privada y abre el chat de Melodi. La cuenta demo se activa
   por Internet; puedes consultar su saldo en **Ajustes → Cuenta**.
2. Prioriza **Traducción auditiva** en WorkSpace. Para videos de YouTube/Chromium,
   instala la [extensión](browser-extension/README.md). La captura directa del
   audio general de Windows requiere una ruta separada de salida, actualmente
   FxSound; no viene instalado con Brivany.
3. Para controlar tu PC desde WhatsApp, inicia sesión con **tu propia Cuenta
   Vetsa**, vincula tu número en **Ajustes → Conexiones** enviando el código al
   número de Melodi y activa el control de **este ordenador**. Déjalo encendido,
   conectado y con Brivany en segundo plano. Las aprobaciones se resuelven desde
   tu WhatsApp; desactivar el vínculo detiene el acceso.
4. Para llamadas, introduce **tu API key de Telnyx y tu número emisor activo o
   verificado** en el panel de la demo. Brivany prepara la conexión de voz; no
   compra números. Telnyx factura las llamadas en tu cuenta. El servicio puede
   programarlas desde la nube con el PC apagado. No se ofrecen llamadas por
   WhatsApp; ese chat sirve para pedir llamadas telefónicas.

Las conexiones oficiales de Calendar, Drive y Gmail conservan el OAuth de
Brivany y la autorización separada de cada usuario. Su revisión pública de
Google sigue pendiente. No compartas tus tokens, el instalador privado ni su
invitación en repositorios públicos.

## Probar Melodi en Windows

1. Descarga **Brivany-Setup-0.2.0-x64.exe** desde [Releases](https://github.com/mainvortexdev/Brivany/releases/tag/v0.2.0). Instálalo y abre **Brivany** desde el menú Inicio. El instalador incluye Python; no necesitas instalarlo por separado.
2. Necesitas Windows 10/11 de 64 bits, .NET Framework 4.8 y Microsoft Edge WebView2. El instalador comprueba .NET y prepara WebView2 si falta (requiere Internet). El ejecutable aún no tiene firma Authenticode de editor.
3. Cierra Brivany completamente desde su icono de la bandeja antes de configurar las claves. El botón **×** deja la aplicación en segundo plano.
4. En PowerShell, crea o abre su configuración personal:

```powershell
$brivanyData = Join-Path $env:LOCALAPPDATA 'Brivany\User Data'
New-Item -ItemType Directory -Force $brivanyData | Out-Null
notepad (Join-Path $brivanyData '.env')
```

Guarda este contenido con **tus propias claves** (sin los textos de ejemplo):

```dotenv
BRIVANY_META_API_KEY=TU_CLAVE_META
BRIVANY_META_MODEL=muse-spark-1.3
BRIVANY_CARTESIA_API_KEY=TU_CLAVE_CARTESIA
```

5. Abre Brivany de nuevo, entra al chat de **Melodi** y escribe: **«Preséntate y dime en qué puedes ayudarme»**. Para probar la voz, conecta un micrófono, habilita su permiso y pulsa el botón de voz. No necesitas vincular Google, Spotify ni WhatsApp para conversar por texto.

Tus ajustes y cuentas se guardan en `%LOCALAPPDATA%\Brivany\User Data`, separados del programa. El registro de arranque está en `.local\logs\desktop.log` dentro de esa carpeta. Revisa claves, cuota y permisos del proveedor si falla una función. Para una prueba guiada: **[daniel@vetsa.es](mailto:daniel@vetsa.es)**.

## Qué claves necesitas

| Uso | Configuración |
| --- | --- |
| **Chat de Melodi** | `BRIVANY_META_API_KEY` y `BRIVANY_META_MODEL=muse-spark-1.3`. |
| **Conversación con voz** | Lo anterior más `BRIVANY_CARTESIA_API_KEY`. El reconocimiento de Muse usa la clave de Meta; puedes separar su acceso con `BRIVANY_MUSE_API_KEY`. |
| **Generar y editar imágenes** | Clave Meta con acceso a Muse Image. Las funciones habilitadas dependen de tu cuenta. |
| **Crear videos con voz** | Meta y Cartesia, además de Node.js 22+ y FFmpeg/ffprobe en el `PATH`. |
| **Google Calendar, Drive y Gmail en el servicio oficial** | Vincula tu Cuenta Vetsa y tu WhatsApp desde Ajustes → Conexiones y autoriza tu propia cuenta de Google. Se conserva el cliente OAuth de Brivany y sus dominios oficiales; no necesitas crear un proyecto Google propio para usar ese servicio. La revisión pública de Google sigue pendiente y pueden aparecer advertencias o restricciones de acceso. |
| **WhatsApp y reuniones** | Cuenta Vetsa vinculada y backend desplegado. Un despliegue propio necesita WhatsApp Cloud API, Cloudflare y, para Meet/Zoom, Recall. Las claves del servidor no van en el cliente. |
| **Llamadas telefónicas** | Telnyx, número autorizado y servicio de llamadas configurado. La voz se genera con Cartesia. No se ofrecen llamadas de WhatsApp. |

Crea tus credenciales en [Meta Model API](https://dev.meta.ai/docs/overview) y [Cartesia](https://play.cartesia.ai/). Comprueba que tu cuenta permite los modelos y las voces seleccionados; cada proveedor aplica su propia facturación y cuota. La voz de Melodi conserva su configuración de Cartesia. La plantilla completa está en [`.env.example`](.env.example); no hace falta rellenarla entera para empezar.

Para alojar **tu propia instancia** de los conectores Google, configura `BRIVANY_GOOGLE_CLIENT_ID` y `BRIVANY_GOOGLE_CLIENT_SECRET`, las APIs y los callbacks de ese despliegue. El servicio oficial mantiene las credenciales de su cliente web en el servidor y la autorización de cada usuario por separado. [Guía de Google y WhatsApp](docs/melodi-whatsapp-migracion-20261113.md).

## Qué puedes probar y qué requiere preparación

- **Chat, adjuntos y agentes:** conversación y encargos con los proveedores configurados; miniaturas para archivos y progreso para creaciones.
- **Imágenes, videos y human-skills:** requieren modelos habilitados; los procesos multimedia necesitan las herramientas indicadas arriba.
- **Traducción y WorkSpace:** la extensión conecta videos compatibles con el escritorio. Abre `brave://extensions` o `chrome://extensions`, activa Modo de desarrollador y carga la carpeta [`browser-extension/`](browser-extension). [Guía de la extensión](browser-extension/README.md).
- **Control del ordenador:** el backend Cognira autorizado se prepara por separado; no se redistribuye dentro del instalador. [Preparación y límites](docs/control-ordenador-melodi.md).
- **Spotify:** se vincula desde Ajustes → Conexiones; la aplicación está en Development Mode y solo admite las cuentas autorizadas por Spotify. No equivale a acceso público para cualquier usuario.
- **WhatsApp, reuniones y llamadas:** necesitan servicios remotos y vinculación; instalar el ejecutable por sí solo no los activa. [WhatsApp](docs/melodi-whatsapp-migracion-20261113.md), [reuniones](docs/recall-reuniones-20261116.md), [llamadas](workers/calls/README.md).
- **Funciones espaciales:** consulta el [plan de plataforma](PLAN_PLATAFORMA.md); la reconstrucción avanzada tiene requisitos adicionales.

## Ejecutar desde el código

Instala Git, **Python 3.12** y, para herramientas de desarrollo y video, **Node.js 22+**. En Windows también necesitas .NET 4.8 y WebView2.

```powershell
git clone https://github.com/mainvortexdev/Brivany.git
cd Brivany
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
Copy-Item .env.example .env
notepad .env
.\.venv\Scripts\python.exe -X utf8 -B -m desktop.launcher --check
.\.venv\Scripts\python.exe -X utf8 -B -m desktop.experience.launcher
```

Rellena las claves antes de la primera ejecución. Para el servidor web local, usa `./start-h1.ps1` y abre [127.0.0.1:8765](http://127.0.0.1:8765/). Detén ese servidor con `Ctrl+C`.

Para preparar la generación de video desde el código:

```powershell
npm --prefix motion-studio ci
npm --prefix motion-studio run build
```

Instala FFmpeg y ffprobe en el `PATH`. El instalador de esta versión tampoco incluye Node.js ni FFmpeg. La extensión y los servicios Cloudflare tienen sus propias instrucciones y dependencias. Para generar un instalador propio, consulta [la guía de distribución](docs/distribucion-windows.md).

## Desarrollo y documentación

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify contracts
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify chat-history
```

`tools.verify` registra el resultado local y las evidencias en `tmp/verification/`. Las pruebas con proveedores reales son independientes. Consulta [VALIDACION.md](VALIDACION.md), la [bitácora](docs/17-bitacora.md), el [catálogo de funciones](CATALOGO_FUNCIONES.md) y el [plan vigente](PLAN_PLATAFORMA.md).

`desktop/`: aplicación Windows · `services/` y `packages/`: servidor y proveedores · `web/`: interfaces · `workers/`: servicios remotos · `official-site/`: web de Brivany · `tests/` y `tools/`: verificación y utilidades.

## Licencia

El código original de Brivany se publica bajo la [licencia MIT](LICENSE). Las dependencias, tipografías y recursos de terceros conservan sus licencias y atribuciones. No publiques `.env`, tokens, perfiles personales ni grabaciones al compartir tu instalación.
