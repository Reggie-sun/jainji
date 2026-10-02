"""M2-C CPU geometry development. RGB envelopes and masks are not geometry truth.

CLI: M1-input.json M1-result.json M2-A-directory NEW-directory application-ffmpeg
Uses development-host NumPy/OpenCV/Pillow; no product dependency or authority.
"""
import base64
import importlib.util
import json
from pathlib import Path
import resource
import signal
import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw

_spec = importlib.util.spec_from_file_location("static_anomalies", Path(__file__).with_name("shape-cover-static-anomalies.py"))
replay = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(replay)
require, sha, file_sha, save = replay.require, replay.sha, replay.file_sha, replay.save

# Frozen on controlled development before real-range observation; independent of old tolerance=24.
CONFIG = {
    "method": "cpu-static-geometry-development/v2", "gaussianSigma": 0.6,
    "minimumGradient": 8.0, "sampleDirectionCosine": 0.9, "sampleConsensus": 0.9,
    "sampleStrengthRatio": [0.5, 2.0], "grid": [3, 3], "landmarksPerCell": 48,
    "minimumLandmarksPerCell": 8, "minimumCells": 6, "minimumSpatialSpan": 0.5,
    "searchRadius": 4, "localSearchRadius": 2, "subpixelStep": 0.25,
    "maximumOffset": 0.5, "maximumLocalOffset": 0.75,
    "minimumCorrelation": 0.9, "minimumCellCorrelation": 0.8,
    "ambiguityDistance": 1.5, "ambiguityCorrelationGap": 0.02,
    "landmarkPresenceRatio": 0.35, "maximumLostFraction": 0.15,
    "energyRatio": [0.45, 2.25], "boxPadding": 3,
}
LIMITS = {"wallSeconds": 300, "roiSide": 512, "frames": 20000,
          "representatives": 96, "workingBytes": 512 * 1024 ** 2, "artifactBytes": 64 * 1024 ** 2,
          "modelBytesPerSamplePixel": 96, "receiptWorkingReserveBytes": 256 * 1024 ** 2}


def digest(value):
    return sha(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode())


def gradients(frame):
    require(frame.ndim == 3 and frame.shape[2] == 4 and frame.dtype == np.uint8, "RGBA extent/type")
    gray = frame[..., :3].astype(np.float64) @ np.array([0.299, 0.587, 0.114])
    gray = cv2.GaussianBlur(gray, (5, 5), CONFIG["gaussianSigma"], borderType=cv2.BORDER_REFLECT_101)
    return np.stack([cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3, scale=0.125),
                     cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3, scale=0.125)], axis=-1)


def build_model(samples, box):
    """Landmarks from persistent gradient vectors, never M2-A mask/support/min/max."""
    require(samples.ndim == 4 and 3 <= len(samples) <= LIMITS["representatives"], "representative extent/count")
    height, width = samples.shape[1:3]
    require(max(width, height) <= LIMITS["roiSide"]
            and height * width * len(samples) * LIMITS["modelBytesPerSamplePixel"] + LIMITS["receiptWorkingReserveBytes"] <= LIMITS["workingBytes"], "model working-set budget")
    require(all(isinstance(box[k], int) for k in ("x", "y", "width", "height")) and box["width"] > 0 and box["height"] > 0
            and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= width and box["y"] + box["height"] <= height, "confirmed box extent")
    stack = np.stack([gradients(frame) for frame in samples])
    reference = np.median(stack, axis=0)
    norm = np.linalg.norm(reference, axis=-1)
    observed_norm = np.linalg.norm(stack, axis=-1)
    cosine = (stack * reference).sum(axis=-1) / np.maximum(observed_norm * norm, 1e-12)
    ratio = observed_norm / np.maximum(norm, 1e-12)
    agree = (cosine >= CONFIG["sampleDirectionCosine"]) & (ratio >= CONFIG["sampleStrengthRatio"][0]) & (ratio <= CONFIG["sampleStrengthRatio"][1])
    eligible = (norm >= CONFIG["minimumGradient"]) & (agree.mean(axis=0) >= CONFIG["sampleConsensus"])
    yy, xx = np.indices((height, width))
    margin = CONFIG["searchRadius"] + 2
    padding = CONFIG["boxPadding"]
    eligible &= (xx >= max(margin, box["x"] - padding)) & (xx < min(width - margin, box["x"] + box["width"] + padding))
    eligible &= (yy >= max(margin, box["y"] - padding)) & (yy < min(height - margin, box["y"] + box["height"] + padding))
    # Sample every other pixel, distributed over cells; strongest vectors are local landmarks, not a mask.
    eligible &= (xx % 2 == 0) & (yy % 2 == 0)
    cell_x = np.clip((xx - box["x"]) * 3 // box["width"], 0, 2)
    cell_y = np.clip((yy - box["y"]) * 3 // box["height"], 0, 2)
    points, cells = [], []
    for cell in range(9):
        ys, xs = np.where(eligible & (cell_y * 3 + cell_x == cell))
        order = sorted(range(len(xs)), key=lambda i: (-norm[ys[i], xs[i]], int(ys[i]), int(xs[i])))[:CONFIG["landmarksPerCell"]]
        if len(order) < CONFIG["minimumLandmarksPerCell"]:
            continue
        for i in order:
            points.append([int(xs[i]), int(ys[i])]); cells.append(cell)
    require(len(set(cells)) >= CONFIG["minimumCells"], "insufficient distributed persistent landmarks")
    xy = np.array(points, np.int32)
    require(np.ptp(xy[:, 0]) >= box["width"] * CONFIG["minimumSpatialSpan"]
            and np.ptp(xy[:, 1]) >= box["height"] * CONFIG["minimumSpatialSpan"], "landmark spatial extent")
    vectors = reference[xy[:, 1], xy[:, 0]]
    return {"extent": [width, height], "box": dict(box), "xy": xy, "vectors": vectors,
            "cells": np.array(cells, np.int32), "sampleCount": len(samples)}


def interpolated(field, xy, offsets):
    coords = xy[None, :, :] + np.array(offsets, np.float64)[:, None, :]
    x, y = coords[..., 0], coords[..., 1]
    ix, iy = np.floor(x).astype(int), np.floor(y).astype(int)
    require(ix.min() >= 0 and iy.min() >= 0 and ix.max() + 1 < field.shape[1] and iy.max() + 1 < field.shape[0], "search extent")
    fx, fy = (x - ix)[..., None], (y - iy)[..., None]
    return (field[iy, ix] * (1 - fx) * (1 - fy) + field[iy, ix + 1] * fx * (1 - fy)
            + field[iy + 1, ix] * (1 - fx) * fy + field[iy + 1, ix + 1] * fx * fy)


def correlations(values, vectors):
    numerator = (values * vectors).sum(axis=(1, 2))
    denominator = np.sqrt((values * values).sum(axis=(1, 2)) * (vectors * vectors).sum())
    return np.clip(numerator / np.maximum(denominator, 1e-12), -1, 1)


def alignment(field, xy, vectors, radius):
    offsets = [(dx, dy) for dy in range(-radius, radius + 1) for dx in range(-radius, radius + 1)]
    scores = correlations(interpolated(field, xy, offsets), vectors)
    best = max(range(len(offsets)), key=lambda i: (scores[i], -abs(offsets[i][0]) - abs(offsets[i][1])))
    coarse = offsets[best]
    # Never escape the finite declared search interval during subpixel refinement.
    fine = [(coarse[0] + dx / 4, coarse[1] + dy / 4) for dy in range(-3, 4) for dx in range(-3, 4)
            if abs(coarse[0] + dx / 4) <= radius and abs(coarse[1] + dy / 4) <= radius]
    refined = correlations(interpolated(field, xy, fine), vectors)
    i = max(range(len(fine)), key=lambda j: (refined[j], -abs(fine[j][0]) - abs(fine[j][1])))
    offset, score = fine[i], float(refined[i])
    competitors = [float(s) for o, s in zip(offsets, scores) if max(abs(o[0] - offset[0]), abs(o[1] - offset[1])) >= CONFIG["ambiguityDistance"]]
    gap = score - max(competitors) if competitors else None
    return {"offset": list(offset), "correlation": score, "zeroCorrelation": float(scores[offsets.index((0, 0))]),
            "distinctPeakGap": gap, "boundary": max(abs(offset[0]), abs(offset[1])) >= radius,
            "ambiguous": gap is None or gap < CONFIG["ambiguityCorrelationGap"]}


def measure_frame(frame, model):
    require([frame.shape[1], frame.shape[0]] == model["extent"], "frame extent mismatch")
    field = gradients(frame)
    xy, vectors = model["xy"], model["vectors"]
    global_fit = alignment(field, xy, vectors, CONFIG["searchRadius"])
    values = interpolated(field, xy, [global_fit["offset"]])[0]
    energy_ratio = float(np.linalg.norm(values) / np.linalg.norm(vectors))
    lost_fraction = float((np.linalg.norm(values, axis=-1) < np.linalg.norm(vectors, axis=-1) * CONFIG["landmarkPresenceRatio"]).mean())
    local = []
    for cell in sorted(set(model["cells"].tolist())):
        selected = model["cells"] == cell
        fit = alignment(field, xy[selected], vectors[selected], CONFIG["localSearchRadius"])
        local.append({"cell": cell, "landmarks": int(selected.sum()), **fit})
    reasons = []
    if global_fit["boundary"] or global_fit["ambiguous"]:
        reasons.append("SEARCH_BOUNDARY_OR_AMBIGUITY")
    if max(map(abs, global_fit["offset"])) > CONFIG["maximumOffset"]:
        reasons.append("POSITION_DRIFT")
    if lost_fraction > CONFIG["maximumLostFraction"] or energy_ratio < CONFIG["energyRatio"][0]:
        reasons.append("LANDMARK_LOSS_OR_OCCLUSION")
    if global_fit["correlation"] < CONFIG["minimumCorrelation"] or energy_ratio > CONFIG["energyRatio"][1]:
        reasons.append("STRUCTURE_CHANGE_OR_UNRESOLVED")
    if any(max(map(abs, c["offset"])) > CONFIG["maximumLocalOffset"] or c["correlation"] < CONFIG["minimumCellCorrelation"] for c in local):
        reasons.append("LOCAL_GEOMETRY_CHANGE")
    if any(c["boundary"] or c["ambiguous"] for c in local):
        reasons.append("LOCAL_SEARCH_UNRESOLVED")
    return {"state": "STATIC_GEOMETRY_OBSERVED" if not reasons else "GEOMETRY_CONTRADICTION_OR_UNRESOLVED",
            "reasons": reasons, "globalOffset": global_fit["offset"], "globalAlignment": global_fit,
            "gradientEnergyRatio": energy_ratio, "lostLandmarkFraction": lost_fraction, "cells": local}


def model_document(model, roi):
    return {"extent": model["extent"], "box": model["box"], "sampleCount": model["sampleCount"],
            "landmarks": [{"sourceX": int(x + roi["x"]), "sourceY": int(y + roi["y"]), "cell": int(c), "gradient": vector.tolist()}
                          for (x, y), c, vector in zip(model["xy"], model["cells"], model["vectors"])],
            "origin": "PERSISTENT_GRADIENT_LANDMARKS_NOT_MASK_OR_REQUIRED_PIXELS"}


def validate_history(input_doc, discovery, candidate, confirmation, target, freeze):
    require(input_doc["source"] == discovery["source"] == freeze["source"], "source interpretation")
    require(confirmation["sourceKey"] == discovery["sourceKey"] and candidate["confirmationDigest"] == confirmation["confirmationDigest"]
            and candidate["evidenceDigest"] == target["evidenceDigest"], "historical receipt binding")
    require(candidate["config"] == freeze["config"] and candidate["config"]["originalPixelTolerance"] == 24, "old RGB config unchanged")
    mask = candidate["mask"]
    require(mask["markedPixels"] == 3395 and mask["bbox"] == {"x": 628, "y": 1, "width": 81, "height": 59}
            and sha(base64.b64decode(mask["dataBase64"], validate=True)) == mask["sha256"] == "fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893", "frozen M2-A mask")
    require(len(candidate["anomalies"]) == 133 and candidate["fullRangeVerification"] == "REJECTED"
            and "FULL_RANGE_STATIC_CONTRADICTION" in candidate["reasons"], "historical RGB contradiction retained")
    roi, bindings = target["roi"], candidate["frames"]
    require(candidate["range"] == confirmation["range"] == {"startFrame": 0, "endFrame": 6990}, "full confirmed range")
    require([b["index"] for b in bindings] == list(range(6990)) and len(bindings) <= LIMITS["frames"], "missing/extra/ordered ordinals")
    require(max(roi["width"], roi["height"]) <= LIMITS["roiSide"] and all(b["byteLength"] == roi["width"] * roi["height"] * 4 for b in bindings), "ROI extent")
    clock = target["clock"]["frames"]
    require(len(clock) == len(bindings) and all(b["pts"] == c["pts"] and b["endPts"] == c["endPts"] and b["endPts"] > b["pts"] for b, c in zip(bindings, clock)), "historical clock binding")
    require(all(a["endPts"] == b["pts"] for a, b in zip(bindings, bindings[1:])), "clock continuity")
    samples = candidate["sampleOrdinals"]
    require(3 <= len(samples) <= LIMITS["representatives"] and samples == sorted(set(samples))
            and samples[0] == 0 and samples[-1] == 6989, "sample ordinal binding")
    return roi, bindings


def run(argv):
    require(len(argv) == 5, "Expected M1-input M1-result M2-A-directory NEW-directory application-ffmpeg")
    input_path, discovery_path, previous, output, engine = map(Path, argv)
    output.mkdir(mode=0o700, exist_ok=False)
    started = time.monotonic()
    deadline = started + LIMITS["wallSeconds"]
    def interrupted(_signum, _frame):
        raise InterruptedError("CPU geometry diagnostic cancelled")
    old_handlers = {s: signal.signal(s, interrupted) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        input_doc = json.loads(input_path.read_text())
        discovery = json.loads(discovery_path.read_text())["evidence"]
        candidate = json.loads((previous / "candidate.json").read_text())["receipt"]
        confirmation = json.loads((previous / "confirmation.json").read_text())
        target = json.loads((previous / "target-evidence.json").read_text())
        freeze = json.loads((previous / "method-freeze.json").read_text())
        roi, bindings = validate_history(input_doc, discovery, candidate, confirmation, target, freeze)
        repo = Path(__file__).resolve().parents[1]
        old_sources = json.loads((previous / "engineering/method-source-freeze.json").read_text())
        for path, expected in old_sources.items():
            require(file_sha(repo / path) == expected, "M2-A source freeze " + path)
        source = Path(input_doc["sourcePath"])
        frozen_paths = [input_path, discovery_path, engine, source, Path(__file__), Path(replay.__file__)] + list(previous.glob("*.json"))
        frozen = {str(p): file_sha(p) for p in frozen_paths}
        require(frozen[str(source)] == input_doc["source"]["fingerprint"].removeprefix("sha256:")
                and source.stat().st_size == input_doc["source"]["byteLength"], "source identity")
        require(frozen[str(engine)] == discovery["decode"]["ffmpegFingerprint"].removeprefix("sha256:"), "engine identity")
        save(output, "method-freeze.json", {"config": CONFIG, "configDigest": digest(CONFIG), "limits": LIMITS, "files": frozen,
              "sourceKey": confirmation["sourceKey"], "targetId": confirmation["targetId"], "range": confirmation["range"],
              "dependencies": {"numpy": np.__version__, "opencv": cv2.__version__}, "parameterRevisionsAfterRealObservation": 0})
        samples = []
        sample_start = time.monotonic()
        replay.decode(source, engine, roi, [bindings[i] for i in candidate["sampleOrdinals"]], input_doc["source"]["timeBase"], lambda f, b: samples.append(f.copy()), deadline)
        sample_ms = (time.monotonic() - sample_start) * 1000
        box = {**confirmation["sourceBox"], "x": confirmation["sourceBox"]["x"] - roi["x"], "y": confirmation["sourceBox"]["y"] - roi["y"]}
        model_start = time.monotonic()
        model = build_model(np.stack(samples), box)
        del samples
        document = model_document(model, roi)
        save(output, "landmark-reference.json", {**document, "digest": digest(document)})
        model_ms = (time.monotonic() - model_start) * 1000
        frames, images = [], {}
        old_anomalies = {a["index"] for a in candidate["anomalies"]}
        keep = {0, 233, 234, 710, 715, 1247, 3495, 3756, 3764, 6989}
        algorithm_ms = 0.0
        stream_start = time.monotonic()
        def consume(frame, binding):
            nonlocal algorithm_ms
            tick = time.monotonic()
            require(tick < deadline, "geometry wall budget")
            observation = measure_frame(frame, model)
            frames.append({**binding, **observation, "oldRgbAnomaly": binding["index"] in old_anomalies})
            algorithm_ms += (time.monotonic() - tick) * 1000
            if binding["index"] in keep:
                images[binding["index"]] = frame.copy()
        replay.decode(source, engine, roi, bindings, input_doc["source"]["timeBase"], consume, deadline)
        stream_ms = (time.monotonic() - stream_start) * 1000
        require(all(file_sha(Path(p)) == expected for p, expected in frozen.items()), "source/engine/method/historical artifact drift")
        require(all(file_sha(repo / p) == expected for p, expected in old_sources.items()), "M2-A source drift")
        issues = [f for f in frames if f["state"] != "STATIC_GEOMETRY_OBSERVED"]
        summary = {"globalOffsets": sorted({tuple(f["globalOffset"]) for f in frames}),
                   "minimumGlobalCorrelation": min(f["globalAlignment"]["correlation"] for f in frames),
                   "minimumPeakGap": min(f["globalAlignment"]["distinctPeakGap"] for f in frames),
                   "maximumLostLandmarkFraction": max(f["lostLandmarkFraction"] for f in frames),
                   "gradientEnergyRatioRange": [min(f["gradientEnergyRatio"] for f in frames), max(f["gradientEnergyRatio"] for f in frames)],
                   "minimumLocalCorrelation": min(c["correlation"] for f in frames for c in f["cells"]),
                   "maximumLocalOffset": max(max(map(abs, c["offset"])) for f in frames for c in f["cells"]),
                   "oldRgbAnomalyGeometryIssues": sum(f["oldRgbAnomaly"] for f in issues)}
        ranges = replay.runs(f["index"] for f in issues)
        for group in ranges:
            group.update(startPts=bindings[group["startFrame"]]["pts"], endPts=bindings[group["endFrame"] - 1]["endPts"])
        save(output, "frames.json", frames)
        save(output, "issues.json", {"ranges": ranges, "frames": issues})
        save(output, "old-rgb-cross-table.json", [f for f in frames if f["oldRgbAnomaly"]])
        canvas = Image.new("RGB", (840, 240 * ((len(images) + 2) // 3)), "#202020")
        draw = ImageDraw.Draw(canvas)
        for cell, (ordinal, frame) in enumerate(sorted(images.items())):
            annotated = frame[..., :3].copy()
            annotated[model["xy"][:, 1], model["xy"][:, 0]] = (0, 255, 0)
            x, y = (cell % 3) * 280, (cell // 3) * 240
            draw.text((x + 4, y + 4), f"ordinal {ordinal}; gradient landmarks", fill="white")
            canvas.paste(Image.fromarray(annotated).resize((270, 196), Image.Resampling.NEAREST), (x, y + 24))
        canvas.save(output / "landmark-contact.png")
        result = {"method": CONFIG["method"], "configDigest": digest(CONFIG), "referenceDigest": digest(document),
                  "status": "DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED" if not issues else "INCOMPLETE_GEOMETRY_CONTRADICTION_OR_UNRESOLVED",
                  "authority": "none", "eligible": False, "sourceKey": confirmation["sourceKey"], "targetId": confirmation["targetId"],
                  "confirmationDigest": confirmation["confirmationDigest"], "historicalEvidenceDigest": target["evidenceDigest"],
                  "range": confirmation["range"], "frames": len(frames), "geometricIssueFrames": len(issues), "summary": summary,
                  "frameMetricsDigest": digest(frames), "sampleOrdinals": candidate["sampleOrdinals"], "landmarks": len(model["xy"]),
                  "oldRgbResult": "FULL_RANGE_STATIC_CONTRADICTION", "oldRgbAnomalies": 133, "oldRgbTolerance": 24,
                  "oldMaskSha256": candidate["mask"]["sha256"], "oldMaskPixels": 3395,
                  "independentRequiredPixelTruth": "MISSING", "maskCompleteness": "NOT_EVALUATED", "requiredPixels": None,
                  "missedRequiredPixels": None, "realMediaQualification": "INCOMPLETE", "coverage": "NOT_EVALUATED", "product": "PRODUCT_DISABLED",
                  "limitations": ["Landmarks do not exhaust the target outline or required pixels.",
                                  "Offsets within declared thresholds are unresolved below this development sensitivity.",
                                  "Unsupported texture/occlusion/appearance can be unresolved; no causal classification or formal motion authority.",
                                  "One known development source; no independent holdout, Windows or low-end CPU qualification."]}
        save(output, "performance.json", {"wallMs": (time.monotonic() - started) * 1000, "representativeDecodeMs": sample_ms,
              "modelMs": model_ms, "rangeDecodeAndGeometryMs": stream_ms, "geometryKernelMs": algorithm_ms,
              "parentPeakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
              "childPeakRssBytes": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * 1024,
              "rssMethod": "Linux-getrusage-process-high-water-marks; separate-not-simultaneous-total",
              "estimatedModelWorkingBytes": roi["width"] * roi["height"] * len(candidate["sampleOrdinals"]) * LIMITS["modelBytesPerSamplePixel"],
              "receiptWorkingReserveBytes": LIMITS["receiptWorkingReserveBytes"],
              "rgbaScratchBytes": 0, "cpuOnly": True, "productModelRequests": 0})
        require(sum(p.stat().st_size for p in output.iterdir()) + len(json.dumps(result).encode()) <= LIMITS["artifactBytes"], "artifact byte budget")
        require(time.monotonic() < deadline, "final wall budget")
        save(output, "result.json", {**result, "receiptDigest": digest(result)})
        print(json.dumps({k: result[k] for k in ("status", "frames", "geometricIssueFrames", "landmarks", "authority", "realMediaQualification")}))
    except BaseException as error:
        save(output, "failure.json", {"status": "INCOMPLETE", "authority": "none", "eligible": False,
              "reason": str(error), "wallMs": (time.monotonic() - started) * 1000, "product": "PRODUCT_DISABLED"})
        raise
    finally:
        for signum, handler in old_handlers.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    run(sys.argv[1:])
