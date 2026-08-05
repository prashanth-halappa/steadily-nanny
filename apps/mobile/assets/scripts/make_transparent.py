#!/usr/bin/env python3
"""
Remove fake checkerboard / flat light backgrounds from PNGs.

Uses edge flood-fill through neutral light pixels so interior whites
(clock faces, calendar cells) stay opaque when enclosed by illustration art.
"""

from __future__ import annotations

import argparse
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def is_background_pixel(r: int, g: int, b: int, *, max_chroma: int, min_avg: int) -> bool:
    if max(r, g, b) - min(r, g, b) > max_chroma:
        return False
    return (int(r) + int(g) + int(b)) / 3 >= min_avg


def flood_transparent(rgba: np.ndarray, *, max_chroma: int, min_avg: int) -> np.ndarray:
    h, w = rgba.shape[:2]
    bg = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        if x < 0 or x >= w or y < 0 or y >= h or bg[y, x]:
            continue
        r, g, b, _a = rgba[y, x]
        if not is_background_pixel(int(r), int(g), int(b), max_chroma=max_chroma, min_avg=min_avg):
            continue
        bg[y, x] = True
        q.append((x + 1, y))
        q.append((x - 1, y))
        q.append((x, y + 1))
        q.append((x, y - 1))

    out = rgba.copy()
    out[bg, 3] = 0
    return out


def process_file(path: Path, *, max_chroma: int, min_avg: int, dry_run: bool) -> None:
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    out = flood_transparent(arr, max_chroma=max_chroma, min_avg=min_avg)
    transparent = int(np.sum(out[:, :, 3] == 0))
    total = out.shape[0] * out.shape[1]
    print(f"{path.name}: {transparent}/{total} px transparent ({100 * transparent / total:.1f}%)")
    if not dry_run:
        Image.fromarray(out).save(path, optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="PNG files or directories")
    parser.add_argument(
        "--min-avg",
        type=int,
        default=200,
        help="Min average RGB for background flood (default 200)",
    )
    parser.add_argument(
        "--max-chroma",
        type=int,
        default=18,
        help="Max RGB spread for neutral background (default 18)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    files: list[Path] = []
    for raw in args.paths:
        p = Path(raw)
        if p.is_dir():
            files.extend(sorted(p.glob("*.png")))
        elif p.is_file():
            files.append(p)

    if not files:
        print("No PNG files found.", file=sys.stderr)
        return 1

    for f in files:
        process_file(f, max_chroma=args.max_chroma, min_avg=args.min_avg, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
