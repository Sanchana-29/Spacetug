import { useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { TextureLoader } from "three";
import * as THREE from "three";
import StarsField from "../Scene/StarsField";

import dayTexture from "../../assets/textures/earth_day.jpg";
import nightTexture from "../../assets/textures/earth_night.jpg";
import cloudsTexture from "../../assets/textures/earth_clouds.jpg";

function LargeEarth({ position = [2.4, -0.1, 0], radius = 2.2 }) {
  const earthRef = useRef();
  const cloudsRef = useRef();
  const atmosphereRef = useRef();

  const [dayMap, nightMap, cloudsMap] = useLoader(TextureLoader, [
    dayTexture,
    nightTexture,
    cloudsTexture,
  ]);

  useFrame((_, delta) => {
    if (earthRef.current) {
      earthRef.current.rotation.y += delta * 0.025;
    }
    if (cloudsRef.current) {
      cloudsRef.current.rotation.y += delta * 0.032;
    }
    if (atmosphereRef.current) {
      atmosphereRef.current.rotation.y += delta * 0.015;
    }
  });

  return (
    <group position={position}>
      {/* Main Earth Sphere */}
      <mesh ref={earthRef} rotation={[0.2, 3.4, 0]}>
        <sphereGeometry args={[radius, 128, 128]} />
        <meshStandardMaterial
          map={dayMap}
          roughness={0.65}
          metalness={0.1}
          emissiveMap={nightMap}
          emissive="#ffffff"
          emissiveIntensity={0.85}
        />
      </mesh>

      {/* Cloud Layer */}
      <mesh ref={cloudsRef} rotation={[0.2, 3.4, 0]}>
        <sphereGeometry args={[radius * 1.015, 64, 64]} />
        <meshStandardMaterial
          map={cloudsMap}
          transparent={true}
          opacity={0.38}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Outer Atmosphere Cyan / Blue Rim Glow */}
      <mesh ref={atmosphereRef}>
        <sphereGeometry args={[radius * 1.035, 64, 64]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent={true}
          opacity={0.12}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function WelcomeEarthCanvas() {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 1,
        pointerEvents: "none",
      }}
    >
      <Canvas
        camera={{
          position: [0, 0, 4.8],
          fov: 46,
        }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        dpr={[1, 2]}
      >
        {/* Deep space background stars */}
        <StarsField count={3500} factor={4} fade />

        {/* Ambient illumination for night side detail */}
        <ambientLight intensity={0.25} />

        {/* Directional sunlight positioned to brightly illuminate Earth from the top-right */}
        <directionalLight
          position={[7, 4, 5]}
          intensity={3.2}
          color="#ffffff"
        />

        {/* Subtle cyan fill light to emphasize atmospheric rim */}
        <pointLight
          position={[3, 2, 2]}
          intensity={0.8}
          color="#38bdf8"
          distance={10}
        />

        {/* Large rotating Earth placed on the right */}
        <LargeEarth position={[2.5, -0.15, 0]} radius={2.25} />
      </Canvas>
    </div>
  );
}

export default WelcomeEarthCanvas;

