#!/usr/bin/env bash
# =============================================================================
# AutoLyrics 後端啟動腳本 (Linux / macOS / WSL — bash)
# -----------------------------------------------------------------------------
# 啟用 .venv 並執行 app.py(uvicorn,127.0.0.1:8756)。
#
# 用法:  chmod +x run.sh && ./run.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"
VPYTHON="$VENV_DIR/bin/python"

if [ ! -x "$VPYTHON" ]; then
    echo "✗ 尚未安裝虛擬環境。請先執行:  ./install.sh" >&2
    exit 1
fi

# 啟用 venv(讓子行程也吃到環境;即使 source 失敗仍以 $VPYTHON 直接執行)
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate" 2>/dev/null || true

echo ""
echo "=== 啟動 AutoLyrics 後端 ==="
echo "服務網址:  http://127.0.0.1:8756"
echo "停止服務:  Ctrl + C"
echo ""

exec "$VPYTHON" "$SCRIPT_DIR/app.py"
