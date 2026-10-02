"""M2-E offline metadata and frozen truth workflow. Never a product/admission owner.

Human evidence files are attestations to be checked by the parent; metadata cannot
authenticate a human or prove provenance by itself. No automatic registration.
"""
import base64
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import time

_spec = importlib.util.spec_from_file_location("m2d_comparator", Path(__file__).with_name("shape-cover-required-pixel-truth.py"))
comparator = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(comparator)
require, sha, file_sha = comparator.require, comparator.sha, comparator.file_sha
MAX_BYTES = 64 * 1024 ** 2
MAX_TRUTH_FRAMES = 192
RISK_METRICS = ("edgeEnergy", "edgeChroma", "rgbR", "rgbG", "rgbB", "rgbDelta", "backgroundLuma",
                "geometryOffset", "geometryCorrelation", "geometryLost")
DECLARATIONS = ("didNotAuthorMaskAlgorithm", "didNotInspectCandidateMask",
                "didNotInspectComparatorOutcomeBeforeTruthFreeze", "didNotReceiveExpectedPixelHints")
_TOKEN = object()


def encode(value):
    text = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False, ensure_ascii=False)
    require(len(text.encode()) <= MAX_BYTES, "artifact byte budget")
    return text


def digest(value):
    return sha(encode(value).encode())


def exact(value, keys, label):
    require(type(value) is dict and set(value) == set(keys), "unexpected or missing " + label + " fields")


def source_schema(value):
    required = {"fingerprint", "byteLength", "width", "height", "durationMs", "timeBase"}
    # Preserve the existing SourceIdentity clock/rotation interpretation fields.
    optional = {"rotation", "timeOriginPts", "interpretationVersion"}
    require(type(value) is dict and required <= set(value) <= required | optional, "unexpected or missing source fields")


def checked_refs(refs):
    require(type(refs) is dict and bool(refs), "actual evidence files missing")
    for name, expected in refs.items():
        require(type(name) is str and Path(name).is_file() and not Path(name).is_symlink()
                and file_sha(name) == expected, "frozen evidence/source changed: " + name)
    return refs


def validate_method(method):
    exact(method, ("detector", "extractor", "geometry", "files", "dependencies"), "method")
    for name in ("detector", "extractor", "geometry"):
        exact(method[name], ("method", "config"), name)
        require(type(method[name]["method"]) is str and "/v" in method[name]["method"]
                and type(method[name]["config"]) is dict and bool(method[name]["config"]), "method/config missing")
    require(type(method["dependencies"]) is dict and bool(method["dependencies"])
            and all(type(v) is str and v.strip() for v in method["dependencies"].values()), "runtime dependency versions missing")
    checked_refs(method["files"])


def make_plan(context, bindings, risk):
    exact(context, ("source", "sourceKey", "targetId", "confirmationDigest", "roi", "range"), "context")
    source_schema(context["source"])
    exact(context["roi"], ("x", "y", "width", "height"), "ROI")
    exact(context["range"], ("startFrame", "endFrame"), "range")
    require(type(bindings) is list and len(bindings) <= 20000, "frame budget")
    for binding in bindings:
        exact(binding, ("index", "pts", "endPts", "byteLength", "pixelSha256"), "frame binding")
    comparator.validate_bindings(context, bindings)
    exact(risk, ("contextDigest", "bindingsDigest", "complete", "metrics", "sceneCuts", "visibilityAmbiguities"), "risk")
    require(risk["complete"] is True and risk["contextDigest"] == digest(context)
            and risk["bindingsDigest"] == digest(bindings), "risk source/target/full-range binding")
    exact(risk["metrics"], RISK_METRICS, "risk metrics")
    ordinals = [b["index"] for b in bindings]
    selected = set()
    reasons = {}

    def add(index, reason, neighbors=False):
        require(type(index) is int and index in ordinal_set, "risk ordinal outside promised range")
        for j in range(max(ordinals[0], index - int(neighbors)), min(ordinals[-1], index + int(neighbors)) + 1):
            selected.add(j); reasons.setdefault(str(j), set()).add(reason)

    ordinal_set = set(ordinals)
    add(ordinals[0], "FIRST"); add(ordinals[-1], "LAST")
    for i in range(16):
        add(ordinals[round(i * (len(ordinals) - 1) / 15)], "TEMPORAL_ANCHOR")
    rng = random.Random(digest({"strategy": "static-risk-truth-plan/v2", "source": context["source"]["fingerprint"]}))
    for i in sorted(rng.sample(ordinals, min(16, len(ordinals)))):
        add(i, "DETERMINISTIC_RESERVED")
    for key, values in risk["metrics"].items():
        require(type(values) is list and len(values) == len(bindings)
                and all(type(v) in (int, float) and math.isfinite(v) for v in values), "incomplete risk metric " + key)
        for extreme in (min(values), max(values)):
            positions = [i for i, v in enumerate(values) if v == extreme]
            for i in (positions[0], positions[-1]):
                add(ordinals[i], key + "_EXTREME", True)
    for key in ("sceneCuts", "visibilityAmbiguities"):
        require(type(risk[key]) is list, "risk event list")
        events = sorted(set(risk[key]))
        require(all(type(i) is int and i in ordinal_set for i in events), "risk event outside promised range")
        # Full scene inventory stays frozen. Human review covers event quantiles,
        # not every background edit; geometry still covers the full target range.
        if key == "sceneCuts" and len(events) > 12:
            events = [events[round(j * (len(events) - 1) / 11)] for j in range(12)]
        for i in events:
            add(i, key, True)
    require(len(selected) <= MAX_TRUTH_FRAMES, "TRUTH_FRAME_BUDGET_EXCEEDED_SOURCE_INCOMPLETE")
    return {"schema": "static-risk-truth-plan/v2", "authority": "none", "eligible": False,
            "context": copy.deepcopy(context), "fullBindingsDigest": digest(bindings), "riskDigest": digest(risk),
            "bindings": [copy.deepcopy(b) for b in bindings if b["index"] in selected],
            "selectionReasons": {k: sorted(v) for k, v in reasons.items()}, "scope": "FROZEN_TRUTH_SET_ONLY"}


class Frozen:
    def __init__(self, data, token):
        require(token is _TOKEN, "unowned freeze")
        self._text = encode(data)
        self.digest = sha(self._text.encode())

    @property
    def data(self):
        return json.loads(self._text)


class Registry:
    def __init__(self, development_history=None):
        self.history = dict(development_history or {})
        self.records = {}
        self._owned = {}
        self._sources = {}
        self._plans = {}
        self._truths = {}
        self._candidates = {}

    def register(self, record):
        exact(record, ("sourceId", "sourcePath", "source", "provenanceClass", "independenceGroupId", "provenance",
                       "independence", "evidence", "exposure", "targetConfirmation"), "registry record")
        source_schema(record["source"])
        require(all(type(record[k]) is str and record[k].strip() for k in ("sourceId", "sourcePath", "independenceGroupId")), "source identity missing")
        require(record["sourceId"] not in self.records, "source already registered; history cannot be replaced")
        exact(record["provenance"], ("description", "rawRecordingId", "downloadedSourceId", "sameRawRecording",
                                     "sameDownloadedSource", "derived", "framesOverlap"), "provenance")
        require(record["provenanceClass"] in ("REAL_DOWNLOADED", "REAL_RECORDING", "DERIVED", "UNKNOWN", "CONTROLLED_TEST"), "provenance class")
        require(record["exposure"] in ("UNSEEN", "DEVELOPMENT_EXPOSED", "TRUTH_AUTHOR_EXPOSED", "COMPARATOR_EXPOSED"), "exposure status")
        require(record["independence"] in ("ACCEPTED", "REJECTED", "INDEPENDENCE_UNKNOWN"), "independence status")
        require(record["targetConfirmation"] in ("CONFIRMED_STATIC", "NOT_CONFIRMED", "UNKNOWN"), "target confirmation status")
        for key in ("sameRawRecording", "sameDownloadedSource", "derived", "framesOverlap"):
            require(type(record["provenance"][key]) is bool or record["provenance"][key] == "UNKNOWN", "independence evidence missing " + key)
        fingerprint = record["source"]["fingerprint"]
        require(fingerprint.startswith("sha256:") and len(fingerprint) == 71, "source fingerprint")
        prior = [r for r in self.records.values() if self._same_group(record, r) and r["developmentExposed"]]
        exposed = fingerprint in self.history or record["independenceGroupId"] in self.history or prior or record["exposure"] == "DEVELOPMENT_EXPOSED"
        require(not exposed or record["exposure"] != "UNSEEN", "DEVELOPMENT_EXPOSED cannot become unseen")
        value = copy.deepcopy(record)
        value.update(authority="none", eligible=False, developmentExposed=bool(exposed), truthStatus="MISSING",
                     reviewerStatus="MISSING", usage="REGISTERED_NOT_FROZEN", evidenceDigest=digest(record["evidence"]))
        self.records[record["sourceId"]] = value
        if exposed:
            self.history[fingerprint] = "DEVELOPMENT_EXPOSED"
            for existing in self.records.values():
                if self._same_group(value, existing):
                    existing["developmentExposed"] = True

    @staticmethod
    def _same_group(left, right):
        if left["source"]["fingerprint"] == right["source"]["fingerprint"] or left["independenceGroupId"] == right["independenceGroupId"]:
            return True
        return any(left["provenance"][k] and left["provenance"][k] != "UNKNOWN" and left["provenance"][k] == right["provenance"][k]
                   for k in ("rawRecordingId", "downloadedSourceId"))

    @staticmethod
    def _independent(record):
        p = record["provenance"]
        return record["independence"] == "ACCEPTED" and record["provenanceClass"] not in ("UNKNOWN", "DERIVED") and bool(record["evidence"]) \
            and all(p[k] is False for k in ("sameRawRecording", "sameDownloadedSource", "derived", "framesOverlap")) \
            and all(type(p[k]) is str and p[k].strip() and p[k] != "UNKNOWN" for k in ("description", "rawRecordingId", "downloadedSourceId"))

    def count_ready_sources(self):
        # Controlled tests exercise the protocol but never count as real material.
        return sum(r["usage"] == "HOLDOUT_FROZEN" and not r["developmentExposed"] and self._independent(r)
                   and r["provenanceClass"] in ("REAL_DOWNLOADED", "REAL_RECORDING") for r in self.records.values())

    def _freeze(self, kind, data, refs, parent=None):
        checked_refs(refs)
        data = {**data, "authority": "none", "eligible": False}
        frozen = Frozen(data, _TOKEN)
        self._owned[frozen] = (kind, dict(refs), parent)
        return frozen

    def _assert(self, handle, kind):
        require(type(handle) is Frozen and handle in self._owned and self._owned[handle][0] == kind, "unowned or cloned " + kind)
        require(sha(handle._text.encode()) == handle.digest, "frozen bytes changed")
        checked_refs(self._owned[handle][1])
        if kind == "source" and handle.data["usage"] == "HOLDOUT_FROZEN":
            require(not self.records[handle.data["record"]["sourceId"]]["developmentExposed"], "holdout later exposed for development")
        return handle.data

    def freeze_source(self, source_id, method, development=False):
        record = self.records[source_id]
        require(source_id not in self._sources, "source/method already frozen")
        require(development or (not record["developmentExposed"] and record["exposure"] == "UNSEEN"), "DEVELOPMENT_EXPOSED or previously exposed source")
        require(development or self._independent(record), "INDEPENDENCE_UNKNOWN_OR_DERIVED")
        require(record["targetConfirmation"] == "CONFIRMED_STATIC", "target unconfirmed")
        for other_id in self._sources:
            require(not self._same_group(record, self.records[other_id]), "SAME_SOURCE_DUPLICATE_INDEPENDENCE_GROUP")
        validate_method(method)
        refs = {record["sourcePath"]: record["source"]["fingerprint"].removeprefix("sha256:"), **record["evidence"], **method["files"]}
        checked_refs(refs)
        require(Path(record["sourcePath"]).stat().st_size == record["source"]["byteLength"], "source length changed")
        for key in ("width", "height", "durationMs"):
            require(type(record["source"][key]) is int and record["source"][key] > 0, "source extent/duration")
        record["usage"] = "DEVELOPMENT_TOOLING_ONLY" if development else "HOLDOUT_FROZEN"
        frozen = self._freeze("source", {"record": record, "usage": record["usage"], "method": method, "methodDigest": digest(method)}, refs)
        self._sources[source_id] = frozen
        return frozen

    def freeze_plan(self, source, context, bindings, risk):
        data = self._assert(source, "source")
        require(source not in self._plans, "truth plan already frozen; no adaptive reselection")
        require(context["source"] == data["record"]["source"], "plan wrong source")
        plan = self._freeze("plan", make_plan(context, bindings, risk), self._owned[source][1], source)
        self._plans[source] = (plan, copy.deepcopy(bindings))
        return plan

    def freeze_truth(self, plan, truth, author_ref, qa_ref):
        planned = self._assert(plan, "plan")
        require(plan not in self._truths, "truth already frozen; no correction after freeze")
        exact(truth, ("schema", "authority", "eligible", "planDigest", "context", "boundaryReview", "frames"), "truth")
        require(truth["schema"] == "static-roi-human-truth/v1" and truth["authority"] == "none" and truth["eligible"] is False
                and truth["planDigest"] == plan.digest and truth["context"] == planned["context"], "truth source/target/plan binding")
        require(truth["boundaryReview"] in ("BOUNDED", "UNKNOWN"), "boundary review")
        require(len(truth["frames"]) == len(planned["bindings"]), "incomplete truth frame set")
        pixels = planned["context"]["roi"]["width"] * planned["context"]["roi"]["height"]
        for frame, binding in zip(truth["frames"], planned["bindings"]):
            exact(frame, ("binding", "labelsBase64", "truthSha256"), "truth frame")
            require(frame["binding"] == binding, "truth original PTS/hash/ordinal binding")
            raw = base64.b64decode(frame["labelsBase64"], validate=True)
            require(len(raw) == pixels and sha(raw) == frame["truthSha256"] and all(x <= 2 for x in raw), "truth raster changed or incomplete")
        refs = {**self._owned[plan][1]}
        declarations = []
        for role, ref in (("AUTHOR", author_ref), ("QA", qa_ref)):
            exact(ref, ("path", "sha256"), "human evidence reference")
            checked_refs({ref["path"]: ref["sha256"]})
            require(Path(ref["path"]).stat().st_size < 64 * 1024, "declaration byte budget")
            declaration = json.loads(Path(ref["path"]).read_text())
            exact(declaration, (*DECLARATIONS, "reviewerId", "role", "decision", "truthContentDigest", "planDigest", "evidenceClass"), "reviewer declaration")
            require(declaration["role"] == role and type(declaration["reviewerId"]) is str and declaration["reviewerId"].strip()
                    and all(declaration[k] is True for k in DECLARATIONS), "REVIEWER_NOT_INDEPENDENT")
            require(declaration["decision"] == "APPROVE" and declaration["truthContentDigest"] == digest(truth)
                    and declaration["planDigest"] == plan.digest, "truth QA UNKNOWN/correction/stale")
            require(declaration["evidenceClass"] in ("ACTUAL_HUMAN_ATTESTATION", "CONTROLLED_TEST"), "human evidence class")
            declarations.append(declaration); refs[ref["path"]] = ref["sha256"]
        require(declarations[0]["reviewerId"].strip() != declarations[1]["reviewerId"].strip(), "REVIEWER_NOT_INDEPENDENT")
        source = self._owned[plan][2]
        record = self.records[self._assert(source, "source")["record"]["sourceId"]]
        record.update(truthStatus="FROZEN", reviewerStatus="DECLARATIONS_BOUND_REQUIRES_PARENT_IDENTITY_CHECK", exposure="TRUTH_AUTHOR_EXPOSED")
        frozen = self._freeze("truth", {"truth": truth, "declarations": declarations, "planDigest": plan.digest}, refs, plan)
        self._truths[plan] = frozen
        return frozen

    def accept_actual_evidence(self, source, truth, verify_actual_evidence):
        """Trusted parent callback must actually check provenance and both human identities.

        JSON strings, user-supplied verdict dictionaries and a model report are not this
        callback. This records an offline decision only, never a product capability.
        """
        self._assert(source, "source"); self._assert(truth, "truth")
        require(callable(verify_actual_evidence) and verify_actual_evidence(source.data, truth.data) is True,
                "ACTUAL_INDEPENDENCE_AND_REVIEW_NOT_VERIFIED")
        return self._freeze("parent-evidence", {"sourceDigest": source.digest, "truthDigest": truth.digest},
                            {**self._owned[source][1], **self._owned[truth][1]})

    def compare(self, source, plan, truth, candidate, cancel=lambda: False, actual_evidence=None):
        started = time.monotonic()
        if cancel(): raise InterruptedError("cancelled")
        exact(candidate, ("context", "bindings", "methodDigest", "mask", "geometry"), "candidate")
        candidate = copy.deepcopy(candidate)
        candidate_digest = digest(candidate)
        frozen_source, planned, frozen_truth = self._assert(source, "source"), self._assert(plan, "plan"), self._assert(truth, "truth")
        require(self._owned[plan][2] is source and self._owned[truth][2] is plan, "wrong source/target handle")
        bindings = self._plans[source][1]
        require(candidate["context"] == planned["context"] and candidate["bindings"] == bindings, "candidate wrong source/target/PTS")
        require(candidate["methodDigest"] == frozen_source["methodDigest"], "candidate method version changed")
        validate_method(frozen_source["method"])
        geometry = candidate["geometry"]
        require(geometry["contextDigest"] == digest(planned["context"]) and geometry["bindingsDigest"] == digest(bindings)
                and geometry["methodDigest"] == frozen_source["methodDigest"], "geometry source/range/method binding")
        require(source not in self._candidates or self._candidates[source] == candidate_digest,
                "FROZEN_CANDIDATE_CHANGED_NEW_METHOD_AND_HOLDOUT_REQUIRED")
        self._candidates[source] = candidate_digest
        totals = {k: 0 for k in ("requiredPixels", "missedRequiredPixels", "missingRequiredFrames", "excessPixels", "comparedFrames")}
        reasons, observed_misses = [], 0
        for frame in frozen_truth["truth"]["frames"]:
            if cancel(): raise InterruptedError("cancelled")
            require(time.monotonic() - started < 300, "comparator wall budget")
            context = copy.deepcopy(planned["context"])
            index = frame["binding"]["index"]
            context["range"] = {"startFrame": index, "endFrame": index + 1}
            packet = {"method": "independent-required-pixel-packet/v1", "context": context, "scope": "REAL_MEDIA",
                      "origin": "INDEPENDENT_ANNOTATION", "authorId": frozen_truth["declarations"][0]["reviewerId"],
                      "reviewerId": frozen_truth["declarations"][1]["reviewerId"], "boundaryReview": frozen_truth["truth"]["boundaryReview"],
                      "provenance": [{"method": "frozen-human-required-pixels/v1", "sha256": truth.digest}],
                      "frames": [{"binding": frame["binding"], "motion": "STATIC", "truthSha256": frame["truthSha256"]}],
                      "rasters": {frame["truthSha256"]: frame["labelsBase64"]}}
            result = comparator.compare(context, [frame["binding"]], candidate["mask"], packet)
            observed_misses += result["observed"]["knownMissedRequiredPixels"]
            reasons.extend(r for r in result["reasons"] if r != "REAL_MEDIA_INDEPENDENCE_AND_REVIEW_NOT_VERIFIED")
            for key in totals:
                if result["metrics"][key] is not None: totals[key] += result["metrics"][key]
        if geometry["complete"] is not True or geometry["issues"] != 0 or geometry["supportedMorphology"] is not True:
            reasons.append("FULL_RANGE_GEOMETRY_OR_MORPHOLOGY_INCOMPLETE")
        if frozen_source["usage"] != "HOLDOUT_FROZEN": reasons.append("DEVELOPMENT_SOURCE_NOT_HOLDOUT")
        self._assert(source, "source"); self._assert(truth, "truth")
        if cancel(): raise InterruptedError("cancelled")
        controlled = frozen_source["record"]["provenanceClass"] == "CONTROLLED_TEST" or any(d["evidenceClass"] == "CONTROLLED_TEST" for d in frozen_truth["declarations"])
        # Real qualification additionally needs parent-authenticated independence and reviewer receipts.
        if not controlled:
            if actual_evidence is None:
                reasons.append("ACTUAL_INDEPENDENCE_AND_REVIEW_REQUIRE_PARENT_ACCEPTANCE")
            else:
                accepted = self._assert(actual_evidence, "parent-evidence")
                require(accepted["sourceDigest"] == source.digest and accepted["truthDigest"] == truth.digest, "wrong actual evidence acceptance")
        status = "SOURCE_NOT_QUALIFIED" if observed_misses else "SOURCE_INCOMPLETE" if reasons else "SOURCE_QUALIFIED"
        output = {"schema": "static-holdout-comparison/v1", "authority": "none", "eligible": False, "status": status,
                  "claim": "ZERO_MISS_ON_FROZEN_TRUTH_SET" if status == "SOURCE_QUALIFIED" else None,
                  "evidenceClass": "CONTROLLED_TEST_NOT_REAL_QUALIFICATION" if controlled else "REAL_MEDIA_OFFLINE_ONLY",
                  "metrics": dict.fromkeys(totals) if reasons else totals, "observedMissedRequiredPixels": observed_misses,
                  "reasons": sorted(set(reasons)), "sourceDigest": source.digest, "planDigest": plan.digest, "truthDigest": truth.digest,
                  "candidateDigest": candidate_digest, "selectedOrdinals": [b["index"] for b in planned["bindings"]],
                  "product": "PRODUCT_DISABLED", "modelRequests": 0, "comparatorSeconds": time.monotonic() - started}
        encode(output)
        record = self.records[frozen_source["record"]["sourceId"]]
        record.update(exposure="COMPARATOR_EXPOSED", usage=status if not controlled else "CONTROLLED_TEST_ONLY")
        return output
