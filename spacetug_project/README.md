# Spacecraft Perception and Pose Estimation Using Computer Vision

A full-stack simulation and computer-vision system for spacecraft proximity operations. A servicer
("chaser") spacecraft observes a tumbling target satellite (**SAT-001**) with four virtual sensors,
detects and tracks it, estimates its 6-DoF pose, filters its relative motion and predicts collision risk.
Every estimate is compared with the exact simulation ground truth.

- **Frontend:** React 19, Vite, Three.js / React Three Fiber
- **Backend:** FastAPI, Pydantic v2, OpenCV, Ultralytics YOLOv8n, NumPy/SciPy
- **Database:** MongoDB (`spaceDB`)

---

## Perception pipeline

```
Virtual sensors (RGB-D, Stereo, Thermal, LiDAR)
   └─► frame capture ─► OpenCV preprocessing ─► YOLOv8n detection ─► SORT tracking (persistent TRK IDs)
                                                        │
              ┌─────────────────────────────────────────┴───────────────────────────┐
     2D landmarks + solvePnP                                   ORB / SIFT features matched to a
     (ITERATIVE / EPnP / SQPnP)                                reference library + PnP RANSAC
              └──────────────────────► 6-DoF pose (R, t) ◄────────────── target identification
                                              │
              chaser attitude ─► non-rotating frame ─► Kalman filter ─► relative velocity, tumbling rate
                                              │
                                   TTC / CPA ─► collision risk LOW / MEDIUM / HIGH ─► mission log
```

All results (detections, poses, tracks, perception steps, mission events, settings) are stored in MongoDB.

---

## Features and status

| Module | Implementation | Status |
|---|---|---|
| Virtual space environment | Three.js scene: chaser, SAT-001, Earth, orbit propagation, tumbling target, play/pause/reset/speed | ✅ Working |
| Virtual sensor module | RGB-D, Stereo (left/right), Thermal, LiDAR views; frame capture with camera intrinsics and ground-truth pose | ✅ Working |
| Image preprocessing | OpenCV resize, CLAHE/contrast, denoise, blur, sharpen, Canny edges | ✅ Working |
| Object detection | YOLOv8n trained on 200 rendered images (P 95.2 %, R 88.4 %, mAP@50 96.9 %) | ✅ Working |
| Object tracking | SORT: box Kalman filter + IoU + Hungarian matching, persistent `TRK-xx` IDs, ID-switch metrics; single-target mode (only the most confident detection is tracked, so background clutter such as the Earth does not spawn tracks) | ✅ Working (live perception) |
| Target selection | Operator selects / locks SAT-001 in the 3D scene and dashboard | ✅ Working |
| Feature extraction & identification | ORB and SIFT; reference keypoints lifted to 3D on satellite.glb; multi-view ratio test; PnP RANSAC; identification by inliers + inlier ratio | ✅ Working |
| 6-DoF pose estimation | solvePnP (ITERATIVE with SQPnP initialisation, EPnP, SQPnP) on 9 mesh-vertex landmarks; errors vs ground truth | ✅ Working |
| Relative motion estimation | Poses rotated to a non-rotating frame using the chaser attitude; constant-velocity Kalman filter with innovation gating (a single failed PnP solution is rejected); angular rate from consecutive attitudes | ✅ Working |
| Collision risk | Closing speed, TTC, time and distance of closest approach, risk levels, HIGH-risk mission log warnings | ✅ Working |
| Mission dashboard | 3D dashboard, telemetry charts (estimated vs Kalman vs truth), collision badge | ✅ Working |
| Data management | MongoDB persistence, mission summary report, PDF / JSON / CSV exports | ✅ Working |
| DINOv1 features | — | ⏳ Future work |
| Multi-sensor fusion | — | ⏳ Future work |

---

## Setup (Windows PowerShell)

### 1. MongoDB
```powershell
Get-Service -Name *mongo*          # must be Running
Start-Service MongoDB              # if it is stopped
```
The backend connects to `mongodb://localhost:27017`, database `spaceDB`. Without MongoDB the app still runs,
but nothing is saved and the mission report is unavailable.

### 2. Backend
```powershell
cd C:\Users\91822\OneDrive\Desktop\Spacetug\spacetug_project\backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
- Health check: http://127.0.0.1:8000/api/health
- Interactive API docs: http://127.0.0.1:8000/docs
- YOLO weights: `backend/runs/satellite_yolov8n_v1/weights/best.pt`

### 3. Frontend
```powershell
cd C:\Users\91822\OneDrive\Desktop\Spacetug\spacetug_project\frontend
npm install
npm run dev
```
Open http://localhost:5173

---

## Demo flow

1. **Welcome:** start or resume a mission. The simulation starts running, and **live perception starts with it**
   (IR floodlight on). It keeps running in the background on every page, and a page refresh continues the same
   mission time and perception history.
2. **Sensors:** watch the live loop: the satellite gets a green box with a persistent **TRK-01** ID, and the panel
   shows pose, motion and collision risk live. Stopping it here keeps it stopped until you start it again.
3. **Capture Frame → Detection:** YOLOv8n detection on the captured frame.
4. **Pose Estimation:** *Projected landmarks*: solvePnP with a noise slider, estimated vs ground truth.
   *ORB / SIFT*: the reference library is built automatically from the live feed (one view every 3 s, up to 20 views,
   ~1 minute). Captured frames are also added (Auto-add captures). Then estimate on a new capture
   ("Identified: SAT-001", inliers, match image).
5. **Telemetry:** range, relative speed, tumbling rate (raw vs Kalman vs truth) and CPA distance.
6. **Settings:** perception settings, interactive SAT-001 model with labelled parts, and the **Mission report**
   (PDF / JSON / CSV downloads).

---

## Tests and evaluation

```powershell
cd spacetug_project\backend
python -m pytest                                   # 39 unit / API tests
python tests\evaluate_pipeline.py                  # writes backend\results\RESULTS.md + charts (~1 min)
```

The evaluation measures the real project code against exact simulation ground truth:

| Experiment | Key result |
|---|---|
| Pose, known correspondences (150 poses) | σ = 0 px: 0.000° / 0.00 % error; σ = 1 px: 1.2° rotation, 0.47 % range (ITERATIVE) |
| ORB vs SIFT on 20 new viewpoints | ORB identified 75 % (median 0.91°), SIFT 55 % (median 0.68°), 0 false IDs on empty frames |
| SORT tracking, 400 frames | 0 ID switches, 100 % ID consistency with 30 % missed detections + 5 % false positives |
| Kalman relative motion (σ = 1 px) | speed RMSE 0.049 → 0.003 m/s, tumble RMSE 2.07 → 0.04 °/s (raw → Kalman) |
| Collision risk, 3 encounter scenarios | 91.7–100 % agreement with the true risk level |

See `backend/results/RESULTS.md` for all tables and `docs/TEST_PLAN.md` for the module test plan.

---

## API overview (`/api/...`)

| Area | Endpoints |
|---|---|
| System | `GET /health`, `GET /status`, `GET /sensors`, `GET /targets`, `GET/PUT /targets/{id}` |
| Missions | `GET/POST /missions`, `GET/PUT /missions/{id}`, `GET /missions/{id}/summary`, `GET/POST /mission-logs`, `GET /activity` |
| Detection & preprocessing | `POST /detection/run`, `GET /detections`, `POST /pipeline/process`, `GET /images/{filename}` |
| Pose | `GET /pose/landmarks`, `POST /pose/estimate`, `POST /pose/estimate-from-image`, `GET /poses` |
| Feature library | `GET/POST/DELETE /features/reference` |
| Live perception | `POST /perception/step`, `POST /perception/reset`, `POST /collision/assess` |
| Settings | `GET/PUT /settings`, `POST /settings/reset` |
| Export | `GET /export/detections/csv`, `GET /export/detections/json`, `GET /export/poses/csv`, `GET /export/mission-report` |

---

## MongoDB collections (`spaceDB`)

`missions`, `mission_logs`, `detection_results`, `pose_estimates`, `perception_steps`, `tracks`,
`simulation_sessions`, `targets`, `activity_logs`, `user_settings`

---

## Limitations

- All images come from the 3D simulator (rendered satellite.glb); the system has not been tested on real space imagery.
- The landmark pose path uses projected landmarks with simulated pixel noise; the ORB/SIFT path uses real image features on rendered frames.
- The ORB/SIFT reference library is built from simulator frames whose ground-truth pose is known.
- Collision risk uses a 1 m safety radius by default: the simulated camera-to-target range is 0.96–1.28 m, so the
  risk is HIGH around closest approach and MEDIUM elsewhere (LOW needs a larger separation).

## Troubleshooting

- **No detections / no track:** the target may be in Earth's shadow; turn on the IR floodlight or use Target view.
- **Motion and collision show "--":** the simulation is paused; press ▶ Play on the Dashboard.
- **"No pose data in this frame":** the frame was opened from the gallery; capture a new frame on the Sensors page.
- **MongoDB offline:** `net start MongoDB` (Administrator PowerShell).
