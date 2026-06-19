"""
pipeline/caption.py — 動態字幕燒錄（hard-sub / burn-in）。

把辨識結果的**逐字時間軸**畫成「會跟著唱/講同步高亮」的字幕,逐幀燒進影片,
輸出**保留原音軌**的新 MP4。這是社群短影音(Submagic / CapCut 自動字幕)那種
逐字跳色字幕——而我們的優勢是逐字時間來自 forced-align / word_timestamps,
而且全程本機、免費。

引擎(與 inpaint.py 同一套,免裝系統 ffmpeg)
------------------------------------------------
  影格繪製:Pillow(ImageDraw)逐幀畫字 + 外框(stroke);無需任何模型。
  影片編碼:h264_nvenc(NVIDIA)→ h264_qsv(Intel)→ libx264(CPU)→ mpeg4。
  音訊:從來源 demux 後**原樣 remux(stream copy)**,零損失。

設計原則:任何重型相依(av / numpy / PIL)缺席或失敗都**不可**讓伺服器崩潰——
一律 try/except 包覆並回報明確錯誤。找不到 CJK 字型時退回 PIL 內建字型(僅拉丁),
並在回傳的 ``fontUsed`` 標明,讓前端可提醒。
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Optional

logger = logging.getLogger("autolyrics.caption")

ProgressFn = Callable[[str, float, str], None]
_STAGE = "caption"

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
    logger.warning("PyAV/numpy 不可用,動態字幕燒錄停用:%s", exc)


def is_available() -> bool:
    """字幕燒錄是否可用(需 PyAV + numpy + PIL)。"""
    if not _HAS_AV:
        return False
    try:
        import PIL  # type: ignore # noqa: F401

        return True
    except Exception:
        return False


def _emit(progress: Optional[ProgressFn], pct: float, msg: str) -> None:
    if progress is None:
        return
    try:
        progress(_STAGE, float(pct), msg)
    except Exception:  # pragma: no cover
        logger.debug("progress 回呼丟例外,已忽略", exc_info=True)


# --------------------------------------------------------------------------- #
# 字型探索(CJK 優先)—— 燒錄需要實體 TTF/TTC,不能靠播放器
# --------------------------------------------------------------------------- #
_FONT_CANDIDATES = [
    # Windows(繁中 msjh / 簡中 msyh / 黑體 simhei）
    r"C:\Windows\Fonts\msjhbd.ttc",
    r"C:\Windows\Fonts\msjh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    # macOS
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    # Linux(Noto / 文泉驛)
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _find_font_path(explicit: Optional[str]) -> Optional[str]:
    if explicit and os.path.isfile(explicit):
        return explicit
    for p in _FONT_CANDIDATES:
        try:
            if os.path.isfile(p):
                return p
        except Exception:
            continue
    return None


# --------------------------------------------------------------------------- #
# 模板(顏色/樣式)—— 逐字狀態:past(已過)/ active(正在唱）/ future(未到)
# --------------------------------------------------------------------------- #
# 顏色為 RGB。highlight = active 字後面的色塊(社群風),None = 無色塊。
_TEMPLATES: dict[str, dict[str, Any]] = {
    # 乾淨白字 + 黑外框,正在唱的字轉金色。最通用。
    "clean": {
        "past": (255, 255, 255),
        "active": (245, 197, 24),
        "future": (255, 255, 255),
        "outline": (0, 0, 0),
        "highlight": None,
        "fontScale": 0.058,
    },
    # 卡拉OK:已唱白、正在唱金、未唱灰 —— 逐字推進感最強。
    "karaoke": {
        "past": (255, 255, 255),
        "active": (245, 197, 24),
        "future": (150, 150, 150),
        "outline": (0, 0, 0),
        "highlight": None,
        "fontScale": 0.058,
    },
    # 社群粗體:正在唱的字加金色圓角色塊 + 深色字(TikTok/Reels 風)。
    "bold": {
        "past": (255, 255, 255),
        "active": (20, 20, 20),
        "future": (255, 255, 255),
        "outline": (0, 0, 0),
        "highlight": (245, 197, 24),
        "fontScale": 0.066,
    },
}


def templates() -> list[str]:
    return list(_TEMPLATES.keys())


# --------------------------------------------------------------------------- #
# 影片編碼器挑選(與 inpaint 同策略)
# --------------------------------------------------------------------------- #
_ENCODER_CHAIN_GPU = ["h264_nvenc", "h264_qsv", "libx264", "mpeg4"]
_ENCODER_CHAIN_CPU = ["libx264", "h264_qsv", "mpeg4"]


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
        return "cpu"
    return dev


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
# 字幕資料:把 segments 攤平成「有逐字資訊的 cue」清單
# --------------------------------------------------------------------------- #
def _prepare_cues(segments: list[dict]) -> list[dict]:
    """把 result.segments 正規化成 cue 清單。

    每個 cue:{start, end, words:[{start,end,word}]}。沒有逐字資訊時,以整句
    text 當單一 word(仍會依 cue 時間進出,只是無逐字高亮)。
    """
    cues: list[dict] = []
    for seg in segments or []:
        try:
            s = float(seg.get("start") or 0.0)
            e = float(seg.get("end") or s)
        except (TypeError, ValueError):
            continue
        words = []
        for w in seg.get("words") or []:
            txt = str(w.get("word", ""))
            if not txt:
                continue
            try:
                ws = float(w.get("start") if w.get("start") is not None else s)
                we = float(w.get("end") if w.get("end") is not None else ws)
            except (TypeError, ValueError):
                ws, we = s, e
            words.append({"start": ws, "end": we, "word": txt})
        if not words:
            text = str(seg.get("text", "")).strip()
            if not text:
                continue
            words = [{"start": s, "end": e, "word": text}]
        cues.append({"start": s, "end": e, "words": words})
    cues.sort(key=lambda c: c["start"])
    return cues


def _active_cue(cues: list[dict], tsec: float, idx_hint: int) -> tuple[Optional[dict], int]:
    """找出 tsec 落在哪個 cue(start..end)。從 idx_hint 線性掃,單調前進(影格時間遞增)。"""
    i = max(0, idx_hint)
    n = len(cues)
    while i < n and cues[i]["end"] < tsec:
        i += 1
    if i < n and cues[i]["start"] <= tsec <= cues[i]["end"]:
        return cues[i], i
    return None, i


# --------------------------------------------------------------------------- #
# 逐幀繪製
# --------------------------------------------------------------------------- #
def _layout_lines(draw: Any, words: list[dict], font: Any, max_w: float) -> list[list[dict]]:
    """把 cue 的 words 排成多行(超出 max_w 換行)。回傳每行的 word 清單(附 w 寬度）。

    用 word 原字串(faster-whisper 拉丁字常帶前導空白 → 自然斷詞;CJK 無空白 →
    緊鄰)。每行第一個字繪製時會 lstrip,避免行首縮排。
    """
    lines: list[list[dict]] = []
    cur: list[dict] = []
    cur_w = 0.0
    for wd in words:
        raw = wd["word"]
        try:
            ww = float(draw.textlength(raw, font=font))
        except Exception:
            ww = float(len(raw)) * font.size * 0.6
        item = {**wd, "raw": raw, "w": ww}
        if cur and (cur_w + ww) > max_w:
            lines.append(cur)
            cur = [item]
            cur_w = ww
        else:
            cur.append(item)
            cur_w += ww
    if cur:
        lines.append(cur)
    return lines


def _draw_caption(
    draw: Any,
    cue: dict,
    tsec: float,
    *,
    W: int,
    H: int,
    font: Any,
    tpl: dict,
    line_h: float,
    stroke: int,
) -> None:
    """在影格 draw 物件上畫出該 cue 的逐字高亮字幕(置中、靠下）。"""
    max_w = W * 0.86
    lines = _layout_lines(draw, cue["words"], font, max_w)
    if not lines:
        return

    total_h = len(lines) * line_h
    # 靠下:底部留 8% 邊界
    y = H - int(H * 0.08) - total_h
    margin_top = int(H * 0.04)
    if y < margin_top:
        y = margin_top

    hl = tpl.get("highlight")
    outline = tpl["outline"]

    for line in lines:
        line_w = sum(it["w"] for it in line)
        x = (W - line_w) / 2.0
        first = True
        for it in line:
            raw = it["raw"]
            draw_text = raw.lstrip() if first else raw
            # lstrip 後寬度會略變;以原 w 推進 x(視覺對齊以原排版為準,差異可忽略)。
            ws, we = it["start"], it["end"]
            if tsec < ws:
                color = tpl["future"]
            elif tsec > we:
                color = tpl["past"]
            else:
                color = tpl["active"]
                if hl is not None:
                    # active 字後面的圓角色塊(社群粗體風)
                    pad_x = max(4, int(font.size * 0.12))
                    pad_y = max(2, int(font.size * 0.06))
                    try:
                        tw = float(draw.textlength(draw_text, font=font))
                    except Exception:
                        tw = it["w"]
                    box = [x - pad_x, y - pad_y, x + tw + pad_x, y + line_h + pad_y]
                    radius = max(6, int(font.size * 0.18))
                    try:
                        draw.rounded_rectangle(box, radius=radius, fill=hl)
                    except Exception:
                        draw.rectangle(box, fill=hl)
            try:
                draw.text(
                    (x, y),
                    draw_text,
                    font=font,
                    fill=color,
                    stroke_width=stroke if hl is None or color != tpl["active"] else 0,
                    stroke_fill=outline,
                )
            except TypeError:
                # 太舊的 Pillow 不支援 stroke_width → 退回無外框
                draw.text((x, y), draw_text, font=font, fill=color)
            x += it["w"]
            first = False
        y += line_h


def burn_captions(
    video_path: str,
    segments: list[dict],
    out_path: str,
    *,
    template: str = "clean",
    device: str = "auto",
    font_path: Optional[str] = None,
    progress: Optional[ProgressFn] = None,
) -> dict:
    """把 segments 的逐字字幕燒進影片,輸出保留原音軌的新 MP4。

    參數
    ----
    video_path: 來源影片。
    segments: 辨識結果的 segments(含 words 逐字時間軸)。
    out_path: 輸出 .mp4 路徑。
    template: "clean" | "karaoke" | "bold"。
    device: "auto" | "cuda" | "cpu"(僅影響編碼器挑選)。
    font_path: 指定字型檔;None = 自動探索 CJK 字型,失敗退回 PIL 內建。

    回傳
    ----
    {"outPath","frames","encoder","template","width","height","durationSec","fontUsed"}
    """
    if not _HAS_AV:
        raise RuntimeError("PyAV/numpy 不可用,無法燒錄字幕")

    from PIL import Image, ImageDraw, ImageFont  # type: ignore

    tpl = _TEMPLATES.get(template) or _TEMPLATES["clean"]
    cues = _prepare_cues(segments)
    if not cues:
        raise ValueError("沒有可用的字幕(segments 為空或無文字)")

    dev = _resolve_device(device)
    encoder = _pick_encoder(dev)

    in_c = av.open(video_path)  # type: ignore[union-attr]
    try:
        if not in_c.streams.video:
            raise RuntimeError("輸入沒有視訊軌")
        in_v = in_c.streams.video[0]
        in_a = in_c.streams.audio[0] if in_c.streams.audio else None
        W = int(in_v.codec_context.width)
        H = int(in_v.codec_context.height)
        rate = in_v.average_rate or in_v.guessed_rate or 25
        total = in_v.frames or 0

        # 字型:大小依畫面高度;探索 CJK 字型,失敗退回內建。
        font_size = max(18, int(H * float(tpl["fontScale"])))
        fpath = _find_font_path(font_path)
        font_used = "default"
        if fpath:
            try:
                font = ImageFont.truetype(fpath, font_size)
                font_used = os.path.basename(fpath)
            except Exception:
                logger.warning("字型載入失敗(%s),退回內建字型", fpath, exc_info=True)
                font = ImageFont.load_default()
        else:
            logger.warning("找不到 CJK 字型,退回 PIL 內建字型(僅拉丁字)")
            font = ImageFont.load_default()

        # 行高 + 外框粗細
        try:
            asc, desc = font.getmetrics()
            line_h = float(asc + desc) * 1.12
        except Exception:
            line_h = float(font_size) * 1.3
        stroke = max(2, int(font_size / 11))

        logger.info(
            "caption:%dx%d @%.3ffps encoder=%s template=%s font=%s cues=%d",
            W, H, float(rate), encoder, template, font_used, len(cues),
        )

        out_c = av.open(out_path, mode="w")  # type: ignore[union-attr]
        out_v = out_c.add_stream(encoder, rate=rate)
        out_v.width = W
        out_v.height = H
        out_v.pix_fmt = "yuv420p"
        try:
            out_v.bit_rate = max(2_000_000, int(W * H * float(rate) * 0.10))
        except Exception:
            pass
        out_a = out_c.add_stream_from_template(in_a) if in_a is not None else None

        vbase = float(in_v.time_base) if in_v.time_base else 0.0
        cue_hint = 0
        done = 0

        for packet in in_c.demux():
            if packet.stream.type == "video":
                for frame in packet.decode():
                    img = np.ascontiguousarray(frame.to_ndarray(format="rgb24"))
                    tsec = (float(frame.pts) * vbase) if (frame.pts is not None and vbase) else (done / float(rate) if rate else 0.0)

                    cue, cue_hint = _active_cue(cues, tsec, cue_hint)
                    if cue is not None:
                        pim = Image.fromarray(img)
                        draw = ImageDraw.Draw(pim)
                        _draw_caption(
                            draw, cue, tsec,
                            W=W, H=H, font=font, tpl=tpl, line_h=line_h, stroke=stroke,
                        )
                        img = np.asarray(pim)

                    nf = av.VideoFrame.from_ndarray(np.ascontiguousarray(img), format="rgb24")  # type: ignore[union-attr]
                    for p in out_v.encode(nf):
                        out_c.mux(p)
                    done += 1
                    if done % 15 == 0:
                        if total:
                            pct = 2.0 + 95.0 * min(1.0, done / total)
                        else:
                            pct = 2.0 + (done % 900) / 10.0
                        _emit(progress, pct, f"燒錄字幕中… 第 {done} 幀")
            elif out_a is not None and packet.stream is in_a and packet.dts is not None:
                packet.stream = out_a  # 音訊 stream copy
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
            "template": template,
            "width": W,
            "height": H,
            "durationSec": round(dur, 3),
            "fontUsed": font_used,
        }
    finally:
        try:
            in_c.close()
        except Exception:
            pass
