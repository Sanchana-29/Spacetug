from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router
from services.db import init_db, check_mongo_health

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB collections, seed default target and settings on startup
    init_db()
    yield

app = FastAPI(
    title="Spacecraft Perception and Pose Estimation Backend",
    description="Backend API for spacecraft sensor, YOLOv8 detection, solvePnP pose estimation and MongoDB persistence",
    version="1.0.0",
    lifespan=lifespan
)

# Allow React frontend to communicate with FastAPI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connect API routes
app.include_router(router)

@app.get("/health/db")
def health_db():
    health = check_mongo_health()
    # status: "Connected" if connected, else "Disconnected"
    return {
        "status": "Connected" if health.get("connected") else "Disconnected",
        "database": health.get("database", "spaceDB"),
        "connected": health.get("connected", False),
        "details": health
    }

@app.get("/")
def root():
    db_status = check_mongo_health()
    return {
        "system": "Spacecraft Perception and Pose Estimation",
        "backend": "online",
        "status": "ready",
        "database": db_status.get("status", "unknown")
    }