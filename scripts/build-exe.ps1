$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "  ============================================"
Write-Host "   OverlayPlacer  -  Windows 실행 파일 빌드"
Write-Host "  ============================================"
Write-Host ""

function Require-Command($name, $url, $extra) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "  [오류] $name 을(를) 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "  $url 에서 설치한 뒤 다시 실행하세요."
    if ($extra) { Write-Host "  $extra" }
    Write-Host ""
    Read-Host "  Enter 키를 누르면 닫힙니다"
    exit 1
  }
}

function Run-Step($cmd) {
  & cmd /c $cmd
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  [오류] 실패했습니다. 위 메시지를 확인하세요." -ForegroundColor Red
    Write-Host ""
    Read-Host "  Enter 키를 누르면 닫힙니다"
    exit 1
  }
}

Require-Command node "https://nodejs.org (LTS)" $null
Require-Command cargo "https://rustup.rs" "설치 중 Visual Studio C++ 빌드 도구 안내가 나오면 그대로 진행하면 됩니다."

if (-not (Test-Path "node_modules")) {
  Write-Host "  [1/3] 필요한 파일을 내려받습니다."
  Write-Host ""
  Run-Step "npm install"
}

if (-not (Test-Path "src-tauri\icons\icon.ico")) {
  Write-Host "  [2/3] 앱 아이콘을 생성합니다."
  Write-Host ""
  Run-Step "npm run tauri:icon"
}

Write-Host "  [3/3] 실행 파일을 빌드합니다. 첫 빌드는 10분 이상 걸릴 수 있습니다."
Write-Host ""
Run-Step "npm run tauri:build"

$exe = Join-Path (Get-Location) "src-tauri\target\release\overlayplacer.exe"
Write-Host ""
Write-Host "  ============================================"
Write-Host "   빌드 완료" -ForegroundColor Green
Write-Host "  ============================================"
Write-Host ""
Write-Host "  실행 파일: $exe"
Write-Host "  설치 없이 그대로 실행됩니다. 원하는 곳으로 옮겨서 쓰세요."
Write-Host ""
if (Test-Path $exe) { explorer.exe /select,"$exe" }
Read-Host "  Enter 키를 누르면 닫힙니다"
