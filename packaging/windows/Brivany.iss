#ifndef Payload
  #error Payload is required
#endif
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
[Setup]
AppId={code:PackageAppId}
AppName=Brivany
AppVersion={#AppVersion}
AppPublisher=Brivany
AppPublisherURL=https://brivany.vetsa.es
AppSupportURL=https://brivany.vetsa.es
AppUpdatesURL=https://brivany.vetsa.es/windows/stable.json
DefaultDirName={localappdata}\Programs\Brivany
DefaultGroupName=Brivany
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
WizardResizable=no
SetupIconFile=..\..\desktop\assets\brivany.ico
UninstallDisplayIcon={app}\Brivany.exe
UninstallDisplayName=Brivany
OutputDir={#OutputDir}
OutputBaseFilename=Brivany-Setup-{#AppVersion}-x64
Compression=lzma2/fast
SolidCompression=yes
LZMANumBlockThreads=2
CloseApplications=yes
RestartApplications=no
AppMutex={code:PackageMutex}
SetupLogging=yes
VersionInfoVersion={#AppVersion}.0
DisableWelcomePage=no
UsePreviousLanguage=no

[Languages]
Name: spanish; MessagesFile: compiler:Languages\Spanish.isl

[Messages]
spanish.WelcomeLabel1=Bienvenido a Brivany
spanish.WelcomeLabel2=Melodi, tus herramientas y tu espacio de trabajo.%n%nEl asistente instalará Brivany en tu cuenta de Windows. Las próximas actualizaciones se descargarán desde la aplicación y conservarán tus ajustes.
spanish.FinishedLabel=Brivany está listo.%n%nTus preferencias se guardan por separado del programa. No necesitas volver a instalarlo para cada actualización.
spanish.UninstallConfirm=¿Quieres desinstalar Brivany?%n%nTus ajustes, cuentas y proyectos se conservarán.

[Tasks]
Name: desktopicon; Description: Crear un acceso directo en el escritorio; GroupDescription: Accesos directos:; Flags: unchecked

[Files]
Source: {#Payload}\Brivany.exe; DestDir: {app}; Flags: ignoreversion
Source: {#Payload}\current.json; DestDir: {app}; Flags: ignoreversion
Source: {#Payload}\releases\*; DestDir: {app}\releases; Flags: ignoreversion recursesubdirs createallsubdirs
Source: ..\..\.local\build-tools\MicrosoftEdgeWebview2Setup.exe; Flags: dontcopy

[Icons]
Name: {autoprograms}\Brivany; Filename: {app}\Brivany.exe; AppUserModelID: Brivany.Desktop; Check: NormalInstall
Name: {autodesktop}\Brivany; Filename: {app}\Brivany.exe; AppUserModelID: Brivany.Desktop; Tasks: desktopicon; Check: NormalInstall
Name: {autoprograms}\Desinstalar Brivany; Filename: {uninstallexe}; Check: NormalInstall

[Run]
Filename: {app}\Brivany.exe; Description: Abrir Brivany; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: {app}\releases
Type: files; Name: {app}\current.json

[Code]
function NormalInstall(): Boolean;
begin
  Result := ExpandConstant('{param:PackageCheck|0}') <> '1';
end;

function PackageAppId(Param: String): String;
begin
  if NormalInstall() then Result := '{42C77CCB-DA68-4ED2-909F-5EE7A3E4885B}'
  else Result := 'Brivany.Package.Acceptance';
end;

function PackageMutex(Param: String): String;
begin
  if NormalInstall() then Result := 'Local\Brivany.Desktop.Instance'
  else Result := 'Local\Brivany.Package.Acceptance.Instance';
end;

function HasWebView2(): Boolean;
var Runtime: String;
begin
  Result := (RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Runtime) and (Runtime <> '') and (Runtime <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Runtime) and (Runtime <> '') and (Runtime <> '0.0.0.0'));
end;

function InitializeSetup(): Boolean;
begin
  Result := IsDotNetInstalled(net48, 0);
  if not Result then
    SuppressibleMsgBox('Brivany necesita Microsoft .NET Framework 4.8. Instálalo desde Windows Update y vuelve a abrir este instalador.', mbCriticalError, MB_OK, IDOK);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ExitCode: Integer;
begin
  Result := '';
  if not HasWebView2() then
  begin
    WizardForm.StatusLabel.Caption := 'Preparando Microsoft Edge WebView2…';
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      Result := 'No se pudo preparar WebView2. Comprueba tu conexión a Internet e inténtalo de nuevo.'
    else if not HasWebView2() then
      Result := 'Microsoft WebView2 todavía no está disponible. Reinicia Windows y vuelve a abrir el instalador.';
  end;
end;
