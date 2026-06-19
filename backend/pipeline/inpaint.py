"""
pipeline/inpaint.py — 影片文字 / 區域移除（AI inpainting）

讓使用者框出「不小心加進去的文字」（固定位置，例如燒錯的字幕、打錯的標題、
固定角落的字），用 **LaMa** 把該區域逐幀修補成背景，輸出**保留原音軌**的新影片。

引擎(優雅降級鏈)
----------------
  影像修補:
    1. LaMa  —— simple-lama-inpainting（big-lama 權重 Apache-2.0），品質好、GPU 優先。
    2. OpenCV cv2.inpaint(Telea) —— 免模型後備。
  影片編碼(皆用 PyAV 內建 ffmpeg,免裝系統 ffmpeg):
    h264_nvenc(NVIDIA)→ h264_qsv(Intel)→ libx264(CPU)→ mpeg4。
  音訊:從來源 demux 後**原樣 remux(stream copy)**,不重編碼、零損失。

設計原則:任何重型相依(av / torch / simple_lama / cv2)缺席或失敗都**不可**讓
伺服器崩潰 —— 一律 try/except 包覆並回報明確錯誤。座標一律用「正規化 0..1」傳入
(與解析度無關),內部再換算成像素。
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Optional

logger = logging.getLogger("autolyrics.inpaint")

ProgressFn = Callable[[str, float, str], None]
_STAGE = "inpaint"

# --------------------------------------------------------------------------- #
# 可選相依偵測
# --------------------------------------------------------------------------- #
try:
    import av  # type: ignore
    import numpy as np  # type: ignore

    _HAS_AV = True
except Exception as exc:  # pragma: no cover
    av = None  # type: ignore
    np = None  # type: ignore
    _HAS_AV = False
    logger.warning("PyAV/numpy 不可用,影片文字移除停用:%s", exc)


# LaMa 模型全域快取（權重不小,避免每個 job 重載）
_LAMA_CACHE: dict[str, Any] = {}
_LAMA_LOCK = threading.Lock()


def is_available() -> bool:
    """影片文字移除是否可用(至少要有 PyAV + numpy 才能解碼/編碼)。"""
    return _HAS_AV


def _emit(progress: Optional[ProgressFn], pct: float, msg: str) -> None:
    if progress is None:
        return
    try:
        progress(_STAGE, float(pct), msg)
    except Exception:  # pragma: no cover
        logger.debug("progress 回呼丟例外,已忽略", exc_info=True)


def _resolve_device(device: str) -> str:
    dev = (device or "auto").strip().lower()
    try:
        import torch  # type: ignore

        cuda = bool(torch.cuda.is_available())
    except Exception:
        cuda = False
    if dev == "auto":
        return "cuda" if cuda else "cpu"
    if dev == "cuda" and not cuda:
        logger.warning("要求 cuda 但不可用,改用 cpu inpaint")
        return "cpu"
    return dev


# --------------------------------------------------------------------------- #
# LaMa 載入 + 單張修補
# --------------------------------------------------------------------------- #
def _load_lama(device: str) -> Optional[Any]:
    """載入並快取 SimpleLama;缺套件 / 載入失敗回 None(上層退回 OpenCV)。"""
    cached = _LAMA_CACHE.get(device)
    if cached is not None:
        return cached
    with _LAMA_LOCK:
        cached = _LAMA_CACHE.get(device)
        if cached is not None:
            return cached
        try:
            import torch  # type: ignore
            from simple_lama_inpainting import SimpleLama  # type: ignore

            logger.info("載入 LaMa(big-lama)device=%s(首次會下載 ~196MB 權重）", device)
            lama = SimpleLama(device=torch.device(device))
            _LAMA_CACHE[device] = lama
            return lama
        except Exception as exc:
            logger.warning("LaMa 不可用,將退回 OpenCV cv2.inpaint:%s", exc)
            _LAMA_CACHE[device] = None
            return None


def _round_up(v: int, m: int = 8) -> int:
    return ((v + m - 1) // m) * m


def _inpaint_region_lama(lama: Any, frame_rgb: "np.ndarray", box_px: tuple[int, int, int, int], pad: int) -> "np.ndarray":
    """只修補單一矩形(含 pad 邊界)以加速;就地寫回 frame_rgb 並回傳。"""
    from PIL import Image  # type: ignore

    H, W = frame_rgb.shape[:2]
    x, y, w, h = box_px
    x0 = max(0, x - pad); y0 = max(0, y - pad)
    x1 = min(W, x + w + pad); y1 = min(H, y + h + pad)
    if x1 <= x0 or y1 <= y0:
        return frame_rgb

    crop = frame_rgb[y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    # mask:crop 內、對應原始 box 的部分塗白
    cm = np.zeros((ch, cw), dtype=np.uint8)
    mx0 = x - x0; my0 = y - y0
    cm[max(0, my0):max(0, my0) + h, max(0, mx0):max(0, mx0) + w] = 255

    res = np.array(lama(Image.fromarray(crop), Image.fromarray(cm)))
    # LaMa 會把輸入 pad 到 8 的倍數,輸出可能略大 → 裁回 crop 尺寸
    res = res[:ch, :cw]
    frame_rgb[y0:y1, x0:x1] = res
    return frame_rgb


def _inpaint_region_cv2(frame_rgb: "np.ndarray", box_px: tuple[int, int, int, int], pad: int) -> "np.ndarray":
    """OpenCV 後備:Telea 法。品質不如 LaMa,但免模型。"""
    import cv2  # type: ignore

    H, W = frame_rgb.shape[:2]
    x, y, w, h = box_px
    mask = np.zeros((H, W), dtype=np.uint8)
    mask[max(0, y):min(H, y + h), max(0, x):min(W, x + w)] = 255
    bgr = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    out = cv2.inpaint(bgr, mask, 3, cv2.INPAINT_TELEA)
    return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)


# --------------------------------------------------------------------------- #
# 影片編碼器挑選
# --------------------------------------------------------------------------- #
_ENCODER_CHAIN_GPU = ["h264_nvenc", "h264_qsv", "libx264", "mpeg4"]
_ENCODER_CHAIN_CPU = ["libx264", "h264_qsv", "mpeg4"]


def _pick_encoder(device: str) -> str:
    chain = _ENCODER_CHAIN_GPU if device == "cuda" else _ENCODER_CHAIN_CPU
    for name in chain:
        try:
            av.codec.Codec(name, "w")  # type: ignore[union-attr]
            return name
        except Exception:
            continue
    return "mpeg4"


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def remove_text(
    video_path: str,
    regions: list[dict],
    out_path: str,
    *,
    engine: str = "lama",
    device: str = "auto",
    time_range: Optional[tuple[float, float]] = None,
    pad: int = 10,
    progress: Optional[ProgressFn] = None,
) -> dict:
    """逐幀移除 ``regions`` 圈出的文字,輸出保留原音軌的新影片。

    參數
    ----
    video_path: 來源影片。
    regions: 矩形清單,每個 ``{"x","y","w","h"}`` 為**正規化 0..1**座標
        (相對畫面寬高);內部換算成像素。固定位置 = 整片套用同一組框。
    out_path: 輸出 .mp4 路徑。
    engine: "lama"(預設,AI)或 "opencv"(古典後備)。
    device: "auto" | "cuda" | "cpu"。
    time_range: (start_sec, end_sec) 只在此區間套用修補;None = 全片。
        區間外的幀**原樣**輸出(仍重編碼,確保連續)。
    pad: LaMa 修補時框外擴的像素邊界。

    回傳
    ----
    {"outPath","frames","encoder","engineUsed","width","height","durationSec"}
    """
    if not _HAS_AV:
        raise RuntimeError("PyAV/numpy 不可用,無法處理影片")
    if not regions:
        raise ValueError("未提供要移除的區域")

    dev = _resolve_device(device)
    use_lama = engine != "opencv"
    lama = _load_lama(dev) if use_lama else None
    engine_used = "lama" if lama is not None else "opencv"
    _emit(progress, 1.0, f"準備 inpaint(引擎={engine_used} device={dev})")

    in_c = av.open(video_path)  # type: ignore[union-attr]
    try:
        if not in_c.streams.video:
            raise RuntimeError("輸入沒有視訊軌")
        in_v = in_c.streams.video[0]
        in_a = in_c.streams.audio[0] if in_c.streams.audio else None
        W = int(in_v.codec_context.width)
        H = int(in_v.codec_context.height)
        rate = in_v.average_rate or in_v.guessed_rate or 25
        total = in_v.frames or 0  # 0 = 未知,改用時間估

        # 像素框
        boxes_px: list[tuple[int, int, int, int]] = []
        for r in regions:
            try:
                x = int(round(float(r["x"]) * W)); y = int(round(float(r["y"]) * H))
                w = int(round(float(r["w"]) * W)); h = int(round(float(r["h"]) * H))
                if w > 0 and h > 0:
                    boxes_px.append((max(0, x), max(0, y), w, h))
            except (KeyError, TypeError, ValueError):
                logger.warning("略過無效區域:%r", r)
        if not boxes_px:
            raise ValueError("沒有有效的像素區域")

        encoder = _pick_encoder(dev)
        logger.info("inpaint:%dx%d @%.3ffps  encoder=%s  engine=%s  boxes=%d",
                    W, H, float(rate), encoder, engine_used, len(boxes_px))

        out_c = av.open(out_path, mode="w")  # type: ignore[union-attr]
        out_v = out_c.add_stream(encoder, rate=rate)
        out_v.width = W
        out_v.height = H
        out_v.pix_fmt = "yuv420p"
        # 位元率給足,避免畫質崩(以解析度粗估)
        try:
            out_v.bit_rate = max(2_000_000, int(W * H * float(rate) * 0.10))
        except Exception:
            pass
        # 音訊 stream-copy:PyAV 10+ 用 add_stream_from_template(舊的 add_stream(template=)
        # 已移除)。輸出音軌沿用來源 codec/time_base,封包搬過去時 PyAV 自動 rescale。
        out_a = out_c.add_stream_from_template(in_a) if in_a is not None else None

        t0 = time_range[0] if time_range else None
        t1 = time_range[1] if time_range else None
        vbase = float(in_v.time_base) if in_v.time_base else 0.0

        done = 0
        for packet in in_c.demux():
            if packet.stream.type == "video":
                for frame in packet.decode():
                    img = frame.to_ndarray(format="rgb24")
                    tsec = (float(frame.pts) * vbase) if (frame.pts is not None and vbase) else None
                    in_range = True
                    if t0 is not None and tsec is not None:
                        in_range = (tsec >= t0) and (t1 is None or tsec <= t1)
                    if in_range:
                        img = np.ascontiguousarray(img)
                        for box in boxes_px:
                            if lama is not None:
                                img = _inpaint_region_lama(lama, img, box, pad)
                            else:
                                img = _inpaint_region_cv2(img, box, pad)
                    nf = av.VideoFrame.from_ndarray(img, format="rgb24")  # type: ignore[union-attr]
                    for p in out_v.encode(nf):
                        out_c.mux(p)
                    done += 1
                    if done % 15 == 0:
                        if total:
                            pct = 2.0 + 95.0 * min(1.0, done / total)
                        else:
                            pct = 2.0 + (done % 900) / 10.0  # 未知總幀數 → 緩慢爬
                        _emit(progress, pct, f"修補中… 第 {done} 幀")
            elif out_a is not None and packet.stream is in_a and packet.dts is not None:
                packet.stream = out_a  # stream copy:音訊原樣搬過去
                out_c.mux(packet)

        for p in out_v.encode():  # flush
            out_c.mux(p)
        out_c.close()

        _emit(progress, 100.0, f"完成 · 共 {done} 幀")
        dur = (float(in_v.duration) * vbase) if (in_v.duration and vbase) else (done / float(rate) if rate else 0.0)
        return {
            "outPath": out_path,
            "frames": done,
            "encoder": encoder,
            "engineUsed": engine_used,
            "width": W,
            "height": H,
            "durationSec": round(dur, 3),
        }
    finally:
        try:
            in_c.close()
        except Exception:
            pass


def first_frame_jpeg(video_path: str, at_sec: float = 0.0, max_w: int = 1280) -> bytes:
    """擷取某時間點的單幀為 JPEG bytes,供前端畫布讓使用者框選。"""
    if not _HAS_AV:
        raise RuntimeError("PyAV 不可用")
    import io

    from PIL import Image  # type: ignore

    c = av.open(video_path)  # type: ignore[union-attr]
    try:
        vs = c.streams.video[0]
        if at_sec and vs.time_base:
            try:
                c.seek(int(at_sec / float(vs.time_base)), stream=vs)
            except Exception:
                logger.debug("seek 失敗,改取第一幀", exc_info=True)
        for frame in c.decode(video=0):
            img = frame.to_ndarray(format="rgb24")
            im = Image.fromarray(img)
            if im.width > max_w:
                im = im.resize((max_w, int(im.height * max_w / im.width)))
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=88)
            return buf.getvalue()
        raise RuntimeError("無法解碼任何視訊幀")
    finally:
        try:
            c.close()
        except Exception:
            pass
