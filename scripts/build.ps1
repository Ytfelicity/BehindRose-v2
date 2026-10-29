[CmdletBinding()]
param([string]$Dotnet = 'dotnet', [switch]$Publish, [string]$Iscc = '', [string]$UpdateRepository = '', [string]$Version = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$buildProperties = @()
if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$') { throw 'Invalid release version.' }
    $buildProperties += "-p:ReleaseVersion=$Version"
}
if ($UpdateRepository) {
    if ($UpdateRepository -notmatch '^https://github\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$') { throw 'Invalid GitHub repository URL.' }
    $buildProperties += "-p:UpdateRepository=$UpdateRepository"
}
$properties = ([xml](Get-Content -LiteralPath (Join-Path $projectRoot 'Directory.Build.props') -Raw)).Project.PropertyGroup
$packageVersion = if ($Version) { $Version } elseif ($properties.ReleaseVersion) { $properties.ReleaseVersion } else { $properties.Version }
$artifacts = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
Push-Location $projectRoot
try {
    $env:DOTNET_ROOT = Split-Path -Parent (Get-Command $Dotnet).Source
    if ($Publish) {
        # Embed production assets rather than a previous development-watch build.
        & npm --prefix (Join-Path $projectRoot 'frontend') run check
        if ($LASTEXITCODE -ne 0) { throw 'Frontend type check failed' }
        & npm --prefix (Join-Path $projectRoot 'frontend') run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed' }
    }
    & $Dotnet restore 'BehindRose.slnx' --locked-mode @buildProperties
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed' }
    & $Dotnet build 'BehindRose.slnx' -c Release --no-restore @buildProperties
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    Push-Location $artifacts
    try {
        & $Dotnet run --project (Join-Path $projectRoot 'tests\BehindRose.Tests') -c Release --no-build 2>&1 | Tee-Object -FilePath 'core-test-results.txt'
        if ($LASTEXITCODE -ne 0) { throw 'Core tests failed' }
        $app = Join-Path $projectRoot 'src\BehindRose.Desktop\bin\Release\net10.0-windows\BehindRose.exe'
        $process = Start-Process -FilePath $app -ArgumentList '--smoke-test' -WorkingDirectory $artifacts -WindowStyle Hidden -PassThru -Wait
        if ($process.ExitCode -ne 0) { throw 'Native UI smoke test failed' }
        $receipt = Get-Content -LiteralPath 'ui-smoke\result.json' -Raw | ConvertFrom-Json
        if (!$receipt.Passed) { throw 'Native UI verification did not pass' }
    } finally { Pop-Location }
    if ($Publish) {
        & node (Join-Path $PSScriptRoot 'check-public-source.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Public source and license inventory did not pass' }
        $publishDir = Join-Path $artifacts 'portable'
        # A reused publish directory would retain removed Content items.
        # Preserve the old output, then publish into an empty directory.
        if (Test-Path -LiteralPath $publishDir) {
            $resolvedPublish = (Resolve-Path -LiteralPath $publishDir).Path
            $expectedPublish = [IO.Path]::GetFullPath((Join-Path $projectRoot 'artifacts\portable'))
            $previousPublish = [IO.Path]::GetFullPath((Join-Path $artifacts ('previous-portable-' + [Guid]::NewGuid().ToString('N'))))
            if ($resolvedPublish -ne $expectedPublish -or !(Get-Item -LiteralPath $publishDir).PSIsContainer -or ((Get-Item -LiteralPath $publishDir).Attributes -band [IO.FileAttributes]::ReparsePoint) -or !$previousPublish.StartsWith([IO.Path]::GetFullPath($artifacts) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe publish output path' }
            Move-Item -LiteralPath $resolvedPublish -Destination $previousPublish
        }
        & $Dotnet publish 'src\BehindRose.Desktop' -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:DebugType=None -p:DebugSymbols=false -p:RestoreLockedMode=true -o $publishDir @buildProperties
        if ($LASTEXITCODE -ne 0) { throw 'Publish failed' }
        $licenseDir = Join-Path $publishDir 'licenses'
        New-Item -ItemType Directory -Path $licenseDir -Force | Out-Null
        Copy-Item -Path (Join-Path $projectRoot 'licenses\*') -Destination $licenseDir -Recurse -Force
        Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination $publishDir -Force
        Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $publishDir -Force
        $publishDocs = Join-Path $publishDir 'docs'
        New-Item -ItemType Directory -Path $publishDocs -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\许可证说明.md'),(Join-Path $projectRoot 'docs\代理网络质量.md'),(Join-Path $projectRoot 'docs\程序更新.md') -Destination $publishDocs -Force
        foreach ($name in @('Microsoft.Web.WebView2.Core.xml','Microsoft.Web.WebView2.WinForms.xml','Microsoft.Web.WebView2.Wpf.xml')) {
            $generatedDoc = Join-Path $publishDir $name
            if (Test-Path -LiteralPath $generatedDoc) { Remove-Item -LiteralPath $generatedDoc }
        }
        Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\使用说明.md'),(Join-Path $projectRoot 'docs\验证范围.md'),(Join-Path $projectRoot 'docs\本机完整备份.md') -Destination $publishDir -Force
        Compress-Archive -Path (Join-Path $publishDir '*') -DestinationPath (Join-Path $artifacts "BehindRose-$packageVersion-win-x64.zip") -Force
        if ($Iscc) { & $Iscc (Join-Path $PSScriptRoot 'installer.iss'); if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' } }
        Get-ChildItem -LiteralPath $artifacts -File | Where-Object Extension -in '.zip','.exe' | Get-FileHash -Algorithm SHA256 | Format-List
    }
} finally { Pop-Location }
