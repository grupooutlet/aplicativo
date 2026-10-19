"""Regenerate installation icons from the unchanged official header logo.

Requires Pillow 12.0.0, only for regeneration. Production builds copy the
versioned PNG files and do not require Python or image libraries.
"""
from pathlib import Path
import base64
import io

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
source = ROOT / "assets/logo.webp"
logo = Image.open(source if source.exists() else io.BytesIO(
    base64.b64decode((ROOT / "assets/logo.base64.txt").read_text().strip())
)).convert("RGBA")
BACKGROUND = (28, 34, 40, 255)  # #1C2228


def icon(size, width_ratio):
    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    width = round(size * width_ratio)
    height = round(width * logo.height / logo.width)
    brand = logo.resize((width, height), Image.Resampling.LANCZOS)
    canvas.alpha_composite(brand, ((size - width) // 2, (size - height) // 2))
    return canvas.convert("RGB")


for filename, size, ratio in [
    ("apple-touch-icon.png", 180, .88),
    ("assets/app-icon-192.png", 192, .88),
    ("assets/app-icon-512.png", 512, .88),
    # All brand pixels fit inside Android's safe circle, radius 40% of width.
    ("assets/app-icon-maskable-512.png", 512, .74),
]:
    target = ROOT / filename
    icon(size, ratio).save(target, optimize=True)
    print(f"{filename}: {size}x{size}, opaque PNG, #1C2228")
