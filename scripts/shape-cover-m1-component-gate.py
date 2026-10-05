"""HC4 prerequisite: only HC3 internal-pairs on previously frozen actual M1 support.

No production geometry owner or proof issuance. Full source/ROI pixel bindings
are provided by canonical application evidence before this offline computation.
"""
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np

spec = importlib.util.spec_from_file_location("hc3", Path(__file__).with_name("shape-cover-component-observability.py"))
hc3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hc3)


def run(root):
    frozen = json.loads((root/"freeze.json").read_text())
    assert hashlib.sha256((root/"frames.rgba").read_bytes()).hexdigest() == frozen["frameBytesSha256"]
    assert hashlib.sha256(Path(__file__).with_name("shape-cover-component-observability.py").read_bytes()).hexdigest() == frozen["methodSha256"]
    assert hashlib.sha256(hc3.METHOD_FILE.read_bytes()).hexdigest() == frozen["parametersSha256"]
    frames = np.fromfile(root/"frames.rgba", np.uint8).reshape(frozen["frameCount"], frozen["roi"]["height"], frozen["roi"]["width"], 4)
    params = json.loads(hc3.METHOD_FILE.read_text())["parameterGrid"]
    results = []
    for component in frozen["components"]:
        support = hc3.support_kernel.support_raster(component["support"], frozen["roi"])
        t = time.perf_counter()
        model, count = hc3.independent_reference(frames[frozen["representativeOrdinals"]], support, "internal-pairs", params)
        build_ms = (time.perf_counter()-t)*1000
        observations = []
        t = time.perf_counter()
        if model is not None:
            for f in frames:
                try:
                    r = hc3.independent_measure(f, model, params["independentAlignment"])
                    observations.append({**r, "status": "ISSUE" if r["reasons"] else "SUPPORTED"})
                except ValueError as error:
                    observations.append({"status":"ISSUE", "reasons":["UNRESOLVED_SEARCH"], "detail":str(error)})
        measure_ms = (time.perf_counter()-t)*1000
        results.append({"candidateId":component["candidateId"], "supportDigest":component["support"]["supportDigest"],
            "markedCells":component["support"]["markedCells"], "pairCount":count,
            "status":"UNOBSERVABLE" if model is None else "ISSUE" if any(o["status"] == "ISSUE" for o in observations) else "SUPPORTED",
            "issueFrames":[i for i,o in enumerate(observations) if o["status"] == "ISSUE"],
            "referenceBuildMs":build_ms, "perFrameMeasureMs":measure_ms/len(frames),
            "workingBytes":sum(v.nbytes for v in model.values() if isinstance(v,np.ndarray)) if model else 0,
            "observations": observations})
    status = "UNOBSERVABLE" if any(r["status"] == "UNOBSERVABLE" for r in results) else "ISSUE" if any(r["status"] == "ISSUE" for r in results) else "SUPPORTED"
    return {"method":"hc4-actual-m1-prerequisite/v1", "authority":"none", "status":status, "components":results}


if __name__ == "__main__":
    if sys.argv[1] == "--summary":
        root = Path(sys.argv[2])
        manifest = json.loads((Path(__file__).resolve().parents[1]/"tests/fixtures/static-m1-components/manifest.json").read_text())
        cases = []
        for entry in manifest["cases"]:
            directory = root/entry["name"]
            blocked = directory/"blocked.json"
            result = directory/"result.json"
            if blocked.exists():
                cases.append({"name":entry["name"], **json.loads(blocked.read_text())})
            elif result.exists():
                measured = json.loads(result.read_text())
                cases.append({"name":entry["name"], "status":measured["status"],
                              "accepted":measured["status"] == entry["expected"]})
            else:
                cases.append({"name":entry["name"], "status":"NOT_EVALUATED", "accepted":False})
        closed = all(c.get("accepted",False) for c in cases)
        json.dump({"gate":"HC4_ACTUAL_M1_PREREQUISITE", "status":"PASS" if closed else "BLOCKED", "cases":cases},sys.stdout,allow_nan=False,indent=2)
        sys.exit(0 if closed else 1)
    json.dump(run(Path(sys.argv[1])),sys.stdout,allow_nan=False)
