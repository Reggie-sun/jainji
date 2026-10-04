"""cpu-static-geometry/v2: component-local references, immutable v1 kernel/limits.

Option A: insufficient component signal is UNOBSERVABLE, never an omitted component.
No additional geometry thresholds. Landmark centers are inside each sourceBox;
the frozen Gaussian/Sobel and finite translation search use bounded local neighbors.
"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("historical_geometry", Path(__file__).with_name("shape-cover-static-geometry.py"))
kernel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kernel)
CONFIG = {"method": "cpu-static-component-geometry/v2", "kernel": kernel.CONFIG,
          "referencePadding": 0, "gradientSupportRadius": 3,
          "searchSupportRadius": 8, "unobservablePolicy": "ALL_COMPONENTS_REQUIRED"}


def build_component_model(samples, box):
    g = kernel
    model = g.build_model(samples, box)
    xy, cells = model["xy"], model["cells"]
    inside = ((xy[:, 0] >= box["x"]) & (xy[:, 0] < box["x"] + box["width"])
              & (xy[:, 1] >= box["y"]) & (xy[:, 1] < box["y"] + box["height"]))
    # Keep original per-cell requirements after removing any padding-only evidence.
    usable = [c for c in range(9) if int((inside & (cells == c)).sum()) >= g.CONFIG["minimumLandmarksPerCell"]]
    selected = inside & g.np.isin(cells, usable)
    g.require(len(usable) >= g.CONFIG["minimumCells"], "COMPONENT_GEOMETRY_UNOBSERVABLE: insufficient component-local cells")
    points = xy[selected]
    g.require(g.np.ptp(points[:, 0]) >= box["width"] * g.CONFIG["minimumSpatialSpan"]
              and g.np.ptp(points[:, 1]) >= box["height"] * g.CONFIG["minimumSpatialSpan"],
              "COMPONENT_GEOMETRY_UNOBSERVABLE: component-local span")
    return {**model, "xy": points, "vectors": model["vectors"][selected], "cells": cells[selected]}


def run_components(manifest):
    g = kernel
    import time
    deadline = time.monotonic() + manifest["remainingSeconds"]
    roi, bindings = manifest["roi"], manifest["bindings"]
    samples = []
    selected = [b for b in bindings if b["index"] in manifest["sampleOrdinals"]]
    g.replay.decode(Path(manifest["sourcePath"]), Path(manifest["ffmpegPath"]), roi, selected,
                    manifest["timeBase"], lambda frame, _binding: samples.append(frame.copy()), deadline)
    stack = g.np.stack(samples)
    components, models = [], []
    for component in manifest["components"]:
        box = component["sourceBox"]
        local = {**box, "x": box["x"] - roi["x"], "y": box["y"] - roi["y"]}
        try:
            model = build_component_model(stack, local)
            reference = g.model_document(model, roi)
            reason = None
        except ValueError as error:
            # Budget/extent/type errors are failures, not missing signal.
            if "landmark" not in str(error) and "COMPONENT_GEOMETRY_UNOBSERVABLE" not in str(error):
                raise
            model, reference, reason = None, None, "COMPONENT_GEOMETRY_UNOBSERVABLE"
        components.append({**component, "reference": reference, "unobservableReason": reason, "frames": []})
        models.append(model)
    del samples, stack
    anomalies = set(manifest["historicalRgbOrdinals"])
    def consume(frame, binding):
        for component, model in zip(components, models):
            if model is not None:
                component["frames"].append({**binding, **g.measure_frame(frame, model),
                                            "oldRgbAnomaly": binding["index"] in anomalies})
    # Even unobservable components do not truncate the exact source range replay.
    g.replay.decode(Path(manifest["sourcePath"]), Path(manifest["ffmpegPath"]), roi, bindings, manifest["timeBase"], consume, deadline)
    return {"config": CONFIG, "components": components,
            "dependencies": {"numpy": g.np.__version__, "opencv": g.cv2.__version__}}
