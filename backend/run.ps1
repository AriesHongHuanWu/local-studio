# =============================================================================
# AutoLyrics 後端啟動腳本 (Windows / PowerShell)
# -----------------------------------------------------------------------------
# 啟用 .venv 並執行 app.py(uvicorn,127.0.0.1:8756)。
#
# 用法:  > .\run.ps1
#  若被執行原則擋下,先跑:
#        > Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
# =============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$VenvDir = Join-Path $ScriptDir ".venv"
$VPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VPython)) {
    Write-Host "✗ 尚未安裝虛擬環境。請先執行:  .\install.ps1" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== 啟動 AutoLyrics 後端 ===" -ForegroundColor Cyan
Write-Host "服務網址:  http://127.0.0.1:8756" -ForegroundColor Green
Write-Host "停止服務:  Ctrl + C" -ForegroundColor DarkGray
Write-Host ""

# 直接用 venv 的 python 執行 app.py(app.py 內以 uvicorn 啟動)
& $VPython "$ScriptDir\app.py"
exit $LASTEXITCODE
