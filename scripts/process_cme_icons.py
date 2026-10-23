#!/usr/bin/env python3
"""
Process CME light and dark theme icons:
1. Remove solid background cleanly with smooth anti-aliased alpha matting
   and color de-contamination (unmultiplying background color).
2. Generate transparent full horizontal logos (cme-light.png, cme-dark.png).
3. Generate transparent square icon marks (cme-icon-light.png, cme-icon-dark.png).
4. Generate favicons (favicon.png, favicon.ico).
5. Output to both frontend/public/ and ~/Downloads/.
"""

import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image

def remove_background(img: Image.Image, bg_color: np.ndarray, low_tol: float, high_tol: float, crop_box=None) -> Image.Image:
    arr = np.array(img.convert('RGB')).astype(float)
    if crop_box:
        x0, y0, x1, y1 = crop_box
        arr = arr[y0:y1, x0:x1]

    # Euclidean color distance to background
    dist = np.linalg.norm(arr - bg_color, axis=2)

    # Smooth Hermite alpha ramp (3t^2 - 2t^3)
    t = np.clip((dist - low_tol) / (high_tol - low_tol), 0.0, 1.0)
    alpha = t * t * (3.0 - 2.0 * t)

    # Un-blend foreground from background: F = (C - (1 - alpha) * B) / alpha
    fg = np.copy(arr)
    mask = alpha > 0.001
    for c in range(3):
        fg[..., c] = np.where(
            mask,
            np.clip((arr[..., c] - (1.0 - alpha) * bg_color[c]) / np.maximum(alpha, 0.001), 0.0, 255.0),
            0.0
        )

    rgba = np.dstack([fg, alpha * 255.0]).astype(np.uint8)
    out_im = Image.fromarray(rgba, 'RGBA')

    # Trim empty transparent edges
    bbox = out_im.getbbox()
    if bbox:
        out_im = out_im.crop(bbox)
    return out_im

def extract_square_icon(full_logo: Image.Image, size=512, padding_pct=0.08) -> Image.Image:
    """Extract Part 1 (the stylized 'C' emblem) from the horizontal logo and center it in a square canvas."""
    arr = np.array(full_logo)
    alpha = arr[..., 3]
    # Find column gap between Part 1 and Part 2 (between x=600 and x=1000)
    col_sum = (alpha > 50).sum(axis=0)
    gap_x = 600 + np.argmin(col_sum[600:1000])

    part1 = full_logo.crop((0, 0, gap_x, full_logo.height))
    bbox = part1.getbbox()
    if bbox:
        part1 = part1.crop(bbox)

    pad = int(size * padding_pct)
    max_dim = size - 2 * pad
    w, h = part1.size
    scale = min(max_dim / w, max_dim / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    resized = part1.resize((nw, nh), Image.Resampling.LANCZOS)

    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    paste_x = (size - nw) // 2
    paste_y = (size - nh) // 2
    canvas.paste(resized, (paste_x, paste_y), mask=resized)
    return canvas

def main():
    home = Path.home()
    downloads_dir = home / 'Downloads'
    frontend_public = Path(__file__).resolve().parent.parent / 'frontend' / 'public'
    frontend_public.mkdir(parents=True, exist_ok=True)

    src_light = downloads_dir / 'cme-light.jpg'
    src_dark = downloads_dir / 'cme-dark.jpg'

    if not src_light.exists() or not src_dark.exists():
        print(f"Error: Missing source images in {downloads_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading {src_light}...")
    im_light = Image.open(src_light)
    print(f"Loading {src_dark}...")
    im_dark = Image.open(src_dark)

    # Crop box around logo area to avoid extreme border JPEG noise
    crop_box = (150, 360, 2680, 1265)

    bg_light = np.array([243.3, 242.4, 239.5])
    bg_dark = np.array([58.3, 58.4, 58.2])

    print("Removing background for light theme...")
    logo_light = remove_background(im_light, bg_light, low_tol=6.5, high_tol=13.0, crop_box=crop_box)
    print(f"  Cropped logo light size: {logo_light.size}")

    print("Removing background for dark theme...")
    logo_dark = remove_background(im_dark, bg_dark, low_tol=8.0, high_tol=18.0, crop_box=crop_box)
    print(f"  Cropped logo dark size: {logo_dark.size}")

    print("Extracting square icon marks...")
    icon_light = extract_square_icon(logo_light, size=512)
    icon_dark = extract_square_icon(logo_dark, size=512)

    # Output targets
    targets = [
        # Frontend public directory (serviced by Vite / CME server)
        (frontend_public / 'cme-light.png', logo_light),
        (frontend_public / 'cme-dark.png', logo_dark),
        (frontend_public / 'cme-logo-light.png', logo_light),
        (frontend_public / 'cme-logo-dark.png', logo_dark),
        (frontend_public / 'cme-icon-light.png', icon_light),
        (frontend_public / 'cme-icon-dark.png', icon_dark),
        (frontend_public / 'favicon.png', icon_light.resize((64, 64), Image.Resampling.LANCZOS)),
        # Downloads folder for user reference
        (downloads_dir / 'cme-light.png', logo_light),
        (downloads_dir / 'cme-dark.png', logo_dark),
        (downloads_dir / 'cme-icon-light.png', icon_light),
        (downloads_dir / 'cme-icon-dark.png', icon_dark),
    ]

    for path, img in targets:
        print(f"Saving {path}...")
        img.save(path, 'PNG', optimize=True)

    # Save multi-size favicon.ico
    fav_ico_path = frontend_public / 'favicon.ico'
    print(f"Saving {fav_ico_path}...")
    icon_light.save(fav_ico_path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    print("\nIcon and logo generation complete!")

if __name__ == '__main__':
    main()
