import json
from typing import Any

import httpx

from config import (
    ACTIONS,
    BACKEND_VEHICLES,
    OLLAMA_API_KEY,
    OLLAMA_MODEL,
    OLLAMA_URL,
)
from utils import _load_zone_locations

async def systemone(state: Any, questions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Sends a request to the /v1/systemone endpoint of a decision model."""
    url = f"{OLLAMA_URL}/v1/systemone"
    payload: dict[str, Any] = {
        "model": OLLAMA_MODEL,
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
                f"Error {response.status_code} in /v1/systemone: {detail}"
            )
        data = response.json()

    if not isinstance(data, dict):
        raise ValueError("The /v1/systemone response is not a valid JSON object.")

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

async def _extract_options(
    action: str,
    instruction: str,
    zone: str | None = None,
) -> dict[str, Any]:
    if action != "navigate_to":
        return {}

    location_names = _load_zone_locations(zone)
    end_options = location_names + ["not_specified"]

    print(location_names)

    rover_list = BACKEND_VEHICLES
    rover_ids = [rover["id"] for rover in rover_list]
    rover_options = rover_ids + ["not_specified"]
    rover_criteria = {
        rover["id"]: (
            f"The user wants to travel using {rover['name']}."
            + (f" {rover['description']}" if rover["description"] else "")
        )
        for rover in rover_list
    }
    rover_criteria["not_specified"] = (
        "The vehicle is not mentioned or unclear."
    )

    end_criteria = {
        name: f"Destination is the location named '{name}'."
        for name in location_names
    }
    end_criteria["not_specified"] = (
        "No valid destination location is mentioned."
    )

    questions = {
        "vehicle": {
            "type": "choice",
            "instructions": (
                "Which vehicle should perform the task? "
                "Choose not_specified if not mentioned or unclear."
            ),
            "options": rover_options,
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
    }

    result = await systemone(state, questions)

    rover_choice = _pick_choice(result, "vehicle")
    rover_by_name = {
        rover["name"].lower(): rover["id"] for rover in rover_list
    }
    if rover_choice not in rover_ids:
        rover_choice = rover_by_name.get((rover_choice or "").lower())
    rover = rover_choice if rover_choice in rover_ids else None

    end = _pick_choice(result, "end")

    return {
        "vehicle": rover,
        "end": end if end != "not_specified" else None,
    }

async def interpret_instruction(
    instruction: str,
    zone: str | None = None,
) -> dict[str, Any]:
    """Interprets an instruction in two steps: identify the action and extract parameters."""
    action = await _select_action(instruction)
    options = await _extract_options(action, instruction, zone=zone)
    return {"action": action, "options": options}
