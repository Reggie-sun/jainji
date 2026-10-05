"""Six fixed corner construction cases, no model/holdout/mask/production calls."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
width, height, frames, fps = 640, 480, 18, 6
font = ImageFont.truetype("DejaVuSans-Bold.ttf", 20)
small = ImageFont.truetype("DejaVuSans.ttf", 13)
cases = [("overlay", "TOP_RIGHT", "OVERLAY_LOGO"), ("product-print", "TOP_LEFT", "PRODUCT_PRINT"),
         ("subtitle", "BOTTOM_LEFT", "SUBTITLE"), ("physical-background", "BOTTOM_RIGHT", "BACKGROUND_GRAPHIC"),
         ("multi-component", "TOP_RIGHT", "ONE_LOGICAL_OVERLAY"), ("two-overlays", "TOP_RIGHT", "MULTIPLE_OVERLAYS_UNSUPPORTED")]
for case, corner, label in cases:
    raw = bytearray()
    for f in range(frames):
        # An explicit room/wooden table scene; changing illumination keeps background out of M1.
        # A noise field plus fixed rectangle is deliberately not negative semantic truth.
        light = (f * 53) % 140 + 55
        image = Image.new("RGB", (width, height), (light + 40, light + 35, light + 25))
        d = ImageDraw.Draw(image)
        shift = (f % 6) * 5
        d.polygon([(0, 0), (150, 0), (150, 300), (0, 400)], fill=(light + 5, light, light - 10))
        d.polygon([(0, 325), (520, 300), (639, 405), (0, 460)], fill=(light + 25, light - 5, light - 30))
        d.polygon([(0, 460), (639, 405), (639, 479), (0, 479)], fill=(light, light - 25, light - 40))
        for y in range(337, 450, 20):
            d.line((0, y, 630, y - 23), fill=(light + 5, light - 15, light - 35), width=2)
        # Moving central physical product belongs to context, not a corner proposal.
        d.rounded_rectangle((285 + shift, 230, 355 + shift, 360), radius=15, fill=(light + 30, light + 40, light + 15))
        d.rectangle((300 + shift, 210, 340 + shift, 239), fill=(light - 15, light - 20, light - 25))
        d.text((290 + shift, 280), "SOAP", font=small, fill=(light - 25, light - 25, light - 25))
        def logo(x, y, text="EDIT"):
            d.rounded_rectangle((x, y, x + 105, y + 54), radius=12, fill="#183bdd", outline="white", width=4)
            d.text((x + 17, y + 15), text, fill="white", font=font)
        if case == "overlay":
            logo(492, 20)
        if case == "product-print":
            d.polygon([(0, 120), (150, 124), (150, 140), (0, 132)], fill=(light - 20, light - 30, light - 40))
            # A three-dimensional cardboard product, with attached ink on the perspective front face.
            d.polygon([(22, 30), (111, 40), (111, 119), (22, 107)], fill="#d7aa6d", outline="#573415")
            d.polygon([(22, 30), (40, 16), (130, 25), (111, 40)], fill="#edc994", outline="#573415")
            d.polygon([(111, 40), (130, 25), (130, 105), (111, 119)], fill="#927349", outline="#573415")
            d.line((24, 46, 107, 55), fill="#735230", width=2)
            d.text((30, 62), "BRAND", font=font, fill="#452719")
            d.text((37, 88), "SOAP", font=small, fill="#452719")
        if case == "subtitle":
            d.rectangle((12, 425, 142, 461), fill="#171717")
            d.text((17, 432), "Here is", font=font, fill="white")
            d.text((240 + shift, 432), "today's product", font=font, fill="white", stroke_width=2, stroke_fill="black")
        if case == "physical-background":
            # Right wall is behind the sign, with perspective seams and an attached shelf.
            d.polygon([(465, 325), (639, 337), (639, 479), (465, 479)], fill=(light + 35, light + 25, light + 15))
            d.line((470, 329, 470, 479), fill=(light - 20, light - 20, light - 20), width=3)
            d.rectangle((480, 464, 639, 475), fill=(light - 15, light - 30, light - 40))
            # Perspective wall-mounted wooden sign, visible mounting hardware and wood grain.
            d.polygon([(492, 368), (610, 380), (610, 459), (492, 447)], fill="#b59a74", outline="#59462f")
            for y in [387, 410, 438]:
                d.line((496, y, 607, y + 11), fill="#8c704e", width=2)
            for x, y in [(498, 375), (604, 386), (499, 440), (604, 452)]:
                d.ellipse((x - 3, y - 3, x + 3, y + 3), fill="#333333")
            d.text((514, 391), "OPEN", font=font, fill="#49321d")
            d.text((518, 421), "9 AM - 5 PM", font=small, fill="#49321d")
        if case == "multi-component":
            logo(480, 14, "HELLO")
            d.ellipse((566, 96, 588, 118), fill="#183bdd", outline="white", width=3)
        if case == "two-overlays":
            logo(456, 10)
            d.ellipse((580, 86, 622, 128), fill="#db251a", outline="yellow", width=4)
            d.text((590, 96), "!", font=font, fill="white")
        raw.extend(image.tobytes())
        if f in [0, 8, 17]:
            image.save(root / f"{case}-{f}.png")
    (root / f"{case}.rgb").write_bytes(raw)
(root / "construction.json").write_text(json.dumps({"version": "hybrid-h2c-fixtures/v1", "width": width, "height": height,
    "frameCount": frames, "fps": fps, "cases": [{"case": c, "corner": corner, "constructionLabel": label, "labelSource": "CONTROLLED_TRUTH"}
                                                for c, corner, label in cases]}, indent=2))
