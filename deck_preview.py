from __future__ import annotations

import csv
import os
import threading
from collections import Counter
from functools import lru_cache
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / ".cache" / "deck-previews"


def find_card_data_root() -> Path:
    configured = os.environ.get("PTCG_CARD_DATA_DIR")
    if configured:
        return Path(configured)
    candidates = (ROOT.parent, ROOT.parent / "ptcg-ai", ROOT.parent / "pokemon-tcg-ai-battle")
    required = ("EN_Card_Data.csv", "JP_Card_Data.csv", "Card_ID List_EN.pdf", "Card_ID List_JP.pdf")
    return next((candidate for candidate in candidates if all((candidate / name).is_file() for name in required)), candidates[0])


CARD_DATA_ROOT = find_card_data_root()
CARD_CSV_EN = Path(os.environ.get("PTCG_CARD_CSV_EN", CARD_DATA_ROOT / "EN_Card_Data.csv"))
CARD_PDF_EN = Path(os.environ.get("PTCG_CARD_PDF_EN", CARD_DATA_ROOT / "Card_ID List_EN.pdf"))
CARD_CSV_JA = Path(os.environ.get("PTCG_CARD_CSV_JA", CARD_DATA_ROOT / "JP_Card_Data.csv"))
CARD_PDF_JA = Path(os.environ.get("PTCG_CARD_PDF_JA", CARD_DATA_ROOT / "Card_ID List_JP.pdf"))
PDF_CARD_START_PAGE = int(os.environ.get("PTCG_PDF_CARD_START_PAGE", "40"))
PREVIEW_CACHE_VERSION = "3-hq"

_render_lock = threading.Lock()


def read_deck(deck_path: Path) -> list[int]:
    try:
        cards = [int(line.strip()) for line in deck_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    except (OSError, ValueError) as exc:
        raise ValueError("deck.csv を読み込めません") from exc
    if len(cards) != 60:
        raise ValueError(f"deck.csv は60枚である必要があります（現在 {len(cards)} 枚）")
    return cards


def card_data(language: str) -> tuple[Path, Path, str, str]:
    if language == "ja":
        return CARD_CSV_JA, CARD_PDF_JA, "カード ID", "カード名"
    if language == "en":
        return CARD_CSV_EN, CARD_PDF_EN, "Card ID", "Card Name"
    raise ValueError(f"未対応の言語です: {language}")


@lru_cache(maxsize=2)
def card_catalog(language: str = "en") -> tuple[dict[int, str], dict[int, int]]:
    csv_path, _, id_column, name_column = card_data(language)
    names: dict[int, str] = {}
    order: dict[int, int] = {}
    with csv_path.open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file):
            try:
                card_id = int(str(row.get(id_column, "")).strip())
            except ValueError:
                continue
            if card_id not in order:
                order[card_id] = len(order)
                names[card_id] = str(row.get(name_column, "")).strip()
    return names, order


@lru_cache(maxsize=2)
def card_categories(language: str = "en") -> dict[int, str]:
    csv_path, _, id_column, _ = card_data(language)
    category_column = "ポケモンの進化の段階/エネルギー・トレーナーズの種類" if language == "ja" else "Evolution Stage / Energy / Trainer Type"
    categories: dict[int, str] = {}
    with csv_path.open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file):
            try:
                card_id = int(str(row.get(id_column, "")).strip())
            except ValueError:
                continue
            categories.setdefault(card_id, str(row.get(category_column, "")).strip())
    return categories


@lru_cache(maxsize=1)
def japanese_move_names() -> dict[str, str]:
    with CARD_CSV_EN.open(encoding="utf-8-sig", newline="") as en_file, CARD_CSV_JA.open(encoding="utf-8-sig", newline="") as ja_file:
        en_rows = list(csv.DictReader(en_file))
        ja_rows = list(csv.DictReader(ja_file))
    names: dict[str, str] = {}
    for en_row, ja_row in zip(en_rows, ja_rows):
        if en_row.get("Card ID") != ja_row.get("カード ID"):
            continue
        english = str(en_row.get("Move Name", "")).strip()
        japanese = str(ja_row.get("ワザ名", "")).strip()
        if english and english != "n/a" and japanese and japanese != "n/a":
            names.setdefault(english, japanese.removeprefix("[特性]"))
    return names


def deck_summary(deck_path: Path) -> dict[str, object]:
    cards = read_deck(deck_path)
    counts = Counter(cards)
    try:
        names_en, _ = card_catalog("en")
    except OSError:
        names_en = {}
    try:
        names_ja, _ = card_catalog("ja")
    except OSError:
        names_ja = {}
    available_languages = [
        language
        for language in ("ja", "en")
        if all(path.is_file() for path in card_data(language)[:2])
    ]
    return {
        "total": len(cards),
        "unique": len(counts),
        "cards": [
            {
                "id": card_id,
                "name": names_ja.get(card_id) or names_en.get(card_id, ""),
                "names": {"ja": names_ja.get(card_id, ""), "en": names_en.get(card_id, "")},
                "count": count,
            }
            for card_id, count in counts.items()
        ],
        "image_available": bool(available_languages),
        "available_languages": available_languages,
    }


def render_deck_preview(deck_path: Path, cache_key: str, language: str = "en") -> Path:
    from PIL import Image, ImageDraw, ImageFont
    import fitz

    cards = read_deck(deck_path)
    counts = Counter(cards)
    _, pdf_path, _, _ = card_data(language)
    names, order = card_catalog(language)
    missing = [card_id for card_id in counts if card_id not in order]
    if missing:
        raise ValueError(f"カードデータに存在しない ID: {', '.join(map(str, missing))}")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    output = CACHE_DIR / f"{cache_key}-{language}-v{PREVIEW_CACHE_VERSION}.webp"
    if output.is_file() and output.stat().st_mtime >= deck_path.stat().st_mtime:
        return output

    with _render_lock:
        if output.is_file() and output.stat().st_mtime >= deck_path.stat().st_mtime:
            return output

        columns = 6
        card_width, card_height = 300, 420
        gap, label_height = 16, 64
        rows = (len(counts) + columns - 1) // columns
        canvas = Image.new("RGB", (columns * card_width + (columns - 1) * gap, rows * (card_height + label_height) + (rows - 1) * gap), "white")
        font = ImageFont.load_default(size=22)

        with fitz.open(pdf_path) as document:
            small_font = ImageFont.load_default(size=16)
            for index, (card_id, count) in enumerate(counts.items()):
                page_index = PDF_CARD_START_PAGE - 1 + order[card_id]
                page = document.load_page(page_index)
                image_rects = [
                    rect
                    for image in page.get_images(full=True)
                    for rect in page.get_image_rects(image[0])
                ]
                if not image_rects:
                    raise ValueError(f"カード画像が見つかりません: ID {card_id}")
                # Japanese cards are larger on the PDF page than English cards.
                # Read the actual embedded-image bounds instead of applying the
                # English layout's fixed crop to both languages.
                clip = max(image_rects, key=lambda rect: rect.width * rect.height)
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), clip=clip, alpha=False)
                card = pixmap.pil_image().convert("RGB")
                card.thumbnail((card_width, card_height), Image.Resampling.LANCZOS)

                x = (index % columns) * (card_width + gap)
                y = (index // columns) * (card_height + label_height + gap)
                card_x = x + (card_width - card.width) // 2
                canvas.paste(card, (card_x, y))
                draw = ImageDraw.Draw(canvas)
                draw.text((x + 4, y + card_height + 4), f"x{count}  ID {card_id}", fill="#111111", font=font)
                name = names.get(card_id, "")
                # Japanese names are already prominent on the card face. Avoid
                # relying on a CJK font being installed just for this caption.
                if name and language == "en":
                    draw.text((x + 4, y + card_height + 34), name[:32], fill="#555555", font=small_font)

        temporary = output.with_suffix(".tmp.webp")
        canvas.save(temporary, "WEBP", quality=92, method=6)
        temporary.replace(output)
    return output


def render_card_image(card_id: int, language: str = "ja") -> Path:
    """Render and cache one card image for the deck builder gallery."""
    from PIL import Image
    import fitz

    _, pdf_path, _, _ = card_data(language)
    _, order = card_catalog(language)
    if card_id not in order:
        raise ValueError(f"カードデータに存在しない ID: {card_id}")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    output = CACHE_DIR / f"card-{card_id}-{language}-v{PREVIEW_CACHE_VERSION}.webp"
    if output.is_file() and output.stat().st_mtime >= pdf_path.stat().st_mtime:
        return output
    with _render_lock:
        if output.is_file() and output.stat().st_mtime >= pdf_path.stat().st_mtime:
            return output
        with fitz.open(pdf_path) as document:
            page = document.load_page(PDF_CARD_START_PAGE - 1 + order[card_id])
            image_rects = [rect for image in page.get_images(full=True) for rect in page.get_image_rects(image[0])]
            if not image_rects:
                raise ValueError(f"カード画像が見つかりません: ID {card_id}")
            clip = max(image_rects, key=lambda rect: rect.width * rect.height)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), clip=clip, alpha=False)
            image = pixmap.pil_image().convert("RGB")
            image.thumbnail((360, 504), Image.Resampling.LANCZOS)
            temporary = output.with_suffix(".tmp.webp")
            image.save(temporary, "WEBP", quality=88, method=6)
            temporary.replace(output)
    return output
