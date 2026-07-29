@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title OverlayPlacer - 설치 파일 빌드

echo.
echo  ============================================
echo   OverlayPlacer  -  Windows 설치 파일 빌드
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

where cargo >nul 2>nul
if errorlevel 1 (
    echo  [오류] Rust를 찾을 수 없습니다.
    echo.
    echo  설치 파일 빌드에는 Rust가 필요합니다.
    echo  https://rustup.rs 에서 설치한 뒤 이 파일을 다시 실행하세요.
    echo  설치 중 Visual Studio C++ 빌드 도구를 함께 설치하라는
    echo  안내가 나오면 그대로 진행하면 됩니다.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo  [1/3] 필요한 파일을 내려받습니다. 몇 분 걸릴 수 있습니다.
    echo.
    call npm install
    if errorlevel 1 goto failed
    echo.
)

if not exist "src-tauri\icons\icon.ico" (
    echo  [2/3] 앱 아이콘을 생성합니다.
    echo.
    call npm run tauri:icon
    if errorlevel 1 goto failed
    echo.
)

echo  [3/3] 설치 파일을 빌드합니다.
echo  첫 빌드는 Rust 컴파일 때문에 10분 이상 걸릴 수 있습니다.
echo.
call npm run tauri:build
if errorlevel 1 goto failed

echo.
echo  ============================================
echo   빌드 완료
echo  ============================================
echo.
echo  설치 파일 위치:
echo  src-tauri\target\release\bundle\
echo.

if exist "src-tauri\target\release\bundle\" (
    start "" "src-tauri\target\release\bundle\"
)
pause
exit /b 0

:failed
echo.
echo  [오류] 빌드에 실패했습니다. 위 메시지를 확인하세요.
echo.
pause
exit /b 1
