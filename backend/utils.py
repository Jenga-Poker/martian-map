import csv

from config import LOCATIONS_FILE


def _clean(value: str) -> str:
    return (value or "").strip().strip('"')


def _load_zone_locations(zone: str | None) -> list[str]:
    if not zone:
        return []
    if not LOCATIONS_FILE.exists():
        print(f"[utils] Locations file does not exist: {LOCATIONS_FILE}")
        return []
    zone_name = zone.strip()
    names: list[str] = []
    try:
        with LOCATIONS_FILE.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter=";", skipinitialspace=True)
            for row in reader:
                if not row:
                    continue
                row_zone = _clean(row.get("ZONE", ""))
                if row_zone != zone_name:
                    continue
                name = _clean(row.get("NAME", ""))
                if name and name not in names:
                    names.append(name)
    except Exception:
        return []
    return names
