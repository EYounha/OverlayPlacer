@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title OverlayPlacer - 웹 실행

echo.
echo  ============================================
echo   OverlayPlacer  -  웹 브라우저로 실행
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  [오류] Node.js를 찾을 수 없습니다.
    echo.
    echo  https://nodejs.org 에서 LTS 버전을 설치한 뒤
    echo  이 파일을 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo  처음 실행이라 필요한 파일을 내려받습니다. 몇 분 걸릴 수 있습니다.
    echo.
    call npm install
    if errorlevel 1 goto failed
    echo.
)

echo  서버를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다.
echo  종료하려면 이 창을 닫으세요.
echo.
call npm run dev -- --open
exit /b 0

:failed
echo.
echo  [오류] 설치에 실패했습니다. 위 메시지를 확인하세요.
echo.
pause
exit /b 1
