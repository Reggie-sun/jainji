"""Read-only M2-E media inventory; similarity is a reuse warning, never independence proof."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

import numpy as np

MEDIA = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
SKIP = {"node_modules", ".git", ".codex", "dist", "dist-electron", "dist-ffmpeg", "runs"}


def file_sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fingerprint(path, duration, ffmpeg):
    samples = []
    for fraction in np.linspace(.02, .98, 8):
        result = subprocess.run([str(ffmpeg), "-v", "error", "-nostdin", "-threads", "1", "-ss", str(float(fraction) * duration),
                                 "-i", str(path), "-frames:v", "1", "-vf", "scale=9:8", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
                                capture_output=True, timeout=15, check=True)
        if len(result.stdout) != 72:
            raise ValueError("sparse decode extent")
        gray = np.frombuffer(result.stdout, np.uint8).reshape(8, 9)
        bits = (gray[:, 1:] > gray[:, :-1]).ravel()
        samples.append({"fraction": float(fraction), "dhash": sum(int(b) << i for i, b in enumerate(bits)),
                        "mean": float(gray.mean()), "std": float(gray.std())})
    return samples


def similarity(left, right):
    if left["sha256"] == right["sha256"]:
        return {"status": "LIKELY_SAME_SOURCE", "matches": [], "reason": "EXACT_BYTES"}
    if not left.get("samples") or not right.get("samples"):
        return {"status": "UNKNOWN", "matches": [], "reason": "SPARSE_EVIDENCE_MISSING"}
    matches = []
    # Match distinct time samples. Uniform frames cannot create a source-reuse finding.
    used = set()
    for i, a in enumerate(left["samples"]):
        for j, b in enumerate(right["samples"]):
            if j not in used and min(a["std"], b["std"]) >= 15 and abs(a["mean"] - b["mean"]) <= 12 and (a["dhash"] ^ b["dhash"]).bit_count() <= 4:
                matches.append([i, j]); used.add(j); break
    status = "LIKELY_DERIVED" if len(matches) >= 2 else "NO_STRONG_MATCH"
    return {"status": status, "matches": matches, "reason": "SPARSE_REUSE_WARNING_NOT_INDEPENDENCE_PROOF"}


def scan(roots, ffmpeg, ffprobe, exposed, output):
    started = time.monotonic()
    paths = {}
    for classification, root in roots:
        for path in sorted(Path(root).rglob("*")):
            if path.is_file() and not path.is_symlink() and path.suffix.lower() in MEDIA and not SKIP.intersection(path.relative_to(root).parts):
                paths[str(path.resolve())] = classification
    items, unique = [], {}
    for name, classification in sorted(paths.items()):
        path = Path(name); digest = file_sha(path)
        before = path.stat()
        item = {"path": name, "class": classification, "sha256": digest, "byteLength": before.st_size,
                "provenance": "UNKNOWN", "independence": "INDEPENDENCE_UNKNOWN", "staticTarget": "NOT_CONFIRMED",
                "exposure": "DEVELOPMENT_EXPOSED" if digest in exposed else "CANDIDATE_UNSEEN_NOT_VERIFIED"}
        try:
            metadata = json.loads(subprocess.run([str(ffprobe), "-v", "error", "-select_streams", "v:0", "-show_entries",
                "stream=width,height,duration,time_base:format=duration", "-of", "json", name], capture_output=True, check=True, timeout=15).stdout)
            stream = metadata["streams"][0]
            item.update(width=stream["width"], height=stream["height"], duration=float(stream.get("duration", metadata["format"]["duration"])), timeBase=stream["time_base"])
        except (ValueError, KeyError, subprocess.SubprocessError) as error:
            item["error"] = str(error)
        after = path.stat()
        if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
            raise ValueError("source changed during inventory " + name)
        items.append(item); unique.setdefault(digest, item)
    inventory_seconds = time.monotonic() - started
    similarity_started = time.monotonic()
    for item in unique.values():
        if "duration" in item:
            try:
                item["samples"] = fingerprint(item["path"], item["duration"], ffmpeg)
            except (ValueError, subprocess.SubprocessError) as error:
                item["similarityError"] = str(error)
            if file_sha(item["path"]) != item["sha256"]:
                raise ValueError("source changed during similarity audit")
    source_items = [item for item in unique.values() if item["class"] == "USER_SOURCE"]
    parents = {item["sha256"]: item["sha256"] for item in source_items}

    def root(key):
        while parents[key] != key:
            key = parents[key]
        return key

    pairs = []
    for i, left in enumerate(source_items):
        for right in source_items[i + 1:]:
            finding = similarity(left, right)
            if finding["status"] in ("LIKELY_SAME_SOURCE", "LIKELY_DERIVED", "UNKNOWN"):
                pairs.append({"left": left["sha256"], "right": right["sha256"], **finding})
            if finding["status"] in ("LIKELY_SAME_SOURCE", "LIKELY_DERIVED"):
                parents[root(right["sha256"])] = root(left["sha256"])
    groups = {}
    for item in source_items:
        groups.setdefault(root(item["sha256"]), []).append(item["sha256"])
    exposed_groups = [group for group in groups.values() if set(group).intersection(exposed)]
    possibly_exposed = set().union(*map(set, exposed_groups)) if exposed_groups else set()
    summary = {"totalFiles": len(items), "userSourceFiles": sum(i["class"] == "USER_SOURCE" for i in items),
        "uniqueUserSourceSha": len(source_items), "uniqueAllSha": len(unique), "suspectedSourceGroups": len(groups),
        "confirmedDevelopmentExposedHashes": len(set(unique).intersection(exposed)),
        "candidateUnseenHashes": sum(i["sha256"] not in possibly_exposed for i in source_items),
        "candidateUnseenGroups": sum(not set(g).intersection(possibly_exposed) for g in groups.values()),
        "possibleIndependentGroups": sum(not set(g).intersection(possibly_exposed) for g in groups.values()),
        "confirmedIndependentSources": 0, "confirmedUnseenStaticSources": 0, "unknownProvenance": len(source_items),
        "requiredIndependentStaticSources": 3, "status": "HOLDOUT_INSUFFICIENT"}
    report = {"method": "read-only-sparse-media-reuse-audit/v1", "authority": "none", "eligible": False, "modelRequests": 0,
        "roots": [(c, str(r)) for c, r in roots], "summary": summary, "items": items, "uniqueMedia": list(unique.values()),
        "suspectedGroups": list(groups.values()), "pairs": pairs, "exposureEvidence": exposed,
        "limitations": ["NO_STRONG_MATCH_IS_NOT_INDEPENDENT", "SPARSE_MATCH_CAN_BE_FALSE_POSITIVE_OR_MISS_REUSE",
                        "STATIC_TARGETS_NOT_CONFIRMED", "NO_AUTOMATIC_HOLDOUT_REGISTRATION"],
        "inventorySeconds": inventory_seconds, "similaritySeconds": time.monotonic() - similarity_started}
    payload = json.dumps(report, indent=2, ensure_ascii=False).encode()
    Path(output).write_bytes(payload)
    print(json.dumps({**summary, "inventorySeconds": inventory_seconds, "similaritySeconds": report["similaritySeconds"], "artifactBytes": len(payload)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-root", required=True); parser.add_argument("--repo", required=True)
    parser.add_argument("--private-root", required=True); parser.add_argument("--exposure", required=True)
    parser.add_argument("--ffmpeg", required=True); parser.add_argument("--ffprobe", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    roots = [("USER_SOURCE", p) for p in sorted(Path(args.user_root).glob("*/素材"))]
    roots += [("REPOSITORY_MEDIA_NOT_ASSUMED_REAL", Path(args.repo)), ("PRIVATE_EVIDENCE_NOT_ASSUMED_REAL", Path(args.private_root))]
    scan(roots, args.ffmpeg, args.ffprobe, json.loads(Path(args.exposure).read_text()), args.output)
