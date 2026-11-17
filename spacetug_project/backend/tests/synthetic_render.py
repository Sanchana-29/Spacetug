"""
Minimal software renderer of satellite.glb (OpenCV painter's algorithm) used by the
tests and the evaluation script. It produces images with an EXACTLY known pose, so
feature-based pose results can be compared with ground truth without the browser.

Faces get a stable pseudo-random albedo (simulating panel texture / MLI patches)
and Lambert shading from a sun direction, on a black space background.
"""
import math

import cv2
import numpy as np

from cv.features import load_mesh


def look_at_pose(distance, yaw_deg, pitch_deg, roll_deg=0.0, offset=(0.0, 0.0)):
    """Object->camera (OpenCV) pose: camera looks at the object origin from `distance` m."""
    y, p, r = (math.radians(a) for a in (yaw_deg, pitch_deg, roll_deg))
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    Rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    Rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
    R = Rz @ Rx @ Ry
    t = np.array([offset[0], offset[1], distance], dtype=np.float64)
    return R, t


def intrinsics(width, height, vfov_deg=60.0):
    fy = height / (2.0 * math.tan(math.radians(vfov_deg) / 2.0))
    return np.array([[fy, 0, width / 2.0], [0, fy, height / 2.0], [0, 0, 1.0]])


_face_albedo = None


def render(R, t, K, width, height, sun_dir=(0.4, -0.6, 0.7)):
    global _face_albedo
    mesh = load_mesh()
    V = mesh.vertices
    F = mesh.faces
    if _face_albedo is None:
        rng = np.random.default_rng(1234)
        _face_albedo = rng.uniform(0.35, 1.0, size=(len(F), 3))

    Vc = (R @ V.T).T + t
    z = Vc[:, 2]
    uv = (K @ Vc.T).T
    uv = uv[:, :2] / np.maximum(uv[:, 2:3], 1e-6)

    n = mesh.face_normals @ R.T
    sun = np.asarray(sun_dir, dtype=float)
    sun /= np.linalg.norm(sun)
    shade = 0.15 + 0.85 * np.clip(np.abs(n @ (-sun)), 0, 1)

    depth = z[F].mean(axis=1)
    valid = (z[F] > 0.05).all(axis=1)
    order = np.argsort(-depth)
    img = np.zeros((height, width, 3), dtype=np.uint8)
    for fi in order:
        if not valid[fi]:
            continue
        pts = np.round(uv[F[fi]] * 16).astype(np.int32)  # sub-pixel precision (shift=4)
        color = (_face_albedo[fi] * shade[fi] * 255).astype(int).tolist()
        cv2.fillConvexPoly(img, pts, color, lineType=cv2.LINE_AA, shift=4)
    return img


def gt_dict(R, t):
    return {"position": {"x": float(t[0]), "y": float(t[1]), "z": float(t[2])},
            "rotation_matrix": R.tolist()}
