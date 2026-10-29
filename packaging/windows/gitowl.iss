; Inno Setup script for the Windows installer. Built by .github/workflows/release.yml:
;   iscc /DAppVersion=0.2.0 /DSourceExe=path\to\gitowl.exe packaging\windows\gitowl.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceExe
  #define SourceExe "..\..\target\release\gitowl.exe"
#endif

[Setup]
AppId={{6C0F2E61-3B5E-4E3B-9C1A-6A0A3E9B7D21}
AppName=gitowl
AppVersion={#AppVersion}
AppPublisher=gitowl
DefaultDirName={autopf}\gitowl
DefaultGroupName=gitowl
DisableProgramGroupPage=yes
OutputBaseFilename=gitowl-{#AppVersion}-windows-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ChangesEnvironment=yes
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
SetupIconFile=..\..\assets\brand\gitowl.ico
UninstallDisplayIcon={app}\gitowl.exe

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE-MIT"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE-APACHE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\gitowl"; Filename: "{app}\gitowl.exe"; Parameters: "--library"

[Registry]
; Adds the install folder to PATH so `gitowl` works in any terminal.
Root: HKA; Subkey: "{code:EnvironmentKey}"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Check: NeedsPath(ExpandConstant('{app}'))

[Code]
function EnvironmentKey(Param: string): string;
begin
  if IsAdminInstallMode then
    Result := 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
  else
    Result := 'Environment';
end;

function NeedsPath(Dir: string): Boolean;
var
  Current: string;
begin
  if not RegQueryStringValue(HKA, EnvironmentKey(''), 'Path', Current) then
    Current := '';
  Result := Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Current) + ';') = 0;
end;
