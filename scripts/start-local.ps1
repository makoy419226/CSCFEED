$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is required. Install Node.js, reopen PowerShell, and run this script again."
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm was not found. Reopen PowerShell after installing Node.js and retry."
  exit 1
}

if (-not (Test-Path (Join-Path $root ".env"))) {
  Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
}

$envLines = Get-Content (Join-Path $root ".env")
$portLine = $envLines | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1
$apiPort = 5001
if ($portLine -and $portLine -match '^\s*PORT\s*=\s*(\d+)') {
  $apiPort = [int]$Matches[1]
}

$ports = @($apiPort, 5173) | Select-Object -Unique
foreach ($port in $ports) {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $ownerPid = $listener.OwningProcess
    $owner = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    $ownerName = if ($owner) { $owner.ProcessName } else { "unknown process" }
    Write-Error "Port $port is already used by $ownerName (PID $ownerPid). Confirm the process before stopping it, then rerun this script."
    exit 1
  }
}

npm run dev
exit $LASTEXITCODE
