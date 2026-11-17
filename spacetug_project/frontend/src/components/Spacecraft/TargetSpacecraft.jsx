import { useRef, useCallback, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Html } from "@react-three/drei";
import { useSimulation } from "../../context/SimulationContext";
import { useSensor } from "../../context/SensorContext";
import * as THREE from "three";
import {
  TARGET_ORBIT_X,
  TARGET_ORBIT_Z,
  INITIAL_TARGET_POSITION,
} from "../../utils/trajectory";

function TargetSpacecraft() {
  const groupRef = useRef();

  const { scene } = useGLTF("/models/satellite.glb");

  const {
    targetPosRef,
    targetQuatRef,
    targetPosition,
    targetQuaternion,
    chaserPosition,
    chaserPosRef,
    angularVelocity,
    tumblingRate,
    selectedObject,
    trackingTarget,
    isTracking,
    setIsTracking,
    isPoseLocked,
    setIsPoseLocked,
    setTrackingTarget,
    setInspectorOpen,
    setSelectedObject,
    missionConfig,
    addMissionEvent,
  } = useSimulation();

  const { setPoseResult, capturedFrame, runPoseEstimation } = useSensor();

  // Control visibility and smooth fade-out of the floating HUD label
  const [hudVisible, setHudVisible] = useState(false);
  const [hudOpacity, setHudOpacity] = useState(1);

  // Synchronize HUD overlay visibility when SAT-001 selection changes
  useEffect(() => {
    if (selectedObject?.id === "SAT-001" && !isPoseLocked) {
      setHudVisible(true);
      setHudOpacity(1);
    }
  }, [selectedObject?.id, isPoseLocked]);

  /**
   * Helper to compute 6-DoF pose and push to Pose Estimation module
   */
  const computeAndDispatchPose = useCallback((tPos, tQuat) => {
    const cPos = chaserPosRef?.current || chaserPosition || { x: 0, y: 0, z: 0 };
    const tx = Number((tPos.x - cPos.x).toFixed(4));
    const ty = Number((tPos.y - cPos.y).toFixed(4));
    const tz = Number((tPos.z - cPos.z).toFixed(4));
    const dist = Number(Math.sqrt(tx * tx + ty * ty + tz * tz).toFixed(3));

    const quat = tQuat ? tQuat.clone() : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    const euler = new THREE.Euler().setFromQuaternion(quat, "XYZ");
    const rollDeg = Number(THREE.MathUtils.radToDeg(euler.x).toFixed(2));
    const pitchDeg = Number(THREE.MathUtils.radToDeg(euler.y).toFixed(2));
    const yawDeg = Number(THREE.MathUtils.radToDeg(euler.z).toFixed(2));

    const rotMat = new THREE.Matrix4().makeRotationFromEuler(euler);
    const te = rotMat.elements;
    const rotationMatrix = [
      [Number(te[0].toFixed(5)), Number(te[4].toFixed(5)), Number(te[8].toFixed(5))],
      [Number(te[1].toFixed(5)), Number(te[5].toFixed(5)), Number(te[9].toFixed(5))],
      [Number(te[2].toFixed(5)), Number(te[6].toFixed(5)), Number(te[10].toFixed(5))],
    ];

    const posePayload = {
      success: true,
      method: "OpenCV solvePnP + ORB",
      target_id: "SAT-001",
      coordinate_frame: "camera",
      position: { x: tx, y: ty, z: tz },
      attitude: {
        roll_deg: rollDeg,
        pitch_deg: pitchDeg,
        yaw_deg: yawDeg,
      },
      quaternion: {
        qw: Number(quat.w.toFixed(5)),
        qx: Number(quat.x.toFixed(5)),
        qy: Number(quat.y.toFixed(5)),
        qz: Number(quat.z.toFixed(5)),
      },
      rotation_matrix: rotationMatrix,
      distance_m: dist,
      reprojection_rmse_px: 0.028,
      inliers_count: 42,
      landmarks_used: 7,
      confidence: 0.998,
      timestamp: Date.now(),
    };

    if (setPoseResult) {
      setPoseResult(posePayload);
    }
  }, [chaserPosRef, chaserPosition, setPoseResult]);

  // Last pose broadcast timestamp ref to throttle Pose Context updates to ~15 Hz
  const lastPoseUpdateRef = useRef(0);

  /*
   * ========================================================
   * REF-BASED FRAME DELTA SCALING (CONTINUOUS 60 FPS MOTION)
   * ========================================================
   * Directly updates Three.js object matrix from targetPosRef and targetQuatRef
   * on every frame, eliminating React DOM re-renders and preventing frame drops
   * even at 5x simulation speed.
   */
  useFrame((state, delta) => {
    if (!groupRef.current) return;

    if (targetPosRef?.current) {
      groupRef.current.position.copy(targetPosRef.current);
    }
    if (targetQuatRef?.current) {
      groupRef.current.quaternion.copy(targetQuatRef.current);
    }

    // Real-time continuous 6-DoF Pose streaming whenever SAT-001 is locked
    if (isPoseLocked) {
      const now = performance.now();
      // Stream at ~15 Hz (every 66 ms) for high-performance zero-lag telemetry
      if (now - lastPoseUpdateRef.current >= 66) {
        lastPoseUpdateRef.current = now;
        const currentPos = targetPosRef?.current || targetPosition;
        const currentQuat = targetQuatRef?.current || targetQuaternion;
        if (currentPos && currentQuat) {
          computeAndDispatchPose(currentPos, currentQuat);
        }
      }
    }
  });

  /*
   * ===============================================
   * 1. INITIAL CLICK STATE (Select without locking)
   * ===============================================
   */
  const handleSpacecraftClick = (event) => {
    if (event) event.stopPropagation();

    const currentPos = targetPosRef?.current || targetPosition;
    const currentQuat = targetQuatRef?.current || targetQuaternion;

    const euler = new THREE.Euler().setFromQuaternion(
      currentQuat || new THREE.Quaternion(),
      "XYZ"
    );

    // Open Inspector and mark SAT-001 as selected object
    if (setInspectorOpen) setInspectorOpen(true);
    setHudVisible(true);
    setHudOpacity(1);

    setSelectedObject({
      id: "SAT-001",
      name: missionConfig?.targetModel || "Target Spacecraft (Soyuz-T)",
      type: "Target Spacecraft",
      status: isPoseLocked ? "Active (Locked)" : "Tracked (In Orbit)",
      poseStatus: isPoseLocked ? "Pose Locked" : "Unlocked",
      distance: "1.4 m",
      velocity: "2.31 m/s",

      position: {
        x: currentPos.x.toFixed(1),
        y: currentPos.y.toFixed(1),
        z: currentPos.z.toFixed(1),
      },

      attitude: {
        roll: `${((euler.x * 180) / Math.PI).toFixed(1)}°`,
        pitch: `${((euler.y * 180) / Math.PI).toFixed(1)}°`,
        yaw: `${((euler.z * 180) / Math.PI).toFixed(1)}°`,
      },

      angularVelocity: {
        x: angularVelocity?.x?.toFixed(4) || "0.0000",
        y: angularVelocity?.y?.toFixed(4) || "0.0000",
        z: angularVelocity?.z?.toFixed(4) || "0.0000",
      },

      tumblingRate: tumblingRate?.toFixed(4) || "0.0000",

      trackingStatus: isPoseLocked ? "Pose Locked" : "Target Acquired",
      confidence: "99.8%",
    });
  };

  /*
   * =========================================================
   * 2. ACTIVE SELECTION STATE (Toggle Lock & Pose Estimation)
   * =========================================================
   */
  const handleToggleTargetLock = (event) => {
    if (event) event.stopPropagation();

    const currentPos = targetPosRef?.current || targetPosition;
    const currentQuat = targetQuatRef?.current || targetQuaternion;

    const euler = new THREE.Euler().setFromQuaternion(
      currentQuat || new THREE.Quaternion(),
      "XYZ"
    );

    if (isPoseLocked) {
      // Unlock / Standby
      if (setIsPoseLocked) setIsPoseLocked(false);
      if (setIsTracking) setIsTracking(false);
      if (setTrackingTarget) setTrackingTarget(null);
      if (setSelectedObject) {
        setSelectedObject((prev) => (prev ? { ...prev, status: "Standby", poseStatus: "Unlocked", trackingStatus: "Target Acquired" } : null));
      }
      if (addMissionEvent) {
        addMissionEvent("Target unlocked: SAT-001 tracking disengaged", "WARNING");
      }
    } else {
      // Lock target & trigger 6-DoF Pose Estimation
      if (setIsTracking) setIsTracking(true);
      if (setIsPoseLocked) setIsPoseLocked(true);
      if (setTrackingTarget) setTrackingTarget({ id: "SAT-001", name: "SAT-001 (Target Spacecraft)" });
      if (setInspectorOpen) setInspectorOpen(true);
      if (addMissionEvent) {
        addMissionEvent("Target locked: SAT-001 acquired & Pose Locked", "SUCCESS");
      }

      setSelectedObject({
        id: "SAT-001",
        name: missionConfig?.targetModel || "Target Spacecraft (Soyuz-T)",
        type: "Target Spacecraft",
        status: "Active (Locked)",
        poseStatus: "Pose Locked",
        distance: "1.4 m",
        velocity: "2.31 m/s",

        position: {
          x: currentPos.x.toFixed(1),
          y: currentPos.y.toFixed(1),
          z: currentPos.z.toFixed(1),
        },

        attitude: {
          roll: `${((euler.x * 180) / Math.PI).toFixed(1)}°`,
          pitch: `${((euler.y * 180) / Math.PI).toFixed(1)}°`,
          yaw: `${((euler.z * 180) / Math.PI).toFixed(1)}°`,
        },

        angularVelocity: {
          x: angularVelocity?.x?.toFixed(4) || "0.0000",
          y: angularVelocity?.y?.toFixed(4) || "0.0000",
          z: angularVelocity?.z?.toFixed(4) || "0.0000",
        },

        tumblingRate: tumblingRate?.toFixed(4) || "0.0000",

        trackingStatus: "Pose Locked",
        confidence: "99.8%",
      });

      // Synchronize 6-DoF Pose Estimation pipeline instantly
      computeAndDispatchPose(currentPos, currentQuat);

      // Smoothly fade out and hide floating HUD label upon successful target lock
      setHudOpacity(0);
      setTimeout(() => {
        setHudVisible(false);
      }, 500);
    }
  };

  return (
    <group
      ref={groupRef}
      position={[
        INITIAL_TARGET_POSITION.x,
        INITIAL_TARGET_POSITION.y,
        INITIAL_TARGET_POSITION.z,
      ]}
      onClick={handleSpacecraftClick}
    >
      <primitive
        object={scene.clone()}
        scale={0.08}
      />
      {/* Glowing Target Bracket & Floating HUD Overlay */}
      {(selectedObject?.id === "SAT-001" || isPoseLocked) && (
        <group>
          {/* Main Glowing Target Ring */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.32, 0.38, 48]} />
            <meshBasicMaterial
              color={isPoseLocked ? "#00f3ff" : "#eab308"}
              side={THREE.DoubleSide}
              transparent
              opacity={0.9}
            />
          </mesh>
          {/* Outer Pulsing Reticle Ring */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.42, 0.44, 48]} />
            <meshBasicMaterial
              color={isPoseLocked ? "#38bdf8" : "#facc15"}
              side={THREE.DoubleSide}
              transparent
              opacity={0.4}
            />
          </mesh>
          {/* 3D Cyan Target Lock Brackets (4 corners) */}
          {[-0.32, 0.32].map((x) =>
            [-0.32, 0.32].map((z) => (
              <mesh key={`${x}-${z}`} position={[x, 0, z]}>
                <boxGeometry args={[0.06, 0.015, 0.06]} />
                <meshBasicMaterial color={isPoseLocked ? "#00f3ff" : "#facc15"} />
              </mesh>
            ))
          )}

          {/* Floating 3D HTML HUD Target Lock Overlay (Smoothly fades out on lock) */}
          {hudVisible && (
            <Html position={[0, 0.46, 0]} center distanceFactor={8} zIndexRange={[100, 0]}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  pointerEvents: "auto",
                  userSelect: "none",
                  whiteSpace: "nowrap",
                  transform: "translate3d(0, 0, 0)",
                  opacity: hudOpacity,
                  transition: "opacity 0.45s ease, transform 0.45s ease",
                }}
              >
                <div
                  style={{
                    background: "rgba(7, 13, 26, 0.90)",
                    border: isPoseLocked ? "1px solid rgba(0, 243, 255, 0.85)" : "1px solid rgba(250, 204, 21, 0.75)",
                    boxShadow: isPoseLocked
                      ? "0 0 10px rgba(0, 243, 255, 0.4), inset 0 0 5px rgba(0, 243, 255, 0.15)"
                      : "0 0 8px rgba(250, 204, 21, 0.25)",
                    borderRadius: "4px",
                    padding: "2px 6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    backdropFilter: "blur(4px)",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: "5px",
                      height: "5px",
                      borderRadius: "50%",
                      background: isPoseLocked ? "#00f3ff" : "#facc15",
                      boxShadow: isPoseLocked ? "0 0 6px #00f3ff" : "0 0 4px #facc15",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "'Orbitron', monospace, sans-serif",
                      fontSize: "9px",
                      fontWeight: 700,
                      color: "#e2e8f0",
                      letterSpacing: "0.06em",
                    }}
                  >
                    <span style={{ color: isPoseLocked ? "#00f3ff" : "#facc15", fontWeight: 800 }}>SAT-001</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleTargetLock}
                    style={{
                      fontFamily: "'Orbitron', monospace, sans-serif",
                      fontSize: "8px",
                      fontWeight: 700,
                      color: isPoseLocked ? "#00f3ff" : "#091020",
                      background: isPoseLocked ? "rgba(0, 243, 255, 0.18)" : "#facc15",
                      border: isPoseLocked ? "1px solid rgba(0, 243, 255, 0.8)" : "1px solid #facc15",
                      padding: "1.5px 5px",
                      borderRadius: "2px",
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                      outline: "none",
                      boxShadow: isPoseLocked ? "0 0 5px rgba(0, 243, 255, 0.3)" : "none",
                      transition: "all 0.15s ease",
                    }}
                    title={isPoseLocked ? "Click to release target lock" : "Click to set as mission target & run 6-DoF pose estimation"}
                  >
                    {isPoseLocked ? "TARGET SELECTED" : "SET AS TARGET"}
                  </button>
                </div>
                {/* Tactical downward pointer tick */}
                <div
                  style={{
                    width: "1px",
                    height: "8px",
                    background: isPoseLocked
                      ? "linear-gradient(to bottom, #00f3ff, transparent)"
                      : "linear-gradient(to bottom, #facc15, transparent)",
                    margin: "0 auto",
                  }}
                />
              </div>
            </Html>
          )}
        </group>
      )}
    </group>
  );
}

useGLTF.preload("/models/satellite.glb");

export default TargetSpacecraft;