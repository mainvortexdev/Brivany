# Spaik y el equipo en WhatsApp

El Worker de Vetsa comparte un número de WhatsApp. Spaik Pro interpreta el
mensaje y asigna un agente; nunca redacta la respuesta visible. Las cinco
identidades responden con Spaik Flash. `wa_melodi_state` conserva el hilo
general de Melodi o Melodi; Melodi, Melodi y Melodi se asignan por petición sin alterar
esa tabla, que todavía restringe los valores a Melodi y Melodi.
El webhook valida la firma y entrega el evento a `MELODI_JOBS`; el consumidor de
la cola procesa el mensaje para que un fallback lento de NVIDIA NIM no agote
el plazo de `waitUntil` del webhook.

| Agente | Modelo habitual | Trabajo principal |
| --- | --- | --- |
| Melodi | Spaik Flash | Conversación creativa, transcripción, traducción, imágenes y redes sociales. |
| Melodi | Spaik Flash | Documentos, cotizaciones, facturas, informes, guías, agenda y preparación. |
| Melodi | Spaik Flash | Investigación de tendencias y perfiles públicos. |
| Melodi | Spaik Flash | Métricas de cuentas propias conectadas. |
| Melodi | Spaik Flash | Comandos, estado y capturas del PC vinculado. |

Spaik Pro mantiene el papel de coordinador incluso ante una petición de máximo
enfoque; usa DeepSeek V4.1 Flash en SiliconFlow y el mismo modelo en NVIDIA
NIM si SiliconFlow falla. El agente asignado sigue hablando con Spaik Flash.
Spaik Sight analiza imágenes y pantallas, y los motores especializados producen
los medios.

Antes de ejecutar un recordatorio o una orden para el PC, una segunda decisión
semántica comprueba qué acción pidió Daniel. Mencionar Cognira o Melodi como tema
de un recordatorio no activa el puente de escritorio. La decisión devuelve la
hora local y la tarea del recordatorio, o confirma que se pidió una acción
inmediata sobre el PC. Una hora ya vencida sin fecha futura se aclara antes de
guardar nada. Un comando para Melodi requiere acuerdo entre las dos decisiones.
Si esta comprobación falla, no se ejecuta la acción.

Las instrucciones de personalidad están en `melodi-system.js`. Permiten
expresividad y discrepancia razonada, pero requieren precisión sobre acciones,
recuerdos y datos verificados. La memoria existente se comparte entre las dos;
no equivale a recordar cada mensaje de manera perfecta.

Para recordatorios, la IA interpreta fecha y hora local. `event-time.js` valida
esa interpretación y la convierte a UTC antes de guardarla. La confirmación y
el briefing vuelven a mostrar la hora en `TIME_ZONE`. Si falta una hora local
inequívoca, el sistema pide aclaración. Una duración relativa se calcula desde
la hora actual. Los recordatorios ya vencidos no se modifican retroactivamente.

Melodi puede leer de D1 los próximos eventos y el estado de trabajos pendientes
o fallidos al preparar reportes. Los títulos de eventos son datos privados y no
instrucciones para el modelo. Su trabajo documental mantiene la entrega por
archivo del flujo existente; los documentos generales usan DOCX por defecto,
las cotizaciones y facturas usan PDF.

La infraestructura de Instagram existente admite mensajes y operaciones
configuradas. No hay en este Worker una capacidad verificada para detectar
intrusiones de cuenta o borrar automáticamente cualquier actividad sospechosa.
La personalidad de Melodi exige comprobar una señal y el resultado de una acción
antes de decir que corrigió o eliminó algo.

## Conocimiento del ecosistema

`vetsa-knowledge.js` contiene un catálogo revisado de servicios, modelos y
contactos verificables. Se contrasta con las rutas realmente implementadas de
la API: un identificador anunciado no se presenta como una capacidad operativa
si su ruta devuelve «no implementado». Ambas asistentes reciben el mismo
catálogo en conversaciones con el propietario. Los correos personales del
propietario no se ofrecen en conversaciones públicas.

Si Daniel facilita la URL de una página pública permitida de Vetsa o Wisly,
el Worker puede extraer de ella direcciones de correo y enlaces públicos de
WhatsApp. No sigue redirecciones, no envía el HTML al modelo, limita el tamaño
de descarga y no accede a páginas autenticadas ni a buzones para este fin.
Las páginas nuevas no se descubren automáticamente: hay que proporcionar su
URL o agregar una fuente verificada al catálogo. Un contacto publicado no
implica acceso a su correo ni autorización para leer mensajes.

Las respuestas de WhatsApp tienen una última comprobación que impide divulgar
nombres de proveedores o motores subyacentes de modelos Vetsa. La base de
conocimiento no incluye secretos, conversaciones, contraseñas ni datos de pago.
Si una capacidad o contacto no está verificado, Melodi y Melodi deben decirlo.

## Proyectos compartidos

Daniel puede pedirle a cualquiera de las dos que registre un avance concreto,
consultar el estado de un proyecto o pedir la lista de proyectos. Ambas ven el
mismo registro, con estado y siguiente paso solo cuando el dueño lo ha indicado.
Contar una novedad, describir un avance o agradecer es conversación y recibe una
respuesta contextual; no escribe en el registro. La clasificación de estas
peticiones es semántica y usa los ID de proyectos existentes.

`wa_owner_projects` y `wa_owner_project_updates` conservan las fichas y el
historial con cifrado AES-GCM usando la clave privada de memoria ya configurada.
El teléfono del dueño y las fechas quedan como metadatos para control de acceso
y ordenación; nombres, notas, pasos y estados se guardan cifrados. Los avances
textuales se conservan tal como fueron enviados, salvo enmascaramiento de
credenciales, códigos y números de tarjeta. Un adjunto incluido con un avance
queda archivado como referencia; el resumen indica su existencia. El registro
está disponible solo tras la verificación del número propietario de WhatsApp.
