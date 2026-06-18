"""pipeline/transcribe.py — faster-whisper 語音轉文字（含逐字時間戳）。

本模組負責 AutoLyrics 的「辨識」步驟：用 faster-whisper 將（人聲）音訊
轉為帶有 word-level timestamps 的逐句結果。

設計重點：
- 依 (model_size, device, compute_type) 全域快取 WhisperModel，避免重複載入權重。
- compute_type="auto" 會依裝置自動挑選：cuda→float16（8GB OOM 時退回 int8_float16），cpu→int8。
- word_timestamps=True、vad_filter=True、condition_on_previous_text=False（歌曲容易漂移）。
- 任何重型相依（faster_whisper）皆以 try/except 包覆，缺失時拋出清楚錯誤但絕不讓整個 server 崩潰。

回傳格式（與 align.transcribe 對齊，符合 API_CONTRACT 的子結構）：
    {
        "language": str,
        "segments": [
            {
                "start": float, "end": float, "text": str,
                "words": [{"start": float, "end": float, "word": str, "prob": float}],
            },
            ...
        ],
    }
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Optional

logger = logging.getLogger("autolyrics.transcribe")

# 進度回呼型別：progress(stage: str, pct: float, msg: str) -> None
ProgressFn = Optional[Callable[[str, float, str], None]]

# ---------------------------------------------------------------------------
# 選用相依：faster-whisper。缺失時不在 import 期崩潰，改於呼叫時拋出友善錯誤。
# ---------------------------------------------------------------------------
try:  # pragma: no cover - 取決於環境是否安裝
    from faster_whisper import WhisperModel  # type: ignore

    _WHISPER_IMPORT_ERROR: Optional[BaseException] = None
except Exception as exc:  # noqa: BLE001 - 廣泛捕捉，確保 server 不因 import 失敗而死
    WhisperModel = None  # type: ignore[assignment]
    _WHISPER_IMPORT_ERROR = exc
    logger.warning("faster-whisper 未安裝或載入失敗，transcribe 將不可用：%s", exc)


# ---------------------------------------------------------------------------
# 模型快取：以 (model_size, device, compute_type) 為鍵；加鎖避免併發重複載入。
# ---------------------------------------------------------------------------
_MODEL_CACHE: dict[tuple[str, str, str], "WhisperModel"] = {}
_CACHE_LOCK = threading.Lock()


def is_available() -> bool:
    """faster-whisper 是否可用（已安裝且成功載入）。"""
    return WhisperModel is not None


def _resolve_compute_type(compute_type: str, device: str) -> str:
    """將 compute_type='auto' 解析為裝置對應的實際精度。

    - cuda → float16（後續若 OOM 會退回 int8_float16，由 transcribe 處理）
    - cpu  → int8
    其他值（已明確指定）原樣回傳。
    """
    if compute_type and compute_type != "auto":
        return compute_type
    if device == "cuda":
        return "float16"
    return "int8"


def _get_model(model_size: str, device: str, compute_type: str) -> "WhisperModel":
    """取得（或建立並快取）WhisperModel。

    依 (model_size, device, compute_type) 快取。執行緒安全。
    """
    if WhisperModel is None:  # pragma: no cover - 環境相依
        raise RuntimeError(
            "faster-whisper 未安裝，無法進行辨識；請先安裝 `faster-whisper`。"
            f"（原始載入錯誤：{_WHISPER_IMPORT_ERROR!r}）"
        )

    key = (model_size, device, compute_type)
    model = _MODEL_CACHE.get(key)
    if model is not None:
        return model

    with _CACHE_LOCK:
        # double-checked locking：取得鎖後再查一次，避免重複建立。
        model = _MODEL_CACHE.get(key)
        if model is not None:
            return model
        logger.info(
            "載入 WhisperModel：size=%s device=%s compute_type=%s",
            model_size,
            device,
            compute_type,
        )
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        _MODEL_CACHE[key] = model
        return model


def _is_cuda_oom(exc: BaseException) -> bool:
    """粗略判斷例外是否為 CUDA 記憶體不足（OOM）。

    faster-whisper / ctranslate2 在 8GB 顯卡載入 large-v3 float16 時可能 OOM；
    訊息形式不一，故以關鍵字比對。
    """
    text = f"{type(exc).__name__}: {exc}".lower()
    needles = (
        "out of memory",
        "cuda failed with error out of memory",
        "cublas",
        "cudnn",
        "failed to allocate",
        "oom",
    )
    return any(n in text for n in needles)


def _build_words(seg: Any) -> list[dict[str, Any]]:
    """從一個 faster-whisper segment 防禦式地建立 words 清單。

    seg.words 可能為 None（未啟用或該段無字級資訊）。逐字讀取 start/end/word/
    probability，缺值以合理預設補齊，確保下游格式器永遠拿到一致結構。
    """
    words: list[dict[str, Any]] = []
    raw_words = getattr(seg, "words", None)
    if not raw_words:
        return words

    seg_start = float(getattr(seg, "start", 0.0) or 0.0)
    seg_end = float(getattr(seg, "end", seg_start) or seg_start)

    for w in raw_words:
        try:
            w_start = getattr(w, "start", None)
            w_end = getattr(w, "end", None)
            w_text = getattr(w, "word", None)
            w_prob = getattr(w, "probability", None)

            start = float(w_start) if w_start is not None else seg_start
            end = float(w_end) if w_end is not None else start
            text = w_text if w_text is not None else ""
            prob = float(w_prob) if w_prob is not None else 1.0
        except (TypeError, ValueError):  # pragma: no cover - 異常字級資料
            continue

        words.append(
            {
                "start": start,
                "end": end,
                "word": text,
                "prob": prob,
            }
        )

    # 確保最後一字結尾不超出（或不短於）段落範圍時的基本一致性。
    if words and seg_end > words[-1]["end"]:
        # 不強制改寫；保留模型輸出，僅在缺資料時才以段界補。
        pass
    return words


def _run_transcribe(
    model: "WhisperModel",
    audio_path: str,
    *,
    language: Optional[str],
    initial_prompt: Optional[str],
    beam_size: int,
    progress: ProgressFn,
) -> dict[str, Any]:
    """實際呼叫 model.transcribe 並把生成器收斂為固定格式 dict。

    segments 是「生成器」，逐段迭代時才真正進行解碼，因此這裡也順勢回報進度。
    """
    segments_gen, info = model.transcribe(
        audio_path,
        language=language,
        initial_prompt=initial_prompt,
        word_timestamps=True,
        vad_filter=True,
        beam_size=beam_size,
        condition_on_previous_text=False,
    )

    # 以 info.duration 估算進度（若可得）；否則僅回報「辨識中」。
    total_dur = float(getattr(info, "duration", 0.0) or 0.0)
    detected_lang = getattr(info, "language", None) or (language or "")

    out_segments: list[dict[str, Any]] = []
    for seg in segments_gen:  # 生成器：此處才實際解碼
        seg_start = float(getattr(seg, "start", 0.0) or 0.0)
        seg_end = float(getattr(seg, "end", seg_start) or seg_start)
        seg_text = (getattr(seg, "text", "") or "").strip()

        out_segments.append(
            {
                "start": seg_start,
                "end": seg_end,
                "text": seg_text,
                "words": _build_words(seg),
            }
        )

        if progress is not None:
            try:
                if total_dur > 0:
                    pct = max(0.0, min(99.0, (seg_end / total_dur) * 100.0))
                    progress("recognize", pct, f"辨識中… {seg_end:.0f}/{total_dur:.0f}s")
                else:
                    progress("recognize", 50.0, f"辨識中… 已完成 {len(out_segments)} 句")
            except Exception:  # noqa: BLE001 - 進度回呼不得影響主流程
                logger.debug("progress 回呼丟出例外（已忽略）", exc_info=True)

    return {
        "language": str(detected_lang or ""),
        "segments": out_segments,
    }


def transcribe(
    audio_path: str,
    language: Optional[str] = None,
    initial_prompt: Optional[str] = None,
    model_size: str = "large-v3",
    device: str = "cuda",
    compute_type: str = "auto",
    beam_size: int = 5,
    progress: ProgressFn = None,
) -> dict[str, Any]:
    """用 faster-whisper 對音訊做帶逐字時間戳的辨識。

    Args:
        audio_path: 音訊檔路徑（建議為人聲分離後的 vocals.wav）。
        language: Whisper 語言代碼（如 "zh"/"en"/"ja"/"ko"）；None 表自動偵測。
        initial_prompt: 偏置提示（bias prompt），引導術語/風格；可為 None。
        model_size: 模型大小（"large-v3"/"medium"/"small"）。
        device: "cuda" 或 "cpu"。
        compute_type: "auto" 依裝置自動挑精度；或明確指定（如 "float16"/"int8"）。
        beam_size: beam search 寬度。
        progress: progress(stage, pct, msg) 進度回呼；可為 None。

    Returns:
        {
            "language": str,
            "segments": [
                {"start": float, "end": float, "text": str,
                 "words": [{"start","end","word","prob"}]},
                ...
            ],
        }

    Raises:
        RuntimeError: faster-whisper 未安裝時。
        其他底層例外於非 OOM 情況下會原樣往上拋（由呼叫端決定如何處理）。
    """
    if not is_available():
        raise RuntimeError(
            "faster-whisper 未安裝，無法進行辨識；請先安裝 `faster-whisper`。"
            f"（原始載入錯誤：{_WHISPER_IMPORT_ERROR!r}）"
        )

    resolved_ct = _resolve_compute_type(compute_type, device)

    if progress is not None:
        try:
            progress("recognize", 0.0, f"載入模型 {model_size}（{device}/{resolved_ct}）…")
        except Exception:  # noqa: BLE001
            logger.debug("progress 回呼丟出例外（已忽略）", exc_info=True)

    # --- 第一次嘗試 ---
    try:
        model = _get_model(model_size, device, resolved_ct)
        return _run_transcribe(
            model,
            audio_path,
            language=language,
            initial_prompt=initial_prompt,
            beam_size=beam_size,
            progress=progress,
        )
    except Exception as exc:  # noqa: BLE001 - 需判斷是否為可重試的 CUDA OOM
        # 僅在「cuda + 並非已是 int8 系列」且看起來像 OOM 時退回較省記憶體的精度。
        is_cuda = device == "cuda"
        already_low = resolved_ct in ("int8", "int8_float16", "int8_float32")
        if is_cuda and not already_low and _is_cuda_oom(exc):
            logger.warning(
                "偵測到 CUDA OOM（compute_type=%s），退回 int8_float16 重試：%s",
                resolved_ct,
                exc,
            )
            if progress is not None:
                try:
                    progress("recognize", 0.0, "顯卡記憶體不足，改用 int8_float16 重試…")
                except Exception:  # noqa: BLE001
                    logger.debug("progress 回呼丟出例外（已忽略）", exc_info=True)

            fallback_ct = "int8_float16"
            try:
                # 清掉可能半載入的失敗模型快取鍵，避免污染。
                with _CACHE_LOCK:
                    _MODEL_CACHE.pop((model_size, device, resolved_ct), None)
                model = _get_model(model_size, device, fallback_ct)
                return _run_transcribe(
                    model,
                    audio_path,
                    language=language,
                    initial_prompt=initial_prompt,
                    beam_size=beam_size,
                    progress=progress,
                )
            except Exception as exc2:  # noqa: BLE001
                logger.error("int8_float16 退回後仍失敗：%s", exc2)
                raise
        # 非可重試情況：原樣往上拋，由 pipeline 層決定如何降級或回報。
        logger.error("辨識失敗（device=%s compute_type=%s）：%s", device, resolved_ct, exc)
        raise
