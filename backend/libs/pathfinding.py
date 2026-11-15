from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path
from typing import Iterable

import networkx as nx
import numpy as np
from rasterio.crs import CRS
from rasterio.transform import Affine, rowcol
from rasterio.warp import transform as warp_transform

# Directorio de datos: <repo>/data
DATA_DIR = Path(__file__).resolve().parents[2] / "data"
HEIGHT_MULTIPLIERS = (500.0, 2000.0, 5000.0)

def resolve_preprocessed_file(zone: str) -> Path:
    """Localiza el raster binario preprocesado (.npz) dentro de data/."""
    safe_name = Path(zone).name
    if safe_name != zone or not safe_name:
        raise ValueError("Nombre de zona inválido.")

    if safe_name.lower().endswith(".tif"):
        safe_name = safe_name[:-4]
    elif safe_name.lower().endswith(".npz"):
        safe_name = safe_name[:-4]

    path = DATA_DIR / f"{safe_name}.npz"
    if not path.is_file():
        raise FileNotFoundError(
            f"No existe el binario preprocesado: {path}. "
            "Ejecuta primero preprocess_dem.py para generar el archivo .npz."
        )
    return path


@lru_cache(maxsize=4)
def _load_preprocessed_dem(binary_path: str):
    """Carga y mantiene en caché el DEM binario para reutilizarlo entre rutas."""
    with np.load(binary_path, allow_pickle=False) as data:
        dem = data["dem"].astype(np.float32, copy=False)
        transform = Affine(*data["transform"].tolist())
        crs_text = str(data["crs_wkt"].item())
        nodata_value = float(data["nodata"].item())
        bounds = tuple(float(v) for v in data["bounds"].tolist())

    crs = CRS.from_wkt(crs_text) if crs_text else None
    nodata = None if np.isnan(nodata_value) else nodata_value
    return dem, transform, crs, nodata, bounds


def _geographic_crs(crs: CRS | None) -> CRS | None:
    """Devuelve el CRS geográfico asociado a un CRS proyectado.

    ``CRS.geodetic_crs`` no existe en rasterio 1.4 (la versión del contenedor),
    así que en ese caso reconstruimos el CRS geográfico a partir de los
    parámetros del elipsoide/datum del CRS proyectado.
    """
    if crs is None or crs.is_geographic:
        return crs

    geodetic = getattr(crs, "geodetic_crs", None)
    if geodetic is not None:
        return geodetic

    data = crs.to_dict()
    params = {
        key: data[key]
        for key in ("a", "b", "R", "rf", "f", "datum", "ellps", "towgs84", "pm")
        if key in data
    }
    params["proj"] = "longlat"
    params["no_defs"] = True
    return CRS.from_dict(params)


def _report_progress(progress, message: str) -> None:
    if progress is None:
        print(message, flush=True)
    else:
        progress(message)


def _astar_grid(
    dem: np.ndarray,
    start: tuple[int, int],
    end: tuple[int, int],
    *,
    max_height_diff: float | None = None,
    cell_step: int = 1,
    progress=None,
    progress_interval: int = 50000,
    height_multipliers: Iterable[float] = HEIGHT_MULTIPLIERS,
) -> dict[float, tuple[list[tuple[int, int]], float]]:
    """A* sobre una grilla 8-conexa usando NetworkX.

    Construye un grafo con las conexiones válidas (cardinales y diagonales),
    respetando nodata y ``max_height_diff``, y ejecuta ``networkx.astar_path``
    con heurística euclídea admisible. ``cell_step`` escala distancias/costes
    cuando la grilla es una versión submuestreada del DEM original.
    """
    rows, cols = dem.shape
    sr, sc = start
    er, ec = end

    if not (0 <= sr < rows and 0 <= sc < cols and 0 <= er < rows and 0 <= ec < cols):
        raise ValueError("Los puntos de inicio o destino no son válidos en el grafo.")

    finite = np.isfinite(dem) & (dem > -9000.0)
    if not finite[sr, sc] or not finite[er, ec]:
        raise ValueError("Los puntos de inicio o destino no son válidos en el grafo.")

    total_cells = rows * cols
    start_dist = math.hypot(er - sr, ec - sc) * cell_step
    _report_progress(
        progress,
        f"[pathfinding] Construyendo grafo NetworkX: grilla={rows}x{cols} ({total_cells} nodos), "
        f"paso={cell_step} celda(s), conectividad=8, distancia inicial={start_dist:.1f}, max_height_diff={max_height_diff}",
    )

    graph = nx.Graph()
    # Forward directions cover all 8-neighborhood edges without duplicates.
    directions = ((0, 1, 1.0), (1, 0, 1.0), (1, 1, math.sqrt(2.0)), (1, -1, math.sqrt(2.0)))
    for r in range(rows):
        for c in range(cols):
            if not finite[r, c]:
                continue
            u = (r, c)
            graph.add_node(u)
            h_u = float(dem[r, c])

            for dr, dc, dist_mul in directions:
                nr, nc = r + dr, c + dc
                if nr < 0 or nr >= rows or nc < 0 or nc >= cols or not finite[nr, nc]:
                    continue
                h_v = float(dem[nr, nc])
                height_diff = abs(h_v - h_u)
                if max_height_diff is not None and height_diff > max_height_diff * cell_step:
                    continue
                # Guardamos los componentes del coste por separado para poder
                # reutilizar el mismo grafo con distintos height multipliers.
                graph.add_edge(
                    u,
                    (nr, nc),
                    distance=dist_mul * cell_step,
                    height_diff=height_diff,
                )

    if start not in graph or end not in graph:
        raise ValueError("Los puntos de inicio o destino no son válidos en el grafo.")

    _report_progress(
        progress,
        f"[pathfinding] Grafo listo: nodos={graph.number_of_nodes()}, aristas={graph.number_of_edges()}. "
        "Ejecutando A* (NetworkX, 8-conexo)...",
    )

    def heuristic(u: tuple[int, int], v: tuple[int, int]) -> float:
        return math.hypot(v[0] - u[0], v[1] - u[1]) * cell_step

    results: dict[float, tuple[list[tuple[int, int]], float]] = {}
    for multiplier in height_multipliers:
        multiplier = float(multiplier)

        def edge_weight(u, v, data, factor=multiplier):
            return data["distance"] + data["height_diff"] * factor

        try:
            path = nx.astar_path(
                graph,
                source=start,
                target=end,
                heuristic=heuristic,
                weight=edge_weight,
            )
        except nx.NetworkXNoPath as exc:
            _report_progress(
                progress,
                f"[pathfinding] Sin ruta para height_multiplier={multiplier}",
            )
            raise ValueError(
                f"No se encontró una ruta válida para height_multiplier={multiplier}."
            ) from exc

        # nx.path_weight solo acepta el nombre de un atributo, no una
        # función de peso como nx.astar_path. Calculamos el coste con el
        # mismo callback para mantener exactamente la misma ponderación.
        total_cost = float(sum(
            edge_weight(u, v, graph[u][v])
            for u, v in zip(path, path[1:])
        ))
        results[multiplier] = (list(path), total_cost)
        _report_progress(
            progress,
            f"[pathfinding] Ruta encontrada: multiplier={multiplier}, "
            f"{len(path)} puntos, coste={total_cost:.3f}",
        )

    return results


def shortest_path(
    zone: str,
    start: Iterable[float],
    end: Iterable[float],
    max_height_diff: float | None = None,
    progress=None,
    progress_interval: int = 50000,
    sample_points: int | None = 350,
    height_multiplier_1: float = 1.0,
    height_multiplier_2: float = 5.0,
    height_multiplier_3: float = 50.0,
) -> dict:
    """Calcula la ruta más corta entre dos coordenadas geográficas en un DEM.

    Lee exclusivamente un DEM binario .npz preprocesado y construye una grilla 8-conexa (cardinal y diagonal, submuestreada para usar
    solo un conjunto reducido de puntos), aplica restricciones de altura máxima
    entre nodos, y calcula la ruta con ``networkx.astar_path`` usando heurística
    euclídea admisible.

    Args:
        zone: Nombre de zona del binario .npz dentro de data/ (con o sin extensión).
        start: Coordenada de inicio [latitud, longitud] en grados.
        end: Coordenada de destino [latitud, longitud] en grados.
        max_height_diff: Diferencia máxima de altura permitida por celda del
            DEM original; al usar submuestreo se escala por el paso entre nodos.
        progress: Callback ``callable(str)`` para mensajes de progreso. Si es
            ``None`` (por defecto), se imprime por stdout.
        progress_interval: Conservado por compatibilidad (no aplica a A* de NetworkX).
        sample_points: Objetivo aproximado de puntos por lado de la grilla de
            búsqueda (p.ej. 250 => ~62k nodos máx. por ventana). ``None`` o <=0
            usa resolución completa (1 celda = 1 nodo).
        height_multiplier_1: Primer multiplicador para ponderar la variación de altura.
        height_multiplier_2: Segundo multiplicador para ponderar la variación de altura.
        height_multiplier_3: Tercer multiplicador para ponderar la variación de altura.
            El grafo se construye una sola vez y se reutiliza para los tres.

    Returns:
        Diccionario con la ruta y metadatos.
    """
    dem_path = resolve_preprocessed_file(zone)

    start_geo = (float(start[0]), float(start[1]))
    end_geo = (float(end[0]), float(end[1]))

    _report_progress(progress, f"[pathfinding] Binario preprocesado: {dem_path.name}")
    _report_progress(progress, f"[pathfinding] Coordenadas: inicio={start_geo}, fin={end_geo}")

    dem, transform, crs, nodata, bounds = _load_preprocessed_dem(str(dem_path.resolve()))
    height, width = dem.shape
    geographic_crs = _geographic_crs(crs)

    def to_pixel(lat: float, lon: float) -> tuple[int, int]:
        # The API receives lat/lon degrees, but projected DEMs (such as the
        # bundled Jezero raster) use metres in their native CRS.
        if crs is not None and crs.is_projected and geographic_crs is not None:
            xs, ys = warp_transform(geographic_crs, crs, [lon], [lat])
            x, y = float(xs[0]), float(ys[0])
        else:
            x, y = lon, lat

        r, c = rowcol(transform, x, y)
        return int(r), int(c)

    start_pt = to_pixel(*start_geo)
    end_pt = to_pixel(*end_geo)
    _report_progress(
        progress,
        f"[pathfinding] Píxeles: inicio={start_pt}, fin={end_pt}, DEM={height}x{width}",
    )

    for name, (r, c), (lat, lon) in (
        ("start", start_pt, start_geo),
        ("end", end_pt, end_geo),
    ):
        if not (0 <= r < height and 0 <= c < width):
            raise ValueError(
                f"La coordenada {name} ({lat}, {lon}) está fuera del área del DEM "
                f"(extensión del raster: {bounds})."
            )

    dist = max(abs(end_pt[0] - start_pt[0]), abs(end_pt[1] - start_pt[1]))
    margin = max(50, min(500, dist // 2))

    r0 = max(0, min(start_pt[0], end_pt[0]) - margin)
    r1 = min(height, max(start_pt[0], end_pt[0]) + margin + 1)
    c0 = max(0, min(start_pt[1], end_pt[1]) - margin)
    c1 = min(width, max(start_pt[1], end_pt[1]) + margin + 1)
    _report_progress(
        progress,
        f"[pathfinding] Ventana de búsqueda: filas [{r0}, {r1}), cols [{c0}, {c1}) "
        f"-> {r1 - r0}x{c1 - c0} celdas, margen={margin}",
    )

    sub_dem = dem[r0:r1, c0:c1].astype(np.float32, copy=True)
    if sub_dem.size == 0:
        raise ValueError("El área de búsqueda resultante está vacía.")

    if nodata is not None:
        sub_dem[sub_dem == nodata] = np.nan

    sub_h, sub_w = sub_dem.shape
    if sample_points is None or sample_points <= 0:
        stride = 1
    else:
        stride = max(1, int(math.ceil(max(sub_h, sub_w) / float(sample_points))))

    ls_r, ls_c = start_pt[0] - r0, start_pt[1] - c0
    le_r, le_c = end_pt[0] - r0, end_pt[1] - c0

    grid_dem = sub_dem[::stride, ::stride]
    grid_h, grid_w = grid_dem.shape
    local_start = (min(ls_r // stride, grid_h - 1), min(ls_c // stride, grid_w - 1))
    local_end = (min(le_r // stride, grid_h - 1), min(le_c // stride, grid_w - 1))
    # Ensure exact endpoints are represented in the coarse grid.
    grid_dem = grid_dem.copy()
    grid_dem[local_start[0], local_start[1]] = sub_dem[ls_r, ls_c]
    grid_dem[local_end[0], local_end[1]] = sub_dem[le_r, le_c]

    _report_progress(
        progress,
        f"[pathfinding] Submuestreo: paso={stride} -> grilla {grid_h}x{grid_w} "
        f"({grid_h * grid_w} nodos) desde ventana {sub_h}x{sub_w}",
    )

    multipliers = (
        float(height_multiplier_1),
        float(height_multiplier_2),
        float(height_multiplier_3),
    )
    if len(set(multipliers)) != 3:
        raise ValueError("Los tres height_multiplier deben ser distintos.")
    if any(value < 0 for value in multipliers):
        raise ValueError("Los height_multipliers no pueden ser negativos.")

    local_results = _astar_grid(
        grid_dem,
        local_start,
        local_end,
        max_height_diff=max_height_diff,
        cell_step=stride,
        progress=progress,
        progress_interval=progress_interval,
        height_multipliers=multipliers,
    )

    routes = []
    for multiplier, (local_path, total_cost) in local_results.items():
        path: list[list[int]] = []
        for i, (gr, gc) in enumerate(local_path):
            if i == 0:
                rr, cc = ls_r, ls_c
            elif i == len(local_path) - 1:
                rr, cc = le_r, le_c
            else:
                rr = min(gr * stride, sub_h - 1)
                cc = min(gc * stride, sub_w - 1)
            point = [rr + r0, cc + c0]
            if not path or path[-1] != point:
                path.append(point)

        heights = [float(dem[r, c]) for r, c in path]
        total_height_variation = (
            float(np.abs(np.diff(heights)).sum()) if len(heights) > 1 else 0.0
        )

        routes.append({
            "height_multiplier": multiplier,
            "points": len(path),
            "total_cost": total_cost,
            "path": path,
            "heights": heights,
            "total_height_variation": total_height_variation,
        })
        _report_progress(
            progress,
            f"[pathfinding] Completada ruta multiplier={multiplier}: "
            f"{len(path)} puntos, variación de altura={total_height_variation:.3f}",
        )

    return routes
