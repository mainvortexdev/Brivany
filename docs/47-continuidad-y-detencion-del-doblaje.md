# 47. Continuidad, transporte y detención del doblaje

30 de octubre de 2026, America/La_Paz. Se mantiene Palabra por instrucción del
usuario. La exploración de Meta quedó detenida; no se migró la arquitectura ni
se necesita Modal para este recorrido.

## Correcciones aplicadas

El envío TLS a Palabra podía bloquear la lectura de la captura. Una prueba real
enviaba 25 s desde el navegador, pero el relay sólo había pasado 8,48 s; el primer
audio tardó 23,67 s. Se separó el escritor de red de la captura con una cola
acotada a ocho bloques de 320 ms, el tamaño recomendado por el proveedor. La
validación de ritmo usa la duración acumulada frente al reloj de la sesión y
tolera ráfagas debidas a red. No reintenta ni crea una cola sin límite.

El límite de cola TTS del proveedor pasa de 4 a 12 s para reducir el riesgo de
descartar voz de una frase larga; objetivo 2 s y tempo entre 1 y 1,12. No se
promete que nunca haya descarte o atraso. El cierre anunciado admite hasta
30 s para terminar la cola, con cancelación disponible durante la espera.
Consultar la configuración con campos completos permite comprobar el perfil
aplicado. Los diagnósticos optativos sólo contienen contadores, idiomas y tiempos.

Para el sonido cortante reportado por el usuario, la salida ahora agrupa PCM
en bloques contiguos de 160 ms, conserva colas y finales parciales y limita la
espera de una cola pequeña. Así, paquetes diminutos del proveedor no se convierten
individualmente en frames del mezclador con silencio añadido. Cambiar idioma
descarta también ese buffer. No es una prueba de calidad auditiva universal.

Detener envía `cancel` antes de cerrar el WebSocket. El backend corta y vacía
el dispositivo Windows **antes** del cierre de red y de esperar a los hilos.
Se aplica también cuando se cierra la pestaña. La prueba bloquea deliberadamente
el cierre del proveedor y exige que la salida local ya esté cerrada en 300 ms.
No se drena la voz pendiente al cancelar.

El mismo idioma de origen/destino detectado permite escuchar el original a
volumen normal. Hay subtítulos bajo el video y un enlace `from=en` para declarar
el idioma de este ensayo; otros videos conservan selección/detección en Ajustes.

## Resultados, consumo y límites

- `docs/verification-history/palabra-live-20261030T113052-6f3665b5.json`: 40 pruebas
  locales, incluido conservar bytes al agrupar 32 paquetes diminutos, orden del
  envío con una escritura bloqueada, cancelación y cierre de pestaña antes de
  desconectar el proveedor.
- `docs/verification-history/youtube-simple-20261030T113052-a2751a8a.json`: recorrido
  local con captura/YouTube/proveedor/dispositivo sustituidos; sin popup y con
  los tres destinos. No acredita escucha real.
- `tmp/native-stop-real/report.json`: dispositivo WinMM real, PCM de silencio,
  buffers vacíos y contador de salida invariable tras cerrar; sin APIs ni audio
  guardado. No hubo micrófono ni comprobación física del altavoz.
- `tmp/youtube-dubbing-real/report-20261030T111211131Z.json`: prueba real previa
  al último agrupamiento/corte, 25 s de entrada, 12,28 s de voz entregada al
  dispositivo, seis subtítulos traducidos, primer envío a salida a 2975 ms,
  sin rechazos del dispositivo ni pausas durante la entrada. El ensayo se cortó
  antes de completar el cierre: **no acredita traducción íntegra ni fluidez**.

Corrección del propio verificador: ese último informe anunciaba 35 s de margen
de cierre, pero la condición ejecutada seguía cortando a 12 s. Se conservó el
informe histórico y se corrigió la condición; no se reejecutó para mejorar el
resultado. La última corrección de sonido se comprobó localmente para dejar
al usuario probar sin otra sesión audible automatizada en segundo plano.

En esta investigación hubo cinco sesiones reales de YouTube (20,52; 25; 8,32;
25; 25 s enviados desde el navegador), cada una con una hipótesis/cambio y sin
reintento automático. El envío efectivo al proveedor fue inferior en los
ensayos bloqueados. Además, cuatro sesiones de calidad con frases sintéticas
EN→ES, EN→FR, ES→EN y auto EN→ES: 35,672 s de entrada total, señal de voz en
los tres destinos; estimación de entrada $0,023781 según referencia histórica
$0,04/min, **facturación real desconocida**. Los informes y WAV traducidos
sintéticos están en `tmp/palabra-quality-real/`; los WAV no se adjuntan a la
bitácora. El cribado de conceptos y ASR español offline no acreditaron por sí
solos corrección semántica ni escucha humana.

Una sesión de inspección de configuración Palabra no envió audio y confirmó
los campos del perfil anterior; coste desconocido. Un GET del catálogo Meta
comprobó Muse Voice Transcribe disponible y ningún Seamless, sin inferencia.
No se muestran claves. No se han verificado 500 ms audibles, calidad perfecta,
ausencia universal de cortes, ocho minutos continuos ni salida en móvil/macOS.
