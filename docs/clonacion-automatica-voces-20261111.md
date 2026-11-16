# Clonación automática de voces durante la traducción

11 de noviembre de 2026. Implementado y comprobado con pruebas locales simuladas;
sin prueba real de extremo a extremo. Antecedente: la
[prueba de latencia](siliconflow-clonacion-prueba-20261111.md) eligió Cartesia
(primer audio de 0,18–0,65 s con voz clonada) frente a SiliconFlow (≥ 1,7 s).

## Qué cambia

- **YouTube/video en la pestaña.** Antes la clonación (`TranslationVoiceAgents`)
  solo se aplicaba a etiquetas A/B del ASR; en video en línea los hablantes se
  agrupan por embedding acústico local y el clon nunca se usaba. Ahora cada
  fragmento con voz confirmada y asociación `matched`/`new_cluster` alimenta al
  agente con la clave anónima `acoustic:N`. El ASR ya no alimenta al agente en
  ese modo, para no clonar dos veces.
- **Clon en segundo plano.** Con ≥ 10 s de voz limpia en ≥ 2 fragmentos se crea
  el clon en Cartesia (≈ 4 s medidos) sin detener la traducción; mientras tanto
  suena la voz de catálogo por género. El siguiente fragmento de ese hablante
  usa el clon (`SpeakerTracker.voice` resuelve claves acústicas). Solo en voz
  Automática; Masculina/Femenina manual nunca usa clones.
- **Mantener o eliminar.** Cada voz lista muestra «Mantener» en WorkSpace. Por
  defecto se elimina al terminar la sesión. Si se marca, sale del diario de
  limpieza temporal y se guarda en `.local/translation/kept-voices.json` (solo
  ID remoto, nombre «Hablante N · fecha», idioma y hora; nunca audio, texto ni
  embeddings). Si falla guardar la lista, la voz se elimina para no dejar una
  voz remota sin control.
- **Voces guardadas.** Con la traducción detenida, el panel lista las voces
  guardadas con «Eliminar» (confirmación). Solo borra IDs de esa lista; si
  Cartesia falla, la entrada se conserva.
- La casilla pasa a «Clonar voces mientras traduce»; sigue exigiendo elegir el
  idioma original y no se puede cambiar con una traducción activa.

API de escritorio: `work_voice_keep(token, keep)`, `work_kept_voices()`,
`work_kept_voice_delete(id)`. El token es aleatorio por sesión.

## Comprobaciones

| Suite | Resultado |
|---|---|
| `tests.test_voice_clone_keep` (nueva, en `tools.verify river-translation`) | 12 correctas: umbral de 10 s, claves inválidas, borrado por defecto, mantener y cambiar de opinión, fallo de biblioteca → borrado, tokens inválidos, resolución por clúster, manual sin clon, biblioteca y borrado; y recorrido inline real del relay con ASR/TTS de bucle local donde el fragmento llega a `acoustic:1` y la voz enviada a TTS es el clon |
| `tools.verify river-translation` | 82 correctas, 1 omitida |
| `tools.verify sync-relay` | 104 correctas |
| `tests.test_audio_content`, `tests.test_work_translation` | 28 correctas |

Ninguna prueba llamó a Cartesia, Muse ni Meta: cloner, clasificador y
clústeres son sustitutos.

## Límites

No se comprobó en la aplicación real ni con un video de YouTube: falta reiniciar
Brivany Desktop y escuchar. El tiempo hasta el clon depende de que cada persona
hable ≥ 10 s limpios; música, voces superpuestas o clústeres ambiguos lo
retrasan o impiden. Máximo cuatro voces por sesión. Un clon inglés que habla
español conserva su acento de origen. Cada clon consume créditos de Cartesia.
Las voces guardadas permanecen en la cuenta de Cartesia hasta eliminarlas.
Clonar voces de terceros es para escucha personal; la casilla mantiene el
consentimiento explícito del usuario.

## Corrección tras la primera prueba real del usuario

En modo Directa (YouTube en el navegador, español → inglés) el usuario observó
que la voz traducida hablaba demasiado lento y con pausas de hasta ~2 s entre
palabras mientras el video ya iba más de cinco palabras por delante, y que la
casilla de clonación no se podía activar.

Causas encontradas en el código:

- **Envío palabra por palabra.** En captura directa el texto de Meta se enviaba
  a Cartesia en cuanto terminaba una palabra si habían pasado 120 ms, o en cada
  coma. Con `max_buffer_delay_ms: 0`, Cartesia locuta cada trozo por separado:
  una palabra, silencio hasta la siguiente palabra de Meta, otra palabra. Las
  comas también cortaban la frase.
- **Sin ajuste de ritmo.** El ajuste de velocidad solo existía para video en la
  pestaña; en Directa la voz iba siempre a velocidad 1.
- **Casilla bloqueada.** Se desactivaba mientras había una traducción activa,
  sin explicación.

Cambios:

- Directa envía frases: el primer trozo con ≥ 24 caracteres (unas 4–5
  palabras) y los siguientes con ≥ 48, siempre en límite de palabra, o al
  terminar una oración. Nunca se corta en una coma ni por temporizador.
- Velocidad en Directa: 1,1 base, +0,08 por cláusula que espera turno, máximo
  1,35. Se fija al primer envío y se repite en cada continuación, para que una
  frase tenga un solo ritmo. Es una heurística, no una medición del hablante.
- La casilla se puede pulsar durante una traducción Directa: la detiene, aplica
  la clonación y la vuelve a iniciar (hasta cinco intentos de 0,5 s mientras se
  liberan las conexiones). En modo Navegador pide detener primero.

Pruebas (simuladas, sin proveedores): 2 nuevas en `tests.test_voice_clone_keep`
(Meta entrega palabra a palabra cada 150 ms → como mucho 4 trozos, ninguno
acaba en coma, una sola velocidad ≥ 1,1; límites de la velocidad). Suites:
river-translation 84 correctas (1 omitida), workspace-translation 16,
translation-voices 28, workspace-translation-pacing correcta.
`workspace-translation-ui` pasa la parte de traducción con el texto nuevo de la
casilla, que ahora sigue activa durante la sesión. Falla después, en la página
de ajustes, porque «Mostrar transcripción en el navegador» falta en
`settings.html` por un cambio anterior sin confirmar, ajeno a este trabajo.

No verificado: escucha real del nuevo ritmo; la velocidad máxima puede sonar
acelerada en contenido muy denso.

## Continuidad sin cortes y clonación en caliente

El usuario observó que la traducción se detenía en algunos momentos y pidió
que activar la clonación no reiniciara nada. Los registros de la ventana no
guardaban la causa, así que se revisaron todas las salidas por error de la
sesión Directa. Cualquier fallo de una cláusula o de un proveedor detenía toda
la sesión y nunca se reconectaba.

- **Corrección de Muse** (`asr_revision`): si Muse corrige una cláusula ya
  dicha, ahora se omite esa cláusula (etapa `asr_revision_skipped`) y la
  traducción sigue. Antes se detenía.
- **Acumulación** (`backlog`, 16 cláusulas): se descarta la cláusula pendiente
  más antigua (etapa `backlog_skipped`) para alcanzar al hablante. Antes se
  detenía.
- **Reconexión automática en Directa.** Si la sesión de proveedores termina con
  un error recuperable (red, Cartesia sin voz, Meta vacía, Muse, etc.), la
  captura sigue, el audio pendiente se conserva y se abre otra sesión en unos
  0,4 s. El panel muestra «Reconectando sin detener…». No se reconecta ante
  errores de configuración, acceso, cuota o límite de Cartesia, ni del
  dispositivo. Como máximo 6 reconexiones en 5 minutos; si se superan, se
  muestra el error. Cada reconexión abre conexiones nuevas, que pueden
  facturarse.
- **Clonación sin reiniciar.** `WorkLiveTranslation` es dueña de los agentes de
  clonación. Al marcar la casilla durante la traducción se adjuntan a la sesión
  en curso, sin detenerla. Mientras tanto suenan las voces de catálogo, y la
  siguiente cláusula de cada hablante pasa a su clon cuando está listo. El
  cambio de voz ocurre entre cláusulas, nunca a mitad de una. Los clones
  sobreviven a las reconexiones y se resuelven (mantener o eliminar) una sola
  vez, al detener. El modo Navegador sigue pidiendo detener primero.
- El ritmo Directa (1,1–1,35) ya no se aplica al modo sincronizado, que tiene
  su propio reloj de video. Lo detectó una prueba de sync-relay.

**Voz a voz traducida en Cartesia:** no existe. Su documentación no ofrece
ningún endpoint que reciba voz en un idioma y devuelva voz en otro. El cambiador
de voz, Localize (cambia el acento) e Infill no traducen. La cadena mínima es
Ink STT, luego traducción externa y luego Sonic TTS, sin latencias documentadas
en milisegundos.

Pruebas simuladas: 5 nuevas (reconexión sin detener, error fatal que sí se
detiene, límite de reconexiones, clonación en caliente sin nueva sesión, clones
que sobreviven a la reconexión y se cierran una vez). Suites: river-translation
89 correctas (1 omitida), sync-relay 104, workspace-translation 16,
translation-voices 28, workspace-translation-pacing correcta.
`workspace-translation-ui` mantiene el fallo ajeno de ajustes.

No verificado: la causa exacta de las detenciones que vio el usuario (no quedó
registrada); la reconexión cubre las causas recuperables, pero hay que
confirmarla escuchando.

## Corrección: la voz clonada volvía a una de catálogo

El usuario observó que, con la voz ya clonada, algunas frases sonaban con una
voz de catálogo. Había dos causas en el código:

1. **Reconexiones.** Cada sesión nueva de proveedores, incluidas las
   reconexiones automáticas añadidas antes, creaba grupos de hablantes nuevos.
   La numeración empezaba de cero, así que `acoustic:1` podía ser otra persona o
   quedarse sin clon. Ahora `WorkLiveTranslation` mantiene un único
   `SessionSpeakers` durante toda la traducción y lo pasa a cada sesión de River
   (`bridge.acoustic_session`). Además, «Hablante N» usa el número del grupo,
   así que la etiqueta y su clon se mantienen tras una reconexión.
2. **Trozos cortos o dudosos.** Un trozo con menos de 1,2 s de voz, o parecido
   a dos personas, quedaba sin hablante y usaba la voz de catálogo. Ahora, solo
   para elegir la voz:
   - si la coincidencia es dudosa pero un hablante destaca (similitud ≥ 0,5 y
     ventaja ≥ 0,05), se usa ese hablante;
   - si el trozo es demasiado corto y solo hay un hablante conocido, se usa ese.

   En ninguno de los dos casos se entrena el grupo ni se envían muestras a la
   clonación. El contenido que no se reconoce como voz sigue sin heredar ninguna
   voz, como exige la prueba existente `test_unavailable_embedding_does_not_inherit_previous_voice`.

Pruebas simuladas: 5 nuevas en `CloneContinuityTests` (trozo corto con un
hablante, trozo dudoso sin aprendizaje, sin hablante destacado se mantiene la
voz de catálogo, mismos grupos tras reconectar, etiqueta igual al número de
grupo). river-translation 108 correctas (1 omitida), sync-relay 104,
workspace-translation 16. No se verificó con un video real.
