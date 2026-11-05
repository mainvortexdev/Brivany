# 33. Orquestación local antes del primer trabajo remoto

28 de octubre de 2026. `services/spatial/dispatch.py` conecta la entrada de un
objeto revisado con el presupuesto transaccional y un protocolo de transporte
inyectable. **Sólo se ha implementado y probado un transporte sustituto local**;
el adaptador real de Modal, su despliegue e inferencia siguen pendientes.
Importar este código no carga el SDK Modal, autentica, descarga ni envía datos.

## Entrada y preflight

`preflight_package` revisa ZIP, hashes de PNG/máscara, dimensiones, selección
rectangular revisada y correspondencia con la revisión actual de captura.
Un paquete de una revisión anterior se rechaza aunque sus propios hashes sean
correctos. La identidad estable incorpora paquete, hash del ZIP, revisión,
semilla, plazo y lock/modelos; deriva el identificador del trabajo sin aleatoriedad.

El preflight no reserva dinero, crea trabajos ni llama al transporte. Devuelve
metadatos y bloqueos; no bytes de imágenes, claves o rutas absolutas del usuario.
Los controles distribuidos están cerrados por defecto. El CLI `submit` rechaza
el envío incluso con `--execute` y un lock modificado: falta un transporte real
validado y este CLI no instala ninguno automáticamente.

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m tools.spatial_dispatch --help
```

Para un paquete ya preparado, el subcomando `preflight` recibe los identificadores
de captura y paquete y `--expected-revision`. `inspect` consulta un trabajo local
existente. Estos comandos no equivalen a ejecutar SAM3D.

## Presupuesto, idempotencia y cancelación

El coordinador exige autorización de ejecución y lock/configuración coherentes,
presupuesto en `.local/spatial/budget.sqlite3` y transporte expresamente de
simulación. Guarda intención durable antes de reservar y antes de atravesar el
inicio del transporte. El diario es `dispatch.sqlite3`. No conserva los bytes de
entrada ni logs crudos del proveedor en los registros.

Un trabajo existente no se vuelve a enviar. Reiniciar o restaurar el diario no
reanuda una inferencia. Un fallo al cruzar la marca de inicio conserva una reserva
desconocida, aun cuando no pueda probarse que se llegó a llamar al transporte.
La conciliación exige un coste explícito; no inventa factura a partir del timeout.
La reserva y el diario están en bases separadas: se conservan estados de intención
ante interrupciones, sin afirmar una transacción distribuida entre ambos.

Cancelar antes de empezar sólo libera una reserva que se sabe no iniciada.
Durante la ejecución es una **solicitud cooperativa**, sin aborto remoto real:
mantiene incertidumbre hasta terminar o conciliar y evita publicar un artefacto
de un trabajo cancelado. Se comprobaron dos instancias coordinadoras que comparten
las bases, sin duplicar una llamada del sustituto.

La respuesta de prueba puede contener GLB y coste sintético conocido o `None`.
El GLB se valida estructuralmente con el validador existente antes de publicarlo
en `dispatch-artifacts/`. Su origen es `test_stub`, con `model_executed: false`;
no se incorpora como una habitación reconstruida al visor. Los importes de las
fixtures **no son gastos reales** ni predicciones de precio Modal.

## Recuperación y límites

El [respaldo offline](32-revision-y-edicion-espacial.md) incluye diario, reservas
y artefactos de prueba admitidos. Valida referencias, hashes y estados antes de
restaurar. La prueba de recuperación conserva `failed_unknown` y su reserva,
bloquea otro gasto y no ejecuta un transporte al abrir el respaldo.

Esto comprueba la lógica local frente a interrupciones y consumo desconocido.
Faltan adaptador real, autorizaciones y cancelación del proveedor, credenciales,
imagen CUDA/pesos validados, presupuesto acordado y una ejecución concreta que
mida geometría, tiempos y facturación. No hay un endpoint web que despache el
trabajo ni un resultado real de Meta acreditado por estas pruebas.
