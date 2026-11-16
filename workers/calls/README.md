# Llamadas de Melodi desde la nube

Servicio canónico para programar llamadas por WhatsApp y realizarlas por Telnyx
con la voz exacta de Melodi en Cartesia. Alarmas SQL conservan el horario con el
PC apagado. Las acciones en el ordenador requieren Brivany abierta y su vínculo
habilitado. La primera activación se limita al titular original y su número.

Desde la raíz, con las dependencias de `workers/whatsapp`:

```powershell
.\workers\whatsapp\node_modules\.bin\wrangler.cmd deploy --dry-run --config workers/calls/wrangler.jsonc --outdir .wrangler-melodi-build
.\.venv\Scripts\python.exe -X utf8 -B -m tools.verify telephony-cloud
```

La suite usa workerd y proveedores sustituidos: no marca ni consulta proveedores.
`check-live.mjs` comprueba servicios mediante lecturas administrativas.
Los diagnósticos funcionales reales están separados y reservan su ejecución para
evitar reintentos de pago. `real-call-test.mjs --dial-once` requiere autorización
expresa y comprobaciones previas válidas; su identidad durable impide remarcar
el mismo ensayo. Nunca se ejecuta desde `tools.verify`.

Los secretos se conservan en Cloudflare. `tools.configure_cloud_calls` reutiliza
la configuración existente y protege el respaldo de cifrado con DPAPI. Las
publicaciones posteriores usan `cloudflare-release.mjs` con instantánea nueva
para conservar bindings, secretos y recursos existentes.

[Implementación, pruebas y límites](../../docs/melodi-llamadas-cloud-20261114.md).
