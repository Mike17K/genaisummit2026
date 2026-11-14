import io
from PIL import Image, ImageDraw

W, H = 640, 360
def base():
    im = Image.new("RGB", (W, H), (135, 190, 235)); d = ImageDraw.Draw(im)
    d.rectangle([0, 170, W, H], fill=(70, 70, 75))                       # road
    d.polygon([(0, 170), (W, 170), (W, 150), (0, 150)], fill=(90, 150, 80))  # far grass
    d.polygon([(290, 170), (350, 170), (470, H), (170, H)], fill=(85, 85, 90))
    for y, w in [(190, 4), (230, 7), (290, 12)]:                           # lane dashes
        d.rectangle([320 - w, y, 320 + w, y + 14 + w], fill=(235, 235, 235))
    return im, d

def car(d, scale):
    cx, base_y = 320, 170 + int(190 * scale)
    w, h = int(300 * scale) + 20, int(170 * scale) + 12
    x0, y0 = cx - w // 2, base_y - h
    d.rectangle([x0, y0, x0 + w, base_y], fill=(200, 30, 30))
    d.rectangle([x0 + w // 8, y0 + h // 10, x0 + w - w // 8, y0 + h // 2], fill=(40, 60, 80))
    r = max(6, h // 5)
    for wx in (x0 + w // 6, x0 + w - w // 6):
        d.ellipse([wx - r, base_y - r, wx + r, base_y + r], fill=(15, 15, 15))
    d.rectangle([x0 + w // 2 - w // 10, y0 + h // 2 + 4, x0 + w // 2 + w // 10, y0 + h // 2 + 14 + h // 12], fill=(240, 240, 240))

def jpeg(im):
    b = io.BytesIO(); im.save(b, "JPEG", quality=70); return b.getvalue()

def empty_road(n=3):
    return [jpeg(base()[0]) for _ in range(n)]

def approaching_car(scales=(0.2, 0.5, 0.95)):
    out = []
    for s in scales:
        im, d = base(); car(d, s); out.append(jpeg(im))
    return out
