"""字幕／歌詞匯出模組 (export formatters).

將管線產生的 ``Result`` 物件轉換為各種常見格式：

* ``to_lrc``  -> LRC（行級 ``[mm:ss.xx]`` 或加強型逐字 ``<mm:ss.xx>``）
* ``to_srt``  -> SubRip 標準字幕
* ``to_ass``  -> Advanced SubStation Alpha，含卡拉OK ``{\\kNN}`` 標籤
* ``to_json`` -> 美化後的 Result JSON

全部使用純標準函式庫，且對殘缺／空白輸入採容錯處理，
絕不因單一段落異常而拋出例外（graceful degradation）。

``Result`` 形狀（見 API_CONTRACT）::

    {
      "language": str,
      "modeUsed": "auto"|"biasing"|"align",
      "segments": [
        { "id": int, "start": float, "end": float, "text": str,
          "words": [ { "start": float, "end": float, "word": str, "prob": float } ] }
      ],
      "meta": { "modelSize": str, "separated": bool, "durationSec": float, "engine": str }
    }
"""

from __future__ import annotations

import json
from typing import Any, Iterable

__all__ = ["to_lrc", "to_srt", "to_ass", "to_json"]


# ---------------------------------------------------------------------------
# 內部工具函式 (internal helpers)
# ---------------------------------------------------------------------------

def _safe_float(value: Any, default: float = 0.0) -> float:
    """盡量將任意值轉成 float；失敗或為 None/NaN 時回傳 default。"""
    try:
        if value is None:
            return default
        f = float(value)
        # 過濾 NaN / inf（NaN != NaN 為 True）
        if f != f or f in (float("inf"), float("-inf")):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _clamp_nonneg(value: float) -> float:
    """時間不可為負。"""
    return value if value > 0.0 else 0.0


def _segments(result: dict | None) -> list[dict]:
    """安全取出 segments 清單。"""
    if not isinstance(result, dict):
        return []
    segs = result.get("segments")
    if not isinstance(segs, list):
        return []
    return [s for s in segs if isinstance(s, dict)]


def _words(seg: dict) -> list[dict]:
    """安全取出某段落的 words 清單。"""
    words = seg.get("words")
    if not isinstance(words, list):
        return []
    return [w for w in words if isinstance(w, dict)]


def _word_text(w: dict) -> str:
    """取得詞文字（容忍 'word' 或 'text' 欄位）。"""
    txt = w.get("word")
    if txt is None:
        txt = w.get("text")
    return "" if txt is None else str(txt)


def _seg_text(seg: dict) -> str:
    """取得段落文字；若無 text 欄位則由 words 重組。"""
    txt = seg.get("text")
    if txt is not None and str(txt).strip():
        return str(txt)
    # 退而求其次：由逐字拼回
    parts = [_word_text(w) for w in _words(seg)]
    return "".join(parts)


def _fmt_lrc_time(seconds: float) -> str:
    """LRC 時間標籤 ``mm:ss.xx``（百分之一秒，2 位）。

    分鐘不補零上限（>99 分仍正確顯示），秒與百分秒固定 2 位。
    """
    s = _clamp_nonneg(_safe_float(seconds))
    centi_total = int(round(s * 100.0))
    minutes, rem = divmod(centi_total, 60 * 100)
    secs, centi = divmod(rem, 100)
    return f"{minutes:02d}:{secs:02d}.{centi:02d}"


def _fmt_srt_time(seconds: float) -> str:
    """SRT 時間 ``HH:MM:SS,mmm``（毫秒，逗號分隔）。"""
    s = _clamp_nonneg(_safe_float(seconds))
    ms_total = int(round(s * 1000.0))
    hours, rem = divmod(ms_total, 3600 * 1000)
    minutes, rem = divmod(rem, 60 * 1000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _fmt_ass_time(seconds: float) -> str:
    """ASS 時間 ``H:MM:SS.cc``（百分秒，1 位小時）。"""
    s = _clamp_nonneg(_safe_float(seconds))
    centi_total = int(round(s * 100.0))
    hours, rem = divmod(centi_total, 3600 * 100)
    minutes, rem = divmod(rem, 60 * 100)
    secs, centi = divmod(rem, 100)
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{centi:02d}"


def _sorted_segments(result: dict | None) -> list[dict]:
    """依 start 時間排序的段落（穩定排序，缺值視為 0）。"""
    segs = _segments(result)
    return sorted(segs, key=lambda s: _safe_float(s.get("start")))


def _ass_escape(text: str) -> str:
    """ASS 內容跳脫：去除換行、保護大括號避免被當成覆寫標籤。"""
    if not text:
        return ""
    # ASS 以反斜線啟動覆寫；換行用 \N。將實際換行轉為硬換行。
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", r"\N")
    # 裸大括號會破壞 override 區塊，轉成全形以保留視覺
    text = text.replace("{", "｛").replace("}", "｝")
    return text


# ---------------------------------------------------------------------------
# LRC
# ---------------------------------------------------------------------------

def to_lrc(result: dict, level: str = "line") -> str:
    """匯出 LRC 歌詞。

    Args:
        result: Result 物件。
        level: ``"line"`` 行級時間標籤；``"word"`` 加強型逐字標籤
               （每個詞前置 ``<mm:ss.xx>``，相容多數加強型 LRC 播放器）。

    Returns:
        LRC 文字（以 ``\\n`` 分行）。空輸入回傳空字串。
    """
    lines: list[str] = []
    want_word = str(level).lower() == "word"

    for seg in _sorted_segments(result):
        start = _safe_float(seg.get("start"))
        tag = f"[{_fmt_lrc_time(start)}]"

        if want_word:
            words = _words(seg)
            if words:
                pieces: list[str] = []
                for w in words:
                    wt = _word_text(w)
                    if wt == "":
                        continue
                    wstart = _safe_float(w.get("start"), start)
                    pieces.append(f"<{_fmt_lrc_time(wstart)}>{wt}")
                # 行尾再放結束時間，方便播放器收尾
                end = _safe_float(seg.get("end"), start)
                body = "".join(pieces) if pieces else _seg_text(seg).strip()
                line = f"{tag}{body}<{_fmt_lrc_time(end)}>" if pieces else f"{tag}{body}"
                lines.append(line)
                continue
            # 無逐字資訊 -> 退回行級
        text = _seg_text(seg).strip()
        lines.append(f"{tag}{text}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# SRT
# ---------------------------------------------------------------------------

def to_srt(result: dict) -> str:
    """匯出 SubRip (.srt) 標準字幕。

    區塊格式::

        1
        00:00:01,000 --> 00:00:04,000
        歌詞文字

    以空白行分隔，索引從 1 起算（依 start 排序）。
    """
    blocks: list[str] = []
    idx = 1
    for seg in _sorted_segments(result):
        start = _safe_float(seg.get("start"))
        end = _safe_float(seg.get("end"), start)
        # 結束不得早於開始，至少給予極小正時長避免播放器忽略
        if end < start:
            end = start
        text = _seg_text(seg).replace("\r\n", "\n").replace("\r", "\n").strip()
        if text == "" and not _words(seg):
            # 完全空白段落仍輸出（保留時間軸），但給空文字
            text = ""
        block = (
            f"{idx}\n"
            f"{_fmt_srt_time(start)} --> {_fmt_srt_time(end)}\n"
            f"{text}"
        )
        blocks.append(block)
        idx += 1
    # SRT 慣例：區塊間空行，檔尾換行
    return ("\n\n".join(blocks) + "\n") if blocks else ""


# ---------------------------------------------------------------------------
# ASS
# ---------------------------------------------------------------------------

_ASS_HEADER = """[Script Info]
; Script generated by AutoLyrics
Title: AutoLyrics Export
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"""


def to_ass(result: dict, karaoke: bool = True) -> str:
    """匯出 Advanced SubStation Alpha (.ass) 字幕。

    含完整 ``[Script Info]`` / ``[V4+ Styles]`` / ``[Events]`` 標頭。

    Args:
        result: Result 物件。
        karaoke: 若為 True 且段落含逐字時間，於每個詞前置 ``{\\kNN}``，
                 NN 為該詞「持續時間」的百分之一秒（centiseconds），
                 符合 ASS 卡拉OK 規範。否則輸出純文字 Dialogue。

    Returns:
        完整 ASS 檔文字。
    """
    out: list[str] = [_ASS_HEADER]

    for seg in _sorted_segments(result):
        start = _safe_float(seg.get("start"))
        end = _safe_float(seg.get("end"), start)
        if end < start:
            end = start

        text_field = ""
        words = _words(seg) if karaoke else []

        if karaoke and words:
            pieces: list[str] = []
            # 卡拉OK 的每個音節時長以「該詞 end - 詞 start」計，
            # 詞間空隙併入下一個詞的 \k 前，使時間軸連續。
            prev_end = start
            for w in words:
                wt = _ass_escape(_word_text(w))
                wstart = _safe_float(w.get("start"), prev_end)
                wend = _safe_float(w.get("end"), wstart)
                if wend < wstart:
                    wend = wstart
                # 將前一詞結束到本詞開始的空隙，以無字音節吸收，保持同步
                gap_cs = int(round((wstart - prev_end) * 100.0))
                if gap_cs > 0:
                    pieces.append(f"{{\\k{gap_cs}}}")
                dur_cs = int(round((wend - wstart) * 100.0))
                if dur_cs < 0:
                    dur_cs = 0
                pieces.append(f"{{\\k{dur_cs}}}{wt}")
                prev_end = wend
            text_field = "".join(pieces)
            if text_field == "":
                text_field = _ass_escape(_seg_text(seg).strip())
        else:
            text_field = _ass_escape(_seg_text(seg).strip())

        out.append(
            "Dialogue: 0,"
            f"{_fmt_ass_time(start)},{_fmt_ass_time(end)},"
            f"Default,,0,0,0,,{text_field}"
        )

    return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

def to_json(result: dict) -> str:
    """將 Result 物件輸出為美化後的 JSON 字串（UTF-8，保留中文）。

    對非 dict 輸入仍以容錯方式序列化，絕不拋例外。
    """
    try:
        return json.dumps(result, ensure_ascii=False, indent=2)
    except (TypeError, ValueError):
        # 退而求其次：盡量序列化可序列化部分
        try:
            return json.dumps(_coerce_jsonable(result), ensure_ascii=False, indent=2)
        except Exception:  # pragma: no cover - 最終保底
            return "{}"


def _coerce_jsonable(obj: Any) -> Any:
    """遞迴將物件轉為可 JSON 序列化形式（保底用）。"""
    if isinstance(obj, dict):
        return {str(k): _coerce_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_coerce_jsonable(v) for v in obj]
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    return str(obj)
