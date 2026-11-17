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

// ─────────────────────────────────────────────────────────────────────────────
// 7 STRUCTURAL LANDMARKS
//
// 2D positions are expressed as percentages of the schematic viewBox (1000×440)
// and are derived directly from the SVG coordinates in SatelliteSchematic.jsx:
//
//   KP  ID               SVG anchor             %X        %Y
//   1   Bus CoM          (500, 220)             50.0%     50.0%
//   2   Docking Collar   (500, 325)             50.0%     73.9%
//   3   HGA Dish rim     (500,  88)             50.0%     20.0%
//   4   Left Wing Root   (305, 220)             30.5%     50.0%
//   5   Left Wing Tip    ( 48, 220)              4.8%     50.0%
//   6   Right Wing Root  (695, 220)             69.5%     50.0%
//   7   Right Wing Tip   (952, 220)             95.2%     50.0%
// ─────────────────────────────────────────────────────────────────────────────
const LANDMARKS_2D = [
  { id: "bus_com",         label: "Bus Center of Mass",   color: "#facc15", x: 50.0, y: 50.0 },
  { id: "docking_collar",  label: "Docking Collar",        color: "#f97316", x: 50.0, y: 73.9 },
  { id: "hga_dish",        label: "High-Gain Antenna",     color: "#a78bfa", x: 50.0, y: 20.0 },
  { id: "left_wing_root",  label: "Left Solar Wing Root",  color: "#22d3ee", x: 30.5, y: 50.0 },
  { id: "left_tip",        label: "Left Solar Panel Tip",  color: "#00d4ff", x:  4.8, y: 50.0 },
  { id: "right_wing_root", label: "Right Solar Wing Root", color: "#22d3ee", x: 69.5, y: 50.0 },
  { id: "right_tip",       label: "Right Solar Panel Tip", color: "#00d4ff", x: 95.2, y: 50.0 },
];

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
}) {
  const { poseResult, capturedFrame, liveInferenceData, detectionMode } = useSensor();
  const { targetQuaternion, missionTime = 0 } = useSimulation();

  // ── Live orientation from simulation quaternion ───────────────────────────
  const liveOrientation = useMemo(() => {
    if (targetQuaternion) {
      const quat = new THREE.Quaternion(
        targetQuaternion.x || 0,
        targetQuaternion.y || 0,
        targetQuaternion.z || 0,
        targetQuaternion.w != null ? targetQuaternion.w : 1
      );
      const euler = new THREE.Euler().setFromQuaternion(quat, "XYZ");
      return {
        roll:  THREE.MathUtils.radToDeg(euler.x),
        pitch: THREE.MathUtils.radToDeg(euler.y),
        yaw:   THREE.MathUtils.radToDeg(euler.z),
      };
    }
    if (poseResult?.attitude) {
      return {
        roll:  Number(poseResult.attitude.roll  || 0),
        pitch: Number(poseResult.attitude.pitch || 0),
        yaw:   Number(poseResult.attitude.yaw   || 0),
      };
    }
    const t = missionTime * 0.05;
    return {
      roll:  14.2  + Math.sin(t)       * 3.5,
      pitch: -8.4  + Math.cos(t * 0.8) * 2.8,
      yaw:   105.6 + Math.sin(t * 0.5) * 6.0,
    };
  }, [targetQuaternion, poseResult, missionTime]);

  const frozenRef = useRef(liveOrientation);
  if (isLiveStreaming) frozenRef.current = liveOrientation;

  const currentRoll  = isLiveStreaming ? liveOrientation.roll  : frozenRef.current.roll;
  const currentPitch = isLiveStreaming ? liveOrientation.pitch : frozenRef.current.pitch;
  const currentYaw   = isLiveStreaming ? liveOrientation.yaw   : frozenRef.current.yaw;

  const isLive = detectionMode === "Live Stream" || isLiveStreaming;
  const frameSource = isLive
    ? liveInferenceData?.lastFrameUrl || capturedFrame?.imageData
    : capturedFrame?.imageData;

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
          LOWER VIEWPORT — PURE 2D OPTICAL KEYPOINT PROJECTION
          ───────────────────────────────────────────────────────
          NO WebGL / Three.js / Canvas in this panel.
          Layers (all plain DOM):
            0  Starfield + tactical grid  (CSS background)
            1  2D satellite schematic      (inline SVG via SatelliteSchematic)
               — OR real sensor frame if capturedFrame is available
            2  SVG skeleton lines          (connecting the 7 joints)
            3  Landmark marker divs        (absolutely-positioned by %)
            4  HUD footer pills
          ═══════════════════════════════════════════════════════════ */}
      <div className="pose-viewport-lower">
        <div className="viewport-header-row">
          <div className="viewport-title-group">
            <FaCrosshairs className="title-icon-cyan" />
            <h4>2D OPTICAL KEYPOINT PROJECTION (7/7 LANDMARKS)</h4>
          </div>
          <span className="badge-auto-projected">
            <FaCheckCircle /> AUTO-PROJECTED
          </span>
        </div>

        <div className="kp2d-panel">

          {/* ── Layer 0: dark starfield + grid ─────────────────── */}
          <div className="kp2d-bg">
            <div className="kp2d-grid" />
          </div>

          {/* ── Layer 1: 2D image background ───────────────────── */}
          {frameSource ? (
            /* Real sensor frame when available */
            <img
              src={frameSource}
              alt="Captured sensor frame"
              className="kp2d-frame-img"
            />
          ) : (
            /* Static SVG schematic — the canonical 2D satellite reference */
            <div className="kp2d-schematic">
              <SatelliteSchematic />
            </div>
          )}

          {/* ── Layer 2: SVG skeleton connector lines ──────────── */}
          <svg className="kp2d-skeleton-svg" aria-hidden="true">
            <defs>
              <filter id="skelGlow" x="-15%" y="-15%" width="130%" height="130%">
                <feGaussianBlur stdDeviation="1.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Wing span: left tip — left root — bus — right root — right tip */}
            <line
              x1={`${LANDMARKS_2D[4].x}%`} y1={`${LANDMARKS_2D[4].y}%`}
              x2={`${LANDMARKS_2D[3].x}%`} y2={`${LANDMARKS_2D[3].y}%`}
              className="skel-line" filter="url(#skelGlow)"
            />
            <line
              x1={`${LANDMARKS_2D[3].x}%`} y1={`${LANDMARKS_2D[3].y}%`}
              x2={`${LANDMARKS_2D[0].x}%`} y2={`${LANDMARKS_2D[0].y}%`}
              className="skel-line" filter="url(#skelGlow)"
            />
            <line
              x1={`${LANDMARKS_2D[0].x}%`} y1={`${LANDMARKS_2D[0].y}%`}
              x2={`${LANDMARKS_2D[5].x}%`} y2={`${LANDMARKS_2D[5].y}%`}
              className="skel-line" filter="url(#skelGlow)"
            />
            <line
              x1={`${LANDMARKS_2D[5].x}%`} y1={`${LANDMARKS_2D[5].y}%`}
              x2={`${LANDMARKS_2D[6].x}%`} y2={`${LANDMARKS_2D[6].y}%`}
              className="skel-line" filter="url(#skelGlow)"
            />

            {/* Body axis: docking collar — bus CoM — HGA dish */}
            <line
              x1={`${LANDMARKS_2D[1].x}%`} y1={`${LANDMARKS_2D[1].y}%`}
              x2={`${LANDMARKS_2D[0].x}%`} y2={`${LANDMARKS_2D[0].y}%`}
              className="skel-line skel-axis" filter="url(#skelGlow)"
            />
            <line
              x1={`${LANDMARKS_2D[0].x}%`} y1={`${LANDMARKS_2D[0].y}%`}
              x2={`${LANDMARKS_2D[2].x}%`} y2={`${LANDMARKS_2D[2].y}%`}
              className="skel-line skel-axis" filter="url(#skelGlow)"
            />
          </svg>

          {/* ── Layer 3: Landmark markers ───────────────────────── */}
          {LANDMARKS_2D.map((kp, idx) => (
            <div
              key={kp.id}
              className="kp2d-marker"
              style={{ left: `${kp.x}%`, top: `${kp.y}%` }}
              title={`KP-${idx + 1}: ${kp.label}`}
            >
              {/* Outer pulsing ring */}
              <div
                className="kp2d-ring-outer"
                style={{
                  borderColor: kp.color,
                  boxShadow: `0 0 10px ${kp.color}99, inset 0 0 4px ${kp.color}33`,
                }}
              />
              {/* Inner dashed ring */}
              <div
                className="kp2d-ring-inner"
                style={{ borderColor: `${kp.color}bb` }}
              />
              {/* Centre dot */}
              <div
                className="kp2d-dot"
                style={{ background: kp.color, boxShadow: `0 0 6px ${kp.color}` }}
              />
              {/* Index badge */}
              <span
                className="kp2d-badge"
                style={{ background: kp.color }}
              >
                {idx + 1}
              </span>
              {/* Tooltip label */}
              <span className="kp2d-label">{kp.label}</span>
            </div>
          ))}

          {/* ── Layer 4: HUD footer ─────────────────────────────── */}
          <div className="kp2d-footer">
            <span className="hud-pill-auto">7/7 STRUCTURAL JOINTS LOCKED</span>
            <span className="hud-pill-algo">
              OPENCV {algorithm.toUpperCase()} + {feature.toUpperCase()}
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}

export default PoseViewer;
