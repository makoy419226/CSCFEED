<#
.SYNOPSIS
  One-shot local setup for a new Windows PC: installs PostgreSQL (if missing),
  makes sure the service runs on port 5432, installs npm packages, then starts
  the app via scripts/start-local.ps1 (which creates the cscfeed database,
  roles, and .env credentials on first run).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1
  npm run setup
#>
param(
  [int]$PostgresVersion = 17,
  [int]$PostgresPort = 5432,
  # Only install/start PostgreSQL and npm packages; do not launch the app.
  [switch]$SetupOnly
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

function Write-Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-PostgresServices {
  @(Get-CimInstance Win32_Service -Filter "Name like 'postgresql%'" -ErrorAction SilentlyContinue)
}

# Returns the PostgreSQL service whose data directory is configured for $Port.
function Get-PostgresServiceForPort([int]$Port) {
  foreach ($service in Get-PostgresServices) {
    if ($service.PathName -match '-D\s+"([^"]+)"') {
      $conf = Join-Path $Matches[1] "postgresql.conf"
      $configuredPort = 5432
      if (Test-Path $conf) {
        $line = Select-String -Path $conf -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -First 1
        if ($line) { $configuredPort = [int]$line.Matches[0].Groups[1].Value }
      }
      if ($configuredPort -eq $Port) { return $service }
    }
  }
  return $null
}

function Get-PlainText([Security.SecureString]$secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Update-SessionPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

# --- 1. Node.js -------------------------------------------------------------
Write-Step "Checking Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed and winget is unavailable. Install Node.js LTS from https://nodejs.org and rerun."
  }
  Write-Step "Installing Node.js LTS with winget"
  winget install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "Node.js installation failed (winget exit code $LASTEXITCODE)." }
  Update-SessionPath
}
Write-Host "Node $(node -v), npm $(npm -v)"

# --- 2. PostgreSQL ------------------------------------------------------------
Write-Step "Checking PostgreSQL on port $PostgresPort"
$service = Get-PostgresServiceForPort $PostgresPort
$adminPassword = $null

if (-not $service) {
  $existing = Get-PostgresServices
  if ($existing.Count -gt 0) {
    Write-Warning ("PostgreSQL is installed (" + (($existing | ForEach-Object Name) -join ", ") + ") but none is configured for port $PostgresPort.")
  }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is unavailable. Install PostgreSQL $PostgresVersion from https://www.postgresql.org/download/windows/ using port $PostgresPort, then rerun."
  }
  if (-not (Test-IsAdmin)) {
    Write-Step "PostgreSQL install needs administrator rights; relaunching elevated (approve the UAC prompt)"
    $argsList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"",
      "-PostgresVersion", $PostgresVersion, "-PostgresPort", $PostgresPort, "-SetupOnly")
    $proc = Start-Process powershell.exe -ArgumentList $argsList -Verb RunAs -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "Elevated PostgreSQL setup failed (exit code $($proc.ExitCode))." }
    Update-SessionPath
    $service = Get-PostgresServiceForPort $PostgresPort
    if (-not $service) { throw "PostgreSQL service for port $PostgresPort was not found after installation." }
  }
  else {
    Write-Host "Choose a password for the PostgreSQL 'postgres' superuser. Keep it safe; it is NOT saved."
    while ($true) {
      $p1 = Get-PlainText (Read-Host "postgres password" -AsSecureString)
      $p2 = Get-PlainText (Read-Host "Confirm password" -AsSecureString)
      if (-not $p1) { Write-Warning "Password cannot be empty."; continue }
      if ($p1 -ne $p2) { Write-Warning "Passwords do not match."; continue }
      if ($p1 -match '"') { Write-Warning "Please avoid double quotes in the password."; continue }
      $adminPassword = $p1
      break
    }

    Write-Step "Installing PostgreSQL $PostgresVersion with winget (this takes a few minutes)"
    $override = "--mode unattended --unattendedmodeui minimal --superpassword `"$adminPassword`" --serverport $PostgresPort --disable-components stackbuilder"
    winget install --id "PostgreSQL.PostgreSQL.$PostgresVersion" --exact --accept-source-agreements --accept-package-agreements --override $override
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL installation failed (winget exit code $LASTEXITCODE)." }

    $service = Get-PostgresServiceForPort $PostgresPort
    if (-not $service) { throw "PostgreSQL installed, but no service configured for port $PostgresPort was found." }
  }
}
Write-Host "Using service $($service.Name)"

# Make sure it starts with Windows and is running now.
if ($service.StartMode -ne "Auto" -or $service.State -ne "Running") {
  if (Test-IsAdmin) {
    if ($service.StartMode -ne "Auto") { Set-Service -Name $service.Name -StartupType Automatic }
    if ($service.State -ne "Running") { Start-Service -Name $service.Name }
  }
  elseif ($service.State -ne "Running") {
    try { Start-Service -Name $service.Name }
    catch { throw "Could not start $($service.Name). Rerun this script as Administrator or start it from Windows Services." }
  }
}
Write-Host "$($service.Name) is running."

# Put psql on PATH (user scope) so the README's psql commands work.
if ($service.PathName -match '"([^"]+\\bin)\\pg_ctl\.exe"') {
  $binDir = $Matches[1]
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (($userPath -split ';') -contains $binDir)) {
    [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(';') + ";" + $binDir).TrimStart(';'), "User")
    Write-Host "Added $binDir to your user PATH (new terminals will see psql)."
  }
  if (-not (($env:Path -split ';') -contains $binDir)) { $env:Path += ";$binDir" }
}

# --- 3. Project files -------------------------------------------------------
if (-not (Test-Path (Join-Path $root ".env"))) {
  Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
  Write-Host "Created .env from .env.example."
}

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Step "Installing npm packages"
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
}

if ($SetupOnly) {
  Write-Step "Setup complete. Run 'npm run dev' or scripts\start-local.ps1 to start the app."
  exit 0
}

# --- 4. Start the app (first run creates the cscfeed database and roles) -----
Write-Step "Starting CSC Feed (first run will create the cscfeed database and save credentials to .env)"
if ($adminPassword) {
  # Reuse the password just chosen so the first-run bootstrap does not ask again.
  $env:CSCFEED_POSTGRES_ADMIN_PASSWORD = $adminPassword
}
try {
  & (Join-Path $PSScriptRoot "start-local.ps1")
  exit $LASTEXITCODE
}
finally {
  Remove-Item Env:CSCFEED_POSTGRES_ADMIN_PASSWORD -ErrorAction SilentlyContinue
}
