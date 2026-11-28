@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js and npm are required. On a new PC, run:
  echo powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-local.ps1"
  pause
  exit /b 1
)

call npm run dev
set "exitCode=%ERRORLEVEL%"
if not "%exitCode%"=="0" (
  echo CSC Feed stopped with exit code %exitCode%.
  pause
)
exit /b %exitCode%