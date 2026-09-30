from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "image.png"
OUTPUT = ROOT / "frontend" / "src" / "ui" / "assets" / "cards"
BACKGROUND = (252, 246, 230)
CANVAS = 192

# Source-sheet bounds in order: money, influence, actions, scandal, protection, score.
ICONS = {
    "stat-money": (110, 105, 400, 360),
    "stat-influence": (500, 100, 780, 355),
    "stat-actions": (940, 90, 1140, 365),
    "stat-scandal": (90, 450, 375, 725),
    "stat-roof": (515, 440, 760, 725),
    "stat-score": (890, 450, 1195, 735),
}


def make_transparent(image: Image.Image) -> Image.Image:
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b = pixels[x, y][:3]
            distance = max(abs(r - BACKGROUND[0]), abs(g - BACKGROUND[1]), abs(b - BACKGROUND[2]))
            alpha = round(max(0, min(255, (distance - 10) * 255 / 28)))
            pixels[x, y] = (r, g, b, alpha)
    return image


def main() -> None:
    sheet = Image.open(SOURCE).convert("RGBA")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, bounds in ICONS.items():
        icon = make_transparent(sheet.crop(bounds))
        bbox = icon.getbbox()
        if bbox is None:
            raise ValueError(f"No artwork detected for {name}")
        icon = icon.crop(bbox)
        icon.thumbnail((CANVAS - 20, CANVAS - 20), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        canvas.alpha_composite(icon, ((CANVAS - icon.width) // 2, (CANVAS - icon.height) // 2))
        output = OUTPUT / f"{name}.webp"
        canvas.save(output, "WEBP", lossless=True, method=6)
        print(f"{output.relative_to(ROOT)}: {canvas.size}, artwork {icon.size}")


if __name__ == "__main__":
    main()
