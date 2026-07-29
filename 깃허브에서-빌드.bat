@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title OverlayPlacer - 깃허브에서 받아 빌드

:: ===========================================================
::  이 파일 하나만 아무 폴더에 두고 실행하면
::  깃허브에서 최신 소스를 받아 실행 파일까지 만들어 줍니다.
::  같은 폴더에 OverlayPlacer 폴더가 생기고, 두 번째부터는
::  변경된 부분만 받아서 다시 빌드합니다.
:: ===========================================================

set REPO=https://github.com/EYounha/OverlayPlacer.git
set BRANCH=main
set DIR=OverlayPlacer

echo.
echo  ============================================
echo   OverlayPlacer  -  깃허브에서 받아 빌드
echo  ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
    echo  [오류] Git을 찾을 수 없습니다.
    echo.
    echo  https://git-scm.com/download/win 에서 설치한 뒤
    echo  이 파일을 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

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
    echo  https://rustup.rs 에서 설치한 뒤 이 파일을 다시 실행하세요.
    echo  설치 중 Visual Studio C++ 빌드 도구를 함께 설치하라는
    echo  안내가 나오면 그대로 진행하면 됩니다.
    echo.
    pause
    exit /b 1
)

if exist "%DIR%\.git" (
    echo  [1/4] 최신 소스를 받아옵니다.
    echo.
    pushd "%DIR%"
    call git fetch origin %BRANCH%
    if errorlevel 1 goto pullfailed
    call git checkout %BRANCH%
    if errorlevel 1 goto pullfailed
    call git reset --hard origin/%BRANCH%
    if errorlevel 1 goto pullfailed
    popd
) else (
    echo  [1/4] 소스를 내려받습니다.
    echo  비공개 저장소라면 깃허브 로그인 창이 뜰 수 있습니다.
    echo.
    call git clone --branch %BRANCH% "%REPO%" "%DIR%"
    if errorlevel 1 goto clonefailed
)
echo.

pushd "%DIR%"

echo  [2/4] 의존성을 설치합니다.
echo.
call npm install
if errorlevel 1 goto buildfailed
echo.

if not exist "src-tauri\icons\icon.ico" (
    echo  [3/4] 앱 아이콘을 생성합니다.
    echo.
    call npm run tauri:icon
    if errorlevel 1 goto buildfailed
    echo.
) else (
    echo  [3/4] 앱 아이콘이 이미 있습니다.
    echo.
)

echo  [4/4] 실행 파일을 빌드합니다.
echo  첫 빌드는 Rust 컴파일 때문에 10분 이상 걸릴 수 있습니다.
echo.
call npm run tauri:build
if errorlevel 1 goto buildfailed

set EXE=%CD%\src-tauri\target\release\overlayplacer.exe
popd

echo.
echo  ============================================
echo   빌드 완료
echo  ============================================
echo.
echo  실행 파일:
echo  %EXE%
echo.
echo  설치 없이 그대로 실행됩니다. 원하는 곳으로 옮겨서 쓰세요.
echo.

if exist "%EXE%" (
    explorer /select,"%EXE%"
)
pause
exit /b 0

:pullfailed
popd
echo.
echo  [오류] 소스를 갱신하지 못했습니다.
echo  %DIR% 폴더를 지우고 다시 실행하면 새로 받아옵니다.
echo.
pause
exit /b 1

:clonefailed
echo.
echo  [오류] 소스를 받지 못했습니다.
echo  주소나 브랜치 이름, 깃허브 접근 권한을 확인하세요.
echo.
echo   저장소: %REPO%
echo   브랜치: %BRANCH%
echo.
pause
exit /b 1

:buildfailed
popd
echo.
echo  [오류] 빌드에 실패했습니다. 위 메시지를 확인하세요.
echo.
pause
exit /b 1
