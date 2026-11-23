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
  const canEstimate = !isEstimatingPose;

  // Frames from the gallery / uploads / older captures carry no camera + landmark geometry
  const missingGeometry = Boolean(capturedFrame) && !imageMode && !capturedFrame?.landmarks;
  const missingGroundTruth = Boolean(capturedFrame) && imageMode && !capturedFrame?.camera_matrix;

  let statusClass = "pose-status-idle";
  let statusText = `Pose ready (${algorithm})`;
  if (missingGeometry || missingGroundTruth) {
    statusClass = "pose-status-fail";
    statusText = "No pose geometry in this frame - capture a new frame";
  } else if (isEstimatingPose) {
    statusClass = "pose-status-busy";
    statusText = `Solving (${algorithm})...`;
  } else if (poseResult?.success) {
    statusClass = "pose-status-ok";
    statusText = poseResult.identification
      ? `${poseResult.identification} · ${poseResult.inliers} inliers`
      : `Pose solved (${poseResult.method || algorithm})`;
  } else if (poseError) {
    statusClass = "pose-status-fail";
    statusText = `Pose failed (${algorithm})`;
  }

  const handleAlgorithmChange = (e) => {
    const val = e.target.value;
    setAlgorithm && setAlgorithm(val);
    if (autoEstimate && onEstimate) {
      onEstimate({ algorithm: val });
    }
  };

  const handleFeatureChange = (e) => {
    const val = e.target.value;
    setFeature && setFeature(val);
    if (autoEstimate && onEstimate) {
      onEstimate({ feature: val });
    }
  };

  const handleNoiseChange = (e) => {
    const val = Number(e.target.value);
    setNoiseSigma && setNoiseSigma(val);
    if (autoEstimate && onEstimate) {
      onEstimate({ noiseSigma: val });
    }
  };

  const handleOccludedChange = (e) => {
    const val = e.target.checked;
    setExcludeOccluded && setExcludeOccluded(val);
    if (autoEstimate && onEstimate) {
      onEstimate({ excludeOccluded: val });
    }
  };

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
            <span>{capturedFrame ? "SNAPSHOT LOCKED" : "LIVE RGB-D STREAM"}</span>
          </div>
          <div className="sensor-feed-sub">
            <span className="sensor-feed-fps">{capturedFrame?.selectedSensor || "RGB-D Camera"}</span>
            <span className="sensor-feed-res">{imgSize ? `${imgSize[0]}×${imgSize[1]}` : "1280×720"}</span>
            <span className="sensor-feed-tag" style={{ color: (landmarkStats.visible ?? 7) < 6 ? "#f59e0b" : "#38bdf8" }}>
              {(landmarkStats.visible ?? 7) < 6 ? "⚠ Low Confidence (< 6 Landmarks) · " : ""}
              {landmarkStats.visible ?? 7}/{landmarkStats.total || 9} landmarks visible
            </span>
          </div>
        </div>
      </div>

      <div className="pose-controls-inner">
        <div className="control-item">
          <label>Solver</label>
          <select value={algorithm} onChange={handleAlgorithmChange}>
            <option value="ITERATIVE">solvePnP (Iterative)</option>
            <option value="EPNP">EPnP</option>
            <option value="SQPNP">SQPnP</option>
          </select>
        </div>

        <div className="control-item">
          <label>Keypoints</label>
          <select value={feature} onChange={handleFeatureChange}>
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
            {!libraryMsg && libViews < 5 && (
              <span className="library-msg">
                Library is built automatically from the live camera feed (one view every 3 s, up to 20).
                Wait ~30 s with the simulation running, then estimate.
              </span>
            )}
          </div>
        ) : (
        <>
        <div className="control-item noise-control" title="Gaussian pixel noise added to the 2D landmarks to simulate keypoint detection error">
          <label>Noise σ</label>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <input
              type="range"
              min="0"
              max="5"
              step="0.5"
              value={noiseSigma}
              onChange={handleNoiseChange}
            />
            <span className="noise-value">{Number(noiseSigma).toFixed(1)} px</span>
            <div style={{ display: "inline-flex", gap: "2px", marginLeft: "4px" }}>
              {[0, 1, 2, 5].map((val) => (
                <button
                  key={`noise-preset-${val}`}
                  type="button"
                  style={{
                    background: noiseSigma === val ? "#38bdf8" : "#1e293b",
                    color: noiseSigma === val ? "#0f172a" : "#94a3b8",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                    borderRadius: "3px",
                    padding: "1px 4px",
                    fontSize: "9px",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                  onClick={() => {
                    setNoiseSigma && setNoiseSigma(val);
                    if (autoEstimate && onEstimate) {
                      onEstimate({ noiseSigma: val });
                    }
                  }}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="control-check" title="Ignore landmarks hidden behind the spacecraft body">
          <input
            type="checkbox"
            checked={excludeOccluded}
            onChange={handleOccludedChange}
          />
          Skip occluded
        </label>
        </>
        )}

        <label className="control-check" title="Estimate automatically when a new frame is captured or parameters change">
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
          title="Run OpenCV solvePnP on current frame"
        >
          {isEstimatingPose ? `Solving (${algorithm})...` : "Estimate Pose"}
        </button>

        <div className={`pose-locked-badge ${statusClass}`} title={poseError || ""}>
          <span className="status-dot">●</span> {statusText}
        </div>
      </div>
    </header>
  );
}

export default PoseControls;
