import React, { useRef, useMemo, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useSimulation } from "../../../context/SimulationContext";
import { getSensorWorldTransform } from "./sensorConstants";

// Custom Depth Shaders
const DepthVertexShader = `
  varying float vDepth;
  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    // Negative Z in view space represents distance forward from camera lens
    vDepth = -viewPos.z;
    gl_Position = projectionMatrix * viewPos;
  }
`;

const DepthFragmentShader = `
  varying float vDepth;
  uniform float uNear;
  uniform float uFar;
  uniform int uColorMode; // 0 = Grayscale/Cyan, 1 = False-Color Turbo

  void main() {
    // Optical distance along camera axis normalized between near and far
    float norm = clamp((vDepth - uNear) / max(0.01, uFar - uNear), 0.0, 1.0);
    // Near satellite geometry = 1.0 (bright white / cyan), background depth = 0.0 (deep black)
    float depthVal = 1.0 - norm;

    if (uColorMode == 0) {
      // Clear grayscale / cyan depth map:
      // Nearest satellite geometry in bright white/cyan (#e0f2fe / #38bdf8), receding to deep black
      vec3 cyanDepth = vec3(depthVal * 0.88, depthVal * 0.98, depthVal * 1.0);
      gl_FragColor = vec4(cyanDepth, 1.0);
    } else {
      gl_FragColor = vec4(vec3(depthVal), 1.0);
    }
  }
`;

/**
 * Depth-Pass Satellite Mesh (Direct Ref Matrix Transformations)
 */
function DepthSatelliteModel({ colorMode, targetDistance }) {
  const { scene } = useGLTF("/models/satellite.glb");
  const { targetPosRef, targetQuatRef, targetPosition, targetQuaternion } = useSimulation();
  const groupRef = useRef();

  const d = Math.max(0.5, Number(targetDistance) || 1.4);
  const uNearVal = Math.max(0.1, d - 1.2);
  const uFarVal = d + 1.2;

  const depthMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: DepthVertexShader,
      fragmentShader: DepthFragmentShader,
      uniforms: {
        uNear: { value: uNearVal },
        uFar: { value: uFarVal },
        uColorMode: { value: colorMode === "grayscale" ? 0 : 1 },
      },
    });
  }, [colorMode, uNearVal, uFarVal]);

  const depthScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (child.isMesh) {
        child.material = depthMaterial;
      }
    });
    return clone;
  }, [scene, depthMaterial]);

  useFrame(() => {
    if (!groupRef.current) return;

    if (targetPosRef?.current) {
      groupRef.current.position.copy(targetPosRef.current);
    } else if (targetPosition) {
      groupRef.current.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
    }

    if (targetQuatRef?.current) {
      groupRef.current.quaternion.copy(targetQuatRef.current);
    } else if (targetQuaternion) {
      groupRef.current.quaternion.copy(targetQuaternion);
    }

    if (depthMaterial.uniforms) {
      const curD = Math.max(0.5, Number(targetDistance) || 1.4);
      depthMaterial.uniforms.uNear.value = Math.max(0.1, curD - 1.2);
      depthMaterial.uniforms.uFar.value = curD + 1.2;
      depthMaterial.uniforms.uColorMode.value = colorMode === "grayscale" ? 0 : 1;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={depthScene} scale={0.08} />
    </group>
  );
}

/**
 * Camera matching the physical RGB-D sensor feed (Direct Matrix copy)
 */
function DepthCameraController() {
  const { camera } = useThree();
  const { chaserPosRef, targetPosRef, chaserPosition, targetPosition } = useSimulation();

  useFrame(() => {
    const curChaser = chaserPosRef?.current || chaserPosition;
    const curTarget = targetPosRef?.current || targetPosition;
    const { position, quaternion, fov } = getSensorWorldTransform(
      curChaser,
      "RGB-D Camera",
      null,
      curTarget
    );

    camera.position.copy(position);
    camera.quaternion.copy(quaternion);

    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

/**
 * Main DepthMapViewer Component
 */
export default function DepthMapViewer({ distance = 1.4 }) {
  const [colorMode, setColorMode] = useState("grayscale");

  return (
    <div
      style={{
        position: "absolute",
        left: "14px",
        bottom: "14px",
        width: "180px",
        height: "125px",
        background: "#030712",
        borderRadius: "8px",
        border: "1px solid #38bdf8",
        boxShadow: "0 4px 18px rgba(0, 0, 0, 0.7)",
        overflow: "hidden",
        zIndex: 20,
      }}
    >
      <Canvas
        camera={{ fov: 60, near: 0.05, far: 50 }}
        gl={{ preserveDrawingBuffer: true, antialias: false }}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <DepthCameraController />
        <DepthSatelliteModel colorMode={colorMode} targetDistance={distance} />
      </Canvas>

      {/* Top Header Tag */}
      <div
        style={{
          position: "absolute",
          top: "4px",
          left: "6px",
          fontSize: "8px",
          fontWeight: "bold",
          color: "#38bdf8",
          letterSpacing: "0.5px",
          pointerEvents: "none",
          textShadow: "0 0 3px black",
        }}
      >
        Z-BUFFER DEPTH MAP
      </div>

      {/* Mode toggle */}
      <div
        style={{
          position: "absolute",
          top: "4px",
          right: "4px",
          display: "flex",
          gap: "2px",
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={() => setColorMode("grayscale")}
          style={{
            background: colorMode === "grayscale" ? "#38bdf8" : "rgba(0,0,0,0.6)",
            color: colorMode === "grayscale" ? "#000" : "#fff",
            border: "1px solid #334155",
            borderRadius: "3px",
            fontSize: "8px",
            fontWeight: "bold",
            padding: "1px 4px",
            cursor: "pointer",
          }}
        >
          GRAY
        </button>
        <button
          type="button"
          onClick={() => setColorMode("color")}
          style={{
            background: colorMode === "color" ? "#38bdf8" : "rgba(0,0,0,0.6)",
            color: colorMode === "color" ? "#000" : "#fff",
            border: "1px solid #334155",
            borderRadius: "3px",
            fontSize: "8px",
            fontWeight: "bold",
            padding: "1px 4px",
            cursor: "pointer",
          }}
        >
          TURBO
        </button>
      </div>

      {/* Distance range badge */}
      <div
        style={{
          position: "absolute",
          bottom: "3px",
          left: "4px",
          fontSize: "8px",
          color: "#94a3b8",
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.7)",
          padding: "1px 4px",
          borderRadius: "2px",
          zIndex: 10,
        }}
      >
        Z: {distance.toFixed(2)}m
      </div>
    </div>
  );
}
