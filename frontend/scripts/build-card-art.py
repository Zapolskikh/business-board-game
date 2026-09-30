"""Нарезка сгенерированных пресетов в ассеты карточек.

Исходники лежат в /presets как есть — атласы и листы PNG от генератора. В бандл они не идут:
один SVG из комплекта проектов весит 3,5 МБ, потому что каждый встраивает весь атлас целиком.
Скрипт вырезает нужные куски, убирает зелёный стол за фигурными углами карточек проектов
и сохраняет всё в WebP нужного размера.

Запуск (нужен Pillow, numpy, scipy):
    python frontend/scripts/build-card-art.py
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
PRESETS = ROOT / "presets"
KIT = PRESETS / "city-project-ui-kit" / "city-project-ui-kit" / "assets"
OUT = ROOT / "frontend" / "src" / "ui" / "assets" / "cards"

DISTRICT_ART = PRESETS / "Obrázek ChatGPT 29. 9. 2026 17_34_22-1.png"
DISTRICT_ICONS = PRESETS / "Obrázek ChatGPT 29. 9. 2026 17_34_22-2.png"
PLAYER_ICONS = PRESETS / "Obrázek ChatGPT 29. 9. 2026 17_34_40-2.png"
PLAYER_FRAME = PRESETS / "Obrázek ChatGPT 29. 9. 2026 17_34_40-1.png"
UI_PARTS = PRESETS / "Obrázek ChatGPT 29. 9. 2026 17_34_23-3.png"
PROJECT_ART = KIT / "background-atlas.png"
PROJECT_ICONS = KIT / "icon-atlas.png"
STUDIO_LOGO = PRESETS / "imbapewpew _logo.png"
BRAND_OUT = ROOT / "frontend" / "src" / "online" / "assets"


def save(image: Image.Image, name: str, quality: int = 82) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.webp"
    image.save(path, "WEBP", quality=quality, method=6)
    print(f"{path.relative_to(ROOT)}  {image.size[0]}x{image.size[1]}  {path.stat().st_size // 1024} KB")


def icon_boxes(image: Image.Image) -> list[tuple[int, int, int, int]]:
    """Рамки отдельных значков на листе с альфа-каналом, в порядке чтения."""
    alpha = np.array(image)[:, :, 3]
    labels, _ = ndimage.label(alpha > 128)
    boxes = []
    for index, found in enumerate(ndimage.find_objects(labels)):
        if (labels[found] == index + 1).sum() < 8000:
            continue
        boxes.append((found[1].start, found[0].start, found[1].stop, found[0].stop))
    # Строки листа отстоят друг от друга на ~300px; внутри строки — слева направо.
    boxes.sort(key=lambda box: ((box[1] + box[3]) // 2 // 300, box[0]))
    return boxes


def square_icon(image: Image.Image, box: tuple[int, int, int, int], size: int = 128) -> Image.Image:
    left, top, right, bottom = box
    pad = 10
    crop = image.crop((left - pad, top - pad, right + pad, bottom + pad))
    side = max(crop.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def cut_table(image: Image.Image, tolerance: int = 34) -> Image.Image:
    """Прозрачность вместо стола за скошенными углами: заливка от четырёх углов по цвету."""
    rgb = np.array(image.convert("RGB")).astype(int)
    height, width, _ = rgb.shape
    table = np.zeros((height, width), bool)
    for y, x in [(0, 0), (0, width - 1), (height - 1, 0), (height - 1, width - 1)]:
        close = np.abs(rgb - rgb[y, x]).sum(2) < tolerance
        labels, _ = ndimage.label(close)
        if labels[y, x]:
            table |= labels == labels[y, x]
    # Полпикселя сглаживания по краю, чтобы скос не был лесенкой.
    alpha = ndimage.gaussian_filter((~table).astype(float), 0.8)
    rgba = np.dstack([rgb, (alpha * 255).clip(0, 255)]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    # Рынок: шесть акварельных улиц, по одной на район. Лист 2×3, у каждой панели тонкая рамка —
    # режем внутрь неё.
    art = Image.open(DISTRICT_ART).convert("RGB")
    columns = [(15, 940), (964, 1888)]
    rows = [(15, 264), (288, 538), (561, 811)]
    layout = [
        ("residential", 0, 0), ("government", 1, 0),
        ("industrial", 0, 1), ("business", 1, 1),
        ("shadows", 0, 2), ("tech", 1, 2),
    ]
    for district, column, row in layout:
        x0, x1 = columns[column]
        y0, y1 = rows[row]
        strip = art.crop((x0, y0, x1, y1))
        strip = strip.resize((720, round(720 * strip.size[1] / strip.size[0])), Image.LANCZOS)
        save(strip, f"district-{district}", quality=74)

    icons = Image.open(DISTRICT_ICONS).convert("RGBA")
    boxes = icon_boxes(icons)
    names = [
        "district-icon-residential", "district-icon-government", "district-icon-industrial",
        "district-icon-business", "district-icon-shadows", "district-icon-tech",
        "rarity-common", "rarity-uncommon", "rarity-rare", "rarity-epic", "rarity-legendary",
    ]
    assert len(boxes) == len(names), boxes
    for name, box in zip(names, boxes):
        save(square_icon(icons, box, 96), name)

    # Проекты: четыре фона с рамкой и значки наград.
    projects = Image.open(PROJECT_ART).convert("RGB")
    half_w, half_h = projects.size[0] / 2, projects.size[1] / 2
    quadrants = {"money": (0, 0), "influence": (1, 0), "unique": (0, 1), "points": (1, 1)}
    for kind, (column, row) in quadrants.items():
        box = (round(column * half_w), round(row * half_h), round((column + 1) * half_w), round((row + 1) * half_h))
        card = cut_table(projects.crop(box))
        card = card.resize((640, round(640 * card.size[1] / card.size[0])), Image.LANCZOS)
        save(card, f"project-{kind}", quality=80)

    reward = Image.open(PROJECT_ICONS).convert("RGBA")
    boxes = sorted(icon_boxes(reward), key=lambda box: box[0])
    for name, box in zip(["money", "influence", "unique", "points", "score"], boxes):
        save(square_icon(reward, box, 96), f"project-icon-{name}")

    # Игроки: значки ролей и ресурсов, пергамент для рамки строки.
    players = Image.open(PLAYER_ICONS).convert("RGBA")
    boxes = icon_boxes(players)
    names = [
        "role-none", "role-capitalist", "role-politician", "role-journalist",
        "role-fraudster", "role-mafia", "role-military", "stat-money",
        "stat-influence", "stat-scandal", "stat-roof", "stat-score",
    ]
    assert len(boxes) == len(names), boxes
    for name, box in zip(names, boxes):
        save(square_icon(players, box, 96), name)

    frame = Image.open(PLAYER_FRAME).convert("RGB")
    frame = cut_table(frame.resize((620, round(620 * frame.size[1] / frame.size[0])), Image.LANCZOS), 20)
    save(frame, "player-frame", quality=84)

    # Объекты: ленты редкости и золотая плашка цены. Лист с альфа-каналом, куски режутся
    # по точным рамкам — у ленты и плашки нет квадратной формы, как у значков.
    parts = Image.open(UI_PARTS).convert("RGBA")
    ribbons = [(43, 882, 305, 969), (342, 882, 605, 969), (640, 882, 901, 969), (937, 882, 1197, 969),
               (1234, 882, 1494, 969)]
    for rarity, box in zip(["common", "uncommon", "rare", "epic", "legendary"], ribbons):
        ribbon = parts.crop(box)
        save(ribbon.resize((180, round(180 * ribbon.size[1] / ribbon.size[0])), Image.LANCZOS), f"ribbon-{rarity}")
    plaque = parts.crop((64, 630, 484, 804))
    save(plaque.resize((160, round(160 * plaque.size[1] / plaque.size[0])), Image.LANCZOS), "price-plaque")


def studio_logo() -> None:
    """Логотип студии без кремового фона, в двух вариантах: как есть и для тёмной страницы.

    Главная страница почти чёрная, и тёмно-фиолетовая надпись на ней пропадает. В тёмном
    варианте светлеет только надпись справа от монстрика: глаза и рот у него того же тёмного
    цвета, и перекрашивать весь логотип целиком нельзя.
    """
    rgb = np.array(Image.open(STUDIO_LOGO).convert("RGB")).astype(float)
    paper = np.median(rgb[:20, :20].reshape(-1, 3), axis=0)
    distance = np.abs(rgb - paper).sum(2)
    # Мягкий край: полностью прозрачно на цвете бумаги, полностью видно чуть дальше от него.
    alpha = np.clip((distance - 18) / 40, 0, 1)
    ys, xs = np.nonzero(alpha > 0.05)
    top, bottom, left, right = ys.min() - 6, ys.max() + 7, xs.min() - 6, xs.max() + 7
    rgb, alpha = rgb[top:bottom, left:right], alpha[top:bottom, left:right]

    # Цвет краёв восстанавливается из смеси с бумагой, иначе вокруг букв остаётся светлый ореол.
    safe = np.maximum(alpha, 1e-3)[..., None]
    pure = np.clip((rgb - paper * (1 - safe)) / safe, 0, 255)

    BRAND_OUT.mkdir(parents=True, exist_ok=True)
    width = 560
    for name, colors in [("studio-logo", pure), ("studio-logo-light", None)]:
        if colors is None:
            colors = pure.copy()
            # Надпись начинается правее монстрика; там всё тёмное становится кремовым.
            text = np.zeros(alpha.shape, bool)
            text[:, int(alpha.shape[1] * 0.33):] = True
            dark = text & (pure.sum(2) < 330)
            colors[dark] = [244, 238, 226]
        image = Image.fromarray(np.dstack([colors, alpha * 255]).astype(np.uint8), "RGBA")
        image = image.resize((width, round(width * image.size[1] / image.size[0])), Image.LANCZOS)
        path = BRAND_OUT / f"{name}.png"
        image.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {image.size[0]}x{image.size[1]}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
    studio_logo()
