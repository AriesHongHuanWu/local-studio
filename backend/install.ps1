# =============================================================================
# AutoLyrics 後端安裝腳本 (Windows / PowerShell)
# -----------------------------------------------------------------------------
# 1) 建立虛擬環境 .venv
# 2) 升級 pip
# 3) 安裝 PyTorch + torchaudio
#       - 偵測到 NVIDIA GPU -> cu128 wheel(Blackwell / RTX 5060 sm_120 需要)
#       - 無 NVIDIA -> 預設 PyPI 的 CPU 版
# 4) 安裝 requirements.txt 其餘相依
#
# 用法:  在 backend\ 目錄下,以 PowerShell 執行
#        > .\install.ps1
#  若被執行原則擋下,先跑:
#        > Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
# =============================================================================

# -PythonExe:直接指定要用的 Python 執行檔(略過系統 PATH 搜尋)。供「可攜 Python」
#   使用 —— 例如先跑 scripts\fetch-portable-python.ps1,再:
#     .\install.ps1 -PythonExe ..\frontend\src-tauri\resources\python\python.exe
param([string]$PythonExe = "")

$ErrorActionPreference = "Stop"

# 切換到腳本所在目錄(backend\),確保相對路徑正確
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host ""
Write-Host "=== AutoLyrics 後端安裝 ===" -ForegroundColor Cyan
Write-Host "工作目錄: $ScriptDir" -ForegroundColor DarkGray
Write-Host ""

# --- 找到 Python ------------------------------------------------------------
function Find-Python {
    foreach ($cmd in @("python", "py -3", "python3")) {
        $parts = $cmd.Split(" ")
        $exe = $parts[0]
        $found = Get-Command $exe -ErrorAction SilentlyContinue
        if ($found) {
            try {
                & $exe @($parts[1..($parts.Length-1)]) --version *> $null
                if ($LASTEXITCODE -eq 0) { return $cmd }
            } catch { }
        }
    }
    return $null
}

if ($PythonExe) {
    # 明確指定的 Python(可攜 Python 路徑,可能含空白)—— 不做 PATH 搜尋、不切分空白。
    if (-not (Test-Path $PythonExe)) {
        Write-Host "✗ 指定的 -PythonExe 不存在: $PythonExe" -ForegroundColor Red
        exit 1
    }
    $PyExe  = (Resolve-Path $PythonExe).Path
    $PyArgs = @()
    Write-Host "✓ 使用指定 Python(可攜): $PyExe" -ForegroundColor Green
} else {
    $PyCmd = Find-Python
    if (-not $PyCmd) {
        Write-Host "✗ 找不到 Python。請先安裝 Python 3.10 - 3.12,並勾選 Add to PATH。" -ForegroundColor Red
        Write-Host "  (或先跑 scripts\fetch-portable-python.ps1 再用 -PythonExe 指定可攜 Python)" -ForegroundColor Yellow
        Write-Host "  下載: https://www.python.org/downloads/" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "✓ 使用 Python: $PyCmd" -ForegroundColor Green
    $PyParts = $PyCmd.Split(" ")
    $PyExe   = $PyParts[0]
    $PyArgs  = @($PyParts[1..($PyParts.Length-1)])
}

# --- 建立虛擬環境 -----------------------------------------------------------
$VenvDir = Join-Path $ScriptDir ".venv"
if (Test-Path $VenvDir) {
    Write-Host "→ 已存在 .venv,沿用既有虛擬環境。" -ForegroundColor DarkGray
} else {
    Write-Host "→ 建立虛擬環境 .venv …" -ForegroundColor Cyan
    & $PyExe @PyArgs -m venv "$VenvDir"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ 建立虛擬環境失敗。" -ForegroundColor Red
        exit 1
    }
}

# venv 內的 python
$VPython = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $VPython)) {
    Write-Host "✗ 找不到 venv 內的 python: $VPython" -ForegroundColor Red
    exit 1
}

# --- 升級 pip ---------------------------------------------------------------
Write-Host "→ 升級 pip / setuptools / wheel …" -ForegroundColor Cyan
& $VPython -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ 升級 pip 失敗。" -ForegroundColor Red
    exit 1
}

# --- 偵測 NVIDIA GPU --------------------------------------------------------
$HasNvidia = $false
$nvsmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
if ($nvsmi) {
    try {
        & nvidia-smi *> $null
        if ($LASTEXITCODE -eq 0) { $HasNvidia = $true }
    } catch { }
}

# --- 安裝 PyTorch + torchaudio ---------------------------------------------
if ($HasNvidia) {
    Write-Host ""
    Write-Host "✓ 偵測到 NVIDIA GPU → 安裝 CUDA (cu128) 版 PyTorch" -ForegroundColor Green
    Write-Host "  (RTX 5060 / Blackwell sm_120 需要 cu128 wheel)" -ForegroundColor DarkGray
    & $VPython -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
    if ($LASTEXITCODE -ne 0) {
        Write-Host "⚠ cu128 安裝失敗,改裝 CPU 版 PyTorch 作為後備。" -ForegroundColor Yellow
        & $VPython -m pip install torch torchvision torchaudio
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✗ PyTorch 安裝失敗。" -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host ""
    Write-Host "ℹ 未偵測到 NVIDIA GPU → 安裝 CPU 版 PyTorch(預設 PyPI)。" -ForegroundColor Yellow
    Write-Host "  辨識仍可運作,但速度較慢。" -ForegroundColor DarkGray
    & $VPython -m pip install torch torchvision torchaudio
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ PyTorch 安裝失敗。" -ForegroundColor Red
        exit 1
    }
}

# --- 安裝其餘相依 -----------------------------------------------------------
$Req = Join-Path $ScriptDir "requirements.txt"
if (Test-Path $Req) {
    Write-Host ""
    Write-Host "→ 安裝 requirements.txt 相依套件 …" -ForegroundColor Cyan
    & $VPython -m pip install -r "$Req"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ requirements.txt 安裝失敗。" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "⚠ 找不到 requirements.txt,略過。" -ForegroundColor Yellow
}

# --- 安裝 LaMa inpainting (--no-deps,文字移除模式的 AI 引擎) ----------------
# simple-lama-inpainting 把 numpy<2 / pillow<10 釘得過保守,直接裝會把 cu128
# 技術棧降版弄壞;它實測在 numpy 2.x / pillow 12 上運作正常,故 --no-deps 跳過
# 那些過時釘選。失敗只警告、不中止 —— LaMa 不可用時會自動退回 OpenCV 後備。
Write-Host ""
Write-Host "→ 安裝 LaMa inpainting (simple-lama-inpainting, --no-deps) …" -ForegroundColor Cyan
& $VPython -m pip install --no-deps simple-lama-inpainting
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ LaMa 安裝失敗 —— 文字移除會退回 OpenCV 後備 (品質略降,功能仍可用)。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== 安裝完成! ===" -ForegroundColor Green
Write-Host "啟動服務:  .\run.ps1" -ForegroundColor Cyan
Write-Host "服務網址:  http://127.0.0.1:8756" -ForegroundColor Cyan
Write-Host ""
