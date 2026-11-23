import "./PoseViewer.css";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, OrbitControls, Html } from "@react-three/drei";
import { Suspense, useMemo, useRef, useState, useEffect, useCallback } from "react";
import * as THREE from "three";
import { FaCrosshairs, FaCheckCircle, FaCamera, FaSyncAlt, FaLock } from "react-icons/fa";
import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";
import Earth from "../../Scene/Earth";
import StarsField from "../../Scene/StarsField";
import SatelliteSchematic from "./SatelliteSchematic";
import { SensorCanvas } from "../../Sensors/SensorViewer/SensorTargetView";
import {
  getCameraIntrinsicsMatrix,
  projectLandmarksToPixels,
  getOpenCvGroundTruthPose,
  buildImagePoints,
  TARGET_LANDMARKS_3D,
} from "../../../utils/poseGeometry";

// ─── Coordinate Axis Arrow (upper 3D viewport only) ──────────────────────────
function AxisVector({ dir, color, length = 2.4, label = "", headLength = 0.35, headWidth = 0.16 }) {
  const normDir = useMemo(() => dir.clone().normalize(), [dir]);
  return (
    <group>
      <arrowHelper args={[normDir, new THREE.Vector3(0, 0, 0), length, color, headLength, headWidth]} />
      <mesh position={[normDir.x * (length * 0.45), normDir.y * (length * 0.45), normDir.z * (length * 0.45)]}>
        <cylinderGeometry args={[0.02, 0.02, length * 0.85, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html position={[normDir.x * (length + 0.22), normDir.y * (length + 0.22), normDir.z * (length + 0.22)]}>
        <div className="axis-hud-label" style={{ border: `1px solid ${color}`, color }}>
          {label}
        </div>
      </Html>
    </group>
  );
}

// ─── Upper-panel 3D satellite model ──────────────────────────────────────────
function PoseSatelliteModel({ rollDeg, pitchDeg, yawDeg }) {
  const { scene } = useGLTF("/models/satellite.glb");
  const groupRef = useRef();

  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.rotation.set(
      THREE.MathUtils.degToRad(rollDeg),
      THREE.MathUtils.degToRad(yawDeg),
      THREE.MathUtils.degToRad(pitchDeg),
      "ZYX"
    );
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]} scale={0.18}>
      <primitive object={clonedScene} />
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>
      <AxisVector dir={new THREE.Vector3(1, 0, 0)} color="#ef4444" label="+X Pitch" />
      <AxisVector dir={new THREE.Vector3(0, 1, 0)} color="#22c55e" label="+Y Yaw" />
      <AxisVector dir={new THREE.Vector3(0, 0, 1)} color="#38bdf8" label="+Z Roll" />
    </group>
  );
}

// ─── Orbital Arc (upper viewport only) ───────────────────────────────────────
function OrbitalTrajectoryArc() {
  const points = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 0.8 - Math.PI * 0.4;
      pts.push(new THREE.Vector3(
        Math.sin(angle) * 5.2,
        Math.cos(angle) * 0.8 - 1.6,
        -Math.cos(angle) * 3.8
      ));
    }
    return pts;
  }, []);
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  return (
    <line geometry={geometry}>
      <lineBasicMaterial color="#0284c7" transparent opacity={0.4} />
    </line>
  );
}

// ─── Tactical Satellite Structural Connection Edges ─────────────────────────
const STRUCTURAL_EDGES = [
  ["solar_panel_right_tip_upper", "solar_panel_right_tip_lower"],
  ["solar_panel_left_tip_upper", "solar_panel_left_tip_lower"],
  ["solar_panel_right_tip_upper", "chassis_side_panel"],
  ["solar_panel_left_tip_upper", "chassis_rear_base"],
  ["antenna_dish_top", "primary_dish_center"],
  ["primary_dish_center", "optical_lens_center"],
  ["optical_lens_center", "chassis_side_panel"],
  ["chassis_side_panel", "chassis_rear_base"],
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN POSEVIEWER
// ─────────────────────────────────────────────────────────────────────────────
function PoseViewer({
  algorithm = "ITERATIVE",
  feature = "LANDMARKS",
  isLiveStreaming = true,
  setIsLiveStreaming,
  lastImagePoints = null,
  onEstimate,
  onLiveSampleUpdate,
}) {
  const {
    poseResult,
    capturedFrame,
    setCapturedFrame,
    runPoseEstimation,
    selectedSensor,
  } = useSensor();

  const {
    targetQuaternion,
    chaserPosition,
    targetPosition,
    isRunning,
  } = useSimulation();

  // Mode: "3D Boresight" (dedicated Euler model) or "Live Sensor" (R3F chaser camera feed)
  const [viewStreamMode, setViewStreamMode] = useState("Live Sensor");

  // Countdown timer in seconds for next auto 30-second refresh in live mode
  const [countdown, setCountdown] = useState(30);

  // Live 2D sample state (auto-refreshed every 30s when live)
  const [liveSample, setLiveSample] = useState(null);

  // References for WebGL canvas context in Live Sensor view
  const sensorGlContextRef = useRef(null);
  const onSensorGlReady = useCallback((context) => {
    sensorGlContextRef.current = context;
  }, []);

  // Compute live orientation for 3D boresight model
  const liveOrientation = useMemo(() => {
    if (poseResult?.success && poseResult?.attitude) {
      return {
        roll: Number(poseResult.attitude.roll || 0),
        pitch: Number(poseResult.attitude.pitch || 0),
        yaw: Number(poseResult.attitude.yaw || 0),
      };
    }
    const quat = targetQuaternion
      ? new THREE.Quaternion(
          targetQuaternion.x || 0,
          targetQuaternion.y || 0,
          targetQuaternion.z || 0,
          targetQuaternion.w != null ? targetQuaternion.w : 1
        )
      : new THREE.Quaternion();
    const euler = new THREE.Euler().setFromQuaternion(quat, "XYZ");
    return {
      roll: THREE.MathUtils.radToDeg(euler.x),
      pitch: THREE.MathUtils.radToDeg(euler.y),
      yaw: THREE.MathUtils.radToDeg(euler.z),
    };
  }, [targetQuaternion, poseResult]);

  const frozenRef = useRef(liveOrientation);
  if (isLiveStreaming) frozenRef.current = liveOrientation;

  const currentRoll  = isLiveStreaming ? liveOrientation.roll  : frozenRef.current.roll;
  const currentPitch = isLiveStreaming ? liveOrientation.pitch : frozenRef.current.pitch;
  const currentYaw   = isLiveStreaming ? liveOrientation.yaw   : frozenRef.current.yaw;

  // Extract a 2D sample directly from current simulation + camera state or active WebGL canvas
  const captureCurrentSample = useCallback((isManualSnapshot = false) => {
    try {
      const context = sensorGlContextRef.current;
      let imgData = null;
      let width = 1280;
      let height = 720;
      let vFov = 60;
      let landmarksGeo = null;
      let gtPose = null;
      let camMatrix = null;

      if (context?.gl && context?.camera && context?.scene) {
        context.gl.render(context.scene, context.camera);
        imgData = context.gl.domElement.toDataURL("image/png");
        width = context.gl.domElement.width || 1280;
        height = context.gl.domElement.height || 720;
        vFov = context.camera.fov || 60;
        camMatrix = getCameraIntrinsicsMatrix(width, height, vFov);

        const targetObj = context.scene.getObjectByName("TargetSpacecraftGroup");
        if (targetObj) {
          landmarksGeo = projectLandmarksToPixels(context.camera, targetObj, width, height, TARGET_LANDMARKS_3D);
          gtPose = getOpenCvGroundTruthPose(context.camera, targetObj);
        }
      }

      // Fallback synthetic camera projection using live chaser/target positions if WebGL buffer not yet mounted
      if (!landmarksGeo) {
        camMatrix = getCameraIntrinsicsMatrix(width, height, vFov);
        const synthCam = new THREE.PerspectiveCamera(vFov, width / height, 0.1, 500);
        synthCam.position.set(chaserPosition?.x ?? 0, chaserPosition?.y ?? 0, chaserPosition?.z ?? 0);
        synthCam.lookAt(targetPosition?.x ?? 5.2, targetPosition?.y ?? 0, targetPosition?.z ?? 1.24);
        synthCam.updateMatrixWorld(true);

        const synthTarget = new THREE.Group();
        synthTarget.position.set(targetPosition?.x ?? 5.2, targetPosition?.y ?? 0, targetPosition?.z ?? 1.24);
        if (targetQuaternion) synthTarget.quaternion.copy(targetQuaternion);
        synthTarget.scale.set(0.08, 0.08, 0.08);
        synthTarget.updateMatrixWorld(true);

        landmarksGeo = projectLandmarksToPixels(synthCam, synthTarget, width, height, TARGET_LANDMARKS_3D);
        gtPose = getOpenCvGroundTruthPose(synthCam, synthTarget);
      }

      const framePayload = {
        id: isManualSnapshot ? `SNAP-${Date.now()}` : `LIVE-${Date.now()}`,
        imageData: imgData,
        image_size: [width, height],
        camera_matrix: camMatrix,
        fov: vFov,
        landmarks: landmarksGeo,
        ground_truth_pose: gtPose,
        selectedSensor: selectedSensor || "RGB-D Camera",
        timestamp: new Date().toISOString(),
        formattedTime: new Date().toLocaleTimeString(),
      };

      if (isManualSnapshot) {
        setCapturedFrame(framePayload);
      } else {
        setLiveSample(framePayload);
      }

      if (onLiveSampleUpdate) {
        onLiveSampleUpdate(framePayload);
      }

      // Automatically solve pose for the newly extracted frame using active solver
      if (landmarksGeo?.points && onEstimate) {
        onEstimate({ frame: framePayload });
      }
    } catch (err) {
      console.warn("Live pose frame capture failed:", err);
    }
  }, [
    chaserPosition,
    targetPosition,
    targetQuaternion,
    selectedSensor,
    onEstimate,
    onLiveSampleUpdate,
    setCapturedFrame,
  ]);

  // Initial live sample on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!capturedFrame) {
        captureCurrentSample(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 30-Second Auto-Update Loop for Bottom 2D Landmark View (Active ONLY when no snapshot is frozen)
  useEffect(() => {
    if (capturedFrame || !isLiveStreaming) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          captureCurrentSample(false);
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [capturedFrame, isLiveStreaming, captureCurrentSample]);

  // Determine active frame displayed in the bottom 2D panel:
  // Frozen user snapshot takes absolute precedence; otherwise the auto-refreshed live sample
  const active2DFrame = capturedFrame || liveSample;
  const isSnapshotFrozen = Boolean(capturedFrame);

  const frameSource = active2DFrame?.imageData || null;
  const imgW = active2DFrame?.image_size?.[0] || 1280;
  const imgH = active2DFrame?.image_size?.[1] || 720;
  const geo = active2DFrame?.landmarks;
  const solved = Boolean(poseResult?.success);
  const detected = (solved && poseResult?.detected_points_2d) || lastImagePoints || {};
  const reprojected = (solved && poseResult?.reprojected_points_2d) || {};
  const landmarkIds = geo?.points ? Object.keys(geo.points) : [];
  const usedCount = Object.keys(detected).length;
  const markerR = Math.max(4, imgW / 160);
  const matchImage = poseResult?.match_image || null;
  const featureMode = Boolean(poseResult?.feature);

  return (
    <div className="pose-viewer-dual-container">

      {/* ═══════════════════════════════════════════════════════════
          UPPER VIEWPORT — INTERACTIVE 3D LIVE STREAM & BORESIGHT
          ═══════════════════════════════════════════════════════════ */}
      <div className="pose-viewport-upper">
        <div className="viewport-header-row">
          <div className="viewport-title-group">
            <span className="hud-radar-dot" />
            <h4>
              {viewStreamMode === "Live Sensor"
                ? "LIVE SENSOR STREAM (RGB-D CHASER VIEW)"
                : "INTERACTIVE 3D POSE & BORESIGHT ALIGNMENT"}
            </h4>
          </div>
          <div className="viewport-badges">
            <button
              type="button"
              className={`badge-view-mode ${viewStreamMode === "Live Sensor" ? "active" : ""}`}
              onClick={() => setViewStreamMode("Live Sensor")}
              title="Show live photorealistic sensor camera view"
            >
              SENSOR VIEW
            </button>
            <button
              type="button"
              className={`badge-view-mode ${viewStreamMode === "3D Boresight" ? "active" : ""}`}
              onClick={() => setViewStreamMode("3D Boresight")}
              title="Show 3D satellite boresight orientation model"
            >
              BORESIGHT 3D
            </button>
            <button
              type="button"
              className={`badge-standby ${!isLiveStreaming ? "active" : ""}`}
              onClick={() => setIsLiveStreaming && setIsLiveStreaming(false)}
            >
              STANDBY
            </button>
            <button
              type="button"
              className={`badge-live-pulse ${isLiveStreaming ? "active" : ""}`}
              onClick={() => setIsLiveStreaming && setIsLiveStreaming(true)}
            >
              ● LIVE
            </button>
          </div>
        </div>

        <div className="canvas-3d-stage">
          {viewStreamMode === "Live Sensor" ? (
            <div style={{ width: "100%", height: "100%", position: "relative" }}>
              <SensorCanvas
                sensor={selectedSensor || "RGB-D Camera"}
                canvasId="pose-live-sensor-canvas"
                onGlReady={onSensorGlReady}
                viewMode="CHASER"
              />
              <div className="boresight-reticle-overlay">
                <div className="reticle-circle-outer" />
                <div className="reticle-circle-inner" />
                <div className="crosshair-axis x-axis" />
                <div className="crosshair-axis y-axis" />
                <div className="reticle-corner tl" />
                <div className="reticle-corner tr" />
                <div className="reticle-corner bl" />
                <div className="reticle-corner br" />
                <div className="boresight-telemetry-tag">
                  {selectedSensor?.toUpperCase() || "RGB-D"} CHASER STREAM | {algorithm} SOLVER
                </div>
              </div>
            </div>
          ) : (
            <>
              <Canvas camera={{ position: [0, 0.3, 2.6], fov: 45 }}>
                <ambientLight intensity={0.5} />
                <directionalLight position={[15, 12, 18]} intensity={4.2} color="#ffffff" />
                <directionalLight position={[-15, -10, -10]} intensity={1.2} color="#38bdf8" />
                <Suspense fallback={null}>
                  <StarsField isMini={true} />
                  <group position={[12, -8, -28]} scale={3.5}>
                    <Earth isMini={true} />
                  </group>
                  <OrbitalTrajectoryArc />
                  <PoseSatelliteModel
                    rollDeg={currentRoll}
                    pitchDeg={currentPitch}
                    yawDeg={currentYaw}
                  />
                </Suspense>
                <OrbitControls enableDamping dampingFactor={0.08} minDistance={1.2} maxDistance={12} />
              </Canvas>

              <div className="boresight-reticle-overlay">
                <div className="reticle-circle-outer" />
                <div className="reticle-circle-inner" />
                <div className="crosshair-axis x-axis" />
                <div className="crosshair-axis y-axis" />
                <div className="reticle-corner tl" />
                <div className="reticle-corner tr" />
                <div className="reticle-corner bl" />
                <div className="reticle-corner br" />
                <div className="boresight-telemetry-tag">SAT-001 | 6-DOF TRACK</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          LOWER VIEWPORT — 2D KEYPOINTS (30s AUTO-UPDATE / FREEZE)
          ═══════════════════════════════════════════════════════════ */}
      <div className="pose-viewport-lower">
        <div className="viewport-header-row">
          <div className="viewport-title-group">
            <FaCrosshairs className="title-icon-cyan" />
            <h4>
              {featureMode
                ? `${poseResult.feature} MATCHES (${poseResult.inliers ?? 0} INLIERS / ${poseResult.matches ?? 0} MATCHES)`
                : `2D OPTICAL LANDMARKS (${usedCount}/${landmarkIds.length || 9} IN VIEW)`}
            </h4>
            {usedCount < 6 && (
              <span
                style={{
                  fontSize: "10px",
                  color: "#f59e0b",
                  background: "rgba(245, 158, 11, 0.15)",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  marginLeft: "8px",
                  fontWeight: 600,
                }}
                title="PnP solver accuracy degrades with fewer than 6 visible landmarks"
              >
                ⚠ Low Confidence (&lt; 6 Landmarks)
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* Status indicator: 30s auto-refresh countdown vs frozen snapshot lock */}
            {isSnapshotFrozen ? (
              <span className="badge-freeze-mode" title="Frame is locked static. Click 'Resume Live Auto' to return to continuous 30s refresh.">
                <FaLock style={{ marginRight: "4px" }} /> SNAPSHOT FROZEN
              </span>
            ) : (
              <span className="badge-auto-mode" title="Automatically updates from live stream every 30 seconds">
                <FaSyncAlt style={{ marginRight: "4px" }} /> AUTO 30S ({countdown}s)
              </span>
            )}

            {/* Manual snapshot freeze button */}
            <button
              type="button"
              className="action-snapshot-btn"
              onClick={() => {
                if (isSnapshotFrozen) {
                  setCapturedFrame(null); // Unfreeze back to live auto-update
                  captureCurrentSample(false);
                  setCountdown(30);
                } else {
                  captureCurrentSample(true); // Freeze current pose snapshot
                }
              }}
              title={isSnapshotFrozen ? "Release freeze lock and return to 30-second live auto-refresh" : "Capture and freeze current frame static"}
            >
              <FaCamera style={{ marginRight: "4px" }} />
              {isSnapshotFrozen ? "RESUME LIVE (30s)" : "FREEZE SNAPSHOT"}
            </button>

            <span className="badge-auto-projected">
              <FaCheckCircle />{" "}
              {solved
                ? `RMSE ${Number(poseResult.reprojection_rmse_px).toFixed(3)} px`
                : featureMode
                ? poseResult.identification || "NOT MATCHED"
                : "NOT SOLVED"}
            </span>
          </div>
        </div>

        <div className="kp2d-panel">
          <div className="kp2d-bg">
            <div className="kp2d-grid" />
          </div>

          {matchImage ? (
            <img className="kp2d-match-img" src={matchImage} alt="Feature matches on the captured frame" />
          ) : geo?.points ? (
            <svg
              className="kp2d-overlay-svg"
              viewBox={`0 0 ${imgW} ${imgH}`}
              preserveAspectRatio="xMidYMid meet"
            >
              {frameSource ? (
                <image href={frameSource} x="0" y="0" width={imgW} height={imgH} />
              ) : (
                <rect width={imgW} height={imgH} fill="#050b14" />
              )}

              {/* Glowing tactical structural connection lines between keypoints */}
              {STRUCTURAL_EDGES.map(([p1Id, p2Id], idx) => {
                const pt1 = geo.points[p1Id];
                const pt2 = geo.points[p2Id];
                if (!pt1 || !pt2) return null;
                return (
                  <line
                    key={`edge-${idx}`}
                    x1={pt1[0]}
                    y1={pt1[1]}
                    x2={pt2[0]}
                    y2={pt2[1]}
                    stroke="#38bdf8"
                    strokeWidth={markerR / 3.2}
                    strokeOpacity="0.45"
                    strokeDasharray="4 2"
                    style={{ filter: "drop-shadow(0 0 3px #38bdf8)" }}
                  />
                );
              })}

              {landmarkIds.map((id) => {
                const gtp = geo.points[id];
                const used = detected[id];
                const rep = reprojected[id];
                const unusable = !geo.inImage?.[id] || (!used && geo.occluded?.[id]);
                return (
                  <g key={id}>
                    <title>{id}</title>
                    {unusable ? (
                      <circle cx={gtp[0]} cy={gtp[1]} r={markerR} fill="none" stroke="#64748b" strokeDasharray="3 3" strokeWidth={markerR / 3} />
                    ) : (
                      <circle cx={gtp[0]} cy={gtp[1]} r={markerR / 2.2} fill="#a78bfa" />
                    )}
                    {used && (
                      <circle cx={used[0]} cy={used[1]} r={markerR * 1.4} fill="none" stroke="#22c55e" strokeWidth={markerR / 3} />
                    )}
                    {rep && (
                      <g stroke="#ef4444" strokeWidth={markerR / 3}>
                        <line x1={rep[0] - markerR} y1={rep[1] - markerR} x2={rep[0] + markerR} y2={rep[1] + markerR} />
                        <line x1={rep[0] - markerR} y1={rep[1] + markerR} x2={rep[0] + markerR} y2={rep[1] - markerR} />
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="kp2d-schematic">
              <SatelliteSchematic />
              <div className="kp2d-empty-msg">
                Live target stream initializing... Next auto-projection in {countdown}s
              </div>
            </div>
          )}

          <div className="kp2d-footer">
            <span className="hud-pill-auto">
              <span style={{ color: "#22c55e" }}>○ used</span>{" "}
              <span style={{ color: "#ef4444" }}>✕ reprojected</span>{" "}
              <span style={{ color: "#a78bfa" }}>● truth</span>
            </span>
            <span className="hud-pill-algo">
              OPENCV {(poseResult?.method || algorithm).toUpperCase()} ·{" "}
              {featureMode
                ? `${poseResult.feature} + PnP RANSAC`
                : isSnapshotFrozen
                ? "FROZEN FRAME SNAPSHOT"
                : `LIVE 30S AUTO-SYNC (${countdown}s)`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PoseViewer;
