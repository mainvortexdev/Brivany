# Ensayo 060: apertura agotada antes de activar el doblaje

4 de noviembre de 2026. Se conserva el intento anterior descrito en
[preparación paralela 059](traduccion-auditiva-preparacion-paralela-059.md):
el control había indicado que el navegador local estaba deshabilitado y no
se inició aquel ensayo. Después de restablecerse la sesión de control, una
apertura normal del banco en el navegador integrado volvió a estar disponible.
Se abrió el banco 49203 en la pestaña integrada 2 y se pulsó su inicio visible.
Es un intento posterior distinto; no cambia retroactivamente el resultado
del intento bloqueado ni acredita recarga de la extensión personal.

## Resultado real

El estado terminal registró inicio a las **18:04:49,154 UTC** y final a las
**18:05:13,622 UTC**, unos 24,468 s después. El plan solicitaba prefijo y
continuidad, con ventana máxima de 60 s y cobertura mínima de 31 s. No se
alcanzaron esas fases de aceptación: el informe
`tmp/selected-video/inline-sync-1793815513583.json` terminó con
`passed=false` y **`abrir-video: TimeoutError`**.

El informe original no contiene controles de identidad de la fuente,
resultado del prefijo, intervalos de voces, cobertura completada ni métricas
de retraso. No se rellenan esas ausencias con ceros ni se acepta el ensayo
por carecer de errores posteriores de audio. El estado saneado enumera voces
y eventos vacíos, pero eso no demuestra que una sesión de doblaje se
reprodujera correctamente. La fase de apertura agotada tampoco prueba por
sí sola que el elemento de video no tuviera audio o no estuviera reproduciendo.
La causa exacta del plazo agotado permanece en diagnóstico.

No hubo activación de una sesión de traducción en el relay. Sin embargo,
**sí se inició una preparación automática del prefijo y un intento Muse batch**
antes de que el banco agotara la apertura. La preparación automática puede
comenzar antes del primer control de identidad del banco; este resultado
debe distinguirse de una apertura que no haya consumido ningún proveedor.
El informe no demuestra que Muse terminara con éxito ni que se prepararan
los siete segundos utilizables.

Por ello, este ensayo **no mide el ahorro real del solapamiento 059 ni el
efecto del corte estable 058**. Tampoco verifica audio traducido, hablantes,
emoción, registro, canciones, sincronía o continuidad. La última evidencia
real de voces completas continúa siendo el ensayo 057, todavía rechazado
por retraso. El alcance integral se conserva en la
[matriz de aceptación](traduccion-auditiva-aceptacion-057.md).

## Consumo y límites

El estado terminal completo se guardó en
`tmp/selected-video/lab-consumption-49203-060.json`. Sus contadores confirmaron:

- Cero sesiones de relay de traducción iniciadas.
- Una preparación del prefijo y un intento Muse batch.
- Cero intentos de prosodia del prefijo o en vivo y cero traducciones
  anticipadas de subtítulos.

No se inició el trayecto MT/TTS de una sesión de doblaje. Los contadores de
MT y TTS de una sesión en vivo no figuran en el informe incompleto; no se
inventan campos de consumo ausentes. El importe facturado, el uso remoto de
GPU y el tráfico incidental total son desconocidos. La navegación a YouTube
tampoco se contabiliza como gratuita por no haber doblaje.

Esta revisión retrospectiva no repitió pruebas ni abrió inferencias nuevas.
Sólo conserva documentos, cantidades y códigos, sin PCM, video, transcripciones
o credenciales originales. El siguiente diagnóstico debe separar la espera de
navegación del estado real del elemento de video, antes de atribuir este fallo
a los cambios de preparación o reconocimiento.
