# Referencia compartida de avances del ecosistema

Corte: 17 de octubre de 2026. Entrega solicitada por el propietario: dos informes completos, uno de productos Cognira y otro de webs Vetsa/Cognira, y su incorporación al conocimiento de Melodi y el equipo.

## Entregables y procedencia

- Productos: 15 páginas. Documento canónico `01-cognira-productos-avances-2026-10-17.md`; SHA-256 `8d08a5a8ba027510ed241335e52b148f2a7855b629809c46187cad325f6c0567`.
- Webs: 12 páginas. Documento canónico `02-vetsa-cognira-webs-avances-2026-10-17.md`; SHA-256 `97ca7ba85c34887000c89f7d16702e3d1343e49178c96918d6f492ab5f303073`.
- Los PDF y Markdown permanecen en el directorio local `cognira-desktop/output/`; los PDF fueron renderizados y revisados visualmente. Los informes contienen fuentes, funciones, integraciones, evidencias, límites y pendientes. No se publicaron como documentos públicos.
- PDF de productos: 91.971 bytes, SHA-256 `77d5b547ed18b4b84c7e1f1dec8915cbe4036f3ad68e4e45c65fe3bfb7acabfe`.
- PDF de webs: 81.636 bytes, SHA-256 `f1c87223a7cc2a6e380214fba4e383d0a03ff1fe79fbc1011a40a492c368bb26`.

## Incorporación real

Los PDF se guardaron en el almacén privado existente de documentos del propietario y se verificaron leyendo sus bytes de R2 y comparando su huella. Las referencias cifradas completas se guardaron en `wa_ecosystem_report_knowledge`, bajo el mismo propietario y los identificadores `products` y `webs`. Cada entrada conserva fecha, título, fuente y SHA-256; solo el publicador de confianza puede escribirla. No hay una herramienta de escritura disponible para el modelo.

`ownerAutonomyServices().ecosystemReportContext()` incorpora extractos relevantes a la conversación del propietario y a los encargos de agentes sobre Vetsa/Cognira. Melodi, Melodi, Melodi, Melodi y la interlocución de Melodi consultan la misma edición. Esto no actualiza el ejecutable instalado de Desktop ni el PC de Melodi. Los chats públicos, otros propietarios y los asuntos no relacionados no reciben estos informes.

Los extractos tienen límite de tamaño, conservan encabezados y negaciones, advierten de cobertura parcial y tratan instrucciones incrustadas como datos. La selección diferencia productos de webs y conserva la introducción del informe de productos. Los informes fechados prevalecen sobre descripciones antiguas del chat, proyectos y calendario. Una fecha objetivo no es una función terminada; la concurrencia de Desktop no se atribuye al binario independiente de Remote Host.

La lectura de producción se comprobó con los modelos reales de las cinco interlocutoras, mediante un enlace de servicio temporal sin endpoint HTTP público. Las respuestas finales citaron el corte del 17 de octubre, la distribución privada, la independencia de Remote Host y límites pendientes. La primera lectura detectó atribuciones equivocadas a Remote Host y una fecha de Edits recuperada de memoria antigua; se reforzó la prioridad de los informes y la segunda lectura ya conservó esas distinciones. No es una garantía de que ninguna respuesta futura pueda equivocarse.

No se enviaron mensajes de WhatsApp ni correos para estas pruebas. La incorporación al almacén y al contexto es la entrega interna solicitada. Una revisión anterior del PDF web quedó marcada `superseded`, para que el buscador de documentos conserve la edición final.

## Verificación

- Almacén de informes: diez pruebas de cifrado, integridad, aislamiento, revisión, idempotencia y selección de contexto.
- Integración: las cinco interlocutoras reciben la referencia del mismo propietario; el chat público y los temas no relacionados no la reciben.
- Suite integrada: 820 casos, 801 aprobados, 19 omitidos, cero fallos. Son casos solapados con tandas anteriores, no se suman.
- Evidencias privadas en `benchmarks/ecosystem-reports-published-2026-10-17.json`, `ecosystem-reports-agent-readback-final-2026-10-17.json` y `whatsapp-integrated-reports-2026-10-17.log`.
- El punto de entrada temporal de diagnóstico/publicación se retiró de las fuentes y del despliegue final.

El objetivo más amplio de autonomía por WhatsApp sigue separado de esta entrega de informes. No se afirma un cierre de la edición WhatsApp–Melodi–Edits–Drive ni de pendientes externos como DNSSEC, IAM o revisión sensible de Google.
