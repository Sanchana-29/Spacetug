import sys
from pathlib import Path
import cv2
import numpy as np
import requests
import json

BACKEND_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = BACKEND_DIR / "runs" / "satellite_yolov8n_v1" / "weights" / "best.pt"
DATASET_DIR = BACKEND_DIR / "datasets" / "satellite_dataset_200_samples_4"

if not MODEL_PATH.is_file():
    MODEL_PATH = Path(r"C:\Users\91822\OneDrive\Desktop\Spacetug\spacetug_project\backend\runs\satellite_yolov8n_v1\weights\best.pt")
if not DATASET_DIR.is_dir():
    DATASET_DIR = Path(r"C:\Users\91822\OneDrive\Desktop\Spacetug\spacetug_project\backend\datasets\satellite_dataset_200_samples_4")

print("=" * 60)
print("TEST 1: Model weights & Virtual environment verification")
print("=" * 60)
print(f"Model path: {MODEL_PATH}")
print(f"Exists: {MODEL_PATH.exists()}, Size: {MODEL_PATH.stat().st_size} bytes")

status_res = requests.get("http://127.0.0.1:8000/api/status")
print("GET /api/status HTTP status:", status_res.status_code)
status_data = status_res.json()
print("Detection Status:", json.dumps(status_data["detection"], indent=2))
assert status_data["detection"]["detector"] == "YOLOv8n"
assert status_data["detection"]["status"] == "ready"

print("\n" + "=" * 60)
print("TEST 2: Multiple Thresholds & Duplicate Suppression (satellite_0166.png)")
print("=" * 60)
img_path = DATASET_DIR / "images" / "val" / "satellite_0166.png"
with open(img_path, "rb") as f:
    img_bytes = f.read()

for conf_val in [0.25, 0.50, 0.80]:
    resp = requests.post(
        "http://127.0.0.1:8000/api/detection/run",
        files={"file": ("satellite_0166.png", img_bytes, "image/png")},
        data={"conf": str(conf_val)}
    )
    data = resp.json()
    detections = data.get("detections", [])
    print(f"\n--- Threshold conf={conf_val} ---")
    print(f"HTTP Status: {resp.status_code}")
    print(f"Detected: {data.get('detected')}")
    print(f"Threshold applied: {data.get('confidence_threshold')}")
    print(f"Image dimensions: {data.get('image_width')} x {data.get('image_height')}")
    print(f"Detection count: {len(detections)}")
    for d in detections:
        bb = d["bounding_box"]
        # Verify bounding box coordinates
        assert bb["x"] >= 0 and bb["y"] >= 0
        assert bb["x"] + bb["width"] <= data["image_width"]
        assert bb["y"] + bb["height"] <= data["image_height"]
        print(f"  {d['id']}: class={d['class_name']}, conf={d['confidence']:.4f}, box={bb}")

print("\n" + "=" * 60)
print("TEST 3: Multiple Satellites in a single frame (satellite_0161.png)")
print("=" * 60)
multi_img = DATASET_DIR / "images" / "val" / "satellite_0161.png"
with open(multi_img, "rb") as f:
    resp_multi = requests.post(
        "http://127.0.0.1:8000/api/detection/run",
        files={"file": ("satellite_0161.png", f.read(), "image/png")},
        data={"conf": "0.50"}
    )
data_multi = resp_multi.json()
print(f"Detections count at 0.50: {len(data_multi['detections'])}")
for d in data_multi["detections"]:
    print(f"  {d['id']}: conf={d['confidence']:.4f}, bbox={d['bounding_box']}")
assert len(data_multi["detections"]) >= 4

print("\n" + "=" * 60)
print("TEST 4: Zero Detection / Blank Image (Target Absent)")
print("=" * 60)
blank = np.zeros((480, 640, 3), dtype=np.uint8)
_, encoded_blank = cv2.imencode(".png", blank)
resp_zero = requests.post(
    "http://127.0.0.1:8000/api/detection/run",
    files={"file": ("blank.png", encoded_blank.tobytes(), "image/png")},
    data={"conf": "0.25"}
)
data_zero = resp_zero.json()
print("Blank image detected:", data_zero.get("detected"))
print("Detections count:", len(data_zero.get("detections", [])))
print("Message:", data_zero.get("message"))
assert data_zero.get("detected") is False
assert len(data_zero.get("detections", [])) == 0

print("\n" + "=" * 60)
print("TEST 5: Extreme Confidence Threshold (conf=0.98)")
print("=" * 60)
resp_high = requests.post(
    "http://127.0.0.1:8000/api/detection/run",
    files={"file": ("satellite_0161.png", img_bytes, "image/png")},
    data={"conf": "0.98"}
)
data_high = resp_high.json()
print("At conf=0.98, detected:", data_high.get("detected"))
print("Detections count:", len(data_high.get("detections", [])))

print("\n" + "=" * 60)
print("TEST 6: Error handling (empty file payload)")
print("=" * 60)
resp_err = requests.post(
    "http://127.0.0.1:8000/api/detection/run",
    files={"file": ("empty.png", b"", "image/png")}
)
print("HTTP status for empty payload:", resp_err.status_code)
print("Response:", resp_err.json())
assert resp_err.status_code == 400

print("\n" + "=" * 60)
print("ALL BACKEND INTEGRATION TESTS PASSED PERFECTLY!")
print("=" * 60)
