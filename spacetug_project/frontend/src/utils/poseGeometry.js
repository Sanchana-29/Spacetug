import * as THREE from "three";

/**
 * Single source of truth 3D landmarks for SAT-001 (satellite.glb).
 * Object-frame coordinates at model scale 0.08.
 */
export const TARGET_LANDMARKS_3D = {
  solar_panel_right_tip: [-0.0044, -0.1416, -0.2182],
  solar_panel_left_tip: [0.2078, -0.1301, -0.0870],
  solar_panel_top_edge: [0.2120, 0.0652, -0.1293],
  chassis_top_front_corner: [0.0121, 0.0629, -0.0251],
  chassis_bottom_rear_base: [0.1643, 0.0127, -0.2668],
  primary_dish_center: [-0.0075, 0.0027, 0.0119],
  optical_lens_center: [-0.0520, 0.0186, 0.0825],
};

export const LANDMARK_SCALE = 0.08;

/**
 * Builds 3x3 camera matrix matching Three.js PerspectiveCamera intrinsics.
 * Vertical FOV is used by Three.js (camera.fov in degrees).
 */
export function getCameraIntrinsicsMatrix(width, height, verticalFovDegrees = 60.0) {
  const fovRad = THREE.MathUtils.degToRad(verticalFovDegrees);
  const fy = height / (2.0 * Math.tan(fovRad / 2.0));
  const fx = fy; // square pixels
  const cx = width / 2.0;
  const cy = height / 2.0;

  return [
    [fx, 0.0, cx],
    [0.0, fy, cy],
    [0.0, 0.0, 1.0],
  ];
}

/**
 * Projects 3D model landmarks to 2D image coordinates (u, v) in pixels.
 * Uses camera.matrixWorldInverse and camera.projectionMatrix.
 * Adds optional Gaussian noise in pixels.
 */
export function projectLandmarksToPixels(
  camera,
  targetMeshWorldMatrix,
  width,
  height,
  noiseSigmaPx = 0.0
) {
  const projected = {};
  const inFrustum = {};

  const v = new THREE.Vector3();

  for (const [id, coords] of Object.entries(TARGET_LANDMARKS_3D)) {
    // 1. Model point scaled by LANDMARK_SCALE (0.08)
    v.set(coords[0] * LANDMARK_SCALE, coords[1] * LANDMARK_SCALE, coords[2] * LANDMARK_SCALE);

    // 2. Transform model point to World space via target matrixWorld
    if (targetMeshWorldMatrix) {
      v.applyMatrix4(targetMeshWorldMatrix);
    }

    // 3. Project to Normalized Device Coordinates (NDC: [-1, 1])
    v.project(camera);

    // Check if behind camera or outside view frustum
    const isVisible = v.z < 1.0 && v.x >= -1.1 && v.x <= 1.1 && v.y >= -1.1 && v.y <= 1.1;

    // 4. Map NDC to pixel space: x in [0, width], y in [0, height] (y downwards)
    let px = ((v.x + 1.0) / 2.0) * width;
    let py = ((-v.y + 1.0) / 2.0) * height;

    // 5. Add Gaussian noise if requested
    if (noiseSigmaPx > 0) {
      // Box-Muller transform for Gaussian distribution
      const u1 = Math.max(1e-7, Math.random());
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
      px += z0 * noiseSigmaPx;
      py += z1 * noiseSigmaPx;
    }

    projected[id] = [Number(px.toFixed(2)), Number(py.toFixed(2))];
    inFrustum[id] = isVisible;
  }

  return { projected, inFrustum };
}

/**
 * Computes Ground Truth target pose in OpenCV Camera coordinate system:
 * Three.js Camera frame: +X Right, +Y Up, +Z Backward
 * OpenCV Camera frame:   +X Right, +Y Down, +Z Forward
 * Transform: diag(1, -1, -1)
 */
export function getOpenCvGroundTruthPose(camera, targetMeshWorldMatrix) {
  if (!camera || !targetMeshWorldMatrix) return null;

  camera.updateMatrixWorld(true);

  // Relative matrix: T_cam_target = camera.matrixWorldInverse * targetMeshWorldMatrix
  const relMatrix = new THREE.Matrix4();
  relMatrix.multiplyMatrices(camera.matrixWorldInverse, targetMeshWorldMatrix);

  // Decompose into Translation and Rotation in Three.js Camera frame
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  relMatrix.decompose(pos, quat, scale);

  const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(quat);
  const te = rotMat.elements;

  // Convert Three.js to OpenCV coordinate frame using diag(1, -1, -1):
  // R_cv = C * R_three * C, where C = diag(1, -1, -1)
  // t_cv = C * t_three = [pos.x, -pos.y, -pos.z]
  const t_cv = {
    x: Number(pos.x.toFixed(5)),
    y: Number((-pos.y).toFixed(5)),
    z: Number((-pos.z).toFixed(5)),
  };

  const R_cv = [
    [Number(te[0].toFixed(5)), Number((-te[4]).toFixed(5)), Number((-te[8]).toFixed(5))],
    [Number((-te[1]).toFixed(5)), Number(te[5].toFixed(5)), Number(te[9].toFixed(5))],
    [Number((-te[2]).toFixed(5)), Number(te[6].toFixed(5)), Number(te[10].toFixed(5))],
  ];

  return {
    position: t_cv,
    rotation_matrix: R_cv,
    range_m: Number(pos.length().toFixed(4)),
  };
}
