import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useSimulation } from "../../context/SimulationContext";
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
    angularVelocity,
    tumblingRate,
    selectedObject,
    trackingTarget,
    isTracking,
    setSelectedObject,
    missionConfig,
  } = useSimulation();

  /*
   * ========================================================
   * REF-BASED FRAME DELTA SCALING (CONTINUOUS 60 FPS MOTION)
   * ========================================================
   * Directly updates Three.js object matrix from targetPosRef and targetQuatRef
   * on every frame, eliminating React DOM re-renders and preventing frame drops
   * even at 5x simulation speed.
   */
  useFrame(() => {
    if (!groupRef.current) return;

    if (targetPosRef?.current) {
      groupRef.current.position.copy(targetPosRef.current);
    }
    if (targetQuatRef?.current) {
      groupRef.current.quaternion.copy(targetQuatRef.current);
    }
  });

  /*
   * =========================
   * TARGET SELECTION
   * =========================
   */
  const handleClick = (event) => {
    event.stopPropagation();

    const currentPos = targetPosRef?.current || targetPosition;
    const currentQuat = targetQuatRef?.current || targetQuaternion;

    const euler = new THREE.Euler().setFromQuaternion(
      currentQuat || new THREE.Quaternion(),
      "XYZ"
    );

    setSelectedObject({
      id: "SAT-001",
      name: missionConfig?.targetModel || "Target Spacecraft (Soyuz-T)",
      type: "Target Spacecraft",
      status: "Tracked",
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

      trackingStatus: "Active",
      confidence: "96.4%",
    });
  };

  return (
    <group
      ref={groupRef}
      position={[
        INITIAL_TARGET_POSITION.x,
        INITIAL_TARGET_POSITION.y,
        INITIAL_TARGET_POSITION.z,
      ]}
      onClick={handleClick}
    >
      <primitive
        object={scene.clone()}
        scale={0.08}
      />
      {selectedObject?.id === "SAT-001" && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 0.35, 32]} />
          <meshBasicMaterial
            color={isTracking && trackingTarget?.id === "SAT-001" ? "#4ade80" : "#facc15"}
            side={THREE.DoubleSide}
            transparent
            opacity={0.8}
          />
        </mesh>
      )}
    </group>
  );
}

useGLTF.preload("/models/satellite.glb");

export default TargetSpacecraft;