[CmdletBinding()]
param(
    [ValidateRange(0,65535)][int]$ProxyPort = 0,
    [string]$ProjectDirectory
)
$ErrorActionPreference = 'Stop'
if ($ProxyPort -eq 0) { $ProxyPort = [int](Read-Host 'HTTP or Mixed proxy port shown in your proxy client') }
if ($ProxyPort -lt 1 -or $ProxyPort -gt 65535) { throw 'Port must be between 1 and 65535.' }
if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { $ProjectDirectory = Read-Host 'Full path of the project folder' }
if (-not (Test-Path -LiteralPath $ProjectDirectory -PathType Container)) { throw 'The project folder does not exist.' }
$projectPath = (Resolve-Path -LiteralPath $ProjectDirectory).ProviderPath
$claudeCommand = Get-Command claude -CommandType Application -ErrorAction Stop | Select-Object -First 1
if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port $ProxyPort -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    throw 'The local proxy is not listening. Start it and check its HTTP/Mixed port.'
}
$providerNames = @('ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY')
$conflicts = @($providerNames | Where-Object { -not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($_, 'Process')) })
if ($conflicts.Count -gt 0) {
    Write-Host ('Provider variables are set (values hidden): ' + ($conflicts -join ', '))
    Write-Host 'This launcher is for the personal Claude subscription route.'
    $choice = Read-Host 'Ignore these variables ONLY while this launcher runs? Type YES to continue; anything else cancels'
    if ($choice -cne 'YES') { Write-Host 'Cancelled. No environment settings changed.'; return }
}
$changedNames = @('HTTP_PROXY','HTTPS_PROXY','NO_PROXY') + $conflicts
$previousValues = @{}
foreach ($envName in $changedNames) { $previousValues[$envName] = [Environment]::GetEnvironmentVariable($envName, 'Process') }
$locationPushed = $false
try {
    $proxyUri = "http://127.0.0.1:$ProxyPort"
    [Environment]::SetEnvironmentVariable('HTTP_PROXY', $proxyUri, 'Process')
    [Environment]::SetEnvironmentVariable('HTTPS_PROXY', $proxyUri, 'Process')
    [Environment]::SetEnvironmentVariable('NO_PROXY', 'localhost,127.0.0.1,::1', 'Process')
    foreach ($envName in $conflicts) { [Environment]::SetEnvironmentVariable($envName, $null, 'Process') }
    Push-Location -LiteralPath $projectPath
    $locationPushed = $true
    Write-Host "Starting Claude in $projectPath through $proxyUri"
    & $claudeCommand.Source
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { Write-Warning "Claude exited with code $LASTEXITCODE" }
}
finally {
    foreach ($envName in $changedNames) { [Environment]::SetEnvironmentVariable($envName, $previousValues[$envName], 'Process') }
    if ($locationPushed) { Pop-Location }
    Write-Host 'Previous process proxy/provider environment and working folder restored.'
}
