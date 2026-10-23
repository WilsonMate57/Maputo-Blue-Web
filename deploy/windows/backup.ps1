# -----------------------------------------------------------------------------
# backup.ps1 - Full backup: PostgreSQL dump + uploaded images.
#
#   .\deploy\windows\backup.ps1                       # one backup now
#   .\deploy\windows\backup.ps1 -Register             # daily scheduled task (02:30)
#   .\deploy\windows\backup.ps1 -BackupDir E:\backups -KeepDays 30
#
# The database password is read from %APPDATA%\postgresql\pgpass.conf of the
# account that runs the script (never from this file). Copy the backup folder
# to another machine or cloud storage as well. See docs/IMPLANTACAO.md.
# -----------------------------------------------------------------------------
param(
  [string]$BackupDir = 'D:\backups\maputoblue',
  [int]$KeepDays = 30,
  [string]$Label = 'daily',
  [string]$PgBin = '',
  [switch]$Register
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if ($Register) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -BackupDir `"$BackupDir`" -KeepDays $KeepDays"
  $trigger = New-ScheduledTaskTrigger -Daily -At '02:30'
  Register-ScheduledTask -TaskName 'MaputoBlue Backup' -Action $action -Trigger $trigger `
    -Description 'Backup diario da base de dados e imagens do Maputo Blue' -RunLevel Highest -Force | Out-Null
  Write-Host "Tarefa 'MaputoBlue Backup' agendada para as 02:30. Confirme que a conta da tarefa tem o pgpass.conf." -ForegroundColor Green
  exit 0
}

# Database connection from server\.env (only the URL is read; it is never printed)
$envLine = Select-String -Path (Join-Path $Root 'server\.env') -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1
if (-not $envLine) { Write-Host 'ERRO: DATABASE_URL nao encontrado em server\.env' -ForegroundColor Red; exit 1 }
$uri = [Uri]$envLine.Matches[0].Groups[1].Value.Trim()
$db = $uri.AbsolutePath.TrimStart('/')
$user = [Uri]::UnescapeDataString($uri.UserInfo.Split(':')[0])
$dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }

if (-not $PgBin) {
  $found = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { $PgBin = $found.DirectoryName }
}
$pgDump = if ($PgBin) { Join-Path $PgBin 'pg_dump.exe' } else { 'pg_dump' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
New-Item -ItemType Directory -Force $BackupDir | Out-Null
$dump = Join-Path $BackupDir "maputoblue-$stamp-$Label.dump"

& $pgDump -U $user -h $uri.Host -p $dbPort -F c -f $dump $db
if ($LASTEXITCODE -ne 0) { Write-Host 'ERRO: pg_dump falhou (verifique o pgpass.conf).' -ForegroundColor Red; exit 1 }
Write-Host "Base de dados: $dump ($([math]::Round((Get-Item $dump).Length / 1MB, 1)) MB)"

# Images uploaded in the admin panel: incremental mirror
$images = Join-Path $BackupDir 'images'
& robocopy (Join-Path $Root 'assets\images') $images /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Host 'ERRO: a copia das imagens falhou.' -ForegroundColor Red; exit 1 }
Write-Host "Imagens: $images"

# Retention
Get-ChildItem $BackupDir -Filter 'maputoblue-*.dump' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item -Force
exit 0
