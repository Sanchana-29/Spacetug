"""
Phase 2 - Feature extraction, target identification and feature-based 6-DoF pose.

Pipeline
--------
1. Reference library (offline / "teach" step)
   A captured sensor frame whose ground-truth pose is known (from the simulation)
   is added as a reference view. ORB and SIFT keypoints are detected on it and each
   keypoint is LIFTED to a 3D point on the spacecraft: a face-ID visibility buffer of
   satellite.glb is rendered for the known pose, and the pixel ray is intersected with
   the triangle seen at that pixel (exact, occlusion-aware). Only keypoints that hit the mesh are kept,
   so background (Earth, stars) features are discarded automatically.
   Stored per method in backend/data/feature_db/{orb,sift}.npz.

2. Query (online)
   Keypoints are detected on a new frame (optionally only inside the YOLO bbox),
   matched to the reference descriptors (BFMatcher + Lowe ratio test), giving
   2D-3D correspondences -> cv2.solvePnPRansac -> LM refinement on the inliers.

3. Target identification
   "SAT-001 identified" only if enough RANSAC inliers AND a high enough inlier
   ratio (similarity threshold). Otherwise "not matched".

No result is invented: if there are not enough matches the call reports failure.
"""
from __future__ import annotations

import base64
import json
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

import cv2
import numpy as np

from cv.pose_estimation import (
    LANDMARK_SCALE,
    compute_geodesic_rotation_error,
    rotation_matrix_to_euler,
    rotation_matrix_to_quaternion,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
FEATURE_DB_DIR = BACKEND_DIR / "data" / "feature_db"
GLB_CANDIDATES = [
    BACKEND_DIR.parent / "frontend" / "public" / "models" / "satellite.glb",
    BACKEND_DIR / "models" / "satellite.glb",
]

METHODS = ("ORB", "SIFT")
DEFAULT_RATIO_TEST = 0.75
DEFAULT_MIN_INLIERS = 15
DEFAULT_MIN_INLIER_RATIO = 0.40
MAX_REFERENCE_VIEWS = 200

_lock = threading.Lock()
_mesh = None
_db_cache: Dict[str, dict] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _create_detector(method: str):
    m = method.upper()
    if m == "ORB":
        return cv2.ORB_create(nfeatures=1500, scaleFactor=1.2, nlevels=8, fastThreshold=10)
    if m == "SIFT":
        if not hasattr(cv2, "SIFT_create"):
            raise RuntimeError("cv2.SIFT_create not available (need OpenCV >= 4.4)")
        return cv2.SIFT_create(nfeatures=1500)
    raise ValueError(f"Unsupported feature method '{method}'. Use ORB or SIFT.")


def _norm_type(method: str) -> int:
    return cv2.NORM_HAMMING if method.upper() == "ORB" else cv2.NORM_L2


def decode_image(image) -> np.ndarray:
    """Accepts a data-URL / base64 string or raw bytes. Returns a BGR image."""
    if isinstance(image, str):
        if "," in image and image.strip().startswith("data:"):
            image = image.split(",", 1)[1]
        raw = base64.b64decode(image)
    else:
        raw = image
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    return img


def _to_gray(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    # mild contrast normalisation helps both ORB and SIFT on dark space scenes
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _bbox_mask(shape, bbox: Optional[List[float]], margin: float = 0.15) -> Optional[np.ndarray]:
    if not bbox or len(bbox) != 4:
        return None
    h, w = shape[:2]
    x1, y1, x2, y2 = [float(v) for v in bbox]
    mx, my = (x2 - x1) * margin, (y2 - y1) * margin
    x1, y1 = max(0, int(x1 - mx)), max(0, int(y1 - my))
    x2, y2 = min(w, int(x2 + mx)), min(h, int(y2 + my))
    if x2 <= x1 or y2 <= y1:
        return None
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[y1:y2, x1:x2] = 255
    return mask


def load_mesh():
    """Satellite mesh in the OpenCV OBJECT frame (metres) = glTF scene root * LANDMARK_SCALE."""
    global _mesh
    if _mesh is not None:
        return _mesh
    import trimesh  # local import: only needed for building the reference library

    glb = next((p for p in GLB_CANDIDATES if p.is_file()), None)
    if glb is None:
        raise FileNotFoundError("satellite.glb not found (expected frontend/public/models/satellite.glb)")
    scene = trimesh.load(str(glb))
    mesh = scene.to_geometry() if hasattr(scene, "to_geometry") else scene.dump(concatenate=True)
    mesh = mesh.copy()
    mesh.apply_scale(LANDMARK_SCALE)
    _mesh = mesh
    return _mesh


def render_face_id_buffer(K: np.ndarray, R: np.ndarray, t: np.ndarray, width: int, height: int) -> np.ndarray:
    """
    Visibility buffer: for every pixel, the index (+1) of the front-most mesh triangle
    seen with pose (R, t); 0 = background. Painter's algorithm, far -> near.
    """
    mesh = load_mesh()
    V, F_ = mesh.vertices, mesh.faces
    Vc = (R @ V.T).T + t.reshape(1, 3)
    z = Vc[:, 2]
    uv = (K @ Vc.T).T
    uv = uv[:, :2] / np.maximum(uv[:, 2:3], 1e-9)
    fz = z[F_]
    front = (fz > 1e-3).all(axis=1)
    tri = uv[F_]
    inside = ((tri[:, :, 0].max(1) >= 0) & (tri[:, :, 0].min(1) < width) &
              (tri[:, :, 1].max(1) >= 0) & (tri[:, :, 1].min(1) < height))
    cand = np.where(front & inside)[0]
    order = cand[np.argsort(-fz[cand].mean(axis=1))]
    buf = np.zeros((height, width, 3), dtype=np.uint8)
    pts_all = np.round(tri * 16).astype(np.int32)
    for fi in order:
        idx = int(fi) + 1
        cv2.fillConvexPoly(buf, pts_all[fi], (idx & 255, (idx >> 8) & 255, (idx >> 16) & 255),
                           lineType=cv2.LINE_8, shift=4)
    return buf[:, :, 0].astype(np.int64) | (buf[:, :, 1].astype(np.int64) << 8) | (buf[:, :, 2].astype(np.int64) << 16)


def lift_keypoints_to_3d(points_2d: np.ndarray, camera_matrix: np.ndarray,
                         R: np.ndarray, t: np.ndarray, image_size=None):
    """
    Back-project pixels onto the mesh. R, t: object -> OpenCV camera (ground truth).
    Uses a face-ID visibility buffer, then an exact ray/plane intersection with that triangle.
    Returns (object_points Nx3 in metres, index array of keypoints that hit the mesh).
    """
    mesh = load_mesh()
    if len(points_2d) == 0:
        return np.zeros((0, 3)), np.zeros((0,), dtype=int)
    if image_size is None:
        image_size = (int(round(camera_matrix[0, 2] * 2)), int(round(camera_matrix[1, 2] * 2)))
    w, h = int(image_size[0]), int(image_size[1])
    buf = render_face_id_buffer(camera_matrix, R, t, w, h)

    u = np.clip(np.round(points_2d[:, 0]).astype(int), 0, w - 1)
    v = np.clip(np.round(points_2d[:, 1]).astype(int), 0, h - 1)
    face = buf[v, u] - 1
    hit = np.where(face >= 0)[0]
    if len(hit) == 0:
        return np.zeros((0, 3)), np.zeros((0,), dtype=int)

    K_inv = np.linalg.inv(camera_matrix)
    pix = np.hstack([points_2d[hit], np.ones((len(hit), 1))])
    d_cam = (K_inv @ pix.T).T                       # ray directions (camera frame)
    tri = mesh.vertices[mesh.faces[face[hit]]]       # (N,3,3) object frame
    tri_cam = np.einsum("ij,nkj->nki", R, tri) + t.reshape(1, 1, 3)
    n = np.cross(tri_cam[:, 1] - tri_cam[:, 0], tri_cam[:, 2] - tri_cam[:, 0])
    denom = np.einsum("ij,ij->i", n, d_cam)
    ok = np.abs(denom) > 1e-12
    lam = np.zeros(len(hit))
    lam[ok] = np.einsum("ij,ij->i", n[ok], tri_cam[ok, 0]) / denom[ok]
    ok &= lam > 0
    X_cam = d_cam * lam[:, None]
    X_obj = (R.T @ (X_cam - t.reshape(1, 3)).T).T
    return X_obj[ok], hit[ok]


# ─────────────────────────────────────────────────────────────────────────────
# Reference database
# ─────────────────────────────────────────────────────────────────────────────
def _db_path(method: str) -> Path:
    return FEATURE_DB_DIR / f"{method.lower()}.npz"


def _empty_db(method: str) -> dict:
    dtype = np.uint8 if method == "ORB" else np.float32
    width = 32 if method == "ORB" else 128
    return {"descriptors": np.zeros((0, width), dtype=dtype),
            "points_3d": np.zeros((0, 3), dtype=np.float32),
            "view_ids": np.zeros((0,), dtype="<U64")}


def load_db(method: str) -> dict:
    method = method.upper()
    if method in _db_cache:
        return _db_cache[method]
    p = _db_path(method)
    if p.is_file():
        d = np.load(p, allow_pickle=False)
        db = {k: d[k] for k in ("descriptors", "points_3d", "view_ids")}
    else:
        db = _empty_db(method)
    _db_cache[method] = db
    return db


def _save_db(method: str, db: dict):
    FEATURE_DB_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(_db_path(method), **db)
    _db_cache[method] = db


def _views_meta_path() -> Path:
    return FEATURE_DB_DIR / "views.json"


def _load_views_meta() -> list:
    p = _views_meta_path()
    return json.loads(p.read_text()) if p.is_file() else []


def library_status() -> dict:
    views = _load_views_meta()
    out = {"views": len(views), "methods": {}}
    for m in METHODS:
        db = load_db(m)
        out["methods"][m] = {"points": int(len(db["points_3d"])),
                             "views": int(len(set(db["view_ids"].tolist())))}
    out["recent_views"] = views[-10:]
    return out


def clear_library() -> dict:
    with _lock:
        for m in METHODS:
            p = _db_path(m)
            if p.is_file():
                p.unlink()
            _db_cache.pop(m, None)
        if _views_meta_path().is_file():
            _views_meta_path().unlink()
    return library_status()


def _gt_to_Rt(ground_truth: dict):
    R = np.asarray(ground_truth["rotation_matrix"], dtype=np.float64).reshape(3, 3)
    p = ground_truth["position"]
    t = np.array([p["x"], p["y"], p["z"]], dtype=np.float64)
    return R, t


def add_reference_view(image, camera_matrix, ground_truth: dict, view_id: str,
                       sensor_name: Optional[str] = None, bbox: Optional[List[float]] = None) -> dict:
    """Detect ORB + SIFT features on a frame with known pose and add the lifted 3D points to the library."""
    img = decode_image(image) if not isinstance(image, np.ndarray) else image
    K = np.asarray(camera_matrix, dtype=np.float64).reshape(3, 3)
    R, t = _gt_to_Rt(ground_truth)
    gray = _to_gray(img)
    mask = _bbox_mask(gray.shape, bbox)

    with _lock:
        meta = _load_views_meta()
        if any(v["view_id"] == view_id for v in meta):
            return {"success": False, "message": f"View '{view_id}' is already in the library",
                    **library_status()}
        if len(meta) >= MAX_REFERENCE_VIEWS:
            return {"success": False, "message": f"Library full ({MAX_REFERENCE_VIEWS} views). Clear it first.",
                    **library_status()}

        per_method = {}
        for m in METHODS:
            det = _create_detector(m)
            kps, desc = det.detectAndCompute(gray, mask)
            if desc is None or len(kps) == 0:
                per_method[m] = {"keypoints": 0, "lifted": 0}
                continue
            pts = np.array([k.pt for k in kps], dtype=np.float64)
            p3d, idx = lift_keypoints_to_3d(pts, K, R, t, image_size=(img.shape[1], img.shape[0]))
            db = load_db(m)
            if len(idx):
                db = {
                    "descriptors": np.vstack([db["descriptors"], desc[idx].astype(db["descriptors"].dtype)]),
                    "points_3d": np.vstack([db["points_3d"], p3d.astype(np.float32)]),
                    "view_ids": np.concatenate([db["view_ids"], np.full(len(idx), view_id, dtype="<U64")]),
                }
                _save_db(m, db)
            per_method[m] = {"keypoints": int(len(kps)), "lifted": int(len(idx))}

        meta.append({"view_id": view_id, "sensor": sensor_name,
                     "range_m": round(float(np.linalg.norm(t)), 3),
                     "attitude": rotation_matrix_to_euler(R),
                     "per_method": per_method,
                     "added_at": time.strftime("%Y-%m-%dT%H:%M:%S")})
        FEATURE_DB_DIR.mkdir(parents=True, exist_ok=True)
        _views_meta_path().write_text(json.dumps(meta, indent=1))

    return {"success": True, "message": "Reference view added", "view_id": view_id,
            "per_method": per_method, **library_status()}


# ─────────────────────────────────────────────────────────────────────────────
# Query: features -> matches -> PnP RANSAC -> identification
# ─────────────────────────────────────────────────────────────────────────────
def _draw_matches(img, kp_pts, inlier_mask, reproj=None, bbox=None) -> str:
    vis = img.copy()
    if bbox and len(bbox) == 4:
        x1, y1, x2, y2 = [int(v) for v in bbox]
        cv2.rectangle(vis, (x1, y1), (x2, y2), (255, 200, 0), 2)
    r = max(3, int(vis.shape[1] / 300))
    for i, (u, v) in enumerate(kp_pts):
        color = (80, 220, 80) if (inlier_mask is not None and inlier_mask[i]) else (60, 60, 230)
        cv2.circle(vis, (int(round(u)), int(round(v))), r, color, 1 if color[1] < 100 else 2, cv2.LINE_AA)
    if reproj is not None:
        for (u, v) in reproj:
            cv2.drawMarker(vis, (int(round(u)), int(round(v))), (0, 165, 255), cv2.MARKER_CROSS, r * 2, 1)
    ok, buf = cv2.imencode(".jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode() if ok else None


def estimate_pose_from_image(image, camera_matrix, feature: str = "ORB", method: str = "ITERATIVE",
                             bbox: Optional[List[float]] = None, ground_truth: Optional[dict] = None,
                             exclude_view_id: Optional[str] = None,
                             ratio_test: float = DEFAULT_RATIO_TEST,
                             min_inliers: int = DEFAULT_MIN_INLIERS,
                             min_inlier_ratio: float = DEFAULT_MIN_INLIER_RATIO,
                             reproj_threshold_px: Optional[float] = None,
                             target_id: str = "SAT-001",
                             return_visualization: bool = True) -> dict:
    t0 = time.perf_counter()
    feature = feature.upper()
    img = decode_image(image) if not isinstance(image, np.ndarray) else image
    h, w = img.shape[:2]
    K = np.asarray(camera_matrix, dtype=np.float64).reshape(3, 3)
    dist = np.zeros((4, 1))

    base = {"success": False, "feature": feature, "method": method.upper(), "target_id": target_id,
            "identified": False, "identification": "Not matched", "image_size": [w, h]}

    db = load_db(feature)
    if exclude_view_id:
        keep = db["view_ids"] != exclude_view_id
        db = {k: v[keep] for k, v in db.items()}
    if len(db["points_3d"]) < 10:
        return {**base, "message": "Reference library is empty. Add reference frames first "
                                   "(Pose Estimation page -> 'Add to Library')."}

    gray = _to_gray(img)
    mask = _bbox_mask(gray.shape, bbox)
    t_feat = time.perf_counter()
    kps, desc = _create_detector(feature).detectAndCompute(gray, mask)
    feat_ms = (time.perf_counter() - t_feat) * 1000.0
    n_kp = 0 if kps is None else len(kps)
    if desc is None or n_kp < 4:
        return {**base, "keypoints": n_kp, "matches": 0, "inliers": 0, "inlier_ratio": 0.0,
                "feature_time_ms": round(feat_ms, 2),
                "message": "Not enough keypoints in the image (empty or background-only frame)."}

    t_match = time.perf_counter()
    matcher = cv2.BFMatcher(_norm_type(feature), crossCheck=False)
    ref_desc = db["descriptors"]
    if feature == "SIFT":
        desc = desc.astype(np.float32)
        ref_desc = ref_desc.astype(np.float32)
    # Multi-view aware Lowe ratio test: the same physical point appears in several
    # reference views, so the 2nd-best match is often the SAME 3D point. Compare the
    # best match with the best match that lies at a DIFFERENT 3D location (> 2 cm).
    knn = matcher.knnMatch(desc, ref_desc, k=6)
    P = db["points_3d"]
    good = []
    for cand in knn:
        if not cand:
            continue
        best = cand[0]
        rival = next((c for c in cand[1:]
                      if np.linalg.norm(P[c.trainIdx] - P[best.trainIdx]) > 0.02), None)
        if rival is None or best.distance < ratio_test * rival.distance:
            good.append(best)
    match_ms = (time.perf_counter() - t_match) * 1000.0

    q_pts_all = np.array([k.pt for k in kps], dtype=np.float64)
    info = {"keypoints": n_kp, "matches": len(good), "feature_time_ms": round(feat_ms, 2),
            "match_time_ms": round(match_ms, 2), "reference_points": int(len(db["points_3d"])),
            "reference_views": int(len(set(db["view_ids"].tolist())))}

    if len(good) < 6:
        vis = _draw_matches(img, q_pts_all, None, bbox=bbox) if return_visualization else None
        return {**base, **info, "inliers": 0, "inlier_ratio": 0.0, "match_image": vis,
                "message": f"Only {len(good)} good matches - target not matched."}

    img_pts = np.array([q_pts_all[m.queryIdx] for m in good], dtype=np.float64)
    obj_pts = np.array([db["points_3d"][m.trainIdx] for m in good], dtype=np.float64)

    thr = reproj_threshold_px or max(3.0, 0.003 * max(w, h))
    t_pnp = time.perf_counter()
    ok, rvec, tvec, inl = cv2.solvePnPRansac(
        obj_pts, img_pts, K, dist, iterationsCount=1000, reprojectionError=thr,
        confidence=0.999, flags=cv2.SOLVEPNP_EPNP)
    n_inl = 0 if (not ok or inl is None) else len(inl)
    if ok and n_inl >= 6:
        idx = inl.reshape(-1)
        # LM refinement on inliers (the requested solver)
        flag = {"EPNP": cv2.SOLVEPNP_EPNP, "SQPNP": cv2.SOLVEPNP_SQPNP}.get(method.upper())
        if flag is not None:
            ok, rvec, tvec = cv2.solvePnP(obj_pts[idx], img_pts[idx], K, dist, flags=flag)
        cv2.solvePnPRefineLM(obj_pts[idx], img_pts[idx], K, dist, rvec, tvec)
    pnp_ms = (time.perf_counter() - t_pnp) * 1000.0

    inlier_ratio = n_inl / max(1, len(good))
    inlier_mask_q = np.zeros(n_kp, dtype=bool)
    if n_inl:
        for i in inl.reshape(-1):
            inlier_mask_q[good[i].queryIdx] = True

    identified = bool(ok and n_inl >= min_inliers and inlier_ratio >= min_inlier_ratio)
    info.update({"inliers": int(n_inl), "inlier_ratio": round(float(inlier_ratio), 3),
                 "pnp_time_ms": round(pnp_ms, 2), "reprojection_threshold_px": round(thr, 2),
                 "thresholds": {"min_inliers": min_inliers, "min_inlier_ratio": min_inlier_ratio,
                                "ratio_test": ratio_test}})

    if not identified:
        vis = _draw_matches(img, q_pts_all, inlier_mask_q, bbox=bbox) if return_visualization else None
        return {**base, **info, "match_image": vis,
                "total_time_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                "message": f"Target not identified: {n_inl} inliers (need {min_inliers}), "
                           f"inlier ratio {inlier_ratio:.2f} (need {min_inlier_ratio:.2f})."}

    R, _ = cv2.Rodrigues(rvec)
    tv = tvec.reshape(3)
    idx = inl.reshape(-1)
    proj, _ = cv2.projectPoints(obj_pts[idx], rvec, tvec, K, dist)
    proj = proj.reshape(-1, 2)
    rmse = float(np.sqrt(np.mean(np.sum((proj - img_pts[idx]) ** 2, axis=1))))

    result = {
        **base, **info, "success": True, "identified": True,
        "identification": f"Identified: {target_id}",
        "message": f"{feature} pose solved with {n_inl} inliers",
        "rotation_vector": rvec.reshape(3).tolist(),
        "translation_vector": tv.tolist(),
        "rotation_matrix": R.tolist(),
        "position": {"x": float(tv[0]), "y": float(tv[1]), "z": float(tv[2])},
        "distance_m": float(np.linalg.norm(tv)),
        "attitude": rotation_matrix_to_euler(R),
        "quaternion": rotation_matrix_to_quaternion(R),
        "reprojection_rmse_px": round(rmse, 4),
        "landmarks_used": int(n_inl),
        "solve_time_ms": round(pnp_ms, 3),
        "total_time_ms": round((time.perf_counter() - t0) * 1000.0, 2),
        "keypoint_source": feature,
    }

    if ground_truth and "rotation_matrix" in ground_truth and "position" in ground_truth:
        R_gt, t_gt = _gt_to_Rt(ground_truth)
        rng = float(np.linalg.norm(t_gt))
        te = float(np.linalg.norm(tv - t_gt))
        result["errors_vs_gt"] = {
            "rotation_error_deg": round(compute_geodesic_rotation_error(R, R_gt), 4),
            "translation_error_m": round(te, 4),
            "translation_error_pct": round(100.0 * te / rng, 3) if rng > 0 else None,
            "range_error_m": round(abs(float(np.linalg.norm(tv)) - rng), 4),
        }
        result["ground_truth"] = {
            "position": {k: round(float(v), 5) for k, v in zip("xyz", t_gt)},
            "distance_m": round(rng, 4),
            "attitude": rotation_matrix_to_euler(R_gt),
            "quaternion": rotation_matrix_to_quaternion(R_gt),
            "rotation_matrix": R_gt.tolist(),
        }

    if return_visualization:
        result["match_image"] = _draw_matches(img, q_pts_all, inlier_mask_q, reproj=proj, bbox=bbox)
    return result
