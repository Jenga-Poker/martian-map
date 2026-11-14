import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from libs.pathfinding import shortest_path

router = APIRouter(tags=["path"])


class Coordinate(BaseModel):
    lat: float = Field(..., description="Latitud en grados")
    lon: float = Field(..., description="Longitud en grados")


class PathRequest(BaseModel):
    zone: str = Field(..., description="Nombre del archivo/zona dentro de data/*.tif")
    start: Coordinate
    end: Coordinate
    max_height_diff: float | None = Field(
        default=None,
        gt=0,
        description="Máxima diferencia de altura permitida entre celdas vecinas; si se supera se bloquea la conexión.",
    ),
    multipliers: tuple[int]


@router.post("/path")
async def calculate_path(request: PathRequest):
    """Calcula el camino más corto entre dos coordenadas geográficas en un DEM de data/."""
    print("ME PANCEARON")

    try:
        result = await asyncio.to_thread(
            shortest_path,
            request.zone,
            (request.start.lat, request.start.lon),
            (request.end.lat, request.end.lon),
            max_height_diff=request.max_height_diff,
            height_multiplier_1=request.multipliers[0],
            height_multiplier_2=request.multipliers[1],
            height_multiplier_3=request.multipliers[2],
        )
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Error al calcular la ruta: {exc}"
        ) from exc
