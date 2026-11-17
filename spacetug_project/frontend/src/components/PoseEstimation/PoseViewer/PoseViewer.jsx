import "./PoseViewer.css";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, OrbitControls, Html } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { FaCrosshairs, FaCheckCircle } from "react-icons/fa";
import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";
import Earth from "../../Scene/Earth";
import StarsField from "../../Scene/StarsField";
import SatelliteSchematic from "./SatelliteSchematic";



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

// ─────────────────────────────────────────────────────────────────────────────
// MAIN POSEVIEWER
// ─────────────────────────────────────────────────────────────────────────────
function PoseViewer({
  algorithm = "SolvePnP",
  feature = "ORB",
  isLiveStreaming = true,
  setIsLiveStreaming,
  lastImagePoints = null,
}) {
  const { poseResult, capturedFrame } = useSensor();
  const { targetQuaternion } = useSimulation();

  // ── Orientation shown in 3D: solvePnP estimate if available, else simulation truth
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

  // ── 2D overlay data (all in image pixel coordinates) ─────────────────────
  const frameSource = capturedFrame?.imageData || null;
  const imgW = capturedFrame?.image_size?.[0] || 1280;
  const imgH = capturedFrame?.image_size?.[1] || 720;
  const geo = capturedFrame?.landmarks;
  const solved = Boolean(poseResult?.success);
  const detected = (solved && poseResult.detected_points_2d) || lastImagePoints || {};
  const reprojected = (solved && poseResult.reprojected_points_2d) || {};
  const landmarkIds = geo?.points ? Object.keys(geo.points) : [];
  const usedCount = Object.keys(detected).length;
  const markerR = Math.max(4, imgW / 160);
  // ORB/SIFT mode: backend returns an annotated image (inliers / outliers / reprojection)
  const matchImage = poseResult?.match_image || null;
  const featureMode = Boolean(poseResult?.feature);

  return (
    <div className="pose-viewer-dual-container">

      {/* ═══════════════════════════════════════════════════════════
          UPPER VIEWPORT — INTERACTIVE 3D POSE & BORESIGHT
          Full Three.js / WebGL scene — unchanged.
          ═══════════════════════════════════════════════════════════ */}
      <div className="pose-viewport-upper">
        <div className="viewport-header-row">
          <div className="viewport-title-group">
            <span className="hud-radar-dot" />
            <h4>INTERACTIVE 3D POSE &amp; BORESIGHT ALIGNMENT</h4>
          </div>
          <div className="viewport-badges">
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
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          LOWER VIEWPORT — 2D KEYPOINTS ON THE CAPTURED FRAME
          green ring  = 2D point sent to solvePnP (with noise)
          red cross   = 3D landmark reprojected with the ESTIMATED pose
          violet dot  = noise-free projection (ground truth)
          grey ring   = landmark outside the image or occluded (not used)
          ═══════════════════════════════════════════════════════════ */}
      <div className="pose-viewport-lower">
        <div className="viewport-header-row">
          <div className="viewport-title-group">
            <FaCrosshairs className="title-icon-cyan" />
            <h4>
              {featureMode
                ? `${poseResult.feature} MATCHES (${poseResult.inliers ?? 0} INLIERS / ${poseResult.matches ?? 0} MATCHES / ${poseResult.keypoints ?? 0} KEYPOINTS)`
                : `2D KEYPOINTS (${usedCount}/${landmarkIds.length || 9} LANDMARKS USED)`}
            </h4>
          </div>
          <span className="badge-auto-projected">
            <FaCheckCircle />{" "}
            {solved
              ? `RMSE ${Number(poseResult.reprojection_rmse_px).toFixed(3)} px`
              : featureMode
              ? poseResult.identification || "NOT MATCHED"
              : "NOT SOLVED"}
          </span>
        </div>

        <div className="kp2d-panel">
          <div className="kp2d-bg">
            <div className="kp2d-grid" />
          </div>

          {matchImage ? (
            <img className="kp2d-match-img" src={matchImage} alt="Feature matches on the captured frame" />
          ) : frameSource ? (
            <svg
              className="kp2d-overlay-svg"
              viewBox={`0 0 ${imgW} ${imgH}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <image href={frameSource} x="0" y="0" width={imgW} height={imgH} />
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
              <div className="kp2d-empty-msg">Capture a frame on the Sensors page to see real keypoints</div>
            </div>
          )}

          <div className="kp2d-footer">
            {featureMode ? (
              <span className="hud-pill-auto">
                <span style={{ color: "#22c55e" }}>○ inlier</span>{" "}
                <span style={{ color: "#ef4444" }}>○ rejected</span>{" "}
                <span style={{ color: "#f97316" }}>+ reprojected</span>
              </span>
            ) : (
              <span className="hud-pill-auto">
                <span style={{ color: "#22c55e" }}>○ used</span>{" "}
                <span style={{ color: "#ef4444" }}>✕ reprojected</span>{" "}
                <span style={{ color: "#a78bfa" }}>● truth</span>
              </span>
            )}
            <span className="hud-pill-algo">
              OPENCV {(poseResult?.method || algorithm).toUpperCase()} ·{" "}
              {featureMode ? `${poseResult.feature} + PnP RANSAC` : feature === "LANDMARKS" ? "PROJECTED LANDMARKS" : feature}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PoseViewer;
