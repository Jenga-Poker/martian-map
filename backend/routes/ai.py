from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from libs.ai import interpret_instruction

router = APIRouter(tags=["ai"])


class AIRequest(BaseModel):
    instruction: str
    zone: str | None = None


@router.post("/ai")
async def ai_endpoint(request: AIRequest):
    """Receives a user instruction and returns the interpreted action and parameters."""
    if not request.instruction.strip():
        raise HTTPException(status_code=400, detail="Instruction cannot be empty.")

    try:
        zone = request.zone.strip() if isinstance(request.zone, str) else None
        result = await interpret_instruction(request.instruction, zone=zone or None)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Error communicating with the model: {exc}"
        ) from exc
