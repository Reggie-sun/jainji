"""Private application geometry worker. Inputs are issued by the live TS owner, not a proof API."""
import importlib.util
import json
from pathlib import Path
import sys
import time

spec = importlib.util.spec_from_file_location("frozen_geometry", Path(__file__).with_name("shape-cover-static-geometry.py"))
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


def run(manifest):
    g = geometry
    deadline = time.monotonic() + manifest["remainingSeconds"]
    roi, bindings = manifest["roi"], manifest["bindings"]
    samples = []
    selected = [b for b in bindings if b["index"] in manifest["sampleOrdinals"]]
    g.replay.decode(Path(manifest["sourcePath"]), Path(manifest["ffmpegPath"]), roi, selected,
                    manifest["timeBase"], lambda frame, _binding: samples.append(frame.copy()), deadline)
    box = {**manifest["envelope"], "x": manifest["envelope"]["x"] - roi["x"], "y": manifest["envelope"]["y"] - roi["y"]}
    model = g.build_model(g.np.stack(samples), box)
    del samples
    reference = g.model_document(model, roi)
    frames = []
    anomalies = set(manifest["historicalRgbOrdinals"])
    def consume(frame, binding):
        frames.append({**binding, **g.measure_frame(frame, model), "oldRgbAnomaly": binding["index"] in anomalies})
    g.replay.decode(Path(manifest["sourcePath"]), Path(manifest["ffmpegPath"]), roi, bindings, manifest["timeBase"], consume, deadline)
    json.dump({"config": g.CONFIG, "reference": reference, "frames": frames,
               "dependencies": {"numpy": g.np.__version__, "opencv": g.cv2.__version__}}, sys.stdout, separators=(",", ":"), allow_nan=False)


if __name__ == "__main__":
    run(json.loads(Path(sys.argv[1]).read_text()))
