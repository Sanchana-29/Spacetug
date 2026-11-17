"""API tests for the pose endpoints (FastAPI TestClient).
Skipped automatically if ultralytics is not installed (routes import the YOLO detector).
MongoDB is optional: if it is not running the endpoint still answers (no record_id)."""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
pytest.importorskip("ultralytics")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from tests.test_pose_estimation import (  # noqa: E402
    LANDMARKS_3D, W, H, make_scene, project_like_three,
    ground_truth_like_three, intrinsics_like_three,
)
import numpy as np  # noqa: E402

client = TestClient(app)


def test_landmarks_endpoint():
    r = client.get("/api/pose/landmarks")
    assert r.status_code == 200
    d = r.json()
    assert d["landmark_scale"] == 0.08
    assert set(d["landmarks_3d"]) == set(LANDMARKS_3D)


def test_pose_estimate_endpoint_returns_estimate_and_errors():
    scene = make_scene(np.random.default_rng(1), distance=8.0)
    payload = {
        "image_points": project_like_three(LANDMARKS_3D, *scene),
        "image_size": [W, H],
        "camera_matrix": intrinsics_like_three(),
        "method": "SQPNP",
        "ground_truth": ground_truth_like_three(*scene),
    }
    r = client.post("/api/pose/estimate", json=payload)
    assert r.status_code == 200
    d = r.json()
    assert d["success"] is True
    assert d["errors_vs_gt"]["rotation_error_deg"] < 0.05
    assert d["ground_truth"]["distance_m"] == pytest.approx(d["distance_m"], rel=1e-3)
    assert d["solve_time_ms"] >= 0


def test_feature_library_endpoints_respond():
    r = client.get("/api/features/reference")
    assert r.status_code == 200
    assert "methods" in r.json() and "ORB" in r.json()["methods"]


def test_collision_assess_endpoint():
    r = client.post("/api/collision/assess", json={"relative_position": [10, 0, 0], "relative_velocity": [-1, 0, 0]})
    assert r.status_code == 200
    assert r.json()["risk_level"] == "HIGH"


def test_perception_step_endpoint_pose_and_motion():
    scene = make_scene(np.random.default_rng(4), distance=6.0)
    base = {"session_id": "pytest-api", "image_size": [W, H], "camera_matrix": intrinsics_like_three(),
            "camera_rotation_world": scene[3].tolist()}
    client.post("/api/perception/reset", json={"session_id": "pytest-api"})
    last = None
    for k in range(3):
        sc = (scene[0] + np.array([0.0, 0.05 * k, 0.0]), scene[1], scene[2], scene[3])
        r = client.post("/api/perception/step", json={
            **base, "timestamp": float(k),
            "image_points": project_like_three(LANDMARKS_3D, *sc),
            "ground_truth": ground_truth_like_three(*sc)})
        assert r.status_code == 200, r.text
        last = r.json()
    assert last["pose"]["success"]
    assert last["motion"]["ground_truth"]["speed_raw_mps"] == pytest.approx(0.05, rel=1e-3)
    assert last["collision"]["estimated"]["risk_level"] in ("LOW", "MEDIUM", "HIGH")
