import os
import time
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("spacecraft.database")

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "spaceDB")

_client: Optional[MongoClient] = None
_db = None
# After a failed connection, wait before trying again, so an offline MongoDB does not
# add a 2.5 s timeout to every request (e.g. each live perception step).
_RETRY_AFTER_S = 15.0
_last_failure = 0.0

def get_database():
    """Returns MongoDB database instance if connected, otherwise None."""
    global _client, _db, _last_failure
    if _db is not None:
        return _db
    if time.monotonic() - _last_failure < _RETRY_AFTER_S:
        return None

    try:
        _client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=2500)
        # Test connection
        _client.admin.command("ping")
        _db = _client[MONGODB_DB_NAME]
        logger.info(f"Connected successfully to MongoDB database: {MONGODB_DB_NAME}")
        return _db
    except (ConnectionFailure, ServerSelectionTimeoutError) as exc:
        logger.warning(f"Could not connect to MongoDB at {MONGODB_URI}: {exc}")
        _last_failure = time.monotonic()
        _client = None
        _db = None
        return None

def check_mongo_health() -> Dict[str, Any]:
    """Inspects MongoDB status."""
    try:
        db = get_database()
        if db is not None:
            _client.admin.command("ping")
            server_info = _client.server_info()
            return {
                "connected": True,
                "status": "healthy",
                "database": MONGODB_DB_NAME,
                "uri": MONGODB_URI.split("@")[-1] if "@" in MONGODB_URI else MONGODB_URI,
                "version": server_info.get("version", "unknown"),
                "collections": db.list_collection_names()
            }
    except Exception as exc:
        return {
            "connected": False,
            "status": "unavailable",
            "database": MONGODB_DB_NAME,
            "error": str(exc)
        }
    return {
        "connected": False,
        "status": "disconnected",
        "database": MONGODB_DB_NAME,
        "error": "Database not reachable at configured URI"
    }

def init_db():
    """Initializes spaceDB collections, creates indexes, and inserts default target & mission."""
    db = get_database()
    if db is None:
        logger.warning("Skipping DB initialization: MongoDB offline.")
        return False

    try:
        # Create indexes across all operational collections
        db.missions.create_index([("mission_id", ASCENDING)], unique=True)
        db.missions.create_index([("created_at", DESCENDING)])
        db.targets.create_index([("target_id", ASCENDING)], unique=True)
        db.space_objects.create_index([("object_id", ASCENDING)], unique=True)
        db.detection_results.create_index([("timestamp", DESCENDING)])
        db.detection_results.create_index([("mission_id", ASCENDING)])
        db.pose_estimates.create_index([("timestamp", DESCENDING)])
        db.pose_estimates.create_index([("mission_id", ASCENDING)])
        db.motion_estimates.create_index([("timestamp", DESCENDING)])
        db.telemetry.create_index([("timestamp", DESCENDING)])
        db.telemetry.create_index([("mission_id", ASCENDING)])
        db.mission_logs.create_index([("timestamp", DESCENDING)])
        db.simulation_sessions.create_index([("session_id", ASCENDING)], unique=True)
        db.activity_logs.create_index([("timestamp", DESCENDING)])
        db.user_settings.create_index([("id", ASCENDING)], unique=True)

        # Seed default target if not present
        if db.targets.count_documents({}) == 0:
            default_target = {
                "target_id": "SAT-001",
                "name": "Standard Communications Satellite",
                "type": "Target Spacecraft",
                "status": "ACTIVE",
                "mass_kg": 1500.0,
                "dimensions": {"width_m": 2.2, "height_m": 1.8, "depth_m": 3.4},
                "orbit": {"altitude_km": 550, "inclination_deg": 53.0},
                "mesh_model": "/models/satellite.glb",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "notes": "Primary operational target for relative pose navigation and proximity operations."
            }
            db.targets.insert_one(default_target)
            logger.info("Default target spacecraft SAT-001 initialized in spaceDB.")

        # Seed default mission if not present
        if db.missions.count_documents({}) == 0:
            default_mission = {
                "mission_id": "MSN-DEFAULT-01",
                "name": "Orbital Rendezvous & Pose Estimation",
                "status": "RUNNING",
                "target_id": "SAT-001",
                "sensor_selected": "RGB-D Camera",
                "start_time": datetime.now(timezone.utc).isoformat(),
                "end_time": None,
                "elapsed_seconds": 0.0,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "notes": "Initial autonomous proximity and relative pose estimation operational mission."
            }
            db.missions.insert_one(default_mission)
            logger.info("Default mission MSN-DEFAULT-01 initialized in spaceDB.")

        # Seed default settings if not present
        if db.user_settings.count_documents({"id": "global_settings"}) == 0:
            default_settings = {
                "id": "global_settings",
                "theme": "dark",
                "accent_color": "#3b82f6",
                "confidence_threshold": 0.25,
                "default_speed": 1.0,
                "show_bounding_boxes": True,
                "show_object_labels": True,
                "show_coordinate_axes": True,
                "show_camera_frustum": True,
                "show_trajectory": True,
                "active_target_id": "SAT-001",
                "preferred_sensor": "RGB-D Camera",
                "active_mission_id": "MSN-DEFAULT-01",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            db.user_settings.insert_one(default_settings)
            logger.info("Default user settings initialized in spaceDB.")

        # Log system start activity in activity_logs and mission_logs
        now_iso = datetime.now(timezone.utc).isoformat()
        db.activity_logs.insert_one({
            "action": "SYSTEM_START",
            "details": "Spacecraft Perception backend service initialized with spaceDB",
            "timestamp": now_iso
        })
        db.mission_logs.insert_one({
            "mission_id": "MSN-DEFAULT-01",
            "level": "INFO",
            "event": "SYSTEM_INIT",
            "message": "spaceDB initialized and connected successfully.",
            "timestamp": now_iso
        })

        return True
    except Exception as exc:
        logger.error(f"Error during spaceDB initialization: {exc}")
        return False
