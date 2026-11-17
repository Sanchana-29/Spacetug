import "./PoseControls.css";
import { useSensor } from "../../../context/SensorContext";
import { FaVideo, FaEye } from "react-icons/fa";

function PoseControls({
  algorithm = "SolvePnP",
  setAlgorithm,
  feature = "ORB",
  setFeature,
  target = "SAT-001",
  setTarget,
}) {
  const { sensorThumbnails, liveInferenceData, capturedFrame } = useSensor();

  // Find active RGB-D camera stream frame
  const rgbdFrame =
    sensorThumbnails?.["RGB-D Camera"] ||
    sensorThumbnails?.["RGB-D"] ||
    liveInferenceData?.lastFrameUrl ||
    capturedFrame?.imageData;

  return (
    <header className="pose-controls-bar">
      {/* LEFT: SENSOR STREAM INTEGRATION (RGB-D CAMERA FEED) */}
      <div className="pose-sensor-feed-pill">
        <div className="sensor-feed-thumb-wrap">
          {rgbdFrame ? (
            <img
              src={rgbdFrame}
              alt="Live RGB-D Sensor Stream"
              className="sensor-feed-thumb-img"
            />
          ) : (
            <div className="sensor-feed-thumb-fallback">
              <FaEye />
            </div>
          )}
          <span className="sensor-live-dot" />
        </div>
        <div className="sensor-feed-meta">
          <div className="sensor-feed-title">
            <FaVideo className="sensor-icon" />
            <span>RGB-D SENSOR STREAM</span>
          </div>
          <div className="sensor-feed-sub">
            <span className="sensor-feed-fps">30 FPS</span>
            <span className="sensor-feed-res">1280×720</span>
            <span className="sensor-feed-tag">OPTICAL FEED INGEST</span>
          </div>
        </div>
      </div>

      <div className="pose-controls-inner">
        <div className="control-item">
          <label>Algorithm</label>
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm && setAlgorithm(e.target.value)}
          >
            <option value="SolvePnP">SolvePnP</option>
            <option value="EPnP">EPnP</option>
            <option value="IPPE">IPPE</option>
          </select>
        </div>

        <div className="control-item">
          <label>Feature</label>
          <select
            value={feature}
            onChange={(e) => setFeature && setFeature(e.target.value)}
          >
            <option value="ORB">ORB</option>
            <option value="SIFT">SIFT</option>
            <option value="DINOv1">DINOv1</option>
          </select>
        </div>

        <div className="control-item">
          <label>Target</label>
          <select
            value={target}
            onChange={(e) => setTarget && setTarget(e.target.value)}
          >
            <option value="SAT-001">SAT-001</option>
            <option value="SAT-002">SAT-002</option>
            <option value="Debris-001">Debris-001</option>
          </select>
        </div>

        <div className="pose-locked-badge">
          <span className="status-dot">●</span> Pose Locked
        </div>
      </div>
    </header>
  );
}

export default PoseControls;
