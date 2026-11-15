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

from config import DATA_DIR

# Default multipliers for the slope cost (slope^2).
# 0    -> shortest route (distance only)
# 100  -> balanced route
# 1000 -> strongly avoids slopes: takes the detour through the plains
# If 1000 is still not flat enough, try 3000 or 5000.
HEIGHT_MULTIPLIERS = (0.0, 100.0, 1000.0)


def resolve_preprocessed_file(zone: str) -> Path:
    """Locates the preprocessed binary raster (.npz) inside data/."""
    safe_name = Path(zone).name
    if safe_name != zone or not safe_name:
        raise ValueError("Invalid zone name.")

    if safe_name.lower().endswith(".tif"):
        safe_name = safe_name[:-4]
    elif safe_name.lower().endswith(".npz"):
        safe_name = safe_name[:-4]

    path = DATA_DIR / f"{safe_name}.npz"
    if not path.is_file():
        # Try matching by prefix or finding an npz containing the zone name
        candidates = list(DATA_DIR.glob(f"*{safe_name}*.npz"))
        if candidates:
            return candidates[0]
        raise FileNotFoundError(
            f"Preprocessed binary does not exist: {path}. "
            "Run preprocess_dem.py first to generate the .npz file."
        )
    return path


@lru_cache(maxsize=4)
def _load_preprocessed_dem(binary_path: str):
    """Loads and caches the binary DEM to reuse it across routes."""
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
    """Returns the geographic CRS associated with a projected CRS.

    ``CRS.geodetic_crs`` does not exist in rasterio 1.4 (the container version),
    so in that case we rebuild the geographic CRS from the
    ellipsoid/datum parameters of the projected CRS.
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


def _pixel_size_meters(transform: Affine, crs: CRS | None, ref_lat: float) -> float:
    """Pixel size in meters (needed to compute real slopes)."""
    size = abs(transform.a)
    if crs is not None and crs.is_geographic:
        # Degrees -> meters approx. (Mars radius by default if the CRS provides it).
        radius = 3_389_500.0
        try:
            ellipsoid = crs.ellipsoid_params if hasattr(crs, "ellipsoid_params") else None
            if ellipsoid and ellipsoid.get("a"):
                radius = float(ellipsoid["a"])
        except Exception:
            pass
        return size * math.radians(1.0) * radius * max(0.05, math.cos(math.radians(ref_lat)))
    return size


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
    pixel_size: float = 1.0,
    progress=None,
    progress_interval: int = 50000,
    height_multipliers: Iterable[float] = HEIGHT_MULTIPLIERS,
) -> dict[float, tuple[list[tuple[int, int]], float]]:
    """A* over an 8-connected grid using NetworkX.

    Cost of each edge (in equivalent meters):

        cost = dist_m * (1 + multiplier * slope^2)

    where ``slope = height_diff / dist_m``. By squaring the slope,
    steep areas are penalized much more than gentle ones, so a
    high multiplier pushes the route toward the plains even if the path is
    longer. Since cost >= dist_m, the Euclidean heuristic (in meters) is
    admissible.
    """
    rows, cols = dem.shape
    sr, sc = start
    er, ec = end

    if not (0 <= sr < rows and 0 <= sc < cols and 0 <= er < rows and 0 <= ec < cols):
        raise ValueError("The start or end points are not valid in the graph.")

    finite = np.isfinite(dem) & (dem > -9000.0)
    if not finite[sr, sc] or not finite[er, ec]:
        raise ValueError("The start or end points are not valid in the graph.")

    step_m = cell_step * pixel_size  # meters between cardinal neighbor nodes
    total_cells = rows * cols
    start_dist = math.hypot(er - sr, ec - sc) * step_m
    _report_progress(
        progress,
        f"[pathfinding] Building NetworkX graph: grid={rows}x{cols} ({total_cells} nodes), "
        f"step={cell_step} cell(s) = {step_m:.1f} m, connectivity=8, "
        f"initial distance={start_dist:.1f} m, max_height_diff={max_height_diff}",
    )

    graph = nx.Graph()
    # "Forward" directions: cover the 8 neighborhoods without duplicating edges.
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

                dist_m = dist_mul * step_m
                slope = height_diff / dist_m
                # We store distance and slope^2 separately to reuse
                # the same graph with different multipliers.
                graph.add_edge(
                    u,
                    (nr, nc),
                    dist_m=dist_m,
                    slope_sq=slope * slope,
                    height_diff=height_diff,
                )

    if start not in graph or end not in graph:
        raise ValueError("The start or end points are not valid in the graph.")

    _report_progress(
        progress,
        f"[pathfinding] Graph ready: nodes={graph.number_of_nodes()}, edges={graph.number_of_edges()}. "
        "Running A* (NetworkX, 8-connected)...",
    )

    def heuristic(u: tuple[int, int], v: tuple[int, int]) -> float:
        return math.hypot(v[0] - u[0], v[1] - u[1]) * step_m

    results: dict[float, tuple[list[tuple[int, int]], float]] = {}
    for multiplier in height_multipliers:
        multiplier = float(multiplier)

        def edge_weight(u, v, data, factor=multiplier):
            return data["dist_m"] * (1.0 + factor * data["slope_sq"])*pixel_size

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
                f"[pathfinding] No route for height_multiplier={multiplier}",
            )
            raise ValueError(
                f"No valid route found for height_multiplier={multiplier}."
            ) from exc

        total_cost = float(sum(
            edge_weight(u, v, graph[u][v])
            for u, v in zip(path, path[1:])
        ))
        results[multiplier] = (list(path), total_cost)
        _report_progress(
            progress,
            f"[pathfinding] Route found: multiplier={multiplier}, "
            f"{len(path)} points, cost={total_cost:.3f}",
        )

    return results


def shortest_path(
    zone: str,
    start: Iterable[float],
    end: Iterable[float],
    max_height_diff: float | None = None,
    progress=None,
    progress_interval: int = 50000,
    sample_points: int | None = 500,
    height_multiplier_1: float = HEIGHT_MULTIPLIERS[0],
    height_multiplier_2: float = HEIGHT_MULTIPLIERS[1],
    height_multiplier_3: float = HEIGHT_MULTIPLIERS[2],
    min_margin: int = 300,
    margin_factor: float = 1.0,
) -> list[dict]:
    """Computes three routes between two geographic coordinates on a DEM.

    Reads a preprocessed binary .npz DEM, crops a search window
    around start and end, downsamples it and runs 8-connected A* with
    a quadratic slope cost (see ``_astar_grid``).

    Args:
        zone: Zone name of the .npz binary inside data/ (with or without extension).
        start: Start coordinate [latitude, longitude] in degrees.
        end: End coordinate [latitude, longitude] in degrees.
        max_height_diff: Maximum height difference allowed per cell of the original
            DEM; with downsampling it is scaled by the step between nodes.
        progress: Callback ``callable(str)`` for progress messages.
        progress_interval: Kept for compatibility.
        sample_points: Approximate points per side of the search grid.
            ``None`` or <=0 uses full resolution.
        height_multiplier_1/2/3: Weights of slope^2. High values avoid
            slopes and favor the plains. Must be distinct and >= 0.
        min_margin: Minimum margin (cells) around the start-end rectangle.
        margin_factor: Margin proportional to the start-end distance (in cells).
            Increasing it lets A* explore more distant plains.

    Returns:
        List of routes, one per multiplier.
    """
    dem_path = resolve_preprocessed_file(zone)

    start_geo = (float(start[0]), float(start[1]))
    end_geo = (float(end[0]), float(end[1]))

    _report_progress(progress, f"[pathfinding] Preprocessed binary: {dem_path.name}")
    _report_progress(progress, f"[pathfinding] Coordinates: start={start_geo}, end={end_geo}")

    dem, transform, crs, nodata, bounds = _load_preprocessed_dem(str(dem_path.resolve()))
    height, width = dem.shape
    geographic_crs = _geographic_crs(crs)

    def to_pixel(lat: float, lon: float) -> tuple[int, int]:
        # The API receives lat/lon in degrees, but projected DEMs use meters.
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
        f"[pathfinding] Pixels: start={start_pt}, end={end_pt}, DEM={height}x{width}",
    )

    for name, (r, c), (lat, lon) in (
        ("start", start_pt, start_geo),
        ("end", end_pt, end_geo),
    ):
        if not (0 <= r < height and 0 <= c < width):
            raise ValueError(
                f"The {name} coordinate ({lat}, {lon}) is outside the DEM area "
                f"(raster extent: {bounds})."
            )

    # Wider search window: without enough margin, A* cannot reach
    # the plains even if the multiplier favors them.
    dist = max(abs(end_pt[0] - start_pt[0]), abs(end_pt[1] - start_pt[1]))
    margin = max(int(min_margin), int(dist * margin_factor))

    r0 = max(0, min(start_pt[0], end_pt[0]) - margin)
    r1 = min(height, max(start_pt[0], end_pt[0]) + margin + 1)
    c0 = max(0, min(start_pt[1], end_pt[1]) - margin)
    c1 = min(width, max(start_pt[1], end_pt[1]) + margin + 1)
    _report_progress(
        progress,
        f"[pathfinding] Search window: rows [{r0}, {r1}), cols [{c0}, {c1}) "
        f"-> {r1 - r0}x{c1 - c0} cells, margin={margin}",
    )

    sub_dem = dem[r0:r1, c0:c1].astype(np.float32, copy=True)
    if sub_dem.size == 0:
        raise ValueError("The resulting search area is empty.")

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
    # Ensure the exact endpoints are represented in the coarse grid.
    grid_dem = grid_dem.copy()
    grid_dem[local_start[0], local_start[1]] = sub_dem[ls_r, ls_c]
    grid_dem[local_end[0], local_end[1]] = sub_dem[le_r, le_c]

    _report_progress(
        progress,
        f"[pathfinding] Downsampling: step={stride} -> grid {grid_h}x{grid_w} "
        f"({grid_h * grid_w} nodes) from window {sub_h}x{sub_w}",
    )

    multipliers = (
        float(height_multiplier_1),
        float(height_multiplier_2),
        float(height_multiplier_3),
    )
    if len(set(multipliers)) != 3:
        raise ValueError("The three height_multipliers must be distinct.")
    if any(value < 0 for value in multipliers):
        raise ValueError("The height_multipliers cannot be negative.")

    pixel_size = _pixel_size_meters(transform, crs, ref_lat=start_geo[0])
    _report_progress(progress, f"[pathfinding] Pixel size: {pixel_size:.3f} m")

    local_results = _astar_grid(
        grid_dem,
        local_start,
        local_end,
        max_height_diff=max_height_diff,
        cell_step=stride,
        pixel_size=pixel_size,
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
            f"[pathfinding] Completed route multiplier={multiplier}: "
            f"{len(path)} points, height variation={total_height_variation:.3f}",
        )

    return routes