> Tipografía vigente desde el 15 de noviembre de 2026: Brivany Editorial 300/400/500. Ver `brand/typography/README.md`. Las referencias antiguas de este documento son históricas.

# Dominio de Brivany

## Presentación publicada · 1 de noviembre de 2026

La raíz ya contiene la web oficial interactiva: estudio 3D de ordenador, móvil y
gafas, instrucciones editables y extracción local de audio. Georgia y Segoe UI.
Móvil/gafas se identifican como conceptos. Las páginas legales y OAuth se
conservan. Los apartados posteriores describen la evolución anterior.
[Diseño, publicación, pruebas y límites](../docs/web-oficial-interactiva.md).

Desarrollo desde este directorio: `npm ci`, `npm run build` y `npm run dev`.
El runtime local actualmente instalado requiere añadir
`-- --compatibility-date 2026-10-30` al comando dev; producción conserva la fecha
del archivo de configuración. Validación: `npm run check`,
`node --test test/wav.test.mjs` y
`node scripts/check-http.mjs http://127.0.0.1:8787` con dev abierto.
`npm run deploy` compila y publica al Worker existente. No copiar `.env`,
credenciales ni medios a `public/`.

Preparación de `https://brivany.example` mediante un Worker propio y un Custom
Domain de Cloudflare en la zona `example.com`. El Custom Domain administra su registro
DNS y certificado. No se modifica el sitio principal ni otros subdominios.

La raíz muestra una página temporal de preparación; la web oficial será otro
hito. `spotify-oauth.mjs` incorpora el puente OAuth HTTPS hacia el escritorio con
sesiones temporales. No se publican los servicios locales. El callback usa una
cookie breve y una clave de firma guardada como secreto de Cloudflare; los tokens
y el verificador PKCE permanecen en el ordenador. Ver
[arquitectura y comprobaciones](../docs/spotify-retorno-https.md).

Configuración declarativa: `wrangler.jsonc`. Despliegue con Wrangler autenticado
en la cuenta propietaria: `wrangler deploy --config official-site/wrangler.jsonc`.
Validación previa: el mismo comando con `--dry-run`.

Para el registro de Spotify, Website es `https://brivany.example`. El Redirect
URI vigente es `https://brivany.example/spotify/callback`. La integración usa
Web API y PKCE, sin Web
Playback SDK, Client Secret, Ads API ni SDKs de iOS/Android.

Actualización del 31 de octubre: el consentimiento añade lectura de biblioteca;
las autorizaciones anteriores conservan reproducción y pueden ampliar acceso en
Conexiones. La interfaz de Música y los proveedores de letras se describen en
[biblioteca y letras](../docs/spotify-biblioteca-letras.md).


Revisión posterior del 31 de octubre: el reproductor pasa a SDK en host nativo
aislado, con token corto solo para ese host, historial opcional, portadas mosaic,
ondas ambientales y teleprompter integrado. Actualiza los límites de la versión
anterior sin reescribirla. [Arquitectura y evidencias](../docs/spotify-workspace-dispositivo.md).

## Información pública de Brivany

La portada ya describe la aplicación y enlaza las páginas públicas
`https://brivany.example/privacidad` y
`https://brivany.example/condiciones`. Los textos identifican a Daniel Luna y el
contacto público indicado por el usuario. Las rutas `/privacy` y `/terms`
redirigen a sus equivalentes canónicas en español. No hay scripts, fuentes
remotas ni cookies en estas páginas informativas.

El sitemap incluye esas tres páginas; `robots.txt` permite la parte informativa
y excluye `/spotify/`. El callback y las APIs de Spotify conservan sus propias
respuestas privadas y sin caché. Los logs/traces del Worker siguen desactivados
para no incorporar URLs de autorización a observabilidad genérica. Una futura
instrumentación debe excluir los parámetros y credenciales de OAuth.

Las páginas públicas y el consentimiento de Google usan los mismos enlaces.
Publicar estos textos no equivale a superar la verificación de marca, permisos
sensibles/restringidos o seguridad que Google pueda requerir.
