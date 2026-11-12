import cv2
import numpy as np
import math


# 3D landmarks from satellite.glb.
# Coordinates are in the model's original coordinate system.
LANDMARK_SCALE = 0.08

LANDMARKS_3D = {
    "solar_panel_right_tip": [-0.0044, -0.1416, -0.2182],
    "solar_panel_left_tip": [0.2078, -0.1301, -0.0870],
    "solar_panel_top_edge": [0.2120, 0.0652, -0.1293],
    "chassis_top_front_corner": [0.0121, 0.0629, -0.0251],
    "chassis_bottom_rear_base": [0.1643, 0.0127, -0.2668],
    "primary_dish_center": [-0.0075, 0.0027, 0.0119],
    "optical_lens_center": [-0.0520, 0.0186, 0.0825],
}

LANDMARK_IDS = list(LANDMARKS_3D.keys())

OBJECT_POINTS = np.array(
    [LANDMARKS_3D[key] for key in LANDMARK_IDS],
    dtype=np.float64
) * LANDMARK_SCALE


def get_pose_status():
    return {
        "pipeline": "ready",
        "method": "OpenCV solvePnP",
        "status": "waiting_for_image_landmarks",
        "required_landmarks": len(LANDMARK_IDS),
        "landmark_ids": LANDMARK_IDS,
    }


def build_camera_matrix(image_width, image_height, fov_degrees=60):
    """Estimate camera intrinsics from image size and horizontal FOV."""

    if image_width <= 0 or image_height <= 0:
        raise ValueError("Image width and height must be positive.")

    fov_radians = math.radians(fov_degrees)
    focal_length = image_width / (
        2.0 * math.tan(fov_radians / 2.0)
    )

    return np.array([
        [focal_length, 0, image_width / 2.0],
        [0, focal_length, image_height / 2.0],
        [0, 0, 1]
    ], dtype=np.float64)


def rotation_matrix_to_euler(rotation_matrix):
    """Convert rotation matrix to roll, pitch and yaw in degrees."""

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


def estimate_pose(
    bbox=None,
    image_points=None,
    image_size=None,
    fov_degrees=60,
    camera_matrix=None,
    distortion_coeffs=None,
):
    """
    Estimate spacecraft pose from matching 3D model landmarks
    and 2D image landmarks.

    image_points:
      - dictionary mapping landmark IDs to [u, v], or
      - list of [u, v] pairs in LANDMARK_IDS order.

    image_size: (width, height)
    """

    if image_points is None:
        return {
            "success": False,
            "message": (
                "2D image landmarks are required for solvePnP. "
                "A bounding box alone is insufficient."
            ),
            "required_landmarks": LANDMARK_IDS,
            "method": "OpenCV solvePnP",
        }

    try:
        # Match every supplied image point to its 3D model point.
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

        else:
            image_points_array = np.asarray(
                image_points, dtype=np.float64
            )

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

        if len(image_points_array) < 4:
            return {
                "success": False,
                "message": "At least four matching 2D-3D points are required.",
                "received_points": len(image_points_array),
            }

        if not np.isfinite(image_points_array).all():
            return {
                "success": False,
                "message": "Image points contain invalid coordinates.",
            }

        if image_size is None or len(image_size) != 2:
            return {
                "success": False,
                "message": "Provide image_size as [width, height].",
            }

        width, height = int(image_size[0]), int(image_size[1])

        if camera_matrix is None:
            camera_matrix = build_camera_matrix(
                width, height, fov_degrees
            )
        else:
            camera_matrix = np.asarray(
                camera_matrix, dtype=np.float64
            )

        if distortion_coeffs is None:
            distortion_coeffs = np.zeros((5, 1), dtype=np.float64)
        else:
            distortion_coeffs = np.asarray(
                distortion_coeffs, dtype=np.float64
            )

        # Estimate rotation and translation.
        success, rvec, tvec = cv2.solvePnP(
            object_points,
            image_points_array,
            camera_matrix,
            distortion_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )

        if not success:
            return {
                "success": False,
                "message": "OpenCV solvePnP could not estimate the pose.",
            }

        rotation_matrix, _ = cv2.Rodrigues(rvec)

        # Reproject the estimated 3D points onto the image.
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

        reprojection_rmse = float(
            np.sqrt(np.mean(errors ** 2))
        )

        position = {
            "x": round(float(tvec[0, 0]), 5),
            "y": round(float(tvec[1, 0]), 5),
            "z": round(float(tvec[2, 0]), 5),
        }

        attitude = rotation_matrix_to_euler(rotation_matrix)

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

        quaternion = {
            "qw": round(float(qw), 5),
            "qx": round(float(qx), 5),
            "qy": round(float(qy), 5),
            "qz": round(float(qz), 5),
        }

        return {
            "success": True,
            "method": "OpenCV solvePnP",
            "position": position,
            "attitude": attitude,
            "quaternion": quaternion,
            "rotation_matrix": [[round(float(c), 5) for c in row] for row in rotation_matrix],
            "rotation_vector": [
                round(float(v), 6) for v in rvec.flatten()
            ],
            "reprojection_rmse_px": round(reprojection_rmse, 3),
            "landmarks_used": len(object_points),
            "coordinate_frame": "camera",
            "units": "consistent with scaled 3D model coordinates",
            "confidence": None,
        }

    except (ValueError, TypeError, cv2.error) as error:
        return {
            "success": False,
            "message": f"Pose estimation error: {str(error)}",
        }
