# Test Plan - Spacecraft Perception and Pose Estimation

Evidence: automated tests in `backend/tests/` (`python -m pytest`), the evaluation in
`backend/tests/evaluate_pipeline.py` (`backend/results/RESULTS.md`), and manual checks in the running app.

## Table 3.1 - Test Plan (updated)

| # | Module | Test Case | Expected Output | Actual Output | Status |
|---|---|---|---|---|---|
| 1 | Virtual Space Environment | Run the 3D simulation; play / pause / reset; revisit the Dashboard. | Spacecraft move along their orbits, target tumbles; mission time is not reset by navigation. | Orbit and tumble run (ω = 3.53 °/s); mission is loaded once, so Dashboard visits no longer reset it. | Pass |
| 2 | Virtual Sensor Module | Switch RGB-D / Stereo / Thermal / LiDAR and capture a frame. | Selected view is shown; capture stores image, intrinsics, landmark projections and ground-truth pose. | All views and capture work; captured frame carries camera matrix, 9 landmark projections and ground truth. | Pass |
| 3 | Image Preprocessing | Submit a captured frame to the OpenCV pipeline. | Image is resized, contrast-enhanced, denoised; optional edges. | Pipeline returns processed images for every enabled step. | Pass |
| 4 | Object Detection | Run YOLOv8n on sensor frames / validation set. | Bounding boxes, class and confidence for SAT-001. | P 95.16 %, R 88.43 %, mAP@50 96.87 %, mAP@50-95 76.10 % on 40 validation images. | Pass |
| 5 | Object Tracking | Track the target across consecutive frames (live perception; 400-frame test with misses and false positives). | One persistent track ID; spurious one-frame boxes do not get an ID. | TRK-01 kept throughout; 0 ID switches, 100 % ID consistency even with 30 % missed + 5 % false detections. | Pass |
| 6 | Target Selection | Select SAT-001 in the 3D scene / dashboard. | Target is locked as the active target and highlighted. | Selection and highlighting work; target ID used by pose and reports. | Pass |
| 7 | Feature Extraction & Identification | Build an ORB/SIFT reference library; estimate pose on new viewpoints and on empty frames. | Target identified with enough inliers; empty frames not identified. | ORB identified 75 % of 20 new views (median 0.91° rotation error), SIFT 55 % (median 0.68°); 0/5 false identifications. | Pass |
| 8 | 6-DoF Pose Estimation | solvePnP on 2D-3D landmark correspondences with 0-5 px noise (150 poses, 3 solvers). | Pose equals ground truth without noise; error grows smoothly with noise. | σ = 0: 0.000°, 0.00 %; σ = 1 px: 1.23° / 0.47 % of range; solve time < 0.2 ms. | Pass |
| 9 | Relative Motion Estimation | Estimate relative velocity and tumbling rate from consecutive poses (120 s encounter). | Kalman-filtered values follow ground truth with less noise than raw differences. | σ = 1 px: speed RMSE 0.049 → 0.003 m/s, tumble RMSE 2.07 → 0.04 °/s (raw → Kalman). | Pass |
| 10 | Mission Dashboard | Monitor telemetry, live perception and collision risk during simulation. | Charts and indicators update continuously; estimated vs truth visible. | Telemetry shows raw / Kalman / truth curves and RMSE; Dashboard shows the collision risk badge. | Pass |
| 11 | Database Integration | Save and retrieve mission, detection, pose, tracking and perception records; export. | Records stored in spaceDB; summary and exports downloadable. | All records stored; mission summary API and PDF / JSON / CSV exports work. | Pass |

## Additional test - Collision risk (TTC / CPA)

| Scenario | Truth risk | Risk-level agreement (estimated vs truth) | Median CPA distance error |
|---|---|---|---|
| Approach, 0.5 m miss | HIGH | 91.7 % | 0.019 m |
| Approach, 3 m miss | MEDIUM | 95.4 % | 0.147 m |
| Fly-by, 6 m miss | LOW | 100 % | 0.330 m |

## Automated test suite

| File | What it checks |
|---|---|
| `test_pose_estimation.py` | solvePnP recovers exact pose (3 solvers), noise behaviour, intrinsics, landmarks on the mesh, frontend/backend landmark consistency |
| `test_features.py` | keypoint lifting to 3D, reference library, ORB/SIFT pose on new views, empty-frame rejection, leave-one-out |
| `test_tracking_motion_collision.py` | SORT ID stability, false positives, two targets, angular velocity, Kalman noise reduction, Kalman outlier rejection, TTC/CPA hand-checked cases, perception step, single-target tracking |
| `test_mission_summary.py` | mission report aggregation |
| `test_api_pose.py` | API endpoints (landmarks, pose, feature library, collision, perception step) |
