"""Draws the Arth icon set (a rising candle trio on ink) into apps/mobile/assets."""
from pathlib import Path

from PIL import Image, ImageDraw

INK = (11, 15, 20, 255)
GREEN = (34, 197, 94, 255)
RED = (239, 68, 68, 255)
WHITE = (255, 255, 255, 255)
OUT = Path(__file__).resolve().parents[2] / "apps" / "mobile" / "assets"
S = 4  # supersampling


def mark(size: int, scale: float, mono: bool = False) -> Image.Image:
    big = size * S
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = big * scale / 10  # mark spans 10 units, centred
    ox = oy = (big - 10 * u) / 2
    candles = [  # x, wick top, body top, body bottom, wick bottom, colour
        (1.4, 5.2, 5.8, 8.2, 9.0, RED),
        (4.2, 3.0, 3.8, 6.6, 7.6, GREEN),
        (7.0, 0.6, 1.4, 4.6, 5.6, GREEN),
    ]
    for x, wt, bt, bb, wb, col in candles:
        c = WHITE if mono else col
        cx = ox + (x + 0.8) * u
        d.rounded_rectangle([cx - 0.12 * u, oy + wt * u, cx + 0.12 * u, oy + wb * u], radius=0.12 * u, fill=c)
        d.rounded_rectangle([ox + x * u, oy + bt * u, ox + (x + 1.6) * u, oy + bb * u], radius=0.3 * u, fill=c)
    return img.resize((size, size), Image.LANCZOS)


def on(bg: tuple[int, int, int, int], size: int, scale: float) -> Image.Image:
    base = Image.new("RGBA", (size, size), bg)
    base.alpha_composite(mark(size, scale))
    return base


def main() -> None:
    on(INK, 1024, 0.72).convert("RGB").save(OUT / "icon.png")
    mark(1024, 0.40).save(OUT / "android-icon-foreground.png")
    Image.new("RGBA", (1024, 1024), INK).save(OUT / "android-icon-background.png")
    mark(1024, 0.40, mono=True).save(OUT / "android-icon-monochrome.png")
    mark(1024, 0.9).save(OUT / "splash-icon.png")
    on(INK, 48, 0.7).save(OUT / "favicon.png")


if __name__ == "__main__":
    main()
