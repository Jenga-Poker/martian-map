import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

_BACKEND_DIR = Path(__file__).resolve().parent


def _resolve_data_dir() -> Path:
    """Localiza el directorio data/ en local y dentro del contenedor.

    - Local: el backend vive en <repo>/backend y los datos en <repo>/data.
    - Docker: el backend vive en /app y los datos se montan en /app/data.
    La variable de entorno DATA_DIR tiene prioridad si existe.
    """
    candidates: list[Path] = []
    env_dir = os.getenv("DATA_DIR")
    if env_dir:
        candidates.append(Path(env_dir))
    candidates.append(_BACKEND_DIR.parent / "data")  # local: <repo>/data
    candidates.append(_BACKEND_DIR / "data")  # docker: /app/data

    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return candidates[0]


DATA_DIR = _resolve_data_dir()

# Compatibilidad: aceptar OLLAMA_URL o OLLAMA_HOST
OLLAMA_MODEL = os.getenv("MODEL_OLLAMA") or "LUIS BERNAL"

OLLAMA_URL = (
    os.getenv("OLLAMA_URL")
    or os.getenv("OLLAMA_HOST")
    or "http://localhost:11434"
).rstrip("/")

OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY")

ACTIONS = {
    "navigate_to": {
        "description": "Calculates the shortest path from the user's location to another point.",
    },
    "add_location": {
        "description": "Adds, creates, marks or saves a new location.",
    },
    "distance_to_earth": {
        "description": "Returns the distance from a point on Mars to Earth (Lantejuela, Spain) when the user asks for the distance to Earth.",
    },
}

LOCATIONS_FILE = DATA_DIR / "locations.csv"

BACKEND_VEHICLES: list[dict[str, str]] = [
    {
        "id": "vehicle-1",
        "name": "Vehicle 1",
        "description": "",
    },
    {
        "id": "vehicle-2",
        "name": "Vehicle 2",
        "description": "",
    },
]