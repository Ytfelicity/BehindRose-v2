#define AppVersion "2.0.0"
#define Root SourcePath + ".."
[Setup]
AppId={{9DB4DB49-383F-49B4-A119-F451BDAD3A39}
AppName=身后红玫瑰 · 网络助手
AppVersion={#AppVersion}
AppVerName=身后红玫瑰 · 网络助手 2.0.0 预览版
AppPublisher=身后红玫瑰
DefaultDirName={localappdata}\Programs\BehindRose
DefaultGroupName=身后红玫瑰
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#Root}\artifacts
OutputBaseFilename=BehindRose-2.0.0-preview.1-Setup
SetupIconFile={#Root}\src\BehindRose.Desktop\Assets\avatar.ico
UninstallDisplayIcon={app}\BehindRose.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=no
RestartApplications=no
InfoBeforeFile={#Root}\docs\安装提示.txt

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#Root}\artifacts\portable\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked

[Icons]
Name: "{group}\身后红玫瑰 · 网络助手"; Filename: "{app}\BehindRose.exe"
Name: "{autodesktop}\身后红玫瑰 · 网络助手"; Filename: "{app}\BehindRose.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\BehindRose.exe"; Description: "启动网络助手"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeUninstall(): Boolean;
begin
  Result := True;
  if not UninstallSilent then
    Result := MsgBox('卸载将移除程序文件，保留配置备份与偏好设置。若需要撤销网络修改，请先取消卸载并在程序内恢复备份。是否继续卸载？', mbConfirmation, MB_YESNO) = IDYES;
end;
