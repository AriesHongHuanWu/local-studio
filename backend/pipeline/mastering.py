"""
pipeline/mastering.py — AI 自動母帶處理(Auto-Mastering)。

把一首混音(stereo)處理成「可發佈」的母帶:依曲風/參考曲調整音色(EQ)、做總線
壓縮膠合動態、調立體聲寬度,最後正規化到目標響度(LUFS)並過真峰限幅器,確保不破音。
全本機、免雲端、授權乾淨(numpy / scipy / pyloudnorm / soundfile,皆 BSD/MIT)。

兩種音色處理:
  - 參考曲模式(reference):使用者上傳一首「想要的聲音」→ 分析其平均頻譜,做 FFT
    頻率響應匹配,把目標曲的音色推向參考曲(開源 Matchering 的做法,自行重寫)。
  - 曲風預設(genre):每個曲風一組調好的參數 EQ + 壓縮個性。

響度目標(整合式 LUFS + 真峰天花板):
  - streaming   -14 LUFS / -1 dBTP(Spotify/Apple/YouTube 標準)
  - balanced    -12 LUFS / -1 dBTP(較動態、通用)
  - social      -9  LUFS / -1 dBTP(較大聲、手機喇叭更有衝擊力)

設計原則:任何重型相依(scipy / pyloudnorm)缺席或失敗都不可讓伺服器崩潰 —— 以
is_available() 回報,呼叫端據此回 503/降級。
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Optional

logger = logging.getLogger("autolyrics.mastering")

ProgressFn = Callable[[str, float, str], None]
_STAGE = "master"

# --------------------------------------------------------------------------- #
# 可選相依偵測
# --------------------------------------------------------------------------- #
try:
    import numpy as np  # type: ignore
    import scipy.signal as sps  # type: ignore
    from scipy.ndimage import (  # type: ignore
        minimum_filter1d,
        maximum_filter1d,
        uniform_filter1d,
    )
    import pyloudnorm as pyln  # type: ignore

    _HAS_DSP = True
except Exception as exc:  # pragma: no cover
    np = None  # type: ignore
    sps = None  # type: ignore
    pyln = None  # type: ignore
    _HAS_DSP = False
    logger.warning("母帶 DSP 相依(scipy/pyloudnorm)不可用,Auto-Mastering 停用:%s", exc)


def is_available() -> bool:
    return _HAS_DSP


def _emit(progress: Optional[ProgressFn], pct: float, msg: str) -> None:
    if progress is None:
        return
    try:
        progress(_STAGE, float(pct), msg)
    except Exception:  # pragma: no cover
        logger.debug("progress 回呼丟例外,已忽略", exc_info=True)


# --------------------------------------------------------------------------- #
# 曲風預設與響度目標
# --------------------------------------------------------------------------- #
# EQ band: (kind, freq_hz, gain_db, q)  kind ∈ {"peak","low_shelf","high_shelf"}
GENRE_PRESETS: dict[str, dict[str, Any]] = {
    "auto": {
        "label": "Auto / 通用",
        "eq": [("low_shelf", 90, 1.0, 0.7), ("high_shelf", 12000, 1.5, 0.7)],
        "comp": {"thresh_db": -16.0, "ratio": 1.6, "attack_ms": 20, "release_ms": 150, "makeup_db": 0.0},
        "width": 1.0,
    },
    "pop": {
        "label": "Pop",
        "eq": [("low_shelf", 100, 1.5, 0.7), ("peak", 3000, 2.0, 1.0), ("high_shelf", 12000, 2.5, 0.7)],
        "comp": {"thresh_db": -16.0, "ratio": 2.0, "attack_ms": 15, "release_ms": 120, "makeup_db": 0.5},
        "width": 1.12,
    },
    "hiphop": {
        "label": "Hip-Hop / Rap",
        "eq": [("low_shelf", 60, 3.0, 0.7), ("peak", 300, -1.0, 1.0), ("high_shelf", 10000, 2.0, 0.7)],
        "comp": {"thresh_db": -15.0, "ratio": 2.2, "attack_ms": 25, "release_ms": 140, "makeup_db": 0.5},
        "width": 1.0,
    },
    "edm": {
        "label": "EDM / Electronic",
        "eq": [("low_shelf", 50, 3.0, 0.7), ("peak", 5000, 1.5, 1.0), ("high_shelf", 14000, 3.0, 0.7)],
        "comp": {"thresh_db": -14.0, "ratio": 2.6, "attack_ms": 10, "release_ms": 100, "makeup_db": 1.0},
        "width": 1.2,
    },
    "rock": {
        "label": "Rock",
        "eq": [("low_shelf", 90, 1.0, 0.7), ("peak", 2000, 2.0, 0.9), ("high_shelf", 9000, 1.5, 0.7)],
        "comp": {"thresh_db": -16.0, "ratio": 2.0, "attack_ms": 20, "release_ms": 150, "makeup_db": 0.5},
        "width": 1.06,
    },
    "rnb": {
        "label": "R&B / Soul",
        "eq": [("low_shelf", 80, 2.5, 0.7), ("peak", 4000, -1.0, 1.2), ("high_shelf", 12000, 2.0, 0.7)],
        "comp": {"thresh_db": -17.0, "ratio": 1.6, "attack_ms": 25, "release_ms": 180, "makeup_db": 0.0},
        "width": 1.1,
    },
    "acoustic": {
        "label": "Acoustic / Folk",
        "eq": [("low_shelf", 100, 0.5, 0.7), ("peak", 4000, 1.0, 1.0), ("high_shelf", 12000, 1.5, 0.7)],
        "comp": {"thresh_db": -18.0, "ratio": 1.4, "attack_ms": 30, "release_ms": 200, "makeup_db": 0.0},
        "width": 1.05,
    },
    "ballad": {
        "label": "Ballad",
        "eq": [("low_shelf", 120, 1.0, 0.7), ("peak", 3000, 1.0, 1.0), ("high_shelf", 12000, 1.5, 0.7)],
        "comp": {"thresh_db": -18.0, "ratio": 1.4, "attack_ms": 30, "release_ms": 220, "makeup_db": 0.0},
        "width": 1.05,
    },
    "lofi": {
        "label": "Lo-fi",
        "eq": [("low_shelf", 100, 2.0, 0.7), ("peak", 500, 1.0, 1.0), ("high_shelf", 8000, -3.0, 0.7)],
        "comp": {"thresh_db": -15.0, "ratio": 2.0, "attack_ms": 20, "release_ms": 140, "makeup_db": 0.5},
        "width": 0.95,
    },
}

# loudness → (target integrated LUFS, true-peak ceiling dBTP)
LOUDNESS_TARGETS: dict[str, tuple[float, float]] = {
    "streaming": (-14.0, -1.0),
    "balanced": (-12.0, -1.0),
    "social": (-9.0, -1.0),
}


def genres() -> list[dict[str, str]]:
    return [{"key": k, "label": v["label"]} for k, v in GENRE_PRESETS.items()]


def loudness_targets() -> list[str]:
    return list(LOUDNESS_TARGETS.keys())


# --------------------------------------------------------------------------- #
# I/O
# --------------------------------------------------------------------------- #
def _load_audio(path: str) -> tuple["np.ndarray", int]:
    """讀成 (n, 2) float64 立體聲 + 取樣率。soundfile 優先(wav/flac),其餘走 PyAV。"""
    # 1) soundfile(無損,原生取樣率/聲道)
    try:
        import soundfile as sf  # type: ignore

        data, sr = sf.read(path, always_2d=True, dtype="float64")  # (n, ch)
        return _to_stereo(data), int(sr)
    except Exception as exc:
        logger.debug("soundfile 讀取失敗,改用 PyAV(%s)", exc)

    # 2) PyAV(mp3/m4a 等)→ fltp stereo @native sr
    import av  # type: ignore

    c = av.open(path)
    try:
        astream = c.streams.audio[0]
        sr = int(astream.codec_context.sample_rate or 44100)
        resampler = av.AudioResampler(format="fltp", layout="stereo", rate=sr)
        chunks: list[Any] = []
        for frame in c.decode(audio=0):
            for rf in resampler.resample(frame):
                chunks.append(rf.to_ndarray())  # (2, n) planar float
        if not chunks:
            raise RuntimeError("PyAV 解不到音訊")
        data = np.concatenate(chunks, axis=1).T.astype(np.float64)  # (n, 2)
        return _to_stereo(data), sr
    finally:
        try:
            c.close()
        except Exception:
            pass


def _to_stereo(data: "np.ndarray") -> "np.ndarray":
    if data.ndim == 1:
        data = data[:, None]
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    elif data.shape[1] > 2:
        data = data[:, :2]
    # 輸入端清洗:壞檔可能帶 NaN/Inf,若不擋會被 IIR 濾波器一路傳染整條鏈 → 靜音/壞 WAV。
    if not np.isfinite(data).all():
        data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)
    return np.ascontiguousarray(data, dtype=np.float64)


def _write_wav(path: str, data: "np.ndarray", sr: int) -> None:
    import soundfile as sf  # type: ignore

    # 輸出端最後防線:任何階段若漏出 NaN/Inf,np.clip 不會清掉(NaN<x 為 False)→ 這裡
    # 用 nan_to_num 保證寫出的永遠是有限取樣,使用者不會拿到無聲/損毀的母帶。
    safe = np.nan_to_num(np.clip(data, -1.0, 1.0), nan=0.0, posinf=1.0, neginf=-1.0)
    sf.write(path, safe, sr, subtype="PCM_24")


# --------------------------------------------------------------------------- #
# 響度 / 峰值量測
# --------------------------------------------------------------------------- #
def _measure_lufs(data: "np.ndarray", sr: int) -> float:
    try:
        meter = pyln.Meter(sr)  # ITU-R BS.1770
        lufs = float(meter.integrated_loudness(data))
        if not np.isfinite(lufs):
            return -70.0
        return lufs
    except Exception:
        # 後備:用 RMS 粗估(非標準,但不讓流程斷)
        rms = float(np.sqrt(np.mean(data**2) + 1e-12))
        return 20.0 * np.log10(rms + 1e-9) - 0.691


def _peak_db(data: "np.ndarray") -> float:
    p = float(np.max(np.abs(data))) if data.size else 0.0
    return 20.0 * np.log10(p + 1e-12)


# --------------------------------------------------------------------------- #
# 參數 EQ(RBJ biquad)
# --------------------------------------------------------------------------- #
def _biquad(kind: str, sr: int, f0: float, gain_db: float, q: float) -> tuple["np.ndarray", "np.ndarray"]:
    """RBJ cookbook biquad:peaking / low_shelf / high_shelf。回傳 (b, a)。"""
    A = 10 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * f0 / sr
    cw = np.cos(w0)
    sw = np.sin(w0)
    alpha = sw / (2.0 * max(q, 1e-4))
    if kind == "peak":
        b0 = 1 + alpha * A
        b1 = -2 * cw
        b2 = 1 - alpha * A
        a0 = 1 + alpha / A
        a1 = -2 * cw
        a2 = 1 - alpha / A
    elif kind == "low_shelf":
        s = 2 * np.sqrt(A) * alpha
        b0 = A * ((A + 1) - (A - 1) * cw + s)
        b1 = 2 * A * ((A - 1) - (A + 1) * cw)
        b2 = A * ((A + 1) - (A - 1) * cw - s)
        a0 = (A + 1) + (A - 1) * cw + s
        a1 = -2 * ((A - 1) + (A + 1) * cw)
        a2 = (A + 1) + (A - 1) * cw - s
    elif kind == "high_pass":
        b0 = (1 + cw) / 2.0
        b1 = -(1 + cw)
        b2 = (1 + cw) / 2.0
        a0 = 1 + alpha
        a1 = -2 * cw
        a2 = 1 - alpha
    elif kind == "low_pass":
        b0 = (1 - cw) / 2.0
        b1 = 1 - cw
        b2 = (1 - cw) / 2.0
        a0 = 1 + alpha
        a1 = -2 * cw
        a2 = 1 - alpha
    elif kind == "notch":
        b0 = 1
        b1 = -2 * cw
        b2 = 1
        a0 = 1 + alpha
        a1 = -2 * cw
        a2 = 1 - alpha
    elif kind == "allpass":
        b0 = 1 - alpha
        b1 = -2 * cw
        b2 = 1 + alpha
        a0 = 1 + alpha
        a1 = -2 * cw
        a2 = 1 - alpha
    else:  # high_shelf
        s = 2 * np.sqrt(A) * alpha
        b0 = A * ((A + 1) + (A - 1) * cw + s)
        b1 = -2 * A * ((A - 1) + (A + 1) * cw)
        b2 = A * ((A + 1) + (A - 1) * cw - s)
        a0 = (A + 1) - (A - 1) * cw + s
        a1 = 2 * ((A - 1) - (A + 1) * cw)
        a2 = (A + 1) - (A - 1) * cw - s
    b = np.array([b0, b1, b2], dtype=np.float64) / a0
    a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
    return b, a


def _apply_eq(data: "np.ndarray", sr: int, bands: list[tuple]) -> "np.ndarray":
    out = data.copy()
    for (kind, f0, gain_db, q) in bands:
        if abs(gain_db) < 1e-3:
            continue
        b, a = _biquad(kind, sr, float(f0), float(gain_db), float(q))
        for ch in range(out.shape[1]):
            out[:, ch] = sps.lfilter(b, a, out[:, ch])
    return out


def _eq_response_curve(bands: list[tuple], sr: int, low_cut_hz: float = 0.0,
                       npts: int = 96) -> list[dict]:
    """把一組 EQ biquad(kind,f0,gain_db,q)+ 可選低切 串接,算出綜合頻率響應曲線(供 UI 畫
    『自動 EQ 曲線』)。回 [{f, db}] 於 20Hz–Nyquist 的對數頻率格點。"""
    ny = sr / 2.0
    f = np.geomspace(20.0, min(20000.0, ny - 100.0), npts)
    worN = 2.0 * np.pi * f / sr
    h = np.ones(npts, dtype=complex)
    for (kind, f0, gain_db, q) in bands:
        if abs(float(gain_db)) < 1e-3:
            continue
        try:
            b, a = _biquad(str(kind), sr, float(f0), float(gain_db), float(q))
            _, hi = sps.freqz(b, a, worN=worN)
            h = h * hi
        except Exception:
            continue
    if low_cut_hz and float(low_cut_hz) > 20.0:
        try:
            b, a = _biquad("high_pass", sr, float(low_cut_hz), 0.0, 0.707)
            _, hi = sps.freqz(b, a, worN=worN)
            h = h * hi
        except Exception:
            pass
    db = 20.0 * np.log10(np.abs(h) + 1e-9)
    return [{"f": round(float(ff), 1), "db": round(float(np.clip(d, -24.0, 24.0)), 2)}
            for ff, d in zip(f, db)]


# --------------------------------------------------------------------------- #
# 參考曲頻率響應匹配(FFT)
# --------------------------------------------------------------------------- #
def _avg_spectrum(x_mono: "np.ndarray", n_fft: int = 8192) -> "np.ndarray":
    """整段訊號的平均量值頻譜(分窗、漢寧、平均)。回傳長度 n_fft//2+1。"""
    hop = n_fft // 2
    if x_mono.shape[0] < n_fft:
        x_mono = np.pad(x_mono, (0, n_fft - x_mono.shape[0]))
    win = np.hanning(n_fft)
    acc = np.zeros(n_fft // 2 + 1, dtype=np.float64)
    cnt = 0
    for start in range(0, x_mono.shape[0] - n_fft + 1, hop):
        seg = x_mono[start:start + n_fft] * win
        acc += np.abs(np.fft.rfft(seg))
        cnt += 1
    if cnt == 0:
        return acc + 1e-9
    return acc / cnt + 1e-9


def _match_eq(data: "np.ndarray", sr: int, ref: "np.ndarray", ref_sr: int, max_db: float = 12.0) -> "np.ndarray":
    """把 data 的平均頻譜推向 ref 的(FFT 匹配 EQ)。修正量在 log-freq 上平滑、夾在 ±max_db。"""
    try:
        if ref_sr != sr:
            ref = sps.resample_poly(ref, sr, ref_sr, axis=0)
        n_fft = 8192
        tgt_spec = _avg_spectrum(np.mean(data, axis=1), n_fft)
        ref_spec = _avg_spectrum(np.mean(ref, axis=1), n_fft)
        # 正規化整體能量(只匹配「形狀/音色」,不匹配絕對響度 → 響度由後面的 LUFS 正規化決定)
        tgt_spec = tgt_spec / (np.mean(tgt_spec) + 1e-12)
        ref_spec = ref_spec / (np.mean(ref_spec) + 1e-12)
        ratio_db = 20.0 * np.log10((ref_spec + 1e-9) / (tgt_spec + 1e-9))
        ratio_db = np.clip(ratio_db, -max_db, max_db)
        # 在頻率軸上平滑(避免逐 bin 硬修正造成染色),約 1/6 八度
        ratio_db = uniform_filter1d(ratio_db, size=max(3, n_fft // 256))
        gain_lin = 10 ** (ratio_db / 20.0)
        # 設計線性相位 FIR(對稱),用 overlap-add 套用兩聲道
        full = np.concatenate([gain_lin, gain_lin[-2:0:-1]])  # 對稱成完整頻譜
        imp = np.fft.irfft(gain_lin, n=n_fft)
        imp = np.fft.fftshift(imp) * np.hanning(n_fft)  # 視窗化成線性相位 FIR
        out = np.empty_like(data)
        for ch in range(data.shape[1]):
            out[:, ch] = sps.fftconvolve(data[:, ch], imp, mode="same")
        return out
    except Exception:
        logger.warning("參考曲匹配失敗,改用原始音色(降級)", exc_info=True)
        return data


# --------------------------------------------------------------------------- #
# 壓縮 / 立體聲寬度 / 響度正規化 / 限幅
# --------------------------------------------------------------------------- #
def _compress(data: "np.ndarray", sr: int, *, thresh_db: float, ratio: float,
              attack_ms: float, release_ms: float, makeup_db: float) -> "np.ndarray":
    """溫和總線壓縮(level-dependent + 一階平滑)。對母帶以膠合為主,不求激進。"""
    detect = np.sqrt(np.mean(data**2, axis=1) + 1e-12)  # 兩聲道 RMS
    level_db = 20.0 * np.log10(detect + 1e-9)
    over = np.maximum(0.0, level_db - thresh_db)
    gr_db = -over * (1.0 - 1.0 / max(ratio, 1.0))  # 增益衰減(<=0)
    tau = max(1.0, (attack_ms + release_ms) / 2.0)
    a = float(np.exp(-1.0 / (sr * tau / 1000.0)))
    gr_sm = sps.lfilter([1 - a], [1, -a], gr_db)
    gain = 10 ** ((gr_sm + makeup_db) / 20.0)
    return data * gain[:, None]


def _stereo_width(data: "np.ndarray", width: float) -> "np.ndarray":
    if abs(width - 1.0) < 1e-3 or data.shape[1] < 2:
        return data
    mid = 0.5 * (data[:, 0] + data[:, 1])
    side = 0.5 * (data[:, 0] - data[:, 1]) * float(width)
    out = np.empty_like(data)
    out[:, 0] = mid + side
    out[:, 1] = mid - side
    return out


def _normalize_lufs(data: "np.ndarray", sr: int, target_lufs: float) -> "np.ndarray":
    cur = _measure_lufs(data, sr)
    gain_db = target_lufs - cur
    gain_db = float(np.clip(gain_db, -24.0, 36.0))
    return data * (10 ** (gain_db / 20.0))


def _limit(data: "np.ndarray", sr: int, ceiling_db: float) -> "np.ndarray":
    """前瞻峰值限幅器(向量化):增益衰減用移動最小值(含前瞻),短窗平滑,末端硬夾保底。"""
    ceiling = 10 ** (ceiling_db / 20.0)
    peak = np.max(np.abs(data), axis=1) + 1e-12
    desired = np.minimum(1.0, ceiling / peak)  # 維持在天花板下所需的增益(<=1)
    la = max(1, int(sr * 0.0015))   # 1.5ms 前瞻/起音
    hold = max(1, int(sr * 0.04))   # ~40ms 釋放
    win = la + hold
    g = minimum_filter1d(desired, size=win, origin=min(hold // 2, win // 2 - 1))
    g = uniform_filter1d(g, size=la)  # 平滑邊緣
    out = data * g[:, None]
    np.clip(out, -ceiling, ceiling, out=out)
    return out


# --------------------------------------------------------------------------- #
# 區段感知巨觀動態(主歌/副歌自動增減)+ 進階手動 EQ
# --------------------------------------------------------------------------- #
def _macro_dynamics(data: "np.ndarray", sr: int, amount: float, max_db: float = 5.0) -> "np.ndarray":
    """以「短時能量包絡」當作歌曲結構代理(副歌通常較大聲/較滿),在**區段尺度**上
    自動增減音量:

      amount > 0  =「爆發力 / Punch」—— 把較大聲的段落(副歌)推得更大、較小聲的段落
                    (主歌)壓得更小 → 動態對比更強、副歌更有衝擊力。
      amount < 0  =「平衡 / Balance」—— 反向,把段落拉向整體平均 → 整首更一致耐聽。
      amount = 0  = 關閉。

    與快速壓縮/限幅器不同:這條增益在 ~秒級平滑(避免抽吸感)。處理後整體響度會變,
    由後續 LUFS 正規化重新校到目標。純 numpy、O(n)。
    """
    if abs(amount) < 1e-3 or data.shape[0] < sr:
        return data
    mono = np.mean(data, axis=1)
    n = mono.shape[0]
    hop = max(1, int(sr * 0.1))            # 每 100ms 一個包絡點
    half = max(hop, int(sr * 0.75))        # ±0.75s = 1.5s 短時能量窗
    centers = np.arange(0, n, hop)
    # 用平方累積和向量化算每個窗的 RMS(快)
    csum = np.concatenate([[0.0], np.cumsum(mono.astype(np.float64) ** 2)])
    a = np.clip(centers - half, 0, n)
    b = np.clip(centers + half, 0, n)
    ms = (csum[b] - csum[a]) / np.maximum(1, (b - a))
    env_db = 20.0 * np.log10(np.sqrt(ms + 1e-12) + 1e-9)
    dev = env_db - np.median(env_db)       # 相對整體中位數的偏差(副歌>0、主歌<0)
    gain_db = np.clip(float(amount) * 0.6 * dev, -max_db, max_db)
    # 秒級平滑(~2s)避免段落邊界抽吸
    gain_db = uniform_filter1d(gain_db, size=max(3, int(2.0 / (hop / sr))))
    gain_full = np.interp(np.arange(n), centers, gain_db)
    return data * (10 ** (gain_full / 20.0))[:, None]


def _advanced_eq(data: "np.ndarray", sr: int, eq: dict) -> "np.ndarray":
    """使用者進階手動 EQ —— 4 段(低頻/低中/臨場/空氣),疊加在曲風/參考 EQ 之上。"""
    bands: list[tuple] = []
    if abs(float(eq.get("bass") or 0)) > 1e-3:
        bands.append(("low_shelf", 80, float(eq["bass"]), 0.7))
    if abs(float(eq.get("lowMid") or 0)) > 1e-3:
        bands.append(("peak", 400, float(eq["lowMid"]), 1.0))
    if abs(float(eq.get("presence") or 0)) > 1e-3:
        bands.append(("peak", 3000, float(eq["presence"]), 1.0))
    if abs(float(eq.get("air") or 0)) > 1e-3:
        bands.append(("high_shelf", 12000, float(eq["air"]), 0.7))
    return _apply_eq(data, sr, bands) if bands else data


# =========================================================================== #
# 智慧分析(Intelligent analysis)—— 偵測這首歌的響度/動態/頻譜/立體聲問題,
# 給出可視化資料 + 自動修正建議。只用 numpy/scipy/pyloudnorm,授權乾淨。
# =========================================================================== #

# 分析頻段(name, lo_hz, hi_hz)
_BANDS: list[tuple[str, float, float]] = [
    ("sub", 20.0, 60.0),
    ("bass", 60.0, 150.0),
    ("low_mid", 150.0, 400.0),
    ("mid", 400.0, 2000.0),
    ("high_mid", 2000.0, 6000.0),
    ("presence", 6000.0, 10000.0),
    ("air", 10000.0, 20000.0),
]

# 每個頻段對應的修正用 EQ(kind, center_hz, q)—— 把 band gain 套成實際 biquad
_BAND_EQ: dict[str, tuple[str, float, float]] = {
    "sub": ("low_shelf", 45.0, 0.7),
    "bass": ("peak", 95.0, 0.9),
    "low_mid": ("peak", 250.0, 1.0),
    "mid": ("peak", 900.0, 0.8),
    "high_mid": ("peak", 3500.0, 1.0),
    "presence": ("peak", 8000.0, 1.2),
    "air": ("high_shelf", 12000.0, 0.7),
}

# 目標頻譜曲線參數:以 1kHz 為錨點的 ~-3.5 dB/oct 傾斜(現代全頻母帶的耐聽斜率)
_TARGET_TILT_DB_OCT = -3.5
_TARGET_ANCHOR_HZ = 1000.0

# 曲風對「目標頻段」的小幅偏移(dB)—— 資料驅動為主,曲風只做微調(乘 0.6)
_GENRE_OFFSETS: dict[str, dict[str, float]] = {
    "auto": {b[0]: 0.0 for b in _BANDS},
    "pop": {"sub": 0, "bass": 0.5, "low_mid": -0.5, "mid": 0, "high_mid": 0.5, "presence": 0.5, "air": 1.0},
    "hiphop": {"sub": 1.5, "bass": 1.5, "low_mid": -1.0, "mid": -0.5, "high_mid": 0, "presence": 0, "air": 0},
    "edm": {"sub": 1.0, "bass": 1.0, "low_mid": -1.0, "mid": 0, "high_mid": 0.5, "presence": 0.5, "air": 1.0},
    "rock": {"sub": 0, "bass": 0.5, "low_mid": 0, "mid": 0.5, "high_mid": 0.5, "presence": 0, "air": -0.5},
    "rnb": {"sub": 1.0, "bass": 1.0, "low_mid": 0, "mid": 0, "high_mid": 0, "presence": 0.5, "air": 0.5},
    "acoustic": {"sub": -0.5, "bass": 0, "low_mid": 0.5, "mid": 0.5, "high_mid": 0, "presence": 0, "air": 0.5},
    "ballad": {"sub": 0, "bass": 0, "low_mid": 0, "mid": 0.5, "high_mid": 0, "presence": 0, "air": 1.0},
    "lofi": {"sub": 1.0, "bass": 1.0, "low_mid": 1.0, "mid": 0, "high_mid": -2.0, "presence": -2.0, "air": -3.0},
}

_ANALYSIS_SR = 44100  # 分析統一在此取樣率(過高的來源先降採樣,加速且結果穩定)


def _analysis_signal(data: "np.ndarray", sr: int) -> tuple["np.ndarray", int]:
    """分析用訊號:>48k 先降到 44.1k(只供分析,真峰仍用原始 sr 量)。"""
    if sr > 48000:
        try:
            xa = sps.resample_poly(data, _ANALYSIS_SR, sr, axis=0)
            return np.ascontiguousarray(xa, dtype=np.float64), _ANALYSIS_SR
        except Exception:
            return data, sr
    return data, sr


def _true_peak_dbtp(data: "np.ndarray", sr: int) -> float:
    """過取樣真峰(BS.1770):sr<=48k 用 4×、更高用 2×。失敗回退取樣峰值。"""
    try:
        os_factor = 4 if sr <= 48000 else 2
        up = sps.resample_poly(data, os_factor, 1, axis=0)
        peak = float(np.max(np.abs(up))) + 1e-12
        return 20.0 * np.log10(peak)
    except Exception:
        return _peak_db(data)


def _k_weighted(x: "np.ndarray", sr: int) -> "np.ndarray":
    """BS.1770 K-weighting(高棚 + RLB 高通)。任一步失敗→回未加權(度量退化但不崩)。"""
    try:
        from pyloudnorm import IIRfilter  # type: ignore

        hs = IIRfilter(4.0, 1.0 / np.sqrt(2.0), 1500.0, sr, "high_shelf")
        hp = IIRfilter(0.0, 0.5, 38.0, sr, "high_pass")
        y = np.empty_like(x)
        for ch in range(x.shape[1]):
            c = hs.apply_filter(x[:, ch])
            c = hp.apply_filter(c)
            y[:, ch] = c
        return y
    except Exception:
        return x


def _sliding_loudness(x: "np.ndarray", sr: int, win_s: float, hop_s: float = 0.1) -> "np.ndarray":
    """滑動視窗 BS.1770 響度(未閘控),向量化(平方累積和)。回傳每個視窗的 LUFS。"""
    y = _k_weighted(x, sr)
    power = np.sum(y ** 2, axis=1)  # 兩聲道功率和(stereo 權重=1)
    w = max(1, int(win_s * sr))
    hop = max(1, int(hop_s * sr))
    n = power.shape[0]
    if n < w:
        ms = float(np.mean(power)) if n else 1e-12
        return np.array([-0.691 + 10.0 * np.log10(ms + 1e-12)])
    csum = np.concatenate([[0.0], np.cumsum(power)])
    idx = np.arange(0, n - w + 1, hop)
    seg_ms = (csum[idx + w] - csum[idx]) / w
    return -0.691 + 10.0 * np.log10(seg_ms + 1e-12)


def _lra(st: "np.ndarray") -> float:
    """EBU Tech 3342 響度範圍:絕對閘 -70,相對閘 (能量平均-20),95%-10% 區間。"""
    s = st[st > -70.0]
    if s.size < 2:
        return 0.0
    rel = -0.691 + 10.0 * np.log10(np.mean(10.0 ** ((s + 0.691) / 10.0)) + 1e-12)
    s = s[s > rel - 20.0]
    if s.size < 2:
        return 0.0
    return float(np.percentile(s, 95) - np.percentile(s, 10))


def _welch_psd(mono: "np.ndarray", sr: int, nfft: int = 8192) -> tuple["np.ndarray", "np.ndarray"]:
    """時間平均功率譜密度(Welch)。一次呼叫即可服務頻段能量 + 繪圖曲線。

    對極短訊號要安全:nperseg 不可超過訊號長度,且 noverlap 必須 < nperseg —— 否則
    scipy.welch 會丟 ValueError。極短(<16 樣本)直接回退一條平坦微譜。
    """
    n = int(mono.shape[0])
    if n < 16:
        return np.array([0.0, sr / 2.0]), np.full(2, 1e-12)
    nper = min(nfft, n)  # 不再硬性墊高到 256(會超過短訊號長度而崩潰)
    noverlap = min(nper // 2, nper - 1)
    f, pxx = sps.welch(mono, fs=sr, window="hann", nperseg=nper,
                       noverlap=noverlap, detrend=False, scaling="density")
    return f, pxx


def _trapz(y: "np.ndarray", x: "np.ndarray") -> float:
    """numpy 1.x/2.x 相容:2.0 把 trapz 改名 trapezoid。"""
    fn = getattr(np, "trapezoid", None)
    if fn is None:
        fn = np.trapz  # type: ignore[attr-defined]
    return float(fn(y, x))


def _finite_scrub(obj: Any) -> Any:
    """遞迴把任何非有限浮點(NaN/±Inf)換成 0.0 —— 確保回傳的 JSON 能被瀏覽器嚴格
    解析(Starlette 預設 allow_nan=True 會吐裸 NaN/Infinity token,res.json() 會丟)。"""
    if isinstance(obj, float):
        return obj if (obj == obj and obj not in (float("inf"), float("-inf"))) else 0.0
    if isinstance(obj, dict):
        return {k: _finite_scrub(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finite_scrub(v) for v in obj]
    return obj


def _band_levels_db(f: "np.ndarray", pxx: "np.ndarray") -> dict[str, float]:
    out: dict[str, float] = {}
    for name, lo, hi in _BANDS:
        m = (f >= lo) & (f < hi)
        p = _trapz(pxx[m], f[m]) if np.any(m) else 1e-12
        out[name] = 10.0 * np.log10(p + 1e-12)
    return out


def _target_curve_db(f: "np.ndarray") -> "np.ndarray":
    """目標母帶頻譜(相對 dB):-3.5 dB/oct 傾斜 + 低頻微抬 + 低中微凹 + 空氣微抬。"""
    fc = np.clip(f, 20.0, 20000.0)
    base = _TARGET_TILT_DB_OCT * np.log2(fc / _TARGET_ANCHOR_HZ)
    shape = (
        1.5 * np.exp(-((np.log2(fc / 60.0)) ** 2) / 0.5)
        - 1.0 * np.exp(-((np.log2(fc / 300.0)) ** 2) / 0.4)
        + 1.0 * np.exp(-((np.log2(fc / 12000.0)) ** 2) / 0.6)
    )
    return base + shape


def _target_band_levels(genre: str) -> dict[str, float]:
    """目標頻段能量(對目標曲線在各頻段積分)+ 曲風微調(×0.6)。"""
    f = np.geomspace(20.0, 20000.0, 2048)
    tdb = _target_curve_db(f)
    plin = 10.0 ** (tdb / 10.0)  # 視為相對功率密度
    levels: dict[str, float] = {}
    for name, lo, hi in _BANDS:
        m = (f >= lo) & (f < hi)
        p = _trapz(plin[m], f[m]) if np.any(m) else 1e-12
        levels[name] = 10.0 * np.log10(p + 1e-12)
    off = _GENRE_OFFSETS.get(genre, _GENRE_OFFSETS["auto"])
    return {k: levels[k] + 0.6 * float(off.get(k, 0.0)) for k in levels}


def _spectral_centroid(f: "np.ndarray", pxx: "np.ndarray") -> float:
    s = float(np.sum(pxx))
    return float(np.sum(f * pxx) / (s + 1e-12)) if s > 0 else 0.0


def _spectral_tilt(f: "np.ndarray", pxx: "np.ndarray") -> float:
    """100Hz–10kHz 內 10log10(PSD) 對 log2(f) 線性回歸的斜率(dB/oct)。"""
    m = (f >= 100.0) & (f <= 10000.0) & (pxx > 0)
    if np.count_nonzero(m) < 4:
        return 0.0
    x = np.log2(f[m])
    y = 10.0 * np.log10(pxx[m])
    a = np.vstack([x, np.ones_like(x)]).T
    slope = np.linalg.lstsq(a, y, rcond=None)[0][0]
    return float(slope)


def _log_smooth(curve: "np.ndarray", logf: "np.ndarray", frac: float = 1.0 / 6.0) -> "np.ndarray":
    """在 log-freq 上做 ±frac 八度的箱型平滑(讓繪圖曲線乾淨)。"""
    n = curve.shape[0]
    out = np.empty_like(curve)
    lg = np.log2(logf)
    for i in range(n):
        m = np.abs(lg - lg[i]) <= frac
        out[i] = float(np.mean(curve[m])) if np.any(m) else curve[i]
    return out


def _spectrum_curve(mono: "np.ndarray", sr: int, logf: "np.ndarray") -> "np.ndarray":
    """於 logf 點上取出時間平均、log-八度平滑後的量值曲線(原始 dB,未正規化)。"""
    f, pxx = _welch_psd(mono, sr)
    valid = f > 0
    db = 10.0 * np.log10(pxx[valid] + 1e-12)
    curve = np.interp(np.log10(logf), np.log10(f[valid]), db)
    return _log_smooth(curve, logf)


def _energy_envelope(mono: "np.ndarray", sr: int, hop_s: float, win_s: float) -> tuple["np.ndarray", "np.ndarray"]:
    """短時能量包絡(dB)+ 時間軸(秒)。向量化(平方累積和)。"""
    n = mono.shape[0]
    hop = max(1, int(hop_s * sr))
    half = max(hop, int(win_s * sr / 2))
    centers = np.arange(0, n, hop)
    csum = np.concatenate([[0.0], np.cumsum(mono.astype(np.float64) ** 2)])
    a = np.clip(centers - half, 0, n)
    b = np.clip(centers + half, 0, n)
    ms = (csum[b] - csum[a]) / np.maximum(1, (b - a))
    env_db = 20.0 * np.log10(np.sqrt(ms + 1e-12) + 1e-9)
    times = centers / float(sr)
    return times, env_db


def _section_gain_db(env_db: "np.ndarray", amount: float, hop_s: float, max_db: float = 5.0) -> "np.ndarray":
    """以能量包絡推出的區段增益(dB)—— 與 _macro_dynamics 同公式,供視覺化呈現。"""
    if env_db.size == 0:
        return env_db
    dev = env_db - np.median(env_db)
    gain = np.clip(float(amount) * 0.6 * dev, -max_db, max_db)
    return uniform_filter1d(gain, size=max(3, int(2.0 / max(hop_s, 1e-3))))


def _detect_sections(times: "np.ndarray", env_db: "np.ndarray", hop_s: float,
                     min_len_s: float = 4.0) -> list[dict[str, Any]]:
    """以能量包絡偵測 副歌(較大聲)/主歌(較小聲)區段;併掉過短段。"""
    if env_db.size == 0:
        return []
    thr = float(np.median(env_db)) + 2.0
    hi = env_db > thr
    runs: list[list] = []
    start = 0
    cur = bool(hi[0])
    for i in range(1, hi.shape[0]):
        if bool(hi[i]) != cur:
            runs.append([float(times[start]), float(times[i]), "chorus" if cur else "verse"])
            start = i
            cur = bool(hi[i])
    end_t = float(times[-1]) + hop_s
    runs.append([float(times[start]), end_t, "chorus" if cur else "verse"])
    merged: list[list] = []
    for s in runs:
        if merged and (s[1] - s[0]) < min_len_s:
            merged[-1][1] = s[1]
        else:
            merged.append(list(s))
    if len(merged) >= 2 and (merged[0][1] - merged[0][0]) < min_len_s:
        merged[1][0] = merged[0][0]
        merged.pop(0)
    return [{"start_s": round(a, 2), "end_s": round(b, 2), "type": t} for a, b, t in merged]


def _highpass(data: "np.ndarray", sr: int, fc: float) -> "np.ndarray":
    if fc <= 0:
        return data
    sos = sps.butter(2, min(fc / (sr / 2.0), 0.99), btype="high", output="sos")
    out = np.empty_like(data)
    for ch in range(data.shape[1]):
        out[:, ch] = sps.sosfilt(sos, data[:, ch])
    return out


def _mono_below(data: "np.ndarray", sr: int, fc: float) -> "np.ndarray":
    """把 fc 以下的 side 訊號收掉 → 低頻單聲道(club/vinyl 穩定)。"""
    if fc <= 0 or data.shape[1] < 2:
        return data
    sos = sps.butter(4, min(fc / (sr / 2.0), 0.99), btype="low", output="sos")
    mid = 0.5 * (data[:, 0] + data[:, 1])
    side = 0.5 * (data[:, 0] - data[:, 1])
    side_low = sps.sosfilt(sos, side)
    side_hi = side - side_low  # 低頻 side 移除 → 低頻 mono
    out = np.empty_like(data)
    out[:, 0] = mid + side_hi
    out[:, 1] = mid - side_hi
    return out


def _sev(margin: float, lo: float, med: float, hi: float) -> Optional[str]:
    a = abs(margin)
    if a >= hi:
        return "high"
    if a >= med:
        return "medium"
    if a >= lo:
        return "low"
    return None


def _detect_problems(band_dev: dict[str, float], dyn: dict[str, float],
                     spec: dict[str, float], stereo: dict[str, float]) -> list[dict[str, Any]]:
    """度量 → 問題清單(id/severity/area/message/action/metrics)。中英訊息。"""
    P: list[dict[str, Any]] = []

    def add(_id, sev, area, zh, en, act_zh, act_en, **metrics):
        if sev is None:
            return
        P.append({"id": _id, "severity": sev, "area": area,
                  "message": zh, "messageEn": en, "action": act_zh, "actionEn": act_en,
                  "metrics": metrics})

    lm = band_dev.get("low_mid", 0.0)
    add("muddy", _sev(lm - 2.5, 0.0, 1.5, 3.5) if lm > 2.5 else None, "low_mid",
        "低中頻(200–400Hz)堆積 —— 聽起來糊、悶。", "Low-mid buildup (200–400Hz) — muddy/congested.",
        "在 ~250Hz 衰減低中頻。", "Cut low-mids around 250 Hz.", deviation_db=round(lm, 1))

    hm = band_dev.get("high_mid", 0.0)
    add("harsh", _sev(hm - 3.0, 0.0, 2.0, 4.0) if hm > 3.0 else None, "high_mid",
        "2–5kHz 過衝 —— 刺耳、聽久疲勞。", "Harsh 2–5 kHz — fatiguing.",
        "在 ~3.5kHz 衰減。", "Cut around 3.5 kHz.", deviation_db=round(hm, 1))

    mid = band_dev.get("mid", 0.0)
    add("boxy", _sev(mid - 2.5, 0.0, 1.5, 3.0) if mid > 2.5 else None, "mid",
        "中頻(400–800Hz)堆積 —— 箱音/鼻音、不通透。", "Mid buildup (400–800 Hz) — boxy/honky.",
        "在 ~550Hz 衰減中頻。", "Cut mids around 550 Hz.", deviation_db=round(mid, 1))

    pres = band_dev.get("presence", 0.0)
    add("sibilant", _sev(pres - 3.0, 0.0, 2.0, 4.0) if (pres > 3.0 and spec.get("centroid_hz", 0) > 3500) else None,
        "presence", "5–8kHz 齒音/毛邊偏多。", "Sibilance/edge around 5–8 kHz.",
        "窄帶在 6–7kHz 衰減。", "Narrow cut at 6–7 kHz.", deviation_db=round(pres, 1))

    air = band_dev.get("air", 0.0)
    add("dull_no_air", _sev(air, 3.0, 5.0, 7.0) if air < -3.0 else None, "air",
        "10kHz 以上空氣感不足 —— 悶、不通透。", "Lacks air above 10 kHz — dull/closed.",
        "在 12kHz 高棚微抬。", "High-shelf lift at 12 kHz.", deviation_db=round(air, 1))

    tilt = spec.get("tilt_db_oct", -3.5)
    add("dark", "low" if (tilt <= -6.0 or spec.get("centroid_hz", 2000) < 1200) else None, "tone",
        "整體偏暗/悶。", "Overall tone is dark/dull.",
        "高棚微抬、低中微修。", "Gentle high-shelf lift.", tilt_db_oct=round(tilt, 2))

    bass = band_dev.get("bass", 0.0)
    sub = band_dev.get("sub", 0.0)
    add("boomy_low", _sev(max(bass - 3.0, sub - 4.0), 0.0, 1.5, 3.0) if (bass > 3.0 or sub > 4.0) else None,
        "bass", "低頻過多 —— 轟、糊、不緊。", "Low end is boomy/bloated.",
        "衰減低頻、必要時加低切。", "Cut bass; add a low-cut if sub-heavy.",
        bass_db=round(bass, 1), sub_db=round(sub, 1))

    add("thin_no_bass", _sev(bass, 3.0, 5.0, 7.0) if (bass < -3.0 and sub < -2.0) else None,
        "bass", "低頻單薄 —— 缺乏重量。", "Thin — lacks low-end weight.",
        "在 ~90Hz 低棚微抬。", "Low-shelf lift at ~90 Hz.", bass_db=round(bass, 1))

    crest = dyn.get("crest_factor_db", 12.0)
    dr = dyn.get("dr_est")
    plr = dyn.get("plr", 12.0)
    lra = dyn.get("lra_lu", 6.0)
    over = (crest < 7.0) or (dr is not None and dr <= 6) or (plr <= 6.0) or (lra < 3.0)
    add("over_compressed", ("high" if crest < 5.0 else "medium") if over else None, "dynamics",
        "過度壓縮 —— 扁平、沒有衝擊力。", "Over-compressed — flat, no punch.",
        "降低壓縮;用「爆發力(+)」恢復副歌動態。", "Reduce compression; raise section punch (+).",
        crest_db=round(crest, 1), dr=dr, plr=round(plr, 1))

    tp = dyn.get("true_peak_dbtp", -1.0)
    add("clipping", "high" if tp > 0.0 else None, "loudness",
        "破音/真峰超過 0dB —— 轉檔會失真。", "Clipping / inter-sample peaks over 0 dB.",
        "啟用真峰限幅到 -1 dBTP。", "Limit true-peak to -1 dBTP.", true_peak_dbtp=round(tp, 2))

    corr = stereo.get("correlation", 0.5)
    wi = stereo.get("width_index", 0.4)
    add("too_narrow", "low" if (wi < 0.12 or corr > 0.95) else None, "stereo",
        "立體聲偏窄/接近單聲道。", "Image is narrow / almost mono.",
        "加寬立體聲(保持低頻單聲道)。", "Widen the stereo image (keep bass mono).",
        width_index=round(wi, 2), correlation=round(corr, 2))

    add("too_wide_phase", ("high" if corr < 0.0 else "medium") if (wi > 1.0 or corr < 0.0) else None, "stereo",
        "過寬/相位抵銷 —— 單聲道播放會掉能量。", "Too wide / phase cancellation — mono loses energy.",
        "收窄立體聲、檢查極性。", "Narrow the width; check polarity.",
        width_index=round(wi, 2), correlation=round(corr, 2))

    lmc = stereo.get("low_mono_corr", 1.0)
    add("low_end_not_mono", _sev(0.4 - lmc, 0.0, 0.2, 0.4) if lmc < 0.4 else None, "stereo",
        "低頻不是單聲道 —— club/黑膠會不穩。", "Bass isn't mono — unstable on club/vinyl.",
        "在 120–150Hz 以下收成單聲道。", "Mono the low end below ~150 Hz.", low_mono_corr=round(lmc, 2))

    rank = {"high": 0, "medium": 1, "low": 2}
    P.sort(key=lambda p: rank.get(p["severity"], 3))
    return P


def _auto_corrections(band_dev: dict[str, float], dyn: dict[str, float],
                      stereo: dict[str, float], genre: str,
                      strength: float = 0.7) -> dict[str, Any]:
    """由分析推出自動修正設定(EQ band gains、低切、寬度、壓縮量、區段動態、響度目標)。

    strength = 自動校正「力度」(0.2 自然 … 1.0 強力)—— 當作修正 EQ 的信任係數:
    越低越保守(只做小幅修正、最自然),越高越貼近目標曲線(修正更明顯)。同時
    線性地調節寬度/區段動態的修正幅度,維持「夠好但不過頭」。
    """
    trust = float(np.clip(strength, 0.2, 1.0))
    # 每段修正 = 夾在 ±6dB 的 (目標−實測),再乘信任係數(寧可略修不過修)
    gains = {b: round(float(np.clip(-band_dev.get(b, 0.0), -6.0, 6.0)) * trust, 1) for b, _, _ in _BANDS}

    sub = band_dev.get("sub", 0.0)
    low_cut = 0
    if sub > 4.0:
        low_cut = 35
    if sub > 7.0:
        low_cut = 45

    lmc = stereo.get("low_mono_corr", 1.0)
    mono_below = 150 if lmc < 0.4 else 0

    crest = dyn.get("crest_factor_db", 12.0)
    dr = dyn.get("dr_est")
    lra = dyn.get("lra_lu", 6.0)
    if crest < 7.0 or (dr is not None and dr <= 6):
        comp_amount = 0.0
    else:
        comp_amount = 0.0
        if crest > 14.0:
            comp_amount += 0.5
        elif crest > 11.0:
            comp_amount += 0.3
        if lra > 12.0:
            comp_amount += 0.3
        elif lra > 9.0:
            comp_amount += 0.15
        comp_amount = float(np.clip(comp_amount, 0.0, 0.8))

    corr = stereo.get("correlation", 0.5)
    wi = stereo.get("width_index", 0.4)
    if corr < 0.0:
        width = 0.8
    elif wi > 1.0:
        width = 0.85
    elif wi < 0.12 or corr > 0.95:
        width = 1.3
    elif wi < 0.25:
        width = 1.15
    else:
        width = 1.0

    if crest < 7.0 or (dr is not None and dr <= 6):
        section = 0.4
    elif lra > 13.0:
        section = -0.3
    else:
        section = 0.15

    if genre in ("edm", "hiphop"):
        loud = "social"
    elif genre in ("rock", "pop", "rnb"):
        loud = "balanced"
    else:
        loud = "streaming"

    # 用力度同步調節寬度/壓縮/區段動態的修正幅度(以 0.7 為基準 → 1.0 倍,維持原行為)。
    sf = float(np.clip(trust / 0.7, 0.0, 1.2))
    width = 1.0 + (width - 1.0) * sf
    comp_amount = comp_amount * sf
    section = section * sf

    return {
        "eq_band_gains_db": gains,
        "low_cut_hz": low_cut,
        "mono_below_hz": mono_below,
        "comp_amount": round(comp_amount, 2),
        "width_factor": round(float(width), 2),
        "loudness": loud,
        "tp_ceiling_dbtp": -1.0,
        "section_amount": round(float(section), 2),
        "trust": round(trust, 2),
    }


# =========================================================================== #
# AI 曲風辨識(feature-based classifier,license-clean numpy/scipy)—— 用頻段形狀 +
# 動態(crest)+ 立體聲寬度 + 頻譜傾斜,對每個曲風的「典型特徵輪廓」算距離 → 機率。
# 自動挑起始預設(使用者可改);誠實附信心值 + 前 3 名。
# =========================================================================== #
# 每個曲風的典型「去均值頻段強調(dB)」+ 典型 crest(dB)+ 典型側/中寬度。
_GENRE_PROFILES: dict[str, dict] = {
    "edm":      {"bands": {"sub": 3.5, "bass": 2.5, "low_mid": -1.0, "mid": -2.0, "high_mid": -1.0, "presence": 1.5, "air": 2.5}, "crest": 6.5, "width": 0.55, "tilt": -3.0},
    "hiphop":   {"bands": {"sub": 4.5, "bass": 2.5, "low_mid": 0.0, "mid": -1.0, "high_mid": -1.5, "presence": -1.0, "air": -2.0}, "crest": 7.5, "width": 0.38, "tilt": -3.6},
    "pop":      {"bands": {"sub": 0.0, "bass": 1.0, "low_mid": -1.5, "mid": 0.0, "high_mid": 1.0, "presence": 1.5, "air": 1.5}, "crest": 8.5, "width": 0.5, "tilt": -3.2},
    "rock":     {"bands": {"sub": -2.5, "bass": 0.0, "low_mid": 2.0, "mid": 2.5, "high_mid": 1.0, "presence": 0.0, "air": -1.5}, "crest": 11.5, "width": 0.34, "tilt": -2.8},
    "rnb":      {"bands": {"sub": 2.5, "bass": 2.5, "low_mid": 1.0, "mid": 0.0, "high_mid": -1.0, "presence": -1.0, "air": 0.0}, "crest": 9.0, "width": 0.42, "tilt": -3.8},
    "acoustic": {"bands": {"sub": -3.5, "bass": -1.0, "low_mid": 1.0, "mid": 2.5, "high_mid": 1.5, "presence": 1.0, "air": 0.0}, "crest": 13.5, "width": 0.34, "tilt": -3.0},
    "ballad":   {"bands": {"sub": -1.5, "bass": 0.0, "low_mid": 1.0, "mid": 1.5, "high_mid": 1.0, "presence": 0.0, "air": 0.0}, "crest": 12.0, "width": 0.4, "tilt": -3.2},
    "lofi":     {"bands": {"sub": 1.0, "bass": 1.5, "low_mid": 2.5, "mid": 0.0, "high_mid": -2.0, "presence": -3.5, "air": -4.5}, "crest": 8.5, "width": 0.28, "tilt": -4.6},
}


def detect_genre(data: "np.ndarray", sr: int) -> dict:
    """從音訊特徵推測曲風。回 {genre, confidence 0..1, ranking:[{genre,prob}], features}。"""
    names = [b for b, _, _ in _BANDS]
    mono = np.mean(data, axis=1)
    f, pxx = _welch_psd(mono, sr)
    band_db = _band_levels_db(f, pxx)
    bm = float(np.mean(list(band_db.values())))
    emph = {b: band_db[b] - bm for b in names}                # 去均值頻段強調
    peak = float(np.max(np.abs(data))) + 1e-9
    rms = float(np.sqrt(np.mean(data ** 2)) + 1e-12)
    crest = 20.0 * np.log10(peak / rms)
    tilt = _spectral_tilt(f, pxx)
    if data.shape[1] >= 2:
        L, R = data[:, 0], data[:, 1]
        rms_mid = float(np.sqrt(np.mean((0.5 * (L + R)) ** 2) + 1e-12))
        rms_side = float(np.sqrt(np.mean((0.5 * (L - R)) ** 2) + 1e-12))
        width = rms_side / (rms_mid + 1e-12)
    else:
        width = 0.0
    # 距離 → 機率(權重:頻段形狀為主,動態/寬度/傾斜為輔)
    dists: dict[str, float] = {}
    for g, prof in _GENRE_PROFILES.items():
        d = sum((emph[b] - prof["bands"][b]) ** 2 for b in names)   # dB^2
        d += 0.5 * (crest - prof["crest"]) ** 2
        d += 30.0 * (width - prof["width"]) ** 2                     # 寬度 0..1 → 放大
        d += 1.5 * (tilt - prof["tilt"]) ** 2
        dists[g] = float(d)
    ds = np.array([dists[g] for g in _GENRE_PROFILES])
    # softmax over -distance;scale 取距離分佈的離散度,讓最佳曲風脫穎而出(但相似曲風仍分票)
    scale = max(10.0, 0.45 * float(np.median(ds)))
    probs = np.exp(-(ds - ds.min()) / scale)
    probs = probs / float(np.sum(probs))
    order = sorted(zip(_GENRE_PROFILES.keys(), probs), key=lambda kv: -kv[1])
    return {
        "genre": order[0][0],
        "confidence": round(float(order[0][1]), 2),
        "ranking": [{"genre": g, "prob": round(float(p), 2)} for g, p in order[:3]],
        "features": {"crest_db": round(crest, 1), "width": round(float(width), 2),
                     "tilt_db_oct": round(float(tilt), 2)},
    }


def analyze(data: "np.ndarray", sr: int, *, genre: str = "auto",
            section_amount: Optional[float] = None, strength: float = 0.7,
            light: bool = False) -> dict:
    """整首歌的智慧分析:響度/動態/頻譜/立體聲 + 問題清單 + 自動修正 + 視覺化資料。

    回傳結構見 README/前端 MasterAnalysis 型別。任一度量失敗都以安全值降級,不丟例外。
    light=True(效能模式 / 小筆電):跳過昂貴的滑動響度(短期/瞬間/LRA)與 4× 真峰超取樣,
    用整體 LUFS + 取樣峰值近似 → 分析快 ~3-4×,只用於『母帶後』視覺化(修正仍用完整前分析)。
    """
    if not _HAS_DSP:
        raise RuntimeError("母帶 DSP 相依不可用(需 scipy + pyloudnorm)")

    data = _to_stereo(np.asarray(data, dtype=np.float64))
    dur_s = round(data.shape[0] / float(sr), 2) if sr else 0.0
    xa, asr = _analysis_signal(data, sr)
    mono = np.mean(xa, axis=1)

    # ── 響度 ──────────────────────────────────────────────
    integrated = _measure_lufs(xa, asr)
    if light:  # 效能模式:跳過滑動響度 + 用取樣峰值(省下分析裡最貴的幾段)
        st = mom = np.array([])
        short_term_max = momentary_max = integrated
        lra = 0.0
        true_peak = _peak_db(data)
    else:
        st = _sliding_loudness(xa, asr, 3.0, hop_s=0.5)
        mom = _sliding_loudness(xa, asr, 0.4, hop_s=0.1)
        short_term_max = float(np.max(st)) if st.size else integrated
        momentary_max = float(np.max(mom)) if mom.size else integrated
        lra = _lra(_sliding_loudness(xa, asr, 3.0, hop_s=0.1))
        true_peak = _true_peak_dbtp(data, sr)
    sample_peak = _peak_db(xa)

    # ── 動態 ──────────────────────────────────────────────
    rms = float(np.sqrt(np.mean(xa ** 2) + 1e-12))
    rms_db = 20.0 * np.log10(rms + 1e-12)
    crest = sample_peak - rms_db
    plr = true_peak - integrated
    # PSR(3s 視窗:視窗峰值 - 短時響度的中位數)
    try:
        run_pk = maximum_filter1d(np.max(np.abs(xa), axis=1), size=max(1, int(3 * asr)))
        hopn = max(1, int(0.5 * asr))
        pk_s = 20.0 * np.log10(run_pk[::hopn][:st.size] + 1e-12)
        psr = float(np.median(pk_s - st)) if st.size else 0.0
    except Exception:
        psr = crest
    dr_est = _estimate_dr(mono, asr)

    dyn = {"crest_factor_db": crest, "plr": plr, "psr": psr, "dr_est": dr_est,
           "lra_lu": lra, "true_peak_dbtp": true_peak}

    # ── 頻譜 ──────────────────────────────────────────────
    f, pxx = _welch_psd(mono, asr)
    band_db = _band_levels_db(f, pxx)
    centroid = _spectral_centroid(f, pxx)
    tilt = _spectral_tilt(f, pxx)
    spec = {"centroid_hz": centroid, "tilt_db_oct": tilt}

    # 正規化頻段(去掉整體響度,只比形狀)→ 與目標的偏差
    meas_mean = float(np.mean(list(band_db.values())))
    tgt_levels = _target_band_levels(genre)
    tgt_mean = float(np.mean(list(tgt_levels.values())))
    band_dev = {b: (band_db[b] - meas_mean) - (tgt_levels[b] - tgt_mean) for b, _, _ in _BANDS}

    # ── 立體聲 ────────────────────────────────────────────
    L, R = xa[:, 0], xa[:, 1]
    mid = 0.5 * (L + R)
    side = 0.5 * (L - R)
    rms_mid = float(np.sqrt(np.mean(mid ** 2) + 1e-12))
    rms_side = float(np.sqrt(np.mean(side ** 2) + 1e-12))
    denom = float(np.sqrt(np.sum(L ** 2) * np.sum(R ** 2)) + 1e-12)
    correlation = float(np.sum(L * R) / denom)
    width_index = float(rms_side / (rms_mid + 1e-12))
    ms_balance = 20.0 * np.log10((rms_side + 1e-12) / (rms_mid + 1e-12))
    try:
        sos = sps.butter(4, min(150.0 / (asr / 2.0), 0.99), btype="low", output="sos")
        Ll = sps.sosfilt(sos, L)
        Rl = sps.sosfilt(sos, R)
        ld = float(np.sqrt(np.sum(Ll ** 2) * np.sum(Rl ** 2)) + 1e-12)
        low_mono_corr = float(np.sum(Ll * Rl) / ld)
    except Exception:
        low_mono_corr = correlation
    stereo = {"correlation": correlation, "width_index": width_index,
              "ms_balance_db": ms_balance, "low_mono_corr": low_mono_corr,
              "mono_compatible": correlation > 0.1}

    # ── 問題 + 自動修正 ───────────────────────────────────
    problems = _detect_problems(band_dev, dyn, spec, stereo)
    corrections = _auto_corrections(band_dev, dyn, stereo, genre, strength)
    sec_amt = corrections["section_amount"] if section_amount is None else float(section_amount)
    # 自動 EQ 曲線:把資料驅動的修正 EQ(各頻段增益 → biquad)+ 低切 串成綜合響應供 UI 畫
    _eq_bands = [(_BAND_EQ[b][0], _BAND_EQ[b][1], corrections["eq_band_gains_db"].get(b, 0.0), _BAND_EQ[b][2])
                 for b, _, _ in _BANDS]
    corrections["eq_curve"] = _eq_response_curve(_eq_bands, asr, corrections.get("low_cut_hz", 0.0))

    # ── 繪圖:頻譜曲線(before / target / 預測 after)──────
    fmax = min(20000.0, asr / 2.0 - 1.0)
    logf = np.geomspace(20.0, fmax, 160)
    before_raw = _spectrum_curve(mono, asr, logf)
    # 修正用 EQ 曲線(由各頻段 gain 在 log-freq 內插,平滑)
    centers = np.array([_BAND_EQ[b][1] for b, _, _ in _BANDS])
    cg = np.array([corrections["eq_band_gains_db"][b] for b, _, _ in _BANDS])
    eq_delta = np.interp(np.log10(logf), np.log10(centers), cg, left=cg[0], right=cg[-1])
    eq_delta = _log_smooth(eq_delta, logf, frac=1.0 / 3.0)
    after_raw = before_raw + eq_delta
    tgt_raw = _target_curve_db(logf)
    ref0 = float(np.max(before_raw))
    spectrum = {
        "freqs": [round(float(v), 1) for v in logf],
        "before_db": [round(float(v - ref0), 1) for v in before_raw],
        "after_db": [round(float(v - ref0), 1) for v in after_raw],
        "target_db": [round(float(v - float(np.max(tgt_raw))), 1) for v in tgt_raw],
    }

    bands_out = []
    for b, lo, hi in _BANDS:
        bands_out.append({
            "name": b, "lo": lo, "hi": hi,
            "measured_db": round(band_db[b] - meas_mean, 1),
            "target_db": round(tgt_levels[b] - tgt_mean, 1),
            "deviation_db": round(band_dev[b], 1),
            "eq_gain_db": corrections["eq_band_gains_db"][b],
        })

    # ── 區段動態(主歌/副歌)+ 套用中的增益曲線 ──────────
    times, env_db = _energy_envelope(mono, asr, hop_s=0.5, win_s=1.0)
    segments = _detect_sections(times, env_db, hop_s=0.5)
    gain_curve = _section_gain_db(env_db, sec_amt, hop_s=0.5)
    sections = {
        "times_s": [round(float(v), 2) for v in times],
        "energy_db": [round(float(v), 1) for v in env_db],
        "segments": segments,
        "gain_curve_db": [round(float(v), 2) for v in gain_curve],
        "amount": round(float(sec_amt), 3),
    }

    # 分數 = 100 − 問題罰分 + 「達標獎勵」。關鍵不變式:只有真正做好的母帶才拿得到獎勵與綠燈
    # —— 過壓/相位差的爛母帶即使限幅器把真峰/斜率做漂亮,也**不准**靠音色獎勵爬進綠帶。
    penalties = sum({"high": 15, "medium": 7, "low": 3}.get(p["severity"], 0) for p in problems)
    pids = {p["id"] for p in problems}
    has_dyn_fault = ("over_compressed" in pids) or any(p["area"] == "dynamics" for p in problems)
    has_stereo_fault = bool(pids & {"too_narrow", "too_wide_phase", "low_end_not_mono"})
    bonus = 0.0
    # 音色/響度獎勵:只有在「動態沒問題」時才給(否則限幅器產物會輕鬆刷滿)
    if not has_dyn_fault:
        if true_peak <= -1.0:
            bonus += 3.0
        elif true_peak <= 0.0:
            bonus += 1.0
        if -4.6 <= tilt <= -2.4:
            bonus += 2.0
        if dr_est is not None and dr_est >= 8:
            bonus += 2.0
        if crest >= 8.0:
            bonus += 2.0
    # 立體聲獎勵:只有在沒有立體聲問題時才給
    if not has_stereo_fault and 0.15 <= width_index <= 0.9 and correlation > 0.2:
        bonus += 2.0
    bonus = min(bonus, 12.0)
    score = 100 - penalties + bonus
    # 硬上限:被判定過度壓縮的母帶,不論音色多漂亮都不得進入「綠燈(>=80)」。
    if has_dyn_fault:
        score = min(score, 72)
    score = int(max(0, min(100, round(score))))

    _out = {
        "sr": asr,
        "duration_s": dur_s,
        "genre": genre,
        "spectrum": spectrum,
        "bands": bands_out,
        "sections": sections,
        "loudness": {
            "integrated_lufs": round(integrated, 1),
            "short_term_max_lufs": round(short_term_max, 1),
            "momentary_max_lufs": round(momentary_max, 1),
            "lra_lu": round(lra, 1),
            "true_peak_dbtp": round(true_peak, 2),
            "sample_peak_dbfs": round(sample_peak, 2),
        },
        "dynamics": {
            "crest_factor_db": round(crest, 1),
            "plr": round(plr, 1),
            "psr": round(psr, 1),
            "dr_est": dr_est,
            "rms_db": round(rms_db, 1),
        },
        "spectral": {"centroid_hz": round(centroid, 0), "tilt_db_oct": round(tilt, 2)},
        "stereo": {
            "correlation": round(correlation, 2),
            "width_index": round(width_index, 2),
            "ms_balance_db": round(ms_balance, 1),
            "low_mono_corr": round(low_mono_corr, 2),
            "mono_compatible": bool(correlation > 0.1),
        },
        "problems": problems,
        "corrections": corrections,
        "overall_score": score,
    }
    return _finite_scrub(_out)


def _estimate_dr(mono: "np.ndarray", sr: int) -> Optional[int]:
    """TT-DR 風格估計:取最大聲 20% 區塊,峰值/RMS 比(dB)。資料不足回 None。"""
    w = max(1, int(3 * sr))
    n = mono.shape[0]
    if n < 3 * w:
        return None
    starts = range(0, n - w, w)
    rms_list = []
    pk_list = []
    for i in starts:
        blk = mono[i:i + w]
        rms_list.append(float(np.sqrt(np.mean(blk ** 2) + 1e-12)))
        pk_list.append(float(np.max(np.abs(blk)) + 1e-12))
    if len(rms_list) < 3:
        return None
    rms_a = np.array(rms_list)
    pk_a = np.array(pk_list)
    idx = np.argsort(rms_a)[-max(1, len(rms_a) // 5):]
    rms_top = float(np.sqrt(np.mean(rms_a[idx] ** 2)))
    pk_top = float(np.mean(pk_a[idx]))
    return int(round(20.0 * np.log10(pk_top / (rms_top + 1e-12) + 1e-12)))


def analyze_file(path: str, *, genre: str = "auto", strength: float = 0.7) -> dict:
    """讀檔 + analyze()。供 /api/master/analyze 直接呼叫。"""
    if not _HAS_DSP:
        raise RuntimeError("母帶 DSP 相依不可用(需 scipy + pyloudnorm)")
    data, sr = _load_audio(path)
    result = analyze(data, sr, genre=genre, strength=strength)
    try:
        result["detectedGenre"] = detect_genre(data, sr)  # AI 曲風辨識(建議起始預設)
    except Exception:
        logger.warning("曲風辨識失敗(略過)", exc_info=True)
    return result


def match_loudness(input_path: str, output_path: str, target_lufs: float) -> dict:
    """把任一音檔調到 target_lufs(只縮放、不做任何處理),寫成 24-bit WAV。
    供「三方比較」把外部母帶對齊到本軟體母帶的響度,公平 A/B/C。回 {matchedLufs, gainDb}。"""
    if not _HAS_DSP:
        raise RuntimeError("母帶 DSP 相依不可用(需 scipy + pyloudnorm)")
    data, sr = _load_audio(input_path)
    cur = _measure_lufs(data, sr)
    gain_db = float(np.clip(float(target_lufs) - cur, -24.0, 24.0))
    out = data * (10 ** (gain_db / 20.0))
    pk = float(np.max(np.abs(out))) if out.size else 0.0
    if pk > 1.0:
        out = out / pk  # 等比縮放避免破峰,LUFS 匹配維持在 ~0.1dB 內
    _write_wav(output_path, out, sr)
    return {"matchedLufs": round(_measure_lufs(out, sr), 2), "gainDb": round(gain_db, 2)}


# =========================================================================== #
# 專業處理鏈(Pro chain)—— 多頻段壓縮、齒音消除、諧波飽和、二次修正 EQ、
# 立體聲示波器資料。全 numpy/scipy,授權乾淨。
# =========================================================================== #

_METER_HZ = 16.0  # GR / de-ess 計量送往 UI 的解析度(~16 fps)
_GONIO_POINTS = 1400  # 示波器散點數
_GR_MAX_POINTS = 1800  # GR 包絡上限點數(避免長檔 JSON 無上限膨脹)

# 多頻段壓縮每段預設 (thresh_db, ratio, attack_ms, release_ms, makeup_db)
_MB_BANDS_DEFAULT: dict[str, dict[str, float]] = {
    "low": {"thresh_db": -22.0, "ratio": 2.5, "attack_ms": 30.0, "release_ms": 180.0, "makeup_db": 0.0},
    "mid": {"thresh_db": -20.0, "ratio": 2.0, "attack_ms": 15.0, "release_ms": 120.0, "makeup_db": 0.0},
    "high": {"thresh_db": -24.0, "ratio": 2.2, "attack_ms": 5.0, "release_ms": 80.0, "makeup_db": 0.0},
}


def _downsample_env_db(gain_lin: "np.ndarray", sr: int, meter_hz: float = _METER_HZ) -> list:
    """逐樣本線性增益(<=1)→ dB 包絡,降到 ~meter_hz。每塊取最小(最壞 GR)讓暫態看得見。"""
    if gain_lin.size == 0:
        return []
    blk = max(1, int(sr / max(meter_hz, 1.0)))
    n = gain_lin.shape[0]
    pad = (-n) % blk
    g = np.concatenate([gain_lin, np.ones(pad)]) if pad else gain_lin
    g = g.reshape(-1, blk).min(axis=1)
    gr_db = 20.0 * np.log10(np.clip(g, 1e-4, 1.0))
    # 上限化:長檔(DJ set/podcast)不讓點數無上限成長 → 固定上限,UI 畫線足夠
    if gr_db.shape[0] > _GR_MAX_POINTS:
        stride = int(np.ceil(gr_db.shape[0] / _GR_MAX_POINTS))
        gr_db = gr_db[::stride]
    return [round(float(v), 2) for v in gr_db]


def _lr4_sos(sr: int, fc: float, btype: str) -> "np.ndarray":
    """Linkwitz-Riley 4 階 = 兩級串接的 2 階 Butterworth(相位一致、合成平坦)。"""
    wn = min(max(fc / (sr / 2.0), 1e-4), 0.999)
    sos2 = sps.butter(2, wn, btype=btype, output="sos")
    return np.vstack([sos2, sos2])


def _lr4_split3(data: "np.ndarray", sr: int, f_lo: float = 200.0,
                f_hi: float = 4000.0) -> tuple["np.ndarray", "np.ndarray", "np.ndarray"]:
    """相位一致 3 頻段 LR4 分頻:low + mid + high ≈ input(量值平坦)。"""
    lp_lo = _lr4_sos(sr, f_lo, "low")
    hp_lo = _lr4_sos(sr, f_lo, "high")
    lp_hi = _lr4_sos(sr, f_hi, "low")
    hp_hi = _lr4_sos(sr, f_hi, "high")
    low = np.empty_like(data)
    mid = np.empty_like(data)
    high = np.empty_like(data)
    for ch in range(data.shape[1]):
        x = data[:, ch]
        lo_full = sps.sosfilt(lp_lo, x)
        hi_full = sps.sosfilt(hp_lo, x)
        low[:, ch] = lo_full
        mid[:, ch] = sps.sosfilt(lp_hi, hi_full)
        high[:, ch] = sps.sosfilt(hp_hi, hi_full)
    return low, mid, high


def _comp_band(band: "np.ndarray", sr: int, *, thresh_db: float, ratio: float,
               attack_ms: float, release_ms: float, makeup_db: float) -> tuple["np.ndarray", "np.ndarray"]:
    """壓一個頻段。回 (壓縮後音訊, 逐樣本線性增益<=1 不含 makeup,供 GR 計量)。向量化平滑。"""
    detect = np.sqrt(np.mean(band ** 2, axis=1) + 1e-12)
    level_db = 20.0 * np.log10(detect + 1e-9)
    over = np.maximum(0.0, level_db - thresh_db)
    gr_db = -over * (1.0 - 1.0 / max(ratio, 1.0))
    tau = max(1.0, (attack_ms + release_ms) / 2.0)
    a = float(np.exp(-1.0 / (sr * tau / 1000.0)))
    gr_sm = sps.lfilter([1 - a], [1, -a], gr_db)
    comp_gain = 10 ** (gr_sm / 20.0)
    out_gain = 10 ** ((gr_sm + makeup_db) / 20.0)
    return band * out_gain[:, None], comp_gain


def _multiband_compress(data: "np.ndarray", sr: int, *, amount: float = 1.0,
                        f_lo: float = 200.0, f_hi: float = 4000.0) -> tuple["np.ndarray", dict]:
    """3 頻段 LR4 多頻段壓縮(專業母帶核心)。amount 縮放各段 ratio 超出量與 makeup。
    回 (音訊, meter:各段 GR 包絡 dB@~16Hz + 摘要)。"""
    amount = float(max(0.0, amount))
    if amount < 1e-3:
        return data, {"active": False, "f_lo": f_lo, "f_hi": f_hi, "meter_hz": _METER_HZ, "bands": {}}
    low, mid, high = _lr4_split3(data, sr, f_lo, f_hi)
    out = np.zeros_like(data)
    bands_meter: dict[str, dict] = {}
    for name, band in (("low", low), ("mid", mid), ("high", high)):
        p = dict(_MB_BANDS_DEFAULT[name])
        p["ratio"] = 1.0 + (p["ratio"] - 1.0) * amount
        p["makeup_db"] = p["makeup_db"] * amount
        comp, gain_lin = _comp_band(band, sr, **p)
        out += comp
        env = _downsample_env_db(gain_lin, sr)
        bands_meter[name] = {"gr_db": env, "max_gr_db": round(float(min(env)) if env else 0.0, 2)}
    return out, {"active": True, "f_lo": f_lo, "f_hi": f_hi, "meter_hz": _METER_HZ, "bands": bands_meter}


# =========================================================================== #
# 手動多頻段壓縮(Pro)—— 自訂分頻點 → N 段,每段獨立 threshold/ratio/attack/release/
# knee/makeup + 每段 M/S 路由(中/側分別壓)+ 每段立體聲寬度。相位一致 LR4 分頻,
# 真實雙時間常數(attack≠release)用「控制速率」迴圈做(向量化拿不到狀態相依係數)。
# =========================================================================== #
def _lr4_split_n(data: "np.ndarray", sr: int, crossovers: list) -> list:
    """以一串分頻點切成 N+1 段『真正的 LR4 帶通』(同 _lr4_split3 的串接法:每段 = 對上一段
    高頻殘量做 LR4 高通 → 再 LR4 低通)。各段有 24 dB/oct 真實裙邊 → 頻段隔離乾淨(kick 不會
    漏進中/高頻去誤觸該段壓縮器)。各段相加為 allpass(量值平坦、相位一致)= 多頻段業界標準。"""
    xs = sorted(float(c) for c in crossovers if 20.0 < float(c) < sr / 2.0 - 50.0)
    parts: list = []
    remaining = data
    for c in xs:
        lp = _lr4_sos(sr, c, "low")
        hp = _lr4_sos(sr, c, "high")
        low = np.empty_like(remaining)
        high = np.empty_like(remaining)
        for ch in range(data.shape[1]):
            low[:, ch] = sps.sosfilt(lp, remaining[:, ch])
            high[:, ch] = sps.sosfilt(hp, remaining[:, ch])
        parts.append(low)
        remaining = high  # 只把「真實高通」往下一段切 → 每段都是乾淨帶通
    parts.append(remaining)
    return parts  # len == len(xs) + 1


def _comp_gr_db(level_db: "np.ndarray", thresh_db: float, ratio: float, knee_db: float) -> "np.ndarray":
    """軟膝壓縮靜態增益曲線 → 逐樣本增益衰減 dB(<=0)。膝區用二次曲線平滑過渡。"""
    slope = (1.0 / max(float(ratio), 1.0)) - 1.0  # <= 0
    over = level_db - float(thresh_db)
    knee = max(0.0, float(knee_db))
    if knee > 1e-6:
        gr = np.zeros_like(level_db)
        above = over >= knee / 2.0
        ink = (over > -knee / 2.0) & (~above)
        gr[above] = slope * over[above]
        gr[ink] = slope * (over[ink] + knee / 2.0) ** 2 / (2.0 * knee)
        return gr
    return np.minimum(0.0, slope * over)


_COMP_CTRL_DS = 32  # 壓縮器控制速率降採樣(sr/32 ≈ 1.4kHz):偵測/曲線/ballistics 都在此速率
                    # (母帶 attack/release 多在 5–300ms,此解析度足夠,且把 Python 迴圈減半)


def _comp_envelope(detect: "np.ndarray", sr: int, *, thresh_db: float, ratio: float, attack_ms: float,
                   release_ms: float, knee_db: float, makeup_db: float
                   ) -> tuple["np.ndarray", "np.ndarray", float]:
    """從偵測訊號 detect (n, ch) 算出『逐樣本線性增益(含 makeup)』+ GR_dB 控制速率包絡 + ctrl_rate。
    整條包絡在『控制速率』算(偵測、軟膝曲線、attack/release),只有最後上採樣走全速率 → 快。"""
    n = detect.shape[0]
    ds = max(1, int(_COMP_CTRL_DS))
    sq = np.einsum("ij,ij->i", detect, detect) / detect.shape[1]  # 逐樣本功率
    nb = n // ds
    if nb < 2:  # 極短 → 全速率退化
        level_db = 10.0 * np.log10(sq + 1e-12)
        gr = _comp_gr_db(level_db, thresh_db, ratio, knee_db)
        tau = max(1.0, (float(attack_ms) + float(release_ms)) / 2.0)
        a = float(np.exp(-1.0 / (sr * tau / 1000.0)))
        gr_sm = sps.lfilter([1 - a], [1, -a], gr)
        return 10 ** ((gr_sm + float(makeup_db)) / 20.0), gr_sm, float(sr)
    blk = sq[:nb * ds].reshape(nb, ds).mean(axis=1)            # 控制速率 RMS 偵測(每塊平均功率)
    level_db = 10.0 * np.log10(blk + 1e-12)                    # 10log10(功率)= 振幅 dBFS
    gr = _comp_gr_db(level_db, thresh_db, ratio, knee_db)      # 控制速率軟膝曲線(<=0)
    cr = sr / ds
    aa = float(np.exp(-1.0 / max(1.0, cr * float(attack_ms) / 1000.0)))
    ar = float(np.exp(-1.0 / max(1.0, cr * float(release_ms) / 1000.0)))
    ctrl = np.empty(nb)
    g = 0.0
    for i in range(nb):                                        # 狀態相依雙時間常數(控制速率,輕量)
        t = float(gr[i])
        coef = aa if t < g else ar                            # 更多衰減→attack;放開→release
        g = coef * g + (1.0 - coef) * t
        ctrl[i] = g
    xp = np.arange(nb) * ds + ds / 2.0
    out_gain = np.interp(np.arange(n), xp, 10 ** ((ctrl + float(makeup_db)) / 20.0))
    return out_gain, ctrl, cr


def _comp_apply(arr: "np.ndarray", sr: int, **p) -> tuple["np.ndarray", "np.ndarray", float]:
    """壓一個 (n, ch) 區塊(立體聲鏈接:偵測自己、套自己)。回 (壓後音訊, GR_dB 包絡, ctrl_rate)。"""
    out_gain, gr_db, cr = _comp_envelope(arr, sr, **p)
    return arr * out_gain[:, None], gr_db, cr


def _env_db_meter(gr_db: "np.ndarray", ctrl_rate: float, meter_hz: float = _METER_HZ) -> list:
    """控制速率 GR(dB,<=0)→ ~meter_hz 包絡(每塊取最壞 GR),供 GainReduction UI。"""
    if gr_db.size == 0:
        return []
    blk = max(1, int(ctrl_rate / max(meter_hz, 1.0)))
    nb = gr_db.shape[0] // blk
    env = gr_db[:nb * blk].reshape(nb, blk).min(axis=1) if nb >= 1 else gr_db
    if env.shape[0] > _GR_MAX_POINTS:
        env = env[::int(np.ceil(env.shape[0] / _GR_MAX_POINTS))]
    return [round(float(v), 2) for v in env]


def _apply_width(band: "np.ndarray", width: float) -> "np.ndarray":
    """單一頻段的立體聲寬度(M/S:側訊號 × width)。width=1 不變,0=單聲道,>1 變寬。"""
    if band.shape[1] < 2 or abs(float(width) - 1.0) < 1e-3:
        return band
    m = 0.5 * (band[:, 0] + band[:, 1])
    s = 0.5 * (band[:, 0] - band[:, 1]) * float(width)
    out = np.empty_like(band)  # 就地填(避開 column_stack 的額外配置)
    out[:, 0] = m + s
    out[:, 1] = m - s
    return out


def _multiband_manual(data: "np.ndarray", sr: int, crossovers: list, bands: list) -> tuple["np.ndarray", dict]:
    """手動 N 段多頻段:每段獨立壓縮 + M/S + 寬度。回 (音訊, meter:各段 GR 包絡 + 摘要)。"""
    # 全段 bypass/空 → 直接原樣回傳(真正透明 + 省掉分頻運算)
    if not bands or all((b is None or b.get("bypass")) for b in bands):
        return data, {"active": False, "crossovers": [], "meter_hz": _METER_HZ, "bands": {}}
    parts = _lr4_split_n(data, sr, crossovers)
    if len(parts) != len(bands):  # 對不齊 → 安全降級(以較短者為準,多的段落原樣通過)
        logger.warning("手動多頻段:段數(%d)與參數(%d)不符,對齊處理", len(parts), len(bands))
    xs = sorted(float(c) for c in crossovers if 20.0 < float(c) < sr / 2.0 - 50.0)
    edges = [20.0, *xs, sr / 2.0]
    out = np.zeros_like(data)
    bands_meter: dict[str, dict] = {}
    any_active = False
    for i, band in enumerate(parts):
        bp = bands[i] if i < len(bands) else None
        lo = edges[i] if i < len(edges) - 1 else edges[-2]
        hi = edges[i + 1] if i + 1 < len(edges) else edges[-1]
        label = f"{lo:.0f}–{hi:.0f}"
        if bp is None or bp.get("bypass"):
            out += band
            continue
        p = dict(thresh_db=float(bp.get("threshold", -24.0)), ratio=float(bp.get("ratio", 2.0) or 1.0),
                 attack_ms=float(bp.get("attack", 15.0) or 1.0), release_ms=float(bp.get("release", 120.0) or 1.0),
                 knee_db=float(bp.get("knee", 6.0)), makeup_db=float(bp.get("makeup", 0.0)))
        wv = bp.get("width", 1.0)
        width = float(wv) if wv is not None else 1.0  # 不可用 `or 1.0`:width=0(單聲道)是合法值
        ms = bool(bp.get("ms", False))
        try:
            if ms and band.shape[1] == 2:  # M/S 域:偵測 Mid 算『鏈接』增益 → 同樣套到 M 與 S
                mid = 0.5 * (band[:, 0] + band[:, 1])
                side = 0.5 * (band[:, 0] - band[:, 1])
                gain, gr_db, cr = _comp_envelope(mid[:, None], sr, **p)  # 鏈接 → 壓縮時立體聲像穩定不抽吸
                out_m = mid * gain
                out_s = side * gain * width                              # 同一增益(穩定像)+ 寬度只動側
                comp = np.empty_like(band)
                comp[:, 0] = out_m + out_s
                comp[:, 1] = out_m - out_s
            else:
                comp, gr_db, cr = _comp_apply(band, sr, **p)
                comp = _apply_width(comp, width)
            if not np.isfinite(comp).all():  # 防線:任一段壞掉不污染整體和(壞參數 → 原樣通過)
                logger.warning("手動多頻段 %s 出現非有限值(原樣通過)", label)
                out += band
                continue
            out += comp
            env = _env_db_meter(gr_db, cr)
            bands_meter[label] = {"gr_db": env, "max_gr_db": round(float(min(env)) if env else 0.0, 2),
                                  "ms": ms, "width": round(width, 2)}
            any_active = True
        except Exception:
            logger.warning("手動多頻段 %s 失敗(原樣通過)", label, exc_info=True)
            out += band
    return out, {"active": any_active, "crossovers": xs, "meter_hz": _METER_HZ, "bands": bands_meter}


def _sibilant_band(data: "np.ndarray", sr: int,
                   default: tuple = (5000.0, 9000.0)) -> tuple[float, float]:
    """偵測『實際齒音峰值頻率』(4.5–11kHz 內能量最集中處)→ 以它為中心的 de-ess 頻帶。
    讓去齒音跟著真正的 ess/sh 位置走(每個歌手/麥克風不同),而非套死 5–9kHz。"""
    try:
        mono = np.mean(data, axis=1)
        f, pxx = _welch_psd(mono, sr)
        m = (f >= 4500.0) & (f <= 11000.0)
        if not np.any(m):
            return default
        fpk = float(f[m][int(np.argmax(pxx[m]))])
        return (max(3800.0, fpk * 0.78), min(sr / 2.0 * 0.95, fpk * 1.32))
    except Exception:
        return default


def _deesser(data: "np.ndarray", sr: int, *, f_lo: float = 5000.0, f_hi: float = 9000.0,
             thresh_db: float = -30.0, ratio: float = 4.0, max_reduction_db: float = 8.0,
             attack_ms: float = 1.0, release_ms: float = 60.0, amount: float = 1.0) -> tuple["np.ndarray", dict]:
    """5–9kHz 齒音帶的頻率選擇性向下壓縮。amount 縮放積極度。回 (音訊, meter)。"""
    amount = float(max(0.0, amount))
    if amount < 1e-3:
        return data, {"active": False, "band_hz": [f_lo, f_hi], "meter_hz": _METER_HZ}
    hp = _lr4_sos(sr, f_lo, "high")
    lp = _lr4_sos(sr, f_hi, "low")
    sib = np.empty_like(data)
    for ch in range(data.shape[1]):
        sib[:, ch] = sps.sosfilt(lp, sps.sosfilt(hp, data[:, ch]))
    rest = data - sib
    eff_thresh = thresh_db - 2.0 * amount
    eff_ratio = 1.0 + (ratio - 1.0) * amount
    detect = np.sqrt(np.mean(sib ** 2, axis=1) + 1e-12)
    level_db = 20.0 * np.log10(detect + 1e-9)
    over = np.maximum(0.0, level_db - eff_thresh)
    gr_db = -over * (1.0 - 1.0 / max(eff_ratio, 1.0))
    gr_db = np.maximum(gr_db, -float(max_reduction_db))
    tau = max(1.0, (attack_ms + release_ms) / 2.0)
    a = float(np.exp(-1.0 / (sr * tau / 1000.0)))
    gr_sm = sps.lfilter([1 - a], [1, -a], gr_db)
    gain = 10 ** (gr_sm / 20.0)
    out = rest + sib * gain[:, None]
    env = _downsample_env_db(gain, sr)
    active_frac = float(np.mean(gr_sm < -0.1))
    return out, {"active": True, "band_hz": [f_lo, f_hi], "meter_hz": _METER_HZ, "gr_db": env,
                 "max_reduction_db": round(float(-min(env)) if env else 0.0, 2),
                 "active_pct": round(100.0 * active_frac, 1)}


def _saturate(data: "np.ndarray", sr: int, *, amount: float = 0.3, asymmetry: float = 0.2,
              oversample: int = 2) -> "np.ndarray":
    """溫和諧波飽和(類比暖度 / 人味)+ dry/wet。2× 過取樣抗混疊(效能模式用 1×,省一半時間)。
    RMS 對齊乾訊號(響度由後段決定)。"""
    amt = float(np.clip(amount, 0.0, 1.0))
    if amt < 1e-3:
        return data
    drive = 1.0 + 4.0 * amt
    wet = 0.25 + 0.45 * amt
    os = max(1, int(oversample))
    up = sps.resample_poly(data, os, 1, axis=0) if os > 1 else data
    x = up * drive
    tx = np.tanh(x)
    shaped = tx + asymmetry * amt * (tx ** 2 - np.mean(tx ** 2, axis=0))
    shaped = shaped / drive
    down = sps.resample_poly(shaped, 1, os, axis=0) if os > 1 else shaped
    if down.shape[0] >= data.shape[0]:
        down = down[: data.shape[0]]
    else:
        down = np.pad(down, ((0, data.shape[0] - down.shape[0]), (0, 0)))
    wetdry = (1.0 - wet) * data + wet * down
    r_dry = np.sqrt(np.mean(data ** 2) + 1e-12)
    r_wet = np.sqrt(np.mean(wetdry ** 2) + 1e-12)
    return wetdry * (r_dry / r_wet)


def _residual_corrective_eq(data: "np.ndarray", sr: int, *, genre: str = "auto",
                            strength: float = 0.6, max_band_db: float = 3.0) -> tuple["np.ndarray", dict]:
    """在(已處理的)音訊上重新量頻段偏差,套一道溫和的殘差修正 EQ 把差距補滿(±3dB 上限,
    *strength,避免過修/共振)。這是讓 after 分數真正提高的關鍵。回 (音訊, info)。"""
    xa, asr = _analysis_signal(data, sr)
    mono = np.mean(xa, axis=1)
    f, pxx = _welch_psd(mono, asr)
    band_db = _band_levels_db(f, pxx)
    meas_mean = float(np.mean(list(band_db.values())))
    tgt = _target_band_levels(genre)
    tgt_mean = float(np.mean(list(tgt.values())))
    applied: dict[str, float] = {}
    bands: list[tuple] = []
    for name, _lo, _hi in _BANDS:
        dev = (band_db[name] - meas_mean) - (tgt[name] - tgt_mean)
        g = float(np.clip(-dev, -max_band_db, max_band_db)) * float(np.clip(strength, 0.0, 1.0))
        g = round(g, 2)
        applied[name] = g
        if abs(g) > 1e-2:
            kind, f0, q = _BAND_EQ[name]
            bands.append((kind, f0, g, q))
    out = _apply_eq(data, sr, bands) if bands else data
    return out, {"applied_db": applied, "max_db": max_band_db, "strength": round(float(strength), 2)}


def _goniometer(data: "np.ndarray", sr: int) -> dict:
    """立體聲示波器資料:抽樣 L/R 散點(client 端旋轉成 mid/side)+ 整體 + 各頻段相關/寬度。"""
    if data.shape[1] < 2 or data.shape[0] == 0:
        return {"points": [], "correlation": 1.0, "width_index": 0.0, "bands": []}
    L, R = data[:, 0], data[:, 1]
    n = L.shape[0]
    step = max(1, n // _GONIO_POINTS)
    Ls, Rs = L[::step][:_GONIO_POINTS], R[::step][:_GONIO_POINTS]
    pts = [[round(float(a), 3), round(float(b), 3)] for a, b in zip(Ls, Rs)]

    def _corr_width(l: "np.ndarray", r: "np.ndarray") -> tuple[float, float]:
        denom = float(np.sqrt(np.sum(l ** 2) * np.sum(r ** 2)) + 1e-12)
        corr = float(np.sum(l * r) / denom)
        mid = 0.5 * (l + r)
        side = 0.5 * (l - r)
        rms_mid = float(np.sqrt(np.mean(mid ** 2) + 1e-12))
        rms_side = float(np.sqrt(np.mean(side ** 2) + 1e-12))
        return round(corr, 3), round(float(rms_side / (rms_mid + 1e-12)), 3)

    corr, width = _corr_width(L, R)
    band_out = []
    for name, lo, hi in (("low", 20.0, 200.0), ("mid", 200.0, 4000.0), ("high", 4000.0, 20000.0)):
        try:
            sos = sps.butter(4, [max(lo, 20.0) / (sr / 2.0), min(hi, sr / 2.0 - 1.0) / (sr / 2.0)],
                             btype="band", output="sos")
            lb = sps.sosfilt(sos, L)
            rb = sps.sosfilt(sos, R)
            c, w = _corr_width(lb, rb)
        except Exception:
            c, w = corr, width
        band_out.append({"name": name, "correlation": c, "width_index": w})
    return {"points": pts, "correlation": corr, "width_index": width, "bands": band_out}


# =========================================================================== #
# 動態 EQ(Dynamic EQ)—— 頻率選擇性的動態處理:某頻段只在它「突出」(超過門檻)
# 時才修,平常不動。比靜態 EQ 透明 —— 用來馴服間歇性的刺耳/共振/轟。
# 做法:抽出該頻段(bandpass),用偵測器算逐樣本增益,out = data + (g-1)*band。
# =========================================================================== #
def _bandpass_sos(sr: int, f0: float, q: float) -> "np.ndarray":
    """中心 f0、頻寬由 Q 決定的 2 階 Butterworth 帶通(通帶單位增益)。"""
    bw = max(10.0, float(f0) / max(float(q), 0.3))
    lo = max(20.0, f0 - bw / 2.0)
    hi = min(sr / 2.0 - 1.0, f0 + bw / 2.0)
    if hi <= lo:
        hi = min(sr / 2.0 - 1.0, lo * 1.25)
    return sps.butter(2, [lo / (sr / 2.0), hi / (sr / 2.0)], btype="band", output="sos")


def _bandpass_edges_sos(sr: int, lo: float, hi: float, order: int = 2) -> "np.ndarray":
    """以明確 [lo, hi) 邊界做帶通 —— 讓「量到偏差的頻段」與「實際施加修正的頻段」一致
    (避免用 f0/Q 推出來的頻寬過寬,把修正灑到鄰近頻段)。"""
    ny = sr / 2.0
    lo = float(np.clip(lo, 12.0, ny * 0.96))
    hi = float(np.clip(hi, lo * 1.08, ny * 0.985))
    return sps.butter(order, [lo / ny, hi / ny], btype="band", output="sos")


def _dynamic_eq_band(data: "np.ndarray", sr: int, *, f0: float, q: float = 2.0,
                     thresh_db: float = -30.0, ratio: float = 3.0, attack_ms: float = 5.0,
                     release_ms: float = 120.0, max_db: float = 6.0, mode: str = "cut") -> tuple["np.ndarray", dict]:
    """單一動態 EQ 頻段。mode='cut'(超門檻→衰減,馴服共振/刺耳)或 'boost'(低於門檻→增益)。
    回 (音訊, meter)。逐樣本增益向量化平滑(同壓縮器 ballistics)。"""
    try:
        sos = _bandpass_sos(sr, f0, q)
        band = np.empty_like(data)
        for ch in range(data.shape[1]):
            band[:, ch] = sps.sosfilt(sos, data[:, ch])
        det = np.sqrt(np.mean(band ** 2, axis=1) + 1e-12)  # 該頻段的能量偵測
        level_db = 20.0 * np.log10(det + 1e-9)
        if mode == "boost":
            under = np.maximum(0.0, thresh_db - level_db)
            tgt_db = np.clip(under * (1.0 - 1.0 / max(ratio, 1.0)), 0.0, float(max_db))
        else:
            over = np.maximum(0.0, level_db - thresh_db)
            tgt_db = -np.clip(over * (1.0 - 1.0 / max(ratio, 1.0)), 0.0, float(max_db))
        tau = max(1.0, (attack_ms + release_ms) / 2.0)
        a = float(np.exp(-1.0 / (sr * tau / 1000.0)))
        sm = sps.lfilter([1 - a], [1, -a], tgt_db)
        g = 10 ** (sm / 20.0)
        out = data + (g[:, None] - 1.0) * band  # = (data - band) + g*band
        env = _downsample_env_db(np.minimum(1.0, g), sr) if mode == "cut" else []
        peak_db = round(float(np.max(np.abs(sm))) if sm.size else 0.0, 2)
        return out, {"f0": round(float(f0), 0), "q": round(float(q), 2), "mode": mode,
                     "gr_db": env, "max_db": peak_db, "active": peak_db > 0.1}
    except Exception:
        logger.warning("動態 EQ band 失敗(略過,不影響輸出)", exc_info=True)
        return data, {"f0": round(float(f0), 0), "mode": mode, "active": False}


# 自動動態 EQ:依偵測到的音色問題放置頻段,只馴服突出的部分(de-ess 另外處理齒音)
_DYN_TARGETS = {
    "harsh": (3500.0, 2.0),       # 2–5kHz 刺耳
    "boxy": (550.0, 1.8),         # 400–800Hz 箱音/鼻音(新增)
    "muddy": (250.0, 1.6),        # 200–400Hz 糊
    "boomy_low": (90.0, 1.3),     # 低頻轟
}  # 齒音交給(適應性)de-esser 處理,不在這裡重複壓以免高頻被過度削掉


def _auto_dynamic_eq(data: "np.ndarray", sr: int, analysis_before: Optional[dict],
                     strength: float) -> tuple["np.ndarray", list]:
    """auto 模式:對偵測到的 harsh/muddy/boomy 放動態 EQ,只在該頻段超過自身平均時才修。"""
    if not analysis_before:
        return data, []
    pids = {p.get("id"): p for p in analysis_before.get("problems", [])}
    trust = float(np.clip(strength, 0.2, 1.0))
    sev_map = {"low": 0.5, "medium": 0.8, "high": 1.2}
    meters: list = []
    for name, (f0, q) in _DYN_TARGETS.items():
        if name not in pids:
            continue
        sev = sev_map.get(pids[name].get("severity"), 0.5)
        # 門檻 = 該頻段自身 RMS + 2dB → 只作用在「比平常大聲」的瞬間(透明)
        try:
            bmono = sps.sosfilt(_bandpass_sos(sr, f0, q), np.mean(data, axis=1))
            brms_db = 20.0 * np.log10(float(np.sqrt(np.mean(bmono ** 2) + 1e-12)) + 1e-9)
        except Exception:
            brms_db = -30.0
        data, m = _dynamic_eq_band(
            data, sr, f0=f0, q=q, thresh_db=brms_db + 2.0,
            ratio=2.0 + 2.0 * trust, attack_ms=4.0, release_ms=120.0,
            max_db=round(2.5 + 3.5 * sev * trust, 1), mode="cut")
        m["target"] = name
        if m.get("active"):
            meters.append(m)
    return data, meters


# =========================================================================== #
# 適應性 EQ(Adaptive / Automation)—— 讓各段音色「向整首歌『自己的』平均音色看齊」,
# 而非套死的曲風目標:主歌比全曲糊就修主歌、副歌比全曲刺就修副歌,和全曲一致的段落
# 完全不動。= 段落一致性(母帶工程師真正在做的),不會去搶曲風校正/參考曲匹配的工作,
# 也不會把同一條平均校正重做一次。安靜處(intro/尾音/換氣)用能量門完全關閉 → 不抽底噪。
# 逐頻段以「分析頻段邊界」做 zero-phase 帶通並聯套上(量到哪修到哪、相位一致)。
# =========================================================================== #
def _adaptive_eq(data: "np.ndarray", sr: int, *, genre: str = "auto", strength: float = 0.6,
                 window_s: float = 3.0, hop_s: float = 1.0, max_db: float = 2.5,
                 progress: Optional[ProgressFn] = None) -> tuple["np.ndarray", dict]:
    """段落一致性 EQ:逐窗量音色 vs「全曲自己的平均音色」→ 能量門 + 死區 + 總量上限 →
    平滑 → 逐樣本套上。隨歌曲段落變化但不搶靜態校正、不抽底噪、不抹平刻意的段落對比。"""
    n = data.shape[0]
    if n < int(window_s * sr) * 2:
        return data, {"active": False}  # 太短 → 沒有「段落」可自動化
    if not np.isfinite(data).all():
        data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)
    trust = float(np.clip(strength, 0.2, 1.0))
    mono = np.mean(data, axis=1)
    win = int(window_s * sr)
    hop = max(1, int(hop_s * sr))
    starts = list(range(0, max(1, n - win + 1), hop))
    names = [b[0] for b in _BANDS]
    # 一次 spectrogram 取代逐窗 welch(208 次→1 次),逐窗對所屬時間欄取平均功率譜。
    f_spec, t_spec, sxx = sps.spectrogram(
        mono, fs=sr, window="hann", nperseg=4096, noverlap=2048, detrend=False, scaling="density")
    frame_samp = t_spec * sr  # 每欄中心對應的取樣位置
    win_shapes: list[dict] = []   # 逐窗「去均值後的音色形狀」(band_db − 該窗平均)
    win_level: list[float] = []   # 逐窗寬頻能量 dB(供能量門)
    centers: list[int] = []
    for st in starts:
        sel = (frame_samp >= st) & (frame_samp < st + win)
        col = sxx[:, sel].mean(axis=1) if np.any(sel) else sxx[:, int(np.argmin(np.abs(frame_samp - (st + win / 2))))]
        band_db = _band_levels_db(f_spec, col)
        meas_mean = float(np.mean(list(band_db.values())))
        win_shapes.append({nm: band_db[nm] - meas_mean for nm in names})
        win_level.append(10.0 * np.log10(float(np.sum(col)) + 1e-12))
        centers.append(st + win // 2)
    if len(centers) < 2:
        return data, {"active": False}
    # 能量門:比最大聲段落低 ~22 dB 以上的窗 → 權重 0(不修),8 dB knee 軟過渡(不抽底噪)
    levels = np.array(win_level)
    loud_ref = float(np.percentile(levels, 95))
    weights = uniform_filter1d(np.clip((levels - (loud_ref - 22.0)) / 8.0, 0.0, 1.0), size=3)
    # 目標 = 全曲『自己的』平均音色形狀,且以能量加權(安靜/底噪段落不污染代表性音色),
    # 段落一致性,非曲風目標 → 不重做靜態校正、不搶參考曲匹配、不抹平刻意對比。
    wsum = float(np.sum(weights)) or 1.0
    tgt_shape = {nm: float(np.sum([weights[i] * win_shapes[i][nm] for i in range(len(centers))]) / wsum)
                 for nm in names}
    # 逐窗逐頻段增益:朝全曲平均、死區 0.8 dB(保留刻意小差異)、全頻段總量上限(整條曲線不暴衝)
    gains = {nm: [] for nm in names}
    for i in range(len(centers)):
        raw = {}
        for nm in names:
            dev = win_shapes[i][nm] - tgt_shape[nm]
            mag = max(0.0, abs(dev) - 0.8)          # 軟死區:|dev|<0.8 dB 不動(保留刻意小差異)
            g = -mag if dev > 0 else mag             # 偏亮→衰減、偏暗→增益
            raw[nm] = float(np.clip(g, -max_db, max_db))
        tot = sum(abs(v) for v in raw.values())
        scale = 5.0 / tot if tot > 5.0 else 1.0  # 7 段合計不超過 ~5 dB
        for nm in names:
            gains[nm].append(raw[nm] * scale * trust * float(weights[i]))
    centers_a = np.array(centers)
    out = data.copy()
    band_meta: dict[str, float] = {}
    idx = np.arange(n)
    for nm, lo, hi in _BANDS:
        env_db = uniform_filter1d(np.array(gains[nm]), size=7)  # ~7 秒平滑 → 動作慢、不抽吸
        if np.max(np.abs(env_db)) < 0.05:
            band_meta[nm] = 0.0  # 這段全程都和全曲一致 → 不動(省一次濾波)
            continue
        # 在「線性增益」域內插到逐樣本(每段只算 N 次 10**,而非 N×樣本數次)
        env_lin = 10 ** (env_db / 20.0)
        g_lin = np.interp(idx, centers_a, env_lin)
        try:
            sos = _bandpass_edges_sos(sr, lo, hi)  # 量到哪修到哪(用分析頻段邊界)
            band = np.empty_like(data)
            for ch in range(data.shape[1]):
                band[:, ch] = sps.sosfiltfilt(sos, data[:, ch])  # zero-phase → 並聯不相位相消
            out += (g_lin[:, None] - 1.0) * band  # g=1 → 加 0(無作用時完全等同原訊號)
            band_meta[nm] = round(float(np.mean(np.abs(env_db))), 2)
        except Exception:
            logger.warning("適應性 EQ 頻段 %s 失敗(略過)", nm, exc_info=True)
    if not np.isfinite(out).all():
        out = np.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0)
    return out, {"active": True, "window_s": window_s, "bands": band_meta,
                 "frames": len(centers)}


# =========================================================================== #
# EQ Automation lanes(Pro)—— 像 DAW:使用者自己畫「某頻段的增益隨時間變化曲線」。
# 每條 lane = 一個 bell(freq/Q)+ 一串 (時間秒, 增益dB) 控制點;逐樣本內插增益,用
# zero-phase 帶通並聯套上(out += (g(t)-1)*band)。= 全手動版的適應性 EQ。
# =========================================================================== #
def _automation_eq(data: "np.ndarray", sr: int, lanes: list) -> tuple["np.ndarray", dict]:
    """套用使用者畫的 EQ automation 曲線。lanes=[{freq,q,points:[[t_norm,gain_db],...]}]。
    時間用『正規化 0..1 全曲長度』(與前端/解碼長度無關 → 點永遠落在正確位置)。每條 lane 是
    真正的 RBJ peaking bell(min-phase,中心增益準確、Q 對應正確);增益在 dB 域內插(畫直線 =
    聽到等斜率 dB ramp)。out += (g(t)-1)*unit_bell_band。"""
    n = data.shape[0]
    if n < 16 or not lanes:
        return data, {"active": False, "lanes": []}
    out = data.copy()
    idx = None  # 逐樣本索引(延遲配置:全平/空時不浪費記憶體)
    ref_db = 12.0
    ref_lin = 10.0 ** (ref_db / 20.0)
    meters: list = []
    for lane in lanes:
        try:
            f0 = float(lane.get("freq", 1000.0))
            q = float(lane.get("q", 1.0) or 1.0)
            pts = [(float(p[0]), float(p[1])) for p in lane.get("points", [])
                   if isinstance(p, (list, tuple)) and len(p) >= 2]
            pts = [p for p in pts if np.isfinite(p[0]) and np.isfinite(p[1])]
            if len(pts) < 1:
                continue
            pts.sort(key=lambda p: p[0])
            ts = np.clip([p[0] for p in pts], 0.0, 1.0) * (n - 1)  # 正規化 → 樣本位置
            gs = np.clip([p[1] for p in pts], -24.0, 24.0)
            if float(np.max(np.abs(gs))) < 0.05:
                continue  # 整條平的(沒畫)→ 跳過
            for i in range(1, ts.shape[0]):  # 確保嚴格遞增(同時間點 → 乾淨垂直步階)
                ts[i] = max(ts[i], ts[i - 1] + 1e-6)
            if idx is None:
                idx = np.arange(n)
            g_db = np.interp(idx, ts, gs)  # 在 dB 域內插(WYSIWYG:畫直線=等斜率 dB)
            g_lin = 10.0 ** (g_db / 20.0)
            # 單位 bell band:min-phase RBJ peak(中心增益 = 畫的 dB、Q 正確、無 filtfilt 平方失真)
            bb, ba = _biquad("peak", sr, f0, ref_db, q)
            band = np.empty_like(data)
            for ch in range(data.shape[1]):
                band[:, ch] = (sps.lfilter(bb, ba, data[:, ch]) - data[:, ch]) / (ref_lin - 1.0)
            out += (g_lin[:, None] - 1.0) * band
            meters.append({"freq": round(f0), "min_db": round(float(np.min(gs)), 1),
                           "max_db": round(float(np.max(gs)), 1), "points": len(pts)})
        except Exception:
            logger.warning("EQ automation lane 失敗(略過)", exc_info=True)
    if not np.isfinite(out).all():
        out = np.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0)
    return out, {"active": len(meters) > 0, "lanes": meters}


# =========================================================================== #
# 全參數 EQ(Pro)—— 無限段,每段可選類型/頻率/增益/Q,**每段相位(min/linear)**
# + **每段聲道路由(stereo/mid/side/L/R)**。線性相位用 _match_eq 同套 FIR 法。
# =========================================================================== #
_EQ_TYPES = {"bell", "peak", "low_shelf", "high_shelf", "high_pass", "low_pass", "notch", "allpass"}
_EQ_CHANNELS = {"stereo", "mid", "side", "left", "right"}


def _norm_band(b: dict, sr: int) -> Optional[dict]:
    """驗證/正規化一個使用者頻段;不合法或無作用回 None。"""
    if not isinstance(b, dict) or not bool(b.get("enabled", True)):
        return None
    t = str(b.get("type", "bell")).lower()
    t = "bell" if t == "peak" else t
    if t not in _EQ_TYPES:
        return None
    ch = str(b.get("channel", "stereo")).lower()
    if ch not in _EQ_CHANNELS:
        ch = "stereo"
    ph = "linear" if str(b.get("phase", "min")).lower() == "linear" else "min"
    nyq = sr / 2.0 - 1.0
    f0 = float(np.clip(float(b.get("freq_hz", b.get("freq", 1000.0)) or 1000.0), 20.0, min(20000.0, nyq)))
    g = float(b.get("gain_db", b.get("gain", 0.0)) or 0.0)
    q = float(np.clip(float(b.get("q", 0.707) or 0.707), 0.1, 18.0))
    pol = -1.0 if int(b.get("polarity", 1) or 1) < 0 else 1.0
    # 純增益且增益≈0 → 無作用
    if t in ("bell", "low_shelf", "high_shelf") and abs(g) < 1e-3 and pol > 0:
        return None
    return {"type": t, "freq_hz": f0, "gain_db": g, "q": q, "phase": ph, "channel": ch, "polarity": pol}


def _param_biquad(b: dict, sr: int) -> tuple["np.ndarray", "np.ndarray"]:
    kind = "peak" if b["type"] == "bell" else b["type"]
    return _biquad(kind, sr, b["freq_hz"], b["gain_db"], b["q"])


def _run_phase_groups(col: "np.ndarray", sr: int, gbands: list[dict]) -> "np.ndarray":
    """對單一聲道訊號套用該組頻段:min 相位串接 IIR + 一道合併的線性相位 FIR。"""
    out = col
    mn = [b for b in gbands if b["phase"] == "min"]
    lin = [b for b in gbands if b["phase"] == "linear"]
    for b in mn:
        bb, aa = _param_biquad(b, sr)
        out = sps.lfilter(bb, aa, out)
        if b["polarity"] < 0:
            out = -out
    if lin:
        n_fft = 8192
        w = np.linspace(0.0, np.pi, n_fft // 2 + 1)
        h = np.ones(n_fft // 2 + 1, dtype=np.complex128)
        for b in lin:
            bb, aa = _param_biquad(b, sr)
            _, hb = sps.freqz(bb, aa, worN=w)
            h *= hb
        imp = np.fft.irfft(np.abs(h), n=n_fft)
        imp = np.fft.fftshift(imp) * np.hanning(n_fft)
        out = sps.fftconvolve(out, imp, mode="same")
        if sum(1 for b in lin if b["polarity"] < 0) % 2:
            out = -out
    return out


def _apply_param_eq(data: "np.ndarray", sr: int, raw_bands: list) -> "np.ndarray":
    """套用一串使用者參數 EQ 頻段(依聲道路由分組:stereo/L/R 直接濾;mid/side 解碼一次)。"""
    bands = [nb for nb in (_norm_band(b, sr) for b in (raw_bands or [])) if nb is not None]
    if not bands:
        return data
    out = data.astype(np.float64, copy=True)
    groups: dict[str, list[dict]] = {}
    for b in bands:
        groups.setdefault(b["channel"], []).append(b)
    if "stereo" in groups:
        out[:, 0] = _run_phase_groups(out[:, 0], sr, groups["stereo"])
        out[:, 1] = _run_phase_groups(out[:, 1], sr, groups["stereo"])
    if "left" in groups:
        out[:, 0] = _run_phase_groups(out[:, 0], sr, groups["left"])
    if "right" in groups and out.shape[1] > 1:
        out[:, 1] = _run_phase_groups(out[:, 1], sr, groups["right"])
    if ("mid" in groups or "side" in groups) and out.shape[1] > 1:
        mid = 0.5 * (out[:, 0] + out[:, 1])
        side = 0.5 * (out[:, 0] - out[:, 1])
        if "mid" in groups:
            mid = _run_phase_groups(mid, sr, groups["mid"])
        if "side" in groups:
            side = _run_phase_groups(side, sr, groups["side"])
        out[:, 0] = mid + side
        out[:, 1] = mid - side
    return out


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def master(
    input_path: str,
    output_path: str,
    *,
    genre: str = "auto",
    loudness: str = "streaming",
    reference_path: Optional[str] = None,
    width: Optional[float] = None,
    dynamics: float = 0.0,
    eq: Optional[dict] = None,
    comp_scale: float = 1.0,
    ceiling_db: Optional[float] = None,
    auto: bool = False,
    auto_strength: float = 0.7,
    de_ess: Optional[bool] = None,
    de_ess_amount: Optional[float] = None,
    multiband: Optional[bool] = None,
    multiband_manual: Optional[dict] = None,
    saturation: float = 0.0,
    residual_eq: Optional[bool] = None,
    dynamic_eq: Optional[list] = None,
    param_eq: Optional[list] = None,
    adaptive_eq: Optional[bool] = None,
    automation_eq: Optional[list] = None,
    stem_rebalance: Optional[dict] = None,
    performance: bool = False,
    matched_output_path: Optional[str] = None,
    analyze_result: bool = True,
    progress: Optional[ProgressFn] = None,
) -> dict:
    """把 input 處理成母帶寫到 output(24-bit WAV)。回傳量測/設定摘要 dict。

    進階(皆選用,None/預設 = 用曲風預設):
      width      立體聲寬度(0.5..1.5,1=不變)
      dynamics   區段巨觀動態 -1..1(>0 副歌更有爆發力、<0 整體更平衡、0 關閉)
      eq         {"bass","lowMid","presence","air"} 額外 dB,疊加在曲風/參考 EQ 上
      comp_scale 壓縮強度倍率(0=不壓、1=預設、2=加倍)
      ceiling_db 真峰天花板覆寫(否則用 loudness 目標的 -1 dBTP)
      auto       智慧模式:先分析這首歌,套資料驅動的修正 EQ + 低切 + 自動寬度/壓縮/
                 區段動態當基底,使用者的手動參數再疊加/覆寫在上面。
      auto_strength 自動校正力度 0.2(自然)..1.0(強力),預設 0.7。越低修正越保守、
                 越自然;越高越貼近目標曲線。
      analyze_result 是否在回傳裡附上 before/after 分析(供前端視覺化 A/B)。
    """
    if not _HAS_DSP:
        raise RuntimeError("母帶 DSP 相依不可用(需 scipy + pyloudnorm)")

    preset = GENRE_PRESETS.get(genre, GENRE_PRESETS["auto"])
    tgt_lufs, preset_ceiling = LOUDNESS_TARGETS.get(loudness, LOUDNESS_TARGETS["streaming"])
    ceil = float(ceiling_db) if ceiling_db is not None else preset_ceiling

    _emit(progress, 3.0, "讀取音訊 · Loading")
    data, sr = _load_audio(input_path)

    # AI 分軌重新平衡(Pro):Demucs 拆 4 軌 → 各自套增益 → 重新混合,再進母帶鏈。
    # 失敗/不可用 → 優雅降級為不分軌(用原始混音)。
    stem_info: Optional[dict] = None
    raw: Optional["np.ndarray"] = None
    _gains = (stem_rebalance or {}).get("gains", {}) or {}
    _stem_keys = ("drums", "bass", "vocals", "other")
    _wants_stems = bool(stem_rebalance and isinstance(stem_rebalance, dict)
                        and stem_rebalance.get("enabled")
                        and any(abs(float(_gains.get(k, 0.0))) >= 1e-2 for k in _stem_keys))  # 全 0dB → 跳過(省幾分鐘)
    if _wants_stems:
        try:
            from . import separate as _separate  # 延遲匯入(torch 重;避免 mastering 硬相依)
            if _separate.is_available():
                _emit(progress, 6.0, "AI 分軌中(約需 1–3 分鐘)· Separating stems")
                src_orig = data  # 真正的原始混音(供公平 A/B,非 Demucs 重建)
                src_sr = sr
                sep = _separate.separate_stems(
                    input_path, device="cuda",
                    progress=(lambda st, p, m: _emit(progress, 6.0 + 0.30 * p, m)) if progress else None)
                if sep and sep.get("stems"):
                    sr = int(sep["sr"])
                    stems = sep["stems"]
                    gains = stem_rebalance.get("gains", {}) or {}
                    n_stem = next(iter(stems.values())).shape[0]
                    data = np.zeros((n_stem, 2), dtype=np.float64)
                    recon = np.zeros((n_stem, 2), dtype=np.float64)  # 各軌和(unity)→ 增益分級基準
                    applied = {}
                    for name, arr in stems.items():
                        a64 = _to_stereo(arr.astype(np.float64))
                        recon += a64
                        g = float(np.clip(gains.get(name, 0.0), -24.0, 24.0))
                        data += a64 * (10.0 ** (g / 20.0))
                        applied[name] = round(g, 1)
                    # 增益分級:把重新平衡後的混音縮回「原始工作電平」(保留相對平衡),避免過熱訊號
                    # 在 LUFS 正規化『之前』就把壓縮器/飽和推爆 → 失真。
                    r_rms = float(np.sqrt(np.mean(recon ** 2)) + 1e-12)
                    d_rms = float(np.sqrt(np.mean(data ** 2)) + 1e-12)
                    data *= float(np.clip(r_rms / d_rms, 0.25, 4.0))
                    data = _to_stereo(data)
                    # 真原始(重採樣到分軌取樣率)當 A/B 基準 —— 公平、非重建
                    if src_sr != sr:
                        raw = _to_stereo(sps.resample_poly(src_orig, sr, src_sr, axis=0).astype(np.float64))
                    else:
                        raw = _to_stereo(src_orig.astype(np.float64))
                    if raw.shape[0] != data.shape[0]:  # 重採樣四捨五入差 → 對齊長度
                        m = min(raw.shape[0], data.shape[0])
                        raw, data = raw[:m], data[:m]
                    stem_info = {"applied": applied, "stems": list(stems.keys())}
                    _emit(progress, 38.0, "分軌重新平衡完成 · Stems rebalanced")
        except Exception:
            logger.warning("AI 分軌重新平衡失敗(改用原始混音)", exc_info=True)
            stem_info = None
            raw = None

    if raw is None:  # 未分軌 → 原始輸入即基準
        raw = data.copy()  # 保留原始輸入(未處理)供「響度匹配 A/B」用
    in_lufs = _measure_lufs(raw, sr)  # 以真原始量響度 → A/B 匹配增益對齊真原始
    in_peak = _peak_db(data)

    # 智慧分析(auto 或要回傳 before 分析時跑)
    analysis_before: Optional[dict] = None
    corr: Optional[dict] = None
    if auto or analyze_result:
        try:
            # 效能模式:前分析也走 light(修正仍用頻段偏差 + crest;省下昂貴的滑動響度/真峰超取樣)
            analysis_before = analyze(data, sr, genre=genre, strength=auto_strength, light=performance)
            corr = analysis_before.get("corrections")
        except Exception:
            logger.warning("智慧分析失敗,改用曲風預設(降級)", exc_info=True)
            analysis_before = None
            corr = None

    # 1) 音色:參考曲匹配 > 智慧修正 EQ > 曲風 EQ,再疊上進階手動 EQ
    ref_used = False
    if reference_path and os.path.isfile(reference_path):
        _emit(progress, 22.0, "比對參考曲音色 · Matching reference")
        ref, rsr = _load_audio(reference_path)
        data = _match_eq(data, sr, ref, rsr)
        ref_used = True
    elif auto and corr:
        _emit(progress, 22.0, "智慧修正音色 · Smart corrective EQ")
        bands: list[tuple] = []
        for name, (kind, f0, q) in _BAND_EQ.items():
            g = float(corr["eq_band_gains_db"].get(name, 0.0))
            if abs(g) > 1e-3:
                bands.append((kind, f0, g, q))
        data = _apply_eq(data, sr, bands)
        if corr.get("low_cut_hz", 0) > 0:
            data = _highpass(data, sr, float(corr["low_cut_hz"]))
        if corr.get("mono_below_hz", 0) > 0:
            data = _mono_below(data, sr, float(corr["mono_below_hz"]))
    else:
        _emit(progress, 22.0, f"套用曲風 EQ · {preset['label']}")
        data = _apply_eq(data, sr, preset["eq"])
    if eq:
        data = _advanced_eq(data, sr, eq)

    meters: dict = {}
    trust = float(np.clip(auto_strength, 0.2, 1.0))
    stages = ["load", "reference_match" if ref_used else ("corrective_eq" if (auto and corr) else "genre_eq")]

    # 1b) 全參數 EQ(Pro 手動頻段:含 per-band 相位 + Mid/Side/L/R 路由)
    if param_eq:
        _emit(progress, 26.0, "參數 EQ · Parametric EQ")
        try:
            data = _apply_param_eq(data, sr, param_eq)
            stages.append("param_eq")
        except Exception:
            logger.warning("參數 EQ 失敗(略過,不影響輸出)", exc_info=True)

    # 1b2) 適應性 EQ(automation):把歌切成時間窗,讓校正曲線「隨段落自動改變」——
    # 主歌糊就修主歌、副歌刺就修副歌,過了就放開。等於工程師全程自動 ride EQ。
    if adaptive_eq:
        _emit(progress, 28.0, "適應性 EQ · Adaptive EQ")
        try:
            data, aeq_m = _adaptive_eq(data, sr, genre=genre, strength=auto_strength)
            if aeq_m.get("active"):
                meters["adaptive_eq"] = aeq_m
                stages.append("adaptive_eq")
        except Exception:
            logger.warning("適應性 EQ 失敗(略過,不影響輸出)", exc_info=True)

    # 1b3) EQ Automation lanes(Pro 手動):使用者畫的「某頻段增益隨時間變化」曲線
    if automation_eq:
        _emit(progress, 29.0, "EQ Automation")
        try:
            data, aut_m = _automation_eq(data, sr, automation_eq)
            if aut_m.get("active"):
                meters["automation_eq"] = aut_m
                stages.append("automation_eq")
        except Exception:
            logger.warning("EQ automation 失敗(略過,不影響輸出)", exc_info=True)

    # 1c) 動態 EQ:只在某頻段「突出」時才修(透明)。手動 dynamic_eq 清單 > auto 依問題放置。
    deq_meters: list = []
    if dynamic_eq:
        _emit(progress, 30.0, "動態 EQ · Dynamic EQ")
        for bd in dynamic_eq:
            if not isinstance(bd, dict) or not bd.get("enabled", True):
                continue
            try:
                data, m = _dynamic_eq_band(
                    data, sr, f0=float(bd.get("freq", 1000.0)), q=float(bd.get("q", 2.0) or 2.0),
                    thresh_db=float(bd.get("threshold", -30.0)), ratio=float(bd.get("ratio", 3.0) or 3.0),
                    attack_ms=float(bd.get("attack", 5.0) or 5.0), release_ms=float(bd.get("release", 120.0) or 120.0),
                    max_db=float(bd.get("maxDb", 6.0) or 6.0), mode=str(bd.get("mode", "cut")))
                deq_meters.append(m)
            except Exception:
                logger.warning("動態 EQ 手動頻段失敗(略過)", exc_info=True)
    elif auto and analysis_before:
        data, deq_meters = _auto_dynamic_eq(data, sr, analysis_before, auto_strength)
    if deq_meters:
        _emit(progress, 32.0, "動態 EQ · Dynamic EQ")
        meters["dynamic_eq"] = deq_meters
        stages.append("dynamic_eq")

    # 2) 齒音消除(de-ess):auto 由偵測到的 'sibilant' 問題驅動;手動由 de_ess/de_ess_amount
    deess_amount = 0.0
    if de_ess_amount is not None:
        deess_amount = float(max(0.0, de_ess_amount))
    elif de_ess:
        deess_amount = 0.5
    elif de_ess is None and auto and analysis_before:
        for p in analysis_before.get("problems", []):
            if p.get("id") == "sibilant":
                sev = {"low": 0.5, "medium": 0.9, "high": 1.3}.get(p.get("severity"), 0.0)
                deess_amount = sev * (0.7 + 0.6 * trust)
    if deess_amount > 1e-3:
        _emit(progress, 38.0, "齒音消除 · De-essing")
        try:
            # auto 模式:跟著偵測到的齒音峰值頻率走(更完整);手動維持預設帶以可預期
            if auto and (de_ess is None) and (de_ess_amount is None):
                d_lo, d_hi = _sibilant_band(data, sr)
            else:
                d_lo, d_hi = 5000.0, 9000.0
            data, meters["deess"] = _deesser(data, sr, f_lo=d_lo, f_hi=d_hi, amount=deess_amount)
            stages.append("de_ess")
        except Exception:
            logger.warning("de-ess 失敗(略過,不影響輸出)", exc_info=True)

    # 3) 壓縮:auto(或手動開啟)= 3 頻段多頻段;否則單頻段膠合。
    #    auto 偵測「已過度壓縮」(comp_amount=0)→ 完全不壓(尊重診斷)。
    _emit(progress, 48.0, "壓縮 · Compression")
    cs = max(0.0, float(comp_scale))
    mb_manual_used = bool(multiband_manual and multiband_manual.get("bands"))
    if mb_manual_used:
        # 手動多頻段(Pro):自訂分頻 + 每段 thr/ratio/atk/rel/knee/makeup + M/S + 寬度。優先於 auto。
        _emit(progress, 49.0, "手動多頻段 · Manual multiband")
        try:
            data, meters["multiband"] = _multiband_manual(
                data, sr, multiband_manual.get("crossovers", []), multiband_manual["bands"])
            stages.append("multiband")
        except Exception:
            logger.warning("手動多頻段失敗(略過,改用一般壓縮)", exc_info=True)
            mb_manual_used = False
    use_mb = (not mb_manual_used) and (bool(multiband) if multiband is not None else (auto and corr is not None))
    if use_mb:
        if auto and corr:
            ca = float(corr.get("comp_amount", 0.0))
            mb_amount = ca * (0.6 + 0.8 * trust) * cs
        else:
            mb_amount = cs
        if mb_amount > 1e-3:
            try:
                data, meters["multiband"] = _multiband_compress(data, sr, amount=mb_amount)
                stages.append("multiband")
            except Exception:
                logger.warning("多頻段壓縮失敗(略過,不影響輸出)", exc_info=True)
    elif not mb_manual_used:
        comp = dict(preset["comp"])
        if auto and corr:
            ca = float(corr.get("comp_amount", 0.0))
            cs2 = cs * (0.5 + ca) if ca > 1e-6 else 0.0
        else:
            cs2 = cs
        if cs2 > 1e-6:
            comp["ratio"] = 1.0 + (comp["ratio"] - 1.0) * cs2
            comp["makeup_db"] = comp["makeup_db"] * cs2
            data = _compress(data, sr, **comp)
            stages.append("compress")

    # 4) 區段感知巨觀動態(主歌/副歌自動增減);auto 模式在使用者未指定時用建議量
    dyn_eff = float(dynamics)
    if auto and corr and abs(dyn_eff) <= 1e-3:
        dyn_eff = float(corr.get("section_amount", 0.0))
    if abs(dyn_eff) > 1e-3:
        _emit(progress, 60.0, "區段動態 · Macro dynamics")
        data = _macro_dynamics(data, sr, dyn_eff)
        stages.append("macro_dynamics")

    # 5) 諧波飽和(類比暖度 / 人味);auto 給小量膠合,手動由 saturation 參數
    sat_amount = float(max(0.0, saturation))
    if auto and sat_amount <= 1e-3:
        sat_amount = 0.12 + 0.18 * trust
        if genre in ("rock", "edm", "hiphop", "lofi"):
            sat_amount += 0.05
        elif genre in ("acoustic", "ballad"):
            sat_amount -= 0.05
        # 依偵測微調:暗/悶/缺空氣 → 多點諧波生命力;刺耳/齒音 → 少點(別再加邊)
        if analysis_before:
            _pids = {p.get("id") for p in analysis_before.get("problems", [])}
            if _pids & {"dark", "dull_no_air"}:
                sat_amount += 0.05
            if _pids & {"harsh", "sibilant"}:
                sat_amount -= 0.06
        sat_amount = float(np.clip(sat_amount, 0.0, 0.45))
    if sat_amount > 1e-3:
        _emit(progress, 66.0, "諧波飽和 · Harmonic glue")
        try:
            data = _saturate(data, sr, amount=sat_amount, oversample=(1 if performance else 2))
            meters["saturation"] = {"amount": round(sat_amount, 3)}
            stages.append("saturation")
        except Exception:
            logger.warning("諧波飽和失敗(略過,不影響輸出)", exc_info=True)

    # 6) 立體聲寬度(明確 width > auto 建議 > 曲風預設)
    if width is not None:
        w = float(width)
    elif auto and corr:
        w = float(corr.get("width_factor", preset["width"]))
    else:
        w = float(preset["width"])
    data = _stereo_width(data, w)
    stages.append("width")

    # 7) 二次殘差修正 EQ(auto 或手動開啟):重量 tone 偏差,把第一道留下的殘差補滿
    #    → after 分析的頻段問題真正被解掉,分數因此顯著提高。
    do_residual = bool(residual_eq) if residual_eq is not None else (auto and corr is not None)
    if do_residual:
        _emit(progress, 70.0, "二次修正 EQ · Residual corrective EQ")
        try:
            data, meters["residual_eq"] = _residual_corrective_eq(
                data, sr, genre=genre, strength=0.6 * trust / 0.7)
            stages.append("residual_eq")
        except Exception:
            logger.warning("二次修正 EQ 失敗(略過,不影響輸出)", exc_info=True)

    # 8) 響度正規化到目標(微推 0.3,補限幅器的些微響度損失,但寧可略低於目標也不超過)。
    _emit(progress, 72.0, f"響度正規化 · {loudness} ({tgt_lufs:g} LUFS)")
    data = _normalize_lufs(data, sr, tgt_lufs + 0.3)

    # 6) 真峰限幅
    _emit(progress, 85.0, "限幅器 · Limiting")
    data = _limit(data, sr, ceil)

    # 7) 限幅後微調:若仍超過目標就往下修(只降不升,避免重新破峰)。
    post = _measure_lufs(data, sr)
    if post > tgt_lufs + 0.2:
        data = data * (10 ** ((tgt_lufs - post) / 20.0))

    out_lufs = _measure_lufs(data, sr)
    out_peak = _peak_db(data)

    # 處理後分析(供前端 A/B 視覺化:套用的區段動態用 dyn_eff 呈現增益曲線)
    analysis_after: Optional[dict] = None
    if analyze_result:
        _emit(progress, 92.0, "分析母帶結果 · Analyzing result")
        try:
            # 效能模式:結果分析走 light(省下最貴的滑動響度/真峰超取樣)
            analysis_after = analyze(data, sr, genre=genre, section_amount=dyn_eff, light=performance)
        except Exception:
            logger.warning("結果分析失敗(降級,不影響輸出)", exc_info=True)
            analysis_after = None

    _emit(progress, 95.0, "輸出 24-bit WAV · Exporting")
    _write_wav(output_path, data, sr)

    # 響度匹配原曲(把未處理的原始混音調到母帶的響度)→ 公平 A/B,聽的是音色不是音量
    matched_lufs = None
    match_gain_db = round(float(np.clip(out_lufs - in_lufs, -24.0, 12.0)), 2)
    if matched_output_path:
        _emit(progress, 97.0, "輸出響度匹配原曲 · Loudness-matched original")
        try:
            matched = raw * (10 ** (match_gain_db / 20.0))
            mpk = float(np.max(np.abs(matched))) if matched.size else 0.0
            if mpk > 1.0:
                matched = matched / mpk  # 全檔等比縮放,LUFS 匹配維持在 ~0.1dB 內
            _write_wav(matched_output_path, matched, sr)
            matched_lufs = round(_measure_lufs(matched, sr), 2)
        except Exception:
            logger.warning("響度匹配原曲輸出失敗(降級,A/B 仍可用原始版)", exc_info=True)
            matched_lufs = None

    _emit(progress, 100.0, "完成 · Done")
    return {
        "outPath": output_path,
        "sampleRate": sr,
        "genre": genre,
        "loudness": loudness,
        "auto": bool(auto),
        "autoStrength": round(float(auto_strength), 2),
        "referenceUsed": ref_used,
        "width": round(w, 3),
        "dynamics": round(dyn_eff, 3),
        "inputLufs": round(in_lufs, 2),
        "outputLufs": round(out_lufs, 2),
        "targetLufs": tgt_lufs,
        "inputPeakDb": round(in_peak, 2),
        "outputPeakDb": round(out_peak, 2),
        "ceilingDb": round(ceil, 2),
        "matchedLufs": matched_lufs,
        "matchGainDb": match_gain_db,
        "hasMatched": matched_lufs is not None,
        "stemRebalance": stem_info,
        "before": analysis_before,
        "after": analysis_after,
        "meters": _finite_scrub(meters),
        "goniometer": _finite_scrub({} if performance else _goniometer(data, sr)),
        "chain": {
            "stages": stages,
            "deEss": round(deess_amount, 3),
            "dynamicEq": len(deq_meters),
            "adaptiveEq": "adaptive_eq" in stages,
            "automationEq": "automation_eq" in stages,
            "multiband": "multiband" in meters,
            "saturation": round(sat_amount, 3),
            "residualEq": bool(do_residual),
        },
    }
