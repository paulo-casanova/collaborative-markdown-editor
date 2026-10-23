#!/usr/bin/env python3
"""
Process CME light and dark theme icons:
1. Remove solid background cleanly with smooth anti-aliased alpha matting
   and color de-contamination (unmultiplying background color).
2. Preserve high-resolution master originals (cme-light-original.png, etc.).
3. Generate web-optimized small versions (cme-light.png ~35KB, cme-dark.png ~31KB)
   sized at 3x retina resolution for fast download and crisp rendering.
4. Generate square icon marks (128x128 ~18KB and 512x512 original).
5. Generate favicons (favicon.png, favicon.ico).
6. Output to both frontend/public/ and ~/Downloads/.
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

def make_web_logo(im: Image.Image, target_height: int = 84) -> Image.Image:
    """Resize full logo to 3x retina height (84px for a 28px UI display) for fast download."""
    w, h = im.size
    target_width = int(round(w * (target_height / h)))
    return im.resize((target_width, target_height), Image.Resampling.LANCZOS)

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
    logo_light_orig = remove_background(im_light, bg_light, low_tol=6.5, high_tol=13.0, crop_box=crop_box)
    print(f"  Original logo light size: {logo_light_orig.size}")

    print("Removing background for dark theme...")
    logo_dark_orig = remove_background(im_dark, bg_dark, low_tol=8.0, high_tol=18.0, crop_box=crop_box)
    print(f"  Original logo dark size: {logo_dark_orig.size}")

    print("Generating square icon marks (original 512x512)...")
    icon_light_orig = extract_square_icon(logo_light_orig, size=512)
    icon_dark_orig = extract_square_icon(logo_dark_orig, size=512)

    print("Generating web-optimized small versions...")
    # 84px height is 3x retina for a 28px UI display in navigation header
    logo_light_web = make_web_logo(logo_light_orig, target_height=84)
    logo_dark_web = make_web_logo(logo_dark_orig, target_height=84)
    # 128x128 is 4x retina for a 28-32px icon
    icon_light_web = icon_light_orig.resize((128, 128), Image.Resampling.LANCZOS)
    icon_dark_web = icon_dark_orig.resize((128, 128), Image.Resampling.LANCZOS)

    # Output targets
    targets = [
        # --- High-Resolution Originals Preserved ---
        (frontend_public / 'cme-light-original.png', logo_light_orig),
        (frontend_public / 'cme-dark-original.png', logo_dark_orig),
        (frontend_public / 'cme-logo-light-original.png', logo_light_orig),
        (frontend_public / 'cme-logo-dark-original.png', logo_dark_orig),
        (frontend_public / 'cme-icon-light-original.png', icon_light_orig),
        (frontend_public / 'cme-icon-dark-original.png', icon_dark_orig),

        # --- Web-Optimized Small Versions (Default for UI fast downloads) ---
        (frontend_public / 'cme-light.png', logo_light_web),
        (frontend_public / 'cme-dark.png', logo_dark_web),
        (frontend_public / 'cme-light-sm.png', logo_light_web),
        (frontend_public / 'cme-dark-sm.png', logo_dark_web),
        (frontend_public / 'cme-logo-light.png', logo_light_web),
        (frontend_public / 'cme-logo-dark.png', logo_dark_web),
        (frontend_public / 'cme-icon-light.png', icon_light_web),
        (frontend_public / 'cme-icon-dark.png', icon_dark_web),
        (frontend_public / 'cme-icon-light-sm.png', icon_light_web),
        (frontend_public / 'cme-icon-dark-sm.png', icon_dark_web),

        # --- Favicons ---
        (frontend_public / 'favicon.png', icon_light_orig.resize((64, 64), Image.Resampling.LANCZOS)),

        # --- Downloads Folder ---
        (downloads_dir / 'cme-light-original.png', logo_light_orig),
        (downloads_dir / 'cme-dark-original.png', logo_dark_orig),
        (downloads_dir / 'cme-icon-light-original.png', icon_light_orig),
        (downloads_dir / 'cme-icon-dark-original.png', icon_dark_orig),
        (downloads_dir / 'cme-light.png', logo_light_orig),
        (downloads_dir / 'cme-dark.png', logo_dark_orig),
        (downloads_dir / 'cme-light-sm.png', logo_light_web),
        (downloads_dir / 'cme-dark-sm.png', logo_dark_web),
        (downloads_dir / 'cme-icon-light.png', icon_light_orig),
        (downloads_dir / 'cme-icon-dark.png', icon_dark_orig),
        (downloads_dir / 'cme-icon-light-sm.png', icon_light_web),
        (downloads_dir / 'cme-icon-dark-sm.png', icon_dark_web),
    ]

    for path, img in targets:
        print(f"Saving {path} ({img.size[0]}x{img.size[1]})...")
        img.save(path, 'PNG', optimize=True)

    # Save multi-size favicon.ico
    fav_ico_path = frontend_public / 'favicon.ico'
    print(f"Saving {fav_ico_path}...")
    icon_light_orig.save(fav_ico_path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    print("\nIcon and logo generation complete!")

if __name__ == '__main__':
    main()
