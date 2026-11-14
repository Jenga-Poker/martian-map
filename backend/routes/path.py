import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from libs.pathfinding import shortest_path

router = APIRouter(tags=["path"])


class Coordinate(BaseModel):
    row: int = Field(..., ge=0, description="Fila (píxel) en el DEM")
    col: int = Field(..., ge=0, description="Columna (píxel) en el DEM")


class PathRequest(BaseModel):
    zone: str = Field(..., description="Nombre del archivo/zona dentro de data/*.tif")
    start: Coordinate
    end: Coordinate
    margin: int = Field(50, ge=0, le=2000, description="Margen alrededor del área de búsqueda")


@router.post("/path")
async def calculate_path(request: PathRequest):
    """Calcula el camino más corto entre dos coordenadas en un DEM de data/."""
    try:
        result = await asyncio.to_thread(
            shortest_path,
            request.zone,
            (request.start.row, request.start.col),
            (request.end.row, request.end.col),
            request.margin,
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
