"""
Mission summary: everything that was done during one mission, aggregated from spaceDB.

Sources (MongoDB collections)
  missions            mission metadata
  detection_results   YOLOv8n detections on captured frames
  pose_estimates      solvePnP (landmarks) and ORB/SIFT feature-based poses
  perception_steps    live perception loop (tracking, motion, collision)
  tracks              persistent track records
  mission_logs        mission events (INFO / WARNING / ...)

Only real stored records are summarised; empty sections report zero / None.
"""
from __future__ import annotations

import math
from collections import Counter
from datetime import datetime, timezone
from statistics import mean, median
from typing import Optional


def _stats(values):
    v = [float(x) for x in values if x is not None and math.isfinite(float(x))]
    if not v:
        return None
    return {"count": len(v), "mean": round(mean(v), 4), "median": round(median(v), 4),
            "min": round(min(v), 4), "max": round(max(v), 4)}


def _rmse(pairs):
    d = [(float(a) - float(b)) ** 2 for a, b in pairs if a is not None and b is not None]
    return round(math.sqrt(sum(d) / len(d)), 5) if d else None


def _strip_id(doc: dict) -> dict:
    out = dict(doc)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    return out


def build_mission_summary(db, mission_id: Optional[str]) -> dict:
    q = {"mission_id": mission_id} if mission_id else {}

    mission = db.missions.find_one({"mission_id": mission_id}) if mission_id else None
    mission = _strip_id(mission) if mission else {"mission_id": mission_id or "ALL", "name": "All missions"}

    # ── Detection ─────────────────────────────────────────────────────────────
    dets = list(db.detection_results.find(q))
    confs = [d.get("confidence") for doc in dets for d in (doc.get("detections") or [])]
    detection = {
        "frames_processed": len(dets),
        "frames_with_target": sum(1 for d in dets if d.get("detected")),
        "total_detections": len(confs),
        "confidence": _stats(confs),
        "frames_by_sensor": dict(Counter((d.get("sensor_name") or "Unknown") for d in dets)),
    }
    detection["detection_rate_pct"] = (round(100.0 * detection["frames_with_target"] / len(dets), 1)
                                       if dets else None)

    # ── Pose estimation (landmarks + ORB/SIFT) ───────────────────────────────
    poses = list(db.pose_estimates.find(q))
    by_source = {}
    for src in sorted({(p.get("keypoint_source") or "LANDMARKS").upper() for p in poses}):
        group = [p for p in poses if (p.get("keypoint_source") or "LANDMARKS").upper() == src]
        ok = [p for p in group if p.get("success", True) and p.get("position")]
        errs = [p.get("errors_vs_gt") or {} for p in ok]
        entry = {
            "attempts": len(group),
            "solved": len(ok),
            "rotation_error_deg": _stats(e.get("rotation_error_deg") for e in errs),
            "translation_error_m": _stats(e.get("translation_error_m") for e in errs),
            "reprojection_rmse_px": _stats(p.get("reprojection_rmse_px") for p in ok),
            "solve_time_ms": _stats(p.get("solve_time_ms") for p in ok),
        }
        if src in ("ORB", "SIFT"):
            entry["identified"] = sum(1 for p in group if p.get("identified"))
            entry["identification_rate_pct"] = round(100.0 * entry["identified"] / len(group), 1) if group else None
            entry["inliers"] = _stats(p.get("inliers") for p in group)
        by_source[src] = entry
    methods = dict(Counter((p.get("method") or "ITERATIVE") for p in poses))

    # ── Live perception: tracking, motion, collision ──────────────────────────
    steps = list(db.perception_steps.find(q))
    sessions = sorted({s.get("session_id") for s in steps if s.get("session_id")})
    track_docs = list(db.tracks.find(q))
    track_ids = sorted({t.get("track_id") for t in track_docs if t.get("track_id")})
    steps_with_track = sum(1 for s in steps if s.get("tracks"))

    def m(s, side, key):
        return ((s.get("motion") or {}).get(side) or {}).get(key)

    pose_errs = [s.get("pose_errors") or {} for s in steps]
    motion = {
        "speed_rmse_raw_mps": _rmse((m(s, "estimated", "speed_raw_mps"), m(s, "ground_truth", "speed_raw_mps")) for s in steps),
        "speed_rmse_filtered_mps": _rmse((m(s, "estimated", "speed_filtered_mps"), m(s, "ground_truth", "speed_raw_mps")) for s in steps),
        "tumble_rmse_raw_dps": _rmse((m(s, "estimated", "tumbling_rate_raw_dps"), m(s, "ground_truth", "tumbling_rate_raw_dps")) for s in steps),
        "tumble_rmse_filtered_dps": _rmse((m(s, "estimated", "tumbling_rate_filtered_dps"), m(s, "ground_truth", "tumbling_rate_raw_dps")) for s in steps),
        "range_rmse_m": _rmse((m(s, "estimated", "range_m"), m(s, "ground_truth", "range_m")) for s in steps),
        "range_m": _stats(m(s, "ground_truth", "range_m") for s in steps),
    }
    colls = [((s.get("collision") or {}).get("estimated") or {}) for s in steps]
    colls = [c for c in colls if c.get("risk_level")]
    ttcs = [c.get("ttc_s") for c in colls if c.get("ttc_s") is not None]
    collision = {
        "assessments": len(colls),
        "risk_counts": dict(Counter(c["risk_level"] for c in colls)),
        "min_cpa_distance_m": round(min(c["d_cpa_m"] for c in colls), 4) if colls else None,
        "min_ttc_s": round(min(ttcs), 2) if ttcs else None,
    }
    live = {
        "steps": len(steps),
        "sessions": len(sessions),
        "steps_with_track": steps_with_track,
        "track_ids_seen": track_ids,
        "max_id_switches": max((s.get("id_switches") or 0 for s in steps), default=0),
        "pose_rotation_error_deg": _stats(e.get("rotation_error_deg") for e in pose_errs),
        "pose_translation_error_m": _stats(e.get("translation_error_m") for e in pose_errs),
        "motion": motion,
        "collision": collision,
    }

    # ── Mission log ───────────────────────────────────────────────────────────
    logs = list(db.mission_logs.find(q))
    logs.sort(key=lambda d: str(d.get("timestamp", "")))
    events = {
        "total": len(logs),
        "by_level": dict(Counter((d.get("level") or "INFO") for d in logs)),
        "recent": [{"timestamp": d.get("timestamp"), "level": d.get("level"), "event": d.get("event"),
                    "message": d.get("message")} for d in logs[-15:]],
    }

    return {
        "report_title": "Spacecraft Perception & Pose Estimation - Mission Summary",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mission": mission,
        "detection": detection,
        "pose_estimation": {"total": len(poses), "by_keypoint_source": by_source, "solver_methods": methods},
        "live_perception": live,
        "events": events,
    }
