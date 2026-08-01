$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "  ============================================"
Write-Host "   OverlayPlacer  -  웹 브라우저로 실행"
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

if (-not (Test-Path "node_modules")) {
  Write-Host "  처음 실행이라 필요한 파일을 내려받습니다. 몇 분 걸릴 수 있습니다."
  Write-Host ""
  Run-Step "npm install"
}

Write-Host "  서버를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다."
Write-Host "  종료하려면 이 창을 닫으세요."
Write-Host ""
& cmd /c "npm run dev -- --open"
