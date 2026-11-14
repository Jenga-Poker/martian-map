from __future__ import annotations

from pathlib import Path
from typing import Iterable

import networkx as nx
import numpy as np
import rasterio

# Directorio de datos: <repo>/data
DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def resolve_zone_file(zone: str) -> Path:
    """Resuelve un nombre de zona a un archivo .tif dentro de data/."""
    safe_name = Path(zone).name
    if safe_name != zone or not safe_name:
        raise ValueError("Nombre de zona inválido.")

    candidates = []
    if safe_name.lower().endswith(".tif"):
        candidates.append(DATA_DIR / safe_name)
    else:
        candidates.append(DATA_DIR / f"{safe_name}.tif")
        candidates.append(DATA_DIR / safe_name)

    for path in candidates:
        if path.is_file():
            return path

    raise FileNotFoundError(f"No se encontró el archivo de zona en data/: {zone}")


def _movement_cost(
    dem: np.ndarray, p1: tuple[int, int], p2: tuple[int, int]
) -> float:
    r1, c1 = p1
    r2, c2 = p2
    h1 = dem[r1, c1]
    h2 = dem[r2, c2]

    if np.isnan(h1) or np.isnan(h2) or h1 <= -9000 or h2 <= -9000:
        return float("inf")

    distance = float(np.hypot(r2 - r1, c2 - c1))
    slope_penalty = abs(float(h2) - float(h1)) * 2.0
    return distance + slope_penalty


def _build_subgraph(dem: np.ndarray) -> nx.Graph:
    rows, cols = dem.shape
    graph = nx.grid_2d_graph(rows, cols)
    for u, v in graph.edges():
        graph[u][v]["weight"] = _movement_cost(dem, u, v)
    return graph


def shortest_path(
    zone: str,
    start: Iterable[int],
    end: Iterable[int],
    margin: int = 50,
) -> dict:
    """Calcula la ruta más corta entre dos coordenadas de píxel en un DEM.

    Args:
        zone: Nombre de zona/archivo dentro de data/ (con o sin .tif).
        start: Coordenada de inicio [fila, columna].
        end: Coordenada de destino [fila, columna].
        margin: Margen extra alrededor del área de búsqueda.

    Returns:
        Diccionario con la ruta y metadatos.
    """
    dem_path = resolve_zone_file(zone)

    start_pt = (int(start[0]), int(start[1]))
    end_pt = (int(end[0]), int(end[1]))

    with rasterio.open(dem_path) as src:
        dem = src.read(1)
        height, width = dem.shape
        nodata = src.nodata

    for name, (r, c) in ("start", start_pt), ("end", end_pt):
        if not (0 <= r < height and 0 <= c < width):
            raise ValueError(
                f"La coordenada {name} {r, c} está fuera de rango (alto={height}, ancho={width})."
            )

    if nodata is not None:
        dem = dem.astype(np.float32, copy=True)
        dem[dem == nodata] = np.nan

    r0 = max(0, min(start_pt[0], end_pt[0]) - margin)
    r1 = min(height, max(start_pt[0], end_pt[0]) + margin + 1)
    c0 = max(0, min(start_pt[1], end_pt[1]) - margin)
    c1 = min(width, max(start_pt[1], end_pt[1]) + margin + 1)

    sub_dem = dem[r0:r1, c0:c1]
    if sub_dem.size == 0:
        raise ValueError("El área de búsqueda resultante está vacía.")

    local_start = (start_pt[0] - r0, start_pt[1] - c0)
    local_end = (end_pt[0] - r0, end_pt[1] - c0)

    graph = _build_subgraph(sub_dem)

    if local_start not in graph or local_end not in graph:
        raise ValueError("Los puntos de inicio o destino no son válidos en el grafo.")

    try:
        local_path = nx.astar_path(
            graph, source=local_start, target=local_end, weight="weight"
        )
    except nx.NetworkXNoPath as exc:
        raise ValueError("No se encontró una ruta válida entre los puntos.") from exc

    path = [[r + r0, c + c0] for r, c in local_path]
    total_cost = float(nx.path_weight(graph, local_path, weight="weight"))

    return {
        "zone": dem_path.name,
        "start": [start_pt[0], start_pt[1]],
        "end": [end_pt[0], end_pt[1]],
        "points": len(path),
        "total_cost": total_cost,
        "path": path,
    }
