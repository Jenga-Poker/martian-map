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
        "description": "Calcular la ruta/camino más corto entre dos puntos en una zona (archivo DEM .tif).",
        "params_prompt": (
            "Extrae los parámetros para la acción generate_path.\n"
            "Devuelve SOLO un objeto JSON válido con estas claves:\n"
            '- "zone": nombre de la zona/archivo sin extensión si es posible (string)\n'
            '- "start": {"lat": <número>, "lon": <número>}\n'
            '- "end": {"lat": <número>, "lon": <número>}\n\n'
            "Reglas:\n"
            "- Usa solo la información dada por el usuario.\n"
            "- Las coordenadas son geográficas en grados (lat/lon).\n"
            "- Si falta un dato, usa null para ese valor.\n"
            "- No añadas texto fuera del JSON.\n\n"
            "Ejemplo de salida:\n"
            '{"zone":"jezero_dem_1m","start":{"lat":18.427,"lon":77.5},"end":{"lat":18.526,"lon":77.332}}'
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
        "Eres un clasificador de acciones. "
        "Elige la acción que mejor coincide con la instrucción del usuario.\n\n"
        "Acciones disponibles:\n"
        f"{actions_list}\n\n"
        f'Instrucción del usuario: "{instruction}"\n\n'
        "Responde SOLO con el nombre exacto de la acción. "
        "No escribas explicaciones ni puntuación adicional."
    )
    raw = await generate(prompt, as_json=False)
    return _normalize_action(str(raw))


async def _extract_options(action: str, instruction: str) -> dict[str, Any]:
    action_info = ACTIONS.get(action)
    if not action_info:
        return {}

    prompt = (
        f"{action_info['params_prompt']}\n\n"
        f'Instrucción del usuario: "{instruction}"\n\n'
        "Salida JSON:"
    )
    options = await generate(prompt, as_json=True)
    if not isinstance(options, dict):
        raise ValueError("Los parámetros extraídos deben ser un objeto JSON.")
    return options


async def interpret_instruction(instruction: str) -> dict[str, Any]:
    """Interpreta una instrucción en dos pasos: seleccionar acción y extraer parámetros."""
    action = await _select_action(instruction)
    print(action)
    options = await _extract_options(action, instruction)
    print(options)
    return {"action": action, "options": options}

