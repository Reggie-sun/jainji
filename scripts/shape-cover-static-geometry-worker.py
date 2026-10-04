"""Private corrected geometry worker. No caller-authored geometry or v1 issuance."""
import importlib.util
import json
from pathlib import Path
import sys


def run(manifest):
    if manifest.get("method") != "cpu-static-geometry/v2":
        raise ValueError("Only corrected cpu-static-geometry/v2 may be newly issued")
    spec = importlib.util.spec_from_file_location("component_geometry", Path(__file__).with_name("shape-cover-static-geometry-components.py"))
    components = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(components)
    return components.run_components(manifest)


if __name__ == "__main__":
    json.dump(run(json.loads(Path(sys.argv[1]).read_text())), sys.stdout, separators=(",", ":"), allow_nan=False)
