import React, { memo, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { useSimulation } from "../../../context/SimulationContext";
import SensorSceneWorld from "./SensorSceneWorld";
import DepthMapViewer from "./DepthMapViewer";
import { getSensorToTargetDistance } from "./sensorConstants";
import "./SensorViewer.css";

function SensorLoadingFallback() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at center, #0d192e 0%, #060b14 100%)",
        color: "#38bdf8",
        fontFamily: "'Orbitron', monospace",
        fontSize: "12px",
        letterSpacing: "0.1em",
        zIndex: 5,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: "28px",
          height: "28px",
          border: "2px solid rgba(56, 189, 248, 0.2)",
          borderTopColor: "#38bdf8",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
          marginBottom: "10px",
        }}
      />
      <span>INITIALIZING SENSOR FEED...</span>
      <span style={{ fontSize: "10px", color: "#64748b", marginTop: "4px" }}>CALIBRATING OPTICAL DETECTOR</span>
    </div>
  );
}

/**
 * Sensor Canvas Container (memoized to isolate 3D WebGL rendering from HTML HUD updates)
 */
export const SensorCanvas = memo(function SensorCanvas({
  sensor,
  subType = null,
  canvasId = "sensor-canvas",
  onGlReady = null,
  onFrameRendered = null,
  isMini = false,
  viewMode = "CHASER",
}) {
  return (
    <div className="sensor-camera-canvas" id={canvasId} style={{ position: "relative" }}>
      <Suspense fallback={<SensorLoadingFallback />}>
        <Canvas
          shadows
          camera={{ fov: 60, near: 0.1, far: 300 }}
          dpr={isMini ? 1 : [1, 2]}
          gl={{
            preserveDrawingBuffer: true,
            antialias: !isMini,
            powerPreference: "high-performance",
          }}
        >
          <SensorSceneWorld
            sensor={sensor}
            subType={subType}
            onGlReady={onGlReady}
            onFrameRendered={onFrameRendered}
            isMini={isMini}
            viewMode={viewMode}
          />
        </Canvas>
      </Suspense>
    </div>
  );
});

/**
 * RGB-D Visual & Depth View
 */
function RGBDView({ onGlReady, onFrameRendered, isMini = false, viewMode = "CHASER" }) {
  const { chaserPosition, targetPosition } = useSimulation();
  const depth = getSensorToTargetDistance(chaserPosition, targetPosition, "RGB-D Camera");

  return (
    <div className="sensor-3d-view">
      <SensorCanvas
        sensor="RGB-D Camera"
        canvasId="sensor-main-canvas"
        onGlReady={onGlReady}
        onFrameRendered={onFrameRendered}
        isMini={isMini}
        viewMode={viewMode}
      />

      <div className="sensor-overlay top-left">RGB-D PRIMARY OPTICAL</div>
      <div className="sensor-overlay top-right">INFRARED TIME-OF-FLIGHT SENSOR</div>
      <div className="crosshair">+</div>

      {/* Live Synchronized 3D Depth Map (Z-Buffer) Preview Box */}
      {!isMini && <DepthMapViewer distance={depth} />}

      <div className="depth-readout">
        <span>ESTIMATED RANGE</span>
        <strong>{depth.toFixed(2)} m</strong>
      </div>
    </div>
  );
}

/**
 * Stereo Binocular View (Left and Right Cameras with b = 0.25m baseline separation)
 */
function StereoView({
  onGlReady,
  onGlReadyRight,
  onFrameRendered,
  onFrameRenderedRight,
  isMini = false,
  viewMode = "CHASER",
}) {
  const { chaserPosition, targetPosition } = useSimulation();
  const distance = getSensorToTargetDistance(chaserPosition, targetPosition, "Stereo Camera", "Stereo Left");

  // Parallax Disparity calculation: d = (f * b) / Z
  // f = focal length in pixels (width / (2 * tan(fov/2)) ~ 692px for 800px width and 60° FOV)
  // b = 0.25m
  const focalLengthPx = 692;
  const baselineM = 0.25;
  const safeZ = Math.max(0.2, distance);
  const disparityPx = (focalLengthPx * baselineM) / safeZ;

  return (
    <div className="stereo-3d-view">
      <div className="stereo-camera-view">
        <span className="camera-label">LEFT STEREO CAMERA [b/2 = -0.125 m]</span>
        <SensorCanvas
          sensor="Stereo Camera"
          subType="Stereo Left"
          canvasId="sensor-stereo-left-canvas"
          onGlReady={onGlReady}
          onFrameRendered={onFrameRendered}
          isMini={isMini}
          viewMode={viewMode}
        />
      </div>

      <div className="stereo-camera-view">
        <span className="camera-label">RIGHT STEREO CAMERA [b/2 = +0.125 m]</span>
        <SensorCanvas
          sensor="Stereo Camera"
          subType="Stereo Right"
          canvasId="sensor-stereo-right-canvas"
          onGlReady={onGlReadyRight || onGlReady}
          onFrameRendered={onFrameRenderedRight || onFrameRendered}
          isMini={isMini}
          viewMode={viewMode}
        />
      </div>

      <div className="depth-readout">
        <span>BINOCULAR RANGE (Z)</span>
        <strong>{distance.toFixed(2)} m</strong>
        <span style={{ fontSize: "11px", color: "#38bdf8", marginLeft: "10px" }}>
          PARALLAX DISPARITY (d): {disparityPx.toFixed(1)} px
        </span>
      </div>
    </div>
  );
}

/**
 * Thermal Infrared View (True Monochrome / Grayscale SWIR & Thermal Radiance)
 */
function ThermalView({
  onGlReady,
  onFrameRendered,
  isMini = false,
  viewMode = "CHASER",
}) {
  const { chaserPosition, targetPosition } = useSimulation();
  const distance = getSensorToTargetDistance(chaserPosition, targetPosition, "Thermal Camera");

  return (
    <div className="thermal-3d-view">
      <SensorCanvas
        sensor="Thermal Camera"
        canvasId="sensor-main-canvas"
        onGlReady={onGlReady}
        onFrameRendered={onFrameRendered}
        isMini={isMini}
        viewMode={viewMode}
      />

      <div className="thermal-label">
        EOIR THERMAL IMAGERY [SATELLITE THERMAL PAYLOAD 8.0 - 14.0 μm]
      </div>

      <div className="temperature-readout">
        <span>ESTIMATED RANGE</span>
        <strong>{distance.toFixed(2)} m</strong>
      </div>
    </div>
  );
}

/**
 * LiDAR 3D Perception View
 */
function LiDARView({ onGlReady, onFrameRendered, isMini = false, viewMode = "CHASER" }) {
  const { chaserPosition, targetPosition } = useSimulation();
  const range = getSensorToTargetDistance(chaserPosition, targetPosition, "LiDAR");

  return (
    <div className="lidar-3d-view">
      <SensorCanvas
        sensor="LiDAR"
        canvasId="sensor-main-canvas"
        onGlReady={onGlReady}
        onFrameRendered={onFrameRendered}
        isMini={isMini}
        viewMode={viewMode}
      />

      <div className="lidar-label">LiDAR SENSOR VIEW [FORWARD-FACING]</div>

      <div className="lidar-readout">
        <span>LiDAR RANGE</span>
        <strong>{range.toFixed(2)} m</strong>
      </div>
    </div>
  );
}

/**
 * Main Sensor Target View Selector
 */
function SensorTargetView({
  selectedSensor,
  viewMode = "CHASER",
  onGlReady,
  onGlReadyRight,
  onFrameRendered,
  onFrameRenderedRight,
  isMini = false,
}) {
  switch (selectedSensor) {
    case "RGB-D Camera":
      return (
        <RGBDView
          onGlReady={onGlReady}
          onFrameRendered={onFrameRendered}
          isMini={isMini}
          viewMode={viewMode}
        />
      );
    case "Stereo Camera":
      return (
        <StereoView
          onGlReady={onGlReady}
          onGlReadyRight={onGlReadyRight}
          onFrameRendered={onFrameRendered}
          onFrameRenderedRight={onFrameRenderedRight}
          isMini={isMini}
          viewMode={viewMode}
        />
      );
    case "Thermal Camera":
      return (
        <ThermalView
          onGlReady={onGlReady}
          onFrameRendered={onFrameRendered}
          isMini={isMini}
          viewMode={viewMode}
        />
      );
    case "LiDAR":
      return (
        <LiDARView
          onGlReady={onGlReady}
          onFrameRendered={onFrameRendered}
          isMini={isMini}
          viewMode={viewMode}
        />
      );
    default:
      return (
        <RGBDView
          onGlReady={onGlReady}
          onFrameRendered={onFrameRendered}
          isMini={isMini}
          viewMode={viewMode}
        />
      );
  }
}

export default SensorTargetView;
