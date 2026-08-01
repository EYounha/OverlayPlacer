@echo off
setlocal
rem Standalone bootstrap: downloads the build script and runs it.
rem All Korean UI lives in the PowerShell script (batch must stay ASCII).
set "PS1_URL=https://raw.githubusercontent.com/EYounha/OverlayPlacer/main/scripts/build-from-github.ps1"
set "PS1_FALLBACK=https://raw.githubusercontent.com/EYounha/OverlayPlacer/claude/overlayplacer-layout-editor-kcynwe/scripts/build-from-github.ps1"
set "PS1_LOCAL=%TEMP%\overlayplacer-build.ps1"
if exist "%~dp0scripts\build-from-github.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-from-github.ps1"
  exit /b %errorlevel%
)
powershell -NoProfile -Command "try { iwr -UseBasicParsing '%PS1_URL%' -OutFile '%PS1_LOCAL%' } catch { iwr -UseBasicParsing '%PS1_FALLBACK%' -OutFile '%PS1_LOCAL%' }"
if not exist "%PS1_LOCAL%" (
  echo [ERROR] Could not download the build script. Check your network.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1_LOCAL%"
exit /b %errorlevel%
