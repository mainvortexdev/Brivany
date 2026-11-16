# Brivany Editorial · tipografía oficial

Desde el 15 de noviembre de 2026, por elección del usuario, **Brivany Editorial**
es la familia de la marca: programa, web, promociones, videos, ilustraciones
con texto y guías de Brivany. Sustituye la dirección anterior Georgia/Segoe UI
y el concepto preliminar «briva sans».

- Light 300: titulares amplios y mensajes editoriales.
- Regular 400: lectura, conversación y controles.
- Medium 500: marca, énfasis y acciones. Los antiguos pesos 600–900 de la UI se
  resuelven con este archivo real, sin simular negrita.

La fuente es la del ZIP suministrado, con su nombre original, derivada de Lato
por Łukasz Dziedzic. Se preserva SIL OFL 1.1 y toda la atribución del paquete.
No se presenta como una familia dibujada desde cero. Los tres TTF originales
están intactos en `web/fonts/`; los WOFF2 conservan glifos y métricas, sin recorte
de caracteres. El manifiesto guarda pesos, tamaños y hashes.

`web/typography.css` define los roles de la interfaz. `services/brand.py` ofrece
los recursos para proyectos portables de video. El wordmark usa contornos de
la fuente proporcionada para mantener su aspecto en SVG, imágenes y videos.
Los contenidos de código conservan una fuente monoespaciada funcional y los
caracteres no cubiertos pueden usar una fuente del sistema.

Las piezas nuevas de Brivany usan esta identidad. Las exportaciones anteriores
se conservan como histórico: cambiar un MP4 ya renderizado requiere volver a
renderizarlo. Las marcas de clientes conservan sus kits cuando el encargo pide
su identidad. No alterar la voz seleccionada de Melodi ni sus human-skills.

Preparación reproducible de recursos: `python -m tools.prepare_brand_fonts`
(dependencias de desarrollo en `requirements-brand.txt`). La app distribuida
incluye fuentes ya preparadas y no necesita fonttools ni conexión a un CDN.
La guía actual se genera con `node brand/video/create-guide.mjs` en una carpeta
de exportación nueva, sin sobrescribir las guías históricas.
