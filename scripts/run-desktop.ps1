$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "  ============================================"
Write-Host "   OverlayPlacer  -  데스크톱 창으로 실행"
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
  Write-Host "  [1/2] 필요한 파일을 내려받습니다. 몇 분 걸릴 수 있습니다."
  Write-Host ""
  Run-Step "npm install"
}

if (-not (Test-Path "src-tauri\icons\icon.ico")) {
  Write-Host "  [2/2] 앱 아이콘을 생성합니다."
  Write-Host ""
  Run-Step "npm run tauri:icon"
}

Write-Host "  앱을 시작합니다. 첫 실행은 Rust 컴파일 때문에 수 분 걸립니다."
Write-Host ""
& cmd /c "npm run tauri:dev"
