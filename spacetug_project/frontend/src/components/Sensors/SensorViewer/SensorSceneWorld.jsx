import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import { useSimulation } from "../../../context/SimulationContext";
import {
  getSensorWorldTransform,
  TARGET_ORBIT_X,
  TARGET_ORBIT_Z,
} from "./sensorConstants";
import { INITIAL_TARGET_POSITION } from "../../../utils/trajectory";

import Earth from "../../Scene/Earth";
import StarsField from "../../Scene/StarsField";
import SunLight from "../../Scene/SunLight";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";

/*
 * =========================================================
 * REALISTIC RADIOMETRIC THERMAL IR PHYSICS SHADER
 * =========================================================
 * Dynamic radiometric thermal shader driven by surface heat distribution:
 * - High Heat (Yellow/White glow): Active solar panel cells exposed to sunlight,
 *   internal thruster nozzles, and electronics manifolds.
 * - Medium Heat (Orange/Red): Satellite main metallic chassis bus conducting internal thermal energy.
 * - Cold Zones (Blue/Purple): Shaded structural struts, cold optical dishes,
 *   and space environment background baseline.
 */

const ThermalVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const ThermalFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;

  uniform float uBaseTemp;     // Intrinsic component heat [0.0 - 1.0]
  uniform float uEmissivity;   // Surface radiative emissivity
  uniform vec3 uSunDirection;  // Direction to Sun in world coordinates
  uniform float uTime;         // Frame time for micro-sensor noise

  // Radiometric thermal colormap mapping:
  // High Heat (0.80 - 1.0): Yellow to White glow
  // Medium Heat (0.45 - 0.79): Orange to Red/Magenta
  // Cold Zones (0.05 - 0.44): Blue to Deep Purple
  // Deep space: Pitch black
  vec3 radiometricThermal(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c = vec3(0.0);

    if (t < 0.25) {
      // Deep Purple to Blue
      float s = t / 0.25;
      c = mix(vec3(0.08, 0.0, 0.22), vec3(0.0, 0.18, 0.85), s);
    } else if (t < 0.50) {
      // Blue to Magenta / Deep Red
      float s = (t - 0.25) / 0.25;
      c = mix(vec3(0.0, 0.18, 0.85), vec3(0.82, 0.02, 0.45), s);
    } else if (t < 0.75) {
      // Magenta/Red to Warm Orange
      float s = (t - 0.50) / 0.25;
      c = mix(vec3(0.82, 0.02, 0.45), vec3(1.0, 0.42, 0.0), s);
    } else if (t < 0.90) {
      // Warm Orange to Bright Yellow
      float s = (t - 0.75) / 0.15;
      c = mix(vec3(1.0, 0.42, 0.0), vec3(1.0, 0.92, 0.15), s);
    } else {
      // Bright Yellow to Intense White Glow
      float s = (t - 0.90) / 0.10;
      c = mix(vec3(1.0, 0.92, 0.15), vec3(1.0, 1.0, 1.0), s);
    }

    return c;
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);

    vec3 sunDir = normalize(uSunDirection);
    float solarIncidence = max(dot(normal, sunDir), 0.0);

    // Dynamic solar thermal absorption: sunlight-exposed active surfaces gain heat
    float solarAbsorption = solarIncidence * 0.35 * uEmissivity;
    float effectiveHeat = clamp(uBaseTemp + solarAbsorption, 0.05, 1.0);

    // Radiative limb cooling (Fresnel angle dissipation)
    float fresnel = 1.0 - max(dot(viewDir, normal), 0.0);
    effectiveHeat = clamp(effectiveHeat - fresnel * 0.04, 0.05, 1.0);

    // Micro-sensor thermal noise
    float noise = (fract(sin(dot(gl_FragCoord.xy + vec2(uTime * 12.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.012;
    effectiveHeat = clamp(effectiveHeat + noise, 0.05, 1.0);

    vec3 thermalRgb = radiometricThermal(effectiveHeat);

    gl_FragColor = vec4(thermalRgb, 1.0);
  }
`;

const processedSceneCache = new Map();

function createThermalMaterial(tempValue, emissivity = 0.85) {
  return new THREE.ShaderMaterial({
    vertexShader: ThermalVertexShader,
    fragmentShader: ThermalFragmentShader,
    uniforms: {
      uBaseTemp: { value: tempValue },
      uEmissivity: { value: emissivity },
      uSunDirection: { value: new THREE.Vector3(15, 12, 10).normalize() },
      uTime: { value: 0 },
    },
  });
}

function getCachedProcessedScene(scene, sensorMode) {
  const cacheKey = sensorMode === "Stereo Camera"
    ? "RGB-D Camera"
    : sensorMode;

  if (processedSceneCache.has(cacheKey)) {
    return processedSceneCache.get(cacheKey).clone(true);
  }

  const cloned = scene.clone(true);

  if (sensorMode === "LiDAR") {
    cloned.updateMatrixWorld(true);

    const meshes = [];
    let totalSurfaceArea = 0;

    cloned.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;

      const geom = child.geometry.clone();
      geom.applyMatrix4(child.matrixWorld);

      let area = 1.0;
      if (geom.attributes.position) {
        area = Math.max(0.1, geom.attributes.position.count * 0.01);
      }

      meshes.push({ mesh: new THREE.Mesh(geom, new THREE.MeshBasicMaterial()), area });
      totalSurfaceArea += area;
    });

    // Sample 12,000 spatial raycast surface hit points across solar arrays, cylindrical core, dish & struts
    const TOTAL_POINTS = 12000;
    const sampledPositions = [];
    const sampledColors = [];

    meshes.forEach(({ mesh, area }) => {
      try {
        const sampler = new MeshSurfaceSampler(mesh).build();
        const meshPointCount = Math.max(25, Math.floor((area / totalSurfaceArea) * TOTAL_POINTS));

        const tempPos = new THREE.Vector3();
        const tempNorm = new THREE.Vector3();

        for (let i = 0; i < meshPointCount; i++) {
          sampler.sample(tempPos, tempNorm);
          sampledPositions.push(tempPos.x, tempPos.y, tempPos.z);
        }
      } catch (e) {
        if (mesh.geometry.attributes.position) {
          const pos = mesh.geometry.attributes.position;
          const stride = Math.max(1, Math.floor(pos.count / 20));
          for (let i = 0; i < pos.count; i += stride) {
            sampledPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          }
        }
      }
    });

    // High-density crisp 3D spatial point cloud with distance-coded depth colors:
    // Bright cyan/white for near-range surface hits -> gradient to deep blue for far range
    let minZ = 999;
    let maxZ = -999;
    for (let i = 2; i < sampledPositions.length; i += 3) {
      const z = sampledPositions[i];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const zRange = Math.max(0.01, maxZ - minZ);

    for (let i = 2; i < sampledPositions.length; i += 3) {
      const z = sampledPositions[i];
      // Near range hits -> bright cyan/white (#cffafe / #22d3ee), far range -> deep blue (#1d4ed8 / #0f172a)
      const normDepth = clampVal((z - minZ) / zRange, 0.0, 1.0);
      const r = THREE.MathUtils.lerp(0.9, 0.04, normDepth);
      const g = THREE.MathUtils.lerp(1.0, 0.25, normDepth);
      const b = THREE.MathUtils.lerp(1.0, 0.95, normDepth);
      sampledColors.push(r, g, b);
    }

    const combinedGeometry = new THREE.BufferGeometry();
    combinedGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(sampledPositions, 3)
    );
    combinedGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(sampledColors, 3)
    );

    // High-density, crisp 3D point cloud with vertex depth coloring across deep space
    const pointMaterial = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const combinedPoints = new THREE.Points(combinedGeometry, pointMaterial);
    const pointsGroup = new THREE.Group();
    pointsGroup.add(combinedPoints);

    processedSceneCache.set(cacheKey, pointsGroup);
    return pointsGroup.clone(true);
  }

  if (sensorMode === "Thermal Camera") {
    cloned.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;

      const nameLower = (child.name || "").toLowerCase();
      const parentNameLower = (child.parent?.name || "").toLowerCase();
      const originalMatName = (child.material?.name || "").toLowerCase();

      // Hot heat sources (solar panels, propulsion, active components): 0.95 - 0.98
      // Metallic body surfaces: 0.65
      // Cold shaded sections: 0.22 - 0.35
      let tempVal = 0.58;
      let emissVal = 0.85;

      if (
        parentNameLower.includes("solar") ||
        nameLower.includes("solar") ||
        originalMatName.includes("solar")
      ) {
        tempVal = 0.95;
        emissVal = 0.96;
      } else if (
        parentNameLower.includes("grill") ||
        nameLower.includes("thruster") ||
        nameLower.includes("engine") ||
        nameLower.includes("nozzle")
      ) {
        tempVal = 0.98;
        emissVal = 0.98;
      } else if (
        parentNameLower.includes("packings") ||
        originalMatName.includes("gold") ||
        nameLower.includes("packing")
      ) {
        tempVal = 0.76;
        emissVal = 0.70;
      } else if (
        parentNameLower.includes("body") ||
        nameLower.includes("body") ||
        originalMatName.includes("satellite_2")
      ) {
        tempVal = 0.65;
        emissVal = 0.82;
      } else if (
        parentNameLower.includes("disc") ||
        parentNameLower.includes("lense") ||
        nameLower.includes("disc") ||
        nameLower.includes("lense")
      ) {
        tempVal = 0.35;
        emissVal = 0.55;
      } else if (
        parentNameLower.includes("cable") ||
        nameLower.includes("cable") ||
        parentNameLower.includes("closing") ||
        nameLower.includes("strut") ||
        nameLower.includes("boom")
      ) {
        tempVal = 0.22;
        emissVal = 0.50;
      } else {
        if (child.geometry) {
          if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
          const bbox = child.geometry.boundingBox;
          const center = new THREE.Vector3();
          if (bbox) bbox.getCenter(center);

          if (Math.abs(center.x) > 1.0) {
            tempVal = 0.92;
          } else if (center.z > 0.6 || center.y < -0.4) {
            tempVal = 0.96;
          } else {
            tempVal = 0.60;
          }
        }
      }

      child.material = createThermalMaterial(tempVal, emissVal);
    });

    processedSceneCache.set(cacheKey, cloned);
    return cloned.clone(true);
  }

  cloned.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  processedSceneCache.set(cacheKey, cloned);
  return cloned.clone(true);
}

function clampVal(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/*
 * DIRECT MATRIX TRANSFORMATIONS ON TARGET SATELLITE
 * Uses direct useRef instances to copy high-rate physics matrices without React re-renders.
 */
function SensorTargetSatellite({ sensorMode }) {
  const { targetPosRef, targetQuatRef, targetPosition, targetQuaternion } = useSimulation();
  const { scene } = useGLTF("/models/satellite.glb");
  const groupRef = useRef();

  const clonedScene = useMemo(() => {
    return getCachedProcessedScene(scene, sensorMode);
  }, [scene, sensorMode]);

  useFrame((state) => {
    if (!groupRef.current) return;

    // Direct matrix copy from high-rate physics refs
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

    // Direct shader uniform update without React re-renders
    if (sensorMode === "Thermal Camera") {
      const elapsedTime = state.clock.getElapsedTime();
      clonedScene.traverse((child) => {
        if (child.isMesh && child.material && child.material.uniforms?.uTime) {
          child.material.uniforms.uTime.value = elapsedTime;
        }
      });
    }
  });

  return (
    <group ref={groupRef} scale={0.08}>
      <primitive object={clonedScene} />
    </group>
  );
}

/*
 * PHYSICAL SENSOR CAMERA (Direct matrix updates)
 */
function PhysicalSensorCameraController({
  sensor,
  subType,
  viewMode = "CHASER",
  onGlReady,
}) {
  const { camera, gl, scene } = useThree();
  const { chaserPosRef, targetPosRef, chaserPosition, targetPosition, irFloodlight } = useSimulation();

  useEffect(() => {
    if (onGlReady) {
      onGlReady({ gl, scene, camera });
    }
  }, [gl, scene, camera, onGlReady]);

  const floodLightRef = useRef();

  useFrame(() => {
    const curChaser = chaserPosRef?.current || chaserPosition;
    const curTarget = targetPosRef?.current || targetPosition;

    if (viewMode === "FREE") {
      if (floodLightRef.current) {
        floodLightRef.current.position.copy(camera.position);
      }
      return;
    }

    if (viewMode === "TARGET") {
      if (curTarget) {
        const offset = new THREE.Vector3(0.65, 0.45, 1.65);
        camera.position.set(
          curTarget.x + offset.x,
          curTarget.y + offset.y,
          curTarget.z + offset.z
        );
        camera.lookAt(curTarget.x, curTarget.y, curTarget.z);
      }
    } else {
      const { position, quaternion, fov } = getSensorWorldTransform(
        curChaser,
        sensor,
        subType,
        curTarget
      );

      camera.position.copy(position);
      camera.quaternion.copy(quaternion);

      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }

    if (floodLightRef.current) {
      floodLightRef.current.position.copy(camera.position);
      if (curTarget) {
        floodLightRef.current.target.position.set(curTarget.x, curTarget.y, curTarget.z);
        floodLightRef.current.target.updateMatrixWorld();
      }
    }
  });

  return (
    <>
      {/* Forward-facing Active IR Spotlight tied strictly to irFloodlight toggle */}
      <spotLight
        ref={floodLightRef}
        intensity={irFloodlight ? 6.5 : 0}
        color="#ffffff"
        distance={25}
        angle={Math.PI / 4}
        penumbra={0.4}
        decay={1.2}
      />
      {viewMode === "FREE" && (
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          target={[
            targetPosRef?.current?.x ?? targetPosition?.x ?? 5.2,
            targetPosRef?.current?.y ?? targetPosition?.y ?? 0,
            targetPosRef?.current?.z ?? targetPosition?.z ?? 1.24,
          ]}
        />
      )}
    </>
  );
}

function SensorSceneWorld({
  sensor,
  subType = null,
  viewMode = "CHASER",
  onGlReady,
  onFrameRendered,
  isMini = false,
}) {
  const isThermal = sensor === "Thermal Camera";
  const isLidar = sensor === "LiDAR";
  const isDeepSpaceBlack = isThermal || isLidar;

  useFrame((state) => {
    if (onFrameRendered) {
      onFrameRendered({
        gl: state.gl,
        scene: state.scene,
        camera: state.camera,
        frame: state.gl.info.render.frame,
      });
    }
  });

  return (
    <>
      <color attach="background" args={[isDeepSpaceBlack ? "#000000" : "#02050c"]} />

      <PhysicalSensorCameraController
        sensor={sensor}
        subType={subType}
        viewMode={viewMode}
        onGlReady={onGlReady}
      />

      <SunLight isThermal={isThermal} />

      {!isDeepSpaceBlack && <StarsField isMini={isMini} />}

      {!isDeepSpaceBlack && <Earth isMini={isMini} />}

      <SensorTargetSatellite sensorMode={sensor} />
    </>
  );
}

useGLTF.preload("/models/satellite.glb");

export default SensorSceneWorld;
