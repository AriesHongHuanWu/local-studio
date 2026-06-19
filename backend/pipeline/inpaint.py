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


# LaMa 在 GPU 推論大約需要 ~1.5GB(視解析度而定)。可用 VRAM 低於此門檻時,LaMa
# 改走 CPU —— 慢一點但不會 OOM。常見於 8GB 顯卡又同時開了 DaVinci/遊戲等吃顯存的程式。
_LAMA_MIN_FREE_MB = 1800.0


def _cuda_free_mb() -> Optional[float]:
    """目前 CUDA 裝置可用 VRAM(MB);torch/CUDA 缺席或查詢失敗回 None。"""
    try:
        import torch  # type: ignore

        if not torch.cuda.is_available():
            return None
        free, _total = torch.cuda.mem_get_info()
        return float(free) / (1024.0 * 1024.0)
    except Exception:  # noqa: BLE001
        return None


def _empty_cuda_cache() -> None:
    """釋放 torch 的 CUDA 快取配置塊(讓給其他程式/騰出空間),失敗無聲略過。"""
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


def _is_oom(exc: BaseException) -> bool:
    """粗略判斷例外是否為 CUDA / GPU 記憶體不足。"""
    text = f"{type(exc).__name__}: {exc}".lower()
    needles = ("out of memory", "outofmemory", "cuda", "cublas", "cudnn", "alloc")
    return any(n in text for n in needles)


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
# 動態追蹤 (template matching) —— 移動文字 / 浮水印 / 物件
# --------------------------------------------------------------------------- #
# track=True 時,使用者只框「第一幀」的那一個框;我們把框內(灰階)當作「模板」,
# 之後每幀在「上一幀框位置附近」的搜尋窗內用 cv2.matchTemplate 找出模板的新位置,
# 再於該位置 inpaint。模板**全程不更新**(更新會累積漂移;來源幀裡物件始終可見,
# 原始模板就一直比得中)。
#
# cv2 的專用追蹤器 (CSRT/KCF) 不在此 build —— 改用 matchTemplate,對剛性(不變形)
# 的文字/浮水印/logo 最穩。
# --------------------------------------------------------------------------- #

# 匹配信心低於此值視為「丟失鎖定」,沿用上一幀框位置(不亂跳)。
_TRACK_MIN_SCORE = 0.30
# 搜尋窗相對模板尺寸外擴的比例(越大越能追快速移動,但越慢/越易誤匹配)。
_TRACK_MARGIN_RATIO = 0.6


class _TemplateTracker:
    """以原始模板做 template matching 的單框追蹤器。

    用法:首個 in-range 幀呼叫 ``init(gray, box)`` 擷取模板;之後每幀呼叫
    ``update(gray)`` 取得新框位置 (x, y, w, h)。任何步驟出錯都回上一個已知框
    (絕不丟例外、絕不讓主流程崩潰)。
    """

    def __init__(self, frame_w: int, frame_h: int) -> None:
        self.W = int(frame_w)
        self.H = int(frame_h)
        self.template: Optional["np.ndarray"] = None
        self.tw = 0
        self.th = 0
        # 上一幀已知框左上角
        self.x = 0
        self.y = 0

    def _clamp_xy(self, x: int, y: int) -> tuple[int, int]:
        x = max(0, min(int(x), max(0, self.W - self.tw)))
        y = max(0, min(int(y), max(0, self.H - self.th)))
        return x, y

    def init(self, gray: "np.ndarray", box_px: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        """從首幀灰階影像擷取模板。回傳夾限後的初始框 (x, y, w, h)。"""
        x, y, w, h = box_px
        # 夾限框到畫面內,模板尺寸 = 夾限後的 (w, h)
        x0 = max(0, min(int(x), self.W - 1))
        y0 = max(0, min(int(y), self.H - 1))
        x1 = max(x0 + 1, min(int(x + w), self.W))
        y1 = max(y0 + 1, min(int(y + h), self.H))
        tmpl = gray[y0:y1, x0:x1]
        self.template = np.ascontiguousarray(tmpl)
        self.th, self.tw = self.template.shape[:2]
        self.x, self.y = x0, y0
        return (self.x, self.y, self.tw, self.th)

    def update(self, gray: "np.ndarray") -> tuple[int, int, int, int]:
        """在上一框附近的搜尋窗內比對模板,回傳新框 (x, y, w, h)。

        丟失鎖定 (maxVal < _TRACK_MIN_SCORE) 或任何例外 → 沿用上一框位置。
        """
        if self.template is None or self.tw <= 0 or self.th <= 0:
            return (self.x, self.y, self.tw, self.th)
        try:
            import cv2  # type: ignore

            margin = int(max(self.tw, self.th) * _TRACK_MARGIN_RATIO)
            # 搜尋窗 = 上一框 ± margin,夾限到畫面
            sx0 = max(0, self.x - margin)
            sy0 = max(0, self.y - margin)
            sx1 = min(self.W, self.x + self.tw + margin)
            sy1 = min(self.H, self.y + self.th + margin)
            # 搜尋窗必須至少能容下模板,否則退回整幀比對
            if (sx1 - sx0) < self.tw or (sy1 - sy0) < self.th:
                sx0, sy0, sx1, sy1 = 0, 0, self.W, self.H
            window = gray[sy0:sy1, sx0:sx1]
            if window.shape[0] < self.th or window.shape[1] < self.tw:
                return (self.x, self.y, self.tw, self.th)
            res = cv2.matchTemplate(window, self.template, cv2.TM_CCOEFF_NORMED)
            _minVal, maxVal, _minLoc, maxLoc = cv2.minMaxLoc(res)
            if maxVal is None or maxVal < _TRACK_MIN_SCORE:
                # 丟失鎖定 → 不跳,沿用上一框位置
                return (self.x, self.y, self.tw, self.th)
            nx = sx0 + int(maxLoc[0])
            ny = sy0 + int(maxLoc[1])
            self.x, self.y = self._clamp_xy(nx, ny)
        except Exception:  # noqa: BLE001 - 追蹤失敗一律沿用上一框,絕不崩潰
            logger.debug("template-match 追蹤丟例外,沿用上一框", exc_info=True)
        return (self.x, self.y, self.tw, self.th)


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
    track: bool = False,
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
    track: **動態追蹤模式**。True 且**恰好一個** region 時,把使用者在「第一幀」框出
        的框內當作模板 (cv2.matchTemplate),逐幀追蹤該移動文字/浮水印/物件的位置並
        於追蹤位置 inpaint。track=False(預設)= 固定位置整片同框,行為與舊版完全相同。
        track=True 但 region 數 != 1 時,**退回固定多框**行為(不追蹤)。

    回傳
    ----
    {"outPath","frames","encoder","engineUsed","width","height","durationSec","tracked"}
    """
    if not _HAS_AV:
        raise RuntimeError("PyAV/numpy 不可用,無法處理影片")
    if not regions:
        raise ValueError("未提供要移除的區域")

    dev = _resolve_device(device)
    use_lama = engine != "opencv"
    # VRAM 守門:先清快取再看可用顯存;太少就讓 LaMa 走 CPU,避免 OOM
    # (其餘影片編碼仍可用 GPU 的 nvenc/qsv)。
    lama_dev = dev
    if use_lama and dev == "cuda":
        _empty_cuda_cache()
        free_mb = _cuda_free_mb()
        if free_mb is not None and free_mb < _LAMA_MIN_FREE_MB:
            logger.warning(
                "可用 VRAM 僅 %.0fMB(< %.0fMB)→ LaMa 改用 CPU 以避免 OOM", free_mb, _LAMA_MIN_FREE_MB
            )
            lama_dev = "cpu"
    lama = _load_lama(lama_dev) if use_lama else None
    engine_used = "lama" if lama is not None else "opencv"
    _emit(
        progress,
        1.0,
        f"準備 inpaint(引擎={engine_used} device={dev}"
        + (f" · LaMa={lama_dev}" if lama is not None and lama_dev != dev else "")
        + ")",
    )

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

        # 動態追蹤:只在 track=True 且恰好一個有效框時啟用;否則退回固定多框。
        do_track = bool(track) and len(boxes_px) == 1
        tracker: Optional["_TemplateTracker"] = _TemplateTracker(W, H) if do_track else None
        tracker_init = False  # 模板尚未在首個 in-range 幀擷取

        encoder = _pick_encoder(dev)
        logger.info("inpaint:%dx%d @%.3ffps  encoder=%s  engine=%s  boxes=%d  track=%s",
                    W, H, float(rate), encoder, engine_used, len(boxes_px), do_track)

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
                        if tracker is not None:
                            # 動態追蹤:於追蹤到的單框位置 inpaint。
                            try:
                                import cv2  # type: ignore

                                gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
                                if not tracker_init:
                                    # 首個 in-range 幀:擷取模板,框位置 = 使用者框。
                                    box = tracker.init(gray, boxes_px[0])
                                    tracker_init = True
                                else:
                                    box = tracker.update(gray)
                            except Exception:  # noqa: BLE001 - 追蹤出錯沿用上一框,絕不崩潰
                                logger.debug("追蹤幀處理出錯,沿用上一框", exc_info=True)
                                box = (tracker.x, tracker.y, tracker.tw, tracker.th)
                            try:
                                if lama is not None:
                                    img = _inpaint_region_lama(lama, img, box, pad)
                                else:
                                    img = _inpaint_region_cv2(img, box, pad)
                            except Exception as exc:  # noqa: BLE001
                                if lama is not None and _is_oom(exc):
                                    logger.warning("LaMa GPU OOM(第 %d 幀)→ 切換 CPU 續跑", done)
                                    _empty_cuda_cache()
                                    lama = _load_lama("cpu")
                                    engine_used = "lama" if lama is not None else "opencv"
                                    # 這一幀照原樣輸出,下一幀起用 CPU(不重跑追蹤,避免狀態錯亂)。
                                else:
                                    raise
                        else:
                            try:
                                for box in boxes_px:
                                    if lama is not None:
                                        img = _inpaint_region_lama(lama, img, box, pad)
                                    else:
                                        img = _inpaint_region_cv2(img, box, pad)
                            except Exception as exc:  # noqa: BLE001
                                if lama is not None and _is_oom(exc):
                                    logger.warning("LaMa GPU OOM(第 %d 幀)→ 切換 CPU 續跑", done)
                                    _empty_cuda_cache()
                                    lama = _load_lama("cpu")
                                    engine_used = "lama" if lama is not None else "opencv"
                                else:
                                    raise
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

        _empty_cuda_cache()  # 跑完釋放 VRAM,讓給後續辨識/其他程式
        _emit(progress, 100.0, f"完成 · 共 {done} 幀")
        dur = (float(in_v.duration) * vbase) if (in_v.duration and vbase) else (done / float(rate) if rate else 0.0)
        return {
            "outPath": out_path,
            "frames": done,
            "encoder": encoder,
            "engineUsed": engine_used,
            "lamaDevice": lama_dev,
            "width": W,
            "height": H,
            "durationSec": round(dur, 3),
            "tracked": bool(do_track),
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
