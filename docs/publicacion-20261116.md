# Publicación de Brivany 0.2.0

Preparación solicitada por Daniel Luna: publicar los cambios acumulados y un instalador Windows, simplificar el arranque y conservar las conexiones oficiales de Google para las pruebas del equipo.

## Entrega

- README con descarga, configuración del ejecutable y del código, claves mínimas de Meta/Cartesia y requisitos por función.
- Correo de prueba y contacto `daniel@vetsa.es`; tres enlaces del sitio oficial comprobados por HTTPS con respuesta 200.
- Se mantienen el cliente y los dominios oficiales de Brivany para Google, la autorización individual y la vinculación mediante Cuenta Vetsa/WhatsApp. No se declara aprobada la revisión pública de Google.
- Versión 0.2.0, identificador/icono Brivany y dependencias actuales, incluida `aiohttp`. El paquete incorpora la licencia y `.env.example`.
- Instalador de 249.722.375 bytes. No incorpora claves, perfiles personales, backend Cognira, Node.js ni FFmpeg. Es una vista previa sin firma Authenticode; las actualizaciones usan una firma Ed25519 distinta.
- GitHub Releases distribuye el instalador. El canal HTTPS de actualizaciones no se cambia al publicar esta Release.

## Comprobaciones realizadas

- `tools.verify contracts`: 11 ejemplos, 18 rechazos esperados, 27 esquemas, 23 operaciones HTTP, 292 referencias de esquema y 724 enlaces Markdown. Hubo fallos iniciales por enlaces `mailto:` y dos rutas antiguas tras trasladar WhatsApp; corregidos y vuelta a ejecutar satisfactoria.
- `tools.verify chat-history`: 10 pruebas locales satisfactorias.
- `tools.verify whatsapp-cloud`: 35 pruebas locales satisfactorias. El primer intento sin acceso a DPAPI falló al cifrar una sesión sintética; repetición con DPAPI disponible satisfactoria.
- `tools.verify windows-release`: manifiesto local firmado válido; ningún valor de las ocho credenciales configuradas comprobadas ni rutas privadas detectados en el ZIP. No se consultó ni se certificó el canal HTTPS para esta versión.
- `tools.verify windows-installer`: instalación y desinstalación reales en un registro, directorio y perfil aislados; interfaz WebView2 lista y preferencias sintéticas conservadas. No se reemplazó la instalación habitual.
- Comparación de 602 fuentes de aplicación del paquete con el árbol de trabajo: ninguna diferencia.
- `pip check`, comprobación JavaScript y compilación del sitio satisfactorios. Endpoint público de vinculación de WhatsApp: HTTP 200.
- Revisión del árbol publicable: no coincide con ninguno de nueve valores privados configurados; los patrones genéricos señalaron coincidencias dentro de recursos binarios/base64 de modelos, Wasm y un wordmark. No se interpretaron como credenciales sin comprobar su contexto.

Las pruebas de esta entrega no ejecutan modelos de pago, no llaman teléfonos ni autorizan cuentas reales de terceros. La instalación nativa es una comprobación real; los conectores se probaron con sustitutos. No acredita todos los recorridos funcionales ni una auditoría de seguridad independiente. GPU y coste de infraestructura sin medir.

## Limpieza

Se retiraron 20 directorios entre cachés y un empaquetado temporal identificado: 6.926.763 bytes. El ZIP original de tipografías se conserva en `.local/supplied-originals/`; las fuentes y licencias canónicas siguen en el código. No se eliminaron claves, sesiones, proyectos, grabaciones ni el entorno virtual. Los resultados de compilación permanecen en `Exports/`, fuera de Git.

Las suites opcionales de Vetsa Intelligence ya no contienen una ruta absoluta personal: usan el repositorio adyacente o `BRIVANY_VETSA_INTELLIGENCE_DIR`. El código de Vetsa Intelligence pertenece a su propio repositorio y no se copia dentro de Brivany.

## Revisión adicional antes de subir

La revisión automática detuvo el primer intento de push para revisar un informe
bruto de pruebas OAuth y coincidencias genéricas de credenciales en recursos.
El informe se retiró del commit todavía local y se conserva en
`.local/publication-private-evidence/`, excluido de Git. La documentación pública
mantiene los resultados y límites sin adjuntar ese informe bruto.

La comprobación estructural posterior localizó la coincidencia del modelo ONNX
dentro de `TensorProto.raw_data` (pesos binarios), y las 268 coincidencias del
vendor Rapier dentro de su módulo Wasm codificado en base64. Ambos archivos son
idénticos a los blobs ya publicados en la base remota. Las coincidencias del
wordmark de Melodi pertenecen a sus imágenes PNG/JPEG codificadas, con sus
cabeceras verificadas. No son asignaciones de claves de API. La evidencia
estructural se conserva localmente en `tmp/publication-pattern-context.json`.
