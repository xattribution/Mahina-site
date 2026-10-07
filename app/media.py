"""Photo processing: web-size image plus thumbnail, EXIF-rotated, stripped of metadata."""
import io
import os
import secrets
import threading

from PIL import Image, ImageOps

MAX_PIXELS = 40_000_000  # 40 megapixels: bigger than any phone photo, small enough to process safely
Image.MAX_IMAGE_PIXELS = MAX_PIXELS  # Pillow's own bomb check as a backstop

from . import db

MAX_WEB = 2000
MAX_THUMB = 720
ALLOWED = {"JPEG", "PNG", "WEBP", "HEIF", "MPO", "GIF"}


PUBLIC_MAX_PIXELS = 24_000_000  # visitor uploads: still bigger than a 24 MP camera's photos
_busy = threading.BoundedSemaphore(2)  # at most two images decode at once, so memory stays bounded under load


def save_image(data: bytes, max_pixels=MAX_PIXELS):
    with _busy:
        return _save_image(data, max_pixels)


def _save_image(data, max_pixels):
    try:
        # Only these formats are even opened; anything else is refused without decoding.
        im = Image.open(io.BytesIO(data), formats=("JPEG", "PNG", "WEBP", "GIF", "MPO") + (("HEIF",) if "HEIF" in Image.OPEN else ()))
        fmt = im.format
        # Size comes from the file header, so oversized images are refused before any pixels are decoded.
        if im.width * im.height > max_pixels:
            raise Image.DecompressionBombError("too large")
        if fmt == "JPEG":
            im.draft("RGB", (MAX_WEB * 2, MAX_WEB * 2))  # decode big JPEGs at reduced size
        im = ImageOps.exif_transpose(im)
        im.thumbnail((MAX_WEB, MAX_WEB), Image.LANCZOS)  # shrink first, in the original mode, before any conversion
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError(f"That image is too large. Use one under {max_pixels // 1_000_000} megapixels.")
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
