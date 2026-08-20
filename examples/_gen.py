"""One-off generator for the illustrative sample outputs in this folder.

It builds a tiny hand-written Result (original public-domain-style verse,
NOT any real song) and runs it through the *real* exporters in
backend/pipeline/export.py so every sample file is byte-for-byte what
AutoLyrics would emit, with timings that are internally consistent across
LRC / SRT / ASS / JSON. Re-run with the repo's Python to regenerate.
"""
import sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from pipeline import export  # noqa: E402

EX = pathlib.Path(__file__).resolve().parent


def w(start, end, word, prob):
    return {"start": round(start, 2), "end": round(end, 2),
            "word": word, "prob": round(prob, 2)}


# Six short lines of an original, generic, public-domain-style verse.
# Word timings flow continuously; small gaps between lines.
RESULT = {
    "language": "en",
    "modeUsed": "align",
    "segments": [
        {"id": 0, "start": 9.20, "end": 12.10,
         "text": "Morning light across the bay",
         "words": [
             w(9.20, 9.74, "Morning", 0.98),
             w(9.80, 10.18, "light", 0.97),
             w(10.30, 10.74, "across", 0.95),
             w(10.80, 11.06, "the", 0.99),
             w(11.12, 12.10, "bay", 0.93),
         ]},
        {"id": 1, "start": 12.60, "end": 15.40,
         "text": "Soft and slow we drift away",
         "words": [
             w(12.60, 13.02, "Soft", 0.96),
             w(13.08, 13.36, "and", 0.99),
             w(13.42, 13.86, "slow", 0.94),
             w(13.92, 14.20, "we", 0.98),
             w(14.26, 14.78, "drift", 0.91),
             w(14.84, 15.40, "away", 0.95),
         ]},
        {"id": 2, "start": 15.90, "end": 18.85,
         "text": "Hum a tune the river knows",
         "words": [
             w(15.90, 16.30, "Hum", 0.88),
             w(16.36, 16.58, "a", 0.97),
             w(16.64, 17.04, "tune", 0.96),
             w(17.10, 17.40, "the", 0.99),
             w(17.46, 17.98, "river", 0.93),
             w(18.04, 18.85, "knows", 0.90),
         ]},
        {"id": 3, "start": 19.40, "end": 22.30,
         "text": "Watch how every ripple grows",
         "words": [
             w(19.40, 19.84, "Watch", 0.95),
             w(19.90, 20.16, "how", 0.98),
             w(20.22, 20.74, "every", 0.94),
             w(20.80, 21.34, "ripple", 0.86),
             w(21.40, 22.30, "grows", 0.92),
         ]},
        {"id": 4, "start": 22.85, "end": 25.70,
         "text": "Carry me where breezes call",
         "words": [
             w(22.85, 23.34, "Carry", 0.94),
             w(23.40, 23.66, "me", 0.98),
             w(23.72, 24.10, "where", 0.96),
             w(24.16, 24.78, "breezes", 0.89),
             w(24.84, 25.70, "call", 0.93),
         ]},
        {"id": 5, "start": 26.20, "end": 29.60,
         "text": "Open skies above us all",
         "words": [
             w(26.20, 26.74, "Open", 0.96),
             w(26.80, 27.16, "skies", 0.95),
             w(27.22, 27.70, "above", 0.94),
             w(27.76, 28.06, "us", 0.98),
             w(28.12, 29.60, "all", 0.91),
         ]},
    ],
    "meta": {
        "modelSize": "large-v3",
        "separated": True,
        "durationSec": 31.4,
        "engine": "faster-whisper",
    },
}


# demo.lrc carries both LRC levels in one file: the standard line-level block
# and the enhanced word-level block, under the usual LRC metadata header.
# Both blocks come straight from export.to_lrc(); only the header and the two
# "#" comment lines are added here.
LRC_HEADER = "\n".join([
    "[ti:Demo Verse]",
    "[ar:AutoLyrics demo clip]",
    "[al:LocalAiLyrics examples]",
    "[by:AutoLyrics (LocalAiLyrics)]",
    "[re:AutoLyrics - local-first lyric alignment]",
    "[la:en]",
])
LINE_NOTE = "# --- Standard line-level LRC (one [mm:ss.xx] tag per line) -------------------"
WORD_NOTE = (
    "# --- Enhanced word-level LRC (per-word <mm:ss.xx> tags = the gold sweep) ------\n"
    "# Players that support enhanced LRC highlight each word as it is sung."
)

LRC = "\n".join([
    LRC_HEADER,
    "",
    LINE_NOTE,
    export.to_lrc(RESULT, "line").rstrip("\n"),
    "",
    WORD_NOTE,
    export.to_lrc(RESULT, "word").rstrip("\n"),
]) + "\n"

(EX / "demo.lrc").write_text(LRC, encoding="utf-8")
(EX / "demo.srt").write_text(export.to_srt(RESULT), encoding="utf-8")
(EX / "demo.ass").write_text(export.to_ass(RESULT, True), encoding="utf-8")
(EX / "demo.json").write_text(export.to_json(RESULT) + "\n", encoding="utf-8")
print("generated: demo.lrc demo.srt demo.ass demo.json")
