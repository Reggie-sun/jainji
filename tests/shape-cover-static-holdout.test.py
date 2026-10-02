"""M2-E controls use synthetic evidence only; no real human review is impersonated."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("holdout", Path(__file__).parents[1] / "scripts/shape-cover-static-holdout.py")
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class HoldoutTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source_path = self.root / "controlled-media.bin"
        self.source_path.write_bytes(b"controlled source; not real holdout")
        self.source = {"fingerprint": "sha256:" + h.file_sha(self.source_path), "byteLength": self.source_path.stat().st_size,
                       "width": 4, "height": 4, "durationMs": 4, "timeBase": "1/1000"}
        self.context = {"source": self.source, "sourceKey": "test-source", "targetId": "test-target", "confirmationDigest": "a" * 64,
                        "roi": {"x": 0, "y": 0, "width": 4, "height": 4}, "range": {"startFrame": 0, "endFrame": 4}}
        self.bindings = [{"index": i, "pts": i, "endPts": i + 1, "byteLength": 64, "pixelSha256": str(i) * 64} for i in range(4)]
        self.method = {"detector": {"method": "controlled-detector/v1", "config": {"x": 1}},
                       "extractor": {"method": "controlled-mask/v1", "config": {"x": 1}},
                       "geometry": {"method": "controlled-geometry/v1", "config": {"x": 1}},
                       "files": {str(Path(__file__)): h.file_sha(__file__)}, "dependencies": {"test-runtime": "1"}}
        self.evidence_path = self.root / "provenance.json"
        self.evidence_path.write_text(json.dumps({"kind": "CONTROLLED_TEST_EVIDENCE"}))
        self.record = {"sourceId": "source-1", "sourcePath": str(self.source_path), "source": self.source,
                       "provenanceClass": "CONTROLLED_TEST", "independenceGroupId": "group-1",
                       "provenance": {"description": "controlled unique source", "rawRecordingId": "raw-1", "downloadedSourceId": "download-1",
                                      "sameRawRecording": False, "sameDownloadedSource": False, "derived": False, "framesOverlap": False},
                       "independence": "ACCEPTED", "evidence": {str(self.evidence_path): h.file_sha(self.evidence_path)},
                       "exposure": "UNSEEN", "targetConfirmation": "CONFIRMED_STATIC"}
        self.risk = {"contextDigest": h.digest(self.context), "bindingsDigest": h.digest(self.bindings), "complete": True,
                     "metrics": {k: [i * .1 for i in range(4)] for k in h.RISK_METRICS}, "sceneCuts": [], "visibilityAmbiguities": []}

    def setup_plan(self):
        registry = h.Registry()
        registry.register(self.record)
        source = registry.freeze_source("source-1", self.method)
        plan = registry.freeze_plan(source, self.context, self.bindings, self.risk)
        return registry, source, plan

    def truth(self, plan):
        labels = bytes([1, 1] + [0] * 14)
        return {"schema": "static-roi-human-truth/v1", "authority": "none", "eligible": False,
                "planDigest": plan.digest, "context": self.context, "boundaryReview": "BOUNDED",
                "frames": [{"binding": b, "labelsBase64": base64.b64encode(labels).decode(), "truthSha256": h.sha(labels)}
                           for b in plan.data["bindings"]]}

    def declarations(self, truth):
        common = {k: True for k in h.DECLARATIONS}
        common.update(truthContentDigest=h.digest(truth), planDigest=truth["planDigest"], evidenceClass="CONTROLLED_TEST")
        result = []
        for role, name in (("AUTHOR", "author"), ("QA", "reviewer")):
            data = {**common, "role": role, "reviewerId": name, "decision": "APPROVE"}
            path = self.root / (role + ".json"); path.write_text(json.dumps(data))
            result.append({"path": str(path), "sha256": h.file_sha(path)})
        return result

    def candidate(self, source, plan):
        return {"context": self.context, "bindings": self.bindings, "methodDigest": source.data["methodDigest"],
                "mask": {"encoding": "bitpack-lsb-row-major-v1", "bbox": {"x": 0, "y": 0, "width": 4, "height": 4},
                         "dataBase64": base64.b64encode(b"\x03\x00").decode(), "sha256": h.sha(b"\x03\x00"), "markedPixels": 2},
                "geometry": {"contextDigest": h.digest(self.context), "bindingsDigest": h.digest(self.bindings),
                             "methodDigest": source.data["methodDigest"], "complete": True, "issues": 0, "supportedMorphology": True}}

    def compare(self, edit_truth=None, edit_candidate=None):
        registry, source, plan = self.setup_plan()
        truth = self.truth(plan)
        if edit_truth: edit_truth(truth)
        frozen = registry.freeze_truth(plan, truth, *self.declarations(truth))
        candidate = self.candidate(source, plan)
        if edit_candidate: edit_candidate(candidate)
        return registry.compare(source, plan, frozen, candidate)

    def test_unseen_registration(self):
        registry, source, _ = self.setup_plan()
        self.assertEqual(source.data["usage"], "HOLDOUT_FROZEN")
        self.assertEqual(registry.count_ready_sources(), 0)  # Controlled sources never count as real.

    def test_development_never_becomes_unseen(self):
        registry = h.Registry({self.source["fingerprint"]: "historical developer view"})
        with self.assertRaisesRegex(ValueError, "DEVELOPMENT_EXPOSED"):
            registry.register(self.record)

    def test_derivative_rejected(self):
        self.record["provenance"]["derived"] = True
        registry = h.Registry(); registry.register(self.record)
        with self.assertRaisesRegex(ValueError, "INDEPENDENCE"):
            registry.freeze_source("source-1", self.method)

    def test_duplicate_independence_group(self):
        registry, _, _ = self.setup_plan()
        other = copy.deepcopy(self.record); other["sourceId"] = "source-2"
        path = self.root / "other.bin"; path.write_bytes(b"different bytes same source group")
        other["sourcePath"] = str(path); other["source"]["fingerprint"] = "sha256:" + h.file_sha(path); other["source"]["byteLength"] = path.stat().st_size
        registry.register(other)
        with self.assertRaisesRegex(ValueError, "SAME_SOURCE"):
            registry.freeze_source("source-2", self.method)

    def test_unknown_independence_not_counted(self):
        self.record["independence"] = "INDEPENDENCE_UNKNOWN"
        registry = h.Registry(); registry.register(self.record)
        self.assertEqual(registry.count_ready_sources(), 0)
        with self.assertRaises(ValueError): registry.freeze_source("source-1", self.method)

    def test_plan_frozen_and_deterministic(self):
        registry, source, plan = self.setup_plan()
        self.assertEqual(plan.data, h.make_plan(self.context, self.bindings, self.risk))
        self.risk["metrics"][h.RISK_METRICS[0]][0] = 999
        self.assertNotEqual(plan.data["riskDigest"], h.digest(self.risk))
        with self.assertRaises(ValueError): registry.freeze_plan(source, self.context, self.bindings, self.risk)

    def test_candidate_fields_prohibited(self):
        for field in ("candidate", "mask", "support", "candidateDigest", "landmarks", "comparison"):
            risk = copy.deepcopy(self.risk); risk[field] = {}
            with self.assertRaises(ValueError): h.make_plan(self.context, self.bindings, risk)

    def test_nested_candidate_fields_cannot_reach_truth(self):
        for field in ("source", "roi", "range"):
            context = copy.deepcopy(self.context); context[field]["candidateDigest"] = "c" * 64
            with self.assertRaises(ValueError): h.make_plan(context, self.bindings, self.risk)
        bindings = copy.deepcopy(self.bindings); bindings[0]["candidateMask"] = {}
        with self.assertRaises(ValueError): h.make_plan(self.context, bindings, self.risk)
        self.record["source"]["candidateMask"] = {}
        with self.assertRaises(ValueError): h.Registry().register(self.record)

    def test_truth_has_no_candidate_digest(self):
        registry, _, plan = self.setup_plan(); truth = self.truth(plan)
        truth["candidateDigest"] = "b" * 64
        with self.assertRaises(ValueError): registry.freeze_truth(plan, truth, *self.declarations(truth))

    def test_reviewer_conflict(self):
        registry, _, plan = self.setup_plan(); truth = self.truth(plan); declarations = self.declarations(truth)
        path = Path(declarations[0]["path"]); d=json.loads(path.read_text()); d["didNotAuthorMaskAlgorithm"] = False; path.write_text(json.dumps(d))
        declarations[0]["sha256"] = h.file_sha(path)
        with self.assertRaisesRegex(ValueError, "REVIEWER_NOT_INDEPENDENT"): registry.freeze_truth(plan, truth, *declarations)

    def test_declaration_missing(self):
        registry, _, plan = self.setup_plan(); truth = self.truth(plan); declarations = self.declarations(truth)
        path = Path(declarations[0]["path"]); d=json.loads(path.read_text()); del d["didNotReceiveExpectedPixelHints"]; path.write_text(json.dumps(d)); declarations[0]["sha256"] = h.file_sha(path)
        with self.assertRaises(ValueError): registry.freeze_truth(plan, truth, *declarations)

    def test_unknown_truth(self):
        def edit(t):
            raw=bytes([1, 2]+[0]*14); t["frames"][0].update(labelsBase64=base64.b64encode(raw).decode(), truthSha256=h.sha(raw))
        result = self.compare(edit_truth=edit)
        self.assertEqual(result["status"], "SOURCE_INCOMPLETE")
        self.assertIsNone(result["metrics"]["missedRequiredPixels"])

    def test_one_pixel_miss(self):
        def edit(c):
            c["mask"].update(dataBase64=base64.b64encode(b"\x01\x00").decode(), sha256=h.sha(b"\x01\x00"), markedPixels=1)
        result = self.compare(edit_candidate=edit)
        self.assertEqual(result["status"], "SOURCE_NOT_QUALIFIED")
        self.assertEqual(result["metrics"]["missedRequiredPixels"], 4)

    def test_larger_candidate_reports_excess(self):
        def edit(c): c["mask"].update(dataBase64=base64.b64encode(b"\x07\x00").decode(), sha256=h.sha(b"\x07\x00"), markedPixels=3)
        result=self.compare(edit_candidate=edit)
        self.assertEqual(result["metrics"]["excessPixels"], 4)
        self.assertEqual(result["status"], "SOURCE_QUALIFIED")
        self.assertEqual(result["claim"], "ZERO_MISS_ON_FROZEN_TRUTH_SET")
        self.assertEqual(result["evidenceClass"], "CONTROLLED_TEST_NOT_REAL_QUALIFICATION")

    def test_wrong_source_target_pts(self):
        for field in ("sourceKey", "targetId"):
            with self.assertRaises(ValueError): self.compare(edit_candidate=lambda c: c["context"].update({field: "wrong"}))
        with self.assertRaises(ValueError): self.compare(edit_candidate=lambda c: c["bindings"][0].update(pts=9))

    def test_truth_changed_after_freeze(self):
        registry, source, plan=self.setup_plan(); truth=self.truth(plan); decl=self.declarations(truth); frozen=registry.freeze_truth(plan,truth,*decl)
        path=Path(decl[1]["path"]);path.write_text("changed truth QA")
        with self.assertRaises(ValueError): registry.compare(source,plan,frozen,self.candidate(source,plan))

    def test_source_changed(self):
        registry, source, plan=self.setup_plan();truth=self.truth(plan);frozen=registry.freeze_truth(plan,truth,*self.declarations(truth))
        self.source_path.write_bytes(b"changed")
        with self.assertRaises(ValueError): registry.compare(source,plan,frozen,self.candidate(source,plan))

    def test_candidate_version_changed(self):
        with self.assertRaises(ValueError): self.compare(edit_candidate=lambda c: c.update(methodDigest="b"*64))

    def test_incomplete_truth_frame(self):
        with self.assertRaises(ValueError): self.compare(edit_truth=lambda t: t["frames"].pop())

    def test_cancellation(self):
        registry, source, plan=self.setup_plan();truth=self.truth(plan);frozen=registry.freeze_truth(plan,truth,*self.declarations(truth))
        with self.assertRaises(InterruptedError): registry.compare(source,plan,frozen,self.candidate(source,plan),cancel=lambda: True)

    def test_json_clone_has_no_authority_or_handle(self):
        registry, source, plan=self.setup_plan();truth=self.truth(plan);frozen=registry.freeze_truth(plan,truth,*self.declarations(truth))
        clone=json.loads(json.dumps(frozen.data))
        self.assertEqual(clone["authority"], "none");self.assertFalse(clone["eligible"])
        with self.assertRaises(ValueError): registry.compare(source,plan,clone,self.candidate(source,plan))

    def test_wrong_truth_pixels_and_qa_digest(self):
        registry, _, plan=self.setup_plan();truth=self.truth(plan);decl=self.declarations(truth)
        truth["frames"][0]["truthSha256"]="f"*64
        with self.assertRaises(ValueError):registry.freeze_truth(plan,truth,*decl)

    def test_risk_budget_and_missing_category(self):
        del self.risk["metrics"][h.RISK_METRICS[0]]
        with self.assertRaises(ValueError):h.make_plan(self.context,self.bindings,self.risk)

    def test_full_geometry_required(self):
        for field,value in (("complete",False),("issues",1),("supportedMorphology",False)):
            result=self.compare(edit_candidate=lambda c:c["geometry"].update({field:value}))
            self.assertEqual(result["status"],"SOURCE_INCOMPLETE")

    def test_same_raw_identity_cannot_hide_in_different_group(self):
        registry, _, _ = self.setup_plan()
        other = copy.deepcopy(self.record); other.update(sourceId="source-2", independenceGroupId="group-2")
        path = self.root / "derived.bin"; path.write_bytes(b"different encoding")
        other["sourcePath"] = str(path)
        other["source"].update(fingerprint="sha256:" + h.file_sha(path), byteLength=path.stat().st_size)
        registry.register(other)
        with self.assertRaisesRegex(ValueError, "SAME_SOURCE"):
            registry.freeze_source("source-2", self.method)

    def test_late_development_exposure_invalidates_frozen_holdout(self):
        registry, source, _ = self.setup_plan()
        other = copy.deepcopy(self.record); other.update(sourceId="late-view", exposure="DEVELOPMENT_EXPOSED")
        registry.register(other)
        with self.assertRaisesRegex(ValueError, "later exposed"):
            registry._assert(source, "source")

    def test_same_author_and_qa_rejected(self):
        registry, _, plan = self.setup_plan(); truth = self.truth(plan); refs = self.declarations(truth)
        path = Path(refs[1]["path"]); value = json.loads(path.read_text()); value["reviewerId"] = "author"
        path.write_text(json.dumps(value)); refs[1]["sha256"] = h.file_sha(path)
        with self.assertRaisesRegex(ValueError, "REVIEWER_NOT_INDEPENDENT"):
            registry.freeze_truth(plan, truth, *refs)

    def test_real_metadata_and_json_parent_verdict_cannot_qualify(self):
        self.record["provenanceClass"] = "REAL_RECORDING"
        registry, source, plan = self.setup_plan(); truth = self.truth(plan); refs = self.declarations(truth)
        for ref in refs:
            path = Path(ref["path"]); value = json.loads(path.read_text()); value["evidenceClass"] = "ACTUAL_HUMAN_ATTESTATION"
            path.write_text(json.dumps(value)); ref["sha256"] = h.file_sha(path)
        frozen = registry.freeze_truth(plan, truth, *refs)
        result = registry.compare(source, plan, frozen, self.candidate(source, plan))
        self.assertEqual(result["status"], "SOURCE_INCOMPLETE")
        self.assertIsNone(result["metrics"]["missedRequiredPixels"])
        with self.assertRaises(ValueError):
            registry.accept_actual_evidence(source, frozen, {"accepted": True})
        with self.assertRaises(ValueError):
            registry.compare(source, plan, frozen, self.candidate(source, plan), actual_evidence={"accepted": True})

    def test_persisted_truth_comparison_and_immutable_result(self):
        tool_spec = importlib.util.spec_from_file_location("truth_tool", Path(__file__).parents[1] / "scripts/shape-cover-static-truth-tool.py")
        tool = importlib.util.module_from_spec(tool_spec); tool_spec.loader.exec_module(tool)
        registry, source, plan = self.setup_plan(); truth = self.truth(plan); refs = self.declarations(truth)
        raw = {"record": self.record, "method": self.method, "context": self.context, "bindings": self.bindings, "development": False}
        for name, data in (("prepare-input", raw), ("risk", self.risk),
                           ("freeze-digests", {"sourceDigest": source.digest, "planDigest": plan.digest}),
                           ("truth", truth), ("candidate", self.candidate(source, plan))):
            (self.root / (name + ".json")).write_text(h.encode(data))
        args = [self.root, self.root / "truth.json", refs[0]["path"], refs[1]["path"], self.root / "candidate.json", self.root / "result.json"]
        result = tool.compare_frozen(*args)
        self.assertEqual(result["evidenceClass"], "CONTROLLED_TEST_NOT_REAL_QUALIFICATION")
        self.assertEqual(result["metrics"]["requiredPixels"], 8)
        self.assertFalse(result["eligible"])
        with self.assertRaises(FileExistsError): tool.compare_frozen(*args)
        candidate = self.candidate(source, plan)
        candidate["mask"].update(dataBase64=base64.b64encode(b"\x07\x00").decode(), sha256=h.sha(b"\x07\x00"), markedPixels=3)
        (self.root / "candidate.json").write_text(h.encode(candidate))
        args[-1] = self.root / "changed-result.json"
        with self.assertRaisesRegex(ValueError, "FROZEN_CANDIDATE"):
            tool.compare_frozen(*args)

    def test_failed_holdout_cannot_be_repaired_with_new_candidate_bytes(self):
        registry, source, plan = self.setup_plan(); truth = self.truth(plan)
        frozen = registry.freeze_truth(plan, truth, *self.declarations(truth))
        candidate = self.candidate(source, plan)
        candidate["mask"].update(dataBase64=base64.b64encode(b"\x01\x00").decode(), sha256=h.sha(b"\x01\x00"), markedPixels=1)
        failed = registry.compare(source, plan, frozen, candidate)
        self.assertEqual(failed["status"], "SOURCE_NOT_QUALIFIED")
        with self.assertRaisesRegex(ValueError, "FROZEN_CANDIDATE"):
            registry.compare(source, plan, frozen, self.candidate(source, plan))


if __name__ == "__main__":
    unittest.main()
