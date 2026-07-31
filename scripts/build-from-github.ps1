$ErrorActionPreference = "Stop"
# 이 스크립트를 아무 폴더에 두고 실행하면 소스를 받아 빌드까지 진행합니다.
# 빌드-실행파일.bat와 달리 저장소를 미리 받아둘 필요가 없습니다.
Set-Location $PSScriptRoot
if ((Split-Path -Leaf $PSScriptRoot) -eq "scripts") { Set-Location (Split-Path -Parent $PSScriptRoot) }

$Repo = "https://github.com/EYounha/OverlayPlacer.git"
# main에 소스가 없으면(작업 브랜치가 아직 병합 전이면) 다음 브랜치로 넘어간다
$Branches = @("main", "claude/overlayplacer-layout-editor-kcynwe")
$Dir = "OverlayPlacer-src"

Write-Host ""
Write-Host "  ============================================"
Write-Host "   OverlayPlacer  -  깃허브에서 받아 빌드"
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

Require-Command git "https://git-scm.com/download/win" $null
Require-Command node "https://nodejs.org (LTS)" $null
Require-Command cargo "https://rustup.rs" "설치 중 Visual Studio C++ 빌드 도구 안내가 나오면 그대로 진행하면 됩니다."

if (-not (Test-Path (Join-Path $Dir ".git"))) {
  Write-Host "  [1/4] 소스를 내려받습니다. 비공개 저장소면 깃허브 로그인 창이 뜰 수 있습니다."
  Write-Host ""
  Run-Step "git clone `"$Repo`" `"$Dir`""
}

Set-Location $Dir
Run-Step "git fetch origin"

$picked = $null
foreach ($b in $Branches) {
  & git rev-parse --verify "origin/$b" *> $null
  if ($LASTEXITCODE -ne 0) { continue }
  & git cat-file -e "origin/${b}:package.json" *> $null
  if ($LASTEXITCODE -eq 0) { $picked = $b; break }
}
if (-not $picked) {
  Write-Host "  [오류] 소스가 있는 브랜치를 찾지 못했습니다." -ForegroundColor Red
  Read-Host "  Enter 키를 누르면 닫힙니다"
  exit 1
}
Write-Host "  브랜치: $picked"
Run-Step "git checkout -B build-local origin/$picked"

Write-Host ""
Write-Host "  [2/4] 의존성을 설치합니다."
Write-Host ""
Run-Step "npm install"

if (-not (Test-Path "src-tauri\icons\icon.ico")) {
  Write-Host "  [3/4] 앱 아이콘을 생성합니다."
  Write-Host ""
  Run-Step "npm run tauri:icon"
}

Write-Host "  [4/4] 실행 파일을 빌드합니다. 첫 빌드는 10분 이상 걸릴 수 있습니다."
Write-Host ""
Run-Step "npm run tauri:build"

$exe = Join-Path (Get-Location) "src-tauri\target\release\overlayplacer.exe"
Write-Host ""
Write-Host "  ============================================"
Write-Host "   빌드 완료" -ForegroundColor Green
Write-Host "  ============================================"
Write-Host ""
Write-Host "  실행 파일: $exe"
Write-Host ""
if (Test-Path $exe) { explorer.exe /select,"$exe" }
Read-Host "  Enter 키를 누르면 닫힙니다"
