"""Controlled diagnostic observations, not real-media mask qualification."""
import importlib.util
import hashlib
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("anomalies", Path(__file__).parents[1] / "scripts/shape-cover-static-anomalies.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StaticAnomaliesTest(unittest.TestCase):
    def test_half_open_runs_do_not_bridge_normal_frames(self):
        self.assertEqual(module.runs([715, 710, 709, 710]), [{"startFrame": 709, "endFrame": 711}, {"startFrame": 715, "endFrame": 716}])
        self.assertEqual(module.runs([]), [])

    def test_threshold_is_strict_and_coordinates_preserved(self):
        frame = np.array([[[24, 0, 0, 255], [25, 0, 0, 255], [100, 0, 0, 255]]], dtype=np.uint8)
        low = high = np.zeros((1, 3, 3), dtype=np.int16)
        changed, difference, channels = module.exceedance(frame, low, high, np.array([[True, True, False]]), 24)
        self.assertEqual(changed.tolist(), [[False, True, False]])
        self.assertEqual(difference.tolist(), [[24, 25, 100]])
        self.assertEqual(channels[0, 1].tolist(), [25, 0, 0])

    def test_nonrectangular_support_replayed_from_original_samples(self):
        rng = np.random.default_rng(0)
        samples = rng.integers(0, 256, (8, 32, 32, 4), dtype=np.uint8)
        samples[..., 3] = 255
        samples[:, 12:20, 13:19, :3] = 220
        samples[:, 10:12, 15:17, :3] = 220
        config = {"maxChannelStd": 20, "minimumComponentPixels": 8, "edgeDifference": 18, "dilationPixels": 3}
        support, mask, low, high, _ = module.reconstruct(samples, {"x": 600, "y": 0, "width": 32, "height": 32}, {"x": 610, "y": 8, "width": 14, "height": 16}, config)
        self.assertEqual(int(support.sum()), 52)
        self.assertTrue(mask[7, 12])
        self.assertFalse(mask[7, 10])
        self.assertEqual(low[10, 15].tolist(), [220, 220, 220])
        self.assertEqual(high[10, 15].tolist(), [220, 220, 220])

    def test_unresolved_boundary_does_not_make_diagnostic_success(self):
        samples = np.zeros((3, 16, 16, 4), np.uint8)
        samples[:, :, 8:, :3] = 200
        config = {"maxChannelStd": 20, "minimumComponentPixels": 8, "edgeDifference": 18, "dilationPixels": 3}
        with self.assertRaisesRegex(ValueError, "unresolved support boundary"):
            module.reconstruct(samples, {"x": 0, "y": 0, "width": 16, "height": 16}, {"x": 4, "y": 4, "width": 8, "height": 8}, config)

    def test_local_translation_observation_detects_constructed_shift(self):
        reference = np.random.default_rng(2).integers(0, 256, (16, 16, 3), dtype=np.uint8)
        core = np.zeros((16, 16), bool)
        core[5:11, 5:11] = True
        frame = np.roll(reference, 1, axis=1)
        self.assertEqual(module.alignment_scores(reference, reference, core)["bestLocalIntegerOffset"], [0, 0])
        self.assertEqual(module.alignment_scores(frame, reference, core)["bestLocalIntegerOffset"], [1, 0])
        self.assertEqual(module.alignment_scores(frame, reference, core)["bestMeanAbsoluteRgbDifference"], 0)

    def test_real_decoder_rejects_wrong_pixel_and_pts_bindings(self):
        engine = Path.home() / ".config/jianji/tools/ffmpeg/bin/ffmpeg"
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "controlled.mp4"
            subprocess.run([str(engine), "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=32x32:r=30:d=0.1", "-vf", "setsar=1",
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source)], check=True, timeout=20)
            raw = subprocess.run([str(engine), "-v", "error", "-i", str(source), "-vf", "format=rgba", "-f", "rawvideo", "-"],
                                 capture_output=True, check=True, timeout=20).stdout
            bindings = [{"index": i, "pts": i * 512, "endPts": (i + 1) * 512, "pixelSha256": hashlib.sha256(raw[i * 4096:(i + 1) * 4096]).hexdigest()} for i in range(3)]
            roi = {"x": 0, "y": 0, "width": 32, "height": 32}
            observed = []
            module.decode(source, engine, roi, bindings, "1/15360", lambda f, b: observed.append(b["index"]), time.monotonic() + 20)
            self.assertEqual(observed, [0, 1, 2])
            bad_pixels = [{**b, "pixelSha256": "0" * 64} for b in bindings]
            with self.assertRaisesRegex(ValueError, "ROI pixel binding"):
                module.decode(source, engine, roi, bad_pixels, "1/15360", lambda f, b: None, time.monotonic() + 20)
            bad_pts = [{**b, "pts": b["pts"] + 1} for b in bindings]
            with self.assertRaisesRegex(ValueError, "PTS/hash"):
                module.decode(source, engine, roi, bad_pts, "1/15360", lambda f, b: None, time.monotonic() + 20)


if __name__ == "__main__":
    unittest.main()
