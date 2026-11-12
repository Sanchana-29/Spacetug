import { useLoader, useFrame } from "@react-three/fiber";
import { TextureLoader } from "three";
import { useRef } from "react";

import dayTexture from "../../assets/textures/earth_day.jpg";
import nightTexture from "../../assets/textures/earth_night.jpg";
import cloudsTexture from "../../assets/textures/earth_clouds.jpg";

function Earth({ isMini = false }) {
  const earthRef = useRef();
  const cloudsRef = useRef();

  // Load day, night, and cloud textures
  const [dayMap, nightMap, cloudsMap] = useLoader(TextureLoader, [
    dayTexture,
    nightTexture,
    cloudsTexture,
  ]);

  useFrame((_, delta) => {
    // Realistic slow axial rotation of Earth
    if (earthRef.current) {
      earthRef.current.rotation.y += delta * 0.04;
    }
    // Atmospheric cloud layer rotation at slightly different angular velocity
    if (cloudsRef.current) {
      cloudsRef.current.rotation.y += delta * 0.048;
    }
  });

  return (
    <group>
      {/* Earth Surface Sphere */}
      <mesh ref={earthRef}>
        <sphereGeometry args={[1.2, isMini ? 32 : 128, isMini ? 32 : 128]} />
        <meshStandardMaterial
          map={dayMap}
          roughness={0.65}
          metalness={0.1}
          emissiveMap={nightMap}
          emissive="#ffffff"
          emissiveIntensity={0.8}
        />
      </mesh>
      
      {/* Atmospheric Cloud Sphere Layer */}
      {!isMini && (
        <mesh ref={cloudsRef}>
          <sphereGeometry args={[1.215, 64, 64]} />
          <meshStandardMaterial
            map={cloudsMap}
            transparent={true}
            opacity={0.35}
            blending={2} // AdditiveBlending
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

export default Earth;