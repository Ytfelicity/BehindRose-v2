[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][string]$Version,
    [string]$Dotnet = 'dotnet',
    [string]$ReleaseNotes = '',
    [switch]$Publish
)
$ErrorActionPreference = 'Stop'
if (!$Publish) { throw 'Generating release packages requires explicit -Publish. Nothing has been built or uploaded.' }
if ($Repository -notmatch '^https://github\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$') { throw 'Repository must be https://github.com/owner/repository.' }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$') { throw 'Invalid release version.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    # Version is passed to restore/build/publish so the embedded repository and
    # semantic version agree with the update package. No credentials are embedded.
    & (Join-Path $PSScriptRoot 'build.ps1') -Dotnet $Dotnet -Publish -Version $Version -UpdateRepository $Repository
    & $Dotnet tool restore
    if ($LASTEXITCODE -ne 0) { throw 'Unable to restore pinned Velopack packaging tool.' }
    $output = Join-Path $projectRoot 'artifacts\updates'
    $arguments = @('tool', 'run', 'vpk', '--', 'pack', '--packId', 'BehindRose.NetworkAssistant', '--packVersion', $Version,
        '--packDir', (Join-Path $projectRoot 'artifacts\portable'), '--mainExe', 'BehindRose.exe', '--channel', 'win', '--runtime', 'win-x64',
        '--outputDir', $output, '--packTitle', '身后红玫瑰 · 网络助手', '--packAuthors', '身后红玫瑰',
        '--icon', (Join-Path $projectRoot 'src\BehindRose.Desktop\Assets\avatar.ico'))
    if ($ReleaseNotes) {
        $notesPath = (Resolve-Path -LiteralPath $ReleaseNotes).Path
        $arguments += @('--releaseNotes', $notesPath)
    }
    & $Dotnet @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Update packaging failed.' }
    Get-ChildItem -LiteralPath $output -File | Get-FileHash -Algorithm SHA256 | Format-Table
    Write-Host 'Packages created locally. Upload the feed, .nupkg and installer/portable files together to one GitHub Release. No upload was performed.'
} finally { Pop-Location }
