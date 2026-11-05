# Aperturas, diagnóstico adaptable y respuestas de Melodi

3 de noviembre de 2026 (America/La_Paz). Los informes con sello 20261104
corresponden a la tarde/noche local del día 3. Mantiene voz/human-skills,
permisos de archivos y protección del registro. No se genera IPA.

## Fallos encontrados y corregidos

La apertura real de Word no había llegado al ejecutor: el enrutador remitía
incluso esa orden sencilla al coordinador, cuyo plan traía criteria como texto
en vez de lista. La corrección anterior del inicio en segundo plano sólo se
había probado con un ejecutable propio; no acreditaba la apertura de Word.
Ahora hay una ruta directa para peticiones explícitas de abrir aplicaciones,
sin observar la pantalla, planificar equipos ni usar inferencia. No reconoce
citas, ejemplos, hipótesis ni acciones compuestas como aperturas simples. Un
cliente anterior que aún remita orchestrator también se corrige en el receptor.
Los planes complejos mal formados tienen una corrección antes de ejecutar.

El chat ignoraba el evento computer_job: mostraba la confirmación y no recogía
el resultado. Ahora sigue tareas locales y de cuenta de forma independiente del
turno de conversación. Entrega respuesta o fallo, permite seguir conversando,
reanuda el seguimiento al volver al módulo y lo limpia al cambiar cuenta/chat.
La consulta exacta del número de procesos obtiene un dato actual de Windows;
el fallo anterior había devuelto documentación sin ejecutar la consulta.
Los resultados grandes conservan su mensaje aunque no quepan todos los detalles
en el paquete de cuenta. Live puede anunciar el resultado en una pausa.

Se elimina la confirmación fija. Las aperturas y consultas inmediatas tienen
variantes breves y relacionadas con su contexto. En las otras tareas el propio
modelo propone una confirmación contextual mediante el argumento acknowledgement
de su llamada existente, sin una inferencia adicional. Ese texto no se guarda
como instrucción de ejecución. Se filtran la frase anterior, confirmaciones
administrativas y afirmaciones de haber terminado antes de ejecutar.

El input de WorkSpace crece verticalmente entre 34 y 136 px, acotado también
por la altura disponible. Oculta su barra de scroll; textos largos siguen
siendo editables con desplazamiento vertical. El panel conserva el máximo de
404 px. No se introduce desplazamiento horizontal.

## Agente de instalación y apertura real

Antes de abrir se despliega un especialista local de descubrimiento. Lee el
catálogo de Inicio, accesos directos y, cuando procede, metadatos del paquete.
Resuelve el nombre observado y su ejecutable; un nombre terminado en .exe debe
coincidir con el ejecutable observado. No sustituye silenciosamente un exe por
una app con etiqueta similar. Los agentes reciben actualizaciones de actividad
para que los encargos breves también puedan aparecer en WorkSpace.

El ejecutor se prepara al arrancar sin tomar el foco ni habilitar entradas.
El catálogo se reutiliza hasta cinco minutos, validando de nuevo el destino al
abrir. Se eliminó la inferencia para elegir coincidencias inequívocas. No se
recorre el disco entero ni se usa el registro para este descubrimiento.

Win32 se inicia con ShellExecuteEx y SW_SHOWMINNOACTIVE. Un inicio confirmado
comprueba el proceso actual, incluso si Office reutiliza una instancia. Las
apps Store tienen activación mediante su identificador instalado; ese adaptador
se compiló y validó, pero no se certificó aquí una apertura real de toda app
Store ni que todas respeten ejecución en segundo plano. Una etiqueta ChatGPT
del catálogo de este equipo tenía un AppID de Codex: no se tomó esa etiqueta
como prueba de que existiera chatgpt.exe ni se abrió Codex para esta prueba.

Prueba real por la cuenta y el host de Brivany: Word inició en 3,797 s desde el
envío, confirmación en 0,468 s; proceso y ventana OpusApp minimizada observados,
foco preservado y sin entrada de teclado/ratón. Word quedó abierto. Cero llamadas
de inferencia para esa apertura. La consulta de procesos terminó en 1,844 s y
su respuesta incluyó el número observado, no una cifra preparada.

## Aprendizaje progresivo de tareas complejas

Las recetas de aplicaciones ya revisadas registran ejecuciones correctas,
consecutivas, reutilizaciones, cambios de interfaz y decisiones ahorradas.
No guardan clientes, cantidades anteriores, contraseñas ni IDs de controles.
Después de dos ejecuciones revisadas compatibles, el planificador puede enlazar
el procedimiento y sus datos NUEVOS una vez. Cada paso vuelve a observar el
proceso, la ventana y un control inequívoco; utiliza sus IDs actuales. Un cambio
de interfaz suspende el atajo y vuelve a la planificación con los pasos ya
realizados, sin repetirlos. Un fallo incierto detiene la ejecución. La revisión
final sigue vigente. Botones sensibles de envío, compra, borrado, instalación o
seguridad no se habilitan como atajos. No modifica código, permisos ni políticas.

Ensayo con la aplicación nativa propia FacturaLab: tres borradores y doce
existencias; una receta aprendida y reutilizada con datos nuevos. La tercera
operación de cuatro pasos necesitó una decisión de planificación frente a cinco
por el recorrido anterior, conservando las observaciones. Entrada nativa real,
planificador/manual/revisión sustituidos. No certifica un programa comercial ni
corrección fiscal ni una reducción universal de tiempo. Los fallos iniciales
se conservan: límite de parent_id para el especialista, PID ausente en la
identidad foreground y un ensayo intermedio detenido después de enfocar.

## Diagnóstico general para preguntas nuevas

Melodi puede componer consultas de Windows en vez de limitarse a respuestas por
frase. El modelo selecciona una fuente, campos, filtros, orden, límite y
agregación; el ejecutor traduce ese plan a comandos de lectura. Se admiten trece
familias: procesos, servicios, conexiones TCP/UDP, adaptadores, volúmenes,
procesadores, memoria física, impresoras, batería, dispositivos, equipo y SO.
Puede ordenar por RAM, contar servicios filtrados o sumar espacio libre, por
ejemplo, sin crear un caso nuevo en código para cada pregunta.

No recibe scripts shell del modelo. Los comandos y propiedades ejecutables
proceden de un catálogo de capacidades; los valores son datos codificados.
Se rechazan registro, comandos mutadores, métodos arbitrarios, campos sensibles
no admitidos y consultas sin límites. Las preguntas de diagnóstico no inspeccionan
IDE/proyectos ni necesitan un equipo de agentes. Para capacidades fuera de esas
fuentes se conserva la vía de otras herramientas o se informa lo que falta;
no se promete resolver cualquier orden ni macOS/Linux sin adaptar su ejecutor.

Pruebas Windows sin proveedores: Get-Process ordenado por memoria, Get-Service
filtrado por arranque/estado con conteo, y Get-CimInstance para espacio libre,
todas correctas. Prueba con Meta REAL: eligió consultas y formuló respuestas
basadas en datos actuales para tres procesos con más RAM y para servicios
automáticos detenidos. Cuatro inferencias conocidas, 11,891 s y 6,703 s de
recorrido completo por pregunta; no son garantías de latencia. Otra prueba
por cuenta, host y WebView2 mostró la respuesta en el panel y la cotejó con la
agregación de Get-Service, con tres inferencias conocidas adicionales.

## Evidencias y consumo conocido

- tmp/quick-actions-real.json: cuenta real, Word y consulta rápida.
- tmp/workspace-chat-ui/account-query-native-report.json: respuesta real en WebView2.
- tmp/workspace-chat-ui/adaptive-query-native-report.json: consulta adaptable por cuenta.
- tmp/adaptive-diagnostics-real.json: planificación/respuestas Meta y hechos Windows.
- tmp/system-diagnostics-native.json: comandos reales sin inferencia.
- application-learning-native-20261103T235845-32329bd3: procedimiento nativo reutilizado.
- computer-20261104T001836-4f23769f: 32 pruebas.
- computer-native-20261104T001543-18449655: 34 pruebas de ejecutor.
- terminal-20261104T001543-d106c6db: 44 pruebas.
- system-diagnostics-20261104T001652-7e77345a: catálogo y composición.
- workspace-chat-ui-20261104T000440-66ef688f: input y resultado final en UI.
- workspace-chat-native-20261104T002958-5e1f77d4: puente y estrés nativo.
- work-20261104T002831-61446bc0: 39 pruebas.
- account-host-20261104T002831-20904808: 11 pruebas.

Antes de la última ampliación del aviso glass: 7 inferencias Meta conocidas,
13 solicitudes de cuenta para Word/conteo, 3 para el chat nativo y 10 para el
ensayo adaptable nativo. El primer arnés nativo de cuenta falló por adaptar mal
la firma del método, sin contador completado: su consumo no se deduce como cero.
Los ensayos con sustitutos no usan proveedores; sus contadores de decisiones no
son solicitudes facturadas. Importe monetario y peticiones internas de despliegue
no medidos. No se guardan conversaciones, claves ni audio original en desarrollo.

Fuentes primarias: ShellExecuteExW, IApplicationActivationManager y Get-Process
en Microsoft Learn; CLI local Wrangler 4.156.0 y su ayuda de deploy. La publicación
vigente se registra con el cierre final de pruebas.

## Aviso glass con chat cerrado y cierre final

Si llega una respuesta con el chat cerrado, aparece debajo de Melodi un aviso
sin botones ni título, hasta tres líneas y 80 px de alto; ancho preferido 420 px,
acotado al monitor. Permanece entre 8 y 16 segundos según longitud, se actualiza
con el texto entrante, sale suavemente y no intercepta clics de otras apps.
La respuesta completa permanece en el chat. Abrir un panel suprime el aviso.
Live continúa; el aviso sustituye temporalmente las ondas en esa superficie
visual y éstas vuelven después. No se captura pantalla ni audio para el aviso.

Corrección motivada por el usuario: el compositor aplicaba el backdrop a la
ventana grande aunque sólo su región y tarjeta parecieran pequeñas. Las pruebas
anteriores no medían ese HWND y no detectaron el defecto. Ahora reply y result
usan ventanas físicamente compactas; el backdrop cambia con la superficie oculta
y se restaura antes de volver a las ondas. La prueba real posterior confirmó
viewport 420x80, ventana tool/click-through, material glass, respuesta con chat
cerrado y conservación al reabrir. No se considera suficiente el recorte CSS.

Evidencias finales:

- workspace-chat-ui-20261104T003131-6feaaacc: cinco anchos, tres líneas, input
  adaptable y respuesta final; captura propia reply-preview-glass-390.png.
- workspace-chat-native-20261104T003702-7ea0839e: puente tras compactar glass.
- workspace-chat-20261104T003702-ae80b6ce: seis pruebas, incluido tamaño físico.
- work-20261104T003702-69551b8e: 39 pruebas.
- computer-20261104T003806-9e2802fe: 32 pruebas.
- mobile-gateway-20261104T002958-765fe6be: 34 pruebas y confirmación contextual.
- tmp/workspace-chat-ui/closed-reply-native-report.json: consulta real, chat
  cerrado, viewport físico 420x80 y reapertura conservando respuesta.
- tmp/quick-actions-failures.json: retrospectiva explícita de fallos conservados.

El modelo tiene un campo de confirmación natural y relacionada con el pedido en
su llamada existente. La vía rápida varía frases como «Dame un segundo, reviso
los procesos». Se filtran «Claro, lo haré» y «De acuerdo, me encargo» como
confirmaciones nuevas. Las conversaciones anteriores no se reescriben.

Consumo adicional final: tres inferencias conocidas para el ensayo adaptable con
aviso cerrado (10 inferencias Meta conocidas de prueba en esta entrega), siete
solicitudes de cuenta en ese ensayo y tres más en el cierre físico sin inferencia.
Son 36 solicitudes de cuenta contadas en estos ensayos, además de cuatro Meta
directas y seis realizadas por servicios/host. No incluyen tráfico interno de
despliegue ni el intento sin contador completo. Importe monetario desconocido.
Sin micrófono nuevo ni IPA.

Gateway publicado: 4863abca-84bd-4ae0-ae65-135bdbe6f624.

Fuentes: [ShellExecuteExW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecuteexw),
[ActivateApplication](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iapplicationactivationmanager-activateapplication),
[Get-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/get-process?view=powershell-5.1).
