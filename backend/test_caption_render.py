"""Self-test for pipeline.caption.burn_captions — synthetic video + word-timed
segments → burn each template → assert output exists and captions are visible.

Run with a venv that has av + numpy + pillow:
    PYTHONPATH=backend <venv python> backend/test_caption_render.py
"""
import os
import sys
import tempfile

import av
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import caption  # noqa: E402

W, H, FPS, SECS = 640, 360, 25, 3
BG = (20, 30, 60)  # dark blue background


def make_video(path):
    c = av.open(path, "w")
    s = c.add_stream("libx264", rate=FPS)
    s.width, s.height, s.pix_fmt = W, H, "yuv420p"
    for _ in range(FPS * SECS):
        arr = np.full((H, W, 3), BG, dtype=np.uint8)
        fr = av.VideoFrame.from_ndarray(arr, format="rgb24")
        for p in s.encode(fr):
            c.mux(p)
    for p in s.encode():
        c.mux(p)
    c.close()


def frame_at(path, t):
    c = av.open(path)
    vs = c.streams.video[0]
    target = t
    got = None
    for fr in c.decode(video=0):
        tsec = float(fr.pts) * float(vs.time_base) if fr.pts is not None else 0.0
        got = fr.to_ndarray(format="rgb24")
        if tsec >= target:
            break
    c.close()
    return got


SEGMENTS = [
    {
        "start": 0.3, "end": 2.7, "text": "Hello world 你好 世界",
        "words": [
            {"start": 0.3, "end": 0.9, "word": "Hello"},
            {"start": 0.9, "end": 1.5, "word": " world"},
            {"start": 1.5, "end": 2.1, "word": " 你好"},
            {"start": 2.1, "end": 2.7, "word": " 世界"},
        ],
    }
]


def count_text_pixels(frame):
    """Count bright (text) pixels in the bottom third — they shouldn't exist on
    the plain dark-blue background, so a high count means a caption was drawn."""
    if frame is None:
        return -1
    bottom = frame[int(H * 0.6):, :, :].astype(np.int32)
    # text is white/gold (high R+G), far from BG (20,30,60)
    dist = np.abs(bottom[:, :, 0] - BG[0]) + np.abs(bottom[:, :, 1] - BG[1])
    return int(np.sum(dist > 200))


def main():
    tmp = tempfile.mkdtemp(prefix="captest_")
    src = os.path.join(tmp, "src.mp4")
    make_video(src)
    print("availability:", caption.is_available())
    print("templates:", caption.templates())

    all_ok = True
    for tpl in caption.templates():
        out = os.path.join(tmp, f"out_{tpl}.mp4")
        res = caption.burn_captions(src, SEGMENTS, out, template=tpl)
        exists = os.path.exists(out) and os.path.getsize(out) > 0
        # frame at t=1.2s → active word " world" is mid-cue, caption must be visible
        px = count_text_pixels(frame_at(out, 1.2))
        # frame at t=2.95s → past the cue end, caption should be GONE (near-zero)
        px_after = count_text_pixels(frame_at(out, 2.95))
        ok = exists and res["frames"] > 0 and px > 300 and px_after < px // 3
        all_ok = all_ok and ok
        print(
            f"[{tpl:8}] out={exists} frames={res['frames']} font={res['fontUsed']} "
            f"encoder={res['encoder']} textpx@1.2s={px} textpx@2.95s={px_after} -> "
            f"{'PASS' if ok else 'FAIL'}"
        )

    print("\nRESULT:", "ALL PASS" if all_ok else "FAIL")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
