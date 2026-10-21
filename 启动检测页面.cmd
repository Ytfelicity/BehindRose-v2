@echo off
setlocal
cd /d "%~dp0"
where pwsh >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -File "%~dp0scripts\dev.ps1" -Mode Diagnostics
) else (
  pwsh -NoProfile -File "%~dp0scripts\dev.ps1" -Mode Diagnostics
)
if errorlevel 1 pause
