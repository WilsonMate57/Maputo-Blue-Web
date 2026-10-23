# -----------------------------------------------------------------------------
# install.ps1 - First installation of Maputo Blue on Windows Server.
#
#   .\deploy\windows\install.ps1 -Domain www.maputoblue.com
#
# Installs the Node dependencies, creates server\.env (with random secrets) if
# it does not exist yet and registers the Windows service with NSSM.
# It never overwrites an existing .env and never touches the database data.
# Run it from an elevated PowerShell (Administrator) in the repository folder.
# See docs/IMPLANTACAO.md.
# -----------------------------------------------------------------------------
param(
  [Parameter(Mandatory = $true)][string]$Domain,
  [string]$ServiceName = 'MaputoBlue',
  [int]$Port = 3000
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Server = Join-Path $Root 'server'
$EnvFile = Join-Path $Server '.env'
$Logs = Join-Path $Root 'logs'

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "ERRO: $m" -ForegroundColor Red; exit 1 }
function RandomHex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}
# UTF-8 without BOM: Node's --env-file does not accept a BOM
function WriteUtf8($path, $text) { [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false)) }

Step 'Pre-requisitos'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js nao encontrado. Instale o Node 22 LTS ou superior (nodejs.org).' }
$nodeMajor = [int]((& node -p 'process.versions.node').Split('.')[0])
if ($nodeMajor -lt 22) { Fail "Node.js $nodeMajor encontrado; e preciso a versao 22 ou superior." }
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) { Fail 'NSSM nao encontrado no PATH (nssm.cc). Copie nssm.exe para C:\Windows\System32 ou adicione ao PATH.' }
Write-Host "Node $(& node -v), NSSM em $($nssm.Source)"

Step 'Dependencias (npm ci --omit=dev)'
Push-Location $Server
try {
  & npm ci --omit=dev
  if ($LASTEXITCODE -ne 0) { Fail 'npm ci falhou.' }
} finally { Pop-Location }

Step 'Configuracao (server\.env)'
if (Test-Path $EnvFile) {
  Write-Host '.env ja existe: mantido sem alteracoes.'
} else {
  $text = Get-Content (Join-Path $Server '.env.example') -Raw
  $text = $text -replace '(?m)^NODE_ENV=.*$', 'NODE_ENV=production'
  $text = $text -replace '(?m)^PORT=.*$', "PORT=$Port"
  $text = $text -replace '(?m)^HOST=.*$', 'HOST=127.0.0.1'
  $text = $text -replace '(?m)^PUBLIC_BASE_URL=.*$', "PUBLIC_BASE_URL=https://$Domain"
  $text = $text -replace '(?m)^IP_HASH_SALT=.*$', "IP_HASH_SALT=$(RandomHex 32)"
  $text = $text -replace '(?m)^TICKET_SECRET=.*$', "TICKET_SECRET=$(RandomHex 32)"
  WriteUtf8 $EnvFile $text
  # Only Administrators and SYSTEM (the service account) may read the secrets
  & icacls $EnvFile /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:R' | Out-Null
  Write-Host '.env criado com TICKET_SECRET e IP_HASH_SALT aleatorios.' -ForegroundColor Green
  Write-Host 'GUARDE uma copia do TICKET_SECRET num cofre: sem ele os QR dos tickets deixam de ser validos.' -ForegroundColor Yellow
}
if ((Get-Content $EnvFile -Raw) -match 'CHANGE_ME') {
  Write-Host "`nFalta preencher o .env (DATABASE_URL e, quando houver, RESEND_API_KEY):" -ForegroundColor Yellow
  Write-Host "  notepad `"$EnvFile`""
  Write-Host 'Depois volte a correr este script.'
  exit 2
}

Step 'Verificacao (npm run check)'
Push-Location $Server
try { & npm run check } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Ha pontos a resolver (acima). Se forem so o administrador e o catalogo, siga a seccao 4 do guia e depois arranque o servico.' -ForegroundColor Yellow
}

Step "Servico Windows ($ServiceName)"
New-Item -ItemType Directory -Force $Logs | Out-Null
$exists = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $exists) {
  & nssm install $ServiceName $node.Source '--env-file=.env src\index.js' | Out-Null
  Write-Host "Servico $ServiceName criado."
} else {
  Write-Host "Servico $ServiceName ja existe: configuracao actualizada."
}
& nssm set $ServiceName AppDirectory $Server | Out-Null
& nssm set $ServiceName AppParameters '--env-file=.env src\index.js' | Out-Null
& nssm set $ServiceName DisplayName 'Maputo Blue (site e API)' | Out-Null
& nssm set $ServiceName AppStdout (Join-Path $Logs 'server.log') | Out-Null
& nssm set $ServiceName AppStderr (Join-Path $Logs 'server-error.log') | Out-Null
& nssm set $ServiceName AppRotateFiles 1 | Out-Null
& nssm set $ServiceName AppRotateOnline 1 | Out-Null
& nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
& nssm set $ServiceName AppExit Default Restart | Out-Null
& nssm set $ServiceName AppRestartDelay 5000 | Out-Null
& nssm set $ServiceName AppStopMethodConsole 15000 | Out-Null
& nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null

Write-Host "`nInstalacao preparada." -ForegroundColor Green
Write-Host "Proximos passos (docs/IMPLANTACAO.md):"
Write-Host "  1. Primeira vez: npm run migrate, import:json, import:reviews, create-admin (seccao 4)"
Write-Host "  2. nssm start $ServiceName   e confirme: curl http://127.0.0.1:$Port/api/health"
Write-Host "  3. HTTPS: deploy\windows\Caddyfile ou deploy\windows\web.config (IIS)"
Write-Host "  4. Backups diarios: deploy\windows\backup.ps1 -Register"
