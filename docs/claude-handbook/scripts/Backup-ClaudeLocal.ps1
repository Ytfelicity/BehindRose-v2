[CmdletBinding()]
param([string]$ConfigDirectory, [string]$BackupRoot)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ConfigDirectory)) {
    $ConfigDirectory = [Environment]::GetEnvironmentVariable('CLAUDE_CONFIG_DIR', 'Process')
    if ([string]::IsNullOrWhiteSpace($ConfigDirectory)) { $ConfigDirectory = Join-Path $env:USERPROFILE '.claude' }
}
if ([string]::IsNullOrWhiteSpace($BackupRoot)) { $BackupRoot = Join-Path $env:LOCALAPPDATA 'ClaudeManual\backups' }
if (-not (Test-Path -LiteralPath $ConfigDirectory -PathType Container)) { throw "Config directory not found: $ConfigDirectory" }
if (@(Get-Process -Name 'claude' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Close Claude Code and Claude Desktop before taking this local backup.' }
$configPath = (Resolve-Path -LiteralPath $ConfigDirectory).ProviderPath.TrimEnd([char[]]'\/')
$backupBase = [IO.Path]::GetFullPath($BackupRoot).TrimEnd([char[]]'\/')
if ($backupBase.Equals($configPath, [StringComparison]::OrdinalIgnoreCase) -or $backupBase.StartsWith($configPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backup destination must be outside the source configuration directory.'
}
$backupPath = Join-Path $backupBase ((Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
Copy-Item -LiteralPath $configPath -Destination (Join-Path $backupPath 'config') -Recurse -Force -ErrorAction Stop
$legacyFile = Join-Path $env:USERPROFILE '.claude.json'
if (Test-Path -LiteralPath $legacyFile -PathType Leaf) { Copy-Item -LiteralPath $legacyFile -Destination (Join-Path $backupPath 'user-claude.json') -ErrorAction Stop }
$manifest = [ordered]@{ created=(Get-Date).ToString('o'); source=$configPath; localConfigurationOnly=$true; warning='May contain login credentials. Keep this backup private. Cloud data and project source are not backed up.' }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupPath 'manifest.json') -Encoding UTF8
Write-Host "Backup saved: $backupPath"
Write-Host 'This backup may contain active credentials. Do not upload or share it.'
Write-Host 'This is a local configuration backup, not a cloud export or a way to restore a suspended account.'
