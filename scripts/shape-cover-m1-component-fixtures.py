"""Deterministic HC4 companion media. Run once before freezing detector support.

Construction boxes identify intended controls, never define detector membership.
Existing counterexample NPZ files are not read or rewritten.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np

CASES = ["stable", "small-move-x", "small-disappear", "weak-shift-strong-background",
         "large-move-x", "large-move-negative-x", "large-move-y", "large-move-negative-y",
         "outside-background", "outside-price", "uniform-island", "hollow"]


def generate(root):
    root.mkdir(parents=True, exist_ok=False)
    rng = np.random.default_rng(17)
    texture = rng.integers(20, 236, (96, 128), dtype=np.uint8)
    manifest = {"method": "actual-m1-component-companion/v1", "seed": 17,
                "width": 128, "height": 96, "frameCount": 30, "fps": 10,
                "discoveryFrames": 4, "changeOrdinal": 15, "cases": []}
    for name in CASES:
        frames = []
        for f in range(30):
            yy, xx = np.indices((96, 128))
            frame = ((f * 107 + xx * 13 + yy * 11) % 230 + 10).astype(np.uint8)
            large = texture[14:42, 12:44].copy()
            small = texture[50:54, 90:94].copy()
            if name == "uniform-island":
                small[:] = 200
            if name == "weak-shift-strong-background":
                small = (120 + (small % 9)).astype(np.uint8)
                frame[8:36, 60:82] = texture[8:36, 60:82]
            dx, dy = 0, 0
            if f == 15 and name.startswith("large-move"):
                dx = -1 if name == "large-move-negative-x" else 1 if name == "large-move-x" else 0
                dy = -1 if name == "large-move-negative-y" else 1 if name == "large-move-y" else 0
            frame[14+dy:42+dy, 12+dx:44+dx] = large
            if name == "hollow":
                frame[22:34, 22:34] = ((f * 107 + xx[22:34,22:34] * 13 + yy[22:34,22:34] * 11) % 230 + 10)
            sx = 1 if f == 15 and name in ["small-move-x", "weak-shift-strong-background"] else 0
            if not (f == 15 and name == "small-disappear"):
                frame[50:54, 90+sx:94+sx] = small
            # Unsampled interventions outside the detector components, including their padding.
            if name in ["outside-background", "outside-price"] and f == 15:
                outside = np.ones((96,128), bool)
                outside[14:42,12:44] = False; outside[50:54,90:94] = False
                frame[outside] = rng.integers(10,246,outside.sum(),dtype=np.uint8)
                if name == "outside-price":
                    frame[12:14,10:48] = 240
                    frame[44:48,10:48] = np.tile(np.array([20,240], np.uint8), (4,19))
            frames.append(np.repeat(frame[...,None],3,axis=2))
        filename = name + ".mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                        "-s", "128x96", "-r", "10", "-i", "pipe:0", "-vf", "setsar=1",
                        "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p",
                        "-video_track_timescale", "10000", "-n", str(root/filename)],
                       input=np.stack(frames).tobytes(), check=True)
        manifest["cases"].append({"name": name, "file": filename,
            "sha256": hashlib.sha256((root/filename).read_bytes()).hexdigest(),
            "confirmedConstructionBoxes": [{"x":12,"y":14,"width":32,"height":28},
                                           {"x":90,"y":50,"width":4,"height":4}],
            "expected": "UNOBSERVABLE" if name == "uniform-island" else "ISSUE" if "move" in name or "disappear" in name or "shift" in name else "SUPPORTED"})
    (root/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")


if __name__ == "__main__":
    generate(Path(sys.argv[1]))
