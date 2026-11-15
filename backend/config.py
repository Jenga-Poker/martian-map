import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

_BACKEND_DIR = Path(__file__).resolve().parent


def _resolve_data_dir() -> Path:
    """Locates the data/ directory locally and inside the container.

    - Local: the backend lives in <repo>/backend and the data in <repo>/data.
    - Docker: the backend lives in /app and the data is mounted at /app/data.
    The DATA_DIR environment variable takes priority if it exists.
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

# Compatibility: accept OLLAMA_URL or OLLAMA_HOST
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