import * as THREE from "three";
import {
  CHASER_ORBIT_X,
  CHASER_ORBIT_Z,
  TARGET_ORBIT_X,
  TARGET_ORBIT_Z,
} from "../../../utils/trajectory";

export { CHASER_ORBIT_X, CHASER_ORBIT_Z, TARGET_ORBIT_X, TARGET_ORBIT_Z };
export const CHASER_SCALE = 0.25;

export const SENSOR_CONFIGS = {
  "RGB-D Camera": {
    key: "rgbd",
    // Dead-Center on the forward sensor plate
    localPos: [0, 0, 1.2],
    localRot: [0, 0, 0],
    fov: 60,
    subtitle: "RGB + Depth Perception Feed",
  },
  "Stereo Camera": {
    key: "stereo",
    localPos: [0, 0, 1.2], // center optical reference
    localRot: [0, 0, 0],
    fov: 60,
    subtitle: "Binocular Vision Feed",
  },
  "Stereo Left": {
    key: "stereo_left",
    // Outer Left edge of forward face: b = 0.25m baseline (-0.125m)
    localPos: [-0.125, 0, 1.2],
    localRot: [0, 0, 0],
    fov: 60,
    subtitle: "Left Camera Optical Feed",
  },
  "Stereo Right": {
    key: "stereo_right",
    // Outer Right edge of forward face: b = 0.25m baseline (+0.125m)
    localPos: [0.125, 0, 1.2],
    localRot: [0, 0, 0],
    fov: 60,
    subtitle: "Right Camera Optical Feed",
  },
  LiDAR: {
    key: "lidar",
    // Top-Center position on forward sensor plate
    localPos: [0, 0.065, 1.2],
    localRot: [0, 0, 0],
    fov: 60,
    subtitle: "3D Point Cloud Feed",
  },
  "Thermal Camera": {
    key: "thermal",
    // Bottom-Center position on forward sensor plate
    localPos: [0, -0.065, 1.2],
    localRot: [0, 0, 0],
    fov: 60,
    subtitle: "Infrared Thermal Radiance Feed",
  },
};

/**
 * Calculates physical world position & quaternion of a sensor mount on Chaser,
 * locked directly facing forward along the boresight line of sight (+Z / Target direction).
 */
export function getSensorWorldTransform(chaserPosition, sensorName, subType = null, targetPosition = null) {
  const configKey = subType || sensorName;
  const config = SENSOR_CONFIGS[configKey] || SENSOR_CONFIGS["RGB-D Camera"];

  const chaserPos = new THREE.Vector3(
    chaserPosition?.x ?? CHASER_ORBIT_X,
    chaserPosition?.y ?? 0,
    chaserPosition?.z ?? 0
  );

  const targetPos = new THREE.Vector3(
    targetPosition?.x ?? TARGET_ORBIT_X,
    targetPosition?.y ?? 0,
    targetPosition?.z ?? 1.24
  );

  // Direction vector towards target (along boresight line of sight)
  const forwardDir = targetPos.clone().sub(chaserPos).normalize();
  const upVector = new THREE.Vector3(0, 1, 0);
  const rightVector = new THREE.Vector3().crossVectors(upVector, forwardDir).normalize();
  const realUp = new THREE.Vector3().crossVectors(forwardDir, rightVector).normalize();

  // Offset sensor at physical forward sensor rig coordinates
  // Positioned slightly ahead of chassis (forwardDir * 0.28) to ensure clean unoccluded forward view without clipping
  const sensorWorldPos = chaserPos.clone()
    .add(rightVector.clone().multiplyScalar(config.localPos[0]))
    .add(realUp.clone().multiplyScalar(config.localPos[1]))
    .add(forwardDir.clone().multiplyScalar(0.28));

  // Optical boresight: camera is locked directly facing forward along boresight line of sight (+Z/Target)
  const sensorWorldQuat = new THREE.Quaternion();
  const lookMat = new THREE.Matrix4().lookAt(
    sensorWorldPos,
    targetPos,
    realUp
  );
  sensorWorldQuat.setFromRotationMatrix(lookMat);

  return {
    position: sensorWorldPos,
    quaternion: sensorWorldQuat,
    fov: config.fov,
  };
}

/**
 * Calculates physical Euclidean distance between physical sensor camera & target satellite
 */
export function getSensorToTargetDistance(chaserPosition, targetPosition, sensorName, subType = null) {
  const { position: sensorPos } = getSensorWorldTransform(chaserPosition, sensorName, subType);

  const targetPos = new THREE.Vector3(
    targetPosition?.x ?? TARGET_ORBIT_X,
    targetPosition?.y ?? 0,
    targetPosition?.z ?? 0
  );

  return sensorPos.distanceTo(targetPos);
}
