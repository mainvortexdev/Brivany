# Melodi: navegación comprobada el 30 de octubre de 2026

El adaptador de Brivany reutiliza BrowserSession y los ejecutores nativos de
Cognira/Stacy sin modificar ese directorio. Se comprobaron Chrome y Windows con
perfiles nuevos de prueba, separados del perfil personal. Los resultados tienen
este alcance; no garantizan todos los sitios, versiones o estados de una cuenta.

## Recorridos reales

| Prueba | Resultado observado | Evidencia local |
|---|---|---|
| Pestañas y clic | Un clic cambió el botón de una página sintética; abrió otra pestaña, verificó la URL y restauró la original | `tmp/computer-browser-real/report.json` |
| Búsqueda web | Google recibió «NASA sistema solar sitio oficial»; URL y contenido de resultados NASA observados | mismo informe |
| Acceso a plataforma | Abrió `https://github.com/login` y devolvió el control al usuario antes de introducir credenciales | mismo informe |
| Canción y artista | Buscó Rick Astley / Never Gonna Give You Up, seleccionó un resultado musical oficial observado y confirmó dos avances del contenido | `tmp/computer-youtube-real/report.json` |
| Reproductor | Pausa y reanudación verificadas en ese reproductor; quedó pausado y conservó las pestañas anteriores | mismo informe |
| Orden completa a Melodi | HTTP → router Meta → planificador Meta → clic nativo → pestaña B nueva → observación → finalización. El servidor de la fixture recibió exactamente un clic y ambas pestañas permanecieron abiertas | `tmp/computer-agent-browser-real/report.json` |

El último recorrido usa texto sintético por la ruta que comparte el live. Sus
observaciones reales se filtran a la ventana de prueba antes de enviarlas al
proveedor; el ejecutor nativo no se sustituye. No prueba micrófono, ASR, TTS ni
audibilidad física. La verificación de YouTube observa progreso del contenido,
sin confundir el contador de un anuncio ni una etiqueta «Pausa» con música en avance.
El manejo de anuncios sólo actúa sobre un botón «Saltar» observado dentro del
reproductor; los casos sustituidos comprueban esta distinción. La aparición y
disponibilidad de anuncios reales pueden variar.

## Correcciones derivadas de las pruebas

- Las pestañas se identifican por su árbol nativo fuera del documento web; se
  cubre el cambio de clases de Chromium que dejaba vacío el observador reducido.
- La navegación se escribe una sola vez. Después se espera y verifica la URL en
  la misma ventana. Un documento accesible que tarda en aparecer no dispara otra
  entrada. Cambiar de ventana o destino detiene la acción.
- La protección heredada filtraba el movimiento físico del cursor y YouTube
  dejaba de actualizar el contador visible/accesible. Un diagnóstico separado
  del perfil de prueba confirmó que el video avanzaba mientras el contador no.
  El adaptador envía sólo movimiento inyectado sobre el reproductor revalidado y
  mantiene ese punto visible durante la lectura; no busca otra posición del video,
  no repite clics y no libera la protección ni Escape para obtener una verificación.
- Ventanas, controles y parámetros usan identificadores de ventana como cadenas
  decimales. El recorrido completo detectó la inconsistencia número/cadena.
- El acceso a cuentas entrega el control antes de observar sus campos. Admite una
  redirección HTTPS del mismo origen; no amplía el destino autorizado. No introduce
  contraseñas, MFA, CAPTCHA ni acepta permisos. Después de la intervención, el
  usuario pide la siguiente acción. No se acredita una cuenta autenticada.
- Los recibos persistentes excluyen las URL completas, las consultas de búsqueda
  y los posibles códigos de redirección de autenticación. Conservan sólo el estado
  técnico y la necesidad de intervención, además de los campos operativos admitidos.

## Pruebas locales y consumo

`tools.verify computer` comprueba 19 casos con proveedor/entrada nativa sustituidos
y compilación GLB real local. `tools.verify computer-native` comprueba 18 casos,
incluyendo contador congelado, anuncios, cambio de resultado, redirección de acceso,
destino incorrecto e identidad de entrada. No consultan proveedores externos.
`tools.verify computer-ui` comprobó control desde el live, conversación simultánea,
visor junto a la voz, parada y márgenes a 320, 390, 768, 1120 y 1440 px, con proveedores
y entrada nativa sustituidos. Necesita Playwright instalado o `BRIVANY_PLAYWRIGHT_PATH`.
Una ejecución sin esa dependencia falló antes de abrir el navegador; la posterior,
con el runtime ya instalado, pasó. Ambos registros permanecen en la bitácora.

Las herramientas reales quedan fuera de esas suites para no consumir inferencia
por accidente. La búsqueda/reproducción final en YouTube recibió una respuesta de
Meta; el recorrido completo final recibió cinco. Los ensayos previos se conservan
como fallos y contadores de intentos, sin ocultarlos ni acreditar sus acciones como
éxito. Algunos llegaron a completar pasos antes de detenerse. El importe y el tráfico
de fondo del navegador son desconocidos; no se declara coste cero ni consumo total
a partir de un contador previo al transporte.

Un intento de búsqueda web no verificó su destino; otra ejecución explícita pasó
sin relajar la comparación. No se atribuye una causa no observada al primer fallo.
Edge y Brave mostraron diálogos de cuenta/primer uso durante los ensayos: no se
aceptaron ni se completaron automáticamente y no se declaran verificados.

## Repetición deliberada

Desde la raíz, con el entorno y Meta ya configurados:

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.check_computer_browser_real --web-search
.\.venv\Scripts\python.exe -X utf8 -B -m tools.check_computer_youtube_real --allow-paid
.\.venv\Scripts\python.exe -X utf8 -B -m tools.check_computer_agent_browser_real --allow-paid
```

No deben lanzarse a la vez: cada herramienta usa y enfoca su ventana de prueba.
Los informes contienen resúmenes técnicos, no claves, grabaciones, conversaciones
personales ni sesiones de cuentas. El objetivo de paridad con Stacy sigue activo;
estos recorridos no acreditan Office sin licencia, macOS/Linux ni todos los sitios.
