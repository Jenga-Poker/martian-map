from fastapi import FastAPI

from routes.ai import router as ai_router
from routes.path import router as path_router

app = FastAPI(title="NASA Backend", version="0.1.0")

app.include_router(ai_router)
app.include_router(path_router)


@app.get("/")
async def root():
    return {"status": "ok"}
