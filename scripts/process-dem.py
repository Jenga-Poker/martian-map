"""Convierte el GeoTIFF de elevación de Marte en un heightmap listo para la web.

Uso:
    python backend/process_dem.py jezero_dem_1m.tif

Genera en frontend/public/terrain/:
    mars_height.bin       uint16 little-endian, 1024x1024 (65535 = sin datos)
    mars_height_meta.json metadatos de escala, rango y georreferencia
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # DEM legítimo de ~316 Mpx

OUT_SIZE = 1024
NODATA_SENTINEL = 65535
MARS_SPHERE_RADIUS_M = 3_396_190.0
# GeoTIFF: equirectangular Mars 2000 Sphere, píxel de 1 m.
DEG_PER_METER = 180.0 / (math.pi * MARS_SPHERE_RADIUS_M)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = ROOT / "gale_dem_1m.tif"
OUT_DIR = ROOT / "frontend"


def block_average(values: np.ndarray, valid: np.ndarray, out_size: int):
    """Media por bloques ignorando nodata; rellena huecos con el valor válido más cercano."""
    height, width = values.shape
    pad_h = math.ceil(height / out_size) * out_size - height
    pad_w = math.ceil(width / out_size) * out_size - width
    values = np.where(valid, values, 0.0).astype(np.float64, copy=False)
    values = np.pad(values, ((0, pad_h), (0, pad_w)), mode="constant")
    valid = np.pad(valid, ((0, pad_h), (0, pad_w)), constant_values=False)

    bh = values.shape[0] // out_size
    bw = values.shape[1] // out_size
    sums = values.reshape(out_size, bh, out_size, bw).sum(axis=(1, 3), dtype=np.float64)
    counts = valid.reshape(out_size, bh, out_size, bw).sum(axis=(1, 3))
    result = np.divide(sums, counts, out=np.full_like(sums, np.nan), where=counts > 0)
    return result


def fill_nan_nearest(values: np.ndarray) -> np.ndarray:
    """Rellena NaN con el promedio de vecinos válidos (iterativo y acotado)."""
    filled = values.copy()
    for _ in range(12):
        holes = ~np.isfinite(filled)
        if not holes.any():
            break
        padded = np.pad(filled, 1, mode="edge")
        stack = np.stack(
            [
                padded[:-2, 1:-1],
                padded[2:, 1:-1],
                padded[1:-1, :-2],
                padded[1:-1, 2:],
            ]
        )
        finite = np.isfinite(stack)
        total = np.where(finite, stack, 0.0).sum(axis=0)
        count = finite.sum(axis=0)
        neighbour_mean = np.divide(
            total, count, out=np.full_like(total, np.nan), where=count > 0
        )
        fill_mask = holes & np.isfinite(neighbour_mean)
        filled[fill_mask] = neighbour_mean[fill_mask]
    return np.nan_to_num(filled, nan=float(np.nanmin(values)))


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.exists():
        raise SystemExit(f"No se encontró el archivo: {src}")

    print(f"Leyendo {src.name} ...")
    image = Image.open(src)
    source_height, source_width = image.height, image.width
    values = np.array(image, dtype=np.float32)
    print(f"  {source_width} x {source_height} px, dtype {values.dtype}")

    valid = np.isfinite(values) & (values > -1.0e30)
    if not valid.any():
        raise SystemExit("El ráster no contiene datos válidos.")

    rows = np.flatnonzero(valid.any(axis=1))
    cols = np.flatnonzero(valid.any(axis=0))
    r0, r1 = int(rows[0]), int(rows[-1]) + 1
    c0, c1 = int(cols[0]), int(cols[-1]) + 1
    coverage = float(valid[r0:r1, c0:c1].mean())
    print(f"  área válida: x={c0}..{c1}, y={r0}..{r1} (cobertura {coverage:.1%})")

    cropped = values[r0:r1, c0:c1]
    mask = valid[r0:r1, c0:c1]

    print(f"Reduciendo a {OUT_SIZE}x{OUT_SIZE} (media por bloques) ...")
    coarse = block_average(cropped, mask, OUT_SIZE)
    valid_ratio = np.isfinite(coarse).mean()
    coarse_filled = fill_nan_nearest(coarse)
    del values, valid, cropped, mask

    elevation_min = float(np.nanmin(coarse))
    elevation_max = float(np.nanmax(coarse))
    p2, p98 = (float(v) for v in np.nanpercentile(coarse, [2, 98]))

    span = elevation_max - elevation_min
    if span <= 0:
        span = 1.0
    quantized = np.empty(coarse.shape, dtype=np.uint16)
    scaled = (coarse_filled - elevation_min) / span * (NODATA_SENTINEL - 1)
    quantized[:] = np.clip(np.rint(scaled), 0, NODATA_SENTINEL - 1).astype(np.uint16)
    quantized[~np.isfinite(coarse)] = NODATA_SENTINEL

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    height_path = OUT_DIR / "mars_height.bin"
    quantized.astype("<u2").tofile(height_path)

    # Georreferencia: el ráster original usa origen (0,0) = 0°N, 0°E.
    tiepoint = image.tag_v2.get(33922)
    origin_x = float(tiepoint[3]) if tiepoint else 0.0
    origin_y = float(tiepoint[4]) if tiepoint else 0.0
    lon_min = (origin_x + c0) * DEG_PER_METER
    lon_max = (origin_x + c1) * DEG_PER_METER
    lat_max = (origin_y - r0) * DEG_PER_METER
    lat_min = (origin_y - r1) * DEG_PER_METER

    width_m = (c1 - c0) * 1.0
    height_m = (r1 - r0) * 1.0

    meta = {
        "width": OUT_SIZE,
        "height": OUT_SIZE,
        "nodata": NODATA_SENTINEL,
        "dtype": "uint16",
        "minElevation": round(elevation_min, 2),
        "maxElevation": round(elevation_max, 2),
        "colorMin": round(min(p2, p98), 2),
        "colorMax": round(max(p2, p98), 2),
        "widthMeters": round(width_m, 1),
        "heightMeters": round(height_m, 1),
        "sourcePixelSizeMeters": 1.0,
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "sourceBoundsPx": {"x0": c0, "y0": r0, "x1": c1, "y1": r1},
        "validRatio": round(float(valid_ratio), 4),
        "bounds": {
            "latMin": round(lat_min, 5),
            "latMax": round(lat_max, 5),
            "lonMin": round(lon_min, 5),
            "lonMax": round(lon_max, 5),
        },
        "center": {
            "lat": round((lat_min + lat_max) / 2, 5),
            "lon": round((lon_min + lon_max) / 2, 5),
        },
        "crs": "Mars 2000 Sphere / Equirectangular",
        "sourceFile": src.name,
    }
    meta_path = OUT_DIR / "mars_height_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"  elevación: {elevation_min:.1f} m .. {elevation_max:.1f} m")
    print(f"  centro: {meta['center']['lat']:.3f}°N {meta['center']['lon']:.3f}°E")
    print(f"Escrito {height_path.relative_to(ROOT)} ({height_path.stat().st_size / 1e6:.2f} MB)")
    print(f"Escrito {meta_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
