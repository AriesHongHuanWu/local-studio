"""
AutoLyrics 辨識引擎管線套件 (pipeline package).

對外只暴露兩類東西:
  - ``run``                          —— 一鍵跑完整管線 (分離 → 辨識/對齊 → 整形)
  - ``to_lrc`` / ``to_srt`` /
    ``to_ass`` / ``to_json``         —— 把 Result 轉成各種輸出格式

設計原則:本套件的 *import 階段* 絕不可因為任一相依模組 (torch / demucs /
faster-whisper / ctc-forced-aligner …) 缺席而炸掉。子模組各自會把重相依包在
try/except 裡優雅降級,而這裡的 re-export 也再加一層保險:即使某個子模組在
開發中暫時無法 import,套件仍可載入,只是對應的符號會變成一個會丟出清楚錯誤
訊息的佔位函式 (lazy stub),而不是讓整個伺服器在啟動時就崩潰。
"""

from __future__ import annotations

import logging
from typing import Any, Callable

logger = logging.getLogger("autolyrics.pipeline")

__all__ = ["run", "to_lrc", "to_srt", "to_ass", "to_json"]


def _missing(symbol: str, module: str, err: Exception) -> Callable[..., Any]:
    """產生一個佔位函式:被呼叫時才丟出清楚的 ImportError。

    這讓「套件可以 import、伺服器可以啟動」與「真的去用一個壞掉的功能時會
    得到明確錯誤」兩件事並存——符合永不讓整個 server 崩潰的契約。
    """

    def _stub(*_args: Any, **_kwargs: Any) -> Any:  # noqa: ANN401
        raise ImportError(
            f"pipeline.{symbol} 無法使用:載入 pipeline.{module} 時失敗 ({err!r})。"
            f" 請確認相依套件已正確安裝 (見 backend/requirements.txt 與 install.ps1)。"
        )

    _stub.__name__ = symbol
    _stub.__qualname__ = symbol
    _stub.__doc__ = (
        f"[佔位] pipeline.{symbol} 目前不可用,因為 pipeline.{module} 載入失敗:{err!r}"
    )
    return _stub


# ── run（主管線）─────────────────────────────────────────────────────────────
try:
    from .pipeline import run as run  # type: ignore[no-redef]
except Exception as _e:  # pragma: no cover - 取決於子模組開發狀態
    logger.warning("pipeline.pipeline 載入失敗,run 將以佔位函式提供:%r", _e)
    run = _missing("run", "pipeline", _e)  # type: ignore[assignment]


# ── 匯出格式函式 ────────────────────────────────────────────────────────────
try:
    from .export import (  # type: ignore[no-redef]
        to_ass as to_ass,
        to_json as to_json,
        to_lrc as to_lrc,
        to_srt as to_srt,
    )
except Exception as _e:  # pragma: no cover - 取決於子模組開發狀態
    logger.warning("pipeline.export 載入失敗,匯出函式將以佔位函式提供:%r", _e)
    to_lrc = _missing("to_lrc", "export", _e)  # type: ignore[assignment]
    to_srt = _missing("to_srt", "export", _e)  # type: ignore[assignment]
    to_ass = _missing("to_ass", "export", _e)  # type: ignore[assignment]
    to_json = _missing("to_json", "export", _e)  # type: ignore[assignment]
