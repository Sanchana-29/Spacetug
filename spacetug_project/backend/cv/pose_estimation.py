import cv2
import numpy as np
import math
import time
from pathlib import Path
import json

LANDMARKS_FILE = Path(__file__).resolve().parent / "target_pose_landmarks.json"

def load_target_landmarks():
    if LANDMARKS_FILE.is_file():
        try:
            with open(LANDMARKS_FILE, "r") as f:
                data = json.load(f)
                scale = float(data.get("scale_factor", 0.08))
                landmarks_dict = {}
                for lm in data.get("landmarks", []):
                    pt = lm["object_point_3d"]
                    landmarks_dict[lm["id"]] = [float(pt["x"]), float(pt["y"]), float(pt["z"])]
                return landmarks_dict, scale, data
        except Exception as e:
            print("Warning loading target_pose_landmarks.json:", e)

    # Fallback to defaults
    # Fallback: identical to target_pose_landmarks.json (glTF scene-root frame, model units)
    fallback_dict = {
        "solar_panel_right_tip_upper": [7.8909, 1.0933, 1.6304],
        "solar_panel_right_tip_lower": [7.7388, -1.3544, 2.0907],
        "solar_panel_left_tip_upper": [-5.0413, 0.3929, -6.3679],
        "solar_panel_left_tip_lower": [-5.1934, -2.0548, -5.9076],
        "antenna_dish_top": [-0.1486, 1.5396, 0.1054],
        "primary_dish_center": [-0.1299, 0.0459, 0.2036],
        "optical_lens_center": [-0.5894, 0.2065, 0.9408],
        "chassis_rear_base": [1.7858, -0.7233, -3.8801],
        "chassis_side_panel": [2.4542, -0.4254, -1.4473],
    }
    return fallback_dict, 0.08, {"scale_factor": 0.08, "landmarks": []}

LANDMARKS_3D, LANDMARK_SCALE, LANDMARKS_METADATA = load_target_landmarks()
LANDMARK_IDS = list(LANDMARKS_3D.keys())

OBJECT_POINTS = np.array(
    [LANDMARKS_3D[key] for key in LANDMARK_IDS],
    dtype=np.float64
) * LANDMARK_SCALE


def get_pose_status():
    return {
        "pipeline": "ready",
        "method": "OpenCV solvePnP",
        "status": "ready",
        "required_landmarks": len(LANDMARK_IDS),
        "landmark_ids": LANDMARK_IDS,
        "landmark_scale": LANDMARK_SCALE,
    }


def build_camera_matrix(image_width, image_height, fov_degrees=60.0, fov_mode="vertical"):
    """
    Estimate camera intrinsics matrix from image dimensions and FOV.
    Three.js uses vertical FOV by default (PerspectiveCamera.fov is vertical).
    For vertical FOV: fy = h / (2 * tan(vfov / 2)), and fx = fy for square pixels.
    For horizontal FOV: fx = w / (2 * tan(hfov / 2)), and fy = fx.
    """
    if image_width <= 0 or image_height <= 0:
        raise ValueError("Image width and height must be positive.")

    fov_rad = math.radians(fov_degrees)
    if fov_mode.lower() == "vertical":
        fy = float(image_height) / (2.0 * math.tan(fov_rad / 2.0))
        fx = fy  # square pixels
    else:
        fx = float(image_width) / (2.0 * math.tan(fov_rad / 2.0))
        fy = fx

    cx = float(image_width) / 2.0
    cy = float(image_height) / 2.0

    return np.array([
        [fx, 0.0, cx],
        [0.0, fy, cy],
        [0.0, 0.0, 1.0]
    ], dtype=np.float64)


def rotation_matrix_to_euler(rotation_matrix):
    """Convert rotation matrix to roll, pitch and yaw in degrees (XYZ convention)."""
    sy = math.sqrt(
        rotation_matrix[0, 0] ** 2 +
        rotation_matrix[1, 0] ** 2
    )

    singular = sy < 1e-6

    if not singular:
        roll = math.atan2(
            rotation_matrix[2, 1],
            rotation_matrix[2, 2]
        )
        pitch = math.atan2(
            -rotation_matrix[2, 0], sy
        )
        yaw = math.atan2(
            rotation_matrix[1, 0],
            rotation_matrix[0, 0]
        )
    else:
        roll = math.atan2(
            -rotation_matrix[1, 2],
            rotation_matrix[1, 1]
        )
        pitch = math.atan2(
            -rotation_matrix[2, 0], sy
        )
        yaw = 0.0

    return {
        "roll": round(math.degrees(roll), 3),
        "pitch": round(math.degrees(pitch), 3),
        "yaw": round(math.degrees(yaw), 3),
    }


def rotation_matrix_to_quaternion(rotation_matrix):
    trace = float(np.trace(rotation_matrix))
    if trace > 0:
        s_q = 0.5 / math.sqrt(trace + 1.0)
        qw = 0.25 / s_q
        qx = (rotation_matrix[2, 1] - rotation_matrix[1, 2]) * s_q
        qy = (rotation_matrix[0, 2] - rotation_matrix[2, 0]) * s_q
        qz = (rotation_matrix[1, 0] - rotation_matrix[0, 1]) * s_q
    elif rotation_matrix[0, 0] > rotation_matrix[1, 1] and rotation_matrix[0, 0] > rotation_matrix[2, 2]:
        s_q = 2.0 * math.sqrt(1.0 + rotation_matrix[0, 0] - rotation_matrix[1, 1] - rotation_matrix[2, 2])
        qw = (rotation_matrix[2, 1] - rotation_matrix[1, 2]) / s_q
        qx = 0.25 * s_q
        qy = (rotation_matrix[0, 1] + rotation_matrix[1, 0]) / s_q
        qz = (rotation_matrix[0, 2] + rotation_matrix[2, 0]) / s_q
    elif rotation_matrix[1, 1] > rotation_matrix[2, 2]:
        s_q = 2.0 * math.sqrt(1.0 + rotation_matrix[1, 1] - rotation_matrix[0, 0] - rotation_matrix[2, 2])
        qw = (rotation_matrix[0, 2] - rotation_matrix[2, 0]) / s_q
        qx = (rotation_matrix[0, 1] + rotation_matrix[1, 0]) / s_q
        qy = 0.25 * s_q
        qz = (rotation_matrix[1, 2] + rotation_matrix[2, 1]) / s_q
    else:
        s_q = 2.0 * math.sqrt(1.0 + rotation_matrix[2, 2] - rotation_matrix[0, 0] - rotation_matrix[1, 1])
        qw = (rotation_matrix[1, 0] - rotation_matrix[0, 1]) / s_q
        qx = (rotation_matrix[0, 2] + rotation_matrix[2, 0]) / s_q
        qy = (rotation_matrix[1, 2] + rotation_matrix[2, 1]) / s_q
        qz = 0.25 * s_q

    return {
        "qw": round(float(qw), 5),
        "qx": round(float(qx), 5),
        "qy": round(float(qy), 5),
        "qz": round(float(qz), 5),
    }


def compute_geodesic_rotation_error(R_est, R_gt):
    """
    Compute rotation error in degrees using geodesic angle:
    angle = acos( clamp((trace(R_est.T @ R_gt) - 1) / 2, -1, 1) )
    """
    R_diff = R_est.T @ R_gt
    trace_val = float(np.trace(R_diff))
    cos_angle = (trace_val - 1.0) / 2.0
    cos_angle = max(-1.0, min(1.0, cos_angle))
    return float(math.degrees(math.acos(cos_angle)))


SOLVER_FLAGS = {
    "ITERATIVE": cv2.SOLVEPNP_ITERATIVE,
    "EPNP": cv2.SOLVEPNP_EPNP,
    "SQPNP": getattr(cv2, "SOLVEPNP_SQPNP", cv2.SOLVEPNP_ITERATIVE),
}


def estimate_pose(
    bbox=None,
    image_points=None,
    image_size=None,
    fov_degrees=60.0,
    fov_mode="vertical",
    camera_matrix=None,
    distortion_coeffs=None,
    method="ITERATIVE",
    use_ransac=False,
    ground_truth=None,
):
    """
    Estimate spacecraft pose from matching 3D model landmarks and 2D image landmarks.
    """
    start_time = time.perf_counter()

    if image_points is None:
        return {
            "success": False,
            "message": (
                "2D image landmarks are required for solvePnP. "
                "A bounding box alone is insufficient."
            ),
            "required_landmarks": LANDMARK_IDS,
            "method": method,
        }

    try:
        # Match supplied image points to 3D model points
        if isinstance(image_points, dict):
            valid_ids = [
                landmark_id
                for landmark_id in LANDMARK_IDS
                if landmark_id in image_points
                and image_points[landmark_id] is not None
            ]

            object_points = np.array(
                [LANDMARKS_3D[key] for key in valid_ids],
                dtype=np.float64
            ) * LANDMARK_SCALE

            image_points_array = np.array(
                [image_points[key] for key in valid_ids],
                dtype=np.float64
            )
            used_ids = valid_ids
        else:
            image_points_array = np.asarray(image_points, dtype=np.float64)
            if image_points_array.shape != (len(LANDMARK_IDS), 2):
                return {
                    "success": False,
                    "message": (
                        f"Expected {len(LANDMARK_IDS)} image points "
                        "in LANDMARK_IDS order."
                    ),
                    "expected_shape": [len(LANDMARK_IDS), 2],
                    "received_shape": list(image_points_array.shape),
                }
            object_points = OBJECT_POINTS.copy()
            used_ids = LANDMARK_IDS

        if len(image_points_array) < 4:
            return {
                "success": False,
                "message": "At least four matching 2D-3D points are required.",
                "received_points": len(image_points_array),
            }

        if not np.isfinite(image_points_array).all():
            return {
                "success": False,
                "message": "Image points contain invalid or non-finite coordinates.",
            }

        if image_size is None or len(image_size) != 2:
            return {
                "success": False,
                "message": "Provide image_size as [width, height].",
            }

        width, height = int(image_size[0]), int(image_size[1])

        if camera_matrix is None:
            camera_matrix = build_camera_matrix(
                width, height, fov_degrees, fov_mode=fov_mode
            )
        else:
            camera_matrix = np.asarray(camera_matrix, dtype=np.float64)

        if distortion_coeffs is None:
            distortion_coeffs = np.zeros((5, 1), dtype=np.float64)
        else:
            distortion_coeffs = np.asarray(distortion_coeffs, dtype=np.float64)

        method_upper = str(method).upper()
        pnp_flag = SOLVER_FLAGS.get(method_upper, cv2.SOLVEPNP_ITERATIVE)

        # Estimate rotation and translation (timed: solver only)
        inliers = None
        solve_start = time.perf_counter()
        if use_ransac:
            success, rvec, tvec, inliers = cv2.solvePnPRansac(
                object_points,
                image_points_array,
                camera_matrix,
                distortion_coeffs,
                flags=pnp_flag,
                reprojectionError=3.0,
                iterationsCount=100,
            )
        elif method_upper == "ITERATIVE":
            # Levenberg-Marquardt needs a good initial guess; without one it can
            # converge to a wrong local minimum when the 2D points are noisy.
            # Initialise with the global SQPnP solution, then refine iteratively.
            ok_init, rvec, tvec = cv2.solvePnP(
                object_points,
                image_points_array,
                camera_matrix,
                distortion_coeffs,
                flags=SOLVER_FLAGS["SQPNP"],
            )
            success, rvec, tvec = cv2.solvePnP(
                object_points,
                image_points_array,
                camera_matrix,
                distortion_coeffs,
                rvec=rvec if ok_init else None,
                tvec=tvec if ok_init else None,
                useExtrinsicGuess=bool(ok_init),
                flags=cv2.SOLVEPNP_ITERATIVE,
            )
        else:
            success, rvec, tvec = cv2.solvePnP(
                object_points,
                image_points_array,
                camera_matrix,
                distortion_coeffs,
                flags=pnp_flag,
            )

        if not success:
            return {
                "success": False,
                "message": f"OpenCV solvePnP ({method_upper}) could not estimate the pose.",
            }

        solve_time_ms = round((time.perf_counter() - solve_start) * 1000.0, 3)
        rotation_matrix, _ = cv2.Rodrigues(rvec)

        # Reproject the estimated 3D points onto the image
        projected_points, _ = cv2.projectPoints(
            object_points,
            rvec,
            tvec,
            camera_matrix,
            distortion_coeffs,
        )
        projected_points = projected_points.reshape(-1, 2)

        errors = np.linalg.norm(
            projected_points - image_points_array, axis=1
        )
        reprojection_rmse = float(np.sqrt(np.mean(errors ** 2)))

        total_time_ms = round((time.perf_counter() - start_time) * 1000.0, 3)

        position = {
            "x": round(float(tvec[0, 0]), 5),
            "y": round(float(tvec[1, 0]), 5),
            "z": round(float(tvec[2, 0]), 5),
        }
        est_range_m = float(np.sqrt(tvec[0, 0]**2 + tvec[1, 0]**2 + tvec[2, 0]**2))

        attitude = rotation_matrix_to_euler(rotation_matrix)
        quaternion = rotation_matrix_to_quaternion(rotation_matrix)

        reprojected_dict = {}
        detected_dict = {}
        for i, lm_id in enumerate(used_ids):
            reprojected_dict[lm_id] = [round(float(projected_points[i, 0]), 2), round(float(projected_points[i, 1]), 2)]
            detected_dict[lm_id] = [round(float(image_points_array[i, 0]), 2), round(float(image_points_array[i, 1]), 2)]

        # Compare with Ground Truth if provided
        errors_vs_gt = None
        ground_truth_out = None
        if ground_truth and isinstance(ground_truth, dict):
            gt_pos = ground_truth.get("position")
            gt_rot = ground_truth.get("rotation_matrix") or ground_truth.get("rotation_vector")

            trans_error = None
            range_error = None
            rot_error = None
            gt_range = 0.0
            R_gt = None

            if gt_pos and all(k in gt_pos for k in ("x", "y", "z")):
                gt_vec = np.array([gt_pos["x"], gt_pos["y"], gt_pos["z"]], dtype=np.float64)
                est_vec = np.array([tvec[0, 0], tvec[1, 0], tvec[2, 0]], dtype=np.float64)
                trans_error = float(np.linalg.norm(est_vec - gt_vec))
                gt_range = float(np.linalg.norm(gt_vec))
                range_error = abs(est_range_m - gt_range)

            if gt_rot is not None:
                if isinstance(gt_rot, list) and len(gt_rot) == 3 and isinstance(gt_rot[0], list):
                    R_gt = np.array(gt_rot, dtype=np.float64)
                elif isinstance(gt_rot, (list, np.ndarray)) and len(gt_rot) == 3:
                    R_gt, _ = cv2.Rodrigues(np.array(gt_rot, dtype=np.float64))
                else:
                    R_gt = None

                if R_gt is not None:
                    rot_error = compute_geodesic_rotation_error(rotation_matrix, R_gt)

            ground_truth_out = {}
            if gt_pos and all(k in gt_pos for k in ("x", "y", "z")):
                ground_truth_out["position"] = {k: round(float(gt_pos[k]), 5) for k in ("x", "y", "z")}
                ground_truth_out["distance_m"] = round(float(np.linalg.norm(gt_vec)), 4)
            if gt_rot is not None and R_gt is not None:
                ground_truth_out["attitude"] = rotation_matrix_to_euler(R_gt)
                ground_truth_out["quaternion"] = rotation_matrix_to_quaternion(R_gt)
                ground_truth_out["rotation_matrix"] = [[round(float(c), 5) for c in row] for row in R_gt]

            errors_vs_gt = {
                "translation_error_m": round(trans_error, 4) if trans_error is not None else None,
                "translation_error_pct": round(100.0 * trans_error / gt_range, 3) if (trans_error is not None and gt_range > 0) else None,
                "range_error_m": round(range_error, 4) if range_error is not None else None,
                "rotation_error_deg": round(rot_error, 3) if rot_error is not None else None,
            }

        return {
            "success": True,
            "method": method_upper,
            "position": position,
            "distance_m": round(est_range_m, 4),
            "attitude": attitude,
            "quaternion": quaternion,
            "rotation_matrix": [[round(float(c), 5) for c in row] for row in rotation_matrix],
            "rotation_vector": [round(float(v), 6) for v in rvec.flatten()],
            "reprojection_rmse_px": round(reprojection_rmse, 3),
            "landmarks_used": len(object_points),
            "landmark_ids": used_ids,
            "detected_points_2d": detected_dict,
            "reprojected_points_2d": reprojected_dict,
            "inliers_count": len(inliers) if inliers is not None else len(object_points),
            "solve_time_ms": solve_time_ms,
            "total_time_ms": total_time_ms,
            "coordinate_frame": "opencv_camera",
            "errors_vs_gt": errors_vs_gt,
            "ground_truth": ground_truth_out if ground_truth else None,
        }

    except (ValueError, TypeError, cv2.error) as error:
        return {
            "success": False,
            "message": f"Pose estimation error: {str(error)}",
            "method": method,
        }

