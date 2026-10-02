"""M2-D offline required-pixel comparator. No detector, truth issuer or product authority.

Usage: M1-input M1-result M2-A-directory truth-packet-or-- NEW-directory application-ffmpeg
Labels cover the entire ROI: 0 known background, 1 required, 2 unknown.
Packet metadata records declarations; it cannot prove independent human review.
"""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import resource
import signal
import sys
import time

import numpy as np

LIMIT_BYTES = 64 * 1024 ** 2
MASK_SHA = "fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893"


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path):
    require(Path(path).stat().st_size <= LIMIT_BYTES, "JSON byte budget")
    return json.loads(Path(path).read_text())


def raster_mask(mask, roi):
    box = mask["bbox"]
    require(mask["encoding"] == "bitpack-lsb-row-major-v1", "mask encoding")
    require(all(type(box[k]) is int for k in ("x", "y", "width", "height")), "integer mask bbox")
    x, y = box["x"] - roi["x"], box["y"] - roi["y"]
    w, h = box["width"], box["height"]
    require(w > 0 and h > 0 and x >= 0 and y >= 0 and x + w <= roi["width"] and y + h <= roi["height"], "mask outside ROI")
    raw = base64.b64decode(mask["dataBase64"], validate=True)
    require(len(raw) == (w * h + 7) // 8 and sha(raw) == mask["sha256"], "mask bytes/hash")
    bits = np.unpackbits(np.frombuffer(raw, np.uint8), bitorder="little")
    require(not bits[w * h:].any() and int(bits.sum()) == mask["markedPixels"] and bits.any(), "mask padding/count")
    result = np.zeros((roi["height"], roi["width"]), bool)
    result[y:y + h, x:x + w] = bits[:w * h].reshape(h, w)
    return result


def validate_bindings(context, bindings):
    roi, source, interval = context["roi"], context["source"], context["range"]
    require(all(type(roi[k]) is int for k in ("x", "y", "width", "height")), "integer ROI")
    require(0 < roi["width"] <= 512 and 0 < roi["height"] <= 512 and roi["x"] >= 0 and roi["y"] >= 0
            and roi["x"] + roi["width"] <= source["width"] and roi["y"] + roi["height"] <= source["height"], "ROI extent/budget")
    require(type(interval["startFrame"]) is int and type(interval["endFrame"]) is int
            and 0 <= interval["startFrame"] < interval["endFrame"], "range")
    require(0 < len(bindings) <= 20_000 and [b["index"] for b in bindings]
            == list(range(interval["startFrame"], interval["endFrame"])), "full promised range")
    for i, b in enumerate(bindings):
        require(all(type(b[k]) is int for k in ("index", "pts", "endPts", "byteLength"))
                and b["endPts"] > b["pts"] and b["byteLength"] == roi["width"] * roi["height"] * 4
                and len(b["pixelSha256"]) == 64 and all(c in "0123456789abcdef" for c in b["pixelSha256"])
                and (i == 0 or bindings[i - 1]["endPts"] == b["pts"]), "frame clock/extent/hash")


def coordinates(bits, roi):
    ys, xs = np.where(bits)
    return [[int(x) + roi["x"], int(y) + roi["y"]] for y, x in zip(ys, xs)]


def compare(context, bindings, mask, truth):
    validate_bindings(context, bindings)
    roi = context["roi"]
    candidate = raster_mask(mask, roi)
    names = ("requiredPixels", "missedRequiredPixels", "missingRequiredFrames", "excessPixels", "comparedFrames")
    base = {"method": "independent-required-pixel-comparison/v1", "authority": "none", "eligible": False,
            "qualification": "INCOMPLETE", "product": "PRODUCT_DISABLED", "context": context,
            "maskSha256": mask["sha256"], "metricUnit": "pixel-frame occurrences; missingRequiredFrames is frames",
            "truthDigest": sha(json.dumps(truth, sort_keys=True, separators=(",", ":")).encode()) if truth else None}
    if truth is None:
        return {**base, "status": "INCOMPLETE", "metrics": dict.fromkeys(names), "frames": [],
                "reasons": ["INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING"]}
    require(truth["method"] == "independent-required-pixel-packet/v1" and truth["context"] == context, "truth source/target/ROI/range binding")
    require(truth["scope"] in ("CONTROLLED_CONSTRUCTION", "REAL_MEDIA")
            and truth["origin"] in ("KNOWN_COMPOSITING_ALPHA", "INDEPENDENT_ANNOTATION"), "independent origin missing")
    require(truth["scope"] != "CONTROLLED_CONSTRUCTION" or truth["origin"] == "KNOWN_COMPOSITING_ALPHA", "construction alpha provenance")
    require(isinstance(truth["authorId"], str) and truth["authorId"].strip() and isinstance(truth["reviewerId"], str)
            and truth["reviewerId"].strip() and truth["authorId"].strip() != truth["reviewerId"].strip(), "independent review declaration")
    require(truth["boundaryReview"] in ("BOUNDED", "UNKNOWN"), "boundary review declaration")
    require(truth["provenance"] and all(isinstance(p["method"], str) and p["method"].strip()
            and len(p["sha256"]) == 64 and all(c in "0123456789abcdef" for c in p["sha256"])
            and p["sha256"] != mask["sha256"] for p in truth["provenance"]), "circular or missing provenance")
    require(len(truth["frames"]) == len(bindings), "truth full range missing")
    # Decode at most one truth raster per frame; a packet cannot demand an unbounded raster cache.
    required_total = missed_total = excess_total = missing_frames = unknown_total = 0
    unique_missed = np.zeros(candidate.shape, bool)
    unique_excess = unique_missed.copy()
    frame_metrics, reasons = [], []
    accounted_bytes = 1024 * 1024
    if truth["boundaryReview"] != "BOUNDED":
        reasons.append("TARGET_BOUNDARY_NOT_INDEPENDENTLY_BOUNDED")
    for binding, frame in zip(bindings, truth["frames"]):
        require(frame["binding"] == binding, "truth original frame binding")
        require(frame["motion"] in ("STATIC", "MOVING", "UNKNOWN"), "motion label")
        digest = frame["truthSha256"]
        raw = base64.b64decode(truth["rasters"][digest], validate=True)
        require(len(raw) == candidate.size and sha(raw) == digest, "truth raster extent/hash")
        labels = np.frombuffer(raw, np.uint8).reshape(candidate.shape)
        require(np.all(labels <= 2), "truth labels")
        required, unknown = labels == 1, labels == 2
        missed, excess = required & ~candidate, (labels == 0) & candidate
        counts = [int(x.sum()) for x in (required, missed, excess, unknown)]
        # Bound Python coordinate lists and JSON before materializing them, not after allocation.
        accounted_bytes += 1024 + 96 * (counts[1] + counts[2])
        require(accounted_bytes <= LIMIT_BYTES, "comparison artifact/working-set budget")
        required_total += counts[0]
        missed_total += counts[1]
        excess_total += counts[2]
        unknown_total += counts[3]
        missing_frames += bool(counts[1])
        unique_missed |= missed
        unique_excess |= excess
        if frame["motion"] != "STATIC" and "STATIC_MOTION_TRUTH_UNRESOLVED" not in reasons:
            reasons.append("STATIC_MOTION_TRUTH_UNRESOLVED")
        if not counts[0] and "EMPTY_REQUIRED_TARGET_FRAME" not in reasons:
            reasons.append("EMPTY_REQUIRED_TARGET_FRAME")
        frame_metrics.append({**binding, "truthSha256": digest, "requiredPixels": counts[0],
                              "knownMissedRequiredPixels": counts[1], "knownExcessPixels": counts[2], "unknownPixels": counts[3],
                              "missedSourceXY": coordinates(missed, roi), "excessSourceXY": coordinates(excess, roi)})
    if unknown_total:
        reasons.append("UNKNOWN_REQUIRED_PIXEL_TRUTH")
    metrics = dict(zip(names, (required_total, missed_total, missing_frames, excess_total, len(bindings)))) if not reasons else dict.fromkeys(names)
    status = "INCOMPLETE" if reasons else "DECLARED_REQUIRED_PIXEL_MISS" if missed_total else "CONTROLLED_COMPARISON_MATCH"
    if truth["scope"] == "REAL_MEDIA":
        if not reasons and not missed_total:
            status = "REAL_MEDIA_DECLARED_COMPARISON_ONLY"
        reasons.append("REAL_MEDIA_INDEPENDENCE_AND_REVIEW_NOT_VERIFIED")
    else:
        reasons.append("CONTROLLED_CONSTRUCTION_ONLY_NO_REAL_HOLDOUT_QUALIFICATION")
    return {**base, "status": status, "metrics": metrics, "reasons": reasons,
            "observed": {"knownRequiredPixels": required_total, "knownMissedRequiredPixels": missed_total,
                         "knownMissingRequiredFrames": missing_frames, "knownExcessPixels": excess_total, "unknownPixelOccurrences": unknown_total},
            "uniqueMissedSourceXY": coordinates(unique_missed, roi), "uniqueExcessSourceXY": coordinates(unique_excess, roi),
            "frames": frame_metrics}


def main(argv):
    require(len(argv) == 6, "Expected M1-input M1-result M2-A-directory truth-packet-or-- NEW-directory application-ffmpeg")
    input_path, discovery_path, previous = map(Path, argv[:3])
    truth_path = None if argv[3] == "-" else Path(argv[3])
    output, engine = map(Path, argv[4:])
    output.mkdir(mode=0o700, exist_ok=False)
    started = time.monotonic()
    try:
        input_doc, discovery = read_json(input_path), read_json(discovery_path)["evidence"]
        candidate = read_json(previous / "candidate.json")["receipt"]
        confirmation, target = read_json(previous / "confirmation.json"), read_json(previous / "target-evidence.json")
        source = Path(input_doc["sourcePath"])
        frozen_paths = [input_path, discovery_path, source, engine, Path(__file__),
                        Path(__file__).with_name("shape-cover-static-anomalies.py")] + list(previous.glob("*.json"))
        if truth_path:
            frozen_paths.append(truth_path)
        frozen = {str(p): file_sha(p) for p in frozen_paths}
        require(input_doc["source"] == discovery["source"] and frozen[str(source)] == input_doc["source"]["fingerprint"].removeprefix("sha256:")
                and source.stat().st_size == input_doc["source"]["byteLength"], "source identity")
        require(frozen[str(engine)] == discovery["decode"]["ffmpegFingerprint"].removeprefix("sha256:"), "engine identity")
        require(candidate["mask"]["sha256"] == MASK_SHA and candidate["mask"]["markedPixels"] == 3395
                and candidate["mask"]["bbox"] == {"x": 628, "y": 1, "width": 81, "height": 59}
                and candidate["range"] == confirmation["range"] == {"startFrame": 0, "endFrame": 6990}, "frozen M2-A mask/range")
        require(candidate["targetId"] == confirmation["targetId"] and candidate["confirmationDigest"] == confirmation["confirmationDigest"]
                and candidate["evidenceDigest"] == target["evidenceDigest"] and confirmation["sourceKey"] == discovery["sourceKey"], "historical receipt binding")
        context = {"source": input_doc["source"], "sourceKey": confirmation["sourceKey"], "targetId": candidate["targetId"],
                   "confirmationDigest": confirmation["confirmationDigest"], "roi": target["roi"], "range": candidate["range"]}
        bindings = candidate["frames"]
        for binding in bindings:
            clock = target["clock"]["frames"][binding["index"]]
            require(all(binding[k] == clock[k] for k in ("index", "pts", "endPts")), "original clock binding")
        result = compare(context, bindings, candidate["mask"], read_json(truth_path) if truth_path else None)
        spec = importlib.util.spec_from_file_location("m2b_decode", Path(__file__).with_name("shape-cover-static-anomalies.py"))
        decoder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(decoder)
        count = 0

        def consume(_frame, _binding):
            nonlocal count
            count += 1

        decoder.decode(source, engine, target["roi"], bindings, input_doc["source"]["timeBase"], consume, started + 300)
        require(count == len(bindings), "full decode count")
        for path, expected in frozen.items():
            require(file_sha(path) == expected, "input changed " + path)
        result.update(framesBound=count, truthFramesCompared=len(result["frames"]), candidateReceiptDigest=candidate["receiptDigest"],
                      inputFreeze=frozen, wallSeconds=time.monotonic() - started,
                      parentPeakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
                      childPeakRssBytes=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * 1024, rgbaScratchBytes=0)
        payload = json.dumps(result, indent=2).encode()
        require(len(payload) <= LIMIT_BYTES and time.monotonic() - started < 300, "result byte/wall budget")
        with (output / "result.json").open("xb") as stream:
            stream.write(payload)
        print(json.dumps({k: result[k] for k in ("status", "qualification", "framesBound", "truthFramesCompared", "metrics", "reasons", "wallSeconds")}))
    except BaseException as error:
        (output / "failure.json").write_text(json.dumps({"status": "FAILED", "authority": "none", "eligible": False, "reason": str(error)}))
        raise


if __name__ == "__main__":
    def stop(_number, _frame):
        raise InterruptedError("cancelled")
    signal.signal(signal.SIGTERM, stop)
    main(sys.argv[1:])
