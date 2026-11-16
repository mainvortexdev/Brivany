# WorkSpace · Juego

**Herramientas → Juego** abre cuatro lecturas y un selector de ventanas. «Solo
uso del equipo» muestra CPU, GPU y RAM sin capturar fotogramas. «Preparar FPS»
descarga el ejecutable oficial de PresentMon 2.6.0 y verifica su SHA-256. Para
medir FPS se elige la ventana del juego y se pulsa «Mostrar franja». La franja
aparece en la pantalla del juego cuando su proceso tiene el foco. «Ocultar
franja» o cerrar WorkSpace termina la sesión.

Una ventana WinForms usa el dispatcher de Desktop, sin abrir otro WebView. Su
estilo es de solo lectura, pasa el puntero y conserva el foco del juego.
Los contadores se leen una vez por segundo con la franja activa. El panel solo
consulta el último valor mientras está abierto. En reposo se cierran la ventana,
el lector, la consulta de GPU y la sesión ETW propia. El ejecutable solo se
ejecuta después de una acción explícita. No se solicitan privilegios ni se
modifican grupos de Windows.

CPU y RAM son del equipo. GPU resume el motor más ocupado. FPS usa los
intervalos entre fotogramas presentados en la cadena dominante de la ventana;
la interfaz marca «—» cuando faltan datos. La fuente de la referencia es un
fragmento local de 35–39 s. La temperatura de CPU/GPU, el chat conjunto
Twitch/YouTube y el juego real con FPS requieren verificación aparte.
[PresentMon](https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md),
[contadores de GPU en Windows](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/).

## Pruebas

- WinForms propio verificó contadores reales, franja siempre visible sobre su
  escritorio de prueba, ausencia de foco propio, estilos de puntero y cierre
  del sampler. La primera variante tomó foco; el arreglo define los estilos
  al crear el HWND. Los resultados fallidos quedan en `tmp/verification`.
- Edge a 340 px verificó el selector, el valor «—» y que ocultar la vista corta
  sus consultas al puente. Los datos del puente fueron sintéticos.
- PresentMon oficial, firma Authenticode válida y hash de release coincidente,
  reprodujo un ETL público de su suite. El analizador leyó 53 filas con cadenas
  válidas y mantuvo separados los procesos. Una traza en vivo dirigida a un
  proceso propio devolvió `access denied` (salida 6) con el usuario actual.
  El ensayo no ejecutó un juego ni cambió permisos.

CPU/RAM/GPU consumidos por toda la aplicación quedan sin medir. El backend
de juego no recoge métricas hasta iniciar una franja. [Informes](../tmp/verification/workspace-game-20261107.json).
