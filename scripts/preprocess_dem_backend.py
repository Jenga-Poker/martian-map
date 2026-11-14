from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import rasterio

# Debe coincidir con DATA_DIR de pathfinding.py.
DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def resolve_zone_file(zone: str) -> Path:
    """Resuelve un nombre de zona a un GeoTIFF dentro de data/."""
    safe_name = Path(zone).name
    if safe_name != zone or not safe_name:
        raise ValueError("Nombre de zona inválido.")

    if safe_name.lower().endswith(".npz"):
        safe_name = safe_name[:-4]
    candidates = [DATA_DIR / f"{safe_name}.tif"]
    if safe_name.lower().endswith(".tif"):
        candidates.insert(0, DATA_DIR / safe_name)

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"No se encontró el GeoTIFF de la zona en data/: {zone}")


def preprocess_zone(zone: str, *, overwrite: bool = False) -> Path:
    """Convierte un GeoTIFF en un .npz autocontenido para pathfinding.py."""
    source = resolve_zone_file(zone)
    output = DATA_DIR / f"{source.stem}.npz"
    if output.exists() and not overwrite:
        print(f"[preprocess] Ya existe; no se modifica: {output}")
        return output

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[preprocess] Leyendo {source.name}")
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

    # Escritura atómica: evita dejar un .npz incompleto si el proceso se interrumpe.
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
        f"[preprocess] Guardado {output.name}: {dem.shape[0]}x{dem.shape[1]}, "
        f"{output.stat().st_size / (1024 * 1024):.1f} MiB"
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Preprocesa todos los GeoTIFF de data/ a archivos binarios .npz."
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Recrear los .npz aunque ya existan.",
    )
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tif_files = sorted(
        path for path in DATA_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in {".tif", ".tiff"}
    )

    if not tif_files:
        print(f"[preprocess] No se encontraron archivos .tif/.tiff en {DATA_DIR}")
        return

    print(f"[preprocess] Encontrados {len(tif_files)} GeoTIFF en {DATA_DIR}")
    succeeded = 0
    failed = 0

    for source in tif_files:
        try:
            output = DATA_DIR / f"{source.stem}.npz"
            if output.exists() and not args.overwrite:
                print(f"[preprocess] Ya existe; se omite: {output.name}")
                succeeded += 1
                continue

            preprocess_zone(source.name, overwrite=args.overwrite)
            succeeded += 1
        except Exception as exc:
            failed += 1
            print(f"[preprocess] ERROR en {source.name}: {exc}")

    print(
        f"[preprocess] Finalizado: {succeeded} correcto(s), "
        f"{failed} error(es), de {len(tif_files)} archivo(s)."
    )
    if failed:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
