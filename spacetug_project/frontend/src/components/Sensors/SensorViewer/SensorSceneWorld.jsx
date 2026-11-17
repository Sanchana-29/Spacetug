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
 * SATELLITE EARTH-OBSERVATION / EOIR THERMAL IR SHADER
 * =========================================================
 * Professional satellite thermal payload palette (EOS-08 / HotSat / Landsat TIRS style):
 * - Deep Space Background: Deep Navy / Dark Midnight Blue (#040817)
 * - Cold Spacecraft Elements (0.00 - 0.22): Deep Navy Blue -> Dark Slate Blue
 * - Moderate Radiance Elements (0.22 - 0.48): Muted Blue-Cyan -> Soft Pale Ochre / Cyan-Green
 * - Warm Radiative Surfaces (0.48 - 0.75): Rich Amber -> Vivid Radiant Orange
 * - Hot Spots / Thrusters / Solar Cells (0.75 - 1.00): High-intensity Bright Orange -> Vibrant Solar Yellow -> White-Hot Core
 */

const ThermalVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;
  varying vec3 vLocalPosition;
  varying vec2 vUv;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vLocalPosition = position;
    vUv = uv;
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
  varying vec3 vLocalPosition;
  varying vec2 vUv;

  uniform float uBaseTemp;     // Intrinsic component heat [0.0 - 1.0]
  uniform float uEmissivity;   // Surface radiative emissivity
  uniform vec3 uSunDirection;  // Direction to Sun in world coordinates
  uniform float uTime;         // Frame time for micro-sensor noise
  uniform int uIsSolarPanel;   // Flag for procedural solar cell grid gradients

  // Professional Satellite EOIR Thermal Color Mapping:
  // Smooth false-color gradient with high visual dynamic range
  vec3 satelliteEOIRThermal(float t) {
    t = clamp(t, 0.0, 1.0);

    if (t < 0.22) {
      float s = t / 0.22;
      return mix(vec3(0.03, 0.06, 0.18), vec3(0.08, 0.22, 0.48), smoothstep(0.0, 1.0, s));
    } else if (t < 0.48) {
      float s = (t - 0.22) / 0.26;
      return mix(vec3(0.08, 0.22, 0.48), vec3(0.12, 0.62, 0.65), smoothstep(0.0, 1.0, s));
    } else if (t < 0.72) {
      float s = (t - 0.48) / 0.24;
      return mix(vec3(0.12, 0.62, 0.65), vec3(0.94, 0.68, 0.15), smoothstep(0.0, 1.0, s));
    } else if (t < 0.88) {
      float s = (t - 0.72) / 0.16;
      return mix(vec3(0.94, 0.68, 0.15), vec3(0.98, 0.35, 0.02), smoothstep(0.0, 1.0, s));
    } else {
      float s = (t - 0.88) / 0.12;
      return mix(vec3(0.98, 0.35, 0.02), vec3(1.00, 1.00, 0.94), smoothstep(0.0, 1.0, s));
    }
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    vec3 sunDir = normalize(uSunDirection);

    // Directional solar irradiance flux
    float solarIncidence = max(dot(normal, sunDir), 0.0);

    // Baseline heat profile
    float effectiveHeat = uBaseTemp;

    // Procedural solar panel cell micro-gradient (photovoltaic silicon thermal distribution)
    if (uIsSolarPanel == 1) {
      // Create high-contrast photovoltaic cell grid thermal variations
      float gridX = sin(vLocalPosition.x * 14.0);
      float gridY = cos(vLocalPosition.y * 14.0);
      float cellVariation = (gridX * gridY) * 0.08;
      
      // Solar panels directly exposed to sun heat up to 0.88 - 0.98 (bright orange/yellow/white)
      // Rear/shadow side radiates heat down to ~0.45 - 0.60 (cyan/green/ochre)
      float solarFaceHeat = solarIncidence > 0.05 ? (0.35 * solarIncidence) : -0.15;
      effectiveHeat = clamp(uBaseTemp + solarFaceHeat + cellVariation, 0.25, 0.98);
    } else {
      // General satellite chassis and electronics body components
      // Sun-facing surfaces heat up; shadowed cold sides dissipate heat into deep space
      float solarFlux = (solarIncidence * 0.32 - (1.0 - solarIncidence) * 0.12) * uEmissivity;
      effectiveHeat = clamp(uBaseTemp + solarFlux, 0.08, 0.98);
    }

    // Radiative limb dissipation (Fresnel grazing angle cooling)
    float fresnel = 1.0 - max(dot(viewDir, normal), 0.0);
    effectiveHeat = clamp(effectiveHeat - fresnel * 0.04, 0.05, 1.0);

    // Sensor detector temporal noise
    float noise = (fract(sin(dot(gl_FragCoord.xy + vec2(uTime * 8.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.008;
    effectiveHeat = clamp(effectiveHeat + noise, 0.0, 1.0);

    vec3 thermalRgb = satelliteEOIRThermal(effectiveHeat);

    gl_FragColor = vec4(thermalRgb, 1.0);
  }
`;

const processedSceneCache = new Map();

function createThermalMaterial(tempValue, emissivity = 0.85, isSolarPanel = false) {
  return new THREE.ShaderMaterial({
    vertexShader: ThermalVertexShader,
    fragmentShader: ThermalFragmentShader,
    uniforms: {
      uBaseTemp: { value: tempValue },
      uEmissivity: { value: emissivity },
      uSunDirection: { value: new THREE.Vector3(15, 12, 10).normalize() },
      uTime: { value: 0 },
      uIsSolarPanel: { value: isSolarPanel ? 1 : 0 },
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

      // Satellite Thermal Characterization:
      // - Solar Arrays: High-radiance active photovoltaic arrays (0.88 - 0.95 base)
      // - Engine / Thruster Nozzles / Heat Sinks: Extreme thermal sources (0.96 - 0.98)
      // - Multi-Layer Insulation (MLI) Gold packings: Moderate-high reflection (0.75)
      // - Spacecraft Bus & Structural Chassis: Ambient conductive heat (0.55 - 0.65)
      // - Optical Sensors, Lenses & Communications Dishes: Cooled / passive elements (0.20 - 0.35)
      let tempVal = 0.58;
      let emissVal = 0.85;
      let isSolar = false;

      if (
        child.name === "Object_56" ||
        parentNameLower.includes("solar") ||
        nameLower.includes("solar") ||
        originalMatName.includes("solar")
      ) {
        tempVal = 0.90;
        emissVal = 0.95;
        isSolar = true;
      } else if (
        parentNameLower.includes("grill") ||
        nameLower.includes("thruster") ||
        nameLower.includes("engine") ||
        nameLower.includes("nozzle")
      ) {
        tempVal = 0.98;
        emissVal = 0.98;
      } else if (
        child.name === "Object_5" ||
        parentNameLower.includes("packings") ||
        originalMatName.includes("gold") ||
        nameLower.includes("packing")
      ) {
        tempVal = 0.74;
        emissVal = 0.75;
      } else if (
        child.name === "Object_4" ||
        child.name === "Object_6" ||
        parentNameLower.includes("body") ||
        nameLower.includes("body") ||
        originalMatName.includes("satellite_2")
      ) {
        tempVal = 0.62;
        emissVal = 0.85;
      } else if (
        parentNameLower.includes("disc") ||
        parentNameLower.includes("lense") ||
        nameLower.includes("disc") ||
        nameLower.includes("lense")
      ) {
        tempVal = 0.28;
        emissVal = 0.45;
      } else if (
        parentNameLower.includes("cable") ||
        nameLower.includes("cable") ||
        parentNameLower.includes("closing") ||
        nameLower.includes("strut") ||
        nameLower.includes("boom")
      ) {
        tempVal = 0.18;
        emissVal = 0.40;
      } else {
        tempVal = 0.50;
        emissVal = 0.70;
      }

      child.material = createThermalMaterial(tempVal, emissVal, isSolar);
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

    groupRef.current.updateMatrixWorld(true);

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
    <group ref={groupRef} name="TargetSpacecraftGroup" scale={0.08}>
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
      <color attach="background" args={[isThermal ? "#040817" : isLidar ? "#000000" : "#02050c"]} />

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
