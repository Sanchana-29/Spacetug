import os
import io
import csv
import json
import base64
from typing import Optional, List, Dict, Any, Union
from datetime import datetime, timezone
from pathlib import Path

from fastapi import (
    APIRouter,
    UploadFile,
    File,
    Form,
    Query,
    HTTPException,
    Response
)
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel, Field
import cv2
import numpy as np

from sensors.simulator import get_sensor_status
from cv.detection import get_detection_status, detect_target
from cv.pose_estimation import get_pose_status, estimate_pose
from cv.image_processing import process_image_pipeline
from services.db import get_database, check_mongo_health

router = APIRouter(prefix="/api")

# Directory for storing processed inference and pipeline images
STORAGE_DIR = Path(__file__).resolve().parents[1] / "data" / "captures"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# Helper to serialize MongoDB docs
def serialize_doc(doc: dict) -> dict:
    if not doc:
        return doc
    clean = dict(doc)
    if "_id" in clean:
        clean["id"] = str(clean.pop("_id"))
    return clean

# --------------------------------------------------
# REQUEST / RESPONSE MODELS
# --------------------------------------------------

class MissionCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    target_id: Optional[str] = "SAT-001"
    sensor_selected: Optional[str] = "RGB-D Camera"
    notes: Optional[str] = None
    chaser_model: Optional[str] = None
    target_model: Optional[str] = None
    orbit_regime: Optional[str] = None
    separation_distance: Optional[float] = None

class MissionUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None  # CREATED, RUNNING, PAUSED, COMPLETED, STOPPED
    sensor_selected: Optional[str] = None
    target_id: Optional[str] = None
    elapsed_seconds: Optional[float] = None
    notes: Optional[str] = None
    chaser_model: Optional[str] = None
    target_model: Optional[str] = None
    orbit_regime: Optional[str] = None
    separation_distance: Optional[float] = None

class PoseRequest(BaseModel):
    bbox: Optional[dict] = None
    image_points: Optional[Union[Dict[str, List[float]], List[List[float]]]] = None
    image_size: Optional[List[int]] = None
    fov_degrees: float = 60.0
    fov_mode: Optional[str] = "vertical"
    camera_matrix: Optional[List[List[float]]] = None
    distortion_coeffs: Optional[List[float]] = None
    method: Optional[str] = "ITERATIVE"
    use_ransac: Optional[bool] = False
    ground_truth: Optional[dict] = None
    noise_sigma_px: Optional[float] = 0.0
    keypoint_source: Optional[str] = "LANDMARKS"
    sensor_name: Optional[str] = None
    target_id: Optional[str] = "SAT-001"
    frame_id: Optional[str] = None
    mission_id: Optional[str] = None

class TargetUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    mass_kg: Optional[float] = None
    orbit: Optional[Dict[str, Any]] = None
    dimensions: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None

class MissionEventModel(BaseModel):
    mission_id: Optional[str] = "MSN-DEFAULT-01"
    event_type: str = "INFO"  # INFO, SUCCESS, WARNING, ERROR
    message: str
    target_id: Optional[str] = "SAT-001"
    sensor_id: Optional[str] = None
    time_s: Optional[float] = 0.0

class UserSettingsModel(BaseModel):
    theme: Optional[str] = "dark"
    accent_color: Optional[str] = "#3b82f6"
    confidence_threshold: Optional[float] = Field(default=0.25, ge=0.01, le=1.0)
    default_speed: Optional[float] = Field(default=1.0, ge=0.1, le=10.0)
    show_bounding_boxes: Optional[bool] = True
    show_object_labels: Optional[bool] = True
    show_coordinate_axes: Optional[bool] = True
    show_camera_frustum: Optional[bool] = True
    show_trajectory: Optional[bool] = True
    active_target_id: Optional[str] = "SAT-001"
    preferred_sensor: Optional[str] = "RGB-D Camera"
    active_mission_id: Optional[str] = None
    earth_rotation: Optional[bool] = True
    animation_quality: Optional[str] = "high"
    display_units: Optional[str] = "metric"
    sensor_resolution: Optional[str] = "1920x1080"
    sensor_fps: Optional[int] = 60
    sensor_noise: Optional[float] = 0.0
    # Settings used by the live perception loop and ORB/SIFT identification
    live_rate_fps: Optional[float] = Field(default=2.0, ge=0.5, le=5.0)
    live_noise_px: Optional[float] = Field(default=1.0, ge=0.0, le=5.0)
    safety_radius_m: Optional[float] = Field(default=1.0, gt=0.0, le=50.0)
    collision_horizon_s: Optional[float] = Field(default=60.0, gt=0.0, le=3600.0)
    feature_min_inliers: Optional[int] = Field(default=15, ge=6, le=500)
    feature_min_inlier_ratio: Optional[float] = Field(default=0.40, ge=0.0, le=1.0)
    settings_version: Optional[int] = 2


class SimulationSessionModel(BaseModel):
    session_id: Optional[str] = None
    duration_s: float
    target_id: str = "SAT-001"
    mission_id: Optional[str] = None
    sensor_used: str = "RGB-D Camera"
    tracking_enabled: bool = False
    average_fps: Optional[float] = 60.0
    notes: Optional[str] = None

# --------------------------------------------------
# SYSTEM HEALTH & STATUS
# --------------------------------------------------

@router.get("/health")
def health():
    db_health = check_mongo_health()
    return {
        "status": "healthy" if db_health["connected"] else "degraded",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": db_health,
        "detector": get_detection_status(),
        "pose_estimation": get_pose_status()
    }

@router.get("/status")
def system_status():
    db_health = check_mongo_health()
    return {
        "backend": "online",
        "cv_pipeline": "ready",
        "database": db_health,
        "sensors": get_sensor_status(),
        "detection": get_detection_status(),
        "pose_estimation": get_pose_status(),
    }

# --------------------------------------------------
# MISSION MANAGEMENT (spaceDB.missions)
# --------------------------------------------------

@router.get("/missions")
def get_missions(limit: int = Query(20, ge=1, le=100)):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    docs = [serialize_doc(m) for m in db.missions.find().sort("created_at", -1).limit(limit)]
    return docs

@router.post("/missions")
def create_mission(mission_data: MissionCreate):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")

    now_iso = datetime.now(timezone.utc).isoformat()
    mission_id = f"MSN-{int(datetime.now(timezone.utc).timestamp())}"

    new_mission = {
        "mission_id": mission_id,
        "name": mission_data.name,
        "status": "RUNNING",
        "target_id": mission_data.target_id or "SAT-001",
        "sensor_selected": mission_data.sensor_selected or "RGB-D Camera",
        "chaser_model": mission_data.chaser_model or "SpaceTug Inspector (Tri-Thruster Autonomous)",
        "target_model": mission_data.target_model or "Soyuz-T Satellite (Cylindrical Core + Dual Arrays)",
        "orbit_regime": mission_data.orbit_regime or "LEO 450 km (ISS Co-Orbital Inclination 51.6°)",
        "separation_distance": float(mission_data.separation_distance) if mission_data.separation_distance is not None else 15.0,
        "start_time": now_iso,
        "end_time": None,
        "elapsed_seconds": 0.0,
        "created_at": now_iso,
        "notes": mission_data.notes or "User initiated mission workflow"
    }

    db.missions.insert_one(new_mission)

    # Log in mission_logs and activity_logs
    db.mission_logs.insert_one({
        "mission_id": mission_id,
        "level": "INFO",
        "event": "MISSION_CREATED",
        "message": f"Mission '{mission_data.name}' ({mission_id}) initiated.",
        "timestamp": now_iso
    })
    db.activity_logs.insert_one({
        "action": "MISSION_CREATED",
        "details": f"Created mission: {mission_data.name} ({mission_id})",
        "timestamp": now_iso
    })

    # Update active mission in settings
    db.user_settings.update_one(
        {"id": "global_settings"},
        {"$set": {"active_mission_id": mission_id, "updated_at": now_iso}},
        upsert=True
    )

    return serialize_doc(new_mission)

@router.get("/missions/{mission_id}")
def get_mission(mission_id: str):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    doc = db.missions.find_one({"mission_id": mission_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Mission not found")
    return serialize_doc(doc)

@router.put("/missions/{mission_id}")
def update_mission(mission_id: str, update: MissionUpdate):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")

    update_dict = {k: v for k, v in update.model_dump().items() if v is not None}
    if not update_dict:
        return {"status": "no change"}

    now_iso = datetime.now(timezone.utc).isoformat()
    update_dict["updated_at"] = now_iso
    if update_dict.get("status") in ["COMPLETED", "STOPPED"]:
        update_dict["end_time"] = now_iso

    res = db.missions.update_one({"mission_id": mission_id}, {"$set": update_dict})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mission not found")

    db.mission_logs.insert_one({
        "mission_id": mission_id,
        "level": "INFO",
        "event": "MISSION_STATE_UPDATE",
        "message": f"Mission updated: {update_dict.get('status') or 'properties updated'}",
        "timestamp": now_iso
    })

    updated_mission = db.missions.find_one({"mission_id": mission_id})
    return serialize_doc(updated_mission)

# --------------------------------------------------
# SENSOR STATUS
# --------------------------------------------------

@router.get("/sensors")
def sensors():
    return get_sensor_status()

# --------------------------------------------------
# TARGET SPACECRAFT ENDPOINTS
# --------------------------------------------------

@router.get("/targets")
def get_targets():
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    targets = [serialize_doc(doc) for doc in db.targets.find()]
    return targets

@router.get("/targets/{target_id}")
def get_target(target_id: str):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    target = db.targets.find_one({"target_id": target_id})
    if not target:
        raise HTTPException(status_code=404, detail=f"Target {target_id} not found")
    return serialize_doc(target)

@router.put("/targets/{target_id}")
def update_target(target_id: str, update: TargetUpdate):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = db.targets.update_one({"target_id": target_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=f"Target {target_id} not found")

    db.activity_logs.insert_one({
        "action": "TARGET_UPDATED",
        "details": f"Updated target specifications for {target_id}",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })

    updated_target = db.targets.find_one({"target_id": target_id})
    return serialize_doc(updated_target)

# --------------------------------------------------
# DETECTION & COMPUTER VISION PIPELINE
# --------------------------------------------------

@router.get("/detection")
def detection_status():
    return get_detection_status()

@router.get("/detections")
def get_detections(mission_id: Optional[str] = None, limit: int = Query(20, ge=1, le=100)):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    query = {"mission_id": mission_id} if mission_id else {}
    docs = [serialize_doc(doc) for doc in db.detection_results.find(query).sort("timestamp", -1).limit(limit)]
    return docs

@router.get("/detections/{detection_id}")
def get_detection_by_id(detection_id: str):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    from bson import ObjectId
    try:
        doc = db.detection_results.find_one({"_id": ObjectId(detection_id)})
    except Exception:
        doc = db.detection_results.find_one({"frame_id": detection_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Detection record not found")
    return serialize_doc(doc)

@router.post("/detection/run")
async def run_detection(
    file: UploadFile = File(...),
    conf: Optional[float] = Form(None),
    confidence: Optional[float] = Query(None),
    sensor_name: Optional[str] = Form(None),
    frame_id: Optional[str] = Form(None),
    mission_id: Optional[str] = Form(None)
):
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Empty file payload")

        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise HTTPException(status_code=400, detail="Could not decode image")

        chosen_conf = conf if conf is not None else confidence
        if chosen_conf is None:
            chosen_conf = 0.25

        if not 0.0 <= chosen_conf <= 1.0:
            raise HTTPException(status_code=400, detail="Confidence must be between 0 and 1")

        result = detect_target(image, conf=chosen_conf)

        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        filename = f"capture_{timestamp_str}.png"
        filepath = STORAGE_DIR / filename
        with open(filepath, "wb") as f:
            f.write(contents)

        # Draw verified bounding boxes with Track ID labels
        annotated_image = image.copy()
        detections = result.get("detections", [])
        if result.get("detected") and detections:
            for idx, det in enumerate(detections):
                bb = det["bounding_box"]
                x, y, w, h = bb["x"], bb["y"], bb["width"], bb["height"]
                # Single-frame detection has no temporal association, so no track ID.
                # Persistent track IDs come from /api/perception/step (SORT tracker).
                det["track_id"] = None
                cv2.rectangle(annotated_image, (x, y), (x + w, y + h), (0, 255, 0), 2)
                label = f"{det['class_name']} {int(det['confidence']*100)}%"
                cv2.putText(annotated_image, label, (x, max(20, y - 10)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

        annotated_filename = f"annotated_{timestamp_str}.png"
        annotated_filepath = STORAGE_DIR / annotated_filename
        cv2.imwrite(str(annotated_filepath), annotated_image)

        # Persist in spaceDB
        db = get_database()
        record_id = None
        now_iso = datetime.now(timezone.utc).isoformat()
        if db is not None:
            doc = {
                "timestamp": now_iso,
                "mission_id": mission_id,
                "frame_id": frame_id or f"CAP-{timestamp_str}",
                "sensor_name": sensor_name or "RGB-D Camera",
                "detected": result.get("detected", False),
                "detections": detections,
                "detection_count": len(detections),
                "image_width": result.get("image_width"),
                "image_height": result.get("image_height"),
                "confidence_threshold": chosen_conf,
                "image_path": str(filepath.relative_to(STORAGE_DIR.parent.parent)),
                "annotated_image_path": str(annotated_filepath.relative_to(STORAGE_DIR.parent.parent)),
                "raw_image_filename": filename,
                "annotated_image_filename": annotated_filename,
            }
            res = db.detection_results.insert_one(doc)
            record_id = str(res.inserted_id)

            db.activity_logs.insert_one({
                "action": "DETECTION_EXECUTED",
                "details": f"Detection executed for {mission_id or 'default'}: {len(detections)} target(s) detected",
                "timestamp": now_iso
            })
            if mission_id:
                db.mission_logs.insert_one({
                    "mission_id": mission_id,
                    "level": "INFO",
                    "event": "DETECTION_FRAME_PROCESSED",
                    "message": f"Processed frame: {len(detections)} satellite(s) located. Conf: {chosen_conf:.2f}",
                    "timestamp": now_iso
                })

        result["record_id"] = record_id
        result["timestamp"] = now_iso
        result["image_filename"] = annotated_filename
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection error: {str(e)}")

# --------------------------------------------------
# IMAGE PROCESSING PIPELINE (Interactive OpenCV)
# --------------------------------------------------

@router.post("/pipeline/process")
async def run_image_processing_pipeline(
    file: UploadFile = File(...),
    brightness: float = Form(0.0),
    contrast: float = Form(1.0),
    grayscale: bool = Form(False),
    gaussian_blur: int = Form(0),
    median_blur: int = Form(0),
    blur_mode: str = Form("gaussian"),
    sharpen: bool = Form(False),
    denoise: bool = Form(False),
    edge_detection: bool = Form(False),
    edge_operator: str = Form("canny"),
    mission_id: Optional[str] = Form(None)
):
    """
    Applies interactive OpenCV image adjustments without overwriting original.
    """
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Empty file payload")

        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Could not decode image")

        res = process_image_pipeline(
            img,
            brightness=brightness,
            contrast=contrast,
            grayscale=grayscale,
            gaussian_blur=gaussian_blur,
            median_blur=median_blur,
            blur_mode=blur_mode,
            sharpen=sharpen,
            denoise=denoise,
            edge_detection=edge_detection,
            edge_operator=edge_operator
        )

        # Save processed result to disk for display and download
        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        processed_filename = f"pipe_{timestamp_str}.png"
        processed_filepath = STORAGE_DIR / processed_filename
        cv2.imwrite(str(processed_filepath), res["processed_image"])

        # Also encode to base64 Data URL for instant React viewer display
        _, buf = cv2.imencode(".png", res["processed_image"])
        base64_data = base64.b64encode(buf).decode("utf-8")
        data_url = f"data:image/png;base64,{base64_data}"

        return {
            "status": "success",
            "processed_filename": processed_filename,
            "processed_image_url": data_url,
            "stages_executed": res["stages_executed"],
            "final_shape": res["final_shape"],
            "parameters": {
                "brightness": brightness,
                "contrast": contrast,
                "grayscale": grayscale,
                "gaussian_blur": gaussian_blur,
                "sharpen": sharpen,
                "denoise": denoise,
                "edge_detection": edge_detection
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image processing error: {str(e)}")

# Image serving
@router.get("/images/{filename}")
def get_image(filename: str):
    file_path = STORAGE_DIR / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Image file not found")
    return FileResponse(file_path, media_type="image/png")

# --------------------------------------------------
# POSE ESTIMATION ENDPOINTS
# --------------------------------------------------

@router.get("/pose/landmarks")
def get_pose_landmarks():
    """Return single source of truth 3D landmark coordinates and model scale."""
    from cv.pose_estimation import LANDMARKS_3D, LANDMARK_SCALE, LANDMARK_IDS, LANDMARKS_METADATA
    return {
        "landmark_ids": LANDMARK_IDS,
        "landmark_scale": LANDMARK_SCALE,
        "landmarks_3d": LANDMARKS_3D,
        "metadata": LANDMARKS_METADATA,
    }

@router.post("/pose/estimate")
def estimate_pose_api(req: PoseRequest):
    try:
        result = estimate_pose(
            bbox=req.bbox,
            image_points=req.image_points,
            image_size=req.image_size,
            fov_degrees=req.fov_degrees,
            fov_mode=req.fov_mode or "vertical",
            camera_matrix=req.camera_matrix,
            distortion_coeffs=req.distortion_coeffs,
            method=req.method or "ITERATIVE",
            use_ransac=bool(req.use_ransac),
            ground_truth=req.ground_truth,
        )

        now_iso = datetime.now(timezone.utc).isoformat()
        result["timestamp"] = now_iso

        if result.get("success"):
            pos = result["position"]
            dist = result.get("distance_m") or float(np.sqrt(pos["x"]**2 + pos["y"]**2 + pos["z"]**2))
            result["distance_m"] = round(dist, 4)

            db = get_database()
            if db is not None:
                pose_doc = {
                    "timestamp": now_iso,
                    "mission_id": req.mission_id,
                    "target_id": req.target_id or "SAT-001",
                    "frame_id": req.frame_id,
                    "method": result.get("method"),
                    "position": result["position"],
                    "attitude": result["attitude"],
                    "quaternion": result.get("quaternion"),
                    "rotation_matrix": result.get("rotation_matrix"),
                    "rotation_vector": result["rotation_vector"],
                    "reprojection_rmse_px": result["reprojection_rmse_px"],
                    "distance_m": result["distance_m"],
                    "landmarks_used": result["landmarks_used"],
                    "solve_time_ms": result.get("solve_time_ms"),
                    "errors_vs_gt": result.get("errors_vs_gt"),
                    "ground_truth": result.get("ground_truth"),
                    "noise_sigma_px": req.noise_sigma_px,
                    "keypoint_source": req.keypoint_source,
                    "sensor_name": req.sensor_name,
                    "fov_degrees": req.fov_degrees,
                    "fov_mode": req.fov_mode
                }
                res = db.pose_estimates.insert_one(pose_doc)
                result["record_id"] = str(res.inserted_id)

                db.activity_logs.insert_one({
                    "action": "POSE_ESTIMATED",
                    "details": f"6-DoF Pose estimated ({result.get('method')}): Range {dist:.2f}m, RMSE: {result['reprojection_rmse_px']:.3f}px, Time: {result.get('solve_time_ms')}ms",
                    "timestamp": now_iso
                })
                if req.mission_id:
                    db.mission_logs.insert_one({
                        "mission_id": req.mission_id,
                        "level": "INFO",
                        "event": "POSE_CALCULATED",
                        "message": f"6-DoF Pose solved ({result.get('method')}): Range={dist:.2f}m, RMSE={result['reprojection_rmse_px']}px",
                        "timestamp": now_iso
                    })

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pose estimation error: {str(e)}")

# --------------------------------------------------
# PHASE 2: FEATURE LIBRARY + FEATURE-BASED POSE (ORB / SIFT)
# --------------------------------------------------

class ReferenceViewRequest(BaseModel):
    image: str  # data URL / base64 of the captured frame
    camera_matrix: List[List[float]]
    ground_truth: dict  # {"position": {x,y,z}, "rotation_matrix": 3x3} in OpenCV camera frame
    view_id: str
    sensor_name: Optional[str] = None
    bbox: Optional[List[float]] = None


class FeaturePoseRequest(BaseModel):
    image: str
    camera_matrix: List[List[float]]
    feature: str = "ORB"  # ORB | SIFT
    method: str = "ITERATIVE"
    bbox: Optional[List[float]] = None
    ground_truth: Optional[dict] = None
    exclude_view_id: Optional[str] = None
    ratio_test: float = Field(0.75, gt=0.3, le=0.95)
    min_inliers: int = Field(15, ge=6, le=500)
    min_inlier_ratio: float = Field(0.40, ge=0.0, le=1.0)
    target_id: Optional[str] = "SAT-001"
    mission_id: Optional[str] = None
    frame_id: Optional[str] = None
    sensor_name: Optional[str] = None


@router.get("/features/reference")
def get_feature_library():
    from cv.features import library_status
    return library_status()


@router.delete("/features/reference")
def clear_feature_library():
    from cv.features import clear_library
    return clear_library()


@router.post("/features/reference")
def add_feature_reference(req: ReferenceViewRequest):
    from cv.features import add_reference_view
    try:
        return add_reference_view(req.image, req.camera_matrix, req.ground_truth, req.view_id,
                                  sensor_name=req.sensor_name, bbox=req.bbox)
    except (ValueError, FileNotFoundError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reference view error: {e}")


@router.post("/pose/estimate-from-image")
def estimate_pose_from_image_api(req: FeaturePoseRequest):
    from cv.features import estimate_pose_from_image
    try:
        result = estimate_pose_from_image(
            req.image, req.camera_matrix, feature=req.feature, method=req.method,
            bbox=req.bbox, ground_truth=req.ground_truth, exclude_view_id=req.exclude_view_id,
            ratio_test=req.ratio_test, min_inliers=req.min_inliers,
            min_inlier_ratio=req.min_inlier_ratio, target_id=req.target_id or "SAT-001")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Feature pose error: {e}")

    now_iso = datetime.now(timezone.utc).isoformat()
    result["timestamp"] = now_iso
    db = get_database()
    if db is not None:
        doc = {k: result.get(k) for k in (
            "success", "identified", "identification", "feature", "method", "keypoints", "matches",
            "inliers", "inlier_ratio", "position", "attitude", "quaternion", "rotation_matrix",
            "distance_m", "reprojection_rmse_px", "solve_time_ms", "total_time_ms",
            "errors_vs_gt", "ground_truth", "message")}
        doc.update({"timestamp": now_iso, "mission_id": req.mission_id, "frame_id": req.frame_id,
                    "target_id": req.target_id, "sensor_name": req.sensor_name,
                    "keypoint_source": req.feature.upper()})
        res = db.pose_estimates.insert_one(doc)
        result["record_id"] = str(res.inserted_id)
        if req.mission_id:
            db.mission_logs.insert_one({
                "mission_id": req.mission_id,
                "level": "INFO" if result.get("identified") else "WARNING",
                "event": "TARGET_IDENTIFIED" if result.get("identified") else "TARGET_NOT_MATCHED",
                "message": f"{req.feature.upper()}: {result.get('identification')} "
                           f"({result.get('inliers', 0)} inliers / {result.get('matches', 0)} matches)",
                "timestamp": now_iso,
            })
    return result

# --------------------------------------------------
# PHASES 3-5: LIVE PERCEPTION (tracking + pose + motion + collision)
# --------------------------------------------------

class PerceptionStepRequest(BaseModel):
    session_id: str
    timestamp: float  # simulation time (s)
    image: Optional[str] = None  # data URL; if given -> YOLO detection + tracking
    confidence: float = Field(0.4, ge=0.01, le=0.99)
    image_points: Optional[Dict[str, List[float]]] = None
    image_size: Optional[List[int]] = None
    camera_matrix: Optional[List[List[float]]] = None
    method: str = "ITERATIVE"
    ground_truth: Optional[dict] = None
    camera_rotation_world: Optional[List[List[float]]] = None  # chaser attitude (3x3)
    safety_radius_m: float = Field(1.0, gt=0, le=100)
    horizon_s: float = Field(60.0, gt=0, le=3600)
    mission_id: Optional[str] = None
    sensor_name: Optional[str] = None
    max_targets: Optional[int] = Field(1, ge=1, le=10)  # None = track every detection


class SessionRequest(BaseModel):
    session_id: str


class CollisionRequest(BaseModel):
    relative_position: List[float]
    relative_velocity: List[float]
    safety_radius_m: float = Field(1.0, gt=0, le=100)
    horizon_s: float = Field(60.0, gt=0, le=3600)


@router.post("/perception/step")
def perception_step(req: PerceptionStepRequest):
    from cv.perception import get_session
    image_bgr = None
    if req.image:
        try:
            from cv.features import decode_image
            image_bgr = decode_image(req.image)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    try:
        result = get_session(req.session_id).step(
            timestamp=req.timestamp, image_bgr=image_bgr, detect_fn=detect_target,
            conf=req.confidence, image_points=req.image_points, image_size=req.image_size,
            camera_matrix=req.camera_matrix, method=req.method, ground_truth=req.ground_truth,
            camera_rotation_world=req.camera_rotation_world,
            safety_radius_m=req.safety_radius_m, horizon_s=req.horizon_s,
            max_targets=req.max_targets)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Perception step error: {e}")

    db = get_database()
    if db is not None:
        now_iso = datetime.now(timezone.utc).isoformat()
        trk = result.get("tracking") or {}
        coll = (result.get("collision") or {}).get("estimated") or {}
        db.perception_steps.insert_one({
            "timestamp": now_iso, "sim_time": req.timestamp, "session_id": req.session_id,
            "mission_id": req.mission_id, "sensor_name": req.sensor_name,
            "tracks": trk.get("tracks"), "id_switches": trk.get("id_switches"),
            "pose_errors": (result.get("pose") or {}).get("errors_vs_gt"),
            "motion": result.get("motion"), "collision": result.get("collision"),
        })
        if trk.get("tracks"):
            db.tracks.insert_many([{**t, "timestamp": now_iso, "sim_time": req.timestamp,
                                    "session_id": req.session_id, "mission_id": req.mission_id}
                                   for t in trk["tracks"]])
        if (result.get("collision") or {}).get("risk_changed") and coll.get("risk_level") == "HIGH" and req.mission_id:
            db.mission_logs.insert_one({
                "mission_id": req.mission_id, "level": "WARNING", "event": "COLLISION_RISK_HIGH",
                "message": f"Collision risk HIGH: CPA {coll.get('d_cpa_m')} m in {coll.get('t_cpa_s')} s, "
                           f"TTC {coll.get('ttc_s')} s",
                "timestamp": now_iso,
            })
    return result


@router.post("/perception/reset")
def perception_reset(req: SessionRequest):
    from cv.perception import reset_session
    return reset_session(req.session_id)


@router.post("/collision/assess")
def collision_assess(req: CollisionRequest):
    from cv.collision import assess_collision
    if len(req.relative_position) != 3 or len(req.relative_velocity) != 3:
        raise HTTPException(status_code=400, detail="relative_position and relative_velocity need 3 values")
    return assess_collision(req.relative_position, req.relative_velocity, req.safety_radius_m, req.horizon_s)

@router.get("/poses")
def get_pose_history(mission_id: Optional[str] = None, limit: int = Query(20, ge=1, le=100)):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    query = {"mission_id": mission_id} if mission_id else {}
    docs = [serialize_doc(doc) for doc in db.pose_estimates.find(query).sort("timestamp", -1).limit(limit)]
    return docs

# --------------------------------------------------
# SIMULATION SESSIONS & ACTIVITY
# --------------------------------------------------

@router.get("/simulation/sessions")
def get_simulation_sessions(mission_id: Optional[str] = None, limit: int = Query(20, ge=1, le=100)):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    query = {"mission_id": mission_id} if mission_id else {}
    docs = [serialize_doc(doc) for doc in db.simulation_sessions.find(query).sort("timestamp", -1).limit(limit)]
    return docs

@router.post("/simulation/sessions")
def save_simulation_session(session: SimulationSessionModel):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")

    session_id = session.session_id or f"SIM-{int(datetime.now(timezone.utc).timestamp())}"
    doc = session.model_dump()
    doc["session_id"] = session_id
    doc["timestamp"] = datetime.now(timezone.utc).isoformat()

    db.simulation_sessions.insert_one(doc)
    db.activity_logs.insert_one({
        "action": "SIMULATION_SESSION_SAVED",
        "details": f"Simulation session {session_id} saved (Duration: {session.duration_s:.1f}s)",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    return {"status": "saved", "session_id": session_id}

@router.get("/activity")
def get_activity_logs(limit: int = Query(20, ge=1, le=100)):
    db = get_database()
    if db is None:
        return []
    docs = [serialize_doc(doc) for doc in db.activity_logs.find().sort("timestamp", -1).limit(limit)]
    return docs

@router.get("/mission-logs")
def get_mission_logs(mission_id: Optional[str] = None, limit: int = Query(50, ge=1, le=200)):
    db = get_database()
    if db is None:
        return []
    query = {"mission_id": mission_id} if mission_id else {}
    docs = [serialize_doc(doc) for doc in db.mission_logs.find(query).sort("timestamp", -1).limit(limit)]
    return docs

@router.post("/mission-logs")
def create_mission_log(event: MissionEventModel):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")

    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "mission_id": event.mission_id or "MSN-DEFAULT-01",
        "action": f"EVENT_{event.event_type.upper()}",
        "event_type": event.event_type.upper(),
        "message": event.message,
        "details": event.message,
        "target_id": event.target_id,
        "sensor_id": event.sensor_id,
        "time_s": event.time_s,
        "timestamp": now_iso
    }
    db.mission_logs.insert_one(doc)
    return {"status": "success", "log": serialize_doc(doc)}


# --------------------------------------------------
# SETTINGS PERSISTENCE
# --------------------------------------------------

PERCEPTION_SETTING_DEFAULTS = {
    "live_rate_fps": 2.0,
    "live_noise_px": 1.0,
    # In the simulated rendezvous the camera-to-target range is 0.96-1.28 m. With a 1 m
    # keep-out sphere the risk is HIGH around closest approach and MEDIUM elsewhere
    # (the old 2 m default made every frame HIGH).
    "safety_radius_m": 1.0,
    "collision_horizon_s": 60.0,
    "feature_min_inliers": 15,
    "feature_min_inlier_ratio": 0.40,
}


@router.get("/settings")
def get_user_settings():
    db = get_database()
    if db is None:
        return {
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
            **PERCEPTION_SETTING_DEFAULTS,
            "db_connected": False
        }

    doc = db.user_settings.find_one({"id": "global_settings"})
    if not doc:
        doc = {
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
            **PERCEPTION_SETTING_DEFAULTS,
            "settings_version": 2,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        db.user_settings.insert_one(doc)
    for k, v in PERCEPTION_SETTING_DEFAULTS.items():
        doc.setdefault(k, v)
    # Settings v2: the old 2 m default safety radius is migrated to the new 1 m default
    if int(doc.get("settings_version") or 1) < 2:
        if float(doc.get("safety_radius_m") or 0) == 2.0:
            doc["safety_radius_m"] = 1.0
        doc["settings_version"] = 2
        db.user_settings.update_one({"id": "global_settings"},
                                    {"$set": {"safety_radius_m": doc["safety_radius_m"], "settings_version": 2}})
    doc["db_connected"] = True
    return serialize_doc(doc)

@router.put("/settings")
def update_user_settings(settings: UserSettingsModel):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable to persist settings")

    data = settings.model_dump()
    data["id"] = "global_settings"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    db.user_settings.update_one({"id": "global_settings"}, {"$set": data}, upsert=True)
    db.activity_logs.insert_one({
        "action": "SETTINGS_UPDATED",
        "details": f"Settings updated (speed {data.get('default_speed')}x, YOLO conf {data.get('confidence_threshold')}, "
                   f"safety radius {data.get('safety_radius_m')} m)",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    return {"status": "success", "settings": data}

@router.post("/settings/reset")
def reset_user_settings():
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")

    defaults = {
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
        **PERCEPTION_SETTING_DEFAULTS,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    db.user_settings.update_one({"id": "global_settings"}, {"$set": defaults}, upsert=True)
    db.activity_logs.insert_one({
        "action": "SETTINGS_RESET",
        "details": "User preferences reset to factory defaults",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    return {"status": "reset", "settings": defaults}

# --------------------------------------------------
# EXPORT AND DOWNLOAD ENDPOINTS
# --------------------------------------------------

@router.get("/export/detections/csv")
def export_detections_csv(mission_id: Optional[str] = None):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")

    query = {"mission_id": mission_id} if mission_id else {}
    records = list(db.detection_results.find(query).sort("timestamp", -1))

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Record ID", "Mission ID", "Timestamp", "Frame ID", "Sensor", "Detected",
        "Target Count", "Confidence Threshold", "Image Filename"
    ])

    for r in records:
        writer.writerow([
            str(r.get("_id")),
            r.get("mission_id", "N/A"),
            r.get("timestamp", ""),
            r.get("frame_id", ""),
            r.get("sensor_name", ""),
            r.get("detected", False),
            r.get("detection_count", 0),
            r.get("confidence_threshold", ""),
            r.get("annotated_image_filename", "")
        ])

    output.seek(0)
    filename = f"detections_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/export/detections/json")
def export_detections_json(mission_id: Optional[str] = None):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")

    query = {"mission_id": mission_id} if mission_id else {}
    records = [serialize_doc(r) for r in db.detection_results.find(query).sort("timestamp", -1)]
    filename = f"detections_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    return Response(
        content=json.dumps(records, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/export/poses/csv")
def export_poses_csv(mission_id: Optional[str] = None):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")

    query = {"mission_id": mission_id} if mission_id else {}
    records = list(db.pose_estimates.find(query).sort("timestamp", -1))
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Record ID", "Mission ID", "Timestamp", "Target ID", "Pos_X(m)", "Pos_Y(m)", "Pos_Z(m)",
        "Range(m)", "Roll(deg)", "Pitch(deg)", "Yaw(deg)", "RMSE(px)", "Landmarks Used"
    ])

    for r in records:
        pos = r.get("position", {})
        att = r.get("attitude", {})
        writer.writerow([
            str(r.get("_id")),
            r.get("mission_id", "N/A"),
            r.get("timestamp", ""),
            r.get("target_id", ""),
            pos.get("x", ""), pos.get("y", ""), pos.get("z", ""),
            r.get("distance_m", ""),
            att.get("roll", ""), att.get("pitch", ""), att.get("yaw", ""),
            r.get("reprojection_rmse_px", ""),
            r.get("landmarks_used", "")
        ])

    output.seek(0)
    filename = f"pose_estimates_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/missions/{mission_id}/summary")
def get_mission_summary(mission_id: str):
    """Everything done in this mission, aggregated from spaceDB (use 'ALL' for every mission)."""
    from services.mission_summary import build_mission_summary
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")
    return build_mission_summary(db, None if mission_id.upper() == "ALL" else mission_id)


@router.get("/export/mission-report")
def export_mission_report(mission_id: Optional[str] = None):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="spaceDB is unavailable")

    mission_doc = None
    if mission_id:
        mission_doc = db.missions.find_one({"mission_id": mission_id})
    if not mission_doc:
        mission_doc = db.missions.find_one() or {"name": "General Mission", "mission_id": "ALL"}

    q_filter = {"mission_id": mission_id} if mission_id else {}
    targets = [serialize_doc(t) for t in db.targets.find()]
    detections = [serialize_doc(d) for d in db.detection_results.find(q_filter).sort("timestamp", -1).limit(100)]
    poses = [serialize_doc(p) for p in db.pose_estimates.find(q_filter).sort("timestamp", -1).limit(100)]
    sessions = [serialize_doc(s) for s in db.simulation_sessions.find(q_filter).sort("timestamp", -1).limit(20)]
    logs = [serialize_doc(l) for l in db.mission_logs.find(q_filter).sort("timestamp", -1).limit(100)]

    from services.mission_summary import build_mission_summary
    report = {
        "report_title": "Spacecraft Perception & Pose Estimation Mission Summary",
        "summary": build_mission_summary(db, mission_id),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mission_metadata": serialize_doc(mission_doc),
        "target_spacecraft": targets,
        "detection_statistics": {
            "total_processed_frames": len(detections),
            "targets_detected_count": len([d for d in detections if d.get("detected")]),
        },
        "pose_statistics": {
            "total_pose_estimates": len(poses),
        },
        "detections": detections,
        "poses": poses,
        "simulation_sessions": sessions,
        "mission_logs": logs
    }

    filename = f"mission_report_{mission_id or 'all'}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    return Response(
        content=json.dumps(report, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
