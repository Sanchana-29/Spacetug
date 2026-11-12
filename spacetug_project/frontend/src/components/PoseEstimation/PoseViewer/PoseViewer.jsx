import "./PoseViewer.css";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, OrbitControls, Html } from "@react-three/drei";
import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { FaCrosshairs, FaCheckCircle } from "react-icons/fa";
import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";
import Earth from "../../Scene/Earth";
import StarsField from "../../Scene/StarsField";

/**
 * 7 Structural Landmarks on the Satellite Mesh (SAT-001)
 * Defined in local 3D group space matching the spacecraft geometry:
 * 1. KP-1 (Bus Center): [0, 0, 0]
 * 2. KP-2 (Docking Collar / Front): [0, 0, +Z_front]
 * 3. KP-3 (High-Gain Antenna / Aft): [0, +Y_dish, -Z_aft]
 * 4. KP-4 (Port Solar Wing Root): [-X_root, 0, 0]
 * 5. KP-5 (Port Solar Wing Tip): [-X_tip, 0, 0]
 * 6. KP-6 (Starboard Solar Wing Root): [+X_root, 0, 0]
 * 7. KP-7 (Starboard Solar Wing Tip): [+X_tip, 0, 0]
 */
const SATELLITE_LANDMARKS = [
  { id: "central_bus", label: "Center of Mass", localPos: new THREE.Vector3(0, 0, 0) },
  { id: "docking_collar", label: "Docking Collar", localPos: new THREE.Vector3(0, 0, 1.25) },
  { id: "antenna_dish", label: "High-Gain Antenna Dish", localPos: new THREE.Vector3(0, 0.55, -0.95) },
  { id: "left_wing_root", label: "Left Solar Wing Root", localPos: new THREE.Vector3(-1.4, 0, 0) },
  { id: "left_solar_tip", label: "Left Solar Panel Tip", localPos: new THREE.Vector3(-4.2, 0, 0) },
  { id: "right_wing_root", label: "Right Solar Wing Root", localPos: new THREE.Vector3(1.4, 0, 0) },
  { id: "right_solar_tip", label: "Right Solar Panel Tip", localPos: new THREE.Vector3(4.2, 0, 0) },
];

/**
 * Enhanced Thick 3D Coordinate Axis Vector Component
 * Renders bold RGB axes (+X Pitch in Red, +Y Yaw in Green, +Z Roll in Blue)
 */
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

/**
 * 3D Satellite Target Model with 6-DoF Orientation & Glowing RGB Axes
 * Centered at origin [0, 0, 0] with calibrated scale.
 * Projects the 7 exact 3D local joint coordinates to 2D screen percentages
 * through the active camera on every frame.
 */
function PoseSatelliteModel({ rollDeg = 14.2, pitchDeg = -8.4, yawDeg = 105.6, onKeypointsProjected }) {
  const { scene } = useGLTF("/models/satellite.glb");
  const groupRef = useRef();
  const { camera } = useThree();

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

  // Temporary reusable vector to avoid garbage collection inside 60fps useFrame
  const tempVec = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!groupRef.current) return;
    const r = THREE.MathUtils.degToRad(rollDeg);
    const p = THREE.MathUtils.degToRad(pitchDeg);
    const y = THREE.MathUtils.degToRad(yawDeg);
    groupRef.current.rotation.set(r, y, p, "ZYX");
    groupRef.current.updateMatrixWorld(true);

    // Project exact 3D local joint coordinates through active camera
    if (onKeypointsProjected) {
      const projected = SATELLITE_LANDMARKS.map((lm) => {
        tempVec.copy(lm.localPos);
        groupRef.current.localToWorld(tempVec);
        tempVec.project(camera);
        const xPercent = (tempVec.x * 0.5 + 0.5) * 100;
        const yPercent = (-tempVec.y * 0.5 + 0.5) * 100;
        return {
          id: lm.id,
          label: lm.label,
          x: xPercent,
          y: yPercent,
        };
      });
      onKeypointsProjected(projected);
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]} scale={0.18}>
      <primitive object={clonedScene} />

      {/* Center of Mass Marker */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>

      {/* 3D Coordinate Axes (+X Pitch in Red, +Y Yaw in Green, +Z Roll in Blue) */}
      <AxisVector dir={new THREE.Vector3(1, 0, 0)} color="#ef4444" label="+X Pitch" />
      <AxisVector dir={new THREE.Vector3(0, 1, 0)} color="#22c55e" label="+Y Yaw" />
      <AxisVector dir={new THREE.Vector3(0, 0, 1)} color="#38bdf8" label="+Z Roll" />
    </group>
  );
}

/**
 * Orbital Trajectory Arc in 3D
 */
function OrbitalTrajectoryArc() {
  const points = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 0.8 - Math.PI * 0.4;
      pts.push(new THREE.Vector3(Math.sin(angle) * 5.2, Math.cos(angle) * 0.8 - 1.6, -Math.cos(angle) * 3.8));
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

function PoseViewer({
  algorithm = "SolvePnP",
  feature = "ORB",
  isLiveStreaming = true,
  setIsLiveStreaming,
}) {
  const {
    poseResult,
    capturedFrame,
    liveInferenceData,
    detectionMode,
  } = useSensor();

  const {
    targetQuaternion,
    missionTime = 0,
  } = useSimulation();

  // Extract live Euler angles from targetQuaternion
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
        roll: THREE.MathUtils.radToDeg(euler.x),
        pitch: THREE.MathUtils.radToDeg(euler.y),
        yaw: THREE.MathUtils.radToDeg(euler.z),
      };
    }
    // Fallback if sensor poseResult is present
    if (poseResult?.attitude) {
      return {
        roll: Number(poseResult.attitude.roll || 0),
        pitch: Number(poseResult.attitude.pitch || 0),
        yaw: Number(poseResult.attitude.yaw || 0),
      };
    }
    // Gentle dynamic orbital drift fallback
    const t = missionTime * 0.05;
    return {
      roll: 14.2 + Math.sin(t) * 3.5,
      pitch: -8.4 + Math.cos(t * 0.8) * 2.8,
      yaw: 105.6 + Math.sin(t * 0.5) * 6.0,
    };
  }, [targetQuaternion, poseResult, missionTime]);

  // When live streaming is turned off, retain frozen values
  const frozenRef = useRef(liveOrientation);
  if (isLiveStreaming) {
    frozenRef.current = liveOrientation;
  }

  const currentRoll = isLiveStreaming ? liveOrientation.roll : frozenRef.current.roll;
  const currentPitch = isLiveStreaming ? liveOrientation.pitch : frozenRef.current.pitch;
  const currentYaw = isLiveStreaming ? liveOrientation.yaw : frozenRef.current.yaw;

  // Real-time camera-projected 2D keypoints
  // Initialized with baseline projection so rings render immediately
  const [projectedKeypoints, setProjectedKeypoints] = useState(() =>
    SATELLITE_LANDMARKS.map((lm, idx) => ({
      id: lm.id,
      label: lm.label,
      x: 50 + (lm.localPos.x * 6.5),
      y: 50 - (lm.localPos.y * 6.5) + (lm.localPos.z * 1.5),
    }))
  );

  // Direct ref-based projection handler from useFrame (throttled to UI updates)
  const lastUpdateRef = useRef(0);
  const handleKeypointsProjected = (newKeypoints) => {
    const now = performance.now();
    if (now - lastUpdateRef.current > 16) {
      lastUpdateRef.current = now;
      setProjectedKeypoints(newKeypoints);
    }
  };

  const isLive = detectionMode === "Live Stream" || isLiveStreaming;
  const frameSource = isLive
    ? liveInferenceData?.lastFrameUrl || capturedFrame?.imageData
    : capturedFrame?.imageData;

  return (
    <div className="pose-viewer-dual-container">
      {/* ======================================================== */}
      {/* 1. UPPER VIEWPORT: INTERACTIVE 3D POSE & BORESIGHT ALIGNMENT */}
      {/* ======================================================== */}
      <div className="pose-viewport-upper">
        <div className="viewport-header-row">
          <div className="viewport-title-group">
            <span className="hud-radar-dot"></span>
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
            {/* Ambient + Directional Key/Fill Lights for crisp satellite illumination */}
            <ambientLight intensity={0.5} />
            <directionalLight position={[15, 12, 18]} intensity={4.2} color="#ffffff" />
            <directionalLight position={[-15, -10, -10]} intensity={1.2} color="#38bdf8" />

            <Suspense fallback={null}>
              <StarsField isMini={true} />

              {/* Earth moved far off-axis and behind the satellite so it never occludes SAT-001 */}
              <group position={[12, -8, -28]} scale={3.5}>
                <Earth isMini={true} />
              </group>

              <OrbitalTrajectoryArc />

              {/* Target Spacecraft centered at [0, 0, 0] with RGB Coordinate Axes & 3D to 2D projection */}
              <PoseSatelliteModel
                rollDeg={currentRoll}
                pitchDeg={currentPitch}
                yawDeg={currentYaw}
                onKeypointsProjected={handleKeypointsProjected}
              />
            </Suspense>

            <OrbitControls
              enableDamping
              dampingFactor={0.08}
              minDistance={1.2}
              maxDistance={12}
            />
          </Canvas>

          {/* Tactical Boresight Reticle & Circular Calibration Ring */}
          <div className="boresight-reticle-overlay">
            <div className="reticle-circle-outer"></div>
            <div className="reticle-circle-inner"></div>
            <div className="crosshair-axis x-axis"></div>
            <div className="crosshair-axis y-axis"></div>
            <div className="reticle-corner tl"></div>
            <div className="reticle-corner tr"></div>
            <div className="reticle-corner bl"></div>
            <div className="reticle-corner br"></div>
            <div className="boresight-telemetry-tag">SAT-001 | 6-DOF TRACK</div>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 2. LOWER VIEWPORT: 2D OPTICAL KEYPOINT PROJECTION (7/7) */}
      {/* ======================================================== */}
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

        <div className="keypoints-2d-canvas-wrapper">
          {frameSource ? (
            <img src={frameSource} alt="Sensor Frame" className="optical-frame-underlay" />
          ) : (
            <div className="starfield-tactical-bg">
              <div className="tactical-grid-overlay"></div>
            </div>
          )}

          {/* 7 Glowing Concentric Target Rings and Crosshairs locked via localToWorld + camera.project */}
          {projectedKeypoints.map((kp, idx) => (
            <div
              key={kp.id}
              className="auto-keypoint-target"
              style={{ left: `${kp.x.toFixed(2)}%`, top: `${kp.y.toFixed(2)}%` }}
              title={`${idx + 1}. ${kp.label}`}
            >
              <div className="kp-ring-outer"></div>
              <div className="kp-ring-inner"></div>
              <div className="kp-crosshair-center"></div>
              <span className="kp-index-label">{idx + 1}</span>
            </div>
          ))}

          {/* Tactical Footer Legend */}
          <div className="keypoint-hud-footer">
            <span className="hud-pill-auto">7/7 STRUCTURAL JOINTS LOCKED</span>
            <span className="hud-pill-algo">OPENCV {algorithm.toUpperCase()} + {feature.toUpperCase()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PoseViewer;
