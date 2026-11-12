import * as THREE from "three";

const CHASER_ORBIT_X = 4.8;
const CHASER_ORBIT_Z = 5.5;
const TARGET_ORBIT_X = 6.2;
const TARGET_ORBIT_Z = 7.0;
const CHASER_SCALE = 0.25;

const SENSOR_CONFIGS = {
  "RGB-D Camera": { localPos: [0, 0.48, -0.70], localRot: [0, 0, 0], fov: 60 },
  "Stereo Camera": { localPos: [0, 0.35, -0.58], localRot: [0, 0, 0], fov: 60 },
  "Thermal Camera": { localPos: [0, 0.05, 0.90], localRot: [0, 0, 0], fov: 60 },
  "LiDAR": { localPos: [0, 0, -1.15], localRot: [0, 0, 0], fov: 60 },
};

function simulate(t) {
  // Chaser Orbit
  const chaserAngle = 0.03 * t;
  const chaserPos = new THREE.Vector3(
    Math.cos(chaserAngle) * CHASER_ORBIT_X,
    0,
    Math.sin(chaserAngle) * CHASER_ORBIT_Z
  );

  const angle = Math.atan2(chaserPos.z / CHASER_ORBIT_Z, chaserPos.x / CHASER_ORBIT_X);
  const chaserRotationY = angle + Math.PI / 2;
  const chaserQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), chaserRotationY);

  // Target Orbit
  const relativeZ = -1.4 + Math.sin(t * 0.5) * 0.15;
  const relativeX = Math.sin(t * 0.3) * 0.15;
  const relativeY = Math.sin(t * 0.4) * 0.05;
  
  const localOffset = new THREE.Vector3(relativeX, relativeY, relativeZ);
  localOffset.applyQuaternion(chaserQuat);
  const targetPos = chaserPos.clone().add(localOffset);

  console.log(`\n--- Time: ${t.toFixed(1)} ---`);
  console.log(`Chaser Pos: ${chaserPos.toArray().map(v=>v.toFixed(3)).join(', ')}`);
  console.log(`Target Pos: ${targetPos.toArray().map(v=>v.toFixed(3)).join(', ')}`);

  for (const [sensorName, config] of Object.entries(SENSOR_CONFIGS)) {
    const localOffsetScaled = new THREE.Vector3(
      config.localPos[0] * CHASER_SCALE,
      config.localPos[1] * CHASER_SCALE,
      config.localPos[2] * CHASER_SCALE
    );
    localOffsetScaled.applyQuaternion(chaserQuat);
    const sensorWorldPos = chaserPos.clone().add(localOffsetScaled);

    const sensorLocalQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(config.localRot[0], config.localRot[1], config.localRot[2], "YXZ"));
    const sensorWorldQuat = chaserQuat.clone().multiply(sensorLocalQuat);

    // Calculate forward vector
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(sensorWorldQuat).normalize();
    
    const directionToTarget = targetPos.clone().sub(sensorWorldPos).normalize();
    const distance = sensorWorldPos.distanceTo(targetPos);
    
    const angleToTarget = forward.angleTo(directionToTarget) * (180 / Math.PI);
    
    // Tracking active means the camera is rotated to look exactly at targetPosition
    // But we need to know if the target is within the intended physical FOV anyway? 
    // Yes, but let's check angleToTarget when tracking is OFF.
    const isInsidePhysicalFOV = angleToTarget <= (config.fov / 2);

    console.log(`[${sensorName}] Pos: ${sensorWorldPos.toArray().map(v=>v.toFixed(3)).join(', ')} | Dist: ${distance.toFixed(3)} | Angle: ${angleToTarget.toFixed(2)} deg | In FOV: ${isInsidePhysicalFOV}`);
  }
}

// Simulate multiple times
simulate(0);
simulate(10);
simulate(20);
simulate(50);
simulate(100);
