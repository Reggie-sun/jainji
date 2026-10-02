"""Independent construction controls; never real-media truth qualification."""
import base64
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("truth", Path(__file__).parents[1] / "scripts/shape-cover-required-pixel-truth.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def bitmap(bits, x=10, y=20):
    packed = np.packbits(bits.ravel(), bitorder="little").tobytes()
    return {"bbox": {"x": x, "y": y, "width": bits.shape[1], "height": bits.shape[0]},
            "encoding": "bitpack-lsb-row-major-v1", "dataBase64": base64.b64encode(packed).decode(),
            "sha256": hashlib.sha256(packed).hexdigest(), "markedPixels": int(bits.sum())}


def fixture():
    # Truth is defined first from explicit alpha, including a faint one-pixel tip and a hole.
    alpha = np.zeros((8, 8), np.uint8)
    alpha[2:6, 2:6] = 255
    alpha[3, 3] = 0
    alpha[1, 4] = 1
    labels = (alpha > 0).astype(np.uint8)
    digest = hashlib.sha256(labels.tobytes()).hexdigest()
    context = {"source": {"fingerprint": "sha256:" + "a" * 64, "width": 32, "height": 32},
               "sourceKey": "b" * 64, "targetId": "controlled-target", "confirmationDigest": "c" * 64,
               "roi": {"x": 10, "y": 20, "width": 8, "height": 8}, "range": {"startFrame": 0, "endFrame": 3}}
    bindings = [{"index": i, "pts": i * 10, "endPts": (i + 1) * 10,
                 "byteLength": 256, "pixelSha256": str(i) * 64} for i in range(3)]
    truth = {"method": "independent-required-pixel-packet/v1", "context": copy.deepcopy(context),
             "scope": "CONTROLLED_CONSTRUCTION", "origin": "KNOWN_COMPOSITING_ALPHA",
             "authorId": "construction-author", "reviewerId": "control-reviewer",
             "boundaryReview": "BOUNDED", "provenance": [{"sha256": hashlib.sha256(alpha.tobytes()).hexdigest(), "method": "explicit-alpha-before-candidate"}],
             "rasters": {digest: base64.b64encode(labels.tobytes()).decode()},
             "frames": [{"binding": copy.deepcopy(b), "truthSha256": digest, "motion": "STATIC"} for b in bindings]}
    return context, bindings, truth, bitmap(labels.astype(bool))


class RequiredPixelTruthTest(unittest.TestCase):
    def compare(self, context, bindings, truth, mask):
        return module.compare(context, bindings, mask, truth)

    def test_full_containment_and_pixel_frame_denominator(self):
        result = self.compare(*fixture())
        self.assertEqual(result["metrics"], {"requiredPixels": 48, "missedRequiredPixels": 0,
                         "missingRequiredFrames": 0, "excessPixels": 0, "comparedFrames": 3})
        self.assertEqual(result["status"], "CONTROLLED_COMPARISON_MATCH")
        self.assertEqual(result["qualification"], "INCOMPLETE")

    def test_tip_hole_and_bbox_exterior_are_compared(self):
        context, bindings, truth, mask = fixture()
        # Smaller bbox hides neither the tip nor the lower edge; filling the hole is excess.
        candidate = np.ones((3, 4), bool)
        result = self.compare(context, bindings, truth, bitmap(candidate, 12, 22))
        self.assertEqual(result["metrics"]["missedRequiredPixels"], 15)
        self.assertEqual(result["metrics"]["missingRequiredFrames"], 3)
        self.assertEqual(result["metrics"]["excessPixels"], 3)
        self.assertIn([14, 21], result["uniqueMissedSourceXY"])
        self.assertEqual(result["uniqueExcessSourceXY"], [[13, 23]])

    def test_single_required_tail_pixel_cannot_average_away(self):
        context, bindings, truth, mask = fixture()
        labels = np.frombuffer(base64.b64decode(next(iter(truth["rasters"].values()))), np.uint8).copy()
        labels[7 * 8 + 7] = 1
        digest = hashlib.sha256(labels.tobytes()).hexdigest()
        truth["rasters"][digest] = base64.b64encode(labels).decode()
        truth["frames"][-1]["truthSha256"] = digest
        result = self.compare(context, bindings, truth, mask)
        self.assertEqual(result["metrics"]["missedRequiredPixels"], 1)
        self.assertEqual(result["metrics"]["missingRequiredFrames"], 1)
        self.assertEqual(result["frames"][-1]["missedSourceXY"], [[17, 27]])
        self.assertEqual(result["status"], "DECLARED_REQUIRED_PIXEL_MISS")

    def test_unknown_does_not_become_background_or_zero_miss(self):
        context, bindings, truth, mask = fixture()
        old = next(iter(truth["rasters"]))
        labels = bytearray(base64.b64decode(truth["rasters"].pop(old)))
        labels[1 * 8 + 4] = 2
        digest = hashlib.sha256(labels).hexdigest()
        truth["rasters"][digest] = base64.b64encode(labels).decode()
        for f in truth["frames"]:
            f["truthSha256"] = digest
        result = self.compare(context, bindings, truth, mask)
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertIsNone(result["metrics"]["missedRequiredPixels"])
        self.assertIsNone(result["metrics"]["excessPixels"])
        self.assertEqual(result["observed"]["unknownPixelOccurrences"], 3)
        self.assertEqual(result["observed"]["knownExcessPixels"], 0)

    def test_missing_truth_has_no_invented_numbers(self):
        context, bindings, _, mask = fixture()
        result = self.compare(context, bindings, None, mask)
        self.assertEqual(result["reasons"], ["INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING"])
        self.assertTrue(all(v is None for v in result["metrics"].values()))

    def test_metadata_cannot_qualify_real_media(self):
        context, bindings, truth, mask = fixture()
        truth.update(scope="REAL_MEDIA", origin="INDEPENDENT_ANNOTATION")
        result = self.compare(context, bindings, truth, mask)
        self.assertEqual(result["metrics"]["missedRequiredPixels"], 0)
        self.assertEqual(result["status"], "REAL_MEDIA_DECLARED_COMPARISON_ONLY")
        self.assertEqual(result["qualification"], "INCOMPLETE")
        self.assertFalse(result["eligible"])
        self.assertIn("REAL_MEDIA_INDEPENDENCE_AND_REVIEW_NOT_VERIFIED", result["reasons"])

    def test_wrong_binding_missing_frame_and_circular_origin_rejected(self):
        for change in (lambda t: t["frames"].pop(),
                       lambda t: t["frames"][1]["binding"].update(pts=11),
                       lambda t: t["frames"][1]["binding"].update(pixelSha256="d" * 64),
                       lambda t: t["context"].update(sourceKey="d" * 64),
                       lambda t: t.update(origin="DETECTOR_MASK"),
                       lambda t: t.update(reviewerId=t["authorId"]),
                       lambda t: t["provenance"][0].update(sha256=fixture()[3]["sha256"])):
            context, bindings, truth, mask = fixture()
            change(truth)
            with self.assertRaises(ValueError):
                self.compare(context, bindings, truth, mask)

    def test_unbounded_or_nonstatic_truth_remains_incomplete(self):
        for change in (lambda t: t.update(boundaryReview="UNKNOWN"),
                       lambda t: t["frames"][-1].update(motion="UNKNOWN")):
            context, bindings, truth, mask = fixture()
            change(truth)
            result = self.compare(context, bindings, truth, mask)
            self.assertEqual(result["status"], "INCOMPLETE")
            self.assertIsNone(result["metrics"]["missingRequiredFrames"])

    def test_invalid_bitmap_raster_and_frame_clock_rejected(self):
        context, bindings, truth, mask = fixture()
        bad = copy.deepcopy(mask)
        bad["markedPixels"] += 1
        with self.assertRaises(ValueError):
            self.compare(context, bindings, truth, bad)
        truth["rasters"][next(iter(truth["rasters"]))] = base64.b64encode(bytes(64)).decode()
        with self.assertRaises(ValueError):
            self.compare(context, bindings, truth, mask)
        context, bindings, truth, mask = fixture()
        bindings[-1]["index"] = 3
        with self.assertRaises(ValueError):
            self.compare(context, bindings, truth, mask)

    def test_oversized_diff_stops_before_materializing_coordinate_lists(self):
        context, bindings, truth, mask = fixture()
        original_budget = module.LIMIT_BYTES
        module.LIMIT_BYTES = 1024 * 1024
        try:
            with self.assertRaisesRegex(ValueError, "working-set budget"):
                self.compare(context, bindings, truth, mask)
        finally:
            module.LIMIT_BYTES = original_budget


if __name__ == "__main__":
    unittest.main()
