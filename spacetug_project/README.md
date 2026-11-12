# Spacecraft Perception and Pose Estimation Web Application

A full-stack computer vision and 3D simulation system for spacecraft relative navigation, autonomous proximity operations, and pose estimation.

---

## 🛰 System Architecture

- **Frontend**: React 18, Vite, Three.js, React Three Fiber (R3F), CSS Design System.
- **Backend**: FastAPI, OpenCV, YOLOv8 (`ultralytics`), SolvePnP algorithm, Pydantic v2.
- **Database**: Local MongoDB service (`spaceDB` database).
- **Computer Vision Pipeline**:
  `Sensor Frame Acquisition -> OpenCV Preprocessing -> YOLOv8n Satellite Detection -> 2D/3D Landmark SolvePnP -> 6-DoF Pose (X,Y,Z + Roll/Pitch/Yaw) -> MongoDB Persistence`

---

## 📋 Prerequisites & Local Setup

### 1. MongoDB Service Verification (Windows)

Ensure MongoDB Server is installed and running as a Windows service:

1. Open PowerShell as Administrator or regular user:
   ```powershell
   Get-Service -Name *mongo*
   ```
2. If `Status` is not `Running`, start the service:
   ```powershell
   Start-Service MongoDB
   ```
3. Test connection via port 27017:
   ```powershell
   Test-NetConnection -ComputerName 127.0.0.1 -Port 27017
   ```

The application automatically connects to `mongodb://localhost:27017` and creates the `spaceDB` database with collections:
- `targets` (Pre-seeded with target `SAT-001`)
- `detection_results` (YOLO inference frames and bounding boxes)
- `pose_estimates` (6-DoF position and attitude records)
- `simulation_sessions` (Orbit simulation run summaries)
- `activity_logs` (System audit events)
- `user_settings` (Persistent theme and processing thresholds)

---

## 🚀 Exact Commands to Start the Application

### 1. Start the Backend API (FastAPI)

In a PowerShell terminal:

```powershell
cd c:\Users\91822\OneDrive\Desktop\Spacetug\spacetug_project\backend
& .\yolo_env\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

- **Health Check**: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)
- **Interactive OpenAPI Docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### 2. Start the Frontend (Vite + React)

In a second PowerShell terminal:

```powershell
cd c:\Users\91822\OneDrive\Desktop\Spacetug\spacetug_project\frontend
npm run dev
```

- **Web Application URL**: [http://localhost:5173/](http://localhost:5173/)

---

## 🛠 Feature Verification & Endpoints

| Feature | Endpoint / Route | Status | Notes |
|---|---|---|---|
| Health Check | `GET /api/health` | **Live** | Validates MongoDB, detector status, SolvePnP |
| System Status | `GET /api/status` | **Live** | Full pipeline ready status |
| Target Management | `GET /api/targets`, `PUT /api/targets/{id}` | **Live** | Seeded with operational SAT-001 |
| YOLOv8 Detection | `POST /api/detection/run` | **Live** | Upload file, confidence threshold, bounding boxes |
| SolvePnP Pose | `POST /api/pose/estimate` | **Live** | 6-DoF relative pose with 7-point landmarks |
| Settings Storage | `GET /api/settings`, `PUT /api/settings` | **Live** | Persisted theme, thresholds to MongoDB |
| Detections Export | `GET /api/export/detections/csv` | **Live** | CSV download of all detections |
| Detections JSON | `GET /api/export/detections/json` | **Live** | JSON archive download |
| Pose Estimates Export | `GET /api/export/poses/csv` | **Live** | CSV download of 6-DoF poses |
| Mission Summary Report | `GET /api/export/mission-report` | **Live** | Consolidated JSON telemetry report |
| 3D Simulation View | `/simulation` | **Live** | Three.js orbit rendering and boresight tracking |

---

## 🔧 Troubleshooting

- **MongoDB Service Offline**: Run `net start MongoDB` in PowerShell as Administrator.
- **YOLO Weights**: Trained weights are loaded from `backend/runs/satellite_yolov8n_v1/weights/best.pt`.
- **CORS Errors**: The backend CORS middleware allows all origins `allow_origins=["*"]`.
