import json
import os
import re
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
    "generate_path": {
        "description": "Calculate the shortest route/path between two points in an area (DEM .tif file).",
        "params_prompt": (
            "Extract the parameters for the generate_path action.\n"
            "Return ONLY a valid JSON object with these keys:\n"
            '- "zone": name of the zone/file without extension if possible (string)\n'
            '- "start": {"row": <integer>, "col": <integer>}\n'
            '- "end": {"row": <integer>, "col": <integer>}\n'
            '- "margin": integer (optional, default 50)\n\n'
            "Rules:\n"
            "- Use only the information provided by the user.\n"
            "- If a parameter is missing, use null for that value (or 50 for margin).\n"
            "- Do not add any text outside the JSON.\n\n"
            "Example output:\n"
            '{"zone":"jezero_dem_1m","start":{"row":100,"col":150},"end":{"row":800,"col":950},"margin":50}'
        ),
    }
}


async def generate(instructions: str, as_json: bool = False) -> Any:
    """Envía instrucciones al servidor de Ollama y devuelve el resultado.

    Args:
        instructions: Texto con las instrucciones o prompt del usuario.
        as_json: Si es True, solicita y parsea la respuesta como JSON.

    Returns:
        str cuando as_json es False, o un objeto (dict/list) cuando es True.

    Raises:
        httpx.HTTPStatusError: Si Ollama responde con un error HTTP.
        ValueError: Si se solicita JSON pero la respuesta no es JSON válido.
    """
    url = f"{OLLAMA_URL}/api/generate"
    payload: dict[str, Any] = {
        "model": MODEL,
        "prompt": instructions,
        "stream": False,
        "think": False
    }
    
    print(url, payload)

    if as_json:
        payload["format"] = "json"

    headers = {}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    result_text = (data.get("response") or "").strip()

    if as_json:
        try:
            return json.loads(result_text)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"La respuesta del modelo no es un JSON válido: {result_text}"
            ) from exc

    return result_text


def _normalize_action(raw: str) -> str:
    text = (raw or "").strip().strip("\"'`")
    if text in ACTIONS:
        return text
    # Intentar extraer una acción conocida si el modelo añade texto extra
    lowered = text.lower()
    for action in ACTIONS:
        if re.search(rf"\b{re.escape(action)}\b", lowered):
            return action
    # Fallback: primera palabra/identificador
    match = re.search(r"[a-zA-Z_][a-zA-Z0-9_]*", text)
    return match.group(0) if match else text


async def _select_action(instruction: str) -> str:
    actions_list = "\n".join(
        f"- {name}: {info['description']}" for name, info in ACTIONS.items()
    )
    prompt = (
        "You are an action classifier. "
        "Choose the action that best matches the user's instruction.\n\n"
        "Available actions:\n"
        f"{actions_list}\n\n"
        f'User instruction: "{instruction}"\n\n'
        "Respond ONLY with the exact action name. "
        "Do not write explanations or additional punctuation."
    )
    raw = await generate(prompt, as_json=False)
    return _normalize_action(str(raw))


async def _extract_options(action: str, instruction: str) -> dict[str, Any]:
    action_info = ACTIONS.get(action)
    if not action_info:
        return {}

    prompt = (
        f"{action_info['params_prompt']}\n\n"
        f'User instruction: "{instruction}"\n\n'
        "JSON output:"
    )
    options = await generate(prompt, as_json=True)
    if not isinstance(options, dict):
        raise ValueError("Extracted parameters must be a JSON object.")
    return options


async def interpret_instruction(instruction: str) -> dict[str, Any]:
    """Interpreta una instrucción en dos pasos: seleccionar acción y extraer parámetros."""
    action = await _select_action(instruction)
    print(action)
    options = await _extract_options(action, instruction)
    print(options)
    return {"action": action, "options": options}

