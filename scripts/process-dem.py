
"""Converts a Mars elevation GeoTIFF into a web heightmap.

Usage:
    python backend/process_dem.py jezero_dem_1m.tif

Optional:
    python backend/process_dem.py dem.tif --pixel-size-meters 200

Generates:
    public/mars_height.bin
    public/mars_height_meta.json
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

OUT_SIZE = 1024
NODATA_SENTINEL = 65535
MARS_SPHERE_RADIUS_M = 3_396_190.0

DEG_PER_METER = 180.0 / (math.pi * MARS_SPHERE_RADIUS_M)
METERS_PER_DEGREE = 1.0 / DEG_PER_METER

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = ROOT / "data/valles_marineris_dem_200m.tif"
OUT_DIR = ROOT / "public"


def block_average(values, valid, out_size):
    """Block average ignoring nodata."""
    height, width = values.shape

    pad_h = math.ceil(height / out_size) * out_size - height
    pad_w = math.ceil(width / out_size) * out_size - width

    values = np.where(valid, values, 0.0).astype(np.float64)
    values = np.pad(
        values, ((0, pad_h), (0, pad_w)), mode="constant"
    )
    valid = np.pad(
        valid, ((0, pad_h), (0, pad_w)), constant_values=False
    )

    bh = values.shape[0] // out_size
    bw = values.shape[1] // out_size

    sums = values.reshape(
        out_size, bh, out_size, bw
    ).sum(axis=(1, 3), dtype=np.float64)

    counts = valid.reshape(
        out_size, bh, out_size, bw
    ).sum(axis=(1, 3))

    return np.divide(
        sums,
        counts,
        out=np.full_like(sums, np.nan),
        where=counts > 0,
    )


def fill_nan_nearest(values):
    """Fills gaps using valid neighbors."""
    filled = values.copy()

    for _ in range(12):
        holes = ~np.isfinite(filled)

        if not holes.any():
            break

        padded = np.pad(filled, 1, mode="edge")

        stack = np.stack([
            padded[:-2, 1:-1],
            padded[2:, 1:-1],
            padded[1:-1, :-2],
            padded[1:-1, 2:],
        ])

        finite = np.isfinite(stack)
        total = np.where(finite, stack, 0.0).sum(axis=0)
        count = finite.sum(axis=0)

        neighbour_mean = np.divide(
            total,
            count,
            out=np.full_like(total, np.nan),
            where=count > 0,
        )

        fill_mask = holes & np.isfinite(neighbour_mean)
        filled[fill_mask] = neighbour_mean[fill_mask]

    return np.nan_to_num(
        filled, nan=float(np.nanmin(values))
    )


def get_spatial_resolution(image, override=None):
    """
    Gets the spatial resolution of the GeoTIFF.

    Supports:
      - Geographic coordinates in degrees.
      - Projected coordinates in meters.
      - Manual resolution via arguments.
    """

    tags = image.tag_v2

    # GeoTIFF ModelPixelScaleTag
    pixel_scale = tags.get(33550)

    # GeoTIFF ModelTiepointTag
    tiepoint = tags.get(33922)

    if tiepoint:
        origin_x = float(tiepoint[3])
        origin_y = float(tiepoint[4])
    else:
        origin_x = 0.0
        origin_y = 0.0

    if override is not None:
        scale_x, scale_y = override
        geographic = False

    elif pixel_scale:
        scale_x = abs(float(pixel_scale[0]))
        scale_y = abs(float(pixel_scale[1]))

        # Heuristic for geographic coordinates in degrees.
        geographic = scale_x < 1.0 and scale_y < 1.0

    else:
        raise ValueError(
            "The GeoTIFF does not contain ModelPixelScaleTag. "
            "Specify --pixel-size-meters."
        )

    if geographic:
        # Resolution expressed in degrees.
        center_lat = (
            origin_y - image.height * scale_y / 2
        )

        meters_per_degree_y = METERS_PER_DEGREE

        meters_per_degree_x = (
            METERS_PER_DEGREE *
            math.cos(math.radians(center_lat))
        )

        mpp_x = scale_x * meters_per_degree_x
        mpp_y = scale_y * meters_per_degree_y

    else:
        # Projected coordinates in meters.
        center_lat = (
            origin_y - image.height * scale_y / 2
        ) * DEG_PER_METER

        # In an equirectangular projection, the real horizontal
        # distance depends on latitude.
        mpp_x = scale_x * math.cos(
            math.radians(center_lat)
        )
        mpp_y = scale_y

    return {
        "originX": origin_x,
        "originY": origin_y,
        "scaleX": scale_x,
        "scaleY": scale_y,
        "metersPerPixelX": mpp_x,
        "metersPerPixelY": mpp_y,
        "geographic": geographic,
        "centerLatitude": center_lat,
    }


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "source",
        nargs="?",
        default=str(DEFAULT_SRC),
    )

    parser.add_argument(
        "--pixel-size-meters",
        type=float,
        default=None,
        help="Manual horizontal resolution in meters/pixel.",
    )

    parser.add_argument(
        "--pixel-size-y-meters",
        type=float,
        default=None,
        help="Manual vertical resolution in meters/pixel.",
    )

    args = parser.parse_args()

    src = Path(args.source)

    if not src.exists():
        raise SystemExit(f"File not found: {src}")

    print(f"Reading {src.name} ...")

    image = Image.open(src)

    source_height = image.height
    source_width = image.width

    values = np.array(image, dtype=np.float32)

    print(
        f"  {source_width} x {source_height} px"
    )

    override = None

    if args.pixel_size_meters is not None:
        override = (
            args.pixel_size_meters,
            args.pixel_size_y_meters
            if args.pixel_size_y_meters is not None
            else args.pixel_size_meters,
        )

    spatial = get_spatial_resolution(image, override)

    mpp_x = spatial["metersPerPixelX"]
    mpp_y = spatial["metersPerPixelY"]

    if mpp_x <= 0 or mpp_y <= 0:
        raise SystemExit("Invalid spatial resolution.")

    print(f"  Resolution X: {mpp_x:.4f} m/px")
    print(f"  Resolution Y: {mpp_y:.4f} m/px")

    valid = np.isfinite(values) & (values > -1.0e30)

    if not valid.any():
        raise SystemExit("The raster does not contain valid data.")

    rows = np.flatnonzero(valid.any(axis=1))
    cols = np.flatnonzero(valid.any(axis=0))

    r0, r1 = int(rows[0]), int(rows[-1]) + 1
    c0, c1 = int(cols[0]), int(cols[-1]) + 1

    coverage = float(valid[r0:r1, c0:c1].mean())

    print(
        f"  Valid area: x={c0}..{c1}, "
        f"y={r0}..{r1} ({coverage:.1%})"
    )

    cropped = values[r0:r1, c0:c1]
    mask = valid[r0:r1, c0:c1]

    print(f"Downsampling to {OUT_SIZE}x{OUT_SIZE} ...")

    coarse = block_average(cropped, mask, OUT_SIZE)

    valid_ratio = np.isfinite(coarse).mean()

    coarse_filled = fill_nan_nearest(coarse)

    del values, valid, cropped, mask

    elevation_min = float(np.nanmin(coarse))
    elevation_max = float(np.nanmax(coarse))

    p2, p98 = (
        float(v)
        for v in np.nanpercentile(coarse, [2, 98])
    )

    span = max(elevation_max - elevation_min, 1.0)

    scaled = (
        (coarse_filled - elevation_min)
        / span
        * (NODATA_SENTINEL - 1)
    )

    quantized = np.clip(
        np.rint(scaled),
        0,
        NODATA_SENTINEL - 1,
    ).astype(np.uint16)

    quantized[~np.isfinite(coarse)] = NODATA_SENTINEL

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    height_path = OUT_DIR / "mars_height.bin"

    quantized.astype("<u2").tofile(height_path)

    # Physical dimensions of the cropped area.
    width_px = c1 - c0
    height_px = r1 - r0

    width_m = width_px * mpp_x
    height_m = height_px * mpp_y

    # Spatial resolution of each pixel of the final heightmap.
    output_mpp_x = width_m / OUT_SIZE
    output_mpp_y = height_m / OUT_SIZE

    # Georeferencing.
    origin_x = spatial["originX"]
    origin_y = spatial["originY"]

    if spatial["geographic"]:
        lon_min = origin_x + c0 * spatial["scaleX"]
        lon_max = origin_x + c1 * spatial["scaleX"]

        lat_max = origin_y - r0 * spatial["scaleY"]
        lat_min = origin_y - r1 * spatial["scaleY"]

    else:
        lon_min = (
            origin_x + c0 * spatial["scaleX"]
        ) * DEG_PER_METER

        lon_max = (
            origin_x + c1 * spatial["scaleX"]
        ) * DEG_PER_METER

        lat_max = (
            origin_y - r0 * spatial["scaleY"]
        ) * DEG_PER_METER

        lat_min = (
            origin_y - r1 * spatial["scaleY"]
        ) * DEG_PER_METER

    meta = {
        "width": OUT_SIZE,
        "height": OUT_SIZE,
        "nodata": NODATA_SENTINEL,
        "dtype": "uint16",

        "minElevation": round(elevation_min, 2),
        "maxElevation": round(elevation_max, 2),

        "colorMin": round(p2, 2),
        "colorMax": round(p98, 2),

        # Real physical dimensions.
        "widthMeters": round(width_m, 3),
        "heightMeters": round(height_m, 3),

        # Original resolution.
        "sourcePixelSizeMeters": {
            "x": round(mpp_x, 6),
            "y": round(mpp_y, 6),
        },

        # Resolution of the 1024x1024 heightmap.
        "metersPerPixel": {
            "x": round(output_mpp_x, 6),
            "y": round(output_mpp_y, 6),
        },

        "sourceWidth": source_width,
        "sourceHeight": source_height,

        "sourceBoundsPx": {
            "x0": c0,
            "y0": r0,
            "x1": c1,
            "y1": r1,
        },

        "validRatio": round(float(valid_ratio), 4),

        "bounds": {
            "latMin": round(lat_min, 7),
            "latMax": round(lat_max, 7),
            "lonMin": round(lon_min, 7),
            "lonMax": round(lon_max, 7),
        },

        "center": {
            "lat": round((lat_min + lat_max) / 2, 7),
            "lon": round((lon_min + lon_max) / 2, 7),
        },

        "crs": "Mars 2000 Sphere / Equirectangular",
        "sourceFile": src.name,
    }

    meta_path = OUT_DIR / "mars_height_meta.json"

    meta_path.write_text(
        json.dumps(meta, indent=2),
        encoding="utf-8",
    )

    print("\n--- RESULT ---")

    print(
        f"Elevation: {elevation_min:.2f} m .. "
        f"{elevation_max:.2f} m"
    )

    print(
        f"Dimensions: {width_m:.2f} x "
        f"{height_m:.2f} meters"
    )

    print(
        f"Heightmap: {output_mpp_x:.4f} x "
        f"{output_mpp_y:.4f} m/px"
    )

    print(
        f"Center: {meta['center']['lat']:.4f}°N "
        f"{meta['center']['lon']:.4f}°E"
    )

    print(f"\nWritten: {height_path}")
    print(f"Written: {meta_path}")


if __name__ == "__main__":
    main()
