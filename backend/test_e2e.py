"""
AutoLyrics 端到端測試腳本
--------------------------------
直接呼叫 pipeline.run(),不經過 HTTP,方便快速驗證辨識準度。

用法:
    # 自動模式(純辨識,分離人聲後 Whisper)
    .venv\\Scripts\\python.exe test_e2e.py "C:\\path\\to\\song.mp3"

    # 強制對齊(完整參考歌詞;歌詞放在 UTF-8 文字檔,保留斷行)
    .venv\\Scripts\\python.exe test_e2e.py "song.mp3" --lyrics "lyrics.txt"

    # 偏置模式(部分歌詞 + 風格)
    .venv\\Scripts\\python.exe test_e2e.py "song.mp3" --bias --style pop --content "upbeat funk"

    # 其他旗標: --no-separate 跳過 Demucs;--model medium 換模型;--lang en 指定語言
"""
from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import run, to_lrc  # noqa: E402


def _progress(stage: str, pct: float, message: str) -> None:
    bar = "█" * int(pct / 5) + "·" * (20 - int(pct / 5))
    print(f"\r  [{bar}] {pct:5.1f}%  {stage:<10} {message[:48]:<48}", end="", flush=True)


def _print_result(label: str, result: dict) -> None:
    segs = result.get("segments", [])
    meta = result.get("meta", {})
    print(f"\n\n=== {label} ===")
    print(f"  語言={result.get('language')}  模式={result.get('modeUsed')}  "
          f"模型={meta.get('modelSize')}  分離人聲={meta.get('separated')}  "
          f"時長={meta.get('durationSec', 0):.1f}s  行數={len(segs)}")
    print("  " + "-" * 70)
    for s in segs[:40]:
        t0 = s.get("start", 0.0)
        m, sec = divmod(t0, 60)
        nlow = sum(1 for w in s.get("words", []) if (w.get("prob", 1.0) or 1.0) < 0.5)
        flag = f"  ⚠{nlow}低信心" if nlow else ""
        print(f"  [{int(m):02d}:{sec:05.2f}] {s.get('text','').strip()}{flag}")
    if len(segs) > 40:
        print(f"  … 還有 {len(segs) - 40} 行")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--lyrics", help="完整參考歌詞文字檔(觸發強制對齊)")
    ap.add_argument("--bias", action="store_true", help="偏置模式")
    ap.add_argument("--style", action="append", default=[], help="風格 key(可多次)")
    ap.add_argument("--content", default="", help="參考內容提示")
    ap.add_argument("--no-separate", action="store_true")
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--lang", default=None)
    ap.add_argument("--out", default=".", help="LRC 輸出資料夾")
    args = ap.parse_args()

    audio = str(Path(args.audio).resolve())
    if not Path(audio).exists():
        print(f"✗ 找不到檔案: {audio}")
        return 1

    separate = not args.no_separate
    stem = Path(audio).stem
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n♪ 音檔: {audio}")
    print(f"  模型={args.model}  分離人聲={separate}  語言={args.lang or 'auto'}")

    if args.lyrics:
        ref = Path(args.lyrics).read_text(encoding="utf-8")
        mode, kwargs, label = "align", {"reference_lyrics": ref}, "強制對齊 (Forced Alignment)"
    elif args.bias:
        mode = "biasing"
        kwargs = {"reference_content": args.content, "style_keys": args.style}
        label = "偏置 (Biasing)"
    else:
        mode, kwargs, label = "auto", {}, "自動 (純辨識)"

    t0 = time.time()
    result = run(audio, mode=mode, language=args.lang, model_size=args.model,
                 separate=separate, device="auto", progress=_progress, **kwargs)
    dt = time.time() - t0
    _print_result(label, result)
    print(f"\n  ⏱ 耗時 {dt:.1f}s")

    lrc_path = out_dir / f"{stem}.{mode}.lrc"
    lrc_path.write_text(to_lrc(result, level="line"), encoding="utf-8")
    print(f"  💾 LRC 已輸出: {lrc_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
