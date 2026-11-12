import { useState, useRef } from "react";
import Layout from "../components/Layout/Layout";
import {
  runImageProcessingPipelineApi,
  runDetectionApi,
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
} from "react-icons/fa";

function ProcessingPipelinePage() {
  const navigate = useNavigate();
  const { setCapturedFrame, capturedFrame, selectedSensor, sensorThumbnails } = useSensor();
  const { activeMission } = useMission();

  const [inputMode, setInputMode] = useState("SIMULATION"); // "SIMULATION", "UPLOAD", "WEBCAM"
  const [captureSource, setCaptureSource] = useState("Simulation Feed");
  const [originalImage, setOriginalImage] = useState(() => {
    // Check if there is an active sensor thumbnail or captured frame from simulation
    const thumb = sensorThumbnails[selectedSensor];
    if (thumb) return thumb;
    if (capturedFrame?.imageData) return capturedFrame.imageData;
    return null;
  });
  const [processedImage, setProcessedImage] = useState(null);
  const [processedFilename, setProcessedFilename] = useState(null);
  const [stages, setStages] = useState([]);

  const [brightness, setBrightness] = useState(0); // -100 to 100
  const [contrast, setContrast] = useState(1.0); // 0.1 to 3.0
  const [grayscale, setGrayscale] = useState(false);
  const [gaussianBlur, setGaussianBlur] = useState(0); // 0 to 15
  const [sharpen, setSharpen] = useState(false);
  const [denoise, setDenoise] = useState(false);
  const [edgeDetection, setEdgeDetection] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  const fileInputRef = useRef(null);

  const handleCaptureFromSimulation = () => {
    try {
      // 1. Try canvas query selector
      const canvas = document.querySelector("#sensor-main-canvas canvas, .sensor-viewer canvas, .sensors-page canvas");
      let capturedData = null;
      if (canvas) {
        capturedData = canvas.toDataURL("image/png");
      }
      // 2. Fallback to sensor thumbnail or active capturedFrame
      if (!capturedData || capturedData === "data:,") {
        capturedData = sensorThumbnails[selectedSensor] || capturedFrame?.imageData;
      }

      if (!capturedData || capturedData === "data:,") {
        setError("No active simulation sensor canvas rendered. Visit the Sensors page first or upload an image.");
        return;
      }

      setOriginalImage(capturedData);
      setProcessedImage(null);
      setStages([]);
      setCaptureSource(`Simulation (${selectedSensor})`);
      setError(null);
      setStatusMsg(`Captured live frame from simulation sensor: ${selectedSensor}`);
    } catch (err) {
      console.warn("Capture error:", err);
      setError("Failed to capture frame from simulation WebGL canvas.");
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
      setCaptureSource(`Uploaded File (${file.name})`);
      setError(null);
      setStatusMsg("Original image loaded from file. Adjust controls and click Apply Processing.");
    };
    reader.readAsDataURL(file);
  };


  const applyProcessing = async () => {
    if (!originalImage) {
      setError("Please upload an image first.");
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
        gaussian_blur: gaussianBlur,
        sharpen,
        denoise,
        edge_detection: edgeDetection,
      });

      setProcessedImage(res.processed_image_url);
      setProcessedFilename(res.processed_filename);
      setStages(res.stages_executed || []);
      setStatusMsg(`Applied ${res.stages_executed?.length || 0} OpenCV processing stages successfully.`);
    } catch (err) {
      setError(err.message || "Image processing failed");
    } finally {
      setProcessing(false);
    }
  };

  const resetToOriginal = () => {
    setBrightness(0);
    setContrast(1.0);
    setGrayscale(false);
    setGaussianBlur(0);
    setSharpen(false);
    setDenoise(false);
    setEdgeDetection(false);
    setProcessedImage(null);
    setStages([]);
    setStatusMsg("Filters reset to default.");
  };

  const sendToDetection = () => {
    const imgToSend = processedImage || originalImage;
    if (!imgToSend) return;

    const framePayload = {
      id: `PIPE-${Date.now()}`,
      imageData: imgToSend,
      selectedSensor: "Pipeline Preprocessed Image",
      sensorType: "Upload",
      timestamp: new Date().toISOString(),
      formattedTime: new Date().toLocaleTimeString(),
      missionTime: "0.0",
      fov: 60,
      distance: "--",
      mission_id: activeMission?.mission_id || "MSN-DEFAULT-01",
    };

    setCapturedFrame(framePayload);
    navigate("/detection");
  };

  return (
    <Layout showInspector={false} showFooter={false}>
      <div className="pipeline-page-container">
        <div className="pipeline-header">
          <h2>Computer Vision Image Processing Pipeline</h2>
          <p>
            Interactive OpenCV preprocessing pipeline. Inspect adjustments (brightness, contrast,
            filtering, Canny edge detection) before spacecraft target detection and pose estimation.
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
              <h3>Pipeline Operations</h3>
            </div>

            {/* INPUT MODE SELECTOR */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "14px", background: "#091222", padding: "3px", borderRadius: "6px", border: "1px solid #1e293b" }}>
              <button
                type="button"
                onClick={() => {
                  setInputMode("SIMULATION");
                  handleCaptureFromSimulation();
                }}
                style={{
                  flex: 1,
                  background: inputMode === "SIMULATION" ? "#2563eb" : "transparent",
                  color: inputMode === "SIMULATION" ? "#fff" : "#94a3b8",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 4px",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                SIMULATION
              </button>
              <button
                type="button"
                onClick={() => setInputMode("UPLOAD")}
                style={{
                  flex: 1,
                  background: inputMode === "UPLOAD" ? "#2563eb" : "transparent",
                  color: inputMode === "UPLOAD" ? "#fff" : "#94a3b8",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 4px",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                FILE UPLOAD
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputMode("WEBCAM");
                  setError("Physical Camera Hardware: No connected physical USB/GigE optical sensor hardware found on local system. Use Simulation Mode.");
                }}
                style={{
                  flex: 1,
                  background: inputMode === "WEBCAM" ? "#475569" : "transparent",
                  color: inputMode === "WEBCAM" ? "#fff" : "#64748b",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 4px",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="Physical Camera Mode (Requires physical hardware)"
              >
                REAL CAM
              </button>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />

            {inputMode === "SIMULATION" ? (
              <button
                className="pipeline-btn btn-upload"
                onClick={handleCaptureFromSimulation}
                style={{ background: "linear-gradient(135deg, rgba(37, 99, 235, 0.4), rgba(30, 58, 138, 0.6))", borderColor: "#38bdf8" }}
              >
                <FaEye style={{ marginRight: 6 }} />
                Capture Frame ({selectedSensor})
              </button>
            ) : inputMode === "UPLOAD" ? (
              <button
                className="pipeline-btn btn-upload"
                onClick={() => fileInputRef.current?.click()}
              >
                <FaUpload style={{ marginRight: 6 }} />
                Upload Image File
              </button>
            ) : (
              <div style={{ padding: "8px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid #ef4444", borderRadius: "6px", fontSize: "11px", color: "#fca5a5", marginBottom: "12px" }}>
                Physical hardware camera integration offline / not detected.
              </div>
            )}


            <div className="control-field">
              <div className="field-label">
                <span>Brightness</span>
                <strong>{brightness}</strong>
              </div>
              <input
                type="range"
                min="-80"
                max="80"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
              />
            </div>

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

            <div className="control-field">
              <div className="field-label">
                <span>Gaussian Blur</span>
                <strong>{gaussianBlur > 0 ? `${gaussianBlur * 2 + 1}px` : "Off"}</strong>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                value={gaussianBlur}
                onChange={(e) => setGaussianBlur(Number(e.target.value))}
              />
            </div>

            <div className="checkbox-field">
              <input
                type="checkbox"
                id="pipe-gray"
                checked={grayscale}
                onChange={(e) => setGrayscale(e.target.checked)}
              />
              <label htmlFor="pipe-gray">Grayscale Conversion</label>
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

            <div className="checkbox-field">
              <input
                type="checkbox"
                id="pipe-edge"
                checked={edgeDetection}
                onChange={(e) => setEdgeDetection(e.target.checked)}
              />
              <label htmlFor="pipe-edge">Canny Edge Detection</label>
            </div>

            <div className="pipeline-action-buttons">
              <button
                className="pipeline-btn btn-apply"
                onClick={applyProcessing}
                disabled={!originalImage || processing}
              >
                <FaPlay style={{ marginRight: 6 }} />
                {processing ? "Processing..." : "Apply Processing"}
              </button>

              <button
                className="pipeline-btn btn-reset"
                onClick={resetToOriginal}
                disabled={processing}
              >
                <FaUndo style={{ marginRight: 6 }} />
                Reset Controls
              </button>
            </div>

            {processedImage && (
              <div className="pipeline-forward-actions">
                <a
                  href={processedImage}
                  download={`processed_${Date.now()}.png`}
                  className="pipeline-btn btn-download"
                >
                  <FaDownload style={{ marginRight: 6 }} />
                  Download Processed
                </a>

                <button
                  className="pipeline-btn btn-detection"
                  onClick={sendToDetection}
                >
                  <FaEye style={{ marginRight: 6 }} />
                  Send to YOLOv8 Detection
                </button>
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
                <span className="badge badge-info">{originalImage ? "READY" : "AWAITING"}</span>
              </div>
              <div className="viewer-box-body">
                {originalImage ? (
                  <img src={originalImage} alt="Original Input" className="pipeline-img" />
                ) : (
                  <div className="empty-viewport">
                    <p>No image uploaded yet. Click Upload Image Frame to begin.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="viewer-box">
              <div className="viewer-box-header">
                <h4>Processed Output (OpenCV Execution)</h4>
                <span className="badge badge-success">
                  {processedImage ? "PROCESSED" : "PENDING"}
                </span>
              </div>
              <div className="viewer-box-body">
                {processedImage ? (
                  <img src={processedImage} alt="OpenCV Processed Output" className="pipeline-img" />
                ) : (
                  <div className="empty-viewport">
                    <p>Click "Apply Processing" to run OpenCV stages on the input frame.</p>
                  </div>
                )}
              </div>
            </div>

            {/* STAGES AUDIT TRAIL */}
            {stages.length > 0 && (
              <div className="pipeline-stages-audit">
                <h4>Active Pipeline Transformation Sequence:</h4>
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
