# Búsqueda rápida y procedencia bajo petición

3 de noviembre de 2026. Corrección posterior a la comprobación de 32,97 s:
el usuario pide reducir la espera y retirar las citas de la conversación normal.

Las consultas públicas breves reconocidas pasan directamente a un agente de
búsqueda. No necesitan una llamada para clasificar, otra para planificar ni una
tercera para revisar la redacción. Meta recibe una sola petición Responses con
web_search, contexto bajo y razonamiento mínimo. Se comprueban la búsqueda
real completada y una respuesta final completa; no se admite texto del modelo
como sustituto de una búsqueda que no ocurrió. Las preguntas complejas y las
operaciones de programas conservan su recorrido general.

Las citas y enlaces de investigación no aparecen en la respuesta habitual.
La procedencia devuelta por la búsqueda queda asociada al mensaje de esa sesión.
Preguntar «¿De dónde sacaste esa información?» muestra las páginas conservadas,
sin volver a llamar al modelo. Si el proveedor no devuelve enlaces, Melodi lo
indica y no los inventa. Las páginas recuperadas por el buscador no equivalen a
una atribución comprobada de cada frase. Los enlaces se filtran y se abren sólo
al pulsarlos. La memoria del chat se borra al limpiar la conversación o cambiar
de cuenta; no se convierte en historial permanente entre cuentas.

La ruta rápida no abre páginas adicionales para obtener citas. Los informes de
investigación que sí lo requieren mantienen su verificación más extensa. El
host comprueba resultados activos cada 100 ms mediante una espera local del
socket; esto no añade llamadas al proveedor ni sondeos HTTP.

Pruebas locales: computer 33, orchestration 30, mobile-gateway 35, account-host
11 y workspace-chat 7, todas aprobadas. La prueba de interfaz verificó respuesta
sin fuentes visibles, consulta posterior de procedencia, apertura voluntaria,
rechazo de javascript y que esa consulta posterior no llamara al modelo.
Conservados los primeros fallos del parser y del selector de la propia prueba.

Comprobaciones reales sin caché:

| Recorrido | Tiempo |
| --- | ---: |
| Meta directamente, consulta de clima | 4,453 s |
| Cuenta → escritorio → resultado, clima | 5,828 s |
| Cuenta → escritorio → resultado, documentación Python | 4,781 s |
| Repetición de clima tras reducir espera local del host | 5,985 s |

Cada consulta final utilizó una llamada a Meta y conservó cuatro fuentes. Los
acuses por cuenta tardaron 0,187–0,515 s. Estos ensayos acreditan una reducción
de 32,97 s a aproximadamente 5–6 s, no un máximo garantizado de cinco segundos.
La variación del proveedor sigue presente. No se sustituye una respuesta por
datos antiguos para mejorar la medición ni se considera el acuse como respuesta.

Durante el desarrollo hubo dos sondeos previos de Meta (3,922 y 6,109 s), una
prueba alternativa de Gemini rechazada con HTTP 404 y las cuatro consultas
finales de Meta descritas arriba: seis solicitudes Meta y una solicitud Gemini
conocidas. Las tres pruebas por cuenta realizaron 40 solicitudes a ese servicio,
incluidos sus sondeos. El coste monetario y las operaciones internas del
buscador no fueron medidos. No se guardaron conversaciones, tokens ni audio
en los informes de evidencia.

Gateway publicado: `27c7e5aa-f407-43e9-b25e-f312565c9159`.
Brivany reiniciado con WorkSpace para cargar los cambios.
