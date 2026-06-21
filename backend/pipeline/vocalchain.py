"""一鍵人聲處理鏈(Vocal Chain)—— 把 vocal_advice 的「依風格建議」變成真的 DSP 處理:
高通 → 減法 EQ(清渾濁)→ De-ess → 壓縮 → 加法 EQ(臨場/空氣)→ 飽和 → 殘響/延遲送 → 收尾。

大量重用 mastering.py 的 DSP(license-clean numpy/scipy);新增的只有殘響(衰減雜訊 IR 卷積)
與對拍/slap 延遲(回授 comb)。給「下載了 beat、要把人聲套上 radio vocal」的人一鍵搞定。
"""

from __future__ import annotations

from typing import Any

import numpy as np

from . import mastering as M
from . import vocal_advice as VA

try:
    import scipy.signal as sps  # type: ignore
    _HAS = True
except Exception:  # pragma: no cover
    sps = None  # type: ignore
    _HAS = False

# 每個風格的飽和量(vocal_advice 的 sat 是文字標籤,這裡給數值)
_SAT_AMT = {"pop": 0.16, "rnb": 0.20, "hiphop": 0.18, "edm": 0.16, "rock": 0.20,
            "acoustic": 0.10, "ballad": 0.14, "lofi": 0.30}


def _bandlimit(x: "np.ndarray", sr: int, hp_hz: float, lp_hz: float) -> "np.ndarray":
    """對(送出的)訊號做高通+低通,讓殘響/延遲不糊低頻、不刺高頻。"""
    out = x
    if hp_hz and hp_hz > 20:
        sos = sps.butter(2, min(hp_hz / (sr / 2.0), 0.99), btype="high", output="sos")
        out = sps.sosfilt(sos, out, axis=0)
    if lp_hz and lp_hz < sr / 2.0 - 100:
        sos = sps.butter(2, min(lp_hz / (sr / 2.0), 0.99), btype="low", output="sos")
        out = sps.sosfilt(sos, out, axis=0)
    return out


def _reverb(x: "np.ndarray", sr: int, decay_s: float = 1.6, predelay_ms: float = 25.0,
            mix: float = 0.18, hp_hz: float = 300.0, lp_hz: float = 8000.0) -> "np.ndarray":
    """以「指數衰減雜訊 IR」卷積的簡易演算法殘響(parallel send,乾訊號保留)。"""
    n = x.shape[0]
    n_ir = max(64, int(decay_s * sr))
    rng = np.random.default_rng(1234)
    t = np.arange(n_ir) / sr
    env = np.exp(-t * (6.9 / max(decay_s, 0.1)))      # ~-60dB 在 decay_s
    irL = rng.standard_normal(n_ir) * env
    irR = rng.standard_normal(n_ir) * env             # 左右去相關 → 立體空間
    pre = int(predelay_ms * sr / 1000.0)
    wetL = sps.oaconvolve(x[:, 0], irL)[:n]
    wetR = sps.oaconvolve(x[:, 1], irR)[:n]
    wet = np.column_stack([wetL, wetR])
    if pre > 0:
        wet = np.vstack([np.zeros((pre, 2)), wet])[:n]
    wet = _bandlimit(wet, sr, hp_hz, lp_hz)
    # 把 wet 正規化到與乾訊號相近的尺度後依 mix 並聯加回
    pk = float(np.max(np.abs(wet))) + 1e-9
    wet = wet / pk * (float(np.max(np.abs(x))) + 1e-9)
    return x + mix * wet


def _delay(x: "np.ndarray", sr: int, time_ms: float = 180.0, feedback: float = 0.28,
           mix: float = 0.12, hp_hz: float = 300.0, lp_hz: float = 7000.0) -> "np.ndarray":
    """回授 comb 延遲(slap/對拍);wet 做帶通。乾訊號保留並聯加回。"""
    d = max(1, int(time_ms * sr / 1000.0))
    fb = float(np.clip(feedback, 0.0, 0.85))
    a = np.zeros(d + 1)
    a[0] = 1.0
    a[d] = -fb                                          # y[n] = x[n] + fb*y[n-d]
    wet = sps.lfilter([1.0], a, x, axis=0)
    wet = _bandlimit(wet, sr, hp_hz, lp_hz)
    return x + mix * wet


def vocal_chain(data: "np.ndarray", sr: int, style: str = "pop",
                intensity: float = 0.7, space: float = 0.5) -> "np.ndarray":
    """把整條人聲鏈套到 data。style=曲風(對應 vocal_advice 基底);intensity 0..1 整體力度;
    space 0..1 殘響/延遲量。回處理後音訊。"""
    if not _HAS:
        raise RuntimeError("人聲鏈 DSP 不可用(需 scipy)")
    amt = float(np.clip(intensity, 0.0, 1.0))
    sp = float(np.clip(space, 0.0, 1.0))
    base = VA._GENRE_BASE.get(style, VA._GENRE_BASE["pop"])
    out = M._to_stereo(np.asarray(data, dtype=np.float64))

    # 1) 高通(清麥克風隆隆/噴麥)
    out = M._highpass(out, sr, float(base["hpf"]))
    # 2) 減法 EQ:清 250–350 Hz 渾濁
    out = M._apply_eq(out, sr, [("peak", 300.0, -2.0 * amt, 1.4)])
    # 3) De-ess:跟著實際齒音峰值
    try:
        lo, hi = M._sibilant_band(out, sr)
        out, _ = M._deesser(out, sr, f_lo=lo, f_hi=hi, amount=float(base["deess"]) * amt)
    except Exception:
        pass
    # 4) 壓縮(坐穩主音)
    c = base["comp"]
    out = M._compress(out, sr, thresh_db=-18.0,
                      ratio=1.0 + (float(c["ratio"]) - 1.0) * amt,
                      attack_ms=float(c["attack"]), release_ms=float(c["release"]),
                      makeup_db=1.5 * amt)
    # 5) 加法 EQ:臨場感 + 空氣(或 lofi 收高頻)
    pf, pg = base["presence"]
    af, ag = base["air"]
    out = M._apply_eq(out, sr, [("peak", float(pf), float(pg) * amt, 0.8),
                                ("high_shelf", float(af), float(ag) * amt, 0.7)])
    # 6) 飽和(諧波 = 人味,在小喇叭也聽得到)
    try:
        out = M._saturate(out, sr, amount=_SAT_AMT.get(style, 0.18) * amt, oversample=2)
    except Exception:
        pass
    # 7) 空間:殘響 + 對拍 slap 延遲(parallel send)
    if sp > 1e-3:
        rv_type, rv_decay = base["reverb"]
        out = _reverb(out, sr, decay_s=float(rv_decay), predelay_ms=25.0,
                      mix=0.20 * sp, hp_hz=300.0, lp_hz=8500.0)
        if base.get("delay") not in (None, "none"):
            out = _delay(out, sr, time_ms=180.0, feedback=0.26,
                         mix=0.10 * sp, hp_hz=300.0, lp_hz=7000.0)
    # 收尾:峰值安全
    pk = float(np.max(np.abs(out))) if out.size else 0.0
    if pk > 0.97:
        out = out * (0.97 / pk)
    return np.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0)
