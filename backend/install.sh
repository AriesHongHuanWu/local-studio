#!/usr/bin/env bash
# =============================================================================
# AutoLyrics 後端安裝腳本 (Linux / macOS / WSL — bash)
# -----------------------------------------------------------------------------
# 1) 建立虛擬環境 .venv
# 2) 升級 pip
# 3) 安裝 PyTorch + torchaudio
#       - 偵測到 NVIDIA GPU -> cu128 wheel(Blackwell / RTX 5060 sm_120 需要)
#       - 無 NVIDIA -> 預設 PyPI 的 CPU 版
# 4) 安裝 requirements.txt 其餘相依
#
# 用法:  chmod +x install.sh && ./install.sh
# =============================================================================
set -euo pipefail

# 切換到腳本所在目錄(backend/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "=== AutoLyrics 後端安裝 ==="
echo "工作目錄: $SCRIPT_DIR"
echo ""

# --- 找到 Python ------------------------------------------------------------
PYCMD=""
for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1; then
        PYCMD="$c"
        break
    fi
done
if [ -z "$PYCMD" ]; then
    echo "✗ 找不到 Python。請先安裝 Python 3.10 - 3.12。" >&2
    exit 1
fi
echo "✓ 使用 Python: $($PYCMD --version 2>&1)"

# --- 建立虛擬環境 -----------------------------------------------------------
VENV_DIR="$SCRIPT_DIR/.venv"
if [ -d "$VENV_DIR" ]; then
    echo "→ 已存在 .venv,沿用既有虛擬環境。"
else
    echo "→ 建立虛擬環境 .venv …"
    "$PYCMD" -m venv "$VENV_DIR"
fi

VPYTHON="$VENV_DIR/bin/python"
if [ ! -x "$VPYTHON" ]; then
    echo "✗ 找不到 venv 內的 python: $VPYTHON" >&2
    exit 1
fi

# --- 升級 pip ---------------------------------------------------------------
echo "→ 升級 pip / setuptools / wheel …"
"$VPYTHON" -m pip install --upgrade pip setuptools wheel

# --- 偵測 NVIDIA GPU --------------------------------------------------------
HAS_NVIDIA=0
if command -v nvidia-smi >/dev/null 2>&1; then
    if nvidia-smi >/dev/null 2>&1; then
        HAS_NVIDIA=1
    fi
fi

# --- 安裝 PyTorch + torchaudio ---------------------------------------------
if [ "$HAS_NVIDIA" -eq 1 ]; then
    echo ""
    echo "✓ 偵測到 NVIDIA GPU → 安裝 CUDA (cu128) 版 PyTorch"
    echo "  (RTX 5060 / Blackwell sm_120 需要 cu128 wheel)"
    if ! "$VPYTHON" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128; then
        echo "⚠ cu128 安裝失敗,改裝 CPU 版 PyTorch 作為後備。"
        "$VPYTHON" -m pip install torch torchvision torchaudio
    fi
else
    echo ""
    echo "ℹ 未偵測到 NVIDIA GPU → 安裝 CPU 版 PyTorch(預設 PyPI)。"
    echo "  辨識仍可運作,但速度較慢。"
    "$VPYTHON" -m pip install torch torchvision torchaudio
fi

# --- 安裝其餘相依 -----------------------------------------------------------
REQ="$SCRIPT_DIR/requirements.txt"
if [ -f "$REQ" ]; then
    echo ""
    echo "→ 安裝 requirements.txt 相依套件 …"
    "$VPYTHON" -m pip install -r "$REQ"
else
    echo "⚠ 找不到 requirements.txt,略過。"
fi

# --- 安裝 LaMa inpainting (--no-deps,文字移除模式的 AI 引擎) ----------------
# simple-lama-inpainting 把 numpy<2 / pillow<10 釘得過保守,直接裝會把 cu128
# 技術棧降版弄壞;它實測在 numpy 2.x / pillow 12 上運作正常,故 --no-deps 跳過
# 那些過時釘選。失敗只警告、不中止 —— LaMa 不可用時會自動退回 OpenCV 後備。
echo ""
echo "→ 安裝 LaMa inpainting (simple-lama-inpainting, --no-deps) …"
if ! "$VPYTHON" -m pip install --no-deps simple-lama-inpainting; then
    echo "⚠ LaMa 安裝失敗 —— 文字移除會退回 OpenCV 後備 (品質略降,功能仍可用)。"
fi

echo ""
echo "=== 安裝完成! ==="
echo "啟動服務:  ./run.sh"
echo "服務網址:  http://127.0.0.1:8756"
echo ""
