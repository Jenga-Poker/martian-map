import pathfinding

def test_shortest_path_with_bundled_jezero_dem():
    """Smoke test against data/jezero_dem_1m.tif using real lat/lon degrees."""
    start = (18.47, 77.40)
    end = (18.44, 77.44)  

    result = pathfinding.shortest_path("jezero_dem_1m", start, end, 500.12)

    print(result)


test_shortest_path_with_bundled_jezero_dem()