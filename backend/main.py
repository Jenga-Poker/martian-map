from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.ai import router as ai_router
from routes.locations import router as locations_router
from routes.path import router as path_router

app = FastAPI(title="NASA Backend", version="0.1.0")

# origins = [
#     "http://localhost:5173",
#     "http://127.0.0.1:5173",
# ]
# 
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=origins,
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

app.include_router(ai_router)
app.include_router(locations_router)
app.include_router(path_router)

@app.get("/")
async def root():
    return {"status": "ok"}
