# -----------------------------------------------------------------------------
# update.ps1 - Updates the site to a new version, with automatic rollback.
#
#   .\deploy\windows\update.ps1                 # latest commit of the current branch
#   .\deploy\windows\update.ps1 -Ref v1.2.0     # a tag, branch or commit
#
# 1. backs up the database (pg_dump + logical JSON backup)
# 2. fetches and checks out the new version, installs dependencies
# 3. restarts the service (pending migrations run on start-up)
# 4. checks /api/health; if it does not answer, returns to the previous
#    version and restarts it.
# Migrations only add tables/columns, so the previous code keeps working with
# the newer database. Run from an elevated PowerShell. See docs/IMPLANTACAO.md.
# -----------------------------------------------------------------------------
param(
  [string]$Ref = '',
  [string]$ServiceName = 'MaputoBlue',
  [int]$Port = 3000,
  [switch]$SkipBackup
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Server = Join-Path $Root 'server'

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Git { & git -C $Root @args; if ($LASTEXITCODE -ne 0) { throw "git $args falhou" } }
function Healthy {
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
      if ($r.ok) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}
function Deploy($target) {
  Invoke-Git checkout --quiet $target
  Push-Location $Server
  try {
    & npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou' }
  } finally { Pop-Location }
  & nssm restart $ServiceName | Out-Null
}

if ((& git -C $Root status --porcelain --untracked-files=no)) {
  Write-Host 'ERRO: ha ficheiros do repositorio alterados no servidor. Resolva-os (git status) antes de actualizar.' -ForegroundColor Red
  exit 1
}
$previous = (& git -C $Root rev-parse HEAD).Trim()
$branch = (& git -C $Root rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Versao actual: $previous ($branch)"

if (-not $SkipBackup) {
  Step 'Backup antes da actualizacao'
  & (Join-Path $PSScriptRoot 'backup.ps1') -Label 'pre-update'
  if ($LASTEXITCODE -ne 0) { Write-Host 'ERRO: o backup falhou; actualizacao cancelada.' -ForegroundColor Red; exit 1 }
}

Step 'Nova versao'
Invoke-Git fetch --tags --prune origin
if ($Ref) { $target = $Ref }
elseif ($branch -ne 'HEAD') { $target = "origin/$branch" }
else { Write-Host 'ERRO: o repositorio nao esta numa branch; indique -Ref.' -ForegroundColor Red; exit 1 }
$next = (& git -C $Root rev-parse "$target^{commit}").Trim()
if ($next -eq $previous) { Write-Host 'Ja esta na versao pedida. Nada a fazer.'; exit 0 }
Write-Host "A actualizar para $next"
& git -C $Root log --oneline "$previous..$next" | Select-Object -First 15

try {
  if ($branch -ne 'HEAD' -and -not $Ref) {
    Invoke-Git merge --ff-only --quiet $target
    $target = $branch
  }
  Deploy $target
  Step 'A verificar o servico'
  if (-not (Healthy)) { throw 'o servico nao respondeu em /api/health' }
  Write-Host "Actualizado para $next." -ForegroundColor Green
} catch {
  Write-Host "`nFALHOU: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "A voltar a $previous ..." -ForegroundColor Yellow
  if ($branch -ne 'HEAD') { Invoke-Git checkout --quiet $branch; Invoke-Git reset --hard --quiet $previous; Deploy $branch }
  else { Deploy $previous }
  if (Healthy) { Write-Host 'Versao anterior reposta e a funcionar.' -ForegroundColor Yellow }
  else { Write-Host "A versao anterior tambem nao respondeu. Veja $Root\logs\server-error.log" -ForegroundColor Red }
  exit 1
}
