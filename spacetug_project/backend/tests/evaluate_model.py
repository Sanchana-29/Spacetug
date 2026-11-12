import sys
from pathlib import Path
import cv2
from ultralytics import YOLO

BACKEND_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = BACKEND_DIR / "runs" / "satellite_yolov8n_v1" / "weights" / "best.pt"
DATASET_DIR = BACKEND_DIR / "datasets" / "satellite_dataset_200_samples_4"

if not MODEL_PATH.is_file():
    # Fallback to current workspace path
    MODEL_PATH = Path(r"C:\Users\91822\OneDrive\Desktop\Spacetug\spacetug_project\backend\runs\satellite_yolov8n_v1\weights\best.pt")
if not DATASET_DIR.is_dir():
    DATASET_DIR = Path(r"C:\Users\91822\OneDrive\Desktop\Spacetug\spacetug_project\backend\datasets\satellite_dataset_200_samples_4")

model = YOLO(str(MODEL_PATH))

def load_ground_truth(label_file, img_w, img_h):
    boxes = []
    if not label_file.exists():
        return boxes
    with open(label_file, "r") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 5:
                cls_id = int(parts[0])
                cx = float(parts[1]) * img_w
                cy = float(parts[2]) * img_h
                w = float(parts[3]) * img_w
                h = float(parts[4]) * img_h
                x1 = cx - w / 2
                y1 = cy - h / 2
                x2 = cx + w / 2
                y2 = cy + h / 2
                boxes.append({
                    "cls": cls_id,
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "w": w, "h": h
                })
    return boxes

def compute_iou(boxA, boxB):
    xA = max(boxA["x1"], boxB["x1"])
    yA = max(boxA["y1"], boxB["y1"])
    xB = min(boxA["x2"], boxB["x2"])
    yB = min(boxA["y2"], boxB["y2"])
    interArea = max(0, xB - xA) * max(0, yB - yA)
    boxAArea = (boxA["x2"] - boxA["x1"]) * (boxA["y2"] - boxA["y1"])
    boxBArea = (boxB["x2"] - boxB["x1"]) * (boxB["y2"] - boxB["y1"])
    denom = boxAArea + boxBArea - interArea
    return interArea / denom if denom > 0 else 0

for split in ["train", "val"]:
    images = sorted(list((DATASET_DIR / "images" / split).glob("*.png")))[:3]
    print(f"\n==================== SPLIT: {split} ====================")
    for img_path in images:
        label_path = DATASET_DIR / "labels" / split / f"{img_path.stem}.txt"
        img = cv2.imread(str(img_path))
        h, w = img.shape[:2]
        gt_boxes = load_ground_truth(label_path, w, h)
        
        print(f"\n--- {img_path.name} ({w}x{h}) ---")
        print(f"Ground Truth Count: {len(gt_boxes)}")
        for i, gt in enumerate(gt_boxes):
            print(f"  GT #{i+1}: [{gt['x1']:.1f}, {gt['y1']:.1f}, {gt['x2']:.1f}, {gt['y2']:.1f}] w={gt['w']:.1f}, h={gt['h']:.1f}")

        results = model.predict(source=img, imgsz=640, conf=0.5, verbose=False)[0]
        pred_boxes = []
        if results.boxes is not None:
            for b in results.boxes:
                x1, y1, x2, y2 = b.xyxy[0].cpu().tolist()
                conf = float(b.conf[0].item())
                pred_boxes.append({
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "w": x2 - x1, "h": y2 - y1,
                    "conf": conf
                })
        print(f"Predictions Count (conf=0.5): {len(pred_boxes)}")
        for i, pred in enumerate(pred_boxes):
            best_iou = max([compute_iou(pred, gt) for gt in gt_boxes]) if gt_boxes else 0
            print(f"  Pred #{i+1}: [{pred['x1']:.1f}, {pred['y1']:.1f}, {pred['x2']:.1f}, {pred['y2']:.1f}] conf={pred['conf']:.4f} max_IoU={best_iou:.3f}")
