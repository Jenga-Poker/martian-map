from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import rasterio

# Must match DATA_DIR in pathfinding.py.
DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def resolve_zone_file(zone: str) -> Path:
    """Resolves a zone name to a GeoTIFF inside data/."""
    safe_name = Path(zone).name
    if safe_name != zone or not safe_name:
        raise ValueError("Invalid zone name.")

    if safe_name.lower().endswith(".npz"):
        safe_name = safe_name[:-4]
    candidates = [DATA_DIR / f"{safe_name}.tif"]
    if safe_name.lower().endswith(".tif"):
        candidates.insert(0, DATA_DIR / safe_name)

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Zone GeoTIFF not found in data/: {zone}")


def preprocess_zone(zone: str, *, overwrite: bool = False) -> Path:
    """Converts a GeoTIFF into a self-contained .npz for pathfinding.py."""
    source = resolve_zone_file(zone)
    output = DATA_DIR / f"{source.stem}.npz"
    if output.exists() and not overwrite:
        print(f"[preprocess] Already exists; leaving unchanged: {output}")
        return output

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[preprocess] Reading {source.name}")
    with rasterio.open(source) as dataset:
        dem = dataset.read(1).astype(np.float32, copy=False)
        transform = np.asarray(tuple(dataset.transform), dtype=np.float64)
        crs_wkt = dataset.crs.to_wkt() if dataset.crs else ""
        nodata = np.nan if dataset.nodata is None else float(dataset.nodata)
        bounds = np.asarray(
            [dataset.bounds.left, dataset.bounds.bottom,
             dataset.bounds.right, dataset.bounds.top],
            dtype=np.float64,
        )

    # Atomic write: avoids leaving an incomplete .npz if the process is interrupted.
    temporary = output.with_name(output.name + ".tmp.npz")
    np.savez_compressed(
        temporary,
        dem=dem,
        transform=transform,
        crs_wkt=np.asarray(crs_wkt),
        nodata=np.asarray(nodata, dtype=np.float64),
        bounds=bounds,
    )
    temporary.replace(output)
    print(
        f"[preprocess] Saved {output.name}: {dem.shape[0]}x{dem.shape[1]}, "
        f"{output.stat().st_size / (1024 * 1024):.1f} MiB"
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Preprocesses all GeoTIFFs in data/ into .npz binary files."
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Recreate the .npz files even if they already exist.",
    )
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tif_files = sorted(
        path for path in DATA_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in {".tif", ".tiff"}
    )

    if not tif_files:
        print(f"[preprocess] No .tif/.tiff files found in {DATA_DIR}")
        return

    print(f"[preprocess] Found {len(tif_files)} GeoTIFF(s) in {DATA_DIR}")
    succeeded = 0
    failed = 0

    for source in tif_files:
        try:
            output = DATA_DIR / f"{source.stem}.npz"
            if output.exists() and not args.overwrite:
                print(f"[preprocess] Already exists; skipping: {output.name}")
                succeeded += 1
                continue

            preprocess_zone(source.name, overwrite=args.overwrite)
            succeeded += 1
        except Exception as exc:
            failed += 1
            print(f"[preprocess] ERROR in {source.name}: {exc}")

    print(
        f"[preprocess] Finished: {succeeded} succeeded, "
        f"{failed} failed, out of {len(tif_files)} file(s)."
    )
    if failed:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
