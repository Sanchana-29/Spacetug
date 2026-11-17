"""
Live perception loop (Phases 3-5 together).

One call to `PerceptionSession.step()` processes ONE sensor frame:
  1. YOLOv8n detection + SORT tracking            -> persistent track IDs
  2. 6-DoF pose (solvePnP on the 2D landmarks)    -> estimated pose + error vs GT
  3. Relative motion (Kalman)                     -> velocity, tumbling rate (raw + filtered)
  4. Collision risk (TTC / CPA)                   -> LOW / MEDIUM / HIGH
The same motion + collision computation is run on the simulation ground truth,
so every estimated quantity can be compared with the truth.
"""
from __future__ import annotations

import threading
import time
from typing import Dict, Optional

import numpy as np

from cv.collision import assess_collision
from cv.motion import MotionEstimator
from cv.pose_estimation import estimate_pose
from cv.tracking import SortTracker

_sessions: Dict[str, "PerceptionSession"] = {}
_lock = threading.Lock()


def get_session(session_id: str) -> "PerceptionSession":
    with _lock:
        s = _sessions.get(session_id)
        if s is None:
            s = PerceptionSession(session_id)
            _sessions[session_id] = s
        return s


def reset_session(session_id: str) -> dict:
    with _lock:
        _sessions.pop(session_id, None)
    return {"session_id": session_id, "reset": True}


def _r(x, nd=4):
    return None if x is None else round(float(x), nd)


class PerceptionSession:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.tracker = SortTracker(iou_threshold=0.3, max_age=5, min_hits=2)
        self.motion_est = MotionEstimator(filtered=True)
        self.motion_gt = MotionEstimator(filtered=False)
        self.last_risk = None
        self.steps = 0
        self.created = time.time()

    def step(self, *, timestamp: float, image_bgr=None, detect_fn=None, conf: float = 0.4,
             image_points=None, image_size=None, camera_matrix=None, method: str = "ITERATIVE",
             ground_truth: Optional[dict] = None, camera_rotation_world=None,
             safety_radius_m: float = 2.0, horizon_s: float = 60.0) -> dict:
        self.steps += 1
        t0 = time.perf_counter()
        out = {"session_id": self.session_id, "step": self.steps, "timestamp": float(timestamp)}

        # 1. Detection + tracking -------------------------------------------------
        if image_bgr is not None and detect_fn is not None:
            td = time.perf_counter()
            det = detect_fn(image_bgr, conf=conf)
            dets = []
            for d in det.get("detections", []):
                b = d["bounding_box"]
                dets.append({"bbox": [b["x"], b["y"], b["x"] + b["width"], b["y"] + b["height"]],
                             "confidence": d["confidence"], "class_name": d.get("class_name")})
            tracks = self.tracker.update(dets)
            out["tracking"] = {
                "detections": len(dets),
                "tracks": tracks,
                "detection_time_ms": round((time.perf_counter() - td) * 1000.0, 1),
                **self.tracker.metrics(),
            }

        # 2. Pose -----------------------------------------------------------------
        pose = None
        if image_points and len(image_points) >= 4 and camera_matrix is not None:
            pose = estimate_pose(image_points=image_points, image_size=image_size,
                                 camera_matrix=camera_matrix, method=method,
                                 ground_truth=ground_truth)
            out["pose"] = {k: pose.get(k) for k in (
                "success", "message", "method", "position", "distance_m", "attitude", "quaternion",
                "reprojection_rmse_px", "landmarks_used", "solve_time_ms", "errors_vs_gt")}
        else:
            out["pose"] = {"success": False,
                           "message": "Fewer than 4 visible landmarks - pose skipped for this frame"}

        # 3. Motion (estimate + ground truth) ------------------------------------
        motion_est = None
        if pose and pose.get("success"):
            motion_est = self.motion_est.update(timestamp, pose["rotation_matrix"],
                                                pose["translation_vector"], camera_rotation_world)
        motion_gt = None
        if ground_truth and "rotation_matrix" in ground_truth and "position" in ground_truth:
            p = ground_truth["position"]
            motion_gt = self.motion_gt.update(timestamp, ground_truth["rotation_matrix"],
                                              [p["x"], p["y"], p["z"]], camera_rotation_world)

        def pack(m, filtered):
            if not m:
                return None
            keys = ["ready", "range_m", "speed_raw_mps", "closing_speed_raw_mps", "tumbling_rate_raw_dps"]
            if filtered:
                keys += ["range_filtered_m", "speed_filtered_mps", "closing_speed_filtered_mps",
                         "tumbling_rate_filtered_dps"]
            return {k: (_r(m.get(k), 5) if k != "ready" else m.get(k)) for k in keys}

        out["motion"] = {"estimated": pack(motion_est, True), "ground_truth": pack(motion_gt, False)}

        # 4. Collision risk --------------------------------------------------------
        coll_est = None
        if motion_est and motion_est.get("ready"):
            coll_est = assess_collision(motion_est["position_filtered"], motion_est["velocity_filtered"],
                                        safety_radius_m, horizon_s)
        coll_gt = None
        if motion_gt and motion_gt.get("ready"):
            coll_gt = assess_collision(motion_gt["position_world"], motion_gt["velocity_raw"],
                                       safety_radius_m, horizon_s)
        risk_now = (coll_est or coll_gt or {}).get("risk_level")
        out["collision"] = {"estimated": coll_est, "ground_truth": coll_gt,
                            "risk_changed": risk_now is not None and risk_now != self.last_risk,
                            "previous_risk": self.last_risk}
        if risk_now is not None:
            self.last_risk = risk_now

        out["total_time_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
        return out
