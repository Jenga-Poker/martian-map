"""Converts THEMIS rockiness rasters into layers aligned with each DEM.

The `rocky_*_themis_night.tif` GeoTIFFs use 0 = not rocky, 1 = rocky
and 255 = no data. To overlay them on the 1024 x 1024 terrain
they are resampled to the same geographic framing as the processed DEM.

Usage:
    python scripts/process-rocky.py

Generates in frontend/public/terrain/<poi>/:
    rocky.bin        uint8 1024x1024 (0..254 = rocky fraction, 255 = no data)
    rocky_meta.json  layer metadata
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
TERRAIN_DIR = ROOT / "frontend/public/terrain"
OUT_SIZE = 1024
NODATA = 255

MARS_SPHERE_RADIUS_M = 3_396_190.0
METERS_PER_DEGREE = math.pi * MARS_SPHERE_RADIUS_M / 180.0

TARGETS = [
    ("crater_gale", "rocky_gale_themis_night.tif"),
    ("crater_jezero", "rocky_jezero_themis_night.tif"),
    ("valles_marineris", "rocky_valles_marineris_themis_night.tif"),
]


def normalize_lon(lon: float) -> float:
    """Converts a longitude to 0..360 to match the THEMIS rasters."""
    return lon % 360.0


def dem_crop_bounds(target: str) -> tuple[float, float, float, float]:
    """Returns (lonMin, latMin, lonMax, latMax) of the DEM crop."""
    meta_path = TERRAIN_DIR / target / "mars_height_meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    source = DATA_DIR / meta["sourceFile"]
    crop = meta["sourceBoundsPx"]

    with rasterio.open(source) as ds:
        left, top = ds.transform * (crop["x0"], crop["y0"])
        right, bottom = ds.transform * (crop["x1"], crop["y1"])

        if ds.crs.is_geographic:
            lon_min, lon_max = float(left), float(right)
            lat_min, lat_max = float(bottom), float(top)
        else:
            lon_min = float(left) / METERS_PER_DEGREE
            lon_max = float(right) / METERS_PER_DEGREE
            lat_min = float(bottom) / METERS_PER_DEGREE
            lat_max = float(top) / METERS_PER_DEGREE

    return (
        normalize_lon(lon_min),
        lat_min,
        normalize_lon(lon_max),
        lat_max,
    )


def process(target: str, rocky_name: str) -> None:
    rocky_path = DATA_DIR / rocky_name
    lon_min, lat_min, lon_max, lat_max = dem_crop_bounds(target)

    if lon_max <= lon_min:
        lon_max += 360.0

    xres = (lon_max - lon_min) / OUT_SIZE
    yres = (lat_max - lat_min) / OUT_SIZE
    dst_transform = rasterio.transform.from_origin(lon_min, lat_max, xres, yres)

    with rasterio.open(rocky_path) as src:
        source = src.read(1)
        destination = np.full((OUT_SIZE, OUT_SIZE), float(NODATA), dtype=np.float32)

        reproject(
            source=source,
            destination=destination,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src.nodata if src.nodata is not None else NODATA,
            dst_transform=dst_transform,
            dst_crs=src.crs,
            dst_nodata=float(NODATA),
            resampling=Resampling.average,
        )

    missing = np.isclose(destination, float(NODATA))
    # average returns the rocky fraction (0..1) in each output cell.
    mask = np.clip(np.rint(destination * (NODATA - 1)), 0, NODATA - 1).astype(
        np.uint8
    )
    mask[missing] = NODATA

    out_dir = TERRAIN_DIR / target
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "rocky.bin").write_bytes(mask.tobytes())

    valid = mask != NODATA
    meta = {
        "width": OUT_SIZE,
        "height": OUT_SIZE,
        "dtype": "uint8",
        "nodata": NODATA,
        "rockyMin": 0,
        "rockyMax": NODATA - 1,
        "sourceFile": rocky_name,
        "sourceResolutionDegrees": list(src.res),
        "bounds": {
            "lonMin": lon_min,
            "lonMax": lon_max,
            "latMin": lat_min,
            "latMax": lat_max,
        },
        "coverage": round(float(valid.mean()), 4),
        "rockyRatio": round(
            float((mask[valid] / (NODATA - 1)).mean()) if valid.any() else 0.0,
            4,
        ),
    }
    (out_dir / "rocky_meta.json").write_text(
        json.dumps(meta, indent=2),
        encoding="utf-8",
    )

    print(
        f"{target}: {mask.shape[1]}x{mask.shape[0]} "
        f"coverage={meta['coverage']:.1%} "
        f"mean rockiness={meta['rockyRatio']:.1%}"
    )


def main() -> None:
    for target, rocky_name in TARGETS:
        process(target, rocky_name)


if __name__ == "__main__":
    main()
