import * as THREE from "three";

/**
 * 3D landmarks of SAT-001, taken from real mesh vertices of satellite.glb
 * (glTF scene-root frame, model units). Identical to
 * backend/cv/target_pose_landmarks.json, which is the single source of truth
 * (served by GET /api/pose/landmarks). This copy is only a fallback when the
 * backend is offline.
 *
 * The target group in the scene is scaled by LANDMARK_SCALE (0.08), so
 * world point = targetGroup.matrixWorld * modelPoint   (scale already included)
 * OpenCV object point = modelPoint * LANDMARK_SCALE    (metres)
 */
export const TARGET_LANDMARKS_3D = {
  solar_panel_right_tip_upper: [7.8909, 1.0933, 1.6304],
  solar_panel_right_tip_lower: [7.7388, -1.3544, 2.0907],
  solar_panel_left_tip_upper: [-5.0413, 0.3929, -6.3679],
  solar_panel_left_tip_lower: [-5.1934, -2.0548, -5.9076],
  antenna_dish_top: [-0.1486, 1.5396, 0.1054],
  primary_dish_center: [-0.1299, 0.0459, 0.2036],
  optical_lens_center: [-0.5894, 0.2065, 0.9408],
  chassis_rear_base: [1.7858, -0.7233, -3.8801],
  chassis_side_panel: [2.4542, -0.4254, -1.4473],
};

export const LANDMARK_SCALE = 0.08;

/** Convert the /api/pose/landmarks response into { id: [x, y, z] }. */
export function landmarksFromApi(apiData) {
  if (!apiData?.landmarks_3d) return null;
  const out = {};
  for (const [id, p] of Object.entries(apiData.landmarks_3d)) {
    if (Array.isArray(p) && p.length === 3) out[id] = p.map(Number);
  }
  return Object.keys(out).length >= 4 ? out : null;
}

/**
 * 3x3 OpenCV camera matrix matching a Three.js PerspectiveCamera.
 * Three.js camera.fov is the VERTICAL field of view.
 */
export function getCameraIntrinsicsMatrix(width, height, verticalFovDegrees = 60.0) {
  const fovRad = THREE.MathUtils.degToRad(verticalFovDegrees);
  const fy = height / (2.0 * Math.tan(fovRad / 2.0));
  const fx = fy; // square pixels (camera.aspect === width / height)
  return [
    [fx, 0.0, width / 2.0],
    [0.0, fy, height / 2.0],
    [0.0, 0.0, 1.0],
  ];
}

/**
 * Project the 3D landmarks to pixel coordinates (u right, v down, origin top-left),
 * WITHOUT noise. Also reports whether each landmark is inside the image and
 * whether it is hidden behind the spacecraft body (raycast against target meshes).
 */
export function projectLandmarksToPixels(
  camera,
  targetObject,
  width,
  height,
  landmarks = TARGET_LANDMARKS_3D
) {
  const points = {};
  const inImage = {};
  const occluded = {};

  if (!camera || !targetObject) return { points, inImage, occluded };

  camera.updateMatrixWorld(true);
  targetObject.updateMatrixWorld(true);

  const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const raycaster = new THREE.Raycaster();
  const meshes = [];
  targetObject.traverse((c) => {
    if (c.isMesh && c.visible) meshes.push(c);
  });

  for (const [id, coords] of Object.entries(landmarks)) {
    // Model point -> world (matrixWorld already contains the 0.08 scale)
    const world = new THREE.Vector3(coords[0], coords[1], coords[2]).applyMatrix4(
      targetObject.matrixWorld
    );

    // World -> camera space; points behind the camera (z >= 0 in Three.js) are invalid
    const camSpace = world.clone().applyMatrix4(camera.matrixWorldInverse);
    const ndc = world.clone().project(camera);

    const u = ((ndc.x + 1.0) / 2.0) * width;
    const v = ((1.0 - ndc.y) / 2.0) * height;

    points[id] = [Number(u.toFixed(3)), Number(v.toFixed(3))];
    inImage[id] = camSpace.z < 0 && u >= 0 && u <= width && v >= 0 && v <= height;

    // Occlusion: is any target surface hit before reaching the landmark?
    let hidden = false;
    if (meshes.length > 0 && inImage[id]) {
      const dir = world.clone().sub(camPos);
      const dist = dir.length();
      raycaster.set(camPos, dir.normalize());
      raycaster.far = dist;
      const hits = raycaster.intersectObjects(meshes, false);
      // Tolerance: 2% of range, so the landmark's own surface does not count
      hidden = hits.some((h) => h.distance < dist * 0.98);
    }
    occluded[id] = hidden;
  }

  return { points, inImage, occluded };
}

/** Standard normal sample (Box-Muller). */
function gaussian() {
  const u1 = Math.max(1e-12, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Build the image_points dict that is sent to solvePnP.
 * - keeps only landmarks inside the image (and not occluded, if requested)
 * - adds Gaussian pixel noise with std = noiseSigmaPx to simulate detector error
 */
export function buildImagePoints(capture, { noiseSigmaPx = 0, excludeOccluded = true } = {}) {
  const out = {};
  const geo = capture?.landmarks;
  if (!geo?.points) return out;

  for (const [id, [u, v]] of Object.entries(geo.points)) {
    if (!geo.inImage?.[id]) continue;
    if (excludeOccluded && geo.occluded?.[id]) continue;
    const s = Number(noiseSigmaPx) || 0;
    out[id] = [u + (s > 0 ? gaussian() * s : 0), v + (s > 0 ? gaussian() * s : 0)];
  }
  return out;
}

/**
 * Ground-truth pose of the target in the OpenCV camera frame.
 * Three.js camera frame: +X right, +Y up,   +Z backward
 * OpenCV camera frame:   +X right, +Y down, +Z forward
 * With C = diag(1, -1, -1) applied to the CAMERA side only:
 *   R_cv = C * R_three      t_cv = C * t_three
 * (the object/model frame is not changed, it is the same frame used by solvePnP)
 */
export function getOpenCvGroundTruthPose(camera, targetObject) {
  if (!camera || !targetObject) return null;

  camera.updateMatrixWorld(true);
  targetObject.updateMatrixWorld(true);

  const rel = new THREE.Matrix4().multiplyMatrices(
    camera.matrixWorldInverse,
    targetObject.matrixWorld
  );

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  rel.decompose(pos, quat, scl); // removes the 0.08 model scale

  const te = new THREE.Matrix4().makeRotationFromQuaternion(quat).elements; // column-major
  const R = [
    [te[0], te[4], te[8]],
    [te[1], te[5], te[9]],
    [te[2], te[6], te[10]],
  ];

  const r5 = (x) => Number(x.toFixed(6));
  return {
    position: { x: r5(pos.x), y: r5(-pos.y), z: r5(-pos.z) },
    rotation_matrix: [
      R[0].map(r5),
      R[1].map((x) => r5(-x)),
      R[2].map((x) => r5(-x)),
    ],
    range_m: Number(pos.length().toFixed(4)),
  };
}
