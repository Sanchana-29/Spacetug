import React, { useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Stars } from "@react-three/drei";
import * as THREE from "three";
import { FaRocket, FaCheckCircle, FaForward } from "react-icons/fa";
import "./RocketLaunchTransition.css";

/**
 * Animated 3D Rocket Component loading rocket.glb
 */
function RocketModel({ onIgnition, speedRef }) {
  const { scene } = useGLTF("/models/rocket.glb");
  const rocketRef = useRef();
  const plumeRef = useRef();
  const lightRef = useRef();
  const timeRef = useRef(0);

  // Clone scene so materials/instances are isolated
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    // Ensure all meshes can receive/cast shadows and have visible materials
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  useFrame((state, delta) => {
    timeRef.current += delta;
    const t = timeRef.current;

    if (rocketRef.current) {
      // Small atmospheric shudder initially, then rapid upward ascent
      if (t > 0.4) {
        speedRef.current += delta * 1.8;
        rocketRef.current.position.y += speedRef.current * delta * 12;
        // Aerodynamic flight stabilization oscillation
        rocketRef.current.rotation.z = Math.sin(t * 4) * 0.012;
      } else {
        // Pre-launch engine rumble / micro-vibration
        rocketRef.current.position.x = (Math.random() - 0.5) * 0.02;
        rocketRef.current.position.z = (Math.random() - 0.5) * 0.02;
      }

      // Smooth camera driving following rocket
      if (t > 0.4) {
        state.camera.position.y = THREE.MathUtils.lerp(
          state.camera.position.y,
          rocketRef.current.position.y + 1.2,
          0.08
        );
        state.camera.lookAt(
          0,
          rocketRef.current.position.y + 2.0,
          0
        );
      }
    }

    // Exhaust Plume animation
    if (plumeRef.current) {
      if (t > 0.25) {
        const flicker = 0.85 + Math.random() * 0.35;
        const stretch = Math.min(3.2, 1.2 + (t - 0.25) * 1.1);
        plumeRef.current.scale.set(flicker, stretch * flicker, flicker);
        plumeRef.current.visible = true;
      } else {
        plumeRef.current.visible = false;
      }
    }

    // Dynamic flickering engine light
    if (lightRef.current && t > 0.25) {
      lightRef.current.intensity = 25 + Math.random() * 20;
    }
  });

  return (
    <group ref={rocketRef} position={[0, -2.8, 0]}>
      {/* 3D Rocket Mesh from assets / public */}
      <primitive object={clonedScene} scale={0.16} />

      {/* Fiery Thruster Exhaust Plume under engine nozzles */}
      <group ref={plumeRef} position={[0, -0.4, 0]} visible={false}>
        {/* Core incandescent flame cone */}
        <mesh position={[0, -1.0, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.32, 2.2, 24]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>

        {/* Shock diamonds / inner cyan plume */}
        <mesh position={[0, -0.7, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.22, 1.4, 18]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#00b4d8"
            emissiveIntensity={4}
            transparent
            opacity={0.88}
          />
        </mesh>

        {/* Outer supersonic orange plume */}
        <mesh position={[0, -1.4, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.62, 3.2, 24]} />
          <meshStandardMaterial
            color="#ff5500"
            emissive="#ff3300"
            emissiveIntensity={3.5}
            transparent
            opacity={0.85}
          />
        </mesh>

        {/* Outer atmospheric expansion glow */}
        <mesh position={[0, -1.8, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.95, 4.0, 16]} />
          <meshStandardMaterial
            color="#ea580c"
            emissive="#c2410c"
            emissiveIntensity={1.8}
            transparent
            opacity={0.35}
          />
        </mesh>
      </group>

      {/* Dynamic Thruster Light */}
      <pointLight
        ref={lightRef}
        position={[0, -0.5, 0]}
        color="#ff7b00"
        intensity={30}
        distance={22}
      />
    </group>
  );
}

/**
 * Animated High-Speed Streaks rushing past the rocket during ascent
 */
function SpeedStreaks() {
  const pointsRef = useRef();
  const count = 400;

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    return pos;
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const array = pointsRef.current.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      array[i * 3 + 1] -= delta * 45; // Streaks move down rapidly
      if (array[i * 3 + 1] < -20) {
        array[i * 3 + 1] = 25;
      }
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.16}
        color="#93c5fd"
        transparent
        opacity={0.75}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/**
 * RocketLaunchTransition Component
 * Fullscreen cinematic 3D launch sequence loading rocket.glb
 */
export default function RocketLaunchTransition({ missionName, onComplete }) {
  const [phase, setPhase] = useState("IGNITION"); // IGNITION, LIFTOFF, ORBIT_INSERTION, DOCKED
  const [progress, setProgress] = useState(0);
  const [altitude, setAltitude] = useState(0);
  const [velocity, setVelocity] = useState(0);
  const speedRef = useRef(0.02);
  const isCompletedRef = useRef(false);

  const handleFinish = () => {
    if (isCompletedRef.current) return;
    isCompletedRef.current = true;
    if (onComplete) onComplete();
  };

  useEffect(() => {
    const startTime = Date.now();
    const duration = 3800; // 3.8 seconds total transition

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);

      // Interpolate telemetry
      if (elapsed < 800) {
        setPhase("MAIN ENGINES IGNITION");
        setAltitude(Math.round((elapsed / 800) * 12));
        setVelocity(Number((elapsed / 800 * 0.45).toFixed(2)));
      } else if (elapsed < 2000) {
        setPhase("LIFTOFF • MAXIMUM DYNAMIC PRESSURE");
        setAltitude(Math.round(12 + ((elapsed - 800) / 1200) * 85));
        setVelocity(Number((0.45 + ((elapsed - 800) / 1200) * 2.8).toFixed(2)));
      } else if (elapsed < 3100) {
        setPhase("STAGE SEPARATION • ORBITAL INSERTION");
        setAltitude(Math.round(97 + ((elapsed - 2000) / 1100) * 280));
        setVelocity(Number((3.25 + ((elapsed - 2000) / 1100) * 4.1).toFixed(2)));
      } else {
        setPhase("ORBIT ACHIEVED • RENDEZVOUS DOCKING ENGAGED");
        setAltitude(450);
        setVelocity(7.68);
      }

      if (elapsed >= duration) {
        clearInterval(interval);
        handleFinish();
      }
    }, 40);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rocket-launch-overlay">
      {/* 3D Canvas rendering rocket.glb */}
      <div className="rocket-canvas-container">
        <Canvas
          camera={{ position: [0, -0.5, 8.5], fov: 48 }}
          gl={{ antialias: true, alpha: false }}
        >
          <color attach="background" args={["#020617"]} />
          <ambientLight intensity={0.45} />
          <directionalLight position={[10, 20, 10]} intensity={2.0} color="#ffffff" />
          <directionalLight position={[-10, 5, -5]} intensity={0.6} color="#38bdf8" />
          <pointLight position={[0, 10, 5]} intensity={1.2} color="#ffffff" />

          {/* Stars Field */}
          <Stars radius={80} depth={40} count={3500} factor={4} saturation={0} fade speed={1} />

          {/* Upward Velocity Streaks */}
          <SpeedStreaks />

          {/* 3D Animated Rocket */}
          <RocketModel speedRef={speedRef} />
        </Canvas>
      </div>

      {/* Atmospheric Horizon Gradient Vignette */}
      <div className="rocket-atmosphere-vignette" />

      {/* Mission HUD Telemetry Overlay */}
      <div className="rocket-hud-overlay">
        {/* Top Header */}
        <div className="rocket-hud-top">
          <div className="rocket-hud-badge">
            <FaRocket className="pulse-rocket-icon" />
            <span>LAUNCH VEHICLE INSERTION SEQUENCE</span>
          </div>

          <button
            type="button"
            className="btn-skip-launch"
            onClick={handleFinish}
            title="Skip directly to dashboard"
          >
            <span>SKIP LAUNCH</span>
            <FaForward />
          </button>
        </div>

        {/* Center Mission Card Banner */}
        <div className="rocket-hud-center">
          <div className="rocket-mission-tag">MISSION DESIGNATION</div>
          <h2 className="rocket-mission-name">{missionName || "SpaceTug Mission Alpha"}</h2>
          <div className="rocket-phase-display">
            <span className="phase-indicator-dot" />
            <span className="phase-text">{phase}</span>
          </div>
        </div>

        {/* Bottom Telemetry Gauges & Progress Bar */}
        <div className="rocket-hud-bottom">
          <div className="telemetry-readouts-grid">
            <div className="telemetry-box">
              <span className="telemetry-label">ALTITUDE</span>
              <span className="telemetry-val">{altitude} <small>km</small></span>
              <span className="telemetry-sub">TARGET: LEO 450 km</span>
            </div>

            <div className="telemetry-box">
              <span className="telemetry-label">VELOCITY</span>
              <span className="telemetry-val">{velocity.toFixed(2)} <small>km/s</small></span>
              <span className="telemetry-sub">MACH {(velocity * 2.91).toFixed(1)}</span>
            </div>

            <div className="telemetry-box">
              <span className="telemetry-label">TRAJECTORY</span>
              <span className="telemetry-val" style={{ color: "#4ade80" }}>LOCKED</span>
              <span className="telemetry-sub">APPROACH: SAT-001</span>
            </div>

            <div className="telemetry-box">
              <span className="telemetry-label">PAYLOAD</span>
              <span className="telemetry-val" style={{ color: "#38bdf8" }}>ACTIVE</span>
              <span className="telemetry-sub">RGB-D + LIDAR ONLINE</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="launch-progress-wrapper">
            <div className="launch-progress-info">
              <span>INSERTION PROGRESS</span>
              <span>{progress}%</span>
            </div>
            <div className="launch-progress-track">
              <div
                className="launch-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Preload rocket.glb for instant zero-latency loading
useGLTF.preload("/models/rocket.glb");

