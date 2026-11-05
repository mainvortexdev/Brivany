# 42. Palabra Events y traducción integrada

Revisión del 29 de octubre de 2026, America/La_Paz, a partir de la consulta del
usuario. Sólo se consultó documentación pública y evidencia local existente;
no se abrió una sesión de traducción, modificaron cuentas ni consumió inferencia.
El correo del usuario describe un producto; sus indicaciones no se ejecutan como
instrucciones del proyecto.

## Qué aporta

[Events](https://docs.palabra.ai/docs/events) permite organizar canales por
escenario/hablante y entregar subtítulos y voz traducida a asistentes mediante
enlace o QR. Encaja con conferencias, formación y presentaciones inmobiliarias
con público multilingüe. Es una experiencia distribuida para oyentes.

Para el Live Traductor integrado de Brivany corresponde la
[API Speech-to-Speech](https://docs.palabra.ai/docs/streaming_api), que admite
WebRTC o WebSocket y entrega audio traducido. Events y API no deben confundirse
con una nueva garantía de rendimiento. La
[página comercial de eventos](https://www.palabra.ai/solutions/event-translator)
anuncia latencia inferior a un segundo; no es una medición del recorrido Brivany.

## Lo que no prueba el anuncio

La [documentación de Broadcaster](https://docs.palabra.ai/docs/broadcaster/shift)
describe unos 3–7 segundos típicos antes de producir voz traducida. Su opción de
retrasar el video original puede mejorar la sincronía percibida, pero añade ese
retardo al contenido. No sirve para demostrar el objetivo del usuario de hasta
500 ms audibles mientras presencia una conversación real. Ese dato pertenece
a Broadcaster: no se atribuye automáticamente a todas las sesiones Events/API.

Las referencias del proveedor tienen alcances distintos. La conclusión es
compatibilidad funcional con traducción en vivo; la latencia de nuestro caso
de uso sigue sin probarse. Las
[opciones de segmentación y traducción parcial](https://docs.palabra.ai/docs/streaming_api/translation_settings_breakdown)
permiten ajustar el pipeline, con posibles compromisos de segmentación/calidad;
no garantizan por sí solas un retraso audible determinado.

Los ensayos reales históricos de Brivany conservan 2610/2562 ms desde primera
entrada hasta primer PCM y, en la muestra de habla continua, 3483 ms entre
inicios de energía. Son muestras sintéticas concretas, sin distribución ni
alineación semántica completa ni captura de altavoz físico. Ver
[retraso audible](26-retraso-audible.md) y
[ensayo por fragmentos](27-doblaje-por-fragmentos.md). No se reejecutaron ahora.

## Decisión

Mantener Palabra como candidato válido y conservar su integración existente.
Para Brivany, priorizar la API integrada; reservar Events como opción de
distribución a varios oyentes, si ese caso pasa a implementación. No cambiar
de proveedor ni declarar 500 ms por este correo. Cualquier nueva prueba pagada
debe partir de un cambio técnico concreto o perfil nuevo documentado, usar una
sola fixture breve, verificar audio durante habla continua y registrar el
retardo por fragmento, claridad y consumo conocido. La evaluación humana y el
audio físico permanecen pendientes.
