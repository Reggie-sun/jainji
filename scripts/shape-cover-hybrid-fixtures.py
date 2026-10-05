"""Frozen H2 construction cases; no model, mask, holdout or production calls."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype("DejaVuSans-Bold.ttf", 13)
small = ImageFont.truetype("DejaVuSans.ttf", 10)
width, height, frames = 320, 240, 18
cases = ["overlay", "box-print", "bottle-print", "subtitle", "video-title",
         "logo-and-print", "multi-component", "padding", "background", "moving", "disappear",
         "four-overlays", "twelve-overlays", "thirteen-overlays"]
manifest = []
for case in cases:
    raw = bytearray()
    for f in range(frames):
        image = Image.new("RGB", (width, height))
        image.putdata([tuple((f * 61 + x * 7 + y * 11 + c * 37) % 180 + 30 for c in range(3))
                       for y in range(height) for x in range(width)])
        d = ImageDraw.Draw(image)
        def logo(x=250, y=14):
            d.rounded_rectangle((x, y, x + 52, y + 31), radius=7, fill="#183bdd", outline="white", width=3)
            d.text((x + 6, y + 7), "EDIT", fill="white", font=font)
        def box():
            d.polygon([(246, 63), (302, 68), (302, 143), (246, 135)], fill="#d7aa6d", outline="#573415")
            d.polygon([(246, 63), (235, 72), (235, 143), (246, 135)], fill="#927349")
            d.line([(250, 77), (296, 81)], fill="#573415", width=2)
            d.text((251, 92), "BRAND", font=small, fill="#452719")
            d.text((251, 112), "SOAP", font=small, fill="#452719")
        if case in ["overlay", "logo-and-print"]:
            logo()
        if case in ["box-print", "logo-and-print"]:
            box()
        if case == "bottle-print":
            d.rectangle((140, 65, 164, 78), fill="#393939")
            d.rounded_rectangle((131, 78, 174, 152), radius=8, fill="#d6f1df", outline="#193c25", width=2)
            d.rectangle((135, 98, 170, 137), fill="#f3e4b8")
            d.text((137, 101), "BRAND", font=small, fill="#193c25")
            d.text((140, 119), "OIL", font=small, fill="#193c25")
        if case in ["subtitle", "video-title"]:
            y = 211 if case == "subtitle" else 100
            d.rectangle((76, y - 3, 246, y + 20), fill="#171717")
            d.text((81, y), "Here is today's product" if case == "subtitle" else "TODAY'S PRODUCT", font=font, fill="white")
        if case == "multi-component":
            # One thought sticker: blue speech body and detached blue thought dot.
            d.rounded_rectangle((222, 16, 286, 52), radius=10, fill="#183bdd", outline="white", width=3)
            d.text((230, 25), "HELLO", font=font, fill="white")
            d.ellipse((273, 61, 285, 73), fill="#183bdd", outline="white", width=2)
        if case == "padding":
            d.rectangle((0, 0, 39, height - 1), fill="black")
        if case == "background":
            d.rectangle((120, 85, 180, 145), fill="#935939", outline="#e8ab69", width=3)
            d.line((125, 90, 175, 140), fill="#efd0a8", width=4)
        if case == "moving":
            logo(40 + f * 8, 20)
        if case == "disappear" and f < 9:
            logo()
        if case.endswith("overlays"):
            count = {"four-overlays": 4, "twelve-overlays": 12, "thirteen-overlays": 13}[case]
            for i in range(count):
                x, y = 14 + i % 4 * 77, 10 + i // 4 * 57
                d.rectangle((x, y, x + 20, y + 16), fill="#183bdd", outline="white", width=2)
        raw.extend(image.tobytes())
        if f in [0, 8, 17]:
            image.save(root / f"{case}-{f}.png")
    (root / f"{case}.rgb").write_bytes(raw)
    label = "PRODUCT_PRINT" if case in ["box-print", "bottle-print"] else "SUBTITLE" if case in ["subtitle", "video-title"] else "BACKGROUND_GRAPHIC" if case in ["padding", "background"] else "OVERLAY_LOGO" if case == "overlay" else "OVERLAY_STICKER" if case == "multi-component" else "MIXED_OR_DIAGNOSTIC"
    manifest.append({"case": case, "labelSource": "CONTROLLED_TRUTH", "constructionLabel": label,
                     "width": width, "height": height, "frameCount": frames, "fps": 6})
(root / "construction.json").write_text(json.dumps({"version": "hybrid-h2-fixtures/v1", "cases": manifest}, indent=2))
