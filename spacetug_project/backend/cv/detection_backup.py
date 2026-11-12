
import cv2


def get_detection_status():
    return {
        "pipeline": "ready",
        "detector": "OpenCV Contour Detector",
        "target": "Unclassified Bright Object",
        "status": "waiting",
        "note": (
            "Geometric contour detection only. "
            "Satellite identity and ML confidence are not verified."
        ),
    }


def detect_target(image):
    """
    Detect candidate bright objects using OpenCV contours.

    This is a candidate detector, not a trained satellite classifier.
    It does not return a fabricated confidence score.
    """

    if image is None:
        return {
            "detected": False,
            "detections": [],
            "message": "No image provided",
        }

    if len(image.shape) == 2:
        gray = image
    elif len(image.shape) == 3 and image.shape[2] == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    elif len(image.shape) == 3 and image.shape[2] == 4:
        gray = cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
    else:
        return {
            "detected": False,
            "detections": [],
            "message": "Unsupported image format",
        }

    image_height, image_width = gray.shape[:2]
    image_area = image_height * image_width

    if image_area == 0:
        return {
            "detected": False,
            "detections": [],
            "message": "Empty image",
        }

    # Threshold bright regions.
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, binary = cv2.threshold(
        blurred, 100, 255, cv2.THRESH_BINARY
    )

    # Merge small nearby bright regions.
    kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (3, 3)
    )
    binary = cv2.morphologyEx(
        binary, cv2.MORPH_CLOSE, kernel
    )

    contours, _ = cv2.findContours(
        binary,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    candidates = []

    min_area = max(16, int(image_area * 0.00001))
    max_area = int(image_area * 0.25)

    for contour in contours:
        area = cv2.contourArea(contour)

        if area < min_area or area > max_area:
            continue

        x, y, width, height = cv2.boundingRect(contour)

        if width < 4 or height < 4:
            continue

        # Reject contours occupying almost the entire image.
        if width >= image_width * 0.95 and height >= image_height * 0.95:
            continue

        candidates.append({
            "bounding_box": {
                "x": int(x),
                "y": int(y),
                "width": int(width),
                "height": int(height),
            },
            "contour_area": float(area),
        })

    if not candidates:
        return {
            "detected": False,
            "detections": [],
            "message": "No suitable bright contour found",
        }

    # Return candidate regions without claiming satellite identity.
    candidates.sort(
        key=lambda item: item["contour_area"],
        reverse=True,
    )

       # Select the largest bright contour candidate.
    candidate = candidates[0]
    bbox = candidate["bounding_box"]

    # Expand the box slightly around the candidate.
    pad_x = max(10, int(bbox["width"] * 0.5))
    pad_y = max(10, int(bbox["height"] * 0.25))

    x1 = max(0, bbox["x"] - pad_x)
    y1 = max(0, bbox["y"] - pad_y)
    x2 = min(
        image_width,
        bbox["x"] + bbox["width"] + pad_x,
    )
    y2 = min(
        image_height,
        bbox["y"] + bbox["height"] + pad_y,
    )

    expanded_bbox = {
        "x": x1,
        "y": y1,
        "width": x2 - x1,
        "height": y2 - y1,
    }

    detections = [
        {
            "id": "OBJ-001",
            "class_name": "Unclassified Bright Object",
           "bounding_box": expanded_bbox,
        }
    ]

    return {
        "detected": True,
        "detections": detections,
        "message": (
            "Bright contour candidate(s) found. "
            "Satellite identity is not verified."
        ),
    }
