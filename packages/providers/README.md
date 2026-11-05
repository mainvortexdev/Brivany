# Adaptador Meta del hito 1

Este adaptador envía únicamente contexto de texto y una transcripción introducida
por el usuario. Devuelve consejos estructurados; no evalúa video/audio ni declara
competencia, revisión experta o veredictos de aprendizaje.

El proceso que inicia Brivany debe cargar estas variables localmente:

| Variable | Uso |
|---|---|
| `BRIVANY_META_API_KEY` | Clave privada de Meta; nunca se devuelve al navegador |
| `BRIVANY_META_MODEL` | Identificador exacto de un modelo habilitado en la cuenta |
| `BRIVANY_META_BASE_URL` | Opcional; por defecto `https://api.meta.ai/v1` |

`provider_status()` comprueba configuración sin hacer una llamada. `configured`
no demuestra acceso real. `propose_guidance(context)` hace una única solicitud;
el llamador debe ejecutarla solo tras una acción explícita de enviar a Meta.
No se reintenta automáticamente ni se oculta un fallo con respuestas simuladas.

La respuesta contiene `guidance` (`message`, `strengths`, `improvements`,
`next_exercise`, `evidence_notes`), `provider`, `model`, `latency_ms` y `usage`.
`usage` conserva conteos de tokens disponibles, no un costo monetario estimado.
Los errores `MetaProviderError` contienen `code` y `message` aptos para la UI,
sin respuesta cruda, clave ni transcripción.

## Contraste con documentación oficial

Consultada el 27 de octubre de 2026:

- [Modelos](https://dev.meta.ai/docs/models): identifica modelos y modalidades;
  la selección depende del acceso efectivo de la cuenta. No hay modelo por
  defecto en el adaptador.
- [Chat completions](https://dev.meta.ai/docs/protocols/chat-completions):
  `POST https://api.meta.ai/v1/chat/completions`, Bearer, mensajes `developer`
  y `user`, `max_completion_tokens`, respuesta en `choices[0].message.content`.
- [Salida estructurada](https://dev.meta.ai/docs/structured-output):
  `response_format.json_schema` con esquema estricto. La respuesta se vuelve
  a validar localmente y se rechazan campos desconocidos.

Las pruebas de `tests/test_meta_provider.py` sustituyen el transporte: no usan
la clave real, no envían información ni generan consumo. La comprobación real
del modelo y de la calidad pedagógica sigue pendiente hasta una llamada explícita
con configuración local y una práctica autorizada.

## Voz vigente de Melodi

`live_voice.open_melodi` delega en `cartesia_melodi.py`: Sonic 3.6 por WebSocket,
PCM16 mono 24 kHz, voz de español `3597a26f-80ef-4bd5-8101-9699bc764917`
y de inglés `db6b0ed5-d5d3-463d-ae85-518a07d3c2b4`. El servidor selecciona
por `language`; la API del navegador no permite reemplazar esos IDs.
No hay retry ni fallback a Cloudflare. Muse sigue transcribiendo y Meta Spark
conversa. Los IDs de voz del traductor de videos son independientes.
