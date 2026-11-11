#Requires -Version 5.1
<#
.SYNOPSIS
    Inicia el servicio Forge Local Bridge en Windows (127.0.0.1:48720).
#>

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BridgeRoot = Split-Path -Parent $ScriptDir
Set-Location $BridgeRoot

$PidFile = Join-Path $BridgeRoot ".forge-bridge.pid"

if (Test-Path $PidFile) {
    $ExistingPid = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($ExistingPid -and (Get-Process -Id $ExistingPid -ErrorAction SilentlyContinue)) {
        Write-Host "[ForgeBridge] El servicio ya está en ejecución (PID: $ExistingPid)." -ForegroundColor Yellow
        exit 0
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path (Join-Path $BridgeRoot "node_modules"))) {
    Write-Host "[ForgeBridge] Instalando dependencias con npm.cmd install..." -ForegroundColor Cyan
    & npm.cmd install
}

if (-not (Test-Path (Join-Path $BridgeRoot ".env"))) {
    Copy-Item (Join-Path $BridgeRoot ".env.example") (Join-Path $BridgeRoot ".env")
    Write-Host "[ForgeBridge] Creado archivo .env a partir de .env.example." -ForegroundColor Green
}

Write-Host "[ForgeBridge] Iniciando Forge Local Bridge en 127.0.0.1..." -ForegroundColor Cyan
$CliPath = Join-Path $BridgeRoot "node_modules\tsx\dist\cli.mjs"
$Proc = if (Test-Path $CliPath) {
    Start-Process -FilePath "node.exe" -ArgumentList $CliPath, "src/server.ts" -WorkingDirectory $BridgeRoot -PassThru -WindowStyle Hidden
} else {
    Start-Process -FilePath "npx.cmd" -ArgumentList "tsx", "src/server.ts" -WorkingDirectory $BridgeRoot -PassThru -WindowStyle Hidden
}
$Proc.Id | Set-Content -Path $PidFile -Encoding UTF8

Start-Sleep -Seconds 2
if (Get-Process -Id $Proc.Id -ErrorAction SilentlyContinue) {
    Write-Host "[ForgeBridge] Servicio activo en segundo plano (PID: $($Proc.Id))." -ForegroundColor Green
} else {
    Write-Host "[ForgeBridge] El proceso terminó prematuramente. Ejecuta 'npm run start' para ver la salida en consola." -ForegroundColor Red
    exit 1
}
