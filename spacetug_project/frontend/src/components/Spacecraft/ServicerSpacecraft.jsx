import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import { useSimulation } from "../../context/SimulationContext";
import { CHASER_ORBIT_X, CHASER_ORBIT_Z } from "../../utils/trajectory";

function ServicerSpacecraft() {
  const spacecraftRef = useRef();

  const {
    chaserPosRef,
    targetPosRef,
    chaserPosition,
    targetPosition,
    setSelectedObject,
    resetKey,
  } = useSimulation();

  const ORBIT_X = CHASER_ORBIT_X;
  const ORBIT_Z = CHASER_ORBIT_Z;

  const handleClick = (event) => {
    event.stopPropagation();
    const currentPos = chaserPosRef?.current || chaserPosition;

    setSelectedObject({
      id: "CHS-001",
      name: "Chaser",
      type: "Servicer Spacecraft",
      status: "Active",
      distance: "125.4 m",
      velocity: "2.31 m/s",
      position: {
        x: currentPos.x.toFixed(1),
        y: currentPos.y.toFixed(1),
        z: currentPos.z.toFixed(1),
      },
      attitude: {
        roll: "0.0°",
        pitch: "0.0°",
        yaw: "18.2°",
      },
      trackingStatus: "Active",
      confidence: "98.2%",
    });
  };

  /*
   * ========================================================
   * HIGH-PERFORMANCE CONTINUOUS MOTION & BORESIGHT ORIENTATION
   * ========================================================
   * Smooth 60 FPS motion following simulation ref state,
   * orienting the front sensor deck directly toward SAT-001.
   */
  useFrame(() => {
    if (!spacecraftRef.current) return;

    const currentPos = chaserPosRef?.current || chaserPosition;
    const currentTarget = targetPosRef?.current || targetPosition;

    spacecraftRef.current.position.copy(currentPos);

    if (currentTarget) {
      spacecraftRef.current.lookAt(currentTarget.x, currentTarget.y, currentTarget.z);
    } else {
      const angle = Math.atan2(
        currentPos.z / ORBIT_Z,
        currentPos.x / ORBIT_X
      );
      spacecraftRef.current.rotation.set(0, angle + Math.PI, 0);
    }
  });

  useEffect(() => {
    if (!spacecraftRef.current) return;
    spacecraftRef.current.position.set(ORBIT_X, 0, 0);
    spacecraftRef.current.rotation.set(0, Math.PI, 0);
  }, [resetKey, ORBIT_X]);

  return (
    <group
      ref={spacecraftRef}
      position={[ORBIT_X, 0, 0]}
      scale={0.25}
      onClick={handleClick}
    >
      {/* ========================= */}
      {/* SPACECRAFT MAIN BODY */}
      {/* ========================= */}
      <mesh>
        <boxGeometry args={[1.5, 0.8, 2.2]} />
        <meshStandardMaterial
          color="#b8c1cc"
          metalness={0.7}
          roughness={0.35}
        />
      </mesh>

      {/* ========================= */}
      {/* LEFT SOLAR PANEL */}
      {/* ========================= */}
      <mesh position={[-1.25, 0, 0]}>
        <boxGeometry args={[1.0, 0.08, 1.8]} />
        <meshStandardMaterial
          color="#183b73"
          metalness={0.4}
          roughness={0.35}
        />
      </mesh>

      {/* ========================= */}
      {/* RIGHT SOLAR PANEL */}
      {/* ========================= */}
      <mesh position={[1.25, 0, 0]}>
        <boxGeometry args={[1.0, 0.08, 1.8]} />
        <meshStandardMaterial
          color="#183b73"
          metalness={0.4}
          roughness={0.35}
        />
      </mesh>

      {/* ========================= */}
      {/* RGB-D CAMERA MODULE */}
      {/* ========================= */}
      <mesh position={[0, 0.48, -0.58]}>
        <boxGeometry args={[0.28, 0.16, 0.18]} />
        <meshStandardMaterial
          color="#202a38"
          metalness={0.6}
          roughness={0.25}
        />
      </mesh>

      {/* RGB-D LENS */}
      <mesh position={[0, 0.48, -0.69]}>
        <cylinderGeometry
          args={[0.065, 0.065, 0.04, 24]}
          rotation={[Math.PI / 2, 0, 0]}
        />
        <meshStandardMaterial
          color="#101820"
          metalness={0.8}
          roughness={0.15}
        />
      </mesh>

      {/* ========================= */}
      {/* LEFT STEREO CAMERA */}
      {/* ========================= */}
      <mesh position={[-0.28, 0.35, -0.58]}>
        <boxGeometry args={[0.16, 0.14, 0.16]} />
        <meshStandardMaterial
          color="#263344"
          metalness={0.6}
          roughness={0.25}
        />
      </mesh>

      {/* ========================= */}
      {/* RIGHT STEREO CAMERA */}
      {/* ========================= */}
      <mesh position={[0.28, 0.35, -0.58]}>
        <boxGeometry args={[0.16, 0.14, 0.16]} />
        <meshStandardMaterial
          color="#263344"
          metalness={0.6}
          roughness={0.25}
        />
      </mesh>

      {/* ========================= */}
      {/* LiDAR UNIT */}
      {/* ========================= */}
      <mesh position={[0, 0, -1.15]}>
        <cylinderGeometry
          args={[0.18, 0.18, 0.16, 24]}
          rotation={[Math.PI / 2, 0, 0]}
        />
        <meshStandardMaterial
          color="#374151"
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>

      {/* ========================= */}
      {/* THERMAL CAMERA */}
      {/* ========================= */}
      <mesh position={[0, 0.05, 0.9]}>
        <boxGeometry args={[0.28, 0.2, 0.18]} />
        <meshStandardMaterial
          color="#3b2a25"
          metalness={0.5}
          roughness={0.3}
        />
      </mesh>

      {/* ========================= */}
      {/* THRUSTER BELLS & RADIATOR PANELS */}
      {/* ========================= */}
      {/* Primary Central Thruster Bell */}
      <mesh position={[0, 0, 1.18]}>
        <cylinderGeometry
          args={[0.22, 0.28, 0.25, 24]}
          rotation={[Math.PI / 2, 0, 0]}
        />
        <meshStandardMaterial
          color="#334155"
          metalness={0.85}
          roughness={0.2}
        />
      </mesh>
      {/* Secondary RCS Thrusters */}
      <mesh position={[-0.7, 0, 0.8]}>
        <cylinderGeometry args={[0.06, 0.09, 0.12, 16]} rotation={[0, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0.7, 0, 0.8]}>
        <cylinderGeometry args={[0.06, 0.09, 0.12, 16]} rotation={[0, 0, -Math.PI / 2]} />
        <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Radiator Panels on Upper Hull */}
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[1.1, 0.04, 1.4]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.4} roughness={0.5} />
      </mesh>

      {/* ========================= */}
      {/* RGB-D SENSOR CAMERA */}
      {/* ========================= */}
      <PerspectiveCamera
        name="rgbdSensorCamera"
        makeDefault={false}
        position={[0, 0.48, -0.70]}
        rotation={[0, 0, 0]}
        fov={60}
        near={0.1}
        far={100}
      />
    </group>
  );
}

export default ServicerSpacecraft;