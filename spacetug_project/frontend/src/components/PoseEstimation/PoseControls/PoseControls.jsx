import "./PoseControls.css";
import { useSensor } from "../../../context/SensorContext";
import { FaVideo, FaEye } from "react-icons/fa";

function PoseControls({
  algorithm = "ITERATIVE",
  setAlgorithm,
  feature = "LANDMARKS",
  setFeature,
  target = "SAT-001",
  setTarget,
  noiseSigma = 0,
  setNoiseSigma,
  excludeOccluded = true,
  setExcludeOccluded,
  autoEstimate = true,
  setAutoEstimate,
  onEstimate,
  landmarkStats = { total: 0, inImage: 0, visible: 0 },
  library = null,
  libraryBusy = false,
  libraryMsg = "",
  onAddToLibrary,
  onClearLibrary,
  autoAddToLibrary = false,
  setAutoAddToLibrary,
}) {
  const imageMode = feature === "ORB" || feature === "SIFT";
  const libViews = library?.views ?? 0;
  const libPoints = imageMode ? library?.methods?.[feature]?.points ?? 0 : null;
  const { sensorThumbnails, liveInferenceData, capturedFrame, poseResult, poseError, isEstimatingPose } =
    useSensor();

  const rgbdFrame =
    capturedFrame?.imageData ||
    sensorThumbnails?.["RGB-D Camera"] ||
    liveInferenceData?.lastFrameUrl;

  const imgSize = capturedFrame?.image_size;
  const canEstimate =
    Boolean(imageMode ? capturedFrame?.imageData : capturedFrame?.landmarks) && !isEstimatingPose;

  // Frames from the gallery / uploads / older captures carry no camera + landmark geometry
  const missingGeometry = Boolean(capturedFrame) && !imageMode && !capturedFrame?.landmarks;
  const missingGroundTruth = Boolean(capturedFrame) && imageMode && !capturedFrame?.camera_matrix;

  let statusClass = "pose-status-idle";
  let statusText = capturedFrame ? "Ready to estimate" : "No frame captured";
  if (missingGeometry || missingGroundTruth) {
    statusClass = "pose-status-fail";
    statusText = "No pose data in this frame - capture a NEW frame on the Sensors page";
  }
  if (isEstimatingPose) {
    statusClass = "pose-status-busy";
    statusText = "Solving...";
  } else if (poseResult?.success) {
    statusClass = "pose-status-ok";
    statusText = poseResult.identification
      ? `${poseResult.identification} · ${poseResult.inliers} inliers`
      : `Pose solved (${poseResult.method})`;
  } else if (poseError && !(missingGeometry || missingGroundTruth)) {
    statusClass = "pose-status-fail";
    statusText = "Pose failed";
  }

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
            <span>{capturedFrame ? "CAPTURED FRAME" : "NO CAPTURE YET"}</span>
          </div>
          <div className="sensor-feed-sub">
            <span className="sensor-feed-fps">{capturedFrame?.selectedSensor || "Capture a frame in Sensors"}</span>
            {imgSize && <span className="sensor-feed-res">{imgSize[0]}×{imgSize[1]}</span>}
            {capturedFrame && (
              <span className="sensor-feed-tag">
                {landmarkStats.visible}/{landmarkStats.total} landmarks visible
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="pose-controls-inner">
        <div className="control-item">
          <label>Solver</label>
          <select value={algorithm} onChange={(e) => setAlgorithm && setAlgorithm(e.target.value)}>
            <option value="ITERATIVE">solvePnP (Iterative)</option>
            <option value="EPNP">EPnP</option>
            <option value="SQPNP">SQPnP</option>
          </select>
        </div>

        <div className="control-item">
          <label>Keypoints</label>
          <select value={feature} onChange={(e) => setFeature && setFeature(e.target.value)}>
            <option value="LANDMARKS">Projected landmarks (simulated)</option>
            <option value="ORB">ORB feature matching</option>
            <option value="SIFT">SIFT feature matching</option>
            <option value="DINOv1" disabled>DINOv1 (Future Work)</option>
          </select>
        </div>

        <div className="control-item">
          <label>Target</label>
          <select value={target} onChange={(e) => setTarget && setTarget(e.target.value)}>
            <option value="SAT-001">SAT-001</option>
          </select>
        </div>

        {imageMode ? (
          <div className="control-item library-control" title="Reference frames with known pose. Features are matched against these views.">
            <label>Library</label>
            <span className="library-count">
              {libViews} views · {libPoints} pts
            </span>
            <button type="button" className="lib-btn" disabled={libraryBusy || !capturedFrame} onClick={() => onAddToLibrary && onAddToLibrary()}>
              + Add frame
            </button>
            <button type="button" className="lib-btn lib-btn-clear" disabled={libraryBusy || !libViews} onClick={() => onClearLibrary && onClearLibrary()}>
              Clear
            </button>
            <label className="control-check" title="Every new capture (with ground-truth pose) is added to the library automatically. A frame is never matched against itself.">
              <input
                type="checkbox"
                checked={autoAddToLibrary}
                onChange={(e) => setAutoAddToLibrary && setAutoAddToLibrary(e.target.checked)}
              />
              Auto-add captures
            </label>
            {libraryMsg && <span className="library-msg">{libraryMsg}</span>}
          </div>
        ) : (
        <>
        <div className="control-item noise-control" title="Gaussian pixel noise added to the 2D landmarks to simulate keypoint detection error">
          <label>Noise σ</label>
          <input
            type="range"
            min="0"
            max="5"
            step="0.5"
            value={noiseSigma}
            onChange={(e) => setNoiseSigma && setNoiseSigma(Number(e.target.value))}
          />
          <span className="noise-value">{Number(noiseSigma).toFixed(1)} px</span>
        </div>

        <label className="control-check" title="Ignore landmarks hidden behind the spacecraft body">
          <input
            type="checkbox"
            checked={excludeOccluded}
            onChange={(e) => setExcludeOccluded && setExcludeOccluded(e.target.checked)}
          />
          Skip occluded
        </label>
        </>
        )}

        <label className="control-check" title="Estimate automatically when a new frame is captured">
          <input
            type="checkbox"
            checked={autoEstimate}
            onChange={(e) => setAutoEstimate && setAutoEstimate(e.target.checked)}
          />
          Auto
        </label>

        <button
          type="button"
          className="estimate-pose-btn"
          disabled={!canEstimate}
          onClick={() => onEstimate && onEstimate()}
          title={capturedFrame ? "Run OpenCV solvePnP on the captured frame" : "Capture a frame from the Sensors page first"}
        >
          {isEstimatingPose ? "Solving..." : "Estimate Pose"}
        </button>

        <div className={`pose-locked-badge ${statusClass}`} title={poseError || ""}>
          <span className="status-dot">●</span> {statusText}
        </div>
      </div>
    </header>
  );
}

export default PoseControls;
