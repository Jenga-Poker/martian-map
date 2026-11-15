import csv

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from rasterio.transform import rowcol
from rasterio.warp import transform as warp_transform

from libs.pathfinding import _geographic_crs, _load_preprocessed_dem, resolve_preprocessed_file
from config import DATA_DIR

router = APIRouter(tags=["locations"])

DATA_FILE = DATA_DIR / "locations.csv"


def _clean(value: str) -> str:
    return value.strip().strip('"')

 
def _read_locations():
    if not DATA_FILE.exists():
        raise HTTPException(
            status_code=404, detail=f"No se encontró el archivo de ubicaciones: {DATA_FILE}"
        )

    try:
        with DATA_FILE.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter=";", skipinitialspace=True)
            locations = []
            for row in reader:
                if not row:
                    continue
                locations.append(
                    {
                        "name": _clean(row.get("NAME", "")),
                        "lat": float(_clean(row.get("LAT", "0"))),
                        "lon": float(_clean(row.get("LON", "0"))),
                        "height": float(_clean(row.get("HEIGHT", "0"))),
                        "zone": _clean(row.get("ZONE", "")),
                    }
                )
        return locations
    except ValueError as exc:
        raise HTTPException(
            status_code=500, detail=f"Error al parsear ubicaciones: {exc}"
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Error al leer ubicaciones: {exc}"
        ) from exc


@router.get("/locations")
async def get_locations():
    """Devuelve todos los puntos almacenados en data/locations.csv."""
    return {"locations": _read_locations()}


@router.get("/locations/{zone}")
async def get_locations_by_zone(zone: str):
    """Devuelve los puntos de data/locations.csv filtrados por zona."""
    zone_name = zone.strip()
    locations = [
        location
        for location in _read_locations()
        if location.get("zone", "").strip() == zone_name
    ]
    return {"locations": locations}


class LocationCreate(BaseModel):
    name: str = Field(..., min_length=1, description="Nombre del punto")
    lat: float = Field(..., description="Latitud en grados")
    lon: float = Field(..., description="Longitud en grados")
    zone: str = Field(..., min_length=1, description="Zona/DEM del que obtener la altura")


@router.post("/location")
@router.post("/locations")
async def create_location(request: LocationCreate):
    """Obtiene la altura desde el DEM de la zona para las coordenadas dadas y guarda el punto en data/locations.csv."""
    name = request.name.strip()
    zone = request.zone.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
    if not zone:
        raise HTTPException(status_code=400, detail="La zona no puede estar vacía.")

    try:
        dem_path = resolve_preprocessed_file(zone)
        dem, transform, crs, nodata, bounds = _load_preprocessed_dem(str(dem_path.resolve()))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        geographic_crs = _geographic_crs(crs)
        if crs is not None and crs.is_projected and geographic_crs is not None:
            xs, ys = warp_transform(geographic_crs, crs, [request.lon], [request.lat])
            x, y = float(xs[0]), float(ys[0])
        else:
            x, y = request.lon, request.lat

        row, col = rowcol(transform, x, y)
        row, col = int(row), int(col)
        height_arr, width_arr = dem.shape
        if not (0 <= row < height_arr and 0 <= col < width_arr):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"La coordenada ({request.lat}, {request.lon}) está fuera del área del DEM "
                    f"(extensión del raster: {bounds})."
                ),
            )

        height_value = float(dem[row, col])
        if nodata is not None and height_value == nodata:
            raise HTTPException(status_code=400, detail="La coordenada cae en un valor nodata del DEM.")
        if not np.isfinite(height_value) or height_value <= -9000.0:
            raise HTTPException(status_code=400, detail="La coordenada no tiene una altura válida en el DEM.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error al obtener la altura: {exc}") from exc

    try:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        # Ensure the file ends with a newline if it exists and has content
        if DATA_FILE.exists() and DATA_FILE.stat().st_size > 0:
            with DATA_FILE.open("rb+") as f:
                f.seek(-1, 2)
                last_char = f.read(1)
                if last_char != b"\n":
                    f.write(b"\n")

        file_exists = DATA_FILE.exists() and DATA_FILE.stat().st_size > 0
        with DATA_FILE.open("a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f, delimiter=";")
            if not file_exists:
                writer.writerow(["NAME", "LAT", "LON", "HEIGHT", "ZONE"])
            writer.writerow([name, request.lat, request.lon, round(height_value, 4), zone])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error al guardar la ubicación: {exc}") from exc

    return {
        "location": {
            "name": name,
            "lat": request.lat,
            "lon": request.lon,
            "height": round(height_value, 4),
            "zone": zone,
        }
    }

