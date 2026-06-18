"""人聲分離模組（Demucs v4，底層 API）。

提供 :func:`separate_vocals`，使用 Demucs htdemucs 模型把伴奏與人聲分離，
回傳「人聲」.wav 的路徑，讓後續 Whisper / 對齊步驟在乾淨人聲上運作，提高辨識準確度。

實作備註
--------
PyPI 的 demucs 4.0.1 **沒有** `demucs.api` 便利模組,因此改用底層 API:
  demucs.pretrained.get_model → demucs.apply.apply_model → demucs.audio.save_audio。
mp3 等格式的解碼不依賴系統 ffmpeg:優先用 torchaudio,失敗則用 PyAV
(faster-whisper 的相依,已內含 ffmpeg 函式庫)解碼,最後退回 soundfile。

設計原則:優雅降級。任何相依缺失 / 模型下載失敗 / 分離失敗,**絕不**讓伺服器崩潰,
而是記錄警告並回傳「原始」音檔路徑,讓 pipeline 仍可在原始混音上繼續辨識。

對外契約:
  - is_available() -> bool
  - separate_vocals(audio_path, out_dir, model_name="htdemucs", device="cuda", progress=None) -> str
  - progress(stage, pct, msg):本步驟內部 0..100,由上層 pipeline 映射到 0-40 進度帶。
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Callable, Optional

logger = logging.getLogger("autolyrics.separate")

_STAGE = "separate"
ProgressFn = Callable[[str, float, str], None]

# --------------------------------------------------------------------------- #
# 可選相依偵測（底層 demucs API）
# --------------------------------------------------------------------------- #
_DEMUCS_AVAILABLE = False
_IMPORT_ERROR: Optional[str] = None

try:  # pragma: no cover - 取決於執行環境
    import torch  # type: ignore
    import torchaudio  # type: ignore
    from demucs.apply import apply_model  # type: ignore
    from demucs.pretrained import get_model  # type: ignore

    try:
        from demucs.audio import save_audio as _demucs_save_audio  # type: ignore
    except Exception:  # 極少數版本路徑不同 → 退回 torchaudio.save
        _demucs_save_audio = None  # type: ignore

    _DEMUCS_AVAILABLE = True
except Exception as exc:
    torch = None  # type: ignore
    torchaudio = None  # type: ignore
    apply_model = None  # type: ignore
    get_model = None  # type: ignore
    _demucs_save_audio = None  # type: ignore
    _IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
    logger.info("Demucs 不可用，將跳過人聲分離（%s）", _IMPORT_ERROR)

# 模型快取(權重不小,避免每個 job 重載)
_MODEL_CACHE: dict[str, Any] = {}
_MODEL_LOCK = threading.Lock()


def _emit(progress: Optional[ProgressFn], pct: float, msg: str) -> None:
    if progress is None:
        return
    try:
        progress(_STAGE, float(pct), msg)
    except Exception:  # pragma: no cover
        logger.debug("progress 回呼丟出例外，已忽略", exc_info=True)


def is_available() -> bool:
    """回傳 Demucs 人聲分離是否可用(僅檢查相依匯入)。"""
    return _DEMUCS_AVAILABLE


def _resolve_device(device: str) -> str:
    dev = (device or "cpu").strip().lower()
    if dev.startswith("cuda"):
        try:
            if torch is not None and torch.cuda.is_available():  # type: ignore[union-attr]
                return "cuda"
        except Exception:  # pragma: no cover
            logger.debug("torch.cuda 探測失敗，退回 CPU", exc_info=True)
        logger.warning("要求 device=cuda 但 CUDA 不可用，退回 CPU 進行人聲分離")
        return "cpu"
    return dev


def _get_model(model_name: str) -> Any:
    cached = _MODEL_CACHE.get(model_name)
    if cached is not None:
        return cached
    with _MODEL_LOCK:
        cached = _MODEL_CACHE.get(model_name)
        if cached is not None:
            return cached
        logger.info("載入 Demucs 模型 %s（首次會下載權重）", model_name)
        model = get_model(model_name)  # type: ignore[misc]
        model.eval()
        _MODEL_CACHE[model_name] = model
        return model


def _load_audio_tensor(path: str, samplerate: int, channels: int) -> Any:
    """把音檔解碼成 (channels, frames) 的 float32 Tensor,取樣率= samplerate。

    解碼後備鏈:torchaudio → PyAV(faster-whisper 相依,內含 ffmpeg)→ soundfile。
    任一成功即回傳;全失敗則拋例外(由呼叫端降級)。
    """
    last_err: Optional[Exception] = None

    # 1) torchaudio
    try:
        wav, sr = torchaudio.load(path)  # type: ignore[union-attr]  # (ch, n)
        wav = _fit(wav, sr, samplerate, channels)
        return wav
    except Exception as exc:
        last_err = exc
        logger.debug("torchaudio.load 失敗,改用 PyAV(%s)", exc)

    # 2) PyAV(透過 faster-whisper 的 decode_audio,內含 ffmpeg,免系統安裝)
    try:
        from faster_whisper.audio import decode_audio  # type: ignore

        if channels == 2:
            left, right = decode_audio(path, sampling_rate=samplerate, split_stereo=True)
            import numpy as np  # type: ignore

            arr = np.stack([left, right], axis=0)
        else:
            mono = decode_audio(path, sampling_rate=samplerate)
            import numpy as np  # type: ignore

            arr = mono[None, :]
        return torch.from_numpy(arr).float()  # type: ignore[union-attr]
    except Exception as exc:
        last_err = exc
        logger.debug("PyAV decode 失敗,改用 soundfile(%s)", exc)

    # 3) soundfile(主要支援 wav/flac/ogg)
    try:
        import soundfile as sf  # type: ignore

        data, sr = sf.read(path, always_2d=True)  # (n, ch)
        wav = torch.from_numpy(data.T).float()  # type: ignore[union-attr]
        wav = _fit(wav, sr, samplerate, channels)
        return wav
    except Exception as exc:
        last_err = exc

    raise RuntimeError(f"無法解碼音檔:{last_err}")


def _fit(wav: Any, sr: int, target_sr: int, channels: int) -> Any:
    """調整聲道數與取樣率。"""
    if wav.dim() == 1:
        wav = wav.unsqueeze(0)
    # 聲道
    cur = wav.shape[0]
    if cur < channels:  # mono → stereo
        wav = wav.repeat(channels, 1)
    elif cur > channels:  # 多聲道 → 取前 channels(或平均成 mono)
        wav = wav.mean(0, keepdim=True) if channels == 1 else wav[:channels]
    # 取樣率
    if sr != target_sr:
        wav = torchaudio.functional.resample(wav, sr, target_sr)  # type: ignore[union-attr]
    return wav.float()


def separate_vocals(
    audio_path: str,
    out_dir: str,
    model_name: str = "htdemucs",
    device: str = "cuda",
    progress: Optional[ProgressFn] = None,
) -> str:
    """以 Demucs 分離人聲,回傳人聲 .wav 路徑;任何失敗都優雅降級回原始 audio_path。"""
    if not audio_path or not os.path.isfile(audio_path):
        logger.warning("人聲分離輸入檔不存在:%r，直接回傳原始路徑", audio_path)
        _emit(progress, 100.0, "找不到音檔，跳過人聲分離")
        return audio_path

    if not _DEMUCS_AVAILABLE:
        logger.info("Demucs 不可用，跳過人聲分離,使用原始混音")
        _emit(progress, 100.0, "未安裝 Demucs，跳過人聲分離")
        return audio_path

    try:
        _emit(progress, 1.0, "載入 Demucs 模型…")
        dev = _resolve_device(device)
        try:
            os.makedirs(out_dir, exist_ok=True)
        except Exception:  # pragma: no cover
            logger.warning("無法建立輸出資料夾 %r", out_dir, exc_info=True)

        # ---- 載入模型 ---------------------------------------------------- #
        try:
            model = _get_model(model_name)
            model.to(dev)
        except Exception as exc:
            logger.warning("Demucs 模型載入失敗(model=%s):%s;改用原始音檔",
                           model_name, exc, exc_info=True)
            _emit(progress, 100.0, "Demucs 載入失敗，跳過人聲分離")
            return audio_path

        sr = int(model.samplerate)
        ch = int(model.audio_channels)

        # ---- 解碼音檔 ---------------------------------------------------- #
        _emit(progress, 8.0, "讀取音檔…")
        wav = _load_audio_tensor(audio_path, sr, ch)

        # demucs 慣例:用整段 ref 的 mean/std 正規化,分離後還原
        ref = wav.mean(0)
        std = ref.std() + 1e-8
        wav_n = (wav - ref.mean()) / std

        _emit(progress, 15.0, f"以 {dev.upper()} 分離人聲中…")

        # ---- 執行分離 ---------------------------------------------------- #
        try:
            with torch.no_grad():  # type: ignore[union-attr]
                sources = apply_model(  # type: ignore[misc]
                    model, wav_n[None], device=dev, split=True, overlap=0.25, progress=False
                )[0]
            sources = sources * std + ref.mean()
        except Exception as exc:
            logger.warning("Demucs 分離過程失敗:%s;改用原始音檔", exc, exc_info=True)
            _emit(progress, 100.0, "人聲分離失敗，使用原始音檔")
            return audio_path

        # ---- 取出 vocals stem ------------------------------------------- #
        try:
            vocals_idx = list(model.sources).index("vocals")
        except ValueError:
            logger.warning("Demucs 模型無 'vocals' stem(sources=%s);改用原始音檔",
                           list(model.sources))
            _emit(progress, 100.0, "找不到人聲音軌，使用原始音檔")
            return audio_path
        vocals = sources[vocals_idx].cpu()  # (ch, n)

        _emit(progress, 85.0, "輸出人聲音軌…")

        # ---- 寫出 wav ---------------------------------------------------- #
        # 用 soundfile(libsndfile)直接寫 wav,**刻意避開 torchaudio.save** ——
        # torchaudio 2.11 的 save 改走 torchcodec(預設未安裝),demucs.save_audio 也會中招。
        base = os.path.splitext(os.path.basename(audio_path))[0]
        out_wav = os.path.join(out_dir, f"{base}_vocals.wav")
        try:
            import soundfile as sf  # type: ignore

            data = vocals.clamp(-1.0, 1.0).numpy().T  # (ch, n) -> (n, ch)
            sf.write(out_wav, data, sr, subtype="PCM_16")
        except Exception as exc:
            logger.warning("寫出人聲 wav 失敗(%s):%s;改用原始音檔", out_wav, exc, exc_info=True)
            _emit(progress, 100.0, "寫出人聲檔失敗，使用原始音檔")
            return audio_path

        if not os.path.isfile(out_wav) or os.path.getsize(out_wav) == 0:
            logger.warning("人聲 wav 輸出無效(%s);改用原始音檔", out_wav)
            _emit(progress, 100.0, "人聲檔無效，使用原始音檔")
            return audio_path

        logger.info("人聲分離完成:%s", out_wav)
        _emit(progress, 100.0, "人聲分離完成")
        return os.path.abspath(out_wav)

    except Exception as exc:  # 最外層保險
        logger.warning("人聲分離發生未預期錯誤:%s;改用原始音檔", exc, exc_info=True)
        _emit(progress, 100.0, "人聲分離發生錯誤，使用原始音檔")
        return audio_path
