import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

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
    }
}

LOCATIONS_FILE = Path(__file__).resolve().parents[1] / "data" / "locations.csv"

BACKEND_VEHICLES: list[dict[str, str]] = [
    {
        "id": "sojourner",
        "name": "Sojourner",
        "description": "Mars Pathfinder rover (1997)",
    },
    {
        "id": "spirit",
        "name": "Spirit",
        "description": "MER-A rover (2004)",
    },
    {
        "id": "opportunity",
        "name": "Opportunity",
        "description": "MER-B rover (2004)",
    },
    {
        "id": "curiosity",
        "name": "Curiosity",
        "description": "MSL rover (2012)",
    },
    {
        "id": "perseverance",
        "name": "Perseverance",
        "description": "Mars 2020 rover (2021)",
    },
]
