"""Phases 3-5 tests: SORT tracking, Kalman relative motion, TTC/CPA collision risk, perception step."""
import math
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from cv.tracking import SortTracker, iou_xyxy  # noqa: E402
from cv.motion import MotionEstimator, angular_velocity, C_CV_TO_THREE  # noqa: E402
from cv.collision import assess_collision  # noqa: E402
from cv.perception import PerceptionSession  # noqa: E402


# ───────────────────────────── Phase 3: tracking ─────────────────────────────
def moving_box(k, rng, jitter=2.0):
    x = 100 + 6 * k + rng.normal(0, jitter)
    y = 200 + 2 * k + rng.normal(0, jitter)
    return [x, y, x + 120 + rng.normal(0, jitter), y + 80 + rng.normal(0, jitter)]


def test_iou():
    a = np.array([[0, 0, 10, 10]])
    b = np.array([[5, 0, 15, 10], [20, 20, 30, 30]])
    assert np.allclose(iou_xyxy(a, b), [[1 / 3, 0.0]])


def test_single_target_keeps_same_id_with_noise_and_missed_frames():
    rng = np.random.default_rng(0)
    trk = SortTracker()
    ids = set()
    for k in range(60):
        dets = [] if k in (20, 21, 40) else [{"bbox": moving_box(k, rng), "confidence": 0.9}]
        for t in trk.update(dets):
            ids.add(t["track_id"])
    m = trk.metrics()
    assert ids == {"TRK-01"}
    assert m["id_switches"] == 0
    assert m["id_consistency_pct"] == 100.0


def test_one_frame_false_positive_never_gets_confirmed():
    rng = np.random.default_rng(1)
    trk = SortTracker()
    seen = set()
    for k in range(20):
        dets = [{"bbox": moving_box(k, rng), "confidence": 0.9}]
        if k == 10:
            dets.append({"bbox": [900, 50, 950, 90], "confidence": 0.5})  # spurious
        seen |= {t["track_id"] for t in trk.update(dets)}
    assert seen == {"TRK-01"}


def test_two_targets_get_different_ids():
    rng = np.random.default_rng(2)
    trk = SortTracker()
    seen = set()
    for k in range(15):
        a = moving_box(k, rng)
        b = [a[0] + 500, a[1], a[2] + 500, a[3]]
        seen |= {t["track_id"] for t in trk.update([{"bbox": a, "confidence": 0.9},
                                                     {"bbox": b, "confidence": 0.8}])}
    assert seen == {"TRK-01", "TRK-02"}


# ───────────────────────────── Phase 4: motion ───────────────────────────────
def rodrigues(w):
    R, _ = cv2.Rodrigues(np.asarray(w, dtype=float).reshape(3, 1))
    return R


def test_angular_velocity_from_rotations():
    w = np.array([0.05, -0.03, 0.02])
    R0 = rodrigues([0.3, 0.1, -0.2])
    R1 = rodrigues(w * 0.5) @ R0
    assert np.allclose(angular_velocity(R0, R1, 0.5), w, atol=1e-9)


def simulate(rng, n=120, dt=0.5, pos_noise=0.01, rot_noise_deg=1.0):
    """Target drifting at constant velocity and tumbling at constant rate; camera slewing."""
    r0 = np.array([4.0, 1.0, -3.0])
    v = np.array([-0.02, 0.005, 0.015])
    w = np.array([0.05, -0.03, 0.02])
    Rt0 = rodrigues([0.2, 0.4, -0.1])
    for k in range(n):
        t = k * dt
        r_w = r0 + v * t
        R_tw = rodrigues(w * t) @ Rt0
        R_cw = rodrigues([0.0, 0.01 * t, 0.0])  # chaser camera slews slowly
        # measurements in OpenCV camera frame
        t_cv = C_CV_TO_THREE @ R_cw.T @ r_w
        R_cv = C_CV_TO_THREE @ R_cw.T @ R_tw
        t_meas = t_cv + rng.normal(0, pos_noise, 3)
        R_meas = rodrigues(rng.normal(0, math.radians(rot_noise_deg), 3)) @ R_cv
        yield t, R_cv, t_cv, R_meas, t_meas, R_cw, v, w


def test_ground_truth_motion_is_exact_in_world_frame():
    m = MotionEstimator(filtered=False)
    for t, R_cv, t_cv, _, _, R_cw, v, w in simulate(np.random.default_rng(0), n=10):
        res = m.update(t, R_cv, t_cv, R_cw)
    assert res["speed_raw_mps"] == pytest.approx(np.linalg.norm(v), rel=1e-6)
    assert res["tumbling_rate_raw_dps"] == pytest.approx(math.degrees(np.linalg.norm(w)), rel=1e-6)


def test_kalman_filter_reduces_noise():
    rng = np.random.default_rng(3)
    m = MotionEstimator(filtered=True)
    raw_v, filt_v, raw_w, filt_w = [], [], [], []
    for k, (t, _, _, R_meas, t_meas, R_cw, v, w) in enumerate(simulate(rng)):
        res = m.update(t, R_meas, t_meas, R_cw)
        if res["ready"] and k > 30:  # after convergence
            raw_v.append(np.linalg.norm(np.array(res["velocity_raw"]) - v))
            filt_v.append(np.linalg.norm(np.array(res["velocity_filtered"]) - v))
            raw_w.append(abs(res["tumbling_rate_raw_dps"] - math.degrees(np.linalg.norm(w))))
            filt_w.append(abs(res["tumbling_rate_filtered_dps"] - math.degrees(np.linalg.norm(w))))
    assert np.sqrt(np.mean(np.square(filt_v))) < 0.3 * np.sqrt(np.mean(np.square(raw_v)))
    assert np.mean(filt_w) < 0.5 * np.mean(raw_w)


# ───────────────────────────── Phase 5: collision ────────────────────────────
def test_head_on_approach():
    c = assess_collision([10, 0, 0], [-1, 0, 0], safety_radius_m=2.0, horizon_s=60)
    assert c["closing_speed_mps"] == pytest.approx(1.0)
    assert c["ttc_s"] == pytest.approx(10.0)
    assert c["t_cpa_s"] == pytest.approx(10.0)
    assert c["d_cpa_m"] == pytest.approx(0.0, abs=1e-9)
    assert c["risk_level"] == "HIGH"


def test_fly_by_with_safe_miss_distance():
    # passes 5 m away: CPA at t=10 s, d=5 m
    c = assess_collision([10, 5, 0], [-1, 0, 0], safety_radius_m=2.0)
    assert c["t_cpa_s"] == pytest.approx(10.0)
    assert c["d_cpa_m"] == pytest.approx(5.0)
    assert c["risk_level"] == "LOW"


def test_medium_risk_band():
    c = assess_collision([10, 3, 0], [-1, 0, 0], safety_radius_m=2.0)
    assert c["d_cpa_m"] == pytest.approx(3.0)
    assert c["risk_level"] == "MEDIUM"


def test_separating_objects_have_no_ttc():
    c = assess_collision([10, 0, 0], [1, 0, 0])
    assert c["ttc_s"] is None
    assert c["t_cpa_s"] == 0.0
    assert c["d_cpa_m"] == pytest.approx(10.0)
    assert c["risk_level"] == "LOW"


def test_far_future_cpa_outside_horizon_is_not_high():
    c = assess_collision([100, 0, 0], [-0.5, 0, 0], horizon_s=60)
    assert c["t_cpa_s"] == pytest.approx(200.0)
    assert c["risk_level"] == "LOW"


# ───────────────────────── combined perception step ─────────────────────────
def test_perception_step_end_to_end():
    from test_pose_estimation import (LANDMARKS_3D, W, H, make_scene, project_like_three,
                                      ground_truth_like_three, intrinsics_like_three)

    def fake_detect(img, conf=0.4):
        return {"detections": [{"bounding_box": {"x": 100, "y": 100, "width": 200, "height": 150},
                                "confidence": 0.95, "class_name": "satellite"}]}

    sess = PerceptionSession("test")
    rng = np.random.default_rng(5)
    scene = make_scene(rng, 6.0)
    img = np.zeros((H, W, 3), np.uint8)
    last = None
    for k in range(5):
        target_pos = scene[0] + np.array([0.0, 0.0, -0.1]) * k  # moving target
        sc = (target_pos, scene[1], scene[2], scene[3])
        last = sess.step(timestamp=k * 0.5, image_bgr=img, detect_fn=fake_detect,
                         image_points=project_like_three(LANDMARKS_3D, *sc), image_size=[W, H],
                         camera_matrix=intrinsics_like_three(), ground_truth=ground_truth_like_three(*sc),
                         camera_rotation_world=scene[3].tolist())
    assert last["tracking"]["tracks"][0]["track_id"] == "TRK-01"
    assert last["pose"]["success"]
    est, gt = last["motion"]["estimated"], last["motion"]["ground_truth"]
    assert gt["speed_raw_mps"] == pytest.approx(0.2, rel=1e-3)          # 0.1 m per 0.5 s
    assert est["speed_raw_mps"] == pytest.approx(0.2, rel=1e-2)
    assert last["collision"]["ground_truth"]["risk_level"] in ("LOW", "MEDIUM", "HIGH")


def test_motion_filter_restarts_when_time_goes_backwards():
    m = MotionEstimator(filtered=True)
    R = np.eye(3)
    for t in (10.0, 10.5, 11.0):
        m.update(t, R, [0, 0, 5.0 - 0.1 * t])
    res = m.update(0.0, R, [0, 0, 5.0])        # simulation reset to t = 0
    assert res["ready"] is False
    res = m.update(0.5, R, [0, 0, 4.95])
    assert res["ready"] is True and res["speed_raw_mps"] == pytest.approx(0.1)


def test_perception_single_target_ignores_background_clutter():
    """Single-target mode: only the most confident detection is tracked (e.g. not Earth)."""
    from cv.perception import PerceptionSession

    def fake_detect(_img, conf=0.4):
        return {"detections": [
            {"bounding_box": {"x": 400, "y": 200, "width": 220, "height": 160}, "confidence": 0.93,
             "class_name": "satellite"},
            {"bounding_box": {"x": 10, "y": 10, "width": 300, "height": 500}, "confidence": 0.62,
             "class_name": "satellite"},
        ]}

    img = np.zeros((540, 960, 3), np.uint8)
    single = PerceptionSession("single")
    multi = PerceptionSession("multi")
    for k in range(6):
        out_s = single.step(timestamp=k * 0.5, image_bgr=img, detect_fn=fake_detect)
        out_m = multi.step(timestamp=k * 0.5, image_bgr=img, detect_fn=fake_detect, max_targets=None)
    trk = out_s["tracking"]
    assert trk["raw_detections"] == 2 and trk["detections"] == 1
    assert len(trk["tracks"]) == 1 and trk["tracks"][0]["confidence"] == 0.93
    assert len(out_m["tracking"]["tracks"]) == 2


def test_kalman_rejects_single_bad_pose():
    """One wrong PnP solution must not pull the filtered range / speed / tumble off."""
    from cv.motion import MotionEstimator

    est = MotionEstimator(filtered=True)
    w = np.array([0.05, -0.03, 0.02])  # rad/s
    out = None
    for k in range(40):
        t = k * 0.5
        R = cv2.Rodrigues(w * t)[0]
        pos = np.array([0.0, 0.0, 1.0 + 0.01 * t])
        if k == 25:  # outlier: 12 cm range error and 20 deg attitude error
            pos = pos + np.array([0.02, -0.03, 0.12])
            R = cv2.Rodrigues(np.array([0.35, 0.0, 0.0]))[0] @ R
        out = est.update(t, R, pos)
        if k in (25, 26):
            assert out["outlier_rejected"]
            assert abs(out["range_filtered_m"] - (1.0 + 0.01 * t)) < 0.01
            assert out["speed_filtered_mps"] < 0.03
            assert out["tumbling_rate_filtered_dps"] < 6.0
    assert abs(out["speed_filtered_mps"] - 0.01) < 0.005
    assert abs(out["tumbling_rate_filtered_dps"] - np.degrees(np.linalg.norm(w))) < 0.5
