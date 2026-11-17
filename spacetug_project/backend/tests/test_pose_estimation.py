"""
Unit tests for the 6-DoF pose pipeline (Phase 1).

The helpers below reproduce EXACTLY what the frontend does in
frontend/src/utils/poseGeometry.js with Three.js:
  - target group: position p, rotation R_obj, uniform scale 0.08
  - PerspectiveCamera(fov = vertical FOV, aspect = W/H), oriented with lookAt()
  - Vector3.project(camera) -> NDC -> pixels (v measured from the top)
  - ground truth: R_cv = C * R_three, t_cv = C * t_three, C = diag(1, -1, -1)
So if these tests pass, frontend projection + backend solvePnP + ground-truth
conversion are mutually consistent.
"""
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from cv.pose_estimation import (  # noqa: E402
    LANDMARKS_3D,
    LANDMARK_SCALE,
    estimate_pose,
    build_camera_matrix,
    compute_geodesic_rotation_error,
)

C = np.diag([1.0, -1.0, -1.0])
W, H, VFOV = 1600, 900, 60.0


def rot_from_euler_xyz(rx, ry, rz):
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rx @ Ry @ Rz  # Three.js Euler order "XYZ"


def three_look_at(cam_pos, target, up=(0.0, 1.0, 0.0)):
    """Camera world rotation as produced by Object3D.lookAt for a camera (-Z looks at target)."""
    z = cam_pos - target
    z /= np.linalg.norm(z)
    x = np.cross(np.array(up), z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.column_stack([x, y, z])


def make_scene(rng, distance):
    """Random target pose + camera looking at it from `distance` metres."""
    target_pos = rng.uniform(-5, 5, size=3)
    R_obj = rot_from_euler_xyz(*rng.uniform(-math.pi, math.pi, size=3))
    direction = rng.normal(size=3)
    direction /= np.linalg.norm(direction)
    cam_pos = target_pos + direction * distance
    # small pointing offset so the target is not exactly centred
    aim = target_pos + rng.uniform(-0.1, 0.1, size=3)
    R_cam = three_look_at(cam_pos, aim)
    return target_pos, R_obj, cam_pos, R_cam


def project_like_three(model_pts, target_pos, R_obj, cam_pos, R_cam):
    f = 1.0 / math.tan(math.radians(VFOV) / 2.0)
    aspect = W / H
    out = {}
    for lid, p in model_pts.items():
        world = R_obj @ (np.array(p) * LANDMARK_SCALE) + target_pos  # matrixWorld incl. scale
        pc = R_cam.T @ (world - cam_pos)                               # three camera space
        x_ndc = (f / aspect) * pc[0] / (-pc[2])
        y_ndc = f * pc[1] / (-pc[2])
        u = (x_ndc + 1.0) / 2.0 * W
        v = (1.0 - y_ndc) / 2.0 * H
        out[lid] = [u, v]
    return out


def ground_truth_like_three(target_pos, R_obj, cam_pos, R_cam):
    R3 = R_cam.T @ R_obj
    t3 = R_cam.T @ (target_pos - cam_pos)
    R_cv = C @ R3
    t_cv = C @ t3
    return {
        "position": {"x": float(t_cv[0]), "y": float(t_cv[1]), "z": float(t_cv[2])},
        "rotation_matrix": R_cv.tolist(),
    }


def intrinsics_like_three():
    fy = H / (2.0 * math.tan(math.radians(VFOV) / 2.0))
    return [[fy, 0.0, W / 2.0], [0.0, fy, H / 2.0], [0.0, 0.0, 1.0]]


@pytest.mark.parametrize("method", ["ITERATIVE", "EPNP", "SQPNP"])
def test_zero_noise_recovers_exact_pose(method):
    rng = np.random.default_rng(42)
    for _ in range(25):
        scene = make_scene(rng, distance=rng.uniform(2.0, 15.0))
        pts = project_like_three(LANDMARKS_3D, *scene)
        gt = ground_truth_like_three(*scene)
        res = estimate_pose(
            image_points=pts,
            image_size=[W, H],
            camera_matrix=intrinsics_like_three(),
            method=method,
            ground_truth=gt,
        )
        assert res["success"], res
        e = res["errors_vs_gt"]
        assert e["rotation_error_deg"] < 0.05, e
        assert e["translation_error_pct"] < 0.1, e
        assert res["reprojection_rmse_px"] < 0.05


def test_acceptance_with_noise_errors_grow_smoothly():
    """Phase 1 acceptance: sigma=0 -> <0.5 deg and <1 % of range; error grows with noise."""
    rng = np.random.default_rng(7)
    mean_rot = []
    for sigma in [0.0, 1.0, 2.0, 5.0]:
        rot_errs = []
        for _ in range(60):
            scene = make_scene(rng, distance=6.0)
            pts = project_like_three(LANDMARKS_3D, *scene)
            noisy = {k: [u + rng.normal(0, sigma), v + rng.normal(0, sigma)] for k, (u, v) in pts.items()}
            res = estimate_pose(
                image_points=noisy,
                image_size=[W, H],
                camera_matrix=intrinsics_like_three(),
                ground_truth=ground_truth_like_three(*scene),
            )
            assert res["success"]
            rot_errs.append(res["errors_vs_gt"]["rotation_error_deg"])
        mean_rot.append(float(np.median(rot_errs)))
    assert mean_rot[0] < 0.5
    assert mean_rot[0] <= mean_rot[1] <= mean_rot[2] <= mean_rot[3]


def test_vertical_fov_camera_matrix_matches_three():
    K = build_camera_matrix(W, H, VFOV, fov_mode="vertical")
    assert np.allclose(K, np.array(intrinsics_like_three()))


def test_fov_path_equals_explicit_camera_matrix():
    rng = np.random.default_rng(3)
    scene = make_scene(rng, distance=5.0)
    pts = project_like_three(LANDMARKS_3D, *scene)
    a = estimate_pose(image_points=pts, image_size=[W, H], fov_degrees=VFOV, fov_mode="vertical")
    b = estimate_pose(image_points=pts, image_size=[W, H], camera_matrix=intrinsics_like_three())
    assert np.allclose(a["rotation_vector"], b["rotation_vector"], atol=1e-4)


def test_fewer_than_four_points_fails_gracefully():
    pts = dict(list({k: [100.0, 100.0] for k in LANDMARKS_3D}.items())[:3])
    res = estimate_pose(image_points=pts, image_size=[W, H])
    assert res["success"] is False
    assert "four" in res["message"].lower()


def test_geodesic_error():
    R = rot_from_euler_xyz(0.1, 0.2, 0.3)
    R2 = R @ rot_from_euler_xyz(0, 0, math.radians(10))
    assert abs(compute_geodesic_rotation_error(R, R2) - 10.0) < 1e-6


def test_landmarks_json_and_frontend_copy_are_identical():
    data = json.loads((BACKEND_DIR / "cv" / "target_pose_landmarks.json").read_text())
    from_json = {l["id"]: [l["object_point_3d"][k] for k in "xyz"] for l in data["landmarks"]}
    assert from_json == LANDMARKS_3D
    assert data["scale_factor"] == LANDMARK_SCALE

    js = (BACKEND_DIR.parent / "frontend" / "src" / "utils" / "poseGeometry.js").read_text()
    block = js[js.index("TARGET_LANDMARKS_3D = {"): js.index("};", js.index("TARGET_LANDMARKS_3D = {"))]
    from_js = {
        m.group(1): [float(x) for x in m.group(2).split(",")]
        for m in re.finditer(r"(\w+):\s*\[([^\]]+)\]", block)
    }
    assert from_js == from_json


def test_landmarks_lie_on_glb_mesh():
    trimesh = pytest.importorskip("trimesh")
    glb = BACKEND_DIR.parent / "frontend" / "public" / "models" / "satellite.glb"
    if not glb.is_file():
        pytest.skip("satellite.glb not found")
    verts = trimesh.load(str(glb)).to_geometry().vertices
    for lid, p in LANDMARKS_3D.items():
        d = np.min(np.linalg.norm(verts - np.array(p), axis=1))
        assert d < 1e-3, f"{lid} is {d:.4f} units away from the mesh"
