[CmdletBinding()]
param([ValidateRange(0,65535)][int]$ProxyPort = 0)
$ErrorActionPreference = 'Stop'
if ($ProxyPort -eq 0) { $ProxyPort = [int](Read-Host 'HTTP or Mixed proxy port shown in your proxy client') }
if ($ProxyPort -lt 1 -or $ProxyPort -gt 65535) { throw 'Port must be between 1 and 65535.' }
$proxyUri = "http://127.0.0.1:$ProxyPort"
if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port $ProxyPort -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    throw "No TCP listener at $proxyUri. Start the proxy client and check its HTTP/Mixed port."
}
$curlCommand = Get-Command curl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
Write-Host "Local proxy listener is reachable: $proxyUri"
$exitAddress = & $curlCommand.Source --fail --silent --show-error --connect-timeout 10 --max-time 20 --proxy $proxyUri 'https://api.ipify.org'
if ($LASTEXITCODE -ne 0) { throw 'The explicit HTTP proxy IP check failed. Check the selected route and client logs.' }
Write-Host ("Proxy IPv4: {0}" -f (($exitAddress -join '').Trim()))
$httpStatus = & $curlCommand.Source --silent --show-error --connect-timeout 10 --max-time 20 --proxy $proxyUri --output NUL --write-out '%{http_code}' 'https://claude.ai/'
if ($LASTEXITCODE -ne 0) { throw 'The Claude website transport check failed. Review the curl error above.' }
Write-Host ("Claude website HTTP status: {0}" -f (($httpStatus -join '').Trim()))
Write-Host 'An HTTP response is a connectivity signal only. A 403 can be a browser challenge; it does not prove an account ban.'
Write-Host 'Now compare with the browser at https://api.ipify.org and confirm Claude requests in the proxy client connection log.'
$envNames = @('ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CONFIG_DIR')
foreach ($envName in $envNames) {
    $isSet = -not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($envName, 'Process'))
    Write-Host ("{0}: {1}" -f $envName, $(if ($isSet) { 'SET (value hidden)' } else { 'not set' }))
}
