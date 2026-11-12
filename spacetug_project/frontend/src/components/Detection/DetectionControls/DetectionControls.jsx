import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./DetectionControls.css";
import { FaPlay, FaSpinner, FaCamera } from "react-icons/fa";
import { useSensor } from "../../../context/SensorContext";

function DetectionControls() {
  const {
    capturedFrame,
    isDetecting,
    runDetection,
    confidenceThreshold,
    setConfidenceThreshold,
  } = useSensor();

  const navigate = useNavigate();
  const percentage = Math.round(confidenceThreshold * 100);

  return (
    <div className="detection-controls">
      {/* LEFT/CENTER: CONFIDENCE THRESHOLD & DETECTOR PIPELINE LABEL */}
      <div className="controls-left-group">
        <div className="control-group threshold-group">
          <label>Confidence Threshold: <strong>{percentage}%</strong></label>
          <input
            type="range"
            min="1"
            max="100"
            value={percentage}
            onChange={(e) => setConfidenceThreshold(Number(e.target.value) / 100)}
          />
        </div>

        <div className="control-group pipeline-label-group">
          <label>Detector Pipeline</label>
          <div className="pipeline-name-pill">
            YOLOv8n Satellite Detector
          </div>
        </div>
      </div>

      {/* RIGHT: 📷 NEW CAPTURE & ▶ RUN DETECTION */}
      <div className="controls-right-actions">
        {/* 📷 NEW CAPTURE BUTTON -> Navigates to /sensors */}
        <button
          type="button"
          className="new-capture-btn"
          onClick={() => navigate("/sensors")}
          title="Go to Sensors page to capture new frame snapshots"
        >
          <FaCamera className="btn-icon" />
          <span>📷 NEW CAPTURE</span>
        </button>

        {/* ▶ RUN DETECTION BUTTON */}
        <button
          type="button"
          className={`run-detection-btn ${isDetecting ? "running" : ""}`}
          onClick={() => runDetection(confidenceThreshold)}
          disabled={!capturedFrame || isDetecting}
          title={!capturedFrame ? "Capture or select a frame first" : "Execute YOLOv8n satellite detection"}
        >
          {isDetecting ? (
            <>
              <FaSpinner className="spinner-icon" />
              <span>RUNNING...</span>
            </>
          ) : (
            <>
              <FaPlay className="btn-icon" />
              <span>▶ RUN DETECTION</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default DetectionControls;
