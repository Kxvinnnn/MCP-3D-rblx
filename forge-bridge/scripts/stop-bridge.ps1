#Requires -Version 5.1
<#
.SYNOPSIS
    Detiene de forma controlada el servicio Forge Local Bridge en Windows.
#>

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BridgeRoot = Split-Path -Parent $ScriptDir
$PidFile = Join-Path $BridgeRoot ".forge-bridge.pid"

if (Test-Path $PidFile) {
    $TargetPid = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($TargetPid) {
        $Proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
        if ($Proc) {
            Write-Host "[ForgeBridge] Deteniendo proceso PID $TargetPid..." -ForegroundColor Cyan
            Stop-Process -Id $TargetPid -Force
            Write-Host "[ForgeBridge] Servicio detenido correctamente." -ForegroundColor Green
        } else {
            Write-Host "[ForgeBridge] El proceso $TargetPid ya no estaba activo." -ForegroundColor Yellow
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "[ForgeBridge] No se encontró archivo .forge-bridge.pid activo." -ForegroundColor Yellow
}
