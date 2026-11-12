import { useMemo } from "react";
import { FaImages, FaClock, FaCheckCircle, FaSatellite } from "react-icons/fa";
import { useSensor } from "../../../context/SensorContext";
import "./CapturedGallery.css";

function CapturedGallery() {
  const {
    missionGallery,
    capturedFrame,
    setCapturedFrame,
    detectionResult,
    setDetectionMode,
  } = useSensor();

  const activeFrameId = capturedFrame?.id;

  const handleSelectFrame = (frame) => {
    if (!frame) return;
    setDetectionMode("Dataset Image");
    setCapturedFrame(frame);
  };

  return (
    <div className="captured-gallery-panel">
      {/* Header */}
      <div className="gallery-header">
        <div className="gallery-title-group">
          <FaImages className="gallery-icon" />
          <h3>Captured Frames</h3>
        </div>
        <span className="gallery-count-badge">
          {missionGallery.length} {missionGallery.length === 1 ? "Frame" : "Frames"}
        </span>
      </div>

      {/* Gallery Scroll List */}
      <div className="gallery-scroll-area">
        {missionGallery.length === 0 ? (
          <div className="gallery-empty-state">
            <FaImages className="gallery-empty-icon" />
            <p>No captured frames yet</p>
            <span>Capture frames from Sensors page or upload an image to build mission history.</span>
          </div>
        ) : (
          missionGallery.map((item, idx) => {
            const isSelected = item.id === activeFrameId;
            // Generate clean human-readable filename (e.g. frame_001.png or custom upload name)
            const fallbackIdx = String(missionGallery.length - idx).padStart(3, "0");
            const filename = item.filename || (item.id?.startsWith("UPLOAD") ? "upload_frame.png" : `frame_${fallbackIdx}.png`);
            
            // Format timestamp (e.g. 10:32 AM)
            let formattedTimeStr = item.formattedTime;
            if (!formattedTimeStr && item.timestamp) {
              try {
                formattedTimeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
              } catch {
                formattedTimeStr = "--";
              }
            } else if (!formattedTimeStr) {
              formattedTimeStr = "10:32 AM";
            }

            const sensorLabel = item.selectedSensor || item.sensorType || "Sensor Feed";
            const detectionCount = item.detectionsCount ?? (
              isSelected && detectionResult?.detections
                ? detectionResult.detections.length
                : (item.detections ? item.detections.length : null)
            );

            return (
              <button
                key={item.id || idx}
                type="button"
                className={`gallery-card ${isSelected ? "selected" : ""}`}
                onClick={() => handleSelectFrame(item)}
                title={`Click to load ${filename} into detection viewer`}
              >
                {/* Thumbnail Preview */}
                <div className="gallery-card-thumb">
                  {item.imageData ? (
                    <img src={item.imageData} alt={filename} loading="lazy" />
                  ) : (
                    <div className="gallery-card-placeholder">NO PREVIEW</div>
                  )}

                  {/* Active Selection Indicator Tick */}
                  {isSelected && (
                    <div className="gallery-active-tick" title="Active Frame">
                      <FaCheckCircle />
                    </div>
                  )}
                </div>

                {/* Card Metadata */}
                <div className="gallery-card-info">
                  <div className="gallery-card-top">
                    <strong className="gallery-filename" title={filename}>
                      {filename}
                    </strong>
                    {detectionCount != null && (
                      <span className="gallery-det-badge" title="Target detections count">
                        <FaSatellite style={{ fontSize: "8px" }} />
                        {detectionCount}
                      </span>
                    )}
                  </div>

                  <div className="gallery-card-meta">
                    <span className="gallery-sensor-label">{sensorLabel}</span>
                    <span className="gallery-time">
                      <FaClock style={{ fontSize: "9px", marginRight: "3px" }} />
                      {formattedTimeStr}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default CapturedGallery;
