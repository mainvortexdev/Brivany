# Objetivo nuevo: terminal y comandos de Melodi

1 de noviembre de 2026, America/La_Paz. El usuario dio por cerrado el objetivo
anterior y solicitó este objetivo nuevo. El estado verificable se conserva en la
bitácora y en los recibos; este documento no declara la tarea completada.

**Alcance corregido por el usuario, 1 de noviembre:** comandos y atajos que
necesita un usuario promedio, más una selección avanzada útil. Se retiran del
catálogo activo Windows Server, autoridades certificadoras, directorios de
dominio y administración empresarial. El inventario inicial amplio queda como
histórico, sin certificarlo. Se conservan las revisiones de los comandos de
escritorio ya aprobados. La cifra inicial de 2.000 no se declara cumplida con
comandos ajenos a este alcance.

1. Conocimiento documentado de al menos 2.000 comandos Windows, más atajos,
   consultable desde Melodi y su conversación live. Profundidad de terminal en
   Windows y macOS, con disponibilidad y pruebas distinguidas por plataforma.
2. Checklist numerada. Un comando ejecutado necesita resultado y revisión
   favorable antes de avanzar al siguiente. Ayuda consultada, catálogo e
   instalación detectada no equivalen a una ejecución aprobada.
3. No operar ni modificar el registro mediante comandos, scripts o UI. Una
   petición explícita puede permitir abrir una ruta de Regedit para observarla;
   editarla queda fuera de las acciones de Melodi. La orientación debe explicar
   alto riesgo y responsabilidad del usuario.
4. Comandos para programas, tareas de desarrollo, ejecutables y temporales,
   dentro de las rutas autorizadas. Elevación por los mecanismos legítimos del
   sistema; no aceptar credenciales, eludir UAC ni rebajar seguridad por ausencia
   del usuario. Lo que requiera su intervención queda pendiente, no aprobado.
5. Repositorio de prueba: ProjectFixture-Trading-Operator. Conservar origen remoto y copia
   local de referencia. Reparaciones únicamente en una copia de trabajo separada.
   No hacer push, publicar o alterar el repositorio original.
6. Melodi debe detectar el entorno y el IDE, clonar, detectar errores, preparar
   dependencias, iniciar y verificar el servidor local, abrir su web, capturarla
   y guardar la captura en **Escritorio/Evidencia Melodi**. Debe abrir Bloc de
   notas, escribir las acciones y guardar allí su TXT. Verificar contenido real.
7. Detectar IDE instalado; Antigravity está autorizado por el usuario para esta
   prueba. La recomendación general sin preferencia será VS Code, con método
   oficial de descarga, instalación/configuración y uso, sin inventar permisos.

Restricciones de prueba: sin operaciones financieras reales ni uso de las
credenciales del proyecto de trading. Sin adjuntar claves, `.env`, código privado
con credenciales o contenido personal a la bitácora. No afirmar compatibilidad
macOS ejecutada desde un equipo Windows.

## Cambio de prioridad aceptado por el usuario

1 de noviembre, después de 65 aprobados: «Con esos comandos y atajos es
suficiente». Se deja de ampliar/ejecutar la checklist y se conserva su estado,
incluidos pendientes y rechazos; no se transforma en una certificación de 2.000
comandos ni de macOS. La nueva dirección es
[medios, documentación/controladores y web pública posterior](docs/melodi-medios-documentacion-y-web.md).

Comprobación posterior de la capacidad IDE: detección corregida de Antigravity,
apertura real de la copia de trabajo y ejecución desde su depurador por el
planificador y adaptador de Melodi, con salud HTTP y origen Git limpio. Se
conservan los intentos fallidos, la ausencia de prueba macOS y la checklist sin
nuevas ejecuciones. [Evidencia y límites](docs/terminal-ide-real.md).
