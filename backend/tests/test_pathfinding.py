import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from libs import pathfinding


def test_shortest_path_with_bundled_jezero_dem():
    """Smoke test against data/jezero_dem_1m.npz using real lat/lon degrees."""
    start = (18.42, 77.45)
    end = (18.56, 77.31)

    result = pathfinding.shortest_path(
        "jezero_dem_1m",
        start,
        end,
        max_height_diff=0.4,
        height_multiplier_1=1.0,
        height_multiplier_2=5.0,
        height_multiplier_3=50.0,
    )

    print(result)


def test_shortest_path_with_bundled_valles_dem():
    """Smoke test against data/valles_marineris_dem_200m.npz using real lat/lon degrees."""
    start = (-6.44, -117.2)
    end = (-10.0, -112.0)
    
    result = pathfinding.shortest_path(
        "valles_marineris_dem_200m",
        start,
        end,
        max_height_diff=0.4,
        height_multiplier_1=1.0,
        height_multiplier_2=5.0,
        height_multiplier_3=50.0,
    )

    print(result)


if __name__ == "__main__":
    test_shortest_path_with_bundled_jezero_dem()
    #test_shortest_path_with_bundled_valles_dem()
