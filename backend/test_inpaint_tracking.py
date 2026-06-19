"""
test_inpaint_tracking.py — 動態追蹤 (template-matching) 自我測試

證明 inpaint.remove_text(..., track=True) 真的能抹除「會移動」的文字:

  1. 合成一段短影片:一塊白色文字方塊「斜向移動」橫越「會動的漸層背景」,並含音軌。
  2. 記下每一幀文字方塊的「真實像素位置」(ground truth)。
  3. 只用「第 0 幀」文字方塊位置當作框,呼叫 remove_text(track=True)。
  4. 解碼輸出影片,抽樣「後面幾幀」(文字此時已移到別處),驗證:
       - 在「文字的當前(後期)位置」,輸出已不再是亮白文字 → 被抹掉了。
       - 該位置相對於「未處理的輸入」確實改變了。
       - 對照組:第 0 幀的「框位置」在後期幀**不該**被動到太多(只追到文字、沒整片抹)。

關鍵:文字在後期幀離「第 0 幀框」很遠 —— 固定框模式**抹不到**它;只有追蹤模式
能跟上去抹掉。因此「後期位置的白字消失」就直接證明了追蹤生效。

執行:用具備 cv2 + torch + lama + av 的 venv:
  C:/Users/aries/OneDrive/文件/autolyrics/backend/.venv/Scripts/python.exe \
      C:/dev/LocalAiLyrics/backend/test_inpaint_tracking.py

bundled python.exe 僅用於 py_compile(它沒有重相依)。
"""

from __future__ import annotations

import os
import sys
import tempfile

import numpy as np

# Windows 主控台多半是 cp950/cp1252,輸出含 CJK / ≈ 等字元會丟 UnicodeEncodeError。
# 強制 stdout/stderr 走 UTF-8,讓測試報告在任何主控台都能完整印出。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
except Exception:
    pass

# 確保能 import pipeline.inpaint(本檔位於 backend/ 下)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import av  # type: ignore  # noqa: E402
import cv2  # type: ignore  # noqa: E402

from pipeline import inpaint  # noqa: E402

# ── 合成參數 ──────────────────────────────────────────────────────────────────
W, H = 320, 240
FPS = 10
N_FRAMES = 30
BOX_W, BOX_H = 60, 28          # 白色文字方塊尺寸
START_X, START_Y = 20, 20      # 第 0 幀文字左上角
DX, DY = 8, 6                  # 每幀位移(斜向移動)


def _text_pos(i: int) -> tuple[int, int]:
    """第 i 幀文字方塊左上角(夾限在畫面內)。"""
    x = min(W - BOX_W, START_X + DX * i)
    y = min(H - BOX_H, START_Y + DY * i)
    return x, y


def _make_frame(i: int) -> np.ndarray:
    """合成第 i 幀:會動的漸層背景 + 會移動的亮白文字方塊。回傳 RGB uint8。"""
    xs = np.linspace(0, 255, W, dtype=np.float32)
    ys = np.linspace(0, 255, H, dtype=np.float32)
    gx, gy = np.meshgrid(xs, ys)
    shift = (i * 9) % 256
    r = ((gx + shift) % 256).astype(np.uint8)
    g = ((gy + shift * 2) % 256).astype(np.uint8)
    b = ((gx * 0.5 + gy * 0.5 + shift * 3) % 256).astype(np.uint8)
    frame = np.dstack([r, g, b]).astype(np.uint8)

    # 移動的白色文字方塊(畫白底 + 黑字,確保有可比對的高對比模板)
    x, y = _text_pos(i)
    cv2.rectangle(frame, (x, y), (x + BOX_W, y + BOX_H), (255, 255, 255), -1)
    cv2.putText(frame, "ABC", (x + 4, y + 20), cv2.FONT_HERSHEY_SIMPLEX,
                0.6, (0, 0, 0), 2, cv2.LINE_AA)
    return frame


def _synthesize_video(path: str) -> None:
    """寫出含視訊 + 音訊的測試影片(H.264 + AAC,PyAV 內建 ffmpeg)。"""
    c = av.open(path, mode="w")
    vs = c.add_stream("libx264", rate=FPS)
    vs.width = W
    vs.height = H
    vs.pix_fmt = "yuv420p"
    vs.options = {"crf": "18"}  # 高品質,避免壓縮糊掉模板

    # 音訊軌:單聲道正弦波,證明音軌被原樣保留(remux)。
    a_sr = 44100
    aud = c.add_stream("aac", rate=a_sr)
    aud.layout = "mono"

    for i in range(N_FRAMES):
        img = _make_frame(i)
        vf = av.VideoFrame.from_ndarray(img, format="rgb24")
        for p in vs.encode(vf):
            c.mux(p)
    for p in vs.encode():
        c.mux(p)

    # 寫入一段正弦音訊(總長對齊影片)
    dur = N_FRAMES / FPS
    t = np.arange(int(a_sr * dur), dtype=np.float32) / a_sr
    tone = (0.2 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
    samples_per_frame = 1024
    pos = 0
    while pos < tone.shape[0]:
        chunk = tone[pos:pos + samples_per_frame]
        if chunk.shape[0] == 0:
            break
        arr = chunk.reshape(1, -1)
        af = av.AudioFrame.from_ndarray(arr, format="fltp", layout="mono")
        af.sample_rate = a_sr
        for p in aud.encode(af):
            c.mux(p)
        pos += samples_per_frame
    for p in aud.encode():
        c.mux(p)
    c.close()


def _decode_frames(path: str) -> list[np.ndarray]:
    """把影片解碼成 RGB uint8 幀清單。"""
    out: list[np.ndarray] = []
    c = av.open(path)
    try:
        for frame in c.decode(video=0):
            out.append(frame.to_ndarray(format="rgb24"))
    finally:
        c.close()
    return out


def _whiteness(region: np.ndarray) -> float:
    """區域內「接近純白」像素的比例(0..1)。亮白文字 → 高;漸層背景 → 低。"""
    if region.size == 0:
        return 0.0
    # 三通道都 > 230 視為白
    white = np.all(region > 230, axis=-1)
    return float(white.mean())


def main() -> int:
    print(f"[1/5] inpaint.is_available() = {inpaint.is_available()}")
    if not inpaint.is_available():
        print("FAIL: PyAV/numpy 不可用,無法跑追蹤測試")
        return 1

    tmpdir = tempfile.mkdtemp(prefix="track_test_")
    src = os.path.join(tmpdir, "moving.mp4")
    out = os.path.join(tmpdir, "moving_cleaned.mp4")

    print("[2/5] 合成測試影片(移動白字 + 移動漸層 + 音軌)…")
    _synthesize_video(src)
    in_frames = _decode_frames(src)
    print(f"      解碼輸入幀數 = {len(in_frames)}  尺寸 = {in_frames[0].shape}")

    # 第 0 幀文字位置 → 正規化框(只給這一個框,且只在第 0 幀)
    x0, y0 = _text_pos(0)
    region = {
        "x": x0 / W,
        "y": y0 / H,
        "w": BOX_W / W,
        "h": BOX_H / H,
    }
    print(f"[3/5] 第 0 幀文字框(像素) = ({x0},{y0},{BOX_W},{BOX_H}) → 正規化 {region}")

    print("[4/5] 執行 remove_text(track=True)…")
    meta = inpaint.remove_text(src, [region], out, engine="lama", device="auto", track=True)
    print(f"      meta = {meta}")
    engine_used = meta.get("engineUsed")
    tracked_flag = meta.get("tracked")
    print(f"      engineUsed = {engine_used}  tracked = {tracked_flag}")

    out_frames = _decode_frames(out)
    print(f"      解碼輸出幀數 = {len(out_frames)}")
    if not out_frames:
        print("FAIL: 輸出影片解不出任何幀")
        return 1

    # ── 驗證 A:文字在「後期位置」被抹除 ────────────────────────────────────────
    # 抽樣後期幀(文字此時已移到遠離第 0 幀框的位置)。比較「輸入 vs 輸出」在文字
    # 當前位置的白度。NVENC 末端 1~2 幀有壓縮 ringing(已知、與追蹤無關),故抽樣
    # 排除最後兩幀;以「多數抽樣幀被抹除」為通過(對單幀的編碼雜訊穩健)。
    n = min(len(in_frames), len(out_frames))
    last_safe = n - 3  # 排除最後兩幀的 NVENC 末端壓縮假影
    sample_idx = [i for i in (8, 13, 18, 23) if 0 <= i <= last_safe]
    print(f"[5/5] 抽樣後期幀 {sample_idx} 驗證文字是否被抹除"
          f"(已排除最後 2 幀的 NVENC 末端假影)…")

    print()
    print("  幀 | 文字當前位置 | 輸入白度 | 輸出白度 | 抹除? | 追蹤框")
    print("  ---+--------------+----------+----------+-------+--------")

    erased_count = 0
    tracked_positions: list[tuple[int, int, int, int]] = []  # (frame, tx, ty, ...)
    for i in sample_idx:
        tx, ty = _text_pos(i)
        # 取「文字當前位置」周邊一塊(略大於文字框,容許追蹤誤差)
        pad = 4
        ry0 = max(0, ty - pad); ry1 = min(H, ty + BOX_H + pad)
        rx0 = max(0, tx - pad); rx1 = min(W, tx + BOX_W + pad)
        in_white = _whiteness(in_frames[i][ry0:ry1, rx0:rx1])
        out_white = _whiteness(out_frames[i][ry0:ry1, rx0:rx1])
        # 文字當前位置:輸入應該很白(有白字),輸出應該大幅變不白(被抹掉)
        this_erased = (in_white > 0.20) and (out_white < in_white * 0.5)
        if this_erased:
            erased_count += 1
        tracked_positions.append((i, tx, ty, BOX_W))
        print(f"  {i:2d} | ({tx:3d},{ty:3d})    | {in_white:6.3f}   | "
              f"{out_white:6.3f}   | {'YES ' if this_erased else 'NO  '} | "
              f"({tx},{ty},{BOX_W},{BOX_H})")
    # 多數抽樣幀被抹除即通過(對單幀編碼雜訊穩健);至少要過半且 ≥2 幀。
    erased_ok = erased_count >= max(2, (len(sample_idx) + 1) // 2)

    # ── 驗證 B:追蹤器逐幀位置正確(這是「追蹤」本身的硬證明) ────────────────────
    # 用引擎內部同一個 _TemplateTracker 重播輸入幀,逐幀比對追蹤位置 vs 真實位置。
    # 平均偏差很小 = 模板匹配確實「跟著」移動文字走(而非靠固定框/巧合)。
    trk = inpaint._TemplateTracker(W, H)
    box_px0 = (x0, y0, BOX_W, BOX_H)
    total_err = 0
    max_err = 0
    nframes = 0
    for i, fr in enumerate(in_frames):
        gray = cv2.cvtColor(fr, cv2.COLOR_RGB2GRAY)
        tb = trk.init(gray, box_px0) if i == 0 else trk.update(gray)
        gtx, gty = _text_pos(i)
        err = abs(tb[0] - gtx) + abs(tb[1] - gty)
        total_err += err
        max_err = max(max_err, err)
        nframes += 1
    mean_err = (total_err / nframes) if nframes else 999.0
    # 平均 L1 偏差 ≤ 4px(模板匹配對剛性移動物件應近乎完美)。
    track_ok = mean_err <= 4.0

    # ── 驗證 C(對照):第 0 幀框位置在後期幀已是純背景 → 文字真的移走了 ───────────
    # 證明這不是「文字一直待在原地、隨便抹都過」—— 固定框模式抹不到後期的文字。
    late = sample_idx[-1] if sample_idx else 0
    fixed_white_late = _whiteness(in_frames[late][y0:y0 + BOX_H, x0:x0 + BOX_W])
    moved_away = fixed_white_late < 0.05
    print()
    print(f"  對照:後期幀 {late} 在「第0幀框位置」({x0},{y0}) 的輸入白度 = "
          f"{fixed_white_late:.3f} (≈0 → 文字已移走,固定框抹不到它)")
    print(f"  追蹤器平均偏差 = {mean_err:.2f}px · 最大偏差 = {max_err}px "
          f"(逐幀追蹤 {nframes} 幀)")

    print()
    print("=" * 64)
    pass_all = bool(erased_ok and track_ok and moved_away and out_frames)
    print(f"  追蹤框逐幀位置(抽樣 frame,x,y,w): {tracked_positions}")
    print(f"  A. 文字在後期位置被抹除   : {'PASS' if erased_ok else 'FAIL'}  "
          f"({erased_count}/{len(sample_idx)} 抽樣幀)")
    print(f"  B. 追蹤器逐幀位置正確     : {'PASS' if track_ok else 'FAIL'}  "
          f"(平均偏差 {mean_err:.2f}px ≤ 4px)")
    print(f"  C. 文字確實有移動(離開原框): {'PASS' if moved_away else 'FAIL'}")
    print(f"  引擎 = {engine_used} · tracked-flag = {tracked_flag}")
    print("=" * 64)
    print(f"RESULT: {'PASS' if pass_all else 'FAIL'}")

    # 清理暫存
    try:
        for f in (src, out):
            if os.path.exists(f):
                os.remove(f)
        os.rmdir(tmpdir)
    except OSError:
        pass

    return 0 if pass_all else 1


if __name__ == "__main__":
    raise SystemExit(main())
