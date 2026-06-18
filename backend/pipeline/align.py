"""
pipeline/align.py — 強制對齊(完整歌詞模式)

當使用者貼上「完整歌詞」時走這條路:把既有文字對齊到音訊,得到接近完美的逐字時間軸。

實作:**torchaudio 原生強制對齊**(`torchaudio.functional.forced_align` + `MMS_FA` bundle)。
這條路的關鍵好處 —— **完全免 C/C++ 編譯器**:forced_align 已隨 torchaudio wheel 預編譯,
MMS_FA 是多語 wav2vec2-CTC 對齊模型。因此 Windows 使用者不需安裝 Visual C++ Build Tools
(這正是先前 ctc-forced-aligner 從原始碼建置失敗的原因)。

設計重點
--------
1. **CJK 逐字粒度**:中文一整行沒有空白,若整行當「一個詞」時間軸就爛掉。所以對齊前先
   自建 token plan:每一非空行,Latin 連續段以空白切、CJK 連續段「逐字」切,並保留
   `token_line_idx[]` 平行陣列,事後把逐 token 結果重新分組回原行。
2. **保留使用者的斷行**:每一非空原始行 = 一個 segment(line)。
3. **羅馬化(CJK)**:MMS_FA 的字典是拉丁字母,CJK 需先羅馬化。若安裝了 `uroman`
   (純 Python、免編譯)則自動羅馬化中日韓 → 可逐字對齊;未安裝時 CJK token 取不到
   字典字元,該 token 不對齊(上層 pipeline 會退回 biasing)。英文/拉丁語則直接對齊。
4. **優雅降級**:torch / torchaudio 匯入失敗 → `is_available()` 回 False、`align()` 拋
   明確 RuntimeError(由上層 pipeline 決定 fallback)。整個伺服器絕不因此崩潰。
5. 全域快取對齊模型,避免每個 job 重載權重。

回傳形狀與 transcribe() 一致(API_CONTRACT 的 Result.segments):
    {
      "language": str,
      "segments": [
        { "start": float, "end": float, "text": str,
          "words": [ {"start": float, "end": float, "word": str, "prob": float} ] }
      ]
    }
"""

from __future__ import annotations

import logging
import re
import threading
import unicodedata
from typing import Any, Callable, Optional

logger = logging.getLogger("autolyrics.align")

# --------------------------------------------------------------------------- #
# 重型相依:torch + torchaudio(MMS_FA + forced_align)。匯入失敗時整支模組仍可
# 載入,只是 is_available() 會回 False,align() 會丟出可被上層捕捉的 RuntimeError。
# --------------------------------------------------------------------------- #
_IMPORT_ERROR: Optional[str] = None
try:
    import torch  # type: ignore
    import torchaudio  # type: ignore
    import torchaudio.functional as AF  # type: ignore
    from torchaudio.pipelines import MMS_FA as _BUNDLE  # type: ignore

    _HAS_ALIGNER = True
except Exception as exc:  # pragma: no cover - 取決於環境
    torch = None  # type: ignore
    torchaudio = None  # type: ignore
    AF = None  # type: ignore
    _BUNDLE = None  # type: ignore
    _HAS_ALIGNER = False
    _IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
    logger.warning("torchaudio 對齊不可用(已降級):%s", _IMPORT_ERROR)

# 選用:uroman 羅馬化器(CJK → 拉丁),純 Python、免編譯。沒有也能跑(僅 CJK 不對齊)。
_UROMAN: Any = None
try:  # pragma: no cover - 取決於環境
    from uroman import Uroman as _Uroman  # type: ignore

    _UROMAN = _Uroman()
    logger.info("uroman 可用 → CJK 將先羅馬化再逐字對齊。")
except Exception:
    _UROMAN = None


# 進度回呼型別:progress(stage: str, pct: float, msg: str)
ProgressFn = Callable[[str, float, str], None]


# --------------------------------------------------------------------------- #
# 模型快取(MMS_FA 與單一語言無關,依 device 快取即可)
# --------------------------------------------------------------------------- #
_MODEL_CACHE: dict[str, tuple[Any, dict, int]] = {}
_MODEL_LOCK = threading.Lock()


def is_available() -> bool:
    """強制對齊功能是否可用。供 /api/meta 的 aligner 旗標使用。"""
    return _HAS_ALIGNER


def _resolve_device(device: str) -> str:
    """把 'auto' 解析為實際裝置;cuda 不可用時退回 cpu。"""
    if device == "auto":
        if torch is not None and torch.cuda.is_available():  # type: ignore[union-attr]
            return "cuda"
        return "cpu"
    if device == "cuda" and (torch is None or not torch.cuda.is_available()):  # type: ignore[union-attr]
        logger.warning("要求 cuda 但不可用,退回 cpu")
        return "cpu"
    return device


def _get_model(device: str) -> tuple[Any, dict, int]:
    """載入並快取 (model, dictionary, sample_rate)。MMS_FA = 多語 wav2vec2-CTC。"""
    cached = _MODEL_CACHE.get(device)
    if cached is not None:
        return cached
    with _MODEL_LOCK:
        cached = _MODEL_CACHE.get(device)
        if cached is not None:
            return cached
        logger.info("載入 MMS_FA 對齊模型 device=%s(首次會下載權重)", device)
        # with_star=False:用乾淨的拉丁字典 + blank=0 對齊
        model = _BUNDLE.get_model(with_star=False).to(device).eval()  # type: ignore[union-attr]
        dictionary = _BUNDLE.get_dict(star=None)  # type: ignore[union-attr]  # char -> index
        sample_rate = int(_BUNDLE.sample_rate)  # type: ignore[union-attr]  # 16000
        _MODEL_CACHE[device] = (model, dictionary, sample_rate)
        return _MODEL_CACHE[device]


# --------------------------------------------------------------------------- #
# Token plan:把使用者貼的多行歌詞拆成「對齊用 token」並保留原行對應
# --------------------------------------------------------------------------- #
def _is_cjk(ch: str) -> bool:
    """是否為 CJK(含中日韓統一表意、擴展、假名、諺文、全形標點等)。"""
    if ch.isspace():
        return False
    code = ord(ch)
    if (
        0x3040 <= code <= 0x30FF      # 平假名 + 片假名
        or 0x3400 <= code <= 0x4DBF   # CJK 擴展 A
        or 0x4E00 <= code <= 0x9FFF   # CJK 統一表意
        or 0xF900 <= code <= 0xFAFF   # CJK 兼容表意
        or 0xAC00 <= code <= 0xD7A3   # 諺文音節
        or 0x3130 <= code <= 0x318F   # 諺文相容字母
        or 0xFF00 <= code <= 0xFFEF   # 全形/半形
        or 0x20000 <= code <= 0x2FA1F # CJK 擴展 B~F + 兼容補充
    ):
        return True
    try:
        name = unicodedata.name(ch)
    except ValueError:
        return False
    return name.startswith(("CJK", "HIRAGANA", "KATAKANA", "HANGUL"))


def _tokenize_line(line: str) -> list[str]:
    """
    把單一行拆成對齊 token:
      - CJK 字元:逐字成 token
      - Latin / 數字 / 其他連續非空白段:整段為一個 token(以空白為界)
    範例:"明天 see you" -> ["明", "天", "see", "you"]
          "Hello 世界!"  -> ["Hello", "世", "界", "！"]
    """
    tokens: list[str] = []
    buf: list[str] = []

    def flush() -> None:
        if buf:
            tokens.append("".join(buf))
            buf.clear()

    for ch in line:
        if ch.isspace():
            flush()
        elif _is_cjk(ch):
            flush()
            tokens.append(ch)
        else:
            buf.append(ch)
    flush()
    return tokens


def _build_token_plan(transcript_text: str) -> tuple[list[str], list[int], list[str]]:
    """
    從原始多行歌詞建立 token plan。

    回傳:
      tokens        — 扁平 token 列表
      token_line_idx— 與 tokens 等長,記錄每個 token 屬於第幾個「輸出行」
      line_texts    — 每個輸出行的原始文字(保留原斷行,trim 兩端空白)
    """
    tokens: list[str] = []
    token_line_idx: list[int] = []
    line_texts: list[str] = []

    for raw_line in transcript_text.splitlines():
        line_tokens = _tokenize_line(raw_line)
        if not line_tokens:
            continue
        out_idx = len(line_texts)
        line_texts.append(raw_line.strip())
        for tok in line_tokens:
            tokens.append(tok)
            token_line_idx.append(out_idx)

    return tokens, token_line_idx, line_texts


# --------------------------------------------------------------------------- #
# Token 正規化:把一個顯示 token 變成 MMS_FA 字典可接受的「字元索引序列」
# --------------------------------------------------------------------------- #
def _normalize_token(tok: str, dictionary: dict) -> list[int]:
    """
    把單一 token 正規化成字典索引序列:
      1. CJK 先用 uroman 羅馬化(若可用),否則保持原樣(多半取不到索引)。
      2. 轉小寫、把非字母換成空白後去除。
      3. 逐字元查字典;不在字典中的字元(數字、標點…)直接略過。
    取不到任何索引時回傳空 list(該 token 不參與對齊,regroup 會補時間)。
    """
    text = tok
    if _UROMAN is not None and any(_is_cjk(c) for c in tok):
        try:
            text = _UROMAN.romanize_string(tok)
        except Exception:
            text = tok
    text = text.lower()
    text = re.sub(r"[^a-z']", "", text)  # MMS_FA 拉丁字典:a-z 與省略號
    return [dictionary[c] for c in text if c in dictionary]


def _empty_result(language: str) -> dict:
    return {"language": language, "segments": []}


def _load_waveform(path: str, target_sr: int) -> Any:
    """讀音訊成 (1, N) 單聲道 float32 Tensor,取樣率=target_sr。

    **刻意避開 torchaudio.load** —— torchaudio 2.11 的 load 改走 torchcodec(預設未安裝),
    會丟 ImportError。改用後備鏈:soundfile(人聲 wav 走這條)→ PyAV(faster-whisper 的
    decode_audio,內含 ffmpeg,處理 mp3 等)→ 最後才退回 torchaudio.load。
    """
    # 1) soundfile(libsndfile;wav/flac/ogg)
    try:
        import soundfile as sf  # type: ignore

        data, sr = sf.read(path, always_2d=True, dtype="float32")  # (n, ch)
        wav = torch.from_numpy(data.T)  # type: ignore[union-attr]  # (ch, n)
        if wav.shape[0] > 1:
            wav = wav.mean(0, keepdim=True)
        if sr != target_sr:
            wav = torchaudio.functional.resample(wav, sr, target_sr)  # type: ignore[union-attr]
        return wav.float()
    except Exception as exc:
        logger.debug("soundfile 讀取失敗,改用 PyAV(%s)", exc)

    # 2) PyAV(直接回 target_sr 單聲道)
    try:
        from faster_whisper.audio import decode_audio  # type: ignore

        mono = decode_audio(path, sampling_rate=target_sr)
        return torch.from_numpy(mono).float().unsqueeze(0)  # type: ignore[union-attr]
    except Exception as exc:
        logger.debug("PyAV 解碼失敗,最後嘗試 torchaudio.load(%s)", exc)

    # 3) 最後手段:torchaudio.load(可能需要 torchcodec)
    wav, sr = torchaudio.load(path)  # type: ignore[union-attr]
    if wav.shape[0] > 1:
        wav = wav.mean(0, keepdim=True)
    if sr != target_sr:
        wav = torchaudio.functional.resample(wav, sr, target_sr)  # type: ignore[union-attr]
    return wav.float()


# --------------------------------------------------------------------------- #
# 主入口
# --------------------------------------------------------------------------- #
def align(
    audio_path: str,
    transcript_text: str,
    language: str = "zho",
    device: str = "cuda",
    progress: Optional[ProgressFn] = None,
) -> dict:
    """
    對既有歌詞做強制對齊,回傳逐行(內含逐 token / 逐字)時間軸。

    參數
    ----
    audio_path : 音訊路徑(理想為已分離的人聲 wav,任何可解碼音訊皆可)。
    transcript_text : 使用者貼上的完整歌詞;**斷行有意義**,會被保留為各 segment。
    language : ISO-639-3 語言碼(zho / eng / jpn / kor …),目前僅作標記用途。
    device : "cuda" | "cpu" | "auto"。
    progress : progress(stage, pct, msg) 進度回呼(可選)。

    失敗策略:相依缺失或無可對齊文字 → RuntimeError(由上層改走 transcribe)。
    """

    def _emit(stage: str, pct: float, msg: str) -> None:
        if progress is not None:
            try:
                progress(stage, pct, msg)
            except Exception:
                logger.debug("progress 回呼丟出例外(已忽略)", exc_info=True)

    if not _HAS_ALIGNER:
        raise RuntimeError(
            "強制對齊不可用:torch / torchaudio 未安裝或匯入失敗"
            + (f"({_IMPORT_ERROR})" if _IMPORT_ERROR else "")
        )

    # --- 1) 建立 token plan(保留斷行 + CJK 逐字) -------------------------- #
    _emit("align", 41.0, "準備歌詞對齊…")
    tokens, token_line_idx, line_texts = _build_token_plan(transcript_text)
    if not tokens:
        logger.warning("歌詞為空或無可對齊內容,回傳空結果")
        return _empty_result(language)

    dev = _resolve_device(device)

    try:
        # --- 2) 載入模型 + 音訊(重採樣到 16k 單聲道) -------------------- #
        _emit("align", 45.0, "載入對齊模型…")
        model, dictionary, sr = _get_model(dev)

        _emit("align", 55.0, "讀取音訊…")
        waveform = _load_waveform(audio_path, sr).to(dev)

        # --- 3) 把每個 token 正規化成字典索引序列 ------------------------ #
        per_token_ids: list[list[int]] = [_normalize_token(t, dictionary) for t in tokens]
        flat_targets = [idx for ids in per_token_ids for idx in ids]
        if not flat_targets:
            raise RuntimeError(
                "歌詞無可對齊字元(CJK 需安裝 uroman 才能羅馬化對齊;"
                "或文字全為數字/標點)。"
            )

        # --- 4) 推論 emissions + 強制對齊 -------------------------------- #
        _emit("align", 65.0, "計算聲學機率…")
        with torch.inference_mode():  # type: ignore[union-attr]
            emission, _lengths = model(waveform)
        num_frames = emission.size(1)
        ratio = waveform.size(1) / num_frames  # 每個 emission frame 對應的取樣點數

        _emit("align", 80.0, "對齊文字與音訊…")
        targets = torch.tensor([flat_targets], dtype=torch.int32, device=emission.device)  # type: ignore[union-attr]
        aligned, scores = AF.forced_align(emission, targets, blank=0)  # type: ignore[union-attr]
        aligned, scores = aligned[0], scores[0].exp()  # log → prob
        char_spans = AF.merge_tokens(aligned, scores)  # type: ignore[union-attr]
        # char_spans:長度 == len(flat_targets),每個有 .start/.end(frame)/.score

        if len(char_spans) != len(flat_targets):
            logger.warning(
                "對齊字元 span 數(%d)≠ 目標字元數(%d),仍盡量分組",
                len(char_spans), len(flat_targets),
            )
    except RuntimeError:
        raise
    except Exception as exc:
        logger.exception("強制對齊失敗")
        raise RuntimeError(f"強制對齊失敗:{type(exc).__name__}: {exc}") from exc

    # --- 5) 把字元 span 依「每個 token 的字元數」拆回 token,再依行分組 ----- #
    _emit("align", 92.0, "整理逐字時間軸…")

    def _to_sec(frame: float) -> float:
        return max(0.0, float(frame) * ratio / sr)

    # 先把扁平的 char_spans 依 per_token_ids 長度切回每個 token
    word_ts: list[dict] = []
    cur = 0
    last_end = 0.0
    for tok, ids in zip(tokens, per_token_ids):
        n = len(ids)
        if n == 0 or cur >= len(char_spans):
            # 此 token 無可對齊字元 → 0 長度佔位(接在上一個結束點)
            word_ts.append({"text": tok, "start": last_end, "end": last_end, "score": 0.0})
            continue
        group = char_spans[cur:cur + n]
        cur += n
        if not group:
            word_ts.append({"text": tok, "start": last_end, "end": last_end, "score": 0.0})
            continue
        start = _to_sec(group[0].start)
        end = _to_sec(group[-1].end)
        if end < start:
            end = start
        score = sum(float(getattr(s, "score", 0.0)) for s in group) / len(group)
        last_end = end
        word_ts.append({"text": tok, "start": start, "end": end, "score": score})

    segments = _regroup(word_ts, tokens, token_line_idx, line_texts)
    _emit("align", 95.0, f"對齊完成({len(segments)} 行)")
    return {"language": language, "segments": segments}


# --------------------------------------------------------------------------- #
# 重新分組:flat word_ts → 依原始行的 segments
# --------------------------------------------------------------------------- #
def _regroup(
    word_ts: list[dict],
    tokens: list[str],
    token_line_idx: list[int],
    line_texts: list[str],
) -> list[dict]:
    """把逐 token 結果按 token_line_idx 重新分組回原始行。"""
    n = min(len(word_ts), len(token_line_idx))
    if len(word_ts) != len(token_line_idx):
        logger.warning(
            "對齊 token 數(%d)與計畫 token 數(%d)不符,以 %d 對齊",
            len(word_ts), len(token_line_idx), n,
        )

    per_line: list[list[dict]] = [[] for _ in line_texts]

    def _f(x: Any, default: float = 0.0) -> float:
        try:
            v = float(x)
            return v if v == v else default
        except (TypeError, ValueError):
            return default

    for i in range(n):
        w = word_ts[i]
        line_idx = token_line_idx[i]
        start = _f(w.get("start"))
        end = _f(w.get("end"))
        if end < start:
            end = start
        text = (w.get("text") or "").strip() or tokens[i]
        prob = _clamp01(_f(w.get("score"), 0.0))
        per_line[line_idx].append(
            {"start": start, "end": end, "word": text, "prob": prob}
        )

    segments: list[dict] = []
    for idx, words in enumerate(per_line):
        if not words:
            segments.append(
                {"start": 0.0, "end": 0.0, "text": line_texts[idx], "words": []}
            )
            continue
        line_start = min(w["start"] for w in words)
        line_end = max(w["end"] for w in words)
        if line_end < line_start:
            line_end = line_start
        segments.append(
            {"start": line_start, "end": line_end, "text": line_texts[idx], "words": words}
        )

    return segments


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x
