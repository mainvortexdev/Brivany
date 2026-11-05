# 45. URL y dos acciones

29 de octubre de 2026, America/La_Paz. El usuario pidió simplificar la pantalla
a un enlace, reproducción con doblaje y cambio de idioma. La
[vista simple](http://127.0.0.1:8765/dubbing?provider=palabra&source=youtube&view=simple)
conserva esos dos botones principales y un campo URL. El iframe se prepara al
pegar un enlace válido, sin reproducir ni abrir Palabra automáticamente.

**Reproducir con doblaje** inicia el recorrido existente y cambia a **Pausar**
durante la sesión. **Idioma** recorre español, francés e inglés; el que coincide
con el idioma fuente permite escuchar el original. El original permanece reducido
durante la traducción. Los selectores técnicos, volúmenes, conexión y mediciones
se conservan dentro de **Ajustes**, cerrado inicialmente. La vista completa para
archivos y otros proveedores sigue disponible mediante `view=advanced`.

El gesto de reproducir concede el envío de ese audio a Palabra, indicado bajo los
botones. No guarda el permiso del selector de pantalla ni evita su intervención.
La escucha en ventana separada conserva la protección contra realimentación:
en el primer uso el navegador puede pedir activación de esa ventana y un segundo
clic en el mismo botón antes de elegir la pestaña y compartir audio. Simplificar
los controles no elimina requisitos de activación del navegador ni las
limitaciones reales de [44](44-youtube-live-con-palabra.md).

La prueba inicial detectó que el botón no actualizaba su etiqueta al pasar a
escuchar el original; se corrigió sincronizando el estado de escucha. Pasaron
[cinco controles E2E](verification-history/youtube-simple-20261030T035047-59913c91.json)
con HTTP/WS, AudioWorklet, AudioContext y MessageChannel locales reales y
YouTube/captura/Palabra sustituidos: exactamente dos botones visibles con Ajustes
cerrado, URL manual, traducción simulada, cambio ES→FR→original, liberación de
tracks y anchuras de escritorio/móvil. Las capturas en `tmp/youtube-simple/`
representan el reproductor sustituido, no una traducción real de YouTube.

Cero llamadas externas de estas pruebas locales y ninguna nueva inferencia
pagada. Calidad lingüística, captura real de YouTube, aislamiento físico y
retraso audible siguen pendientes. La solicitud de apertura del panel devuelve
`queued`; no se afirma que haya navegado la pestaña visible del usuario.
