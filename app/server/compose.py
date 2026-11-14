"""Put several camera frames into ONE image (a contact sheet) so the watcher gets one picture instead of five.

Oldest frame first, left to right, top to bottom; each tile is numbered and the newest is marked NEW, so the model can
compare frames in time order. Tiles are shrunk to `tile_w` wide, so small far-away details lose some sharpness.
"""
import io
import math
import time

from PIL import Image, ImageDraw


def compose(frames: list[tuple[float, bytes]], now: float | None = None, tile_w: int = 320, cols: int = 3, quality: int = 70) -> bytes:
    """frames: (time, jpeg) oldest first. Returns one JPEG with all of them. A single frame is returned as is."""
    if len(frames) == 1:
        return frames[0][1]
    now = time.time() if now is None else now
    imgs = [Image.open(io.BytesIO(j)).convert("RGB") for _, j in frames]
    w0, h0 = imgs[0].size
    tile_h = round(tile_w * h0 / w0)
    cols = min(cols, len(imgs))
    rows = math.ceil(len(imgs) / cols)
    sheet = Image.new("RGB", (cols * tile_w, rows * tile_h), (0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    last = len(imgs) - 1
    for i, ((t, _), im) in enumerate(zip(frames, imgs)):
        x, y = (i % cols) * tile_w, (i // cols) * tile_h
        sheet.paste(im.resize((tile_w, tile_h), Image.BILINEAR), (x, y))
        label = f"{i + 1} NEW" if i == last else f"{i + 1}  -{now - t:.1f}s"
        draw.rectangle([x, y, x + 8 + 7 * len(label), y + 14], fill=(0, 0, 0))
        draw.text((x + 4, y + 2), label, fill=(255, 255, 0) if i == last else (255, 255, 255))
        draw.rectangle([x, y, x + tile_w - 1, y + tile_h - 1], outline=(0, 0, 0))
    out = io.BytesIO()
    sheet.save(out, "JPEG", quality=quality)
    return out.getvalue()
