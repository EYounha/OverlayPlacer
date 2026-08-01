@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-desktop.ps1"
exit /b %errorlevel%
