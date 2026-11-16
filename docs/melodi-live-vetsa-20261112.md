# Live de Melodi: turnos de Vetsa, variedad y ejecutor reparado

12 de noviembre de 2026. Continuación y corrección de la entrega
[Melodi centrada en voz](melodi-voz-central-20261112.md), por los problemas de
espera y ejecución comunicados por el usuario. La instalación local ya contiene
los cambios y reinició normalmente, con historial disponible y ejecutor activo.

## Referencia y causas

Se leyó, sin modificar, `C:\Users\felix\Documents\GitHub\Vetsa App`.
La referencia de comportamiento procede de `preview/live-microphone.mjs`,
`preview/voice-conversation.mjs`, `ios/Vetsa/VetsaLiveCore.swift`,
`ios/Vetsa/VetsaLiveSession.swift` e `ios/Vetsa/VetsaLiveStreaming.swift`.
Se conserva este crédito en la adaptación. Brivany mantiene Muse, Meta y las
voces existentes de Melodi en Cartesia; el chat escrito conserva su proveedor.
La documentación local de Vetsa describe Spaik V1 con Llama 3.2 3B para Live.
Se trasladan sus reglas de conversación y streaming a la cadena configurada de
Brivany; no se deduce de ello que dos proveedores tengan la misma latencia.

Se encontraron cuatro problemas en la cadena de voz:

1. El chat sólo enviaba un turno después del final remoto de Muse, aunque ya
   dispusiera de una transcripción parcial utilizable y una pausa del usuario.
2. Cada conversación pasaba primero por una inferencia de clasificación y luego
   por otra de respuesta. Además se incluía el catálogo completo de herramientas.
3. `MelodiOutput.speak()` devolvía `true` antes de consumir el modelo y el audio.
   El `finally` del chat podía quitar la respuesta vacía y perder su controlador
   mientras la generación seguía trabajando.
4. El consumidor de texto esperaba al audio de una frase antes de seguir leyendo
   las siguientes. La suspensión del micrófono se vinculaba también a la espera
   de síntesis, dificultando interrumpir durante la preparación.

El rechazo de la tarea tenía otra causa comprobada: la app instalada informaba
`runtime.available: false`, `source_mode: development` y
`source_lock_matches: false`. No había un paquete seleccionado en los datos de
usuario y la ruta de desarrollo relativa a la instalación no tenía el backend
verificado. El mensaje genérico ocultaba esa diferencia.

## Cambios implementados

El ensamblador local adapta las reglas de Vetsa: 0,8 s para una pregunta estable
con puntuación explícita, 1,6 s para otros fragmentos estables y 1,9 s para
parciales. Repetir la misma transcripción no amplía el plazo. Los conectores
incompletos esperan continuación; una nueva señal de habla cancela el cierre
pendiente. Los fragmentos de Muse se agrupan por identidad y se conservan entre
segmentos. Los finales tardíos no repiten un turno enviado; se admite una
continuación acumulativa aunque cambien mayúsculas o puntuación.

La conversación ordinaria de voz usa directamente la respuesta. Los pedidos de
herramientas, recursos, cambios o acciones conservan el clasificador semántico y
sus autorizaciones. El contexto Live conserva trabajos, esperas y human-skill
activa, con un catálogo breve. No se concede acceso a una herramienta por usar
el camino rápido. La respuesta habitual queda acotada a 256 tokens y 1.800
caracteres, con los límites explícitos de cada habilidad cuando corresponden.

La primera frase de al menos doce caracteres puede sintetizarse mientras llega
el resto. Para texto sin puntuación se admite una separación por palabra al
alcanzar 140 caracteres, cerca del carácter 120. Se preparan hasta dos primeros
fragmentos y un resto final: un máximo de tres síntesis por respuesta, concurrentes
y reproducidas en orden. El servidor permite esos tres contextos sólo para el
mismo identificador Live y mantiene un único propietario de la salida.

La operación de voz devuelve una promesa hasta acabar o cancelar. El chat conserva
el texto realmente generado y puede abortar la cadena completa. El micrófono
permanece disponible mientras se prepara la respuesta; la supresión de eco se
aplica durante reproducción. Las nuevas intervenciones pueden interrumpir la
preparación y la salida. WorkSpace recibe por separado preparación y reproducción
real, para que su estado de habla no se encienda al esperar al modelo.

### Variedad de muletillas y escucha

Se prepararon dieciséis señales breves en español con la voz existente de Melodi:
Ajá, Entiendo, Bien, Claro, Ya veo, Te escucho, Continúa, Te sigo, Ya entiendo,
Mmm, Sí, Cuéntame, Adelante, Aquí estoy, Sigo aquí y De acuerdo.

El banco se mezcla sin repetir hasta agotarlo y evita repetir el último elemento
al mezclar otra vez. Ante ciertas expresiones de dolor o preocupación se eligen
señales neutrales. La primera señal requiere ocho segundos y al menos ocho
palabras; las posteriores se separan catorce segundos y requieren texto reciente.
Se reproducen a volumen reducido, sin silenciar al usuario, sin abrir otro
micrófono ni añadir mensajes al historial. Terminar el turno o cerrar cancela
la señal. Se filtra durante 1,8 s un posible eco textual de la señal seleccionada.

Las respuestas tienen además una guía abierta con veintinueve ejemplos de
muletillas, adaptadas al contexto y al historial. No establece una cuota ni
limita el vocabulario a esos ejemplos. La expresión se integra en una frase útil
y se pide evitar repetir el inicio anterior o celebrar ante un relato serio.

Los PCM fijos quedan en los datos locales de la instalación. Las peticiones GET
de señales sólo leen ese banco y nunca generan audio. Se conservaron las tres
primeras muestras al ampliar a dieciséis: trece solicitudes adicionales, sin
regenerar las existentes. No se incluyeron PCM ni audio del usuario en la bitácora.

### Reparación de tareas

Se construyó y seleccionó un paquete local con 104 archivos permitidos y
verificados del Cognira existente. Sus locks coinciden con los de la instalación;
se conservaron sus avisos y créditos. No se copiaron credenciales ni perfiles.
Una instancia propia del ejecutor recibió correctamente el sondeo nativo, sin
acciones de entrada ni reproducción de la orden original.

Un backend no disponible produce ahora HTTP 503 con un código y explicación
específicos. La preparación refresca la autorización nativa antes de ejecutar
el ticket y no reintenta el POST de ejecución automáticamente.

## Pruebas

- `javascript`: 61 pruebas aprobadas, incluidos plazos Vetsa, fragmentos tardíos,
  variedad sin repeticiones, sensibilidad del banco, cancelación y síntesis paralela.
  `tmp/verification/javascript-20261112T155922-6f249be2.json`.
- `melodi-cartesia`: 30 pruebas aprobadas de protocolo, HTTP, conversación e identidad.
  `tmp/verification/melodi-cartesia-20261112T155922-fc5b8613.json`.
- `live-conversation`: diez pruebas aprobadas: camino de conversación directo,
  pedidos de herramientas conservados, human-skill activa, error del ejecutor,
  propiedad de salida, cierre de streaming y señales locales sin proveedor.
  `tmp/verification/live-conversation-20261112T161048-2ef4b845.json`.
- `computer`: 34 pruebas aprobadas. Se corrigió el helper de espera del banco
  para aguardar la finalización de recibos/exportación antes de borrar sus
  temporales. El estado terminal se publicaba antes de terminar esa escritura.
  `tmp/verification/computer-20261112T160916-529ef094.json`.
- `computer-bundle`: 17 casos, uno omitido por permiso de enlaces de Windows.
  `tmp/verification/computer-bundle-20261112T160629-0740f452.json`.
- `installed-backend-native`: sondeo real con Electron fijado, en proceso propio,
  sin entrada ni proveedores. `tmp/verification/installed-backend-native-20261112T160106-9fca700d.json`.
- `chat-voice-ui`: Edge y WebAudio reales, micrófono y proveedores sustituidos.
  Verifica cierre local sin final Muse, entrada disponible mientras piensa,
  separación del estado publicado a WorkSpace, respuesta conservada, interrupción,
  señal de escucha con reloj acelerado sin generar turno, geometría y ondas.
  `tmp/verification/chat-voice-ui-20261112T161107-2257057b.json`.
- Regresión de historial: `tmp/chat-history-ui/report.json` aprobada.

Los fallos iniciales de los bancos permanecen registrados: un doble de PCM sin
el método `cancel`, un encabezado Origin ausente en el cliente HTTP de prueba,
la selección incorrecta de la ventana donde se publicaban los booleanos y la
carrera de limpieza de temporales. La clasificación rápida se ajustó al detectar
que la palabra «cambia» dentro de una explicación se trataba como una acción.

## Mediciones reales y consumo

Se usaron preguntas sintéticas, sin micrófono, conversaciones personales ni
archivos de audio conservados. Los tiempos parten del envío del texto ya
ensamblado: no incluyen detección de pausa, ASR ni salida del altavoz.

| Ensayo | Inferencias | Síntesis | Primer texto | Primer PCM con señal de la primera frase |
| --- | ---: | ---: | ---: | ---: |
| Flujo anterior, una pregunta explicativa | 2 | 1 | 6.032 ms | 7.235 ms |
| Flujo corregido, misma pregunta | 1 | 1 | 1.281 ms | 2.375 ms |
| Flujo final, tres frases solicitadas | 1 | 3 simultáneas | 3.875 ms | 5.062 ms |

Informes: `tmp/live-behavior-before-20261112.json`,
`tmp/live-behavior-after-20261112.json` y
`tmp/live-behavior-after-pipeline-20261112.json`. El último ensayo verifica
la concurrencia de tres contextos reales de Cartesia y usa una pregunta distinta.
Las muestras muestran variación del proveedor; no prueban una garantía de 2,4 s,
igualdad de latencia con Vetsa ni conversación física completa.

Se confirmaron nueve solicitudes de proveedor en esos ensayos y dieciséis para
preparar el banco de escucha. Importe facturado y GPU de proveedores sin medir.
Un primer ensayo real falló al cerrar un doble de runtime y perdió sus métricas;
su consumo no se pudo recuperar y se conserva como retrospectiva separada en
`tmp/live-measurement-harness-failure-20261112.json`. Los informes de preparación
son `tmp/live-cues-preparation-20261112.json` y
`tmp/live-cues-preparation-20261112T155810.json`. No hubo reintentos automáticos.

## Instalación comprobada

Se reemplazaron once archivos con respaldo previo en `.local/live-vetsa-backup-*`.
El informe `tmp/live-vetsa-install-20261112.json` conserva hashes de copia para
integridad, sin presentarlos como prueba semántica. El reinicio privado confirmó
la salida de la instancia anterior y un nuevo arranque saludable. El servidor
instalado confirmó backend disponible y verificado, y sirvió correctamente las
dieciséis señales locales: `tmp/live-vetsa-installed-health-20261112.json`.
La comprobación no inició voz ni repitió la orden de la captura. No se publicó
un instalador nuevo ni se modificaron claves o preferencias.
