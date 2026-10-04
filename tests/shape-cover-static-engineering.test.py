"""M2-F controls. Synthetic review answers test transitions, never attest a real observation."""
import base64
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("engineering", Path(__file__).parents[1] / "scripts/shape-cover-static-engineering.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def bitmap(bits):
    packed = np.packbits(bits.ravel(), bitorder="little").tobytes()
    return {"bbox": {"x": 0, "y": 0, "width": bits.shape[1], "height": bits.shape[0]},
            "encoding": "bitpack-lsb-row-major-v1", "dataBase64": base64.b64encode(packed).decode(),
            "sha256": m.truth.sha(packed), "markedPixels": int(bits.sum())}


def evidence():
    controlled = {"complete": True, "metrics": {"requiredPixels": 100, "missedRequiredPixels": 0, "missingRequiredFrames": 0},
                  "negative": {"missedRequiredPixels": 1, "missingRequiredFrames": 1, "status": "CONTROLLED_EXACT_NOT_QUALIFIED"}}
    checks = {k: True for k in ("sourceFresh", "methodFresh", "geometryFresh", "reviewSetFresh", "corpusFresh")}
    checks.update({k: False for k in ("sourceChanged", "maskChanged", "configChanged", "geometryContradiction")})
    review = {"complete": True, "frames": [{"binding": {"index": 0}}]}
    return controlled, checks, review


class EngineeringEvidenceTest(unittest.TestCase):
    def test_review_reuse_requires_exact_set_and_each_old_and_new_asset_byte(self):
        with tempfile.TemporaryDirectory() as directory:
            old, new = [Path(directory) / name for name in ("old", "new")]
            old.mkdir()
            new.mkdir()
            for root in (old, new):
                (root / "original.png").write_bytes(b"synthetic-asset-not-real-review")
            review = {"frames": [{"binding": {"index": 0}}], "maskSha256": "a" * 64,
                      "assetDigests": {"original.png": m.file_sha(old / "original.png")}}
            m.save(old / "review-set.json", review)
            m.save(new / "review-set.json", review)
            self.assertTrue(m.identical_review_package(old, review, new))
            changed = copy.deepcopy(review)
            changed["maskSha256"] = "b" * 64
            self.assertFalse(m.identical_review_package(old, changed, new))
            (new / "original.png").write_bytes(b"different")
            self.assertFalse(m.identical_review_package(old, review, new))
            (new / "original.png").write_bytes(b"synthetic-asset-not-real-review")
            (old / "original.png").write_bytes(b"old-mutated")
            self.assertFalse(m.identical_review_package(old, review, new))

    def test_omitted_component_comparison_retains_complete_denominator(self):
        required = np.zeros((96, 128), bool)
        required[31:56, 53:78] = True
        required[41:45, 83:87] = True
        missing = required.copy()
        missing[41:45, 83:87] = False
        bindings = [{"index": i, "pts": i * 10, "endPts": (i + 1) * 10,
                     "byteLength": 128 * 96 * 4, "pixelSha256": "a" * 64} for i in range(30)]
        result = m.metrics([bitmap(required)] * 30, bitmap(missing), bindings)
        self.assertEqual(result["missedRequiredPixels"], 480)
        self.assertEqual(result["missingRequiredFrames"], 30)
        self.assertEqual(result["maxMissPerFrame"], 16)
        self.assertEqual(result["status"], "CONTROLLED_EXACT_NOT_QUALIFIED")

    def test_exact_shapes_have_independent_alpha_denominator(self):
        for kind in ("opaque", "AA", "low-alpha", "thin-tip", "two-pixel-stroke", "hole", "disconnected", "corner", "edge"):
            with self.subTest(kind=kind):
                alpha = np.zeros((96, 128), np.uint8)
                alpha[20:28, 30:38] = 255
                if kind == "AA":
                    alpha[19, 30:38] = 32
                if kind == "low-alpha":
                    alpha[19, 30:38] = 1
                if kind == "thin-tip":
                    alpha[18:20, 34] = 255
                if kind == "two-pixel-stroke":
                    alpha[18:20, 34:36] = 255
                if kind == "hole":
                    alpha[22:24, 32:34] = 0
                if kind == "disconnected":
                    alpha[35:38, 40:43] = 255
                if kind == "corner":
                    alpha[0:3, 0:3] = 255
                if kind == "edge":
                    alpha[20:28, 127] = 255
                required = bitmap(alpha > 0)
                # Comparator-only control candidate: construction denominator is already defined.
                candidate = bitmap(alpha > 0)
                bindings = [{"index": i, "pts": i * 10, "endPts": (i + 1) * 10, "byteLength": 128 * 96 * 4,
                             "pixelSha256": str(i) * 64} for i in range(3)]
                result = m.metrics([required] * 3, candidate, bindings)
                self.assertEqual(result["requiredPixels"], int((alpha > 0).sum()) * 3)
                self.assertEqual(result["missedRequiredPixels"], 0)
                self.assertEqual(result["missingRequiredFrames"], 0)

    def test_exactly_one_required_pixel_miss_rejects(self):
        required = np.zeros((96, 128), bool)
        required[20:28, 30:38] = True
        candidate = required.copy()
        candidate[20, 30] = False
        result = m.metrics([bitmap(required)], bitmap(candidate), [{"index": 0, "pts": 0, "endPts": 10,
                          "byteLength": 128 * 96 * 4, "pixelSha256": "a" * 64}])
        self.assertEqual(result["missedRequiredPixels"], 1)
        self.assertEqual(result["missingRequiredFrames"], 1)
        self.assertEqual(result["maxMissPerFrame"], 1)
        self.assertEqual(result["worstFrame"], 0)
        self.assertEqual(result["status"], "CONTROLLED_EXACT_NOT_QUALIFIED")
        c, checks, review = evidence()
        c["metrics"] = result
        self.assertEqual(m.decide(c, checks, review, "NO_VISIBLE_RESIDUAL_OBSERVED")["status"], "ENGINEERING_REJECTED")

    def test_real_review_no_visible_residual_transition_only(self):
        result = m.decide(*evidence(), "NO_VISIBLE_RESIDUAL_OBSERVED")
        self.assertEqual(result["status"], "ENGINEERING_ACCEPTED")
        self.assertEqual(len(result["claims"]), 3)
        self.assertFalse(result["eligible"])
        self.assertEqual(result["authority"], "none")

    def test_visible_residual_rejects(self):
        self.assertEqual(m.decide(*evidence(), "VISIBLE_RESIDUAL_OBSERVED")["status"], "ENGINEERING_REJECTED")

    def test_unknown_and_absent_human_are_incomplete(self):
        c, checks, review = evidence()
        observed, actual = m.observation(review, None)
        self.assertEqual(observed, "UNKNOWN")
        self.assertIsNone(actual["reviewerId"])
        self.assertEqual(m.decide(c, checks, review, observed)["status"], "ENGINEERING_INCOMPLETE")

    def test_mask_source_config_and_geometry_changes_reject(self):
        for key in ("maskChanged", "sourceChanged", "configChanged", "geometryContradiction"):
            with self.subTest(key=key):
                c, checks, review = evidence()
                checks[key] = True
                self.assertEqual(m.decide(c, checks, review, "NO_VISIBLE_RESIDUAL_OBSERVED")["status"], "ENGINEERING_REJECTED")

    def test_stale_geometry_method_source_review_and_corpus_incomplete(self):
        for key in ("geometryFresh", "methodFresh", "sourceFresh", "reviewSetFresh", "corpusFresh"):
            with self.subTest(key=key):
                c, checks, review = evidence()
                checks[key] = False
                self.assertEqual(m.decide(c, checks, review, "NO_VISIBLE_RESIDUAL_OBSERVED")["status"], "ENGINEERING_INCOMPLETE")

    def test_review_set_digest_missing_frames_and_nonhuman_refused(self):
        _, _, review = evidence()
        raw = {"schema": "static-boundary-observation/v1", "reviewSetDigest": m.digest(review), "reviewerId": "synthetic-test-only",
               "reviewerKind": "HUMAN_ENGINEERING_REVIEWER", "question": "当前mask外，是否能看到明显属于旧贴纸的视觉贡献？",
               "frames": [{"ordinal": 0, "observation": "NO_VISIBLE_RESIDUAL_OBSERVED"}]}
        self.assertEqual(m.observation(review, raw)[0], "NO_VISIBLE_RESIDUAL_OBSERVED")
        for key, value in (("reviewSetDigest", "a" * 64), ("frames", []), ("reviewerKind", "MODEL"), ("reviewerId", "")):
            changed = {**raw, key: value}
            with self.assertRaises(ValueError):
                m.observation(review, changed)

    def test_json_clone_never_has_product_authority_and_keeps_old_rgb(self):
        import json
        result = json.loads(json.dumps(m.decide(*evidence(), "NO_VISIBLE_RESIDUAL_OBSERVED")))
        self.assertEqual(result["authority"], "none")
        self.assertFalse(result["eligible"])
        self.assertEqual(result["historicalAppearanceCriterion"], "REJECTED")
        self.assertEqual(result["historicalAppearanceDecision"], "FULL_RANGE_STATIC_CONTRADICTION")
        self.assertEqual(result["m2ProductProof"], "NOT_ISSUED")
        self.assertEqual(result["m3"], "BLOCKED")

    def test_human_aggregate_answer_is_preserved_without_invented_frame_answers(self):
        _, _, review = evidence()
        raw = {"schema": "static-boundary-observation/v1", "reviewSetDigest": m.digest(review), "reviewerId": "synthetic-transition-test",
               "reviewerKind": "HUMAN_ENGINEERING_REVIEWER", "question": "当前mask外，是否能看到明显属于旧贴纸的视觉贡献？",
               "scope": "FROZEN_REVIEW_SET", "observation": "NO_VISIBLE_RESIDUAL_OBSERVED", "originalResponse": "synthetic-test-only",
               "provenance": "ACTUAL_USER_MESSAGE", "reviewedOrdinals": [0]}
        observed, actual = m.observation(review, raw)
        self.assertEqual(observed, "NO_VISIBLE_RESIDUAL_OBSERVED")
        self.assertNotIn("frames", actual)
        self.assertEqual(actual["originalResponse"], "synthetic-test-only")
        with self.assertRaises(ValueError):
            m.observation(review, {**raw, "reviewedOrdinals": []})

    def test_incomplete_controlled_or_risk_coverage_blocks(self):
        c, checks, review = evidence()
        c["complete"] = False
        self.assertEqual(m.decide(c, checks, review, "NO_VISIBLE_RESIDUAL_OBSERVED")["status"], "ENGINEERING_INCOMPLETE")
        c, checks, review = evidence()
        review["complete"] = False
        self.assertEqual(m.decide(c, checks, review, "NO_VISIBLE_RESIDUAL_OBSERVED")["status"], "ENGINEERING_INCOMPLETE")

    def test_deterministic_risk_set_preserves_distinct_signatures(self):
        n = 6990
        bindings = [{"index": i} for i in range(n)]
        gf = [{"cells": [{"offset": [0, 0]} for _ in range(9)]} for _ in range(n)]
        gf[120]["cells"][8]["offset"] = [-0.75, -0.25]
        risk = {"complete": True, "metrics": {"edgeEnergy": [i % 17 for i in range(n)], "backgroundLuma": [i % 23 for i in range(n)]},
                "sceneCuts": [500, 3500, 6500], "visibilityAmbiguities": []}
        anomalies = [{"index": i, "worstDifference": 25 + j, "changedSupportPixels": 1,
                      "pixels": [{"x": x, "y": y, "supportBoundaryDistance": depth, "channelExceedance": channels}]} for j, (i, x, y, depth, channels) in
                     enumerate([(233, 629, 2, 1, [0, 0, 26]), (710, 700, 2, 1, [26, 0, 0]), (715, 700, 40, 2, [0, 26, 0]), (3764, 629, 40, 3, [26, 26, 26])])]
        result = m.review_set(bindings, anomalies, gf, risk, {"x": 628, "y": 1, "width": 81, "height": 59})
        self.assertEqual(result, m.review_set(bindings, anomalies, gf, risk, {"x": 628, "y": 1, "width": 81, "height": 59}))
        ordinals = [f["binding"]["index"] for f in result["frames"]]
        self.assertTrue({0, 6989, 233, 710, 715, 3764, 120, 499, 500, 501}.issubset(ordinals))
        self.assertEqual(result["distinctAnomalySignatures"], 4)

    def test_package_is_candidate_visible_without_expected_answer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            review = {"frames": [{"binding": {"index": 0, "pts": 0}, "reasons": ["first"]}]}
            mask = np.zeros((8, 8), bool)
            mask[2:6, 2:6] = True
            assets = m.package_frames(root, review, mask, {0: np.full((8, 8, 4), 150, np.uint8)})
            self.assertEqual(len(assets), 4)
            m.write_html(root, review)
            html = (root / "review.html").read_text()
            self.assertIn('observation:"UNKNOWN"', html)
            self.assertNotIn("confidence", html)
            self.assertNotIn("PASS/FAIL", html)

    def test_finish_recomputes_current_identity_and_staleness(self):
        # Fully synthetic local packet; exercises freshness rather than asserting human evidence.
        for change, expected in (("none", "ENGINEERING_INCOMPLETE"), ("source", "ENGINEERING_REJECTED"),
                                 ("mask", "ENGINEERING_REJECTED"), ("config", "ENGINEERING_REJECTED"),
                                 ("geometry", "ENGINEERING_INCOMPLETE"), ("review", "ENGINEERING_INCOMPLETE")):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source_path, candidate_path, input_path, geometry_path = [root / p for p in ("source.bin", "candidate.json", "input.json", "geometry.json")]
                source_path.write_bytes(b"synthetic-source")
                source = {"fingerprint": "sha256:" + m.file_sha(source_path), "byteLength": source_path.stat().st_size}
                interval = {"startFrame": 0, "endFrame": 1}
                mask = bitmap(np.ones((8, 8), bool))
                candidate = {"receipt": {"mask": mask, "config": {"margin": 3}, "configDigest": "a" * 64, "range": interval}}
                m.save(candidate_path, candidate)
                m.save(input_path, {"source": source})
                m.save(geometry_path, {"testOnly": True})
                controlled, checks, review = evidence()
                review["assetDigests"] = {}
                base = {"checks": checks, "context": {"source": source, "range": interval,
                        "roi": {"x": 0, "y": 0, "width": 8, "height": 8}}, "controlledCorpus": controlled,
                        "candidateMask": mask, "candidateMaskDigest": mask["sha256"], "extractor": {"config": {"margin": 3}, "configDigest": "a" * 64},
                        "reviewSetDigest": m.digest(review), "identityRefs": {"source": str(source_path), "input": str(input_path),
                        "candidate": str(candidate_path), "geometry": [str(geometry_path)], "corpus": []},
                        "inputFreeze": {str(p): m.file_sha(p) for p in (source_path, input_path, candidate_path, geometry_path)}}
                m.save(root / "package.json", base)
                m.save(root / "review-set.json", review)
                m.save(root / "package-freeze.json", {p: m.file_sha(root / p) for p in ("package.json", "review-set.json")})
                if change == "source":
                    source_path.write_bytes(b"changed")
                elif change in ("mask", "config"):
                    if change == "mask":
                        candidate["receipt"]["mask"]["bbox"]["x"] = 1
                    else:
                        candidate["receipt"]["config"]["margin"] = 4
                    import json
                    candidate_path.write_text(json.dumps(candidate))
                elif change == "geometry":
                    geometry_path.write_text("{}")
                elif change == "review":
                    (root / "review-set.json").write_text('{"complete":false,"assetDigests":{},"frames":[]}')
                result = m.finish(root, None, root / "receipt.json")
                self.assertEqual(result["status"], expected)
                self.assertEqual(result["realReviewObservation"], "UNKNOWN")
                self.assertFalse(result["eligible"])


if __name__ == "__main__":
    unittest.main()
