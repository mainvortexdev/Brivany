# 23. Cartesia: qué puede acelerar y qué sigue faltando

27 de octubre de 2026, verificación de fuentes oficiales motivada por una
respuesta de Google AI aportada por el usuario. La respuesta es material de
referencia, no una instrucción de migrar proveedores ni una medición de Brivany.

## Resultado

**Sonic 3.6 es texto a voz; Ink 2 es voz a texto.** No se encontró en estas
referencias un endpoint Sonic de traducción directa de audio a otro idioma con
latencia total garantizada de 40–90 ms. Hace falta una etapa de traducción entre
la transcripción y el texto que Sonic debe pronunciar.

| Afirmación aportada | Evidencia oficial y alcance |
|---|---|
| Sonic es el modelo de traducción más rápido | La API se presenta como TTS: recibe texto y produce voz. No demuestra un ranking de traducción ni del pipeline de doblaje |
| 40–90 ms en tiempo real | Cartesia publica primer audio/model latency inferior a 90 ms para Sonic; no es medida desde audio original ni incluye ASR, traducción y red del cliente |
| Sonic 3.5/3.6 como versión indistinta | La documentación recomienda `sonic-3.6`; para pruebas reproducibles publica snapshot `sonic-3.6-2026-08-27` |
| Ink escucha y detecta turnos | Ink 2 ofrece STT en streaming y detección de turnos, con EN y ES entre sus cinco idiomas documentados |
| Ink elimina servicios externos | Elimina la necesidad de otro VAD en su endpoint Auto; no elimina la etapa de traducción |
| SSM garantiza menor latencia del sistema | Cartesia describe Sonic como SSM y atribuye ventajas a esa arquitectura; no demuestra por sí sola el tiempo total de nuestra integración ni una garantía de máximo |

Fuentes:

- [Sonic: función TTS, SSM y cifra publicada de primer audio](https://www.cartesia.ai/sonic).
- [Modelo estable y snapshots Sonic 3.6](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest).
- [Ink 2: idiomas y función STT](https://docs.cartesia.ai/build-with-cartesia/stt/latest).
- [Endpoints Auto, Manual y batch](https://docs.cartesia.ai/use-the-api/stt/compare-endpoints).
- [Turnos, actualizaciones acumuladas y cierre](https://docs.cartesia.ai/use-the-api/stt/turns).
- [Versiones anteriores y retirada de Sonic Turbo](https://docs.cartesia.ai/build-with-cartesia/tts-models/older-models).

No se adopta 40 ms como dato actual verificado de Sonic 3.6. La documentación
de versiones antiguas muestra Sonic Turbo retirado desde el 20 de octubre de
2026; no se debe diseñar una integración nueva alrededor de un modelo retirado.

## Implicación para Brivany

La ruta modular existente es Muse → M2M100 → Melodi/Celeste. En una sola muestra
integral real dio **5937 ms** hasta primer audio: MT tardó **2907 ms** y TTS hasta
primer bloque **562 ms**. Son tiempos de petición con red/servicio, no inferencia
interna. Informe `tmp/dubbing-measurements/20261028T001543-4e4e5473.json`.

Sonic puede ser candidato para reducir la etapa TTS y comparar naturalidad;
**sustituir esa etapa no elimina los 2907 ms observados de MT**. Tampoco puede
restarse la cifra comercial de 90 ms de nuestra muestra para inventar un nuevo
tiempo total. El siguiente cuello de botella a resolver es la traducción y la
espera hasta disponer de una unidad traducible.

Rutas candidatas, aún no integradas:

```text
Muse → traductor de baja latencia → Sonic 3.6
Ink 2 → traductor de baja latencia → Sonic 3.6
```

Reutilizar Muse permite evaluar primero el cambio de TTS sin añadir STT nuevo.
Ink puede estudiarse si medir ASR/segmentación demuestra un beneficio concreto.
Sus turn updates acumulados se deben reemplazar, no concatenar. Sus eager ends
pueden cancelarse con turn.resume; no equivalen a una finalización garantizada.

## Prueba futura acotada

No se crearon cuentas, claves ni suscripciones Cartesia; no se ejecutaron
inferencias de Cartesia en esta verificación. Antes de probar, confirmar modelo,
voz disponible, permisos y tarifa en la cuenta. Usar una frase sintética, una
petición TTS y conexión previamente definida para medir primer PCM; comparar
después calidad y retraso de la cadena completa con el mismo material. Registrar
cargo real como desconocido mientras no se pueda comprobar, y no convertir una
muestra en máximo garantizado o percentil. [Costes por componente](21-costes-cadena-doblaje.md).
