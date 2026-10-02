"""M2-B offline observations; replay frozen M2-A, never qualify or change its mask.

Requires development-host NumPy/OpenCV/Pillow. Not a product dependency.
CLI: M1-input.json M1-result.json M2-A-directory NEW-directory application-ffmpeg
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import threading
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw


def require(condition, reason):
    if not condition:
        raise ValueError("INCOMPLETE: " + reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save(root, name, value):
    with (root / name).open("x", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def runs(ordinals):
    """Exact contiguous half-open runs, with no temporal gap merging."""
    result = []
    for index in sorted(set(ordinals)):
        if result and result[-1]["endFrame"] == index:
            result[-1]["endFrame"] += 1
        else:
            result.append({"startFrame": index, "endFrame": index + 1})
    return result


def reconstruct(samples, roi, source_box, config):
    """Diagnostic replay of M2-A support, gated by byte-identical mask/anomalies."""
    rgb = samples[..., :3].astype(np.float64)
    sums, squares = rgb.sum(axis=0), (rgb * rgb).sum(axis=0)
    mean = sums / len(samples)
    stable = np.sqrt(np.maximum(0, squares / len(samples) - mean ** 2)).max(axis=2) <= config["maxChannelStd"]
    count, labels = cv2.connectedComponents(stable.astype(np.uint8), connectivity=8)
    support = np.zeros(stable.shape, dtype=np.uint8)
    height, width = stable.shape
    contrast = np.zeros(stable.shape, dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ys, xs = slice(max(0, -dy), min(height, height - dy)), slice(max(0, -dx), min(width, width - dx))
            yt, xt = slice(max(0, dy), min(height, height + dy)), slice(max(0, dx), min(width, width + dx))
            # Same sum-before-divide arithmetic as frozen TypeScript.
            contrast[ys, xs] |= (np.abs(sums[ys, xs] - sums[yt, xt]) / len(samples)).max(axis=2) >= config["edgeDifference"]
    for label in range(1, count):
        ys, xs = np.where(labels == label)
        intersects = ((xs + roi["x"] >= source_box["x"]) & (xs + roi["x"] < source_box["x"] + source_box["width"])
                      & (ys + roi["y"] >= source_box["y"]) & (ys + roi["y"] < source_box["y"] + source_box["height"])).any()
        if intersects and len(xs) >= config["minimumComponentPixels"] and contrast[ys, xs].any():
            require(not ((xs == 0) | (ys == 0) | (xs == width - 1) | (ys == height - 1)).any(), "unresolved support boundary")
            support[ys, xs] = 1
    radius = config["dilationPixels"]
    ys, xs = np.where(support)
    require(len(xs) and not ((xs - radius <= 0) | (ys - radius <= 0) | (xs + radius >= width - 1) | (ys + radius >= height - 1)).any(), "unresolved margin")
    mask = cv2.dilate(support, np.ones((2 * radius + 1, 2 * radius + 1), dtype=np.uint8))
    return support.astype(bool), mask.astype(bool), rgb.min(axis=0).astype(np.int16), rgb.max(axis=0).astype(np.int16), mean


def exceedance(frame, low, high, support, tolerance):
    rgb = frame[..., :3].astype(np.int16)
    channel = np.maximum(0, np.maximum(low - rgb, rgb - high))
    difference = channel.max(axis=2)
    return support & (difference > tolerance), difference, channel


def alignment_scores(frame, reference, core):
    """Compare local integer translations; no acceptance threshold or motion proof."""
    ys, xs = np.where(core)
    require(len(xs) > 0 and xs.min() >= 2 and ys.min() >= 2
            and xs.max() + 2 < core.shape[1] and ys.max() + 2 < core.shape[0], "alignment core extent")
    template = reference[ys, xs, :3]
    scores = [{"dx": dx, "dy": dy, "meanAbsoluteRgbDifference": float(np.abs(frame[ys + dy, xs + dx, :3].astype(np.float64) - template).mean())}
              for dy in range(-2, 3) for dx in range(-2, 3)]
    best = min(scores, key=lambda s: (s["meanAbsoluteRgbDifference"], abs(s["dx"]) + abs(s["dy"])))
    return {"bestLocalIntegerOffset": [best["dx"], best["dy"]], "bestMeanAbsoluteRgbDifference": best["meanAbsoluteRgbDifference"],
            "zeroOffsetMeanAbsoluteRgbDifference": next(s["meanAbsoluteRgbDifference"] for s in scores if s["dx"] == s["dy"] == 0)}


def decode(source, engine, roi, bindings, time_base, consume, deadline):
    """Single CPU decode, independent framehash output, strict frozen ROI binding."""
    width, height = roi["width"], roi["height"]
    byte_count = width * height * 4
    ordinals = [b["index"] for b in bindings]
    selection = "+".join(f"eq(n,{i})" for i in ordinals) if len(bindings) <= 96 else f"between(n,{ordinals[0]},{ordinals[-1]})"
    read_fd, write_fd = os.pipe()
    lines, errors = [], []

    def hashes():
        try:
            with os.fdopen(read_fd, "rb") as handle:
                text = handle.read(16 * 1024 * 1024 + 1)
            require(len(text) <= 16 * 1024 * 1024, "framehash byte budget")
            lines.extend(text.decode("utf-8").splitlines())
        except Exception as error:
            errors.append(error)

    output = lambda name, fmt, pipe: ["-map", f"[{name}]", "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-enc_time_base", "demux",
                                     "-c:v", "rawvideo", "-pix_fmt", "rgba", "-threads", "1", "-f", fmt] + (["-hash", "sha256"] if fmt == "framehash" else []) + [pipe]
    with tempfile.TemporaryFile() as stderr:
        args = [str(engine), "-hide_banner", "-v", "error", "-nostdin", "-xerror", "-fflags", "+nofillin", "-err_detect", "explode",
                "-hwaccel", "none", "-threads", "1", "-noautorotate", "-copyts", "-i", str(source), "-filter_complex_threads", "1", "-filter_complex",
                f"[0:0]select='{selection}',format=rgba,crop={width}:{height}:{roi['x']}:{roi['y']}:exact=1,split=2[pixels][binding]"]
        args += output("pixels", "rawvideo", "pipe:1") + output("binding", "framehash", f"pipe:{write_fd}")
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=stderr, pass_fds=(write_fd,))
        os.close(write_fd)
        thread = threading.Thread(target=hashes)
        thread.start()
        timer = threading.Timer(max(0.001, deadline - time.monotonic()), process.kill)
        timer.start()
        try:
            for binding in bindings:
                require(time.monotonic() < deadline, "wall budget")
                raw = process.stdout.read(byte_count)
                require(len(raw) == byte_count and sha(raw) == binding["pixelSha256"], f"ROI pixel binding ordinal {binding['index']}")
                consume(np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 4), binding)
            require(not process.stdout.read(1), "extra decoded frame")
            require(process.wait(timeout=max(0.001, deadline - time.monotonic())) == 0, "decoder exit")
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()
            thread.join()
        stderr.seek(0)
        require(not stderr.read(4096), "decoder stderr")
    require(not errors, "hash pipe failure")
    require(f"#tb 0: {time_base}" in lines, "framehash time base")
    rows = [line for line in lines if line and not line.startswith("#")]
    require(len(rows) == len(bindings), "framehash count")
    for row, binding in zip(rows, bindings):
        values = [v.strip() for v in row.split(",")]
        require(len(values) == 6 and int(values[0]) == 0 and int(values[2]) == binding["pts"]
                and int(values[3]) == binding["endPts"] - binding["pts"] and int(values[4]) == byte_count
                and values[5] == binding["pixelSha256"], f"PTS/hash ordinal {binding['index']}")


def contact_sheets(root, images, changed_maps, reference, support, mask):
    """Original/nearest-neighbor observations. Red=exceedance, green=support boundary."""
    boundary = support & ~cv2.erode(support.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    entries = sorted(images)
    for page in range(0, len(entries), 16):
        canvas = Image.new("RGB", (4 * 440, 4 * 200), "#202020")
        draw = ImageDraw.Draw(canvas)
        for cell, ordinal in enumerate(entries[page:page + 16]):
            rgba = images[ordinal]
            original = Image.fromarray(rgba[..., :3]).resize((214, 152), Image.Resampling.NEAREST)
            annotated = rgba[..., :3].copy()
            annotated[boundary] = (0, 255, 0)
            annotated[changed_maps.get(ordinal, np.zeros(support.shape, bool))] = (255, 0, 0)
            overlay = Image.fromarray(annotated).resize((214, 152), Image.Resampling.NEAREST)
            x, y = cell % 4 * 440, cell // 4 * 200
            canvas.paste(original, (x, y + 24)); canvas.paste(overlay, (x + 220, y + 24))
            draw.text((x + 4, y + 4), f"ordinal {ordinal} original / support+changed", fill="white")
        canvas.save(root / f"contact-{page // 16:02d}.png")
    for name, array in [("reference", reference[..., :3].astype(np.uint8)), ("support", support.astype(np.uint8) * 255), ("mask", mask.astype(np.uint8) * 255)]:
        Image.fromarray(array).save(root / f"{name}.png")


def main(argv):
    require(len(argv) == 5, "Expected M1-input M1-result M2-A-directory NEW-directory application-ffmpeg")
    input_path, discovery_path, previous, output, engine = map(Path, argv)
    output.mkdir(mode=0o700, exist_ok=False)
    started = time.monotonic()
    deadline = started + 300
    input_doc = json.loads(input_path.read_text())
    discovery = json.loads(discovery_path.read_text())["evidence"]
    candidate = json.loads((previous / "candidate.json").read_text())["receipt"]
    confirmation = json.loads((previous / "confirmation.json").read_text())
    target = json.loads((previous / "target-evidence.json").read_text())
    freeze = json.loads((previous / "method-freeze.json").read_text())
    repo = Path(__file__).resolve().parents[1]
    sources = json.loads((previous / "engineering/method-source-freeze.json").read_text())
    frozen = {str(path): file_sha(path) for path in [input_path, discovery_path, engine] + list(previous.glob("*.json"))}
    for path, expected in sources.items():
        require(file_sha(repo / path) == expected, "M2-A source freeze " + path)
    require(candidate["config"] == freeze["config"], "config freeze")
    source = Path(input_doc["sourcePath"])
    require(file_sha(source) == input_doc["source"]["fingerprint"].removeprefix("sha256:") and source.stat().st_size == input_doc["source"]["byteLength"], "source identity")
    require(file_sha(engine) == discovery["decode"]["ffmpegFingerprint"].removeprefix("sha256:"), "engine identity")
    require(input_doc["source"] == discovery["source"] == freeze["source"], "source interpretation")
    require(confirmation["sourceKey"] == discovery["sourceKey"] and candidate["confirmationDigest"] == confirmation["confirmationDigest"]
            and candidate["evidenceDigest"] == target["evidenceDigest"], "receipt binding")
    roi, bindings = target["roi"], candidate["frames"]
    require(max(roi["width"], roi["height"]) <= 512 and len(bindings) <= 20_000, "ROI/frame budget")
    expected_ordinals = list(range(candidate["range"]["startFrame"], candidate["range"]["endFrame"]))
    require([b["index"] for b in bindings] == expected_ordinals and candidate["range"] == confirmation["range"], "full promised range")
    require(all(b["byteLength"] == roi["width"] * roi["height"] * 4 for b in bindings), "ROI extent")
    by_ordinal = {b["index"]: b for b in bindings}
    samples = []
    decode(source, engine, roi, [by_ordinal[i] for i in candidate["sampleOrdinals"]], input_doc["source"]["timeBase"], lambda f, b: samples.append(f.copy()), deadline)
    support, mask, low, high, mean = reconstruct(np.stack(samples), roi, confirmation["sourceBox"], candidate["config"])
    del samples
    old_mask = candidate["mask"]
    ys, xs = np.where(mask)
    bbox = {"x": int(xs.min()) + roi["x"], "y": int(ys.min()) + roi["y"], "width": int(xs.max() - xs.min() + 1), "height": int(ys.max() - ys.min() + 1)}
    packed = np.packbits(mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1].ravel(), bitorder="little").tobytes()
    require(bbox == old_mask["bbox"] and packed == base64.b64decode(old_mask["dataBase64"]) and sha(packed) == old_mask["sha256"]
            and int(mask.sum()) == old_mask["markedPixels"], "mask byte replay")
    distance = cv2.distanceTransform(support.astype(np.uint8), cv2.DIST_C, 3).astype(int)
    core = support & (distance >= 4)
    original_ordinals = {a["index"] for a in candidate["anomalies"]}
    keep = {i + delta for i in original_ordinals for delta in (-1, 0, 1)} | {expected_ordinals[0], expected_ordinals[len(bindings) // 2], expected_ordinals[-1]}
    anomalies, images, changed_maps, frame_metrics = [], {}, {}, []
    frequency = np.zeros(support.shape, dtype=np.int32)
    worst_map = np.zeros(support.shape, dtype=np.int16)
    support_y, support_x = np.where(support)
    trace_bytes = len(bindings) * len(support_x) * 3
    require(trace_bytes + len(keep) * roi["width"] * roi["height"] * 4 + 16 * 1024 ** 2 <= 512 * 1024 ** 2, "working-set budget")
    traces = np.empty((len(bindings), len(support_x), 3), dtype=np.uint8)

    def consume(frame, binding):
        index = binding["index"]
        changed, difference, channel = exceedance(frame, low, high, support, candidate["config"]["originalPixelTolerance"])
        traces[index - expected_ordinals[0]] = frame[support_y, support_x, :3]
        frequency[:] += changed
        np.maximum(worst_map, np.where(support, difference, 0), out=worst_map)
        frame_metrics.append({"index": index, "pts": binding["pts"], "endPts": binding["endPts"], "pixelSha256": binding["pixelSha256"],
                              "supportCoreMaxEnvelopeDifference": int(difference[core].max()) if core.any() else None,
                              "localAlignmentObservation": alignment_scores(frame, mean, core) if core.any() else None})
        if index in keep:
            images[index] = frame.copy()
        if changed.any():
            changed_maps[index] = changed
            coordinates = [{"x": int(x) + roi["x"], "y": int(y) + roi["y"], "rgb": frame[y, x, :3].tolist(),
                            "sampleMin": low[y, x].tolist(), "sampleMax": high[y, x].tolist(), "channelExceedance": channel[y, x].tolist(),
                            "supportBoundaryDistance": int(distance[y, x])} for y, x in zip(*np.where(changed))]
            anomalies.append({"index": index, "reason": "STATIC_SUPPORT_CHANGED_OR_OCCLUDED", "changedSupportPixels": len(coordinates),
                              "worstDifference": int(difference[support].max()), "pts": binding["pts"], "endPts": binding["endPts"],
                              "pixelSha256": binding["pixelSha256"], "pixels": coordinates,
                              "observation": "SUPPORT_BOUNDARY_ENVELOPE_EXCEEDANCE" if max(p["supportBoundaryDistance"] for p in coordinates) <= 3 else "SUPPORT_INTERIOR_ENVELOPE_EXCEEDANCE",
                              "causalClassification": "UNKNOWN"})

    decode(source, engine, roi, bindings, input_doc["source"]["timeBase"], consume, deadline)
    require([{k: a[k] for k in ("index", "reason", "changedSupportPixels", "worstDifference")} for a in anomalies] == candidate["anomalies"], "all anomalies replay")
    groups = runs(a["index"] for a in anomalies)
    for group in groups:
        group.update(startPts=by_ordinal[group["startFrame"]]["pts"], endPts=by_ordinal[group["endFrame"] - 1]["endPts"])
    pixel_traces = []
    for p, (y, x) in enumerate(zip(support_y, support_x)):
        if frequency[y, x]:
            pixel_traces.append({"x": int(x) + roi["x"], "y": int(y) + roi["y"], "changedFrames": int(frequency[y, x]),
                                 "worstDifference": int(worst_map[y, x]), "supportBoundaryDistance": int(distance[y, x]),
                                 "sampleMin": low[y, x].tolist(), "sampleMax": high[y, x].tolist(),
                                 "fullRgbMin": traces[:, p].min(axis=0).tolist(), "fullRgbMax": traces[:, p].max(axis=0).tolist()})
    save(output, "anomalies.json", anomalies)
    save(output, "ranges.json", {"anomalyRuns": groups, "nonAnomalousRuns": runs(i for i in expected_ordinals if i not in original_ordinals),
                                  "meaning": "OBSERVATION_ONLY_NOT_VALID_STATIC_RANGES", "promisedRangeUnchanged": candidate["range"]})
    save(output, "pixel-observations.json", pixel_traces)
    save(output, "frame-metrics.json", frame_metrics)
    # Original ROI bytes and traces remain local evidence, never required-pixel truth.
    np.savez_compressed(output / "support-traces.npz", sourceXY=np.stack([support_x + roi["x"], support_y + roi["y"]], axis=1), rgb=traces,
                        sampleMin=low[support], sampleMax=high[support], ordinals=expected_ordinals)
    for index, frame in images.items():
        Image.fromarray(frame).save(output / f"original-{index}.png")
    contact_sheets(output, images, changed_maps, mean, support, mask)
    heat = np.zeros((*support.shape, 3), dtype=np.uint8)
    heat[..., 0] = np.minimum(255, frequency * 8)
    heat[..., 1] = support.astype(np.uint8) * 40
    Image.fromarray(heat).save(output / "anomaly-frequency.png")
    for path, expected in frozen.items():
        require(file_sha(path) == expected, "input changed " + path)
    require(file_sha(source) == input_doc["source"]["fingerprint"].removeprefix("sha256:"), "source changed")
    for path, expected in sources.items():
        require(file_sha(repo / path) == expected, "frozen source changed " + path)
    output_bytes = sum(p.stat().st_size for p in output.iterdir())
    require(output_bytes < 256 * 1024 ** 2 and time.monotonic() < deadline, "output/wall budget")
    result = {"method": "m2b-frozen-static-anomaly-observation/v1", "authority": "none", "eligible": False,
              "status": "ANOMALIES_REPRODUCED_CAUSE_NOT_QUALIFIED", "qualification": "INCOMPLETE", "product": "PRODUCT_DISABLED",
              "config": candidate["config"], "sourceIdentity": input_doc["source"], "sourceKey": confirmation["sourceKey"], "roi": roi,
              "candidateReceiptDigest": candidate["receiptDigest"], "promisedRange": candidate["range"], "maskSha256Unchanged": sha(packed),
              "framesBound": len(bindings), "anomalyFrames": len(anomalies), "contiguousAnomalyRuns": len(groups),
              "supportPixels": int(support.sum()), "uniqueChangedPixels": len(pixel_traces), "changedPixelOccurrences": sum(a["changedSupportPixels"] for a in anomalies),
              "maxChangedSupportBoundaryDistance": max((p["supportBoundaryDistance"] for p in pixel_traces), default=0),
              "supportCorePixelsDistanceAtLeast4": int((support & (distance >= 4)).sum()),
              "coreMaxEnvelopeDifference": max((f["supportCoreMaxEnvelopeDifference"] or 0 for f in frame_metrics), default=0),
              "nonzeroBestLocalIntegerOffsetFrames": sum(f["localAlignmentObservation"] is not None and f["localAlignmentObservation"]["bestLocalIntegerOffset"] != [0, 0] for f in frame_metrics),
              "alignmentMeaning": "OBSERVATION_ONLY: 25 offsets within +/-2px on support core; not alpha, deformation, subpixel or motion qualification",
              "independentRequiredPixelTruth": "MISSING", "maskCompleteness": "NOT_EVALUATED", "motionQualification": "NOT_EVALUATED",
              "freeze": frozen, "frozenMethodSources": sources, "runtime": {"numpy": np.__version__, "opencv": cv2.__version__},
              "wallSeconds": time.monotonic() - started, "parentPeakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
              "childPeakRssBytes": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * 1024, "supportTraceBytes": trace_bytes, "artifactBytes": output_bytes}
    save(output, "result.json", result)
    print(json.dumps({k: result[k] for k in ("status", "framesBound", "anomalyFrames", "contiguousAnomalyRuns", "uniqueChangedPixels", "maxChangedSupportBoundaryDistance", "coreMaxEnvelopeDifference", "wallSeconds")}))


if __name__ == "__main__":
    main(sys.argv[1:])
