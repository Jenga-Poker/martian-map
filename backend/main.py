from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pathlib import Path

from routes.ai import router as ai_router
from routes.distance_lantejuela import router as distance_lantejuela_router
from routes.locations import router as locations_router
from routes.path import router as path_router

app = FastAPI(title="NASA Backend", version="0.1.0")

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai_router)
app.include_router(distance_lantejuela_router)
app.include_router(locations_router)
app.include_router(path_router)

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

try:
    with open(DATA_DIR /"locations.csv", "x") as file:
        file.write("NAME;LAT;LON;HEIGHT;ZONE\n\"Curiosity Rover\";4.79;137.39;0;\"gale\"\n\"Perseverance Rover\";18.447;77.402;0;\"jezero\"")
except FileExistsError:
    print("File already exists. Skipping creation.")

@app.get("/")
async def root():
    return {"status": "ok"}
