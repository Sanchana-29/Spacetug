import {
  useState,
  useRef,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import { FaCamera, FaEye, FaCrosshairs, FaCompressArrowsAlt } from "react-icons/fa";
import "./SensorViewer.css";

import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";
import { useMission } from "../../../context/MissionContext";
import SensorTargetView from "./SensorTargetView";
import {
  getSensorToTargetDistance,
  SENSOR_CONFIGS,
} from "./sensorConstants";
import {
  INITIAL_CHASER_POSITION,
  INITIAL_TARGET_POSITION,
} from "../../../utils/trajectory";
import {
  getCameraIntrinsicsMatrix,
  projectLandmarksToPixels,
  getOpenCvGroundTruthPose,
} from "../../../utils/poseGeometry";
import { usePerception } from "../../../context/PerceptionContext";
import { useLivePerceptionLoop, useTargetLandmarks } from "../LivePerceptionRunner/useLivePerceptionLoop";

function SensorViewer({ sensorData }) {
  const {
    selectedSensor,
    setCapturedFrame,
    updateSensorThumbnail,
  } = useSensor();

  const { activeMission } = useMission();

  const {
    chaserPosition,
    targetPosition,
    missionTime,
    isRunning,
    irFloodlight,
    setIrFloodlight,
  } = useSimulation();
  const { liveActive, latest: perceptionLatest } = usePerception();
  const navigate = useNavigate();

  const [capturing, setCapturing] = useState(false);
  // View Modes: "CHASER" (default), "TARGET", "FREE"
  const [viewMode, setViewMode] = useState("CHASER");

  const glContextRef = useRef(null);
  const glContextRightRef = useRef(null);

  // 3D landmarks + the live perception loop (shared with the background runner)
  const landmarks3DRef = useTargetLandmarks();
  useLivePerceptionLoop(glContextRef, landmarks3DRef);

  const onGlReady = useCallback((context) => {
    glContextRef.current = context;
  }, []);

  const onGlReadyRight = useCallback((context) => {
    glContextRightRef.current = context;
  }, []);

  const lastMainCaptureRef = useRef(0);
  const lastRightCaptureRef = useRef(0);

  const handleMainFrameRendered = useCallback(
    ({ gl, frame }) => {
      if (frame < 3) return;
      const key = selectedSensor === "Stereo Camera" ? "Stereo Left" : selectedSensor;
      const now = performance.now();
      if (now - lastMainCaptureRef.current < 2000) return;
      lastMainCaptureRef.current = now;

      try {
        const image = gl.domElement.toDataURL("image/png");
        if (image && image.length > 500) {
          updateSensorThumbnail(key, image);
        }
      } catch (e) {}
    },
    [selectedSensor, updateSensorThumbnail]
  );

  const handleMainFrameRenderedRight = useCallback(
    ({ gl, frame }) => {
      if (frame < 3 || selectedSensor !== "Stereo Camera") return;
      const now = performance.now();
      if (now - lastRightCaptureRef.current < 2000) return;
      lastRightCaptureRef.current = now;

      try {
        const image = gl.domElement.toDataURL("image/png");
        if (image && image.length > 500) {
          updateSensorThumbnail("Stereo Right", image);
        }
      } catch (e) {}
    },
    [selectedSensor, updateSensorThumbnail]
  );

  const sensorInfo = {
    "RGB-D Camera": { key: "rgbd", subtitle: "RGB + Depth Perception Feed" },
    "Stereo Camera": { key: "stereo", subtitle: "Binocular Vision Feed" },
    "Thermal Camera": { key: "thermal", subtitle: "Monochrome SWIR & Thermal Radiance Feed" },
    LiDAR: { key: "lidar", subtitle: "3D Point Cloud Feed" },
  };

  const currentSensor = sensorInfo[selectedSensor] || sensorInfo["RGB-D Camera"];
  const data = sensorData?.[currentSensor.key];
  const [stereoEye, setStereoEye] = useState("Left");

  const distanceVal = getSensorToTargetDistance(
    chaserPosition,
    targetPosition,
    selectedSensor,
    selectedSensor === "Stereo Camera"
      ? (stereoEye === "Right" ? "Stereo Right" : "Stereo Left")
      : null
  );

  const handleCaptureFrame = (overrideStereoEye = null) => {
    setCapturing(true);

    try {
      let imageData = null;
      const activeEye = overrideStereoEye || stereoEye;

      let context = glContextRef.current;
      if (selectedSensor === "Stereo Camera") {
        context =
          activeEye === "Right"
            ? glContextRightRef.current || glContextRef.current
            : glContextRef.current;
      }

      if (context?.gl && context?.scene && context?.camera) {
        context.gl.render(context.scene, context.camera);
        imageData = context.gl.domElement.toDataURL("image/png");
      }

      if (!imageData || imageData === "data:,") {
        const selector =
          selectedSensor === "Stereo Camera"
            ? (activeEye === "Right"
                ? "#sensor-stereo-right-canvas canvas"
                : "#sensor-stereo-left-canvas canvas")
            : "#sensor-main-canvas canvas, .sensor-camera-canvas canvas";

        const canvas =
          document.querySelector(selector) ||
          document.querySelector("#sensor-main-canvas canvas") ||
          document.querySelector(".sensor-camera-canvas canvas");

        if (canvas) {
          imageData = canvas.toDataURL("image/png");
        }
      }

      if (!imageData || imageData === "data:,") {
        console.error("No active sensor canvas buffer available to capture.");
        setCapturing(false);
        return;
      }

      const sensorConfig =
        SENSOR_CONFIGS[selectedSensor] || SENSOR_CONFIGS["RGB-D Camera"];

      const resolvedSensorName =
        selectedSensor === "Stereo Camera"
          ? `Stereo Camera (${activeEye})`
          : selectedSensor;

      // Pose geometry for this exact rendered frame: intrinsics, 2D landmark
      // projections (with visibility) and the ground-truth pose (OpenCV frame).
      let cameraMatrix = null;
      let landmarkGeometry = null;
      let groundTruthPose = null;
      const vFov = context?.camera?.fov || sensorConfig.fov || 60;
      const canvasEl = context?.gl?.domElement;
      const imgW = canvasEl?.width || 1280;
      const imgH = canvasEl?.height || 720;

      if (context?.camera && context?.scene) {
        const cam = context.camera;
        cameraMatrix = getCameraIntrinsicsMatrix(imgW, imgH, vFov);
        const targetObj = context.scene.getObjectByName("TargetSpacecraftGroup");
        if (targetObj) {
          landmarkGeometry = projectLandmarksToPixels(
            cam,
            targetObj,
            imgW,
            imgH,
            landmarks3DRef.current
          );
          groundTruthPose = getOpenCvGroundTruthPose(cam, targetObj);
        }
      }

      if (!cameraMatrix) {
        cameraMatrix = getCameraIntrinsicsMatrix(imgW, imgH, vFov);
      }

      const framePayload = {
        id: `CAP-${Date.now()}`,
        mission_id: activeMission?.mission_id || null,
        imageData,
        selectedSensor: resolvedSensorName,
        sensorType: selectedSensor,
        stereoEye: selectedSensor === "Stereo Camera" ? activeEye : null,
        timestamp: new Date().toISOString(),
        formattedTime: new Date().toLocaleTimeString(),
        missionTime: Number(missionTime || 0).toFixed(1),

        chaserPosition: {
          x: Number(chaserPosition?.x ?? INITIAL_CHASER_POSITION.x).toFixed(2),
          y: Number(chaserPosition?.y ?? INITIAL_CHASER_POSITION.y).toFixed(2),
          z: Number(chaserPosition?.z ?? INITIAL_CHASER_POSITION.z).toFixed(2),
        },

        targetPosition: {
          x: Number(targetPosition?.x ?? INITIAL_TARGET_POSITION.x).toFixed(2),
          y: Number(targetPosition?.y ?? INITIAL_TARGET_POSITION.y).toFixed(2),
          z: Number(targetPosition?.z ?? INITIAL_TARGET_POSITION.z).toFixed(2),
        },

        fov: vFov,
        fov_mode: "vertical",
        image_size: [imgW, imgH],
        camera_matrix: cameraMatrix,
        landmarks: landmarkGeometry,
        ground_truth_pose: groundTruthPose,
        distance: distanceVal.toFixed(2),
        range_m: distanceVal.toFixed(2),
        fps: data?.fps || 60,
      };

      setCapturedFrame(framePayload);
      navigate("/detection");
    } catch (error) {
      console.error("Frame capture error:", error);
      setCapturing(false);
    }
  };

  return (
    <div className="sensor-viewer">
      {/* HEADER */}
      <div className="viewer-header">
        <div>
          <h2>{selectedSensor}</h2>
          <span className="viewer-subtitle">{currentSensor.subtitle}</span>
        </div>

        <div className="viewer-actions">
          {/* CAMERA VIEW MODES: CHASER (Default), TARGET, FREE */}
          <div className="view-mode-selector" style={{ display: "flex", gap: "4px", background: "#0f172a", padding: "3px", borderRadius: "6px", border: "1px solid #334155" }}>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "CHASER" ? "active" : ""}`}
              onClick={() => setViewMode("CHASER")}
              style={{
                background: viewMode === "CHASER" ? "#2563eb" : "transparent",
                color: viewMode === "CHASER" ? "#fff" : "#94a3b8",
                border: "none",
                borderRadius: "4px",
                padding: "6px 10px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Default Chaser View: Camera mounted on Servicer spacecraft looking forward"
            >
              CHASER VIEW (DEFAULT)
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "TARGET" ? "active" : ""}`}
              onClick={() => setViewMode("TARGET")}
              style={{
                background: viewMode === "TARGET" ? "#2563eb" : "transparent",
                color: viewMode === "TARGET" ? "#fff" : "#94a3b8",
                border: "none",
                borderRadius: "4px",
                padding: "6px 10px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Target Inspection View: Follows and centers selected target SAT-001"
            >
              TARGET VIEW
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "FREE" ? "active" : ""}`}
              onClick={() => setViewMode("FREE")}
              style={{
                background: viewMode === "FREE" ? "#2563eb" : "transparent",
                color: viewMode === "FREE" ? "#fff" : "#94a3b8",
                border: "none",
                borderRadius: "4px",
                padding: "6px 10px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Free Orbit Camera View: Free 360° inspection"
            >
              FREE VIEW
            </button>
          </div>

          {/* ACTIVE IR FLOODLIGHT TOGGLE (Illuminates targets in eclipse umbra) */}
          <button
            type="button"
            className="floodlight-toggle-btn"
            onClick={() => setIrFloodlight((prev) => !prev)}
            style={{
              background: irFloodlight ? "#f59e0b" : "#1e293b",
              color: irFloodlight ? "#0f172a" : "#f1f5f9",
              border: `1px solid ${irFloodlight ? "#f59e0b" : "#475569"}`,
              borderRadius: "4px",
              padding: "6px 10px",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
            title="Toggle active infrared illuminator on the Chaser rig to illuminate targets during shadow eclipse"
          >
            <span>💡 IR FLOODLIGHT: {irFloodlight ? "ON" : "OFF"}</span>
          </button>

          {selectedSensor === "Stereo Camera" && (
            <div className="stereo-eye-selector">
              <button
                type="button"
                className={`stereo-eye-btn ${stereoEye === "Left" ? "active" : ""}`}
                onClick={() => setStereoEye("Left")}
              >
                LEFT EYE
              </button>
              <button
                type="button"
                className={`stereo-eye-btn ${stereoEye === "Right" ? "active" : ""}`}
                onClick={() => setStereoEye("Right")}
              >
                RIGHT EYE
              </button>
            </div>
          )}

          <button
            className={`capture-frame-btn ${capturing ? "capturing" : ""}`}
            onClick={() => handleCaptureFrame()}
            disabled={capturing}
          >
            <FaCamera className="capture-icon" />
            <span>
              {capturing
                ? "CAPTURING..."
                : selectedSensor === "Stereo Camera"
                ? `CAPTURE ${stereoEye.toUpperCase()} FRAME`
                : "CAPTURE FRAME"}
            </span>
          </button>

          <div className="live-status">
            <span
              className="status-dot"
              style={{
                background: isRunning ? "#4ade80" : "#f59e0b",
                boxShadow: isRunning ? "0 0 8px #4ade80" : "none",
              }}
            />
            {isRunning ? "SIM LIVE" : "PAUSED"}
          </div>
        </div>
      </div>

      {/* SENSOR VIEWPORT */}
      <div className="viewer-content">
        {liveActive && perceptionLatest?.imageSize && (
          <svg
            className="live-track-overlay"
            viewBox={`0 0 ${perceptionLatest.imageSize[0]} ${perceptionLatest.imageSize[1]}`}
            preserveAspectRatio="none"
          >
            {(perceptionLatest.tracking?.tracks || []).map((t) => {
              const [x1, y1, x2, y2] = t.bbox;
              const sw = Math.max(2, perceptionLatest.imageSize[0] / 500);
              return (
                <g key={t.track_id}>
                  <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="none" stroke="#22c55e" strokeWidth={sw} />
                  <polyline
                    points={(t.trail || []).map((p) => p.join(",")).join(" ")}
                    fill="none"
                    stroke="#facc15"
                    strokeWidth={sw}
                    strokeDasharray={`${sw * 3} ${sw * 2}`}
                  />
                  <text x={x1} y={Math.max(20, y1 - 8)} fill="#22c55e" fontSize={perceptionLatest.imageSize[0] / 60} fontWeight="700">
                    {t.track_id} · {Math.round(t.confidence * 100)}% · age {t.age_frames}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        <SensorTargetView
          selectedSensor={selectedSensor}
          viewMode={viewMode}
          onGlReady={onGlReady}
          onGlReadyRight={onGlReadyRight}
          onFrameRendered={handleMainFrameRendered}
          onFrameRenderedRight={handleMainFrameRenderedRight}
        />
      </div>
    </div>
  );
}

export default SensorViewer;
