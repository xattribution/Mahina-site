"""Photo processing: web-size image plus thumbnail, EXIF-rotated, stripped of metadata."""
import io
import os
import secrets

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 60_000_000  # refuse decompression bombs

from . import db

MAX_WEB = 2000
MAX_THUMB = 720
ALLOWED = {"JPEG", "PNG", "WEBP", "HEIF", "MPO", "GIF"}


def save_image(data: bytes):
    try:
        im = Image.open(io.BytesIO(data))
        fmt = im.format
        im = ImageOps.exif_transpose(im)
    except Image.DecompressionBombError:
        raise ValueError("That image is too large. Use one under 60 megapixels.")
    except Exception:
        raise ValueError("That file isn't an image we can read. Use JPG, PNG, or WebP.")
    if fmt not in ALLOWED:
        raise ValueError("Use a JPG, PNG, or WebP image.")
    if im.mode not in ("RGB", "L"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        im = im.convert("RGBA")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    elif im.mode == "L":
        im = im.convert("RGB")
    name = secrets.token_hex(8)
    web = im.copy()
    web.thumbnail((MAX_WEB, MAX_WEB), Image.LANCZOS)
    thumb = im.copy()
    thumb.thumbnail((MAX_THUMB, MAX_THUMB), Image.LANCZOS)
    os.makedirs(db.UPLOAD_DIR, exist_ok=True)
    web.save(os.path.join(db.UPLOAD_DIR, f"{name}.jpg"), "JPEG", quality=84, optimize=True, progressive=True)
    thumb.save(os.path.join(db.UPLOAD_DIR, f"{name}_t.jpg"), "JPEG", quality=80, optimize=True, progressive=True)
    return f"{name}.jpg", f"{name}_t.jpg", web.width, web.height


def delete_files(photo):
    for f in (photo["file"], photo["thumb"]):
        try:
            os.remove(os.path.join(db.UPLOAD_DIR, f))
        except OSError:
            pass
