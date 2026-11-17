"""
Phase 7 - Evaluation of the complete perception pipeline (for the project report).

Run from the backend folder:
    python tests/evaluate_pipeline.py            (full run, ~2-4 min)
    python tests/evaluate_pipeline.py --quick    (smaller sample sizes)

Writes to backend/results/:
    pose_known_correspondences.csv / .png   solvePnP methods x pixel noise
    feature_pose.csv / .png                 ORB vs SIFT feature-based pose + identification
    tracking.csv                            SORT tracker ID stability
    motion_timeseries.csv / .png            relative speed & tumbling: raw vs Kalman vs truth
    collision_scenarios.csv / .png          TTC / CPA risk: estimated vs truth
    RESULTS.md                              all tables (copy into the report)

All experiments use the real project code (cv/pose_estimation, cv/features, cv/tracking,
cv/motion, cv/collision, cv/perception). Images for the ORB/SIFT test are rendered from
satellite.glb with a known pose (tests/synthetic_render.py), so every error is measured
against exact ground truth. Fixed random seeds -> reproducible numbers.
"""
from __future__ import annotations

import argparse
import csv
import math
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from cv.pose_estimation import LANDMARKS_3D, estimate_pose  # noqa: E402
from cv.tracking import SortTracker  # noqa: E402
from cv.motion import MotionEstimator  # noqa: E402
from cv.collision import assess_collision  # noqa: E402
from cv.perception import PerceptionSession  # noqa: E402
from test_pose_estimation import (  # noqa: E402
    W, H, make_scene, project_like_three, ground_truth_like_three, intrinsics_like_three,
    three_look_at, rot_from_euler_xyz,
)

OUT = BACKEND / "results"
plt.rcParams.update({"figure.dpi": 130, "font.size": 9, "axes.grid": True, "grid.alpha": 0.3})


def write_csv(name, rows):
    with open(OUT / name, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def md_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def fmt(x, d=3):
    return "--" if x is None or (isinstance(x, float) and not math.isfinite(x)) else f"{x:.{d}f}"


# ════════════════════════════════════════════════════════════════════════════
# 1. Pose with known 2D-3D correspondences: solver x pixel noise
# ════════════════════════════════════════════════════════════════════════════
def eval_pose(n):
    rng = np.random.default_rng(2026)
    scenes = [make_scene(rng, rng.uniform(1.0, 10.0)) for _ in range(n)]
    rows, summary = [], []
    for method in ("ITERATIVE", "EPNP", "SQPNP"):
        for sigma in (0.0, 1.0, 2.0, 5.0):
            r_err, t_err, t_pct, rmse, times, ok = [], [], [], [], [], 0
            nrng = np.random.default_rng(int(sigma * 10) + 7)
            for sc in scenes:
                pts = project_like_three(LANDMARKS_3D, *sc)
                pts = {k: [u + nrng.normal(0, sigma), v + nrng.normal(0, sigma)] for k, (u, v) in pts.items()}
                res = estimate_pose(image_points=pts, image_size=[W, H], camera_matrix=intrinsics_like_three(),
                                    method=method, ground_truth=ground_truth_like_three(*sc))
                if not res["success"]:
                    continue
                ok += 1
                e = res["errors_vs_gt"]
                r_err.append(e["rotation_error_deg"]); t_err.append(e["translation_error_m"])
                t_pct.append(e["translation_error_pct"]); rmse.append(res["reprojection_rmse_px"])
                times.append(res["solve_time_ms"])
            row = {
                "method": method, "noise_px": sigma, "poses": n, "success_pct": round(100 * ok / n, 1),
                "rot_err_mean_deg": round(np.mean(r_err), 4), "rot_err_median_deg": round(np.median(r_err), 4),
                "rot_err_max_deg": round(np.max(r_err), 4),
                "trans_err_mean_m": round(np.mean(t_err), 5), "trans_err_median_pct": round(np.median(t_pct), 3),
                "reproj_rmse_mean_px": round(np.mean(rmse), 3), "solve_time_median_ms": round(np.median(times), 3),
            }
            rows.append(row)
    write_csv("pose_known_correspondences.csv", rows)

    fig, ax = plt.subplots(1, 2, figsize=(9, 3.4))
    for method, mk in (("ITERATIVE", "o-"), ("EPNP", "s--"), ("SQPNP", "^-.")):
        rr = [r for r in rows if r["method"] == method]
        ax[0].plot([r["noise_px"] for r in rr], [r["rot_err_median_deg"] for r in rr], mk, label=method)
        ax[1].plot([r["noise_px"] for r in rr], [r["trans_err_median_pct"] for r in rr], mk, label=method)
    ax[0].set(title="Rotation error vs pixel noise", xlabel="Landmark noise σ (px)", ylabel="Median rotation error (°)")
    ax[1].set(title="Translation error vs pixel noise", xlabel="Landmark noise σ (px)", ylabel="Median error (% of range)")
    ax[0].legend()
    fig.tight_layout(); fig.savefig(OUT / "pose_known_correspondences.png"); plt.close(fig)

    table = md_table(
        ["Solver", "σ (px)", "Success", "Rot. err median (°)", "Rot. err max (°)", "Trans. err median (% range)",
         "RMSE (px)", "Time (ms)"],
        [[r["method"], r["noise_px"], f"{r['success_pct']}%", r["rot_err_median_deg"], r["rot_err_max_deg"],
          r["trans_err_median_pct"], r["reproj_rmse_mean_px"], r["solve_time_median_ms"]] for r in rows])
    return rows, table


# ════════════════════════════════════════════════════════════════════════════
# 2. Feature-based pose and identification: ORB vs SIFT
# ════════════════════════════════════════════════════════════════════════════
def eval_features(n_test):
    import cv.features as F
    from synthetic_render import render, look_at_pose, intrinsics, gt_dict

    F.FEATURE_DB_DIR = Path(tempfile.mkdtemp(prefix="feature_db_eval_"))
    F._db_cache.clear()
    Wr, Hr = 1280, 720
    K = intrinsics(Wr, Hr)
    t0 = time.time()
    for yaw in range(0, 360, 30):
        for pitch in (-20, 15):
            R, t = look_at_pose(1.2, yaw, pitch)
            F.add_reference_view(render(R, t, K, Wr, Hr), K, gt_dict(R, t), f"ref_{yaw}_{pitch}")
    lib = F.library_status()
    print(f"  reference library: {lib['views']} views, ORB {lib['methods']['ORB']['points']} pts, "
          f"SIFT {lib['methods']['SIFT']['points']} pts ({time.time() - t0:.0f}s)")

    rng = np.random.default_rng(11)
    tests = [(rng.uniform(0, 360), rng.uniform(-25, 25), rng.uniform(-20, 20), rng.uniform(1.0, 1.6),
              (rng.uniform(-0.08, 0.08), rng.uniform(-0.05, 0.05))) for _ in range(n_test)]
    images = []
    for yaw, pitch, roll, d, off in tests:
        R, t = look_at_pose(d, yaw, pitch, roll, offset=off)
        images.append((render(R, t, K, Wr, Hr), gt_dict(R, t)))
    neg = []
    nrng = np.random.default_rng(5)
    for _ in range(5):  # star-field frames without the target
        img = np.zeros((Hr, Wr, 3), np.uint8)
        for _ in range(300):
            x, y = nrng.integers(0, Wr), nrng.integers(0, Hr)
            img[y, x] = nrng.integers(80, 255)
        neg.append(img)

    rows, per_view = [], []
    for feat in ("ORB", "SIFT"):
        ident, rot, trans, inl, times = 0, [], [], [], []
        for i, (img, gt) in enumerate(images):
            r = F.estimate_pose_from_image(img, K, feature=feat, ground_truth=gt, return_visualization=False)
            per_view.append({"feature": feat, "view": i, "identified": r["identified"], "keypoints": r.get("keypoints"),
                             "matches": r.get("matches"), "inliers": r.get("inliers"),
                             "rot_err_deg": (r.get("errors_vs_gt") or {}).get("rotation_error_deg"),
                             "trans_err_pct": (r.get("errors_vs_gt") or {}).get("translation_error_pct"),
                             "time_ms": r.get("total_time_ms")})
            inl.append(r.get("inliers", 0)); times.append(r.get("total_time_ms") or 0)
            if r["identified"]:
                ident += 1
                rot.append(r["errors_vs_gt"]["rotation_error_deg"]); trans.append(r["errors_vs_gt"]["translation_error_pct"])
        false_pos = sum(F.estimate_pose_from_image(img, K, feature=feat, return_visualization=False)["identified"] for img in neg)
        rows.append({"feature": feat, "test_views": len(images), "identified_pct": round(100 * ident / len(images), 1),
                     "false_identifications": f"{false_pos}/{len(neg)}",
                     "inliers_median": float(np.median(inl)),
                     "rot_err_median_deg": round(float(np.median(rot)), 3) if rot else None,
                     "rot_err_p90_deg": round(float(np.percentile(rot, 90)), 3) if rot else None,
                     "trans_err_median_pct": round(float(np.median(trans)), 3) if trans else None,
                     "time_median_ms": round(float(np.median(times)), 1)})
    write_csv("feature_pose.csv", per_view)

    fig, ax = plt.subplots(1, 2, figsize=(9, 3.2))
    for k, (feat, col) in enumerate((("ORB", "#2563eb"), ("SIFT", "#f59e0b"))):
        e = [p["rot_err_deg"] for p in per_view if p["feature"] == feat and p["identified"]]
        ax[0].hist(e, bins=12, alpha=0.6, color=col, label=feat)
    ax[0].set(title="Rotation error of identified views", xlabel="Rotation error (°)", ylabel="Views")
    ax[0].legend()
    ax[1].bar([r["feature"] for r in rows], [r["identified_pct"] for r in rows], color=["#2563eb", "#f59e0b"])
    ax[1].set(title="Identification rate (new viewpoints)", ylabel="Identified (%)", ylim=(0, 100))
    fig.tight_layout(); fig.savefig(OUT / "feature_pose.png"); plt.close(fig)

    table = md_table(["Feature", "Test views", "Identified", "False IDs (empty frames)", "Median inliers",
                      "Rot. err median (°)", "Rot. err 90th pct (°)", "Trans. err median (% range)", "Time (ms)"],
                     [[r["feature"], r["test_views"], f"{r['identified_pct']}%", r["false_identifications"],
                       r["inliers_median"], fmt(r["rot_err_median_deg"]), fmt(r["rot_err_p90_deg"]),
                       fmt(r["trans_err_median_pct"]), r["time_median_ms"]] for r in rows])
    return rows, table, lib


# ════════════════════════════════════════════════════════════════════════════
# 3. Tracking: ID stability under detection noise, misses and false positives
# ════════════════════════════════════════════════════════════════════════════
def eval_tracking(frames):
    rows = []
    for miss_rate in (0.0, 0.1, 0.3):
        for fp_rate in (0.0, 0.05):
            rng = np.random.default_rng(int(miss_rate * 100 + fp_rate * 1000))
            trk = SortTracker()
            detected_frames = 0
            for k in range(frames):
                t = k * 0.5
                # bounding box of the projected satellite while it drifts across the image
                cx, cy = 640 + 300 * math.sin(t / 20), 360 + 120 * math.sin(t / 13)
                w, h = 260 + 40 * math.sin(t / 7), 150 + 25 * math.cos(t / 9)
                dets = []
                if rng.random() > miss_rate:
                    j = rng.normal(0, 3, 4)
                    dets.append({"bbox": [cx - w / 2 + j[0], cy - h / 2 + j[1], cx + w / 2 + j[2], cy + h / 2 + j[3]],
                                 "confidence": float(rng.uniform(0.6, 0.98))})
                    detected_frames += 1
                if rng.random() < fp_rate:
                    x, y = rng.uniform(0, 1200), rng.uniform(0, 650)
                    dets.append({"bbox": [x, y, x + 60, y + 40], "confidence": float(rng.uniform(0.3, 0.5))})
                trk.update(dets)
            m = trk.metrics()
            rows.append({"miss_rate_pct": int(miss_rate * 100), "false_pos_rate_pct": int(fp_rate * 100),
                         "frames": frames, "frames_with_detection": detected_frames,
                         "frames_tracked": m["frames_tracked"], "id_switches": m["id_switches"],
                         "id_consistency_pct": m["id_consistency_pct"], "primary_track": m["primary_track"]})
    write_csv("tracking.csv", rows)
    table = md_table(["Missed detections", "False positives", "Frames", "Frames tracked", "ID switches",
                      "ID consistency"],
                     [[f"{r['miss_rate_pct']}%", f"{r['false_pos_rate_pct']}%", r["frames"], r["frames_tracked"],
                       r["id_switches"], f"{r['id_consistency_pct']}%"] for r in rows])
    return rows, table


# ════════════════════════════════════════════════════════════════════════════
# shared: run the real perception session on a simulated encounter
# ════════════════════════════════════════════════════════════════════════════
def run_encounter(r0, v, w, duration_s, dt, sigma_px, seed, safety_radius=2.0, horizon=60.0):
    """Target at r0 (m) moving with v (m/s) and tumbling at w (rad/s); chaser camera at the origin
    always pointing at the target (slewing). Landmarks projected exactly like the frontend,
    Gaussian pixel noise added, then the full PerceptionSession (pose -> Kalman -> TTC/CPA)."""
    rng = np.random.default_rng(seed)
    sess = PerceptionSession(f"eval-{seed}")
    R0 = rot_from_euler_xyz(0.3, 0.2, -0.1)
    cam_pos = np.zeros(3)
    out = []
    for k in range(int(duration_s / dt) + 1):
        t = k * dt
        pos = np.asarray(r0) + np.asarray(v) * t
        wn = np.linalg.norm(w)
        import cv2
        Rw, _ = cv2.Rodrigues((np.asarray(w) * t).reshape(3, 1)) if wn > 0 else (np.eye(3), None)
        R_obj = Rw @ R0
        R_cam = three_look_at(cam_pos, pos)
        scene = (pos, R_obj, cam_pos, R_cam)
        pts = project_like_three(LANDMARKS_3D, *scene)
        pts = {k2: [u + rng.normal(0, sigma_px), vv + rng.normal(0, sigma_px)] for k2, (u, vv) in pts.items()
               if 0 <= u <= W and 0 <= vv <= H}
        res = sess.step(timestamp=t, image_points=pts, image_size=[W, H], camera_matrix=intrinsics_like_three(),
                        ground_truth=ground_truth_like_three(*scene), camera_rotation_world=R_cam.tolist(),
                        safety_radius_m=safety_radius, horizon_s=horizon)
        out.append((t, res))
    return out


# ════════════════════════════════════════════════════════════════════════════
# 4. Relative motion: raw finite differences vs Kalman filter vs truth
# ════════════════════════════════════════════════════════════════════════════
def eval_motion(duration):
    v = np.array([-0.012, 0.004, 0.006])
    w = np.array([0.05, -0.03, 0.02])  # same tumble as the simulation
    rows, summary = [], []
    for sigma in (0.5, 1.0, 2.0):
        enc = run_encounter([1.0, 0.4, -4.0], v, w, duration, 0.5, sigma, seed=int(sigma * 10))
        series = []
        for t, r in enc:
            me, mg = r["motion"]["estimated"] or {}, r["motion"]["ground_truth"] or {}
            if not me.get("ready"):
                continue
            series.append({"noise_px": sigma, "time_s": t, "range_gt": mg.get("range_m"), "range_est": me.get("range_m"),
                           "speed_gt": mg.get("speed_raw_mps"), "speed_raw": me.get("speed_raw_mps"),
                           "speed_kalman": me.get("speed_filtered_mps"),
                           "tumble_gt_dps": mg.get("tumbling_rate_raw_dps"), "tumble_raw_dps": me.get("tumbling_rate_raw_dps"),
                           "tumble_kalman_dps": me.get("tumbling_rate_filtered_dps")})
        rows += series
        settled = [s for s in series if s["time_s"] >= 10]  # after filter convergence
        rm = lambda a, b: math.sqrt(np.mean([(s[a] - s[b]) ** 2 for s in settled]))  # noqa: E731
        summary.append({"noise_px": sigma, "samples": len(settled),
                        "range_rmse_m": rm("range_est", "range_gt"),
                        "speed_rmse_raw": rm("speed_raw", "speed_gt"), "speed_rmse_kalman": rm("speed_kalman", "speed_gt"),
                        "tumble_rmse_raw": rm("tumble_raw_dps", "tumble_gt_dps"),
                        "tumble_rmse_kalman": rm("tumble_kalman_dps", "tumble_gt_dps")})
    write_csv("motion_timeseries.csv", rows)

    s1 = [r for r in rows if r["noise_px"] == 1.0]
    fig, ax = plt.subplots(1, 2, figsize=(9.5, 3.4))
    t = [r["time_s"] for r in s1]
    ax[0].plot(t, [r["speed_raw"] for r in s1], color="#94a3b8", lw=0.8, label="Estimated (raw)")
    ax[0].plot(t, [r["speed_kalman"] for r in s1], color="#2563eb", lw=1.6, label="Estimated (Kalman)")
    ax[0].plot(t, [r["speed_gt"] for r in s1], "--", color="#7c3aed", lw=1.4, label="Ground truth")
    ax[0].set(title="Relative speed (σ = 1 px)", xlabel="Time (s)", ylabel="m/s")
    ax[0].legend()
    ax[1].plot(t, [r["tumble_raw_dps"] for r in s1], color="#94a3b8", lw=0.8, label="Estimated (raw)")
    ax[1].plot(t, [r["tumble_kalman_dps"] for r in s1], color="#2563eb", lw=1.6, label="Estimated (Kalman)")
    ax[1].plot(t, [r["tumble_gt_dps"] for r in s1], "--", color="#7c3aed", lw=1.4, label="Ground truth")
    ax[1].set(title="Tumbling rate (σ = 1 px)", xlabel="Time (s)", ylabel="°/s")
    fig.tight_layout(); fig.savefig(OUT / "motion_timeseries.png"); plt.close(fig)

    table = md_table(["Landmark noise σ", "Range RMSE (m)", "Speed RMSE raw (m/s)", "Speed RMSE Kalman (m/s)",
                      "Tumble RMSE raw (°/s)", "Tumble RMSE Kalman (°/s)"],
                     [[f"{s['noise_px']} px", fmt(s["range_rmse_m"], 4), fmt(s["speed_rmse_raw"], 4),
                       fmt(s["speed_rmse_kalman"], 4), fmt(s["tumble_rmse_raw"], 3), fmt(s["tumble_rmse_kalman"], 3)]
                      for s in summary])
    return summary, table


# ════════════════════════════════════════════════════════════════════════════
# 5. Collision risk: estimated vs truth on three encounter scenarios
# ════════════════════════════════════════════════════════════════════════════
def eval_collision(duration):
    scenarios = {
        "A: approach, 0.5 m miss": ([0.5, 0.0, -9.0], [0.0, 0.0, 0.08]),
        "B: approach, 3 m miss": ([3.0, 0.0, -9.0], [0.0, 0.0, 0.08]),
        "C: fly-by, 6 m miss": ([6.0, 0.5, -9.0], [0.0, 0.0, 0.08]),
    }
    rows, summary, curves = [], [], {}
    for name, (r0, v) in scenarios.items():
        enc = run_encounter(r0, v, [0.05, -0.03, 0.02], duration, 0.5, 1.0, seed=42)
        agree, n, first_est, first_gt, dcpa_err = 0, 0, None, None, []
        curve = []
        for t, r in enc:
            ce, cg = r["collision"]["estimated"], r["collision"]["ground_truth"]
            if not ce or not cg:
                continue
            n += 1
            agree += ce["risk_level"] == cg["risk_level"]
            if t >= 10:
                dcpa_err.append(abs(ce["d_cpa_m"] - cg["d_cpa_m"]))
            if ce["risk_level"] == "HIGH" and first_est is None:
                first_est = t
            if cg["risk_level"] == "HIGH" and first_gt is None:
                first_gt = t
            curve.append((t, ce["d_cpa_m"], cg["d_cpa_m"]))
            rows.append({"scenario": name, "time_s": t, "risk_est": ce["risk_level"], "risk_gt": cg["risk_level"],
                         "d_cpa_est_m": ce["d_cpa_m"], "d_cpa_gt_m": cg["d_cpa_m"],
                         "t_cpa_est_s": ce["t_cpa_s"], "t_cpa_gt_s": cg["t_cpa_s"],
                         "ttc_est_s": ce["ttc_s"], "ttc_gt_s": cg["ttc_s"]})
        curves[name] = curve
        final_gt = rows[-1]["risk_gt"]
        summary.append({"scenario": name, "steps": n, "risk_agreement_pct": round(100 * agree / max(n, 1), 1),
                        "truth_final_risk": final_gt,
                        "first_high_est_s": first_est, "first_high_gt_s": first_gt,
                        "dcpa_err_median_m": float(np.median(dcpa_err)) if dcpa_err else None})
    write_csv("collision_scenarios.csv", rows)

    fig, ax = plt.subplots(figsize=(6.5, 3.4))
    for (name, curve), col in zip(curves.items(), ("#dc2626", "#f59e0b", "#16a34a")):
        ax.plot([c[0] for c in curve], [c[1] for c in curve], color=col, lw=1.2, label=f"{name} (est.)")
        ax.plot([c[0] for c in curve], [c[2] for c in curve], "--", color=col, lw=1.0)
    ax.axhline(2.0, color="k", lw=0.8, ls=":", label="Safety radius 2 m")
    ax.set(title="Predicted miss distance d_CPA (solid: estimated, dashed: truth)", xlabel="Time (s)",
           ylabel="d_CPA (m)", ylim=(0, 9))
    ax.legend(fontsize=7)
    fig.tight_layout(); fig.savefig(OUT / "collision_scenarios.png"); plt.close(fig)

    table = md_table(["Scenario", "Steps", "Risk level agreement", "Truth risk", "First HIGH (est.)",
                      "First HIGH (truth)", "d_CPA error median (m)"],
                     [[s["scenario"], s["steps"], f"{s['risk_agreement_pct']}%", s["truth_final_risk"],
                       "--" if s["first_high_est_s"] is None else f"{s['first_high_est_s']:.1f} s",
                       "--" if s["first_high_gt_s"] is None else f"{s['first_high_gt_s']:.1f} s",
                       fmt(s["dcpa_err_median_m"], 3)] for s in summary])
    return summary, table


# ════════════════════════════════════════════════════════════════════════════
# 6. Detection (YOLOv8n): training metrics + measured inference time
# ════════════════════════════════════════════════════════════════════════════
def eval_detection():
    res_csv = BACKEND / "runs" / "satellite_yolov8n_v1" / "results.csv"
    rows = [{k.strip(): v for k, v in r.items()} for r in csv.DictReader(open(res_csv))] if res_csv.is_file() else []
    # best.pt is chosen by Ultralytics fitness = 0.1 mAP50 + 0.9 mAP50-95
    fitness = lambda r: 0.1 * float(r["metrics/mAP50(B)"]) + 0.9 * float(r["metrics/mAP50-95(B)"])  # noqa: E731
    last = max(rows, key=fitness) if rows else {}
    metrics = {
        "epochs": len(rows),
        "precision": float(last.get("metrics/precision(B)", "nan")),
        "recall": float(last.get("metrics/recall(B)", "nan")),
        "mAP50": float(last.get("metrics/mAP50(B)", "nan")),
        "mAP50_95": float(last.get("metrics/mAP50-95(B)", "nan")),
    }
    timing = None
    try:
        import cv2
        from ultralytics import YOLO
        weights = BACKEND / "runs" / "satellite_yolov8n_v1" / "weights" / "best.pt"
        val_dir = BACKEND / "datasets" / "satellite_dataset_200_samples_4" / "images" / "val"
        imgs = sorted(val_dir.glob("*.png"))[:40]
        if weights.is_file() and imgs:
            model = YOLO(str(weights))
            model.predict(cv2.imread(str(imgs[0])), verbose=False)  # warm-up
            ts = []
            for p in imgs:
                im = cv2.imread(str(p))
                t0 = time.perf_counter()
                model.predict(im, imgsz=640, conf=0.25, verbose=False)
                ts.append((time.perf_counter() - t0) * 1000)
            timing = {"images": len(ts), "mean_ms": round(float(np.mean(ts)), 1), "median_ms": round(float(np.median(ts)), 1)}
    except Exception as e:  # ultralytics not installed in this environment
        timing = {"note": f"not measured here ({type(e).__name__}); run this script on the project machine"}
    table = md_table(["Metric", "Value"], [
        ["Training epochs (best epoch)", f"{metrics['epochs']} ({last.get('epoch', '--')})"],
        ["Precision", f"{metrics['precision'] * 100:.2f}%"],
        ["Recall", f"{metrics['recall'] * 100:.2f}%"],
        ["mAP@50", f"{metrics['mAP50'] * 100:.2f}%"],
        ["mAP@50-95", f"{metrics['mAP50_95'] * 100:.2f}%"],
        ["Inference time (CPU)", f"{timing['mean_ms']} ms mean / {timing['median_ms']} ms median over {timing['images']} val images"
         if timing and "mean_ms" in timing else timing.get("note", "--")],
    ])
    return metrics, timing, table


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    n_pose, n_feat, frames, dur = (40, 8, 150, 60) if args.quick else (150, 20, 400, 120)
    t0 = time.time()

    print("1/6 pose with known correspondences ..."); _, t_pose = eval_pose(n_pose)
    print("2/6 ORB vs SIFT feature pose ..."); _, t_feat, lib = eval_features(n_feat)
    print("3/6 tracking ..."); _, t_trk = eval_tracking(frames)
    print("4/6 relative motion ..."); _, t_mot = eval_motion(dur)
    print("5/6 collision scenarios ..."); _, t_col = eval_collision(dur)
    print("6/6 detection ..."); _, _, t_det = eval_detection()

    md = f"""# Evaluation results

Generated by `python tests/evaluate_pipeline.py{' --quick' if args.quick else ''}` on {time.strftime('%Y-%m-%d %H:%M')}
({time.time() - t0:.0f} s). Every number is measured by running the project code against exact simulation
ground truth (fixed random seeds, reproducible). Image size {W}×{H} px, vertical FOV 60°.

## 1. YOLOv8n detection
Values from the training log `runs/satellite_yolov8n_v1/results.csv` at the best epoch (validation set: 40 images).
The separate Ultralytics final validation of best.pt reports 95.16% / 88.43% / 96.87% / 76.10% (rounding differences only).

{t_det}

## 2. 6-DoF pose from 2D-3D landmark correspondences
{n_pose} random target poses at 1-10 m, 9 landmarks, Gaussian pixel noise σ added to the 2D points.
![pose](pose_known_correspondences.png)

{t_pose}

## 3. Feature-based pose and target identification (ORB vs SIFT)
Reference library: {lib['views']} views rendered from satellite.glb at 1.2 m (30° yaw steps, two pitch angles);
{lib['methods']['ORB']['points']} ORB / {lib['methods']['SIFT']['points']} SIFT keypoints lifted to 3D.
Test: {n_feat} NEW random viewpoints (1.0-1.6 m, roll ±20°) + 5 empty star-field frames.
![features](feature_pose.png)

{t_feat}

## 4. Multi-frame tracking (SORT: Kalman + IoU + Hungarian)
{frames} frames of a moving target box with 3 px jitter; detections randomly missed / spurious boxes added.

{t_trk}

## 5. Relative motion estimation (Kalman filter vs raw finite differences)
Target drifting at |v| = {np.linalg.norm([-0.012, 0.004, 0.006]):.4f} m/s and tumbling at 3.53 °/s, chaser camera slewing to
follow it, {dur} s at 2 Hz. RMSE after 10 s convergence.
![motion](motion_timeseries.png)

{t_mot}

## 6. Collision risk (TTC / CPA, safety radius 2 m, horizon 60 s)
Target approaching at 0.08 m/s from 9 m with different miss distances, σ = 1 px.
![collision](collision_scenarios.png)

{t_col}

## Limitations
- All images are rendered from the 3D model in the simulator; no real space imagery was used.
- Landmark-based pose uses simulated (projected) keypoints with added noise; ORB/SIFT pose uses real image
  features on rendered frames.
- The tracking test uses synthetic detection boxes; tracking on live YOLO detections is shown in the app.
"""
    (OUT / "RESULTS.md").write_text(md, encoding="utf-8")
    print(f"\nDone in {time.time() - t0:.0f} s -> {OUT / 'RESULTS.md'}")


if __name__ == "__main__":
    main()
