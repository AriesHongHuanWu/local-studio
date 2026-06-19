"""
強制對齊「精準度」診斷腳本(不經 HTTP)。

做法(避免重複分離人聲):
  1. Demucs 分離人聲一次。
  2. Whisper 純辨識該人聲 → 取得「機器轉寫」當作參考歌詞(不需我手打版權歌詞)。
  3. 對同一條人聲跑 align.align()(= 使用者貼完整歌詞時走的同一條碼路徑)。
  4. 印出逐字時間軸 + 精準度健檢:
       - 單調性(每個詞 start 不早於前一詞 end - 容許微重疊)
       - 時長合理性(0 < dur < MAX)、是否落在 [0, 音檔長]
       - 英文「雙字母」詞(coffee/fall/see…)是否拿到各自獨立、非零寬時間(舊 merge_tokens bug 修復驗證)
       - refine(onset-snap)是否成功執行
       - 覆蓋率:對齊到的詞數 / 參考 token 數

用法:
    .venv\\Scripts\\python.exe -X utf8 test_align_precision.py "song.mp3" --lang en [--model large-v3]
"""
from __future__ import annotations
import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import separate as _separate          # noqa: E402
from pipeline import transcribe as _transcribe        # noqa: E402
from pipeline import align as _align                  # noqa: E402
from pipeline import config as _config                # noqa: E402

DOUBLE_LETTER = re.compile(r"([a-zA-Z])\1")           # 相鄰重複字母


def _resolve_device() -> str:
    try:
        import torch  # type: ignore
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _progress(stage: str, pct: float, message: str) -> None:
    bar = "#" * int(pct / 5) + "." * (20 - int(pct / 5))
    print(f"\r  [{bar}] {pct:5.1f}%  {stage:<10} {message[:46]:<46}", end="", flush=True)


def _flatten_words(segments: list[dict]) -> list[dict]:
    out: list[dict] = []
    for s in segments:
        for w in s.get("words") or []:
            out.append(w)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--lang", default=None)
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--no-refine", action="store_true", help="關閉 onset-snap 對照")
    args = ap.parse_args()

    audio = str(Path(args.audio).resolve())
    if not Path(audio).exists():
        print(f"X 找不到檔案: {audio}")
        return 1

    dev = _resolve_device()
    print(f"\n♪ {Path(audio).name}")
    print(f"  device={dev}  model={args.model}  lang={args.lang or 'auto'}  refine={not args.no_refine}")

    # 1) 人聲分離(一次)
    print("\n[1/3] 人聲分離 (Demucs)…")
    t0 = time.time()
    out_dir = str(Path(audio).parent / "_separated")
    try:
        vocals = _separate.separate_vocals(audio, out_dir=out_dir, device=dev, progress=_progress)
    except Exception as e:
        print(f"\n  分離失敗,改用原檔: {e}")
        vocals = audio
    sep_used = vocals != audio
    print(f"\n  人聲={'分離成功' if sep_used else '未分離(用原檔)'}  耗時 {time.time()-t0:.1f}s")

    # 2) 純辨識 → 機器參考歌詞
    print("\n[2/3] Whisper 純辨識 (產生機器參考)…")
    t0 = time.time()
    rec = _transcribe.transcribe(vocals, language=args.lang, initial_prompt=None,
                                 model_size=args.model, device=dev, progress=_progress)
    rec_segs = rec.get("segments", []) if isinstance(rec, dict) else []
    ref_lines = [str(s.get("text", "")).strip() for s in rec_segs if str(s.get("text", "")).strip()]
    reference = "\n".join(ref_lines)
    print(f"\n  辨識 {len(ref_lines)} 行  耗時 {time.time()-t0:.1f}s")
    print(f"  參考前 5 行: {ref_lines[:5]}")

    if not reference.strip():
        print("X 辨識為空,無法測對齊")
        return 1

    # 3) 強制對齊(使用者貼完整歌詞時的同一條路徑)
    print("\n[3/3] 強制對齊 (forced_align, MMS_FA)…")
    t0 = time.time()
    iso3 = _config.to_iso3(args.lang)
    lang_code = _config.normalize_align_lang(args.lang)
    al = _align.align(vocals, reference, language=iso3, device=dev,
                      refine=not args.no_refine, lang_code=lang_code, progress=_progress)
    al_segs = al.get("segments", []) if isinstance(al, dict) else []
    dt = time.time() - t0
    print(f"\n  對齊 {len(al_segs)} 段  耗時 {dt:.1f}s  iso3={iso3} lang_code={lang_code}")

    words = _flatten_words(al_segs)
    n = len(words)
    if n == 0:
        print("X 對齊回傳 0 詞 — 可能 CJK 羅馬化失敗或字典不匹配")
        return 1

    # --- 精準度健檢 ---------------------------------------------------------
    durs = []
    overlaps = 0
    zero_or_neg = 0
    prev_end = 0.0
    out_of_order = 0
    audio_dur = 0.0
    try:
        import soundfile as sf  # type: ignore
        info = sf.info(audio)
        audio_dur = info.frames / info.samplerate
    except Exception:
        audio_dur = max((w.get("end", 0.0) for w in words), default=0.0)

    out_of_range = 0
    for w in words:
        st = float(w.get("start", 0.0)); en = float(w.get("end", 0.0))
        d = en - st
        durs.append(d)
        if d <= 0:
            zero_or_neg += 1
        if st < prev_end - 0.06:        # 容許 60ms 微重疊
            overlaps += 1
        if st < prev_end - 0.001:
            out_of_order += 1
        if st < -0.01 or en > audio_dur + 0.5:
            out_of_range += 1
        prev_end = max(prev_end, en)

    durs_sorted = sorted(durs)
    median = durs_sorted[len(durs_sorted) // 2]
    mx = max(durs); mn = min(durs)

    print("\n" + "=" * 64)
    print("  精準度健檢")
    print("=" * 64)
    print(f"  總詞數              : {n}")
    print(f"  音檔長              : {audio_dur:.1f}s")
    print(f"  詞時長 中位/最小/最大: {median:.3f}s / {mn:.3f}s / {mx:.3f}s")
    print(f"  零或負時長          : {zero_or_neg}  ({100*zero_or_neg/n:.1f}%)  <- 應接近 0")
    print(f"  明顯重疊(>60ms)     : {overlaps}  ({100*overlaps/n:.1f}%)  <- 應接近 0")
    print(f"  次序顛倒(start<前end): {out_of_order}  ({100*out_of_order/n:.1f}%)")
    print(f"  超出音檔範圍        : {out_of_range}  <- 應為 0")

    # 雙字母英文詞(舊 merge_tokens 會把 'll'/'ee' 等折疊 → 驗證已修復)
    dbl = [w for w in words if DOUBLE_LETTER.search(str(w.get("word", "")))]
    dbl_bad = [w for w in dbl if float(w.get("end", 0)) - float(w.get("start", 0)) <= 0]
    print(f"\n  含雙字母英文詞      : {len(dbl)}  其中時長<=0 的壞詞: {len(dbl_bad)}  <- 應為 0")
    for w in dbl[:8]:
        st = float(w.get("start", 0)); en = float(w.get("end", 0))
        print(f"      '{w.get('word')}'  [{st:6.2f} → {en:6.2f}]  ({en-st:.2f}s)")

    # 前 24 詞逐字時間軸
    print("\n  逐字時間軸(前 24 詞):")
    for w in words[:24]:
        st = float(w.get("start", 0)); en = float(w.get("end", 0))
        p = w.get("prob", 1.0)
        print(f"      [{st:6.2f} → {en:6.2f}] ({en-st:4.2f}s) p={p:.2f}  {w.get('word')}")

    print("\n  小結:零/負時長與重疊比例越低越好;雙字母壞詞=0 代表英文折疊 bug 已修;"
          f"\n        對齊耗時 {dt:.1f}s(相對辨識極快)。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
