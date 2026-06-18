"""AutoLyrics 辨識管線總協調器(orchestrator)。

`run()` 串接四個子步驟,並按照 API_CONTRACT.md 的 `Result` 形狀回傳:

    1. 解析裝置(device auto -> cuda / cpu)
    2. (可選)Demucs 人聲分離
    3. 依 mode 派工:align(完整歌詞強制對齊)/ biasing(提示偏置辨識)/ auto(純辨識)
    4. 指派 segment id、計算 durationSec,組裝最終 Result

設計原則:任何重型相依(torch / soundfile / 子模組)缺席或失敗都不可讓整個
伺服器崩潰 —— 一律以 try/except 包覆並優雅降級。`progress(stage, pct, msg)`
會被轉發到各子步驟,並切成合理的 pct 分段(分離 0-40、辨識 40-95、收尾 95-100)。
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from . import config
from . import separate as _separate
from . import transcribe as _transcribe
from . import align as _align

logger = logging.getLogger("autolyrics.pipeline")

# progress callback 型別:progress(stage: str, pct: float, msg: str) -> None
ProgressFn = Callable[[str, float, str], None]


# ---------------------------------------------------------------------------
# 內部工具
# ---------------------------------------------------------------------------
def _noop_progress(stage: str, pct: float, msg: str) -> None:
    """預設的空 progress callback。"""
    return None


class _MonotonicProgress:
    """包裝對外 progress callback,確保回報的 pct 永不倒退。

    子步驟各自從 0 開始回報、加上各階段的開場訊息,會在邊界產生 1~2 pct 的
    視覺回跳。這個包裝把每次 pct clamp 到「目前已達最大值」之上,讓三段式
    stepper 的全域進度條始終單調遞增。stage / msg 仍原樣傳遞。
    """

    def __init__(self, inner: Optional[ProgressFn]) -> None:
        self._inner = inner
        self._max = 0.0

    def __call__(self, stage: str, pct: float, msg: str) -> None:
        if self._inner is None:
            return
        try:
            p = float(pct)
        except (TypeError, ValueError):
            p = self._max
        if p < self._max:
            p = self._max
        else:
            self._max = p
        try:
            self._inner(stage, p, msg)
        except Exception:  # pragma: no cover - 防禦性
            logger.debug("progress callback raised; ignored", exc_info=True)


def _safe_progress(progress: Optional[ProgressFn], stage: str, pct: float, msg: str) -> None:
    """呼叫 progress callback,任何例外都吞掉(回報進度絕不能讓管線中斷)。"""
    if progress is None:
        return
    try:
        progress(stage, float(pct), msg)
    except Exception:  # pragma: no cover - 防禦性
        logger.debug("progress callback raised; ignored", exc_info=True)


def _band_progress(
    progress: Optional[ProgressFn],
    lo: float,
    hi: float,
    stage_label: str,
) -> ProgressFn:
    """產生一個把子步驟 0..100 的 pct 重新映射到 [lo, hi] 區間的 callback。

    這樣 separate / transcribe / align 內部即使各自回報 0-100,對外仍呈現
    連續遞增的全域進度條(分離 0-40、辨識 40-95、收尾 95-100)。
    """

    span = max(0.0, hi - lo)

    def _inner(stage: str, pct: float, msg: str) -> None:
        try:
            p = float(pct)
        except (TypeError, ValueError):
            p = 0.0
        p = max(0.0, min(100.0, p))
        global_pct = lo + (p / 100.0) * span
        # 子步驟可能會回報自己的 stage 字串;統一掛上區段標籤讓 UI 三段式 stepper 對齊。
        _safe_progress(progress, stage or stage_label, global_pct, msg)

    return _inner


def _resolve_device(device: str) -> str:
    """解析 device:'auto' -> 若 torch.cuda 可用則 cuda,否則 cpu。

    torch 在 try 內 import —— 缺席或匯入失敗時退回 cpu,絕不拋出。
    """
    dev = (device or "auto").strip().lower()
    if dev in ("cuda", "cpu"):
        return dev
    if dev != "auto":
        # 非預期值,保守退回 auto 解析
        logger.warning("未知 device %r,改以 auto 解析", device)

    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        logger.info("torch 不可用或無 CUDA,改用 CPU", exc_info=False)
    return "cpu"


def _probe_duration(audio_path: str, segments: list[dict]) -> float:
    """計算音訊總長度(秒)。

    優先用 soundfile 讀檔頭(frames / samplerate);失敗則退回最後一個 word 的
    end,再退回最後一個 segment 的 end,最後退回 0.0。
    """
    # 1) soundfile 讀檔頭(快,不載入整段音訊)
    try:
        import soundfile as sf  # type: ignore

        info = sf.info(audio_path)
        if info.samplerate:
            dur = float(info.frames) / float(info.samplerate)
            if dur > 0:
                return round(dur, 3)
    except Exception:
        logger.debug("soundfile 無法取得時長,改用詞/段落 end 回退", exc_info=True)

    # 2) 回退:最後一個 word 的 end
    last = 0.0
    for seg in segments:
        for w in seg.get("words") or []:
            try:
                last = max(last, float(w.get("end") or 0.0))
            except (TypeError, ValueError):
                continue
    if last > 0:
        return round(last, 3)

    # 3) 回退:最後一個 segment 的 end
    for seg in segments:
        try:
            last = max(last, float(seg.get("end") or 0.0))
        except (TypeError, ValueError):
            continue
    return round(last, 3)


def _normalize_segments(raw_segments: Any) -> list[dict]:
    """把子步驟回傳的 segments 正規化成 Result.segments 形狀並指派 id。

    強制每個 segment 具備 id / start / end / text / words,且每個 word 具備
    start / end / word / prob —— 缺漏一律補預設值,避免下游(export / 前端)崩潰。
    """
    out: list[dict] = []
    if not isinstance(raw_segments, list):
        return out

    for idx, seg in enumerate(raw_segments):
        if not isinstance(seg, dict):
            continue

        words_out: list[dict] = []
        for w in seg.get("words") or []:
            if not isinstance(w, dict):
                continue
            try:
                w_start = float(w.get("start") or 0.0)
            except (TypeError, ValueError):
                w_start = 0.0
            try:
                w_end = float(w.get("end") or 0.0)
            except (TypeError, ValueError):
                w_end = 0.0
            try:
                prob = float(w.get("prob") if w.get("prob") is not None else 1.0)
            except (TypeError, ValueError):
                prob = 1.0
            # prob 夾在 0..1
            prob = max(0.0, min(1.0, prob))
            words_out.append(
                {
                    "start": w_start,
                    "end": w_end,
                    "word": str(w.get("word", "")),
                    "prob": prob,
                }
            )

        try:
            s_start = float(seg.get("start") or 0.0)
        except (TypeError, ValueError):
            s_start = 0.0
        try:
            s_end = float(seg.get("end") or 0.0)
        except (TypeError, ValueError):
            s_end = 0.0

        # 若 segment 缺 start/end 但有 words,用 words 邊界補齊
        if words_out:
            if not s_start:
                s_start = words_out[0]["start"]
            if not s_end:
                s_end = words_out[-1]["end"]

        out.append(
            {
                "id": idx,
                "start": s_start,
                "end": s_end,
                "text": str(seg.get("text", "")).strip("\n") if seg.get("text") is not None else "",
                "words": words_out,
            }
        )

    return out


# ---------------------------------------------------------------------------
# 主協調器
# ---------------------------------------------------------------------------
def run(
    audio_path: str,
    *,
    mode: str = "auto",
    reference_lyrics: str = "",
    reference_content: str = "",
    style_keys: Optional[list[str]] = None,
    language: Optional[str] = None,
    model_size: str = "large-v3",
    separate: bool = True,
    device: str = "auto",
    engine: str = "whisper",
    progress: Optional[ProgressFn] = None,
) -> dict:
    """跑完整辨識/對齊管線,回傳符合 API_CONTRACT 的 Result dict。

    參數
    ----
    audio_path: 待處理的音訊檔路徑。
    mode: "auto" | "biasing" | "align"。
        - "align" 且 reference_lyrics 非空 -> 走強制對齊(完整歌詞,接近完美)。
        - "biasing" -> 用 build_bias_prompt 組 initial_prompt 餵給辨識器偏置。
        - 其他("auto")-> 純辨識。
    reference_lyrics: 完整歌詞(多行,line break 有意義),供 align 使用,亦作偏置素材。
    reference_content: 自由形式提示文字,供 biasing 使用。
    style_keys: 曲風 preset key 列表(對應 config.STYLE_PRESETS)。
    language: whisper 語言碼或 None(自動偵測)。align 時透過 to_iso3 轉 ISO-639-3。
    model_size: "large-v3" | "medium" | "small"。
    separate: 是否先跑 Demucs 人聲分離。
    device: "auto" | "cuda" | "cpu"。
    engine: 目前僅 "whisper"。
    progress: progress(stage, pct, msg) 全域進度回報。

    回傳
    ----
    {
      "language": str,
      "modeUsed": "auto" | "biasing" | "align",
      "segments": [ {"id","start","end","text","words":[...]} ],
      "meta": {"modelSize","separated","durationSec","engine"}
    }
    """
    if progress is None:
        progress = _noop_progress
    # 全程以單調包裝,確保全域 pct 不倒退(三段式 stepper 邊界平滑)。
    progress = _MonotonicProgress(progress)
    style_keys = style_keys or []
    reference_lyrics = reference_lyrics or ""
    reference_content = reference_content or ""
    mode = (mode or "auto").strip().lower()
    engine = engine or "whisper"

    _safe_progress(progress, "init", 0.0, "準備中 · Preparing")

    # --- 1) 解析裝置 ---------------------------------------------------------
    resolved_device = _resolve_device(device)
    logger.info("device 解析:%r -> %r", device, resolved_device)

    # --- 2) 人聲分離(0-40)-------------------------------------------------
    vocals_path = audio_path
    separated = False
    if separate:
        try:
            if _separate.is_available():
                _safe_progress(progress, "separate", 1.0, "分離人聲 · Separating vocals")
                sep_progress = _band_progress(progress, 0.0, 40.0, "separate")
                result_path = _separate.separate_vocals(
                    audio_path,
                    out_dir=_sep_out_dir(audio_path),
                    device=resolved_device,
                    progress=sep_progress,
                )
                if result_path and result_path != audio_path:
                    vocals_path = result_path
                    separated = True
                else:
                    # separate_vocals 已優雅退回原檔(內部失敗或 demucs 缺席)
                    vocals_path = audio_path
                    separated = False
            else:
                logger.info("Demucs 不可用,跳過人聲分離")
                _safe_progress(progress, "separate", 40.0, "略過人聲分離 · Demucs unavailable")
        except Exception:
            # 任何分離例外 -> 退回原音訊,絕不中斷
            logger.warning("人聲分離失敗,改用原始音訊", exc_info=True)
            vocals_path = audio_path
            separated = False
    else:
        _safe_progress(progress, "separate", 40.0, "未啟用人聲分離 · Separation off")

    # 確保進入辨識前進度至少到 40
    _safe_progress(progress, "recognize", 40.0, "開始辨識 · Starting recognition")

    # --- 3) 派工:align / biasing / auto(40-95)----------------------------
    recog_progress = _band_progress(progress, 40.0, 95.0, "recognize")
    mode_used = "auto"
    recog: dict[str, Any] = {"language": "", "segments": []}

    want_align = mode == "align" and reference_lyrics.strip()

    if want_align:
        # 完整歌詞強制對齊。若 aligner 不可用則優雅退回辨識。
        aligner_ok = False
        try:
            aligner_ok = _align.is_available()
        except Exception:
            logger.warning("aligner is_available 檢查失敗", exc_info=True)
            aligner_ok = False

        if aligner_ok:
            try:
                iso3 = config.to_iso3(language)
                _safe_progress(progress, "align", 41.0, "強制對齊 · Forced alignment")
                recog = _align.align(
                    vocals_path,
                    reference_lyrics,
                    language=iso3,
                    device=resolved_device,
                    progress=recog_progress,
                )
                mode_used = "align"
            except Exception:
                logger.warning("強制對齊失敗,改走辨識(biasing 回退)", exc_info=True)
                recog = _fallback_transcribe(
                    vocals_path,
                    language=language,
                    initial_prompt=_safe_bias_prompt(style_keys, reference_content, reference_lyrics),
                    model_size=model_size,
                    device=resolved_device,
                    progress=recog_progress,
                )
                mode_used = "biasing"
        else:
            logger.info("aligner 不可用,align 模式回退為 biasing 辨識")
            recog = _fallback_transcribe(
                vocals_path,
                language=language,
                initial_prompt=_safe_bias_prompt(style_keys, reference_content, reference_lyrics),
                model_size=model_size,
                device=resolved_device,
                progress=recog_progress,
            )
            mode_used = "biasing"

    elif mode == "biasing":
        initial_prompt = _safe_bias_prompt(style_keys, reference_content, reference_lyrics)
        _safe_progress(progress, "recognize", 41.0, "偏置辨識 · Biased recognition")
        recog = _fallback_transcribe(
            vocals_path,
            language=language,
            initial_prompt=initial_prompt,
            model_size=model_size,
            device=resolved_device,
            progress=recog_progress,
        )
        mode_used = "biasing"

    else:
        # 純辨識(auto)
        _safe_progress(progress, "recognize", 41.0, "辨識中 · Transcribing")
        recog = _fallback_transcribe(
            vocals_path,
            language=language,
            initial_prompt=None,
            model_size=model_size,
            device=resolved_device,
            progress=recog_progress,
        )
        mode_used = "auto"

    if not isinstance(recog, dict):
        logger.warning("辨識/對齊回傳非 dict(%r),改用空結果", type(recog))
        recog = {"language": "", "segments": []}

    # --- 4) 收尾:指派 id、算時長、組裝 Result(95-100)---------------------
    _safe_progress(progress, "finalize", 95.0, "整理結果 · Finalizing")

    segments = _normalize_segments(recog.get("segments"))
    duration = _probe_duration(audio_path, segments)
    out_language = recog.get("language") or (language or "")

    result: dict[str, Any] = {
        "language": str(out_language),
        "modeUsed": mode_used,
        "segments": segments,
        "meta": {
            "modelSize": model_size,
            "separated": bool(separated),
            "durationSec": float(duration),
            "engine": engine,
        },
    }

    _safe_progress(progress, "done", 100.0, "完成 · Done")
    return result


# ---------------------------------------------------------------------------
# 子步驟薄包裝(集中錯誤處理)
# ---------------------------------------------------------------------------
def _sep_out_dir(audio_path: str) -> str:
    """為 Demucs 輸出選一個目錄(音訊檔同層的子資料夾)。"""
    import os

    base = os.path.dirname(os.path.abspath(audio_path)) or "."
    out = os.path.join(base, "_separated")
    try:
        os.makedirs(out, exist_ok=True)
    except Exception:
        logger.debug("無法建立分離輸出目錄,改用音訊檔同層", exc_info=True)
        return base
    return out


def _safe_bias_prompt(
    style_keys: list[str],
    reference_content: str,
    partial_lyrics: str,
) -> Optional[str]:
    """安全地呼叫 config.build_bias_prompt;失敗則回 None(等同無偏置)。"""
    try:
        prompt = config.build_bias_prompt(style_keys, reference_content, partial_lyrics)
        prompt = (prompt or "").strip()
        return prompt or None
    except Exception:
        logger.warning("build_bias_prompt 失敗,改用無偏置提示", exc_info=True)
        return None


def _fallback_transcribe(
    audio_path: str,
    *,
    language: Optional[str],
    initial_prompt: Optional[str],
    model_size: str,
    device: str,
    progress: Optional[ProgressFn],
) -> dict:
    """呼叫 transcribe.transcribe;任何例外回傳空結果結構,不讓管線崩潰。"""
    try:
        out = _transcribe.transcribe(
            audio_path,
            language=language,
            initial_prompt=initial_prompt,
            model_size=model_size,
            device=device,
            progress=progress,
        )
        if isinstance(out, dict):
            return out
        logger.warning("transcribe 回傳非 dict(%r),改用空結果", type(out))
    except Exception:
        logger.error("辨識失敗,回傳空結果", exc_info=True)
    return {"language": language or "", "segments": []}
