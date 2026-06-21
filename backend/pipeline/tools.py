"""音訊工具箱(Audio Toolbox)—— 給藝人/自媒體製作人的一堆小工具。

每個工具都是一個小函式,license-clean(numpy/scipy/pyloudnorm/PyAV;不依賴 GPL),
大量重用 mastering.py 的 DSP 助手。宣告式 TOOLS 註冊表 → 之後加工具只要加一個函式 +
一筆註冊,前端用同一個泛用面板渲染參數/執行/下載。

兩類:
  - kind="analyze":回傳結果 dict(無輸出檔)。fn(data, sr, params) -> dict
  - kind="process":處理音訊寫檔(可下載)。 fn(data, sr, params) -> (data, sr)
  (人聲分離是慢工 → 走既有 job;不在這裡。)
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

import numpy as np

from . import mastering as M

logger = logging.getLogger("autolyrics.tools")

try:
    import scipy.signal as sps  # type: ignore
    _HAS = True
except Exception:  # pragma: no cover
    sps = None  # type: ignore
    _HAS = False


# --------------------------------------------------------------------------- #
# Analyze 工具
# --------------------------------------------------------------------------- #
def _t_deess(data: "np.ndarray", sr: int, params: dict) -> dict:
    """齒音分析:找出實際齒音峰值頻率 + 建議 de-ess 要濾哪個頻率 / 門檻。"""
    lo, hi = M._sibilant_band(data, sr)
    mono = np.mean(data, axis=1)
    f, pxx = M._welch_psd(mono, sr)
    m = (f >= 4500.0) & (f <= 11000.0)
    peak_hz = float(f[m][int(np.argmax(pxx[m]))]) if np.any(m) else 7000.0
    # 齒音帶 RMS vs 全頻 RMS(判斷齒音是否偏多)
    sib = sps.sosfilt(M._bandpass_sos(sr, peak_hz, 2.5), mono)
    sib_db = 20.0 * np.log10(float(np.sqrt(np.mean(sib ** 2) + 1e-12)) + 1e-9)
    full_db = 20.0 * np.log10(float(np.sqrt(np.mean(mono ** 2) + 1e-12)) + 1e-9)
    ratio = sib_db - full_db
    sev = "輕微" if ratio < -18 else "中等" if ratio < -12 else "明顯"
    return {
        "peakHz": round(peak_hz),
        "bandHz": [round(lo), round(hi)],
        "recommend": {
            "centerHz": round(peak_hz),
            "filterHz": f"{round(lo)}–{round(hi)} Hz",
            "thresholdDb": round(full_db - 6.0, 1),
            "severity": sev,
        },
        "note": f"齒音集中在 ~{round(peak_hz)} Hz。建議 de-ess 帶設 {round(lo)}–{round(hi)} Hz、"
                f"門檻約 {round(full_db - 6.0, 1)} dB。",
    }


def _t_meter(data: "np.ndarray", sr: int, params: dict) -> dict:
    """響度/真峰計量:上傳前 QC。LUFS / 真峰 / crest / 取樣峰值。"""
    lufs = M._measure_lufs(data, sr)
    tp = M._true_peak_dbtp(data, sr)
    sp = M._peak_db(data)
    peak = float(np.max(np.abs(data))) + 1e-12
    rms = float(np.sqrt(np.mean(data ** 2)) + 1e-12)
    crest = 20.0 * np.log10(peak / rms)
    targets = {"Spotify/YouTube −14": -14.0, "Apple −16": -16.0, "Podcast −16": -16.0, "Club −9": -9.0}
    return {
        "integratedLufs": round(float(lufs), 1),
        "truePeakDbtp": round(float(tp), 2),
        "samplePeakDbfs": round(float(sp), 2),
        "crestDb": round(float(crest), 1),
        "vsTargets": {k: round(v - float(lufs), 1) for k, v in targets.items()},
    }


_KRUMHANSL_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KRUMHANSL_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _t_keybpm(data: "np.ndarray", sr: int, params: dict) -> dict:
    """調性 + BPM 偵測(chroma + Krumhansl 找調;頻譜流量自相關找速度)。"""
    mono = np.mean(data, axis=1)
    # BPM:頻譜流量(onset)→ 自相關
    hop = 512
    f, t, S = sps.spectrogram(mono, fs=sr, nperseg=2048, noverlap=2048 - hop, mode="magnitude")
    flux = np.maximum(0.0, np.diff(S, axis=1)).sum(axis=0)
    flux = flux - np.mean(flux)
    ac = np.correlate(flux, flux, "full")[len(flux) - 1:]
    fps = sr / hop
    lo_l, hi_l = int(fps * 60 / 180), int(fps * 60 / 60)
    bpm = 0.0
    if hi_l > lo_l and hi_l < len(ac):
        lag = lo_l + int(np.argmax(ac[lo_l:hi_l]))
        bpm = 60.0 * fps / max(1, lag)
        while bpm < 70:
            bpm *= 2
        while bpm > 170:
            bpm /= 2
    # 調性:平均頻譜 → 12 音高類 chroma
    fk, tk, Sk = sps.spectrogram(mono, fs=sr, nperseg=8192, noverlap=4096, mode="magnitude")
    mag = Sk.mean(axis=1)
    chroma = np.zeros(12)
    for i, fr in enumerate(fk):
        if 27.5 <= fr <= 5000.0 and mag[i] > 0:
            pc = int(round(69 + 12 * np.log2(fr / 440.0))) % 12
            chroma[pc] += mag[i]
    chroma = chroma / (chroma.sum() + 1e-9)
    best = ("C", "major", -2.0)
    for shift in range(12):
        cr = np.roll(chroma, -shift)
        for mode, prof in (("major", _KRUMHANSL_MAJ), ("minor", _KRUMHANSL_MIN)):
            sc = float(np.corrcoef(cr, prof)[0, 1])
            if sc > best[2]:
                best = (_NOTE_NAMES[shift], mode, sc)
    return {"key": f"{best[0]} {best[1]}", "keyConfidence": round(best[2], 2), "bpm": round(bpm, 1)}


# --------------------------------------------------------------------------- #
# Process 工具(回傳處理後音訊)
# --------------------------------------------------------------------------- #
def _t_normalize(data: "np.ndarray", sr: int, params: dict) -> tuple["np.ndarray", int]:
    """響度標準化到目標 LUFS(峰值安全)。"""
    target = float(params.get("targetLufs", -14.0))
    out = M._normalize_lufs(data, sr, target)
    pk = float(np.max(np.abs(out))) if out.size else 0.0
    if pk > 0.97:
        out = out * (0.97 / pk)
    return out, sr


def _t_hum(data: "np.ndarray", sr: int, params: dict) -> tuple["np.ndarray", int]:
    """嗡聲移除:在市電基頻 + 諧波打窄陷波(50 或 60 Hz)。"""
    base = 60.0 if int(params.get("mains", 60)) == 60 else 50.0
    out = data.copy()
    ny = sr / 2.0
    for k in range(1, 7):
        fc = base * k
        if fc >= ny - 20:
            break
        b, a = sps.iirnotch(fc / ny, 30.0)
        for ch in range(out.shape[1]):
            out[:, ch] = sps.filtfilt(b, a, out[:, ch])
    return out, sr


def _t_silence_trim(data: "np.ndarray", sr: int, params: dict) -> tuple["np.ndarray", int]:
    """修整頭尾靜音(低於門檻 dBFS 的部分)。"""
    thr_db = float(params.get("thresholdDb", -45.0))
    mono = np.abs(np.mean(data, axis=1))
    thr = 10.0 ** (thr_db / 20.0)
    above = np.where(mono > thr)[0]
    if above.size == 0:
        return data, sr
    pad = int(0.05 * sr)
    s = max(0, above[0] - pad)
    e = min(data.shape[0], above[-1] + pad)
    return data[s:e], sr


def _t_fade(data: "np.ndarray", sr: int, params: dict) -> tuple["np.ndarray", int]:
    """淡入 / 淡出(秒)。"""
    fi = max(0.0, float(params.get("fadeInSec", 0.0)))
    fo = max(0.0, float(params.get("fadeOutSec", 0.0)))
    out = data.copy()
    n = out.shape[0]
    ni = min(int(fi * sr), n)
    no = min(int(fo * sr), n)
    if ni > 0:
        out[:ni] *= np.linspace(0.0, 1.0, ni)[:, None]
    if no > 0:
        out[n - no:] *= np.linspace(1.0, 0.0, no)[:, None]
    return out, sr


def _t_width(data: "np.ndarray", sr: int, params: dict) -> tuple["np.ndarray", int]:
    """立體聲寬度 / 單聲道(0=單聲道、1=不變、>1 變寬)。"""
    w = float(params.get("width", 1.0))
    return M._apply_width(data, w), sr


def _t_dc_normalize(data: "np.ndarray", sr: int, params: dict) -> tuple["np.ndarray", int]:
    """移除 DC offset + 峰值正規化到 −1 dBFS。"""
    out = data - np.mean(data, axis=0, keepdims=True)
    pk = float(np.max(np.abs(out))) if out.size else 0.0
    if pk > 1e-9:
        out = out * (10.0 ** (-1.0 / 20.0) / pk)
    return out, sr


def _t_convert(data: "np.ndarray", sr: int, params: dict) -> tuple["np.ndarray", int]:
    """格式轉換:音訊不變,輸出格式由 run_tool 依 params['format'] 編碼。"""
    return data, sr


_ENCODE_SUBTYPE = {"wav": "PCM_24", "flac": "PCM_24", "ogg": "VORBIS", "mp3": None}
_ENCODE_EXT = {"wav": "wav", "flac": "flac", "ogg": "ogg", "mp3": "mp3"}


_ENCODE_FORMAT = {"wav": "WAV", "flac": "FLAC", "ogg": "OGG", "mp3": "MP3"}


def _encode(data: "np.ndarray", sr: int, path: str, fmt: str) -> None:
    """以指定格式寫出(libsndfile 支援 wav/flac/ogg/mp3)。NaN/Inf 已在 run_tool 清過。

    明確帶 format= —— 不靠副檔名猜(輸出路徑可能是 .bin 暫存,靠副檔名會丟
    'unable to get format from file extension')。"""
    import soundfile as sf  # type: ignore
    fmt = (fmt or "wav").lower()
    safe = np.nan_to_num(np.clip(data, -1.0, 1.0), nan=0.0, posinf=1.0, neginf=-1.0)
    sfmt = _ENCODE_FORMAT.get(fmt, "WAV")
    sub = _ENCODE_SUBTYPE.get(fmt)
    try:
        if sub:
            sf.write(path, safe, sr, format=sfmt, subtype=sub)
        else:
            sf.write(path, safe, sr, format=sfmt)
    except Exception:
        # 保險:極舊的 libsndfile 不支援 MP3 寫入(我們綁的 1.2.x 支援)→ 退回 WAV,
        # 而不是讓整個請求 500。呼叫端會看到副檔名與內容不符,但至少拿得到音檔。
        if fmt != "wav":
            logger.warning("以 %s 編碼失敗,退回 WAV", fmt, exc_info=True)
            sf.write(path, safe, sr, format="WAV", subtype="PCM_24")
        else:
            raise


def _t_vocal_chain(data: "np.ndarray", sr: int, params: dict) -> tuple["np.ndarray", int]:
    """一鍵人聲處理鏈:依風格自動套高通/減法EQ/De-ess/壓縮/臨場空氣/飽和/殘響延遲。"""
    from . import vocalchain as VC
    style = str(params.get("style", "pop"))
    intensity = float(params.get("intensity", 0.7))
    space = float(params.get("space", 0.5))
    out = VC.vocal_chain(data, sr, style=style, intensity=intensity, space=space)
    return out, sr


def _t_denoise(data: "np.ndarray", sr: int, params: dict) -> tuple["np.ndarray", int]:
    """頻譜閘降噪:估各頻率噪音底(安靜幀的低分位)→ 軟性扣除。適合語音/口白底噪。"""
    amt = float(np.clip(params.get("amount", 0.6), 0.0, 1.0))
    nper = 2048
    nov = nper - 512
    out = np.zeros_like(data)
    for ch in range(data.shape[1]):
        f, t, Z = sps.stft(data[:, ch], fs=sr, nperseg=nper, noverlap=nov)
        mag = np.abs(Z)
        ph = np.angle(Z)
        noise = np.percentile(mag, 15, axis=1, keepdims=True)  # 每頻率噪音底估計
        gain = (mag - noise * (1.0 + 2.5 * amt)) / (mag + 1e-9)
        gain = np.clip(gain, 0.0, 1.0)
        # 軟化:gain 在頻率上略平滑,避免「音樂噪聲」鈴聲
        gain = sps.medfilt(gain, kernel_size=(3, 1)) if gain.shape[0] >= 3 else gain
        _, rec = sps.istft(mag * gain * np.exp(1j * ph), fs=sr, nperseg=nper, noverlap=nov)
        rec = rec[: data.shape[0]]
        out[: len(rec), ch] = rec
    return out, sr


# --------------------------------------------------------------------------- #
# 註冊表
# --------------------------------------------------------------------------- #
ToolFn = Callable[["np.ndarray", int, dict], Any]

TOOLS: dict[str, dict] = {
    "deess_analyze": {
        "kind": "analyze", "category": "analyze", "icon": "Mic",
        "label": "齒音分析", "labelEn": "De-ess analyzer",
        "desc": "找出實際齒音頻率,建議要濾哪個頻率與門檻。",
        "descEn": "Find the real sibilance frequency and suggested de-ess settings.",
        "params": [], "fn": _t_deess,
    },
    "loudness_meter": {
        "kind": "analyze", "category": "analyze", "icon": "Activity",
        "label": "響度計量", "labelEn": "Loudness meter",
        "desc": "LUFS / 真峰 / crest,上傳前 QC、和串流目標比對。",
        "descEn": "LUFS / true-peak / crest vs streaming targets — QC before upload.",
        "params": [], "fn": _t_meter,
    },
    "key_bpm": {
        "kind": "analyze", "category": "analyze", "icon": "Music2",
        "label": "調性 + BPM", "labelEn": "Key & BPM",
        "desc": "偵測歌曲的調性與速度(取樣、混音、DJ 對拍好用)。",
        "descEn": "Detect a song's musical key and tempo.",
        "params": [], "fn": _t_keybpm,
    },
    "vocal_chain": {
        "kind": "process", "category": "vocal", "icon": "Mic",
        "label": "一鍵人聲鏈", "labelEn": "One-click vocal chain",
        "desc": "依風格自動套 高通→減法EQ→De-ess→壓縮→臨場/空氣→飽和→殘響/延遲,把人聲做成 radio vocal。",
        "descEn": "Auto HPF→EQ→de-ess→comp→presence/air→saturation→reverb/delay by style — a radio vocal in one click.",
        "params": [
            {"key": "style", "label": "風格", "type": "select", "default": "pop",
             "options": [{"value": "pop", "label": "Pop"}, {"value": "hiphop", "label": "Hip-Hop / Rap"},
                         {"value": "rnb", "label": "R&B"}, {"value": "rock", "label": "Rock"},
                         {"value": "acoustic", "label": "Acoustic"}, {"value": "lofi", "label": "Lo-fi"}]},
            {"key": "intensity", "label": "力度", "type": "number", "min": 0.2, "max": 1.0, "step": 0.05, "default": 0.7},
            {"key": "space", "label": "空間(殘響/延遲)", "type": "number", "min": 0.0, "max": 1.0, "step": 0.05, "default": 0.5},
            {"key": "format", "label": "輸出格式", "type": "select", "default": "wav",
             "options": [{"value": "wav", "label": "WAV (24-bit)"}, {"value": "flac", "label": "FLAC"},
                         {"value": "mp3", "label": "MP3"}]}],
        "fn": _t_vocal_chain,
    },
    "loudness_normalize": {
        "kind": "process", "category": "loudness", "icon": "Gauge",
        "label": "響度標準化", "labelEn": "Loudness normalizer",
        "desc": "把音檔調到目標 LUFS(峰值安全),適合上傳前統一響度。",
        "descEn": "Normalize to a target LUFS (peak-safe) for upload.",
        "params": [{"key": "targetLufs", "label": "目標 LUFS", "type": "number",
                    "min": -24, "max": -6, "step": 0.5, "default": -14}],
        "fn": _t_normalize,
    },
    "hum_removal": {
        "kind": "process", "category": "repair", "icon": "Zap",
        "label": "嗡聲移除", "labelEn": "Hum removal",
        "desc": "移除市電嗡聲(50/60 Hz)及其諧波。",
        "descEn": "Remove mains hum (50/60 Hz) and its harmonics.",
        "params": [{"key": "mains", "label": "市電頻率", "type": "select", "default": 60,
                    "options": [{"value": 60, "label": "60 Hz(美/台/日東)"}, {"value": 50, "label": "50 Hz(歐/中/日西)"}]}],
        "fn": _t_hum,
    },
    "denoise": {
        "kind": "process", "category": "repair", "icon": "Wind",
        "label": "降噪", "labelEn": "Noise reduction",
        "desc": "頻譜閘移除穩定底噪(嘶聲、冷氣、風扇),適合口白/錄音。",
        "descEn": "Spectral-gate removal of steady background noise — for voice/recordings.",
        "params": [{"key": "amount", "label": "強度", "type": "number", "min": 0.1, "max": 1.0, "step": 0.05, "default": 0.6}],
        "fn": _t_denoise,
    },
    "silence_trim": {
        "kind": "process", "category": "edit", "icon": "Scissors",
        "label": "靜音修整", "labelEn": "Silence trim",
        "desc": "修掉開頭/結尾的靜音。",
        "descEn": "Trim leading/trailing silence.",
        "params": [{"key": "thresholdDb", "label": "門檻 dBFS", "type": "number", "min": -70, "max": -20, "step": 1, "default": -45}],
        "fn": _t_silence_trim,
    },
    "fade": {
        "kind": "process", "category": "edit", "icon": "TrendingUp",
        "label": "淡入淡出", "labelEn": "Fade in / out",
        "desc": "加上淡入、淡出。",
        "descEn": "Add a fade-in and/or fade-out.",
        "params": [{"key": "fadeInSec", "label": "淡入(秒)", "type": "number", "min": 0, "max": 10, "step": 0.1, "default": 0},
                   {"key": "fadeOutSec", "label": "淡出(秒)", "type": "number", "min": 0, "max": 10, "step": 0.1, "default": 2}],
        "fn": _t_fade,
    },
    "stereo_width": {
        "kind": "process", "category": "stereo", "icon": "Move",
        "label": "立體聲寬度", "labelEn": "Stereo width",
        "desc": "調整立體聲寬度,0 = 單聲道、1 = 不變、>1 = 更寬。",
        "descEn": "Adjust stereo width (0 = mono, 1 = unchanged, >1 = wider).",
        "params": [{"key": "width", "label": "寬度 ×", "type": "number", "min": 0, "max": 2, "step": 0.05, "default": 1.2}],
        "fn": _t_width,
    },
    "dc_normalize": {
        "kind": "process", "category": "repair", "icon": "Crosshair",
        "label": "DC 移除 + 正規化", "labelEn": "DC removal + normalize",
        "desc": "移除 DC offset 並把峰值正規化到 −1 dBFS。",
        "descEn": "Remove DC offset and peak-normalize to −1 dBFS.",
        "params": [], "fn": _t_dc_normalize,
    },
    "format_convert": {
        "kind": "process", "category": "export", "icon": "FileAudio",
        "label": "格式轉換", "labelEn": "Format converter",
        "desc": "轉成 WAV / FLAC / MP3 / OGG(上傳或交件用)。",
        "descEn": "Convert to WAV / FLAC / MP3 / OGG for upload or delivery.",
        "params": [{"key": "format", "label": "輸出格式", "type": "select", "default": "mp3",
                    "options": [{"value": "mp3", "label": "MP3"}, {"value": "wav", "label": "WAV (24-bit)"},
                                {"value": "flac", "label": "FLAC"}, {"value": "ogg", "label": "OGG"}]}],
        "fn": _t_convert,
    },
}


# URL 下載器 —— 特殊工具(kind="fetch":輸入網址而非檔案,走 /api/tools/fetch)。
# 前端依 kind 渲染網址欄 + 權利確認;只有 yt-dlp 可用時才顯示(API 回 fetchAvailable)。
_FETCH_TOOL = {
    "id": "url_download", "kind": "fetch", "category": "fetch", "icon": "Download",
    "label": "YouTube / 網址 音訊下載", "labelEn": "YouTube / URL audio downloader",
    "desc": "貼上網址,抓最佳音質音訊(WAV/FLAC/MP3),接著就能在工具箱/母帶處理。",
    "descEn": "Paste a URL, grab the best-quality audio (WAV/FLAC/MP3), then process it here.",
    "params": [{"key": "format", "label": "輸出格式", "type": "select", "default": "wav",
                "options": [{"value": "wav", "label": "WAV(無損,適合再處理)"}, {"value": "flac", "label": "FLAC"},
                            {"value": "mp3", "label": "MP3"}]}],
}


def list_tools() -> list[dict]:
    """給前端的工具清單(不含 fn)。URL 下載已獨立成「下載器」模式,不再列在工具箱。"""
    out: list[dict] = []
    for tid, t in TOOLS.items():
        out.append({k: v for k, v in t.items() if k != "fn"} | {"id": tid})
    return out


def run_tool(tool_id: str, input_path: str, out_path: Optional[str], params: dict) -> dict:
    """執行一個工具。analyze → 回 {result}; process → 寫 out_path 回 {output: out_path}。"""
    if not _HAS:
        raise RuntimeError("工具箱 DSP 相依不可用(需 scipy)")
    tool = TOOLS.get(tool_id)
    if tool is None:
        raise ValueError(f"未知工具:{tool_id}")
    data, sr = M._load_audio(input_path)
    if tool["kind"] == "analyze":
        return {"kind": "analyze", "result": M._finite_scrub(tool["fn"](data, sr, params or {}))}
    out, osr = tool["fn"](data, sr, params or {})
    out = np.nan_to_num(np.asarray(out, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    if out_path is None:
        raise ValueError("process 工具需要輸出路徑")
    fmt = str((params or {}).get("format", "wav")).lower()
    if fmt not in _ENCODE_EXT:
        fmt = "wav"
    _encode(out, int(osr), out_path, fmt)
    return {"kind": "process", "output": out_path, "sampleRate": int(osr), "format": fmt}


def tool_output_ext(tool_id: str, params: dict) -> str:
    """這個工具/參數產生的輸出副檔名(供 API 命名輸出檔)。"""
    fmt = str((params or {}).get("format", "wav")).lower()
    return _ENCODE_EXT.get(fmt, "wav")
