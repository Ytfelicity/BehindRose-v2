[CmdletBinding()]
param([ValidateSet('Web','Desktop','Diagnostics')][string]$Mode = 'Web', [switch]$Demo, [switch]$NoWatch)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    if ($Demo) { $Mode = 'Desktop' }
    if ($Mode -in @('Web','Diagnostics')) {
        $developmentPort = if ($env:BEHINDROSE_DEV_PORT) { $env:BEHINDROSE_DEV_PORT } else { '4317' }
        if ($developmentPort -notmatch '^[0-9]{1,5}$' -or [int]$developmentPort -lt 1 -or [int]$developmentPort -gt 65535) { throw 'BEHINDROSE_DEV_PORT must be an integer from 1 to 65535.' }
        $developmentUrl = "http://127.0.0.1:$developmentPort/"
        try {
            $running = Invoke-RestMethod -Uri ($developmentUrl + '__dev/status') -TimeoutSec 2
            if ($running.application -eq 'BehindRose workbench development') {
                Start-Process $developmentUrl
                return
            }
        } catch { }
        $node = Get-Command node -ErrorAction Stop
        & $node.Source (Join-Path $PSScriptRoot 'dev-server.mjs') --open
        exit $LASTEXITCODE
    }
    $localSdk = Join-Path (Split-Path -Parent $projectRoot) 'tools\dotnet10\dotnet.exe'
    $dotnet = if (Test-Path -LiteralPath $localSdk) { $localSdk } else { (Get-Command dotnet -ErrorAction Stop).Source }
    $env:DOTNET_ROOT = Split-Path -Parent $dotnet
    $env:DOTNET_ROOT_X64 = $env:DOTNET_ROOT
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:DOTNET_NOLOGO = '1'
    $env:BEHINDROSE_DEV_SOURCE = Join-Path $projectRoot 'src\BehindRose.Desktop\Assets'
    $env:DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER = '1'
    $env:DOTNET_WATCH_RESTART_ON_RUDE_EDIT = 'true'
    $env:DOTNET_WATCH_SUPPRESS_BROWSER_REFRESH = '1'
    $desktop = Join-Path $projectRoot 'src\BehindRose.Desktop\BehindRose.Desktop.csproj'
    & $dotnet restore $desktop --locked-mode --ignore-failed-sources
    if ($LASTEXITCODE -ne 0) { throw 'Dependency restore failed. Check that the .NET 10 SDK and NuGet dependencies are available.' }
    $appArgs = @('--dev')
    if ($Demo) { $appArgs += '--demo' }
    Write-Host 'Development mode: source assets reload on save; no ZIP, installer, or published EXE is generated.'
    if ($NoWatch) { & $dotnet run --project $desktop -c Debug --no-restore -- @appArgs }
    else { & $dotnet watch --project $desktop run --configuration Debug --no-restore -- @appArgs }
    exit $LASTEXITCODE
} finally { Pop-Location }
