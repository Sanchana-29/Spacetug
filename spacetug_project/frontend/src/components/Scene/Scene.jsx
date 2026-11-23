import { useRef, useMemo } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

import TargetSpacecraft from "../Spacecraft/TargetSpacecraft";
import ServicerSpacecraft from "../Spacecraft/ServicerSpacecraft";

import Earth from "./Earth";
import StarsField from "./StarsField";
import SunLight from "./SunLight";
import OrbitPath from "./OrbitPath";

import { useSimulation } from "../../context/SimulationContext";
import {
  getTargetPositionAtTime,
  ORBIT_RADIUS,
  ORBIT_OMEGA,
} from "../../utils/trajectory";

function DashboardCameraController({ controlsRef }) {
  const { chaserPosRef, targetPosRef, chaserPosition, targetPosition, cameraMode, simulationSpeed } = useSimulation();
  const prevCameraModeRef = useRef(cameraMode);
  useFrame(({ camera }) => {
    if (!controlsRef.current) return;

    // Detect transitions into FREE mode: release lock and leave OrbitControls target where camera is currently focused
    if (prevCameraModeRef.current !== cameraMode) {
      if (cameraMode === "FREE") {
        controlsRef.current.enablePan = true;
        controlsRef.current.enableRotate = true;
        controlsRef.current.enableZoom = true;
      }
      prevCameraModeRef.current = cameraMode;
    }

    const curChaser = chaserPosRef?.current || chaserPosition;
    const curTarget = targetPosRef?.current || targetPosition;
    // Scale lerp alpha dynamically with simulation speed to prevent lag at 5x/10x speeds
    const speedFactor = Math.max(1, simulationSpeed || 1);
    const lerpAlpha = Math.min(1.0, 0.15 * speedFactor);

    if (cameraMode === "CHASER" || cameraMode === "CHASER_FOLLOW") {
      // 1. CHASER VIEW: Follow / Over-the-shoulder view of the Chaser Spacecraft
      // Positions the camera slightly behind and above the Chaser, looking forward over the spacecraft directly toward SAT-001
      const forwardDir = curTarget
        ? new THREE.Vector3(curTarget.x - curChaser.x, curTarget.y - curChaser.y, curTarget.z - curChaser.z).normalize()
        : new THREE.Vector3(0, 0, -1);
      const upVector = new THREE.Vector3(0, 1, 0);
      const rightVector = new THREE.Vector3().crossVectors(upVector, forwardDir).normalize();
      const realUp = new THREE.Vector3().crossVectors(forwardDir, rightVector).normalize();

      // Camera offset: behind (-forwardDir * 1.5) and slightly above (+realUp * 0.45)
      const desiredCamPos = new THREE.Vector3(
        curChaser.x - forwardDir.x * 1.5 + realUp.x * 0.45,
        curChaser.y - forwardDir.y * 1.5 + realUp.y * 0.45,
        curChaser.z - forwardDir.z * 1.5 + realUp.z * 0.45
      );

      // Smooth camera interpolation directly tracking high-rate ref positions
      camera.position.lerp(desiredCamPos, lerpAlpha);

      const lookAtWorld = new THREE.Vector3(
        curTarget.x,
        curTarget.y,
        curTarget.z
      );
      controlsRef.current.target.lerp(lookAtWorld, lerpAlpha);
      controlsRef.current.update();
    } else if (cameraMode === "TARGET") {
      // 2. TARGET VIEW: Follows actual Target spacecraft with close inspection angle looking toward Chaser
      const angle = Math.atan2(curTarget.z, curTarget.x);
      const headingY = angle + Math.PI;

      // Positioned offset from target looking inward at target center
      const offsetLocal = new THREE.Vector3(0.6, 0.5, 1.4);
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingY);
      const offsetWorld = offsetLocal.clone().applyQuaternion(quat);

      const desiredCamPos = new THREE.Vector3(
        curTarget.x + offsetWorld.x,
        curTarget.y + offsetWorld.y,
        curTarget.z + offsetWorld.z
      );

      camera.position.lerp(desiredCamPos, lerpAlpha);

      const targetCenter = new THREE.Vector3(
        curTarget.x,
        curTarget.y,
        curTarget.z
      );

      controlsRef.current.target.lerp(targetCenter, lerpAlpha);
      controlsRef.current.update();
    } else {
      // 3. FREE VIEW: Completely release automatic camera driving!
    }
  });

  return null;
}

function ExactTargetTrajectoryPath() {
  const points = useMemo(() => {
    const pts = [];
    const steps = 300;
    const totalT = (Math.PI * 2) / ORBIT_OMEGA;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * totalT;
      pts.push(getTargetPositionAtTime(t));
    }
    return pts;
  }, []);

  const geometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [points]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color="#4ade80" transparent opacity={0.6} />
    </line>
  );
}

function Scene() {
  const { selectedObject } = useSimulation();
  const controlsRef = useRef();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
      }}
    >
      <Canvas
        shadows
        camera={{
          position: [5.2, 2.5, 6.5],
          fov: 45,
        }}
      >
        <DashboardCameraController controlsRef={controlsRef} />

        {/* Lighting */}
        <SunLight />

        {/* Space background */}
        <StarsField />

        {/* Earth */}
        <Earth />

        {/* =========================
            CHASER ORBIT
        ========================= */}

        {selectedObject?.id === "CHS-001" && (
          <OrbitPath
            radiusX={ORBIT_RADIUS}
            radiusZ={ORBIT_RADIUS}
            y={0}
          />
        )}

        {/* =========================
            EXACT TARGET TRAJECTORY
        ========================= */}

        {selectedObject?.id === "SAT-001" && (
          <ExactTargetTrajectoryPath />
        )}

        {/* =========================
            SPACECRAFT
        ========================= */}

        <ServicerSpacecraft />

        <TargetSpacecraft />

        {/* =========================
            CAMERA CONTROLS
        ========================= */}

        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          minDistance={2}
          maxDistance={25}
        />
      </Canvas>
    </div>
  );
}

export default Scene;