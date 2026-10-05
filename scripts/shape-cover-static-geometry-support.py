"""Immutable v3 reference selection: detector membership owns every anchor and its gradient stencil.

No bbox, ROI padding, final mask or caller-authored raster defines membership.
Reuse frozen v1 math/thresholds; only reference eligibility changes in this version.
"""
import base64
import importlib.util
from pathlib import Path
import time

spec = importlib.util.spec_from_file_location("historical_geometry", Path(__file__).with_name("shape-cover-static-geometry.py"))
kernel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kernel)
CONFIG = {"method": "cpu-static-component-geometry/v3", "kernel": kernel.CONFIG,
          "referencePadding": 0, "anchorPolicy": "COMPONENT_MEMBERSHIP_WITH_OWNED_GRADIENT_NEIGHBORHOOD",
          "gradientSupportRadius": 3, "searchSupportRadius": 8, "unobservablePolicy": "ALL_COMPONENTS_REQUIRED"}


def support_raster(support, roi):
    g = kernel
    gw, gh = support["gridWidth"], support["gridHeight"]
    sw, sh = support["sourceWidth"], support["sourceHeight"]
    bits = g.np.unpackbits(g.np.frombuffer(base64.b64decode(support["dataBase64"], validate=True), g.np.uint8), bitorder="little")[:gw * gh].reshape(gh, gw)
    xs = ((g.np.arange(roi["width"]) + roi["x"] + 1) * gw - 1) // sw
    ys = ((g.np.arange(roi["height"]) + roi["y"] + 1) * gh - 1) // sh
    return bits[ys[:, None], xs[None, :]].astype(bool)


def build_component_model(samples, box, membership):
    g, c = kernel, kernel.CONFIG
    height, width = samples.shape[1:3]
    g.require(membership.shape == (height, width), "component support extent")
    stack = g.np.stack([g.gradients(frame) for frame in samples])
    reference = g.np.median(stack, axis=0)
    norm = g.np.linalg.norm(reference, axis=-1)
    observed = g.np.linalg.norm(stack, axis=-1)
    cosine = (stack * reference).sum(axis=-1) / g.np.maximum(observed * norm, 1e-12)
    ratio = observed / g.np.maximum(norm, 1e-12)
    agree = (cosine >= c["sampleDirectionCosine"]) & (ratio >= c["sampleStrengthRatio"][0]) & (ratio <= c["sampleStrengthRatio"][1])
    # Gaussian5 + Sobel3 uses radius3. Requiring its entire stencil to be owned
    # also prevents a valid center from borrowing all its gradient from adjacent padding.
    owned_gradient = g.cv2.erode(membership.astype(g.np.uint8), g.np.ones((7, 7), g.np.uint8), borderType=g.cv2.BORDER_CONSTANT, borderValue=0).astype(bool)
    eligible = owned_gradient & (norm >= c["minimumGradient"]) & (agree.mean(axis=0) >= c["sampleConsensus"])
    yy, xx = g.np.indices((height, width)); margin = c["searchRadius"] + 2
    eligible &= (xx >= max(margin, box["x"])) & (xx < min(width-margin, box["x"]+box["width"]))
    eligible &= (yy >= max(margin, box["y"])) & (yy < min(height-margin, box["y"]+box["height"]))
    eligible &= (xx % 2 == 0) & (yy % 2 == 0)
    cell_x = g.np.clip((xx-box["x"]) * 3 // box["width"], 0, 2)
    cell_y = g.np.clip((yy-box["y"]) * 3 // box["height"], 0, 2)
    points, cells = [], []
    for cell in range(9):
        ys, xs = g.np.where(eligible & (cell_y*3+cell_x == cell))
        order = sorted(range(len(xs)), key=lambda i: (-norm[ys[i],xs[i]], int(ys[i]), int(xs[i])))[:c["landmarksPerCell"]]
        if len(order) < c["minimumLandmarksPerCell"]:
            continue
        for i in order:
            points.append([int(xs[i]),int(ys[i])]); cells.append(cell)
    g.require(len(set(cells)) >= c["minimumCells"], "COMPONENT_GEOMETRY_UNOBSERVABLE: insufficient support-owned landmarks")
    xy = g.np.array(points, g.np.int32)
    g.require(g.np.ptp(xy[:,0]) >= box["width"]*c["minimumSpatialSpan"] and g.np.ptp(xy[:,1]) >= box["height"]*c["minimumSpatialSpan"], "COMPONENT_GEOMETRY_UNOBSERVABLE: support-owned span")
    return {"extent": [width,height], "box": dict(box), "xy": xy,
            "vectors": reference[xy[:,1],xy[:,0]], "cells": g.np.array(cells,g.np.int32), "sampleCount": len(samples)}


def run_components(manifest):
    g = kernel
    deadline = time.monotonic() + manifest["remainingSeconds"]
    roi, bindings = manifest["roi"], manifest["bindings"]
    samples = []
    selected = [b for b in bindings if b["index"] in manifest["sampleOrdinals"]]
    g.replay.decode(Path(manifest["sourcePath"]), Path(manifest["ffmpegPath"]), roi, selected, manifest["timeBase"], lambda frame,_binding: samples.append(frame.copy()), deadline)
    stack = g.np.stack(samples); components, models = [], []
    for component in manifest["components"]:
        box = component["sourceBox"]; local = {**box,"x":box["x"]-roi["x"],"y":box["y"]-roi["y"]}
        try:
            model = build_component_model(stack,local,support_raster(component["support"],roi))
            reference, reason = g.model_document(model,roi), None
        except ValueError as error:
            if "COMPONENT_GEOMETRY_UNOBSERVABLE" not in str(error):
                raise
            model, reference, reason = None,None,"COMPONENT_GEOMETRY_UNOBSERVABLE"
        components.append({**component,"reference":reference,"unobservableReason":reason,"frames":[]}); models.append(model)
    del samples, stack
    anomalies = set(manifest["historicalRgbOrdinals"])
    def consume(frame,binding):
        for component,model in zip(components,models):
            if model is not None:
                component["frames"].append({**binding,**g.measure_frame(frame,model),"oldRgbAnomaly":binding["index"] in anomalies})
    g.replay.decode(Path(manifest["sourcePath"]), Path(manifest["ffmpegPath"]), roi,bindings,manifest["timeBase"],consume,deadline)
    return {"config":CONFIG,"components":components,"dependencies":{"numpy":g.np.__version__,"opencv":g.cv2.__version__}}
