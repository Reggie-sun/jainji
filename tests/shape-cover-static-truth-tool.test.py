import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("tool", Path(__file__).parents[1] / "scripts/shape-cover-static-truth-tool.py")
tool = importlib.util.module_from_spec(spec); spec.loader.exec_module(tool)
inventory = tool.load_module("inventory", "shape-cover-media-inventory.py")


class TruthToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.frame=np.zeros((12,12,4),np.uint8);self.frame[:]=[40,50,60,255];self.frame[3:9,3:9,:3]=[200,100,100]
        self.context={"source":{"width":12,"height":12,"fingerprint":"sha256:"+"a"*64,"timeBase":"1/1000","byteLength":1,"durationMs":300},
            "sourceKey":"controlled-source","targetId":"target","confirmationDigest":"b"*64,"roi":{"x":0,"y":0,"width":12,"height":12},"range":{"startFrame":0,"endFrame":300}}
        self.bindings=[{"index":i,"pts":i,"endPts":i+1,"byteLength":12*12*4,"pixelSha256":tool.h.sha(self.frame.tobytes())} for i in range(300)]
        self.risk={"contextDigest":tool.h.digest(self.context),"bindingsDigest":tool.h.digest(self.bindings),"complete":True,
            "metrics":{k:[float((i*7)%101) for i in range(300)] for k in tool.h.RISK_METRICS},"sceneCuts":[100],"visibilityAmbiguities":[230]}

    def plan(self):
        return tool.h.Frozen(tool.h.make_plan(self.context,self.bindings,self.risk),tool.h._TOKEN)

    def test_risk_extrema_scene_ambiguity_and_reserved(self):
        data=self.plan().data;ordinals=[b["index"] for b in data["bindings"]]
        self.assertTrue({0,299,99,100,101,229,230,231}.issubset(ordinals))
        self.assertLessEqual(len(ordinals),192)
        self.assertTrue(any("DETERMINISTIC_RESERVED" in reasons for reasons in data["selectionReasons"].values()))
        self.assertEqual(data,self.plan().data)

    def test_budget_cannot_discard_scene_context(self):
        self.risk["visibilityAmbiguities"]=list(range(300))
        with self.assertRaisesRegex(ValueError,"BUDGET"):self.plan()

    def test_background_cuts_stratified_before_human_review(self):
        self.risk["sceneCuts"]=list(range(300))
        plan=self.plan().data
        self.assertLessEqual(len(plan["bindings"]),192)
        self.assertTrue({"0","299"}.issubset(plan["selectionReasons"]))

    def test_package_contains_original_only(self):
        plan=self.plan();path=Path(self.tmp.name)/"review"
        result=tool.package(plan,{b["index"]:self.frame for b in plan.data["bindings"]},path)
        html=(path/"review.html").read_text()
        self.assertEqual(result["humanTruth"],"NOT_AUTHORED")
        for forbidden in ("candidateDigest","methodDigest","geometryOffset","selectionReasons","landmarks","dataBase64"):
            self.assertNotIn(forbidden,html)
        self.assertIn("new Uint8Array(w*h).fill(2)",html)
        self.assertIn("value!=='AUTHOR'",html)
        self.assertFalse((path/"human-truth-draft.json").exists())

    def test_wrong_original_pixel_and_cancel(self):
        plan=self.plan();frame=self.frame.copy();frame[0,0,0]+=1
        with self.assertRaises(ValueError):tool.package(plan,{b["index"]:frame for b in plan.data["bindings"]},Path(self.tmp.name)/"wrong")
        with self.assertRaises(InterruptedError):tool.package(plan,{},Path(self.tmp.name)/"cancel",lambda:True)

    def test_roi_observations_do_not_create_truth(self):
        metric,_=tool.roi_risk(self.frame,None,{"x":3,"y":3,"width":6,"height":6})
        self.assertEqual(set(metric),set(tool.h.RISK_METRICS[:7]))
        self.assertGreater(metric["edgeEnergy"],0)
        self.assertNotIn("requiredPixels",metric)

    def test_similarity_is_only_a_reuse_warning(self):
        left = {"sha256": "a" * 64, "samples": [{"dhash": 12345, "mean": 100, "std": 20}, {"dhash": 67890, "mean": 110, "std": 30}]}
        right = copy.deepcopy(left)
        self.assertEqual(inventory.similarity(left, right)["status"], "LIKELY_SAME_SOURCE")
        right["sha256"] = "b" * 64
        self.assertEqual(inventory.similarity(left, right)["status"], "LIKELY_DERIVED")
        for sample in right["samples"]: sample["std"] = 0
        result = inventory.similarity(left, right)
        self.assertEqual(result["status"], "NO_STRONG_MATCH")
        self.assertNotIn("independent", result)
        self.assertEqual(inventory.similarity(left, {"sha256": "c" * 64})["status"], "UNKNOWN")


if __name__=="__main__":unittest.main()
