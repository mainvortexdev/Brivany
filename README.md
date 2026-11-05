# Brivany

Brivany reúne a Melodi, un asistente de voz y trabajo, con traducción auditiva, coordinación de agentes, herramientas de ordenador y human-skills. Sous ayuda a organizar ingredientes y seguir recetas. La extensión de Brave conecta el audio de un video con Melodi WorkSpace. El visor espacial ofrece escenas 3D editables. Meta Glasses y la reconstrucción avanzada se describen en el [plan de plataforma](PLAN_PLATAFORMA.md).

## Arranque rápido

Necesitas **Python 3.12**. Para Desktop en Windows, instala **Edge WebView2 Runtime** y **.NET Framework 4.8**. Instala **FFmpeg y ffprobe** y añádelos al `PATH` si vas a procesar video o audio local. **Node.js 22 o superior** se usa para las pruebas JavaScript y las herramientas de desarrollo. El navegador recomendado para la extensión es **Brave o Chromium 116 o posterior**.

Clona el repositorio y abre la carpeta en PowerShell:

```powershell
git clone https://github.com/mainvortexdev/Brivany.git
cd Brivany
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-h1.txt
Copy-Item .env.example .env
.\start-h1.ps1
```

La web queda en [127.0.0.1:8765](http://127.0.0.1:8765/). Para iniciar sin PowerShell, usa el Python del entorno virtual:

```sh
python -X utf8 -B -m services.h1.server --port 8765
```

La portada, la bitácora y las funciones locales se pueden abrir con las credenciales vacías. Para cambiar el puerto en PowerShell usa `./start-h1.ps1 -Port 8766`. Detén el servidor con `Ctrl+C`.

| Ruta | Uso |
| --- | --- |
| `/app` | Melodi y conversación con voz |
| `/dubbing` | Traducción auditiva de videos compatibles |
| `/human-skills` | Crear y practicar una habilidad a partir de un video |
| `/sous` | Inventario, recetas y pasos de cocina |
| `/spaces` | Biblioteca y visor espacial |
| `/activity` | Bitácora, resultados de pruebas y evidencias |

## Configuración y APIs

Edita `.env` en la raíz. La plantilla [`.env.example`](.env.example) muestra todas las variables que carga el servidor desde ese archivo. Pon el valor a la derecha de `=` y reinicia Brivany. Las variables definidas en el entorno del proceso tienen prioridad. Mantén `.env` fuera del código compartido y de la extensión.

| Variable | Cuándo se usa |
| --- | --- |
| `BRIVANY_META_API_KEY` | Meta para Melodi, traducción, agentes, investigación e imágenes. La cuenta debe tener acceso a las funciones que se activen. |
| `BRIVANY_META_MODEL` | Identificador de Muse Spark habilitado para tu cuenta. La plantilla incluye `muse-spark-1.3` como ejemplo. |
| `BRIVANY_MUSE_API_KEY` | Muse Voice Transcribe. Si se deja vacía, el código usa `BRIVANY_META_API_KEY`. |
| `BRIVANY_CARTESIA_API_KEY` | Voz de Melodi y voz de traducción, mediante Cartesia Sonic. |
| `BRIVANY_HUMAN_SKILLS_MODEL`, `BRIVANY_SOUS_MODEL` | Ajustes opcionales de los modelos Meta para análisis de video y observación visual. |
| `BRIVANY_GOOGLE_CLIENT_ID`, `BRIVANY_GOOGLE_CLIENT_SECRET` | OAuth para Google, si se habilita el conector. |
| `BRIVANY_WHATSAPP_ACCESS_TOKEN`, `BRIVANY_META_APP_SECRET`, `BRIVANY_WHATSAPP_VERIFY_TOKEN` | WhatsApp Cloud API y webhook opcional. |
| `BRIVANY_META_SOCIAL_USER_TOKEN`, `BRIVANY_FACEBOOK_PAGE_TOKEN`, `BRIVANY_INSTAGRAM_ACCESS_TOKEN`, `BRIVANY_META_ADS_ACCESS_TOKEN` | Conectores opcionales de Meta Graph, con permisos específicos por cuenta. |

El flujo de traducción usa **Muse Voice Transcribe → Muse Spark → Cartesia Sonic**. La extensión se comunica con Desktop por loopback. OpenAI, Palabra, ElevenLabs, Gemini, Groq y Cloudflare aparecen agrupados en la plantilla para adaptadores históricos o experimentales.

El gateway móvil tiene su propia plantilla en [`workers/mobile-gateway/.dev.vars.example`](workers/mobile-gateway/.dev.vars.example). Cópiala a `.dev.vars` en esa carpeta si vas a probar el Worker con Wrangler. Configura los secretos de producción en Wrangler. Las funciones espaciales remotas requieren los accesos y modelos descritos en [infra/modal](infra/modal/README.md). La [configuración de conectores](config/integrations.example.json) y el [inventario de accesos](docs/30-accesos-pendientes.md) detallan las integraciones opcionales.

## Cuentas para una instalación propia

- **Meta y Cartesia.** Crea tus propias credenciales en [Meta for Developers](https://dev.meta.ai/) y [Cartesia](https://play.cartesia.ai/). Habilita los modelos que usarás y comprueba los créditos o la cuota de cada cuenta antes de activar voz, traducción o agentes.
- **Google.** Crea un proyecto en [Google Cloud Console](https://console.cloud.google.com/). Habilita Calendar, Gmail o Drive según el conector, configura el consentimiento OAuth y crea un cliente de tipo *Desktop app*. Añade usuarios de prueba si el proyecto está en modo de pruebas. Copia el ID y el secreto del cliente a `.env`, reinicia y concede los permisos desde Conexiones. [Guía de Google OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).
- **Spotify.** Crea tu propia aplicación en [Spotify for Developers](https://developer.spotify.com/dashboard), configura su Client ID y registra la URL HTTPS `/spotify/callback` de tu instancia. El sitio y el relay OAuth se encuentran en `official-site/`. Usa el mismo dominio en la configuración de Brivany, del Worker y de la aplicación Spotify. Para reproducción mediante el SDK, verifica los requisitos de Spotify Premium. [Guía del SDK](https://developer.spotify.com/documentation/web-playback-sdk).
- **Alojamiento opcional.** Define tus propios dominios y bindings en los archivos Wrangler de `official-site/` y `workers/mobile-gateway/`. Busca `brivany.example` y `mobile.brivany.example` en el proyecto y sustituye esos valores en los consumidores del servicio que publiques. Para Spotify, configura también `SPOTIFY_CLIENT_ID` y `SPOTIFY_RELAY_SIGNING_KEY` en el Worker del sitio. Si distribuyes el cliente iOS, configura su URL del gateway y su identificador de aplicación antes de compilar. Los dominios `brivany.example` y `mobile.brivany.example` son ejemplos reservados. Las funciones locales arrancan independientemente. Las funciones conectadas requieren una instancia propia y los permisos de su proveedor.

## Desktop y extensión de Brave

En Windows, con el entorno virtual del arranque rápido:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
.\.venv\Scripts\python.exe -X utf8 -B -m desktop.launcher --check
.\.venv\Scripts\python.exe -X utf8 -B -m desktop.experience.launcher
```

En Brave abre `brave://extensions`, activa **Modo de desarrollador** y usa **Cargar descomprimida** para elegir `browser-extension/`. Con Desktop abierto, reproduce un video compatible y pulsa el botón de la extensión. Para usarla desde WorkSpace, concede el acceso al sitio cuando Brave lo solicite. Consulta [Desktop](desktop/README.md), [WorkSpace](docs/melodi-workspace.md) y la [guía de la extensión](browser-extension/README.md).

El control de ordenador requiere una copia autorizada del backend Cognira y las dependencias fijadas en los locks. Con esa copia disponible, usa `python -m tools.bundle_computer_backend --source RUTA --activate`. Consulta la [documentación del control nativo](docs/control-ordenador-melodi.md).

## Pruebas y bitácora

Las suites seleccionadas se ejecutan sin credenciales de proveedor. Usa Node.js para las pruebas de extensión y el Python del entorno virtual para el resto.

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify contracts
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify sync-relay
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify workspace-sync-extension
```

`tools.verify` añade los resultados nuevos a la bitácora local y a `tmp/verification/`. Los escenarios con cuentas, dispositivos físicos y proveedores reales tienen requisitos propios en [VALIDACION.md](VALIDACION.md). El historial de construcción está en [docs/17-bitacora.md](docs/17-bitacora.md) y los informes en [docs/verification-history](docs/verification-history).

La [copia pública de la bitácora](docs/activity-history) conserva las entradas y la evidencia textual depurada. Las capturas privadas se representan con una nota. Para abrir el histórico en `/activity`, copia la carpeta antes del primer arranque:

```powershell
New-Item -ItemType Directory -Path .local -Force | Out-Null
Copy-Item -Recurse docs/activity-history .local/activity
```

## Estructura

- `web/` contiene las interfaces y `services/` el servidor local, los relays y la coordinación.
- `packages/providers/` contiene los adaptadores de servicios externos.
- `desktop/` y `browser-extension/` conectan WorkSpace con Windows y Brave.
- `workers/`, `infra/` e `ios/` contienen los componentes remotos y móviles.
- `contracts/`, `tests/` y `tools/` contienen los contratos, pruebas y utilidades.
