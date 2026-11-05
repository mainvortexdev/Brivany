# Worker espacial preparado

Esta carpeta no contiene credenciales. Importar `workers.spatial_modal` o usar
`python -m tools.check_spatial_worker` no crea aplicaciones ni consulta Modal.
El lock distribuido tiene dispatch desactivado y el factory `create_app()` se
niega a declarar el despliegue hasta que sus prerrequisitos estén satisfechos.

## Implementado y comprobable sin cuenta

- Contrato de un fotograma PNG y una máscara PNG revisada, hashes, semilla,
  timeout y reserva monetaria explícitos. No admite URLs, archivos arbitrarios
  ni comandos en el payload.
- Presupuesto previo mediante tarifa y reserva configuradas; ninguna tarifa
  ni saldo inventados. El registro remoto no sustituye una reserva atómica del
  orquestador ni constituye un límite duro de facturación del proveedor.
- Verificación del árbol completo de checkpoints contra rutas, tamaños y hashes.
- Proceso específico SAM3D cancelable y limitado por tiempo; GLB autocontenido
  con controles de cabecera, chunks, rangos de buffer y accesores antes de
  publicar una caché por hash de entrada,
  parámetros, modelo e imagen. Limpieza de los temporales propios.
- Factory Modal perezoso: L40S candidata, mínimos 0, máximo 1, buffer 0,
  retries 0, timeout 180 s, startup timeout 600 s. Volúmenes existentes; no se
  crean silenciosamente ni se descargan pesos.
  La reserva candidata de host es 4 CPU y 32 GiB RAM, pendiente de medición.

El runner usa el API `Inference(config, compile=False)(image, mask, seed=...)`
del commit fijado y exporta `output['glb']`. **No se ha ejecutado ni construido
esa imagen en GPU**. El código de inferencia está preparado y sus límites se
prueban con sustitutos locales; no se afirma compatibilidad ni reconstrucción.

## Separado para cuando vuelva el usuario

1. Crear/configurar Modal y confirmar saldo, crédito y presupuesto monetario.
2. Revisar licencias y solicitar acceso a los checkpoints pertinentes.
3. Descargar los pesos por un proceso explícito; fijar revisión y todos los
   hashes/tamaños del volumen. No introducir tokens en el lock.
4. Construir y validar una imagen SAM3D Linux/CUDA de 32 GiB VRAM como mínimo,
   fijar digest y lock transitivo de dependencias. El tag CUDA del lock es solo
   candidato; cambiará al artefacto privado ya construido y probado.
5. Verificar la revisión del código y hashes de los archivos upstream fijados;
   comprobar salida, orientación y escala con un único objeto de prueba.
6. Habilitar dispatch en configuración y conectar la reserva monetaria atómica,
   autorización, idempotencia remota y cancelación del orquestador. No hay un
   endpoint público ni una llamada de despliegue escondida en la app local.

La imagen oficial de SAM3D contiene dependencias CUDA nativas y algunas
dependencias de desarrollo sin versión. Por eso `dependency_lock_complete`,
`build_verified` y `cuda_compatibility_verified` son falsos: un commit de código
no hace que el runtime completo sea reproducible.

`retries=0` desactiva reintentos de aplicación, **no** evita los reintentos de
contenedor que Modal documenta tras un crash. El timeout no incluye una garantía
de coste de preparación, arranque, almacenamiento ni transferencia.

Fuentes primarias consultadas el 28 de octubre de 2026:

- [Requisitos SAM3D](https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/doc/setup.md).
- [Interfaz de inferencia fijada](https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/notebook/inference.py).
- [Contenedores Modal](https://modal.com/docs/guide/scale).
- [Imágenes Modal](https://modal.com/docs/guide/images).
- [Fallos y reintentos Modal](https://modal.com/docs/guide/retries).

Los SDK, repositorios y hashes de sus archivos quedan en
`config/spatial-models.lock.json`. Los checkpoints y el digest de la imagen
seguirán pendientes hasta completar acceso y construcción.
