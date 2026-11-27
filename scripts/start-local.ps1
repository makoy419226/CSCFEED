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

if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
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

  # New PC: no PostgreSQL service yet -> install it first (prompts for the
  # postgres password and elevates only for the install), then continue here.
  $pgServices = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)
  if ($pgServices.Count -eq 0) {
    Write-Host "PostgreSQL is not installed on this PC. Running first-time setup..." -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "setup-local.ps1") -SetupOnly
    if ($LASTEXITCODE -ne 0) {
      Write-Error "First-time setup failed. Fix the error above and rerun this script."
      exit 1
    }
  }
} else {
  Write-Host "Starting CSC Feed. Make sure PostgreSQL is installed and running."
}

# Database + migrations, Super User check, then API + web with a readiness check.
npm run start:local
exit $LASTEXITCODE
