"""Mission summary aggregation (fake in-memory MongoDB)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.mission_summary import build_mission_summary  # noqa: E402


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def _match(self, d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    def find(self, q=None):
        return [dict(d) for d in self.docs if self._match(d, q)]

    def find_one(self, q=None):
        r = self.find(q)
        return r[0] if r else None


class FakeDB:
    def __init__(self, **cols):
        for name in ("missions", "detection_results", "pose_estimates", "perception_steps", "tracks", "mission_logs"):
            setattr(self, name, FakeCollection(cols.get(name, [])))


M = "MSN-1"


def make_db():
    return FakeDB(
        missions=[{"mission_id": M, "name": "Demo", "status": "RUNNING"}],
        detection_results=[
            {"mission_id": M, "detected": True, "sensor_name": "RGB-D Camera", "detections": [{"confidence": 0.9}]},
            {"mission_id": M, "detected": False, "sensor_name": "Thermal Camera", "detections": []},
            {"mission_id": "OTHER", "detected": True, "detections": [{"confidence": 0.5}]},
        ],
        pose_estimates=[
            {"mission_id": M, "keypoint_source": "LANDMARKS", "method": "ITERATIVE", "position": {"x": 0},
             "errors_vs_gt": {"rotation_error_deg": 1.0, "translation_error_m": 0.01}, "reprojection_rmse_px": 0.5},
            {"mission_id": M, "keypoint_source": "ORB", "success": True, "identified": True, "inliers": 40,
             "position": {"x": 0}, "errors_vs_gt": {"rotation_error_deg": 2.0, "translation_error_m": 0.02}},
            {"mission_id": M, "keypoint_source": "ORB", "success": False, "identified": False, "inliers": 3},
        ],
        perception_steps=[
            {"mission_id": M, "session_id": "S1", "tracks": [{"track_id": "TRK-01"}], "id_switches": 0,
             "motion": {"estimated": {"speed_raw_mps": 0.06, "speed_filtered_mps": 0.051, "range_m": 1.0},
                        "ground_truth": {"speed_raw_mps": 0.05, "range_m": 1.0}},
             "collision": {"estimated": {"risk_level": "LOW", "d_cpa_m": 3.0, "ttc_s": None}}},
            {"mission_id": M, "session_id": "S1", "tracks": [], "id_switches": 0,
             "motion": {"estimated": {"speed_raw_mps": 0.04, "speed_filtered_mps": 0.049},
                        "ground_truth": {"speed_raw_mps": 0.05}},
             "collision": {"estimated": {"risk_level": "HIGH", "d_cpa_m": 0.5, "ttc_s": 12.0}}},
        ],
        tracks=[{"mission_id": M, "track_id": "TRK-01"}],
        mission_logs=[{"mission_id": M, "level": "WARNING", "event": "COLLISION_RISK_HIGH", "timestamp": "2"},
                      {"mission_id": M, "level": "INFO", "event": "X", "timestamp": "1"}],
    )


def test_mission_summary_aggregates_only_this_mission():
    s = build_mission_summary(make_db(), M)
    assert s["mission"]["name"] == "Demo"
    d = s["detection"]
    assert d["frames_processed"] == 2 and d["frames_with_target"] == 1 and d["detection_rate_pct"] == 50.0
    orb = s["pose_estimation"]["by_keypoint_source"]["ORB"]
    assert orb["attempts"] == 2 and orb["solved"] == 1 and orb["identification_rate_pct"] == 50.0
    lm = s["pose_estimation"]["by_keypoint_source"]["LANDMARKS"]
    assert lm["rotation_error_deg"]["mean"] == 1.0
    live = s["live_perception"]
    assert live["steps"] == 2 and live["track_ids_seen"] == ["TRK-01"] and live["steps_with_track"] == 1
    assert live["motion"]["speed_rmse_raw_mps"] == pytest.approx(0.01)
    assert live["motion"]["speed_rmse_filtered_mps"] == pytest.approx(0.001, abs=1e-6)
    assert live["collision"]["risk_counts"] == {"LOW": 1, "HIGH": 1}
    assert live["collision"]["min_cpa_distance_m"] == 0.5 and live["collision"]["min_ttc_s"] == 12.0
    assert s["events"]["by_level"] == {"WARNING": 1, "INFO": 1}
    assert s["events"]["recent"][-1]["event"] == "COLLISION_RISK_HIGH"


def test_empty_mission_summary_is_safe():
    s = build_mission_summary(FakeDB(), "NONE")
    assert s["detection"]["frames_processed"] == 0 and s["detection"]["detection_rate_pct"] is None
    assert s["live_perception"]["collision"]["min_cpa_distance_m"] is None
