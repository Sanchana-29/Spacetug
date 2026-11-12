import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSimulation } from "../../context/SimulationContext";

const SUN_DIR = new THREE.Vector3(25, 8, 20).normalize();
const EARTH_RADIUS = 1.2;

// Realistic Solar Constant in space: ~1361 W/m^2 represented as standard directional lux
const SOLAR_FLUX_INTENSITY = 4.2;

function SunLight({ isThermal = false }) {
  const { chaserPosition, targetPosition, irFloodlight } = useSimulation();
  const dirLightRef = useRef();
  const ambientRef = useRef();
  const floodLightRef = useRef();

  useFrame(() => {
    if (!dirLightRef.current || !ambientRef.current) return;

    // Geometric cylindrical eclipse check:
    // Earth is at (0, 0, 0) with radius 1.2
    // Sun light travels along -SUN_DIR towards Earth
    // Spacecraft is in eclipse if it is behind Earth relative to Sun (dot < 0)
    // and distance from the Sun-Earth axis is less than Earth's radius.
    let inEclipse = false;
    let penumbraFactor = 1.0;

    const p = chaserPosition
      ? new THREE.Vector3(chaserPosition.x, chaserPosition.y, chaserPosition.z)
      : null;

    if (p) {
      const projAlongSun = p.dot(SUN_DIR);

      if (projAlongSun < 0) {
        // Spacecraft is on the anti-sunward (night) side of Earth
        const projVec = SUN_DIR.clone().multiplyScalar(projAlongSun);
        const distFromAxis = p.clone().sub(projVec).length();

        if (distFromAxis < EARTH_RADIUS) {
          inEclipse = true;
          // Inside Earth's cylindrical shadow umbra: deep space eclipse
          // Metallic surfaces turn pitch black with high contrast
          penumbraFactor = Math.max(0, distFromAxis / EARTH_RADIUS);
        }
      }
    }

    if (inEclipse) {
      dirLightRef.current.intensity = SOLAR_FLUX_INTENSITY * penumbraFactor * 0.05;
      // High contrast deep space umbra: virtually zero ambient scatter
      ambientRef.current.intensity = isThermal ? 0.02 : 0.04;
    } else {
      dirLightRef.current.intensity = SOLAR_FLUX_INTENSITY;
      ambientRef.current.intensity = isThermal ? 0.12 : 0.14;
    }

    // Active IR Floodlight positioned on Chaser rig pointing at target
    if (floodLightRef.current && chaserPosition && targetPosition) {
      floodLightRef.current.position.set(
        chaserPosition.x,
        chaserPosition.y + 0.2,
        chaserPosition.z
      );
      floodLightRef.current.target.position.set(
        targetPosition.x,
        targetPosition.y,
        targetPosition.z
      );
      floodLightRef.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      {/* Soft ambient space fill light (kept low for realistic directional contrast) */}
      <ambientLight ref={ambientRef} intensity={0.14} />

      {/* Primary directional sunlight (1361 W/m^2 solar constant equivalent) */}
      <directionalLight
        ref={dirLightRef}
        position={[25, 8, 20]}
        intensity={SOLAR_FLUX_INTENSITY}
        color="#fffaf0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0001}
      />

      {/* Active IR Floodlight (Toggleable on Chaser sensor rig for dark eclipse target visibility) */}
      <spotLight
        ref={floodLightRef}
        intensity={irFloodlight ? 6.5 : 0}
        color="#ffffff"
        distance={25}
        angle={Math.PI / 4}
        penumbra={0.4}
        decay={1.2}
      />

      {/* Subtle planetary albedo reflection from Earth onto spacecraft */}
      <pointLight
        position={[0, 0, 0]}
        intensity={0.4}
        distance={8}
        color="#38bdf8"
      />
    </>
  );
}

export default SunLight;