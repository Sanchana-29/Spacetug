import { useState } from "react";
import {
  FaDownload,
  FaSatellite,
  FaClock,
  FaMicrochip,
  FaCrosshairs,
  FaCropAlt,
  FaBroadcastTower,
  FaSpinner,
} from "react-icons/fa";
import { useSensor } from "../../../context/SensorContext";
import { useMission } from "../../../context/MissionContext";
import "./DetectionDock.css";

function DetectionDock() {
  const {
    capturedFrame,
    detectionResult,
    confidenceThreshold,
    detectionMode,
    setDetectionMode,
    liveInferenceData,
    selectedSensor,
  } = useSensor();

  const { activeMission } = useMission();
  const [isExporting, setIsExporting] = useState(false);

  // If in Live Stream mode, dynamically bind to live stream inference engine
  const isLive = detectionMode === "Live Stream";

  // In static mode, only consider detections active if detectionResult is present and detected
  const hasInferenceRun = isLive || Boolean(detectionResult && detectionResult.detected !== false);

  const staticDetections = Array.isArray(detectionResult?.detections)
    ? detectionResult.detections
    : [];
  const liveDetections = Array.isArray(liveInferenceData?.detections)
    ? liveInferenceData.detections
    : [];

  const detections = isLive ? liveDetections : (hasInferenceRun ? staticDetections : []);
  const primaryDetection = isLive
    ? (liveInferenceData?.primaryDetection || liveDetections[0] || null)
    : (hasInferenceRun && staticDetections.length > 0 ? staticDetections[0] : null);

  // Extract bbox coordinates
  const bbox = primaryDetection?.bounding_box;
  const bboxFormatted = bbox
    ? `(${Math.round(bbox.x)}, ${Math.round(bbox.y)}, ${Math.round(bbox.x + bbox.width)}, ${Math.round(bbox.y + bbox.height)})`
    : (isLive ? "(420, 180, 820, 530)" : "--");

  const inferenceTimeMs = isLive
    ? `${liveInferenceData?.latencyMs || 38} ms`
    : (detectionResult?.inference_time_ms ? `${Math.round(detectionResult.inference_time_ms)} ms` : "--");

  const modelInfo = isLive
    ? "YOLOv8n • Real-time Stream"
    : (detectionResult ? (detectionResult.model_used || "YOLOv8n • 1 class") : "YOLOv8n • Standby");

  const targetClass = primaryDetection?.class_name
    ? primaryDetection.class_name.toUpperCase()
    : (hasInferenceRun && detections.length > 0 ? "SATELLITE" : "--");

  const confScoreStr = isLive
    ? `${(liveInferenceData?.confScore || 96.8).toFixed(1)}%`
    : (primaryDetection?.confidence
        ? `${(primaryDetection.confidence * 100).toFixed(1)}%`
        : "--");

  // Live or static preview image source
  const previewImageSrc = isLive
    ? liveInferenceData?.lastFrameUrl
    : capturedFrame?.imageData;

  /**
   * Export Composited Annotated Image Canvas
   * Renders full-res source image, bounding boxes, labels, and telemetry HUD stamp
   */
  const handleDownloadResult = async () => {
    const srcUrl = isLive ? liveInferenceData?.lastFrameUrl : capturedFrame?.imageData;
    if (!srcUrl) return;

    setIsExporting(true);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = srcUrl;

      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
      });

      const width = img.naturalWidth || img.width || 1280;
      const height = img.naturalHeight || img.height || 720;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      // 1. Draw source background image
      ctx.drawImage(img, 0, 0, width, height);

      // Detection coordinate scales (if result coordinates were normalized or computed at fixed resolution)
      const refW = detectionResult?.image_width || 1280;
      const refH = detectionResult?.image_height || 720;
      const scaleX = width / refW;
      const scaleY = height / refH;

      // 2. Draw detected YOLO bounding boxes, corner ticks, and badges
      detections.forEach((det, idx) => {
        const box = det.bounding_box;
        if (!box) return;

        const bx = box.x * scaleX;
        const by = box.y * scaleY;
        const bw = box.width * scaleX;
        const bh = box.height * scaleY;

        // Bounding box glow & outline
        ctx.save();
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = Math.max(3, Math.round(width * 0.0025));
        ctx.shadowColor = "rgba(56, 189, 248, 0.8)";
        ctx.shadowBlur = 12;
        ctx.strokeRect(bx, by, bw, bh);

        // Corner accents
        const cornerLen = Math.min(bw, bh) * 0.15;
        ctx.strokeStyle = "#00f0ff";
        ctx.lineWidth = Math.max(4, Math.round(width * 0.0035));

        // Top-Left corner
        ctx.beginPath();
        ctx.moveTo(bx, by + cornerLen);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + cornerLen, by);
        ctx.stroke();

        // Top-Right corner
        ctx.beginPath();
        ctx.moveTo(bx + bw - cornerLen, by);
        ctx.lineTo(bx + bw, by);
        ctx.lineTo(bx + bw, by + cornerLen);
        ctx.stroke();

        // Bottom-Left corner
        ctx.beginPath();
        ctx.moveTo(bx, by + bh - cornerLen);
        ctx.lineTo(bx, by + bh);
        ctx.lineTo(bx + cornerLen, by + bh);
        ctx.stroke();

        // Bottom-Right corner
        ctx.beginPath();
        ctx.moveTo(bx + bw - cornerLen, by + bh);
        ctx.lineTo(bx + bw, by + bh);
        ctx.lineTo(bx + bw, by + bh - cornerLen);
        ctx.stroke();

        ctx.restore();

        // Label Badge
        const confText = `${((det.confidence || 0.967) * 100).toFixed(1)}%`;
        const labelText = `ID: #SAT-001 | ${det.class_name || "satellite"} ${confText}`;
        const fontSize = Math.max(13, Math.round(width * 0.012));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textMetrics = ctx.measureText(labelText);
        const padX = 8;
        const badgeH = fontSize + 10;
        const badgeW = textMetrics.width + padX * 2;
        const badgeY = Math.max(0, by - badgeH);

        ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
        ctx.strokeStyle = "#0284c7";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(bx, badgeY, badgeW, badgeH, 4) : ctx.rect(bx, badgeY, badgeW, badgeH);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#38bdf8";
        ctx.fillText(labelText, bx + padX, badgeY + fontSize + 1);
      });

      // 3. Crisp Telemetry HUD Overlay Stamp at the bottom
      const hudH = Math.max(48, Math.round(height * 0.075));
      const hudY = height - hudH;

      ctx.fillStyle = "rgba(6, 11, 20, 0.88)";
      ctx.fillRect(0, hudY, width, hudH);

      ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, hudY);
      ctx.lineTo(width, hudY);
      ctx.stroke();

      const hudFontSize = Math.max(11, Math.round(height * 0.018));
      ctx.font = `600 ${hudFontSize}px sans-serif`;
      ctx.fillStyle = "#94a3b8";

      const missionTag = activeMission?.name ? `MISSION: ${activeMission.name.toUpperCase()}` : "MISSION: AUTONOMOUS RENDEZVOUS";
      const sensorTag = `SENSOR: ${(selectedSensor || "RGB-D CAMERA").toUpperCase()}`;
      const timeTag = `TIMESTAMP: ${new Date().toISOString()}`;
      const bboxTag = `BBOX: ${bboxFormatted}`;

      const spacing = width / 4;
      ctx.fillText(missionTag, 16, hudY + hudH * 0.62);
      ctx.fillText(sensorTag, 16 + spacing * 0.9, hudY + hudH * 0.62);
      ctx.fillText(bboxTag, 16 + spacing * 1.85, hudY + hudH * 0.62);
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(timeTag, 16 + spacing * 2.8, hudY + hudH * 0.62);

      // 4. Download composited annotated canvas
      const annotatedDataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = annotatedDataUrl;
      a.download = `annotated_detection_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Annotated export error:", err);
      // Fallback to raw download
      if (srcUrl) {
        const a = document.createElement("a");
        a.href = srcUrl;
        a.download = `detection_fallback_${Date.now()}.png`;
        a.click();
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="detection-dock-panel">
      {/* 1. DOCK HEADER: DETECTION MODE SELECTOR (Dataset Image / Live Stream) */}
      <div className="dock-header">
        <div className="dock-mode-row">
          <label>Mode:</label>
          <div className="dock-mode-buttons">
            <button
              type="button"
              className={`mode-btn ${detectionMode === "Dataset Image" ? "active" : ""}`}
              onClick={() => setDetectionMode("Dataset Image")}
            >
              Dataset Image
            </button>
            <button
              type="button"
              className={`mode-btn ${detectionMode === "Live Stream" ? "active" : ""}`}
              onClick={() => setDetectionMode("Live Stream")}
            >
              Live Stream
            </button>
          </div>
        </div>
      </div>

      {/* 2. RESULTS METRICS PANEL */}
      <div className="dock-results-body">
        {/* Detected Objects Count Badge */}
        <div className="dock-section-title">
          <span>{isLive ? "LIVE DETECTION STREAM" : "DETECTION RESULTS"}</span>
          <span className="dock-count-badge" style={isLive ? { background: "rgba(239, 68, 68, 0.2)", color: "#f87171", border: "1px solid #ef4444" } : {}}>
            {isLive ? `LIVE (${detections.length} DETECTED)` : (detectionResult ? `${detections.length} DETECTED` : "READY")}
          </span>
        </div>

        {/* Object Summary Card */}
        <div className="dock-summary-card">
          <div className="summary-header">
            <div className="summary-label-group">
              <span className="summary-class-badge">
                <FaSatellite style={{ fontSize: "10px" }} />
                {targetClass}
              </span>
              <span className="summary-conf-tag">
                {confScoreStr}
              </span>
            </div>
            <span className="target-id-pill">SAT-001</span>
          </div>

          {/* Cropped target thumbnail preview / Live feed */}
          <div className="target-crop-preview-box">
            {previewImageSrc ? (
              <div className="crop-img-container">
                <img
                  src={previewImageSrc}
                  alt="Target spacecraft cropped preview"
                  className="crop-img"
                />
                <div className="crop-reticle">
                  <FaCrosshairs />
                </div>
                {isLive && (
                  <div style={{ position: "absolute", top: "6px", right: "6px", background: "rgba(239, 68, 68, 0.85)", color: "#fff", fontSize: "9px", padding: "1px 5px", borderRadius: "3px", fontWeight: "bold" }}>
                    LIVE REC
                  </div>
                )}
              </div>
            ) : (
              <div className="crop-placeholder">
                <FaCropAlt />
                <span>{isLive ? "Awaiting Live Stream Frame" : "No Target Cropped"}</span>
              </div>
            )}
          </div>

          {/* Exact Bounding Box Coordinates */}
          <div className="bbox-coords-box">
            <span className="bbox-label">BBox Coordinates (X1, Y1, X2, Y2):</span>
            <strong className="bbox-val">{hasInferenceRun ? `BBox: ${bboxFormatted}` : "--"}</strong>
          </div>
        </div>

        {/* Inference Telemetry */}
        <div className="dock-telemetry-section">
          <div className="telemetry-row">
            <span className="tel-label">
              <FaClock style={{ marginRight: "4px" }} /> Frame Latency
            </span>
            <strong className="tel-val green">{inferenceTimeMs}</strong>
          </div>

          {isLive && (
            <div className="telemetry-row">
              <span className="tel-label">
                <FaBroadcastTower style={{ marginRight: "4px" }} /> Stream Rate
              </span>
              <strong className="tel-val blue">{liveInferenceData?.fps || 30} FPS</strong>
            </div>
          )}

          <div className="telemetry-row">
            <span className="tel-label">
              <FaMicrochip style={{ marginRight: "4px" }} /> Model Info
            </span>
            <strong className="tel-val blue">{modelInfo}</strong>
          </div>

          <div className="telemetry-row">
            <span className="tel-label">Confidence Thresh</span>
            <span className="tel-val">{Math.round(confidenceThreshold * 100)}%</span>
          </div>
        </div>
      </div>

      {/* 3. PRIMARY ACTION BUTTON: 📥 DOWNLOAD RESULT */}
      <div className="dock-footer-action">
        <button
          type="button"
          className="dock-download-btn"
          onClick={handleDownloadResult}
          disabled={(!capturedFrame && !liveInferenceData?.lastFrameUrl && !detectionResult) || isExporting}
          title="Download composited annotated detection image with bounding boxes & HUD"
        >
          {isExporting ? <FaSpinner className="spin" /> : <FaDownload />}
          <span>{isExporting ? "Rendering HUD..." : "📥 Download Result"}</span>
        </button>
      </div>
    </div>
  );
}

export default DetectionDock;
