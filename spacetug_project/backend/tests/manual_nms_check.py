import cv2
from pathlib import Path
from ultralytics import YOLO

BACKEND_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = BACKEND_DIR / "runs" / "satellite_yolov8n_v1" / "weights" / "best.pt"
VAL_IMAGES_DIR = BACKEND_DIR / "datasets" / "satellite_dataset_200_samples_4" / "images" / "val"

if not MODEL_PATH.is_file():
    MODEL_PATH = Path(r"C:\Users\91822\OneDrive\Desktop\sanchana\backend\runs\satellite_yolov8n_v1\weights\best.pt")
if not VAL_IMAGES_DIR.is_dir():
    VAL_IMAGES_DIR = Path(r"C:\Users\91822\OneDrive\Desktop\sanchana\backend\datasets\satellite_dataset_200_samples_4\images\val")

model = YOLO(str(MODEL_PATH))

print("Testing NMS IoU threshold comparison on validation images...")
for img_path in sorted(list(VAL_IMAGES_DIR.glob("*.png")))[:10]:
    img = cv2.imread(str(img_path))
    
    # Test default iou=0.7 vs iou=0.5 vs iou=0.45 at conf=0.25
    res_07 = model.predict(source=img, imgsz=640, conf=0.25, iou=0.7, verbose=False)[0]
    res_05 = model.predict(source=img, imgsz=640, conf=0.25, iou=0.5, verbose=False)[0]
    res_045 = model.predict(source=img, imgsz=640, conf=0.25, iou=0.45, verbose=False)[0]
    
    count_07 = len(res_07.boxes) if res_07.boxes is not None else 0
    count_05 = len(res_05.boxes) if res_05.boxes is not None else 0
    count_045 = len(res_045.boxes) if res_045.boxes is not None else 0
    
    # Also at conf=0.5
    res_conf50_07 = model.predict(source=img, imgsz=640, conf=0.5, iou=0.7, verbose=False)[0]
    res_conf50_05 = model.predict(source=img, imgsz=640, conf=0.5, iou=0.5, verbose=False)[0]
    count_c50_07 = len(res_conf50_07.boxes) if res_conf50_07.boxes is not None else 0
    count_c50_05 = len(res_conf50_05.boxes) if res_conf50_05.boxes is not None else 0
    
    print(f"{img_path.name}: conf=0.25 (iou 0.7: {count_07}, iou 0.5: {count_05}, iou 0.45: {count_045}) | conf=0.5 (iou 0.7: {count_c50_07}, iou 0.5: {count_c50_05})")
