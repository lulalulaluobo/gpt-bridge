#ifndef AppSource
  #error AppSource is required
#endif
#ifndef BuildSource
  #error BuildSource is required
#endif
#ifndef AppVersion
  #define AppVersion "0.11"
#endif
#ifdef InstallerTest
  #define ProductId "gpt-bridge-installer-test"
  #define OutputName "gpt-bridge-installer-test"
#else
  #define ProductId "gpt-bridge-windows"
  #define OutputName "gpt-bridge-" + AppVersion + "-windows-x64-setup"
#endif

[Setup]
AppId={#ProductId}
AppName=gpt-bridge
AppVersion={#AppVersion}
#ifdef InstallerTest
DefaultDirName={localappdata}\Programs\gpt-bridge-installer-test
#else
DefaultDirName={localappdata}\Programs\gpt-bridge
#endif
DefaultGroupName=gpt-bridge
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDirectory}
OutputBaseFilename={#OutputName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\gpt-bridge.exe
CloseApplications=no
RestartApplications=no
SetupLogging=yes

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BuildSource}\installer-guard.exe"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "{#BuildSource}\installer-guard.exe"; Flags: dontcopy

#ifndef InstallerTest
[Icons]
Name: "{autoprograms}\gpt-bridge"; Filename: "{app}\gpt-bridge.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\gpt-bridge.exe"; Description: "启动 gpt-bridge"; Flags: nowait postinstall skipifsilent unchecked
#endif

[Code]
const
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';

function GuardAllowsInstall(const GuardPath: String): Boolean;
var
  ExitCode: Integer;
begin
  Result := Exec(GuardPath, '', '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
  if Result then Result := ExitCode = 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  ExtractTemporaryFile('installer-guard.exe');
  if not GuardAllowsInstall(ExpandConstant('{tmp}\installer-guard.exe')) then
    Result := '请先在 gpt-bridge 托盘菜单中选择“断开并退出”，再重试安装。安装程序不会强制中断活动任务。'
  else if not IsDotNetInstalled(net48, 0) then
    Result := '请先安装 Microsoft .NET Framework 4.8，再重试。'
  else
    Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  Result := GuardAllowsInstall(ExpandConstant('{app}\resources\installer-guard.exe'));
  if not Result then
    SuppressibleMsgBox('请先在 gpt-bridge 托盘菜单中选择“断开并退出”，再重试卸载。', mbError, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Existing: String;
begin
#ifndef InstallerTest
  { Preserve the user's opt-in when migrating from a portable install. }
  if (CurStep = ssPostInstall) and RegQueryStringValue(HKCU, RunKey, 'gpt-bridge', Existing) then
    RegWriteStringValue(HKCU, RunKey, 'gpt-bridge', ExpandConstant('"{app}\gpt-bridge.exe" --background'));
#endif
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Existing: String;
begin
#ifndef InstallerTest
  if (CurUninstallStep = usUninstall) and RegQueryStringValue(HKCU, RunKey, 'gpt-bridge', Existing) then
    if CompareText(Existing, ExpandConstant('"{app}\gpt-bridge.exe" --background')) = 0 then
      RegDeleteValue(HKCU, RunKey, 'gpt-bridge');
#endif
  { Application data and DPAPI credentials live outside the program directory and are retained. }
end;
