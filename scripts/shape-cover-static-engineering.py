"""M2-F offline boundary engineering evidence; no source admission or product capability.

prepare input.json NEW-directory
finish package-directory observation.json-or-- NEW-receipt.json
One human may observe candidate-visible boundaries. Missing/ambiguous observations stay UNKNOWN.
"""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import resource
import subprocess
import sys
import time

import numpy as np
from PIL import Image


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


truth = load("m2f_comparator", "shape-cover-required-pixel-truth.py")
decoder = load("m2f_decoder", "shape-cover-static-anomalies.py")
geometry = load("m2f_geometry", "shape-cover-static-geometry.py")
risk_tool = load("m2f_roi_risk", "shape-cover-static-truth-tool.py")
require, digest, file_sha = truth.require, risk_tool.h.digest, truth.file_sha
CASES = ["opaque-irregular", "antialiased-contour", "alpha-1", "one-pixel-tip", "two-pixel-stroke", "holes",
         "disconnected-components", "light-on-light", "dark-on-dark", "chroma-heavy-edge", "corner-target", "edge-target",
         "changing-background", "high-motion-background", "scene-cut", "h264-reencode", "first-frame", "last-frame", "adverse-one-frame-edge"]
OBSERVATIONS = ("NO_VISIBLE_RESIDUAL_OBSERVED", "VISIBLE_RESIDUAL_OBSERVED", "UNKNOWN")
LIMITATIONS = ["Controlled construction alpha is exact; it is not real compressed-video alpha truth.",
              "Real development boundary review covers only the frozen finite risk set, not every frame's outline.",
              "Geometry supports only cpu-static-geometry-development/v2 sensitivity, not exact physical motion truth.",
              "Unbounded transparency, moving targets, unresolved components and clipped margins remain unsupported.",
              "No independent real-source qualification, source admission, knowledge issuance, M3 or production activation."]


def save(path, value):
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def metrics(required, candidate, bindings):
    """M2-D exact comparator reused; required is supplied by prior construction, never candidate."""
    roi = {"x": 0, "y": 0, "width": 128, "height": 96}
    context = {"source": {"width": 128, "height": 96}, "roi": roi,
               "range": {"startFrame": 0, "endFrame": len(bindings)}}
    rasters, frames = {}, []
    for binding, bitmap in zip(bindings, required):
        labels = truth.raster_mask(bitmap, roi).astype(np.uint8).tobytes()
        key = truth.sha(labels)
        rasters[key] = base64.b64encode(labels).decode()
        frames.append({"binding": binding, "truthSha256": key, "motion": "STATIC"})
    packet = {"method": "independent-required-pixel-packet/v1", "context": context, "scope": "CONTROLLED_CONSTRUCTION",
              "origin": "KNOWN_COMPOSITING_ALPHA", "authorId": "construction-recipe", "reviewerId": "m2d-exact-comparator",
              "boundaryReview": "BOUNDED", "provenance": [{"method": "construction-before-extraction", "sha256": digest(required)}],
              "rasters": rasters, "frames": frames}
    result = truth.compare(context, bindings, candidate, packet)
    m = result["metrics"]
    worst = max(result["frames"], key=lambda f: (f["knownMissedRequiredPixels"], -f["index"]))
    return {**m, "maxMissPerFrame": worst["knownMissedRequiredPixels"],
            "worstFrame": worst["index"] if m["missedRequiredPixels"] else None,
            "status": "CONTROLLED_EXACT_NOT_QUALIFIED" if m["missedRequiredPixels"] else "CONTROLLED_EXACT_ZERO_MISS"}


def controlled_corpus(root, engine):
    root = Path(root)
    frozen = truth.read_json(root / "method-freeze.json")
    execution = truth.read_json(root / "execution.json")
    require(frozen["cases"] == CASES and [c["kind"] for c in execution["cases"]] == CASES, "controlled cases incomplete")
    cases, paths, first = [], [root / "method-freeze.json", root / "execution.json"], None
    for kind in CASES:
        p = root / kind
        construction = truth.read_json(p / "construction-truth.json")
        recipe, required = construction["recipe"], construction["required"]
        require(recipe["kind"] == kind and len(required) == recipe["count"] == 30, "construction recipe/range")
        paths.append(p / "construction-truth.json")
        for f, expected in enumerate(required):
            alpha_path = p / f"alpha-{f}.bin"
            paths.append(alpha_path)
            alpha = np.frombuffer(alpha_path.read_bytes(), np.uint8)
            require(alpha.size == 128 * 96 and file_sha(alpha_path) == recipe["alphaDigests"][f], "construction alpha identity")
            require(np.array_equal(alpha.reshape(96, 128) > 0, truth.raster_mask(expected, {"x": 0, "y": 0, "width": 128, "height": 96})), "truth not construction alpha")
        if not (p / "candidate.json").exists():
            paths.append(p / "failure.json")
            cases.append({"kind": kind, "status": "CONTROLLED_INCOMPLETE", "reason": truth.read_json(p / "failure.json")["reason"]})
            continue
        candidate = truth.read_json(p / "candidate.json")
        receipt, roi = candidate["receipt"], candidate["roi"]
        paths.extend([p / "candidate.json", p / "source.mp4"])
        require(file_sha(p / "source.mp4") == candidate["source"]["fingerprint"].removeprefix("sha256:"), "controlled media changed")
        require(receipt["config"] == frozen["config"] and receipt["configDigest"] == frozen["configDigest"], "controlled config mismatch")
        body = {k: v for k, v in receipt.items() if k != "receiptDigest"}
        # TS hashes insertion-order JSON; preserve that serialization, not Python sorted-key JSON.
        require(truth.sha(json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()) == receipt["receiptDigest"], "candidate receipt digest")
        # Independently decode the whole small controlled canvas. Required pixels outside
        # the extractor ROI must remain in the denominator; never crop truth to candidate.
        require(file_sha(engine) == frozen["engineDigest"], "controlled comparison engine changed")
        decoded = subprocess.run([engine, "-v", "error", "-nostdin", "-xerror", "-threads", "1", "-noautorotate", "-i", str(p / "source.mp4"),
                                  "-map", "0:v:0", "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-threads", "1",
                                  "-f", "rawvideo", "pipe:1"], capture_output=True, timeout=20, check=True).stdout
        require(len(decoded) == 128 * 96 * 4 * 30, "controlled independent full decode extent")
        bindings = []
        for b in receipt["frames"]:
            frame = decoded[b["index"] * 128 * 96 * 4:(b["index"] + 1) * 128 * 96 * 4]
            original = np.frombuffer(frame, np.uint8).reshape(96, 128, 4)
            crop = original[roi["y"]:roi["y"] + roi["height"], roi["x"]:roi["x"] + roi["width"]].tobytes()
            require(truth.sha(crop) == b["pixelSha256"] and len(crop) == b["byteLength"], "controlled original ROI binding")
            bindings.append({**b, "byteLength": len(frame), "pixelSha256": truth.sha(frame)})
        require(len(bindings) == 30 and receipt["range"] == {"startFrame": 0, "endFrame": 30}, "controlled full range")
        if receipt["mask"] is None:
            cases.append({"kind": kind, "status": "CONTROLLED_INCOMPLETE", "reason": receipt["reasons"]})
            continue
        m = metrics(required, receipt["mask"], bindings)
        cases.append({"kind": kind, **m, "extractorAppearanceStatus": receipt["status"], "roi": roi, "fullOriginalBindings": bindings,
                      "truthDigest": file_sha(p / "construction-truth.json"), "candidateDigest": receipt["receiptDigest"]})
        if first is None:
            first = (required, receipt["mask"], bindings)
    negative = None
    if first:
        required, candidate, bindings = first
        # Exactly one required pixel in exactly one frame. Keep construction truth unchanged.
        raster = truth.raster_mask(candidate, {"x": 0, "y": 0, "width": 128, "height": 96})
        required_raster = truth.raster_mask(required[0], {"x": 0, "y": 0, "width": 128, "height": 96})
        y, x = np.argwhere(raster & required_raster)[0]
        raster[y, x] = False
        box = candidate["bbox"]
        cropped = raster[box["y"]:box["y"] + box["height"], box["x"]:box["x"] + box["width"]]
        raw = np.packbits(cropped.ravel(), bitorder="little").tobytes()
        missing = {**candidate, "dataBase64": base64.b64encode(raw).decode(), "sha256": truth.sha(raw), "markedPixels": int(raster.sum())}
        negative = {"kind": "intentional-exactly-one-required-pixel-miss", "sourceXY": [int(x), int(y)],
                    **metrics(required[:1], missing, bindings[:1])}
    complete = all("requiredPixels" in c for c in cases)
    names = ("requiredPixels", "missedRequiredPixels", "missingRequiredFrames", "excessPixels", "comparedFrames")
    totals = {k: sum(c[k] for c in cases) if complete else None for k in names}
    return {"version": "static-exact-alpha-corpus/v1", "cases": cases, "complete": complete, "metrics": totals,
            "negative": negative, "digest": digest({str(p.relative_to(root)): file_sha(p) for p in paths}),
            "methodFreeze": frozen, "runtimeMs": execution["runtimeMs"], "peakRssBytes": execution["peakRssBytes"]}, paths


def signature(frame, box):
    """Exact set of risk classes: 2x2 spatial sector, support depth 1..3/interior, violated RGB channels.

    Not exact pixel-truth, nor a causal grouping. No signature discarded to meet the frame budget.
    """
    return sorted({(min(1, (p["x"] - box["x"]) * 2 // box["width"]),
                    min(1, (p["y"] - box["y"]) * 2 // box["height"]), min(p["supportBoundaryDistance"], 4),
                    sum(1 << c for c, v in enumerate(p["channelExceedance"]) if v > 24)) for p in frame["pixels"]})


def review_set(bindings, anomalies, geometry_frames, risk, box):
    n = len(bindings)
    require(n == 6990 and len(geometry_frames) == n and risk["complete"] is True, "review evidence incomplete")
    reasons = {}
    def add(i, reason):
        require(type(i) is int and 0 <= i < n, "risk ordinal")
        reasons.setdefault(i, set()).add(reason)
    for i, label in [(0, "first"), (n - 1, "last"), (233, "historical-first-anomaly"), (710, "historical-strong-count"),
                     (715, "historical-strong-difference"), (3764, "historical-last-anomaly")]:
        add(i, label)
    bad = {a["index"] for a in anomalies}
    normal = [i for i in range(n) if i not in bad]
    for fraction in (0.25, 0.5, 0.75):
        add(normal[round((len(normal) - 1) * fraction)], "representative-normal")
    grouped = {}
    for a in anomalies:
        grouped.setdefault(digest(signature(a, box)), []).append(a)
    for key, group in sorted(grouped.items()):
        a = max(group, key=lambda f: (f["worstDifference"], f["changedSupportPixels"], -f["index"]))
        add(a["index"], "anomaly-signature:" + key)
    for key in ("worstDifference", "changedSupportPixels"):
        add(max(anomalies, key=lambda a: (a[key], -a["index"]))["index"], "strongest:" + key)
    for key, values in sorted(risk["metrics"].items()):
        require(len(values) == n and np.isfinite(values).all(), "risk metric incomplete")
        # earliest tie, fixed before any boundary observation
        add(min(range(n), key=lambda i: (values[i], i)), key + ":minimum")
        add(max(range(n), key=lambda i: (values[i], -i)), key + ":maximum")
    for cell in range(9):
        for axis in range(2):
            values = [g["cells"][cell]["offset"][axis] for g in geometry_frames]
            add(min(range(n), key=lambda i: (values[i], i)), f"cell{cell}-axis{axis}:minimum-offset")
            add(max(range(n), key=lambda i: (values[i], -i)), f"cell{cell}-axis{axis}:maximum-offset")
    cuts = sorted(set(risk["sceneCuts"]))
    for fraction in (0, 0.5, 1):
        if cuts:
            index = cuts[round((len(cuts) - 1) * fraction)]
            for delta in (-1, 0, 1):
                if 0 <= index + delta < n:
                    add(index + delta, f"scene-context:{index}")
    for i in risk["visibilityAmbiguities"]:
        for delta in (-1, 0, 1):
            if 0 <= i + delta < n:
                add(i + delta, "geometry-visibility-ambiguity")
    require(len(reasons) <= 128, "distinct risk coverage exceeds finite 128-frame budget; do not truncate")
    frames = [{"binding": bindings[i], "reasons": sorted(reasons[i])} for i in sorted(reasons)]
    return {"version": "static-boundary-risk-set/v1", "frames": frames, "complete": True,
            "distinctAnomalySignatures": len(grouped), "anomalySignatureDefinition": "2x2 sector + support depth 1..3/interior + RGB violated-channel bitset; exact set",
            "sceneContexts": "first/median/last of frozen scene inventory, +/-1; not every scene cut",
            "budgetExplanation": "All distinct risk signatures and frozen extrema retained; exceeds preferred32 if needed; no adaptive truncation",
            "riskDigest": digest(risk), "geometryFramesDigest": digest(geometry_frames), "fullBindingsDigest": digest(bindings)}


def observation(review, submitted):
    if submitted is None:
        return "UNKNOWN", {"reviewerId": None, "frames": [], "reason": "ACTUAL_ENGINEERING_REVIEW_NOT_COMPLETED"}
    require(submitted["schema"] == "static-boundary-observation/v1" and submitted["reviewSetDigest"] == digest(review), "review-set digest changed")
    require(isinstance(submitted["reviewerId"], str) and submitted["reviewerId"].strip()
            and submitted["reviewerKind"] == "HUMAN_ENGINEERING_REVIEWER"
            and submitted["question"] == "当前mask外，是否能看到明显属于旧贴纸的视觉贡献？", "actual engineering reviewer declaration")
    expected = [f["binding"]["index"] for f in review["frames"]]
    if submitted.get("scope") == "FROZEN_REVIEW_SET":
        # A real human may give one aggregate answer to the exact frozen package.
        # Preserve that answer; never fabricate independent per-frame answers from it.
        require(submitted["observation"] in OBSERVATIONS and isinstance(submitted["originalResponse"], str)
                and submitted["originalResponse"].strip() and submitted.get("provenance") == "ACTUAL_USER_MESSAGE"
                and submitted["reviewedOrdinals"] == expected, "frozen-set human observation incomplete")
        return submitted["observation"], copy.deepcopy(submitted)
    require([f["ordinal"] for f in submitted["frames"]] == expected, "review frames incomplete or unordered")
    require(all(f["observation"] in OBSERVATIONS for f in submitted["frames"]), "observation enum")
    answers = [f["observation"] for f in submitted["frames"]]
    return ("VISIBLE_RESIDUAL_OBSERVED" if "VISIBLE_RESIDUAL_OBSERVED" in answers else "UNKNOWN" if "UNKNOWN" in answers
            else "NO_VISIBLE_RESIDUAL_OBSERVED"), copy.deepcopy(submitted)


def decide(controlled, checks, review, observed):
    rejected, incomplete = [], []
    for key in ("sourceChanged", "maskChanged", "configChanged", "geometryContradiction"):
        if checks.get(key) is True:
            rejected.append(key)
    for key in ("sourceFresh", "methodFresh", "geometryFresh", "reviewSetFresh", "corpusFresh"):
        if checks.get(key) is not True:
            incomplete.append(key)
    if not controlled.get("complete"):
        incomplete.append("CONTROLLED_CORPUS_INCOMPLETE")
    else:
        m = controlled["metrics"]
        if m["missedRequiredPixels"] != 0 or m["missingRequiredFrames"] != 0:
            rejected.append("CONTROLLED_EXACT_NOT_QUALIFIED")
    negative = controlled.get("negative")
    if not negative or negative.get("missedRequiredPixels") != 1 or negative.get("missingRequiredFrames") != 1 or negative.get("status") != "CONTROLLED_EXACT_NOT_QUALIFIED":
        incomplete.append("INTENTIONAL_ONE_PIXEL_NEGATIVE_NOT_VERIFIED")
    if not review.get("complete"):
        incomplete.append("REVIEW_SET_INCOMPLETE")
    if observed == "VISIBLE_RESIDUAL_OBSERVED":
        rejected.append(observed)
    elif observed != "NO_VISIBLE_RESIDUAL_OBSERVED":
        incomplete.append("REVIEW_UNKNOWN")
    status = "ENGINEERING_REJECTED" if rejected else "ENGINEERING_INCOMPLETE" if incomplete else "ENGINEERING_ACCEPTED"
    claims = ["CONTROLLED_EXACT_ZERO_MISS", "REAL_DEVELOPMENT_NO_VISIBLE_RESIDUAL_ON_FROZEN_RISK_SET",
              "FULL_RANGE_GEOMETRY_SUPPORTED_WITHIN_V2_LIMITS"] if status == "ENGINEERING_ACCEPTED" else []
    return {"schema": "StaticMaskEngineeringEvidence/v1", "status": status, "authority": "none", "eligible": False,
            "claims": claims, "reasons": rejected + incomplete, "limitations": LIMITATIONS,
            "historicalAppearanceCriterion": "REJECTED", "historicalAppearanceDecision": "FULL_RANGE_STATIC_CONTRADICTION",
            "historicalAppearanceMeaning": "RGB sample-envelope, not geometry acceptance owner; not used as sole static decision criterion; cause not qualified",
            "product": "PRODUCT_DISABLED", "m2ProductProof": "NOT_ISSUED", "m3": "BLOCKED", "modelRequests": 0}


def package_frames(root, review, mask, images):
    assets = []
    for item in review["frames"]:
        b = item["binding"]
        rgb = images[b["index"]][..., :3]
        boundary = mask & ~geometry.cv2.erode(mask.astype(np.uint8), np.ones((3, 3), np.uint8), borderType=geometry.cv2.BORDER_CONSTANT, borderValue=0).astype(bool)
        overlay = rgb.copy()
        overlay[boundary] = [255, 0, 255]
        label = np.empty_like(rgb)
        label[mask], label[~mask] = [30, 180, 220], [70, 70, 70]
        names = {}
        for name, pixels in (("original", rgb), ("boundary", overlay), ("inside-outside", label)):
            filename = f"{b['index']}-{name}.png"
            Image.fromarray(pixels).save(root / filename)
            names[name] = filename
            assets.append(root / filename)
        filename = f"{b['index']}-edge-nearest.png"
        pair = np.concatenate([rgb, overlay], axis=1)
        Image.fromarray(pair).resize((pair.shape[1] * 6, pair.shape[0] * 6), Image.Resampling.NEAREST).save(root / filename)
        assets.append(root / filename)
        item["images"] = {**names, "edge": filename}
    return assets


def write_html(root, review):
    # A local static form; default UNKNOWN and no bulk acceptance or preselected positive answer.
    package = json.dumps(review, ensure_ascii=False).replace("<", "\\u003c")
    review_digest = digest(review)
    html = '''<!doctype html><meta charset="utf-8"><title>M2-F Boundary Engineering Review</title>
<style>body{font:16px sans-serif;margin:24px}img{image-rendering:pixelated;max-width:none}section{border-bottom:1px solid #888;padding:16px 0}label{display:block;margin:10px}select,input{padding:6px}</style>
<h1>M2-F Boundary Engineering Review</h1><p>当前mask外，是否能看到明显属于旧贴纸的视觉贡献？</p>
<p>只作边界工程观察；不恢复alpha、不标ground truth、不判断qualification或production。AA/透明/归属有歧义请选择UNKNOWN。紫色表示内部边界；蓝色表示mask内部，灰色表示外部。Original保持1:1；edge为6倍nearest-neighbor。</p>
<label>真人engineering reviewerId <input id="reviewer" maxlength="160"></label><div id="frames"></div><button id="save">保存逐帧观察JSON</button><p id="status"></p><script>
const review=__REVIEW__, digest=__DIGEST__;
const answers=review.frames.map(f=>({ordinal:f.binding.index,observation:"UNKNOWN"}));
for(const [i,f] of review.frames.entries()){
 const s=document.createElement('section'),title=document.createElement('p');
 title.textContent=`ordinal ${f.binding.index}; PTS ${f.binding.pts}; ${f.reasons.join(', ')}`;s.append(title);
 for(const k of ['original','boundary','inside-outside','edge']){const p=document.createElement('p');p.textContent=k;const im=document.createElement('img');im.src=f.images[k];s.append(p,im);}
 const select=document.createElement('select');for(const v of ['UNKNOWN','NO_VISIBLE_RESIDUAL_OBSERVED','VISIBLE_RESIDUAL_OBSERVED']){const o=document.createElement('option');o.value=o.textContent=v;select.append(o);}
 select.onchange=()=>answers[i].observation=select.value;s.append(select);document.querySelector('#frames').append(s);
}
document.querySelector('#save').onclick=()=>{const reviewerId=document.querySelector('#reviewer').value.trim();if(!reviewerId){document.querySelector('#status').textContent='请输入实际真人reviewerId';return;}
const value={schema:'static-boundary-observation/v1',reviewSetDigest:digest,reviewerId,reviewerKind:'HUMAN_ENGINEERING_REVIEWER',question:'当前mask外，是否能看到明显属于旧贴纸的视觉贡献？',frames:answers};
const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));a.href=url;a.download='m2f-boundary-observation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
</script>'''.replace("__REVIEW__", package).replace("__DIGEST__", json.dumps(review_digest))
    (root / "review.html").write_text(html)


def prepare(raw, output):
    started = time.monotonic()
    output = Path(output)
    output.mkdir(mode=0o700, exist_ok=False)
    repo = Path(__file__).resolve().parents[1]
    inp, discovery_path, previous, anomaly_root, geo_root, risk_root, corpus_root, engine = [Path(raw[k]) for k in
        ("input", "discovery", "candidateDirectory", "anomalyDirectory", "geometryDirectory", "developmentRiskDirectory", "controlledDirectory", "engine")]
    input_doc, discovery = truth.read_json(inp), truth.read_json(discovery_path)["evidence"]
    candidate = truth.read_json(previous / "candidate.json")["receipt"]
    target, confirmation, freeze = [truth.read_json(previous / p) for p in ("target-evidence.json", "confirmation.json", "method-freeze.json")]
    roi, bindings = geometry.validate_history(input_doc, discovery, candidate, confirmation, target, freeze)
    require(candidate["mask"]["sha256"] == truth.MASK_SHA, "frozen real mask")
    gr, gf, gm = [truth.read_json(geo_root / p) for p in ("result.json", "frames.json", "method-freeze.json")]
    require(gr["receiptDigest"] == geometry.digest({k: v for k, v in gr.items() if k != "receiptDigest"})
            and gr["frameMetricsDigest"] == geometry.digest(gf) and gr["configDigest"] == geometry.digest(geometry.CONFIG)
            and gm["config"] == geometry.CONFIG and gm["dependencies"] == {"numpy": np.__version__, "opencv": geometry.cv2.__version__}, "stale geometry receipt/method")
    require(gr["range"] == candidate["range"] and gr["sourceKey"] == confirmation["sourceKey"] and gr["targetId"] == candidate["targetId"]
            and gr["oldMaskSha256"] == truth.MASK_SHA and gr["frames"] == 6990, "geometry binding")
    require(all(all(g[k] == b[k] for k in b) for g, b in zip(gf, bindings)) and len(gf) == len(bindings), "geometry canonical clock/ROI binding")
    paths = [inp, discovery_path, engine, Path(input_doc["sourcePath"]), Path(__file__), Path(truth.__file__), Path(risk_tool.__file__), Path(risk_tool.h.__file__)]
    paths += [repo / p for p in ("src/main/source-fact-census-clock.ts", "src/main/source-fact-discovery-evidence.ts",
              "src/main/shape-cover-stationary-discovery.ts", "src/main/source-sticker-knowledge-store.ts", "src/main/paths.ts")]
    paths += list(previous.glob("*.json")) + [anomaly_root / p for p in ("result.json", "anomalies.json")]
    paths += [geo_root / p for p in ("result.json", "frames.json", "method-freeze.json", "landmark-reference.json", "issues.json")]
    paths += [risk_root / p for p in ("risk.json", "plan.json", "prepare-input.json")]
    method_paths = truth.read_json(previous / "engineering/method-source-freeze.json")
    require(all(file_sha(repo / p) == expected for p, expected in method_paths.items()), "M2-A method changed")
    require(all(file_sha(Path(p)) == expected for p, expected in gm["files"].items()), "M2-C source/engine/artifact/method changed")
    controlled, cpaths = controlled_corpus(corpus_root, engine)
    paths += cpaths + [repo / p for p in controlled["methodFreeze"]["methods"]] + [repo / p for p in method_paths]
    require(all(file_sha(repo / p) == expected for p, expected in controlled["methodFreeze"]["methods"].items()), "controlled method changed")
    pinned = {str(p): file_sha(p) for p in paths}
    require(pinned[str(Path(input_doc["sourcePath"]))] == input_doc["source"]["fingerprint"].removeprefix("sha256:")
            and Path(input_doc["sourcePath"]).stat().st_size == input_doc["source"]["byteLength"], "source changed")
    require(pinned[str(engine)] == discovery["decode"]["ffmpegFingerprint"].removeprefix("sha256:") == controlled["methodFreeze"]["engineDigest"], "engine changed")
    anomalies, br = truth.read_json(anomaly_root / "anomalies.json"), truth.read_json(anomaly_root / "result.json")
    require(len(anomalies) == br["anomalyFrames"] == 133 and br["contiguousAnomalyRuns"] == 61
            and br["changedPixelOccurrences"] == 506 and [{k: a[k] for k in ("index", "reason", "changedSupportPixels", "worstDifference")} for a in anomalies] == candidate["anomalies"], "old RGB contradiction reference changed")
    risk, plan, risk_input = [truth.read_json(risk_root / p) for p in ("risk.json", "plan.json", "prepare-input.json")]
    context = {"source": input_doc["source"], "sourceKey": confirmation["sourceKey"], "targetId": candidate["targetId"],
               "confirmationDigest": confirmation["confirmationDigest"], "roi": roi, "range": candidate["range"]}
    require(risk["contextDigest"] == digest(context) and risk["bindingsDigest"] == digest(bindings)
            and plan["riskDigest"] == digest(risk) and risk_input["bindings"] == bindings and risk_input["geometryFrames"] == gf, "development risk provenance")
    review = review_set(bindings, anomalies, gf, risk, candidate["mask"]["bbox"])
    keep, images, previous_rgb, count = {f["binding"]["index"] for f in review["frames"]}, {}, None, 0
    def consume(frame, binding):
        nonlocal previous_rgb, count
        observed, previous_rgb = risk_tool.roi_risk(frame, previous_rgb, risk_input["targetBox"])
        require(all(observed[k] == risk["metrics"][k][count] for k in observed), "real original risk metrics changed")
        if binding["index"] in keep:
            images[binding["index"]] = frame.copy()
        count += 1
    decoder.decode(input_doc["sourcePath"], engine, roi, bindings, input_doc["source"]["timeBase"], consume, started + 300)
    require(count == 6990 and set(images) == keep, "real full range/review decode incomplete")
    mask = truth.raster_mask(candidate["mask"], roi)
    assets = package_frames(output, review, mask, images)
    review.update(context=context, maskSha256=truth.MASK_SHA, geometryReceiptDigest=gr["receiptDigest"],
                  assetDigests={p.name: file_sha(p) for p in assets})
    save(output / "review-set.json", review)
    write_html(output, review)
    save(output / "controlled-result.json", controlled)
    checks = {"sourceFresh": True, "methodFresh": True, "geometryFresh": True, "reviewSetFresh": True, "corpusFresh": True,
              "sourceChanged": False, "maskChanged": False, "configChanged": False,
              "geometryContradiction": gr["geometricIssueFrames"] != 0 or gr["status"] != "DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED"}
    require(all(file_sha(p) == expected for p, expected in pinned.items()), "inputs changed during execution")
    base = {"context": context, "sourceUsage": "DEVELOPMENT SOURCE", "candidateMaskDigest": truth.MASK_SHA, "candidateMask": candidate["mask"],
            "identityRefs": {"source": input_doc["sourcePath"], "input": str(inp), "candidate": str(previous / "candidate.json"),
                             "geometry": [str(geo_root / p) for p in ("result.json", "frames.json", "method-freeze.json", "landmark-reference.json", "issues.json")],
                             "corpus": [str(p) for p in cpaths]},
            "detector": {"method": discovery["method"], "sourceDigest": file_sha(repo / "src/main/shape-cover-stationary-discovery.ts")},
            "extractor": {"method": candidate["method"], "config": candidate["config"], "configDigest": candidate["configDigest"],
                          "sourceDigest": method_paths["src/main/source-mask-static-extraction.ts"]},
            "controlledCorpus": controlled, "geometryReceiptDigest": gr["receiptDigest"], "geometryStatus": gr["status"],
            "reviewSetDigest": digest(review), "reviewFrameCount": len(review["frames"]),
            "oldRgbReferences": {"M2A": pinned[str(previous / "candidate.json")], "M2B": pinned[str(anomaly_root / "result.json")],
                                 "anomalyFrames": 133, "clusters": 61, "violations": 506, "cause": "NOT_QUALIFIED"},
            "inputFreeze": pinned, "checks": checks, "performance": {"packageBuildSeconds": time.monotonic() - started,
              "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
              "artifactBytes": sum(p.stat().st_size for p in output.iterdir()), "realDecodedFrames": count}}
    save(output / "package.json", base)
    save(output / "package-freeze.json", {p: file_sha(output / p) for p in ("package.json", "review-set.json", "controlled-result.json", "review.html")})
    finish(output, None, output / "initial-receipt.json")
    return {"reviewFrameCount": len(review["frames"]), "distinctAnomalySignatures": review["distinctAnomalySignatures"], "reviewSetDigest": digest(review)}


def finish(root, submitted, output):
    root = Path(root)
    base, review = truth.read_json(root / "package.json"), truth.read_json(root / "review-set.json")
    checks = copy.deepcopy(base["checks"])
    # Current bytes, not caller's fresh booleans or JSON capabilities, govern reuse.
    for path, expected in base["inputFreeze"].items():
        if not Path(path).is_file() or file_sha(path) != expected:
            checks["methodFresh"] = False
            if path in base["identityRefs"]["geometry"]:
                checks["geometryFresh"] = False
            if path in base["identityRefs"]["corpus"]:
                checks["corpusFresh"] = False
    try:
        current = truth.read_json(base["identityRefs"]["candidate"])["receipt"]
        checks["maskChanged"] = current["mask"] != base["candidateMask"] or current["mask"]["sha256"] != base["candidateMaskDigest"]
        # Recompute mask bytes/count before trusting a claimed digest.
        truth.raster_mask(current["mask"], base["context"]["roi"])
        checks["configChanged"] = current["config"] != base["extractor"]["config"] or current["configDigest"] != base["extractor"]["configDigest"] or current["range"] != base["context"]["range"]
        checks["sourceChanged"] = truth.read_json(base["identityRefs"]["input"])["source"] != base["context"]["source"]
    except (ValueError, KeyError, TypeError, OSError):
        checks["methodFresh"] = False
        checks["maskChanged"] = True
    source = base["context"]["source"]
    source_path = Path(base["identityRefs"]["source"])
    checks["sourceFresh"] = source_path.is_file()
    checks["sourceChanged"] |= checks["sourceFresh"] and (file_sha(source_path) != source["fingerprint"].removeprefix("sha256:") or source_path.stat().st_size != source["byteLength"])
    checks["reviewSetFresh"] = digest(review) == base["reviewSetDigest"] and all((root / name).is_file() and file_sha(root / name) == expected
        for name, expected in review["assetDigests"].items())
    package_freeze = truth.read_json(root / "package-freeze.json")
    if not all((root / name).is_file() and file_sha(root / name) == expected for name, expected in package_freeze.items()):
        checks["reviewSetFresh"] = False
        checks["corpusFresh"] = False
    try:
        observed, actual = observation(review, submitted)
    except (ValueError, KeyError, TypeError) as error:
        observed, actual = "UNKNOWN", {"reviewerId": None, "frames": [], "reason": str(error)}
        checks["reviewSetFresh"] = False
    result = {**base, **decide(base["controlledCorpus"], checks, review, observed), "checks": checks,
              "realReviewObservation": observed, "actualEngineeringReview": actual}
    result["receiptDigest"] = digest(result)
    save(output, result)
    return result


if __name__ == "__main__":
    if sys.argv[1] == "prepare" and len(sys.argv) == 4:
        print(json.dumps(prepare(truth.read_json(sys.argv[2]), sys.argv[3])))
    elif sys.argv[1] == "finish" and len(sys.argv) == 5:
        result = finish(sys.argv[2], None if sys.argv[3] == "-" else truth.read_json(sys.argv[3]), sys.argv[4])
        print(json.dumps({k: result[k] for k in ("status", "realReviewObservation", "receiptDigest", "reasons")}))
    else:
        raise ValueError("Expected prepare input NEW-directory | finish package observation-or-- NEW-receipt")
