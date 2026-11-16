# Brivany para Windows · primera distribución

Versión 0.1.0, Windows 10/11 de 64 bits. Instalación por usuario, sin Python del sistema. El asistente está en español e incorpora el desinstalador y los accesos directos. Usa el WebView2 compartido de Windows; su bootstrapper oficial de Microsoft solo se ejecuta si falta ese componente. .NET Framework 4.8 es requisito comprobado por el instalador.

## Archivos y persistencia

- Instalador: `Exports/Brivany-Windows-0.1.0/Brivany-Setup-0.1.0-x64.exe`.
- Programa: `%LOCALAPPDATA%\Programs\Brivany\Brivany.exe`.
- Versiones: `%LOCALAPPDATA%\Programs\Brivany\releases\<versión>`.
- Datos: `%LOCALAPPDATA%\Brivany\User Data`. Los tokens que ya usaban DPAPI siguen cifrados para el mismo usuario de Windows. La configuración local de proveedores conserva su formato existente.
- Desinstalación desde Configuración de Windows o el acceso «Desinstalar Brivany». Conserva cuentas, ajustes y proyectos. Elimina las versiones del programa.

La migración del perfil de desarrollo de este PC se hace por separado con `tools/migrate_windows_profile.py`. No se incluye ese perfil en el instalador. No sobrescribe archivos existentes y usa la copia de seguridad de SQLite para leer bases abiertas. Las credenciales DPAPI de un usuario no son portables a otro equipo por una copia de archivos.

## Actualizaciones

Brivany consulta `https://brivany.vetsa.es/windows/stable.json` a los 25 segundos del inicio y cada seis horas. También se puede comprobar desde Ajustes → General. Una nueva versión se descarga y prepara en segundo plano. El usuario elige cuándo reiniciar para aplicarla; el cierre normal respeta los avisos de trabajo pendiente del lienzo.

El manifiesto lleva una firma Ed25519, fecha de vigencia, versión y SHA-256 del paquete. Se rechazan cambios de origen HTTPS, versiones inferiores, archivos manipulados y rutas de extracción peligrosas. El cambio de versión usa `current.json` atómico. Si la nueva ventana no confirma su inicio, se selecciona de nuevo la versión anterior para el próximo arranque. No se vuelve a ejecutar el instalador durante una actualización.

El canal HTTPS está activo con los metadatos firmados de 0.1.0. Los binarios de esta primera entrega permanecen locales. Para distribuir una actualización a otros equipos hay que publicar expresamente su paquete firmado; no basta con cambiar el número de versión del manifiesto.

## Preparar la próxima versión

1. Cambiar `desktop/distribution/version.json` a una versión superior.
2. Ejecutar `tools/build_windows.py` con el entorno verificado y `--iscc` apuntando a Inno Setup. `--refresh` reutiliza el runtime de una compilación existente de esa misma versión.
3. Ejecutar las pruebas de distribución, `tools/check_windows_installer.py` y `tools/check_windows_update.py`.
4. Revisar el paquete. Ejecutar `tools/prepare_update_channel.py Exports/Brivany-Windows-<versión> --packages` para incluir los binarios. Sin ese argumento solo se prepara la información de versión.
5. Publicar con Wrangler usando exclusivamente `packaging/updates/wrangler.jsonc`. La ruta dedicada `/windows/*` no reemplaza el sitio principal. El Worker entrega los paquetes por streaming desde fragmentos inmutables de hasta 20 MiB; el cliente verifica el archivo completo.

La clave privada de publicación está en `.local/distribution/publisher-key.dpapi`, protegida con DPAPI. Nunca incluirla en el instalador ni subirla al canal. Debe conservarse junto con una estrategia segura de recuperación del usuario de Windows; perderla impide firmar nuevas versiones compatibles con los clientes actuales. El manifiesto debe renovarse antes de su vencimiento aunque no haya versión nueva.

## Validación y límites

Se verificaron 71 pruebas Python y tres pruebas del canal de descargas. La aceptación nativa instaló, abrió y desinstaló el programa en un directorio aislado, conservando los ajustes. La aceptación de actualización usó el ZIP firmado real con transporte local simulado: comprobó la firma, extrajo, cambió la versión y abrió el ejecutable real. La consulta pública HTTPS del manifiesto también se comprobó. No se simularon llamadas ni peticiones a proveedores como parte de estas pruebas.

Los informes están junto al instalador: `installer-acceptance.json`, `update-acceptance.json`, `release-validation.json` y `build-report.json`.

El instalador todavía no tiene certificado Authenticode de editor para Windows; la firma Ed25519 protege las actualizaciones, pero no sustituye ese certificado. Los servicios externos requieren las conexiones/API de cada equipo. El backend externo de control de ordenador Cognira no se redistribuye en este instalador; su código no establece una licencia de redistribución pública. Las herramientas externas de render y telefonía mantienen sus requisitos propios. La migración local conserva los componentes ya existentes de este PC.
