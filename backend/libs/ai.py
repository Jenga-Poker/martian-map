import csv
import json
import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from config import MODEL

load_dotenv()

# Compatibilidad: aceptar OLLAMA_URL o OLLAMA_HOST
OLLAMA_URL = (
    os.getenv("OLLAMA_URL")
    or os.getenv("OLLAMA_HOST")
    or "http://localhost:11434"
).rstrip("/")
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "")

ACTIONS = {
    "navigate_to": {
        "description": "Calculates the shortest path from the user's location to another point.",
    }
}

ROVER_OPTIONS = ["rover 1", "rover 2", "not_specified"]
LOCATIONS_FILE = Path(__file__).resolve().parents[2] / "data" / "locations.csv"


def _clean(value: str) -> str:
    return (value or "").strip().strip('"')


def _load_zone_locations(zone: str | None) -> list[str]:
    if not zone or not LOCATIONS_FILE.exists():
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


async def systemone(state: Any, questions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Envía una petición al endpoint /v1/systemone de un modelo de decisión."""
    url = f"{OLLAMA_URL}/v1/systemone"
    payload: dict[str, Any] = {
        "model": MODEL,
        "state": state,
        "questions": questions,
    }

    print(json.dumps(payload, indent=4))

    headers = {}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        if response.is_error:
            detail = response.text
            raise ValueError(
                f"Error {response.status_code} en /v1/systemone: {detail}"
            )
        data = response.json()

    if not isinstance(data, dict):
        raise ValueError("La respuesta de /v1/systemone no es un objeto JSON válido.")

    print(json.dumps(data, indent=4))
    return data


def _pick_choice(result: dict[str, Any], key: str) -> str:
    answers = result.get("answers", {}) if isinstance(result, dict) else {}
    answer = answers.get(key) if isinstance(answers, dict) else None
    choice = answer.get("choice") if isinstance(answer, dict) else None
    return choice

async def _select_action(instruction: str) -> str:
    action_options = list(ACTIONS.keys()) + ["not_specified"]
    criteria = {name: info["description"] for name, info in ACTIONS.items()}
    criteria["not_specified"] = "None of the available actions match the user request."
    questions = {
        "action": {
            "type": "choice",
            "instructions": (
                "Choose the action that best matches the user's request. "
                "Choose not_specified if no action matches."
            ),
            "options": action_options,
            "criteria": criteria,
        }
    }
    state = instruction
    result = await systemone(state, questions)
    return _pick_choice(result, "action")


async def _extract_options(action: str, instruction: str, zone: str | None = None) -> dict[str, Any]:
    if action != "navigate_to":
        return {}

    location_names = _load_zone_locations(zone)
    end_options = location_names + ["not_specified"]

    rover_criteria = {
        "rover 1": "The user wants to travel using rover 1.",
        "rover 2": "The user wants to travel using rover 2.",
        "not_specified": "The rover is not mentioned or unclear.",
    }
    end_criteria = {
        name: f"Destination is the location named '{name}'."
        for name in location_names
    }
    end_criteria["not_specified"] = (
        "No valid destination location is mentioned."
    )

    questions = {
        "rover": {
            "type": "choice",
            "instructions": (
                "Which rover should perform the task? "
                "Choose not_specified if not mentioned or unclear."
            ),
            "options": ROVER_OPTIONS,
            "criteria": rover_criteria,
        },
        "end": {
            "type": "choice",
            "instructions": (
                "Which location is the route destination? "
                "Choose only from the given locations, or not_specified if none match."
            ),
            "options": end_options,
            "criteria": end_criteria,
        },
    }

    state = {
        "instruction": instruction,
        "action": action,
        "available_rovers": ["rover 1", "rover 2"],
        "available_locations": location_names,
    }

    result = await systemone(state, questions)

    rover = _pick_choice(result, "rover")
    end = _pick_choice(result, "end")

    return {
        "rover": rover if rover != "not_specified" else None,
        "end": end if end != "not_specified" else None,
    }


async def interpret_instruction(instruction: str, zone: str | None = None) -> dict[str, Any]:
    """Interpreta una instrucción en dos pasos: identificar acción y extraer parámetros."""
    action = await _select_action(instruction)
    options = await _extract_options(action, instruction, zone=zone)
    print("RESULT", action, options)
    return {"action": action, "options": options}

