import { useState, useRef, useEffect } from "react";
import Layout from "../components/Layout/Layout";
import {
  runImageProcessingPipelineApi,
  dataURLtoBlob,
} from "../services/api";
import { useSensor } from "../context/SensorContext";
import { useMission } from "../context/MissionContext";
import { useNavigate } from "react-router-dom";
import "./ProcessingPipeline.css";

import {
  FaSlidersH,
  FaUpload,
  FaPlay,
  FaUndo,
  FaDownload,
  FaEye,
  FaCheckCircle,
  FaExclamationTriangle,
  FaCamera,
  FaLayerGroup,
} from "react-icons/fa";

const SENSOR_MODES = [
  { id: "RGB-D Camera", label: "RGB-D Optical" },
  { id: "Stereo Camera", label: "Stereo (Left/Right)" },
  { id: "Thermal Camera", label: "Thermal IR" },
  { id: "LiDAR", label: "LiDAR Intensity" },
];

function ProcessingPipelinePage() {
  const navigate = useNavigate();
  const { setCapturedFrame, capturedFrame, selectedSensor, setSelectedSensor, sensorThumbnails, missionGallery } = useSensor();
  const { activeMission } = useMission();

  const [inputMode, setInputMode] = useState("SIMULATION"); // "SIMULATION", "GALLERY", "UPLOAD"
  const [activeSensorChoice, setActiveSensorChoice] = useState(selectedSensor || "RGB-D Camera");
  const [captureSource, setCaptureSource] = useState(selectedSensor || "RGB-D Camera");
  
  const [originalImage, setOriginalImage] = useState(() => {
    const thumb = sensorThumbnails[selectedSensor] || sensorThumbnails["RGB-D Camera"];
    if (thumb) return thumb;
    if (capturedFrame?.imageData) return capturedFrame.imageData;
    return null;
  });
  
  const [processedImage, setProcessedImage] = useState(null);
  const [processedFilename, setProcessedFilename] = useState(null);
  const [stages, setStages] = useState([]);

  // Sliders and controls for real-time enhancement
  const [brightness, setBrightness] = useState(0); // -80 to 80
  const [contrast, setContrast] = useState(1.0); // 0.2 to 2.5
  
  // Blur Filtering: Gaussian & Median
  const [blurMode, setBlurMode] = useState("gaussian"); // "gaussian" or "median"
  const [blurIntensity, setBlurIntensity] = useState(0); // 0 to 15
  
  // Edge Detection: Canny & Sobel
  const [edgeDetection, setEdgeDetection] = useState(false);
  const [edgeOperator, setEdgeOperator] = useState("canny"); // "canny" or "sobel"

  // Additional feature toggles
  const [grayscale, setGrayscale] = useState(false);
  const [sharpen, setSharpen] = useState(false);
  const [denoise, setDenoise] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  const fileInputRef = useRef(null);

  // Auto-sync sensor choice if context updates
  useEffect(() => {
    if (sensorThumbnails[activeSensorChoice] && inputMode === "SIMULATION" && !originalImage) {
      setOriginalImage(sensorThumbnails[activeSensorChoice]);
      setCaptureSource(activeSensorChoice);
    }
  }, [sensorThumbnails, activeSensorChoice, inputMode, originalImage]);

  // Capture from live simulation or selected sensor feed
  const handleCaptureFromSensor = (sensorName = activeSensorChoice) => {
    try {
      setActiveSensorChoice(sensorName);
      if (setSelectedSensor) {
        setSelectedSensor(sensorName);
      }

      // Check captured thumbnails first
      const thumb = sensorThumbnails[sensorName] || 
        (sensorName === "Stereo Camera" ? sensorThumbnails["Stereo Left"] || sensorThumbnails["Stereo Right"] : null);

      if (thumb) {
        setOriginalImage(thumb);
        setProcessedImage(null);
        setStages([]);
        setCaptureSource(`${sensorName} Snapshot`);
        setError(null);
        setStatusMsg(`Loaded sensor frame snapshot from ${sensorName}.`);
        return;
      }

      // Query active sensor canvas if available
      const canvas = document.querySelector("#sensor-main-canvas canvas, .sensor-viewer canvas, .sensors-page canvas");
      if (canvas) {
        const capturedData = canvas.toDataURL("image/png");
        if (capturedData && capturedData !== "data:,") {
          setOriginalImage(capturedData);
          setProcessedImage(null);
          setStages([]);
          setCaptureSource(`${sensorName} (Live WebGL Feed)`);
          setError(null);
          setStatusMsg(`Captured live ${sensorName} sensor frame.`);
          return;
        }
      }

      // Fallback to active captured frame
      if (capturedFrame?.imageData) {
        setOriginalImage(capturedFrame.imageData);
        setProcessedImage(null);
        setStages([]);
        setCaptureSource(capturedFrame.selectedSensor || "Captured Sensor Frame");
        setError(null);
        setStatusMsg(`Loaded recent captured frame: ${capturedFrame.selectedSensor || "Sensor"}`);
        return;
      }

      setError(`No active ${sensorName} frame cached. Capture a frame on the Sensors page first or upload an image.`);
    } catch (err) {
      console.warn("Sensor capture error:", err);
      setError("Failed to capture sensor frame buffer.");
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvt) => {
      setOriginalImage(loadEvt.target.result);
      setProcessedImage(null);
      setStages([]);
      setCaptureSource(`Uploaded Image (${file.name})`);
      setError(null);
      setStatusMsg("Frame loaded from local file. Adjust enhancement controls and apply processing.");
    };
    reader.readAsDataURL(file);
  };

  const applyProcessing = async () => {
    if (!originalImage) {
      setError("Please capture or load a sensor frame first.");
      return;
    }

    setProcessing(true);
    setError(null);
    setStatusMsg(null);

    try {
      const blob = dataURLtoBlob(originalImage);
      const res = await runImageProcessingPipelineApi(blob, {
        brightness,
        contrast,
        grayscale,
        gaussian_blur: blurMode === "gaussian" ? blurIntensity : 0,
        median_blur: blurMode === "median" ? blurIntensity : 0,
        blur_mode: blurMode,
        sharpen,
        denoise,
        edge_detection: edgeDetection,
        edge_operator: edgeOperator,
      });

      setProcessedImage(res.processed_image_url);
      setProcessedFilename(res.processed_filename);
      setStages(res.stages_executed || []);
      setStatusMsg(`Applied ${res.stages_executed?.length || 0} OpenCV enhancement & preprocessing stages.`);
    } catch (err) {
      setError(err.message || "Image preprocessing pipeline failed");
    } finally {
      setProcessing(false);
    }
  };

  const resetToOriginal = () => {
    setBrightness(0);
    setContrast(1.0);
    setBlurMode("gaussian");
    setBlurIntensity(0);
    setEdgeDetection(false);
    setEdgeOperator("canny");
    setGrayscale(false);
    setSharpen(false);
    setDenoise(false);
    setProcessedImage(null);
    setStages([]);
    setStatusMsg("Enhancement parameters reset to defaults.");
  };

  // Push the enhanced frame into SensorContext so YOLOv8n object detection executes on preprocessed pixels
  const sendToDetection = () => {
    const imgToSend = processedImage || originalImage;
    if (!imgToSend) return;

    const framePayload = {
      id: `PREPROC-${Date.now()}`,
      imageData: imgToSend,
      selectedSensor: `Preprocessed (${captureSource})`,
      sensorType: "Preprocessed Frame",
      timestamp: new Date().toISOString(),
      formattedTime: new Date().toLocaleTimeString(),
      missionTime: capturedFrame?.missionTime || "0.0",
      fov: capturedFrame?.fov || 60,
      distance: capturedFrame?.distance || "--",
      mission_id: activeMission?.mission_id || "MSN-DEFAULT-01",
      preprocessed: true,
      appliedStages: stages.map((s) => s.stage),
    };

    setCapturedFrame(framePayload);
    navigate("/detection");
  };

  return (
    <Layout showInspector={false} showFooter={false}>
      <div className="pipeline-page-container">
        {/* Header */}
        <div className="pipeline-header">
          <h2>Image Processing &amp; Preprocessing Module</h2>
          <p>
            Interactive OpenCV sensor frame enhancement pipeline. Calibrate Brightness, Contrast, 
            Blur (Gaussian/Median), and Edge Detection (Canny/Sobel) before YOLOv8n object detection.
          </p>
        </div>

        {statusMsg && (
          <div className="pipeline-alert alert-success">
            <FaCheckCircle style={{ marginRight: 8 }} />
            {statusMsg}
          </div>
        )}

        {error && (
          <div className="pipeline-alert alert-danger">
            <FaExclamationTriangle style={{ marginRight: 8 }} />
            {error}
          </div>
        )}

        <div className="pipeline-main-layout">
          {/* CONTROLS SIDEBAR */}
          <div className="pipeline-controls-panel">
            <div className="panel-title">
              <FaSlidersH style={{ marginRight: 8, color: "#38bdf8" }} />
              <h3>Enhancement Controls</h3>
            </div>

            {/* SOURCE SELECTOR */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "12px", background: "#091222", padding: "3px", borderRadius: "6px", border: "1px solid #1e293b" }}>
              <button
                type="button"
                onClick={() => setInputMode("SIMULATION")}
                style={{
                  flex: 1,
                  background: inputMode === "SIMULATION" ? "#0284c7" : "transparent",
                  color: inputMode === "SIMULATION" ? "#fff" : "#94a3b8",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 2px",
                  fontSize: "10px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                SENSORS
              </button>
              <button
                type="button"
                onClick={() => setInputMode("GALLERY")}
                style={{
                  flex: 1,
                  background: inputMode === "GALLERY" ? "#0284c7" : "transparent",
                  color: inputMode === "GALLERY" ? "#fff" : "#94a3b8",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 2px",
                  fontSize: "10px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                GALLERY ({missionGallery?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setInputMode("UPLOAD")}
                style={{
                  flex: 1,
                  background: inputMode === "UPLOAD" ? "#0284c7" : "transparent",
                  color: inputMode === "UPLOAD" ? "#fff" : "#94a3b8",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 2px",
                  fontSize: "10px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                UPLOAD
              </button>
            </div>

            {/* SENSOR SPECIFIC SELECTION */}
            {inputMode === "SIMULATION" && (
              <div style={{ marginBottom: "14px" }}>
                <span style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "6px", fontWeight: 600 }}>
                  Active Sensor Feed:
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {SENSOR_MODES.map((sensor) => (
                    <button
                      key={sensor.id}
                      type="button"
                      onClick={() => handleCaptureFromSensor(sensor.id)}
                      style={{
                        padding: "7px 6px",
                        fontSize: "10px",
                        fontWeight: activeSensorChoice === sensor.id ? 700 : 500,
                        background: activeSensorChoice === sensor.id ? "rgba(56, 189, 248, 0.2)" : "#111a2e",
                        border: `1px solid ${activeSensorChoice === sensor.id ? "#38bdf8" : "#24324d"}`,
                        color: activeSensorChoice === sensor.id ? "#38bdf8" : "#cbd5e1",
                        borderRadius: "6px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        justifyContent: "center",
                      }}
                    >
                      <FaCamera style={{ fontSize: "9px" }} />
                      {sensor.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* GALLERY HISTORY PICKER */}
            {inputMode === "GALLERY" && (
              <div style={{ marginBottom: "14px", maxHeight: "120px", overflowY: "auto", border: "1px solid #1e293b", borderRadius: "6px", padding: "4px" }}>
                {missionGallery.length === 0 ? (
                  <p style={{ fontSize: "11px", color: "#64748b", textAlign: "center", margin: "8px 0" }}>
                    No frames in mission gallery yet.
                  </p>
                ) : (
                  missionGallery.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      onClick={() => {
                        setOriginalImage(item.imageData);
                        setProcessedImage(null);
                        setStages([]);
                        setCaptureSource(item.selectedSensor || `Frame #${idx + 1}`);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "4px 8px",
                        marginBottom: "4px",
                        background: "#0f172a",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "10px",
                        color: "#94a3b8",
                      }}
                    >
                      <img src={item.imageData} alt="" style={{ width: "24px", height: "16px", objectFit: "cover", borderRadius: "2px" }} />
                      <span>{item.selectedSensor || "Captured"}</span>
                      <span style={{ marginLeft: "auto", color: "#38bdf8" }}>{item.formattedTime || ""}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* UPLOAD FILE BUTTON */}
            {inputMode === "UPLOAD" && (
              <div style={{ marginBottom: "14px" }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  className="pipeline-btn btn-upload"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ width: "100%" }}
                >
                  <FaUpload style={{ marginRight: 6 }} />
                  Select Image File
                </button>
              </div>
            )}

            {/* 1. BRIGHTNESS SLIDER */}
            <div className="control-field">
              <div className="field-label">
                <span>Brightness</span>
                <strong>{brightness > 0 ? `+${brightness}` : brightness}</strong>
              </div>
              <input
                type="range"
                min="-80"
                max="80"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
              />
            </div>

            {/* 2. CONTRAST SLIDER */}
            <div className="control-field">
              <div className="field-label">
                <span>Contrast</span>
                <strong>{contrast.toFixed(1)}x</strong>
              </div>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.1"
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
              />
            </div>

            {/* 3. BLUR FILTERING (GAUSSIAN / MEDIAN) */}
            <div className="control-field">
              <div className="field-label">
                <span>Filtering Blur Mode</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={() => setBlurMode("gaussian")}
                    style={{
                      padding: "2px 6px",
                      fontSize: "9px",
                      borderRadius: "3px",
                      border: "none",
                      background: blurMode === "gaussian" ? "#0284c7" : "#334155",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Gaussian
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlurMode("median")}
                    style={{
                      padding: "2px 6px",
                      fontSize: "9px",
                      borderRadius: "3px",
                      border: "none",
                      background: blurMode === "median" ? "#0284c7" : "#334155",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Median
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <input
                  type="range"
                  min="0"
                  max="11"
                  step="1"
                  value={blurIntensity}
                  onChange={(e) => setBlurIntensity(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: "11px", color: "#38bdf8", minWidth: "48px", textAlign: "right", fontFamily: "monospace" }}>
                  {blurIntensity > 0 ? `${blurIntensity * 2 + 1}x${blurIntensity * 2 + 1}` : "OFF"}
                </span>
              </div>
            </div>

            {/* 4. EDGE DETECTION OPERATOR (CANNY / SOBEL) */}
            <div style={{ background: "#0c1626", border: "1px solid #1e293b", padding: "10px", borderRadius: "8px", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={edgeDetection}
                    onChange={(e) => setEdgeDetection(e.target.checked)}
                  />
                  <span>Edge Detection</span>
                </label>
                {edgeDetection && (
                  <span style={{ fontSize: "9px", background: "#0284c7", color: "#fff", padding: "2px 6px", borderRadius: "3px", fontWeight: 700 }}>
                    ACTIVE
                  </span>
                )}
              </div>

              {edgeDetection && (
                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                  <button
                    type="button"
                    onClick={() => setEdgeOperator("canny")}
                    style={{
                      flex: 1,
                      padding: "5px 6px",
                      fontSize: "10px",
                      fontWeight: edgeOperator === "canny" ? 700 : 500,
                      background: edgeOperator === "canny" ? "#0284c7" : "#1e293b",
                      border: `1px solid ${edgeOperator === "canny" ? "#38bdf8" : "#334155"}`,
                      color: "#fff",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Canny Operator
                  </button>
                  <button
                    type="button"
                    onClick={() => setEdgeOperator("sobel")}
                    style={{
                      flex: 1,
                      padding: "5px 6px",
                      fontSize: "10px",
                      fontWeight: edgeOperator === "sobel" ? 700 : 500,
                      background: edgeOperator === "sobel" ? "#0284c7" : "#1e293b",
                      border: `1px solid ${edgeOperator === "sobel" ? "#38bdf8" : "#334155"}`,
                      color: "#fff",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Sobel Gradient
                  </button>
                </div>
              )}
            </div>

            {/* ADDITIONAL PREPROCESSING TOGGLES */}
            <div className="checkbox-field">
              <input
                type="checkbox"
                id="pipe-gray"
                checked={grayscale}
                onChange={(e) => setGrayscale(e.target.checked)}
              />
              <label htmlFor="pipe-gray">Grayscale Normalization</label>
            </div>

            <div className="checkbox-field">
              <input
                type="checkbox"
                id="pipe-sharp"
                checked={sharpen}
                onChange={(e) => setSharpen(e.target.checked)}
              />
              <label htmlFor="pipe-sharp">Unsharp Mask (Sharpen)</label>
            </div>

            <div className="checkbox-field">
              <input
                type="checkbox"
                id="pipe-denoise"
                checked={denoise}
                onChange={(e) => setDenoise(e.target.checked)}
              />
              <label htmlFor="pipe-denoise">Non-Local Means Denoise</label>
            </div>

            {/* ACTION BUTTONS */}
            <div className="pipeline-action-buttons">
              <button
                className="pipeline-btn btn-apply"
                onClick={applyProcessing}
                disabled={!originalImage || processing}
              >
                <FaPlay style={{ marginRight: 6 }} />
                {processing ? "Applying Pipeline..." : "Apply Preprocessing"}
              </button>

              <button
                className="pipeline-btn btn-reset"
                onClick={resetToOriginal}
                disabled={processing}
              >
                <FaUndo style={{ marginRight: 6 }} />
                Reset
              </button>
            </div>

            {/* SEND TO YOLOv8n PIPELINE */}
            {processedImage && (
              <div className="pipeline-forward-actions" style={{ marginTop: "14px" }}>
                <button
                  className="pipeline-btn btn-detection"
                  onClick={sendToDetection}
                  style={{
                    background: "linear-gradient(135deg, #0284c7, #0369a1)",
                    borderColor: "#38bdf8",
                    boxShadow: "0 0 12px rgba(56, 189, 248, 0.3)",
                    fontWeight: 700,
                  }}
                >
                  <FaEye style={{ marginRight: 6 }} />
                  Run YOLOv8n Detection on Preprocessed Frame
                </button>

                <a
                  href={processedImage}
                  download={`enhanced_${Date.now()}.png`}
                  className="pipeline-btn btn-download"
                  style={{ marginTop: "6px" }}
                >
                  <FaDownload style={{ marginRight: 6 }} />
                  Download Enhanced Frame
                </a>
              </div>
            )}
          </div>

          {/* BEFORE / AFTER VIEWERS */}
          <div className="pipeline-viewers-container">
            <div className="viewer-box">
              <div className="viewer-box-header">
                <div>
                  <h4>Original Input Frame</h4>
                  <span style={{ fontSize: "11px", color: "#38bdf8", marginLeft: "6px" }}>
                    Source: {captureSource}
                  </span>
                </div>
                <span className="badge badge-info">{originalImage ? "LOADED" : "NO FRAME"}</span>
              </div>
              <div className="viewer-box-body">
                {originalImage ? (
                  <img src={originalImage} alt="Original Input" className="pipeline-img" />
                ) : (
                  <div className="empty-viewport">
                    <p>No sensor frame loaded. Choose a sensor snapshot above, select from gallery, or upload a frame.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="viewer-box">
              <div className="viewer-box-header">
                <h4>Enhanced Output (OpenCV Preprocessed)</h4>
                <span className="badge badge-success">
                  {processedImage ? "PREPROCESSED" : "PENDING"}
                </span>
              </div>
              <div className="viewer-box-body">
                {processedImage ? (
                  <img src={processedImage} alt="OpenCV Enhanced Output" className="pipeline-img" />
                ) : (
                  <div className="empty-viewport">
                    <p>Adjust enhancement controls and click "Apply Preprocessing" to preview.</p>
                  </div>
                )}
              </div>
            </div>

            {/* STAGES AUDIT TRAIL */}
            {stages.length > 0 && (
              <div className="pipeline-stages-audit">
                <h4><FaLayerGroup style={{ marginRight: 6, color: "#38bdf8" }} /> Applied Transformation Pipeline Stages:</h4>
                <div className="stages-pills">
                  {stages.map((st, i) => (
                    <div key={i} className="stage-pill">
                      <span className="pill-index">{i + 1}</span>
                      <strong className="pill-name">{st.stage}</strong>
                      <span className="pill-param">{st.params}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default ProcessingPipelinePage;
