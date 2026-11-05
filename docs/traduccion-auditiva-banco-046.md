# Banco local de Traducción auditiva · 0.4.6

## Incidente del 4 de noviembre de 2026

El usuario informó que dejó de oír el doblaje y que Brave y la pantalla se
sentían lentos, con voces aparentemente ralentizadas. En su captura apareció
el aviso de cinco segundos de Meta. La instancia de escritorio inspeccionada
seguía abierta desde antes de la entrega anterior. El aviso prueba un fallo
de tiempo en traducción de texto. La ralentización completa de Windows y el
consumo de la prueba del usuario siguen sin cuantificar.

## Cambios

- La traducción en la pestaña tiene un plazo de 6,5 s por turno. Un fallo
  transitorio libera ese tramo con el original. Si había audio parcial en
  Cartesia, Brivany lo cancela. El siguiente turno usa una conexión nueva
  a Meta y se evita repetir el turno fallido. Tres fallos seguidos terminan
  la sesión y devuelven el control al reproductor.
- La síntesis anticipada sólo se inicia cuando Cartesia está conectado. La
  extensión admite una frase finalizada que llega tarde hasta el margen de
  8,75 s desde su inicio, con el límite de espera del reproductor activo.
  Los turnos abiertos recuperan el original desde los 7 s.
- La copia audiovisual se limita a 640 × 360, 24 fps y 400 kb/s de video.
  El límite de cola de grabación baja a 4 MiB. Una pérdida sostenida de
  fotogramas activa la recuperación del reproductor original. El audio de
  doblaje conserva un mínimo de 1×.
- La página local muestra el video exacto enlazado por el usuario y ejecuta
  una sesión de hasta 28 s desde el segundo 24. El navegador integrado
  presenta las mediciones. Un perfil aislado de Brave carga la extensión y
  usa el relay de Brivany con las APIs configuradas. El banco permite escuchar
  un extracto de voz generada en memoria si hay salida medible.

## Comprobaciones locales

- El relay descartó un contexto de Cartesia parcialmente sintetizado tras un
  `mt_timeout`, marcó el intervalo para reproducir el original y dobló el
  siguiente. Pasaron 30 pruebas `sync-relay` y 43 `river-translation`.
  Informes `docs/verification-history/sync-relay-20261104T135946-a6af5ff8.json` y
  `docs/verification-history/river-translation-20261104T135946-42505301.json`.
- Pasaron 30 pruebas `meta-translation` y 45 `workspace-sync-extension`.
  Informes `docs/verification-history/meta-translation-20261104T140013-e029a75e.json`
  y `docs/verification-history/workspace-sync-extension-20261104T140016-d3906187.json`.
- En Brave aislado, con video propio 720p/60 y proveedores sustituidos, la
  copia interna fue de 640 × 360 a 24 fps. Tres frases a 1× tuvieron señal
  Web Audio. La primera salió a 8,153 s con demora inducida y los tres
  desfases fueron +6, +6 y −12 ms. Informe
  `tmp/selected-video/inline-sync-1793800631955.json`.
- Se cotejaron los 18 archivos del ZIP de Brave 0.4.6. Informe
  `tmp/selected-video/release-046.json`.

El ensayo real se inició desde el banco abierto en el navegador integrado.
Brave aislado cargó el video de Tecnonauta desde 0:24 y abrió una sesión con
Muse, Meta y Cartesia. La primera voz tuvo señal Web Audio a los 6,386 s
desde captura. Dos frases terminaron, a 1,166× y 1×, con desfases de +32 y
−17 ms respecto a los turnos informados por Muse. La copia fue 640 × 360
a 24 fps. Se distinguieron dos etiquetas, ambas asignadas a voces femeninas.
Quedan pendientes la correspondencia del timbre con los hablantes reales,
la escucha física y la estabilidad de una sesión larga en el perfil habitual.

En el recorrido se observaron 13,2 s de progreso de Muse, dos solicitudes de
traducción, tres análisis de prosodia iniciados y dos contextos de síntesis.
El consumo total de anticipación y el importe facturado son desconocidos.
Informe `tmp/selected-video/inline-sync-1793801037348.json`. El banco conserva
un extracto sintetizado en memoria para escucha y la bitácora guarda métricas.

La extensión 0.4.6 se dejó en la carpeta registrada en Brave. La prueba real
utilizó un perfil y un relay aislados con el código nuevo. La recarga de la
extensión y el reinicio de la instancia habitual quedaron pendientes.
