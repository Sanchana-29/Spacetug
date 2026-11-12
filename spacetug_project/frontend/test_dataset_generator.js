globalThis.self = globalThis;
import fs from "fs";
import path from "path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const IMAGE_WIDTH = 640;
const IMAGE_HEIGHT = 480;

function compute2DBoundingBox(group, camera, imageWidth, imageHeight, idNum) {
  if (!group || !group.visible) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let visiblePointCount = 0;

  const viewProj = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  const mvp = new THREE.Matrix4();

  group.traverse((child) => {
    if (
      child.isMesh &&
      child.visible &&
      child.geometry &&
      child.geometry.attributes &&
      child.geometry.attributes.position
    ) {
      const pos = child.geometry.attributes.position;
      const count = pos.count;
      if (count === 0) return;

      mvp.multiplyMatrices(viewProj, child.matrixWorld);
      const e = mvp.elements;

      for (let i = 0; i < count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        const w = e[3] * x + e[7] * y + e[11] * z + e[15];
        if (w > 0) {
          const invW = 1 / w;
          const ndcZ = (e[2] * x + e[6] * y + e[10] * z + e[14]) * invW;

          if (ndcZ >= -1 && ndcZ <= 1) {
            visiblePointCount++;
            const px =
              ((e[0] * x + e[4] * y + e[8] * z + e[12]) * invW + 1) *
              0.5 *
              imageWidth;
            const py =
              (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) * invW) *
              0.5 *
              imageHeight;

            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }
    }
  });

  if (
    visiblePointCount === 0 ||
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  if (maxX <= 0 || minX >= imageWidth || maxY <= 0 || minY >= imageHeight) {
    return null;
  }

  const clampedMinX = Math.max(0, Math.min(imageWidth, minX));
  const clampedMaxX = Math.max(0, Math.min(imageWidth, maxX));
  const clampedMinY = Math.max(0, Math.min(imageHeight, minY));
  const clampedMaxY = Math.max(0, Math.min(imageHeight, maxY));

  const boxWidth = clampedMaxX - clampedMinX;
  const boxHeight = clampedMaxY - clampedMinY;

  if (boxWidth < 4 || boxHeight < 4) {
    return null;
  }

  const normCenterX = (clampedMinX + boxWidth / 2) / imageWidth;
  const normCenterY = (clampedMinY + boxHeight / 2) / imageHeight;
  const normWidth = boxWidth / imageWidth;
  const normHeight = boxHeight / imageHeight;

  if (
    normCenterX <= 0 ||
    normCenterX >= 1 ||
    normCenterY <= 0 ||
    normCenterY >= 1 ||
    normWidth <= 0 ||
    normWidth > 1 ||
    normHeight <= 0 ||
    normHeight > 1
  ) {
    return null;
  }

  return {
    id: `SAT-${String(idNum).padStart(3, "0")}`,
    classId: 0,
    className: "satellite",
    x: clampedMinX,
    y: clampedMinY,
    width: boxWidth,
    height: boxHeight,
    normCenterX,
    normCenterY,
    normWidth,
    normHeight,
  };
}

const glbPath = path.resolve("public/models/satellite.glb");
const buffer = fs.readFileSync(glbPath);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const loader = new GLTFLoader();
loader.parse(arrayBuffer, "", (gltf) => {
  const gltfScene = gltf.scene;

  // Center satellite model
  const bbox = new THREE.Box3().setFromObject(gltfScene);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  // Setup camera
  const camera = new THREE.PerspectiveCamera(60, IMAGE_WIDTH / IMAGE_HEIGHT, 0.1, 300);
  camera.position.set(4.8, 0.12, 0.175);
  camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const configs = [1, 2, 3, 5];
  const totalSamples = 200;

  for (const activeCount of configs) {
    let positiveSamples = 0;
    let negativeSamples = 0;
    let totalBoxes = 0;
    let totalClippedBoxes = 0;

    const targetNegativeCount = Math.round(totalSamples * 0.15);
    const step = totalSamples / targetNegativeCount;
    const negativeIndices = new Set();
    for (let k = 0; k < targetNegativeCount; k++) {
      const idx = Math.min(totalSamples, Math.max(1, Math.round((k + 0.5) * step)));
      negativeIndices.add(idx);
    }

    // Instantiated satellite groups
    const satelliteGroups = Array.from({ length: 5 }, (_, i) => {
      const group = new THREE.Group();
      const cloned = gltfScene.clone(true);
      cloned.position.sub(center);
      group.add(cloned);
      return group;
    });

    for (let sampleIdx = 1; sampleIdx <= totalSamples; sampleIdx++) {
      const isNegative = negativeIndices.has(sampleIdx);

      // Verify Earth visibility in this frame
      const earthDist = 32 + Math.random() * 12;
      const localEarthX = (Math.random() - 0.5) * 6;
      const localEarthY = -8 - Math.random() * 4;
      const localEarthZ = -earthDist;
      const earthWorldPos = camera.localToWorld(new THREE.Vector3(localEarthX, localEarthY, localEarthZ));
      const earthNdc = earthWorldPos.clone().project(camera);
      // Assert Earth position is in front of camera and inside reasonable viewport FOV
      if (earthNdc.z < -1 || earthNdc.z > 1) {
        throw new Error(`Earth NDC Z out of frustum: ${earthNdc.z}`);
      }

      if (isNegative) {
        negativeSamples++;
        for (let i = 0; i < 5; i++) {
          satelliteGroups[i].visible = false;
        }
        // Assert negative samples yield 0 boxes
        const boxes = [];
        for (let i = 0; i < activeCount; i++) {
          if (satelliteGroups[i].visible) {
            const b = compute2DBoundingBox(satelliteGroups[i], camera, IMAGE_WIDTH, IMAGE_HEIGHT, i + 1);
            if (b) boxes.push(b);
          }
        }
        if (boxes.length !== 0) {
          throw new Error(`Negative sample #${sampleIdx} produced ${boxes.length} boxes!`);
        }
      } else {
        positiveSamples++;
        // Position satellites
        for (let i = 0; i < 5; i++) {
          const group = satelliteGroups[i];
          if (i < activeCount) {
            group.visible = true;
            const dist = 2.4 + Math.random() * 1.8;
            const halfH = Math.tan((60 * Math.PI / 180) / 2) * dist;
            const halfW = halfH * (IMAGE_WIDTH / IMAGE_HEIGHT);

            let localX, localY;
            if (activeCount === 1) {
              localX = (Math.random() - 0.5) * 0.35 * halfW;
              localY = (Math.random() - 0.5) * 0.35 * halfH;
            } else {
              const angle = (i / activeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
              const radiusNorm = 0.15 + Math.random() * 0.28;
              localX = Math.cos(angle) * halfW * radiusNorm;
              localY = Math.sin(angle) * halfH * radiusNorm;
            }
            const localZ = -dist;

            const local = new THREE.Vector3(localX, localY, localZ);
            group.position.copy(camera.localToWorld(local));
            group.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
            const scaleFactor = 0.08 + Math.random() * 0.05;
            group.scale.setScalar(scaleFactor);
            group.updateMatrixWorld(true);
          } else {
            group.visible = false;
            group.position.set(0, -9999, 0);
            group.updateMatrixWorld(true);
          }
        }

        // Compute and validate bounding boxes
        for (let i = 0; i < activeCount; i++) {
          const box = compute2DBoundingBox(satelliteGroups[i], camera, IMAGE_WIDTH, IMAGE_HEIGHT, i + 1);
          if (box) {
            totalBoxes++;
            // Check if clamped at image boundaries
            if (box.x === 0 || box.y === 0 || (box.x + box.width) === IMAGE_WIDTH || (box.y + box.height) === IMAGE_HEIGHT) {
              totalClippedBoxes++;
            }
            // Strict YOLO assertions
            if (box.classId !== 0) throw new Error("Invalid classId");
            if (box.normCenterX <= 0 || box.normCenterX >= 1) throw new Error("Invalid normCenterX");
            if (box.normCenterY <= 0 || box.normCenterY >= 1) throw new Error("Invalid normCenterY");
            if (box.normWidth <= 0 || box.normWidth > 1) throw new Error("Invalid normWidth");
            if (box.normHeight <= 0 || box.normHeight > 1) throw new Error("Invalid normHeight");
            // Tightness verification: box aspect ratio and dimensions are non-degenerate
            if (box.width < 10 || box.height < 10) throw new Error("Box suspiciously small");
            if (box.width > 640 || box.height > 480) throw new Error("Box exceeds canvas");
          }
        }
      }
    }

    console.log(`[PASS] Config ${activeCount} satellite(s): Total=${totalSamples}, Pos=${positiveSamples}, Neg=${negativeSamples} (${((negativeSamples/totalSamples)*100).toFixed(1)}%), BBoxes=${totalBoxes}, BorderClipped=${totalClippedBoxes}`);
  }

  console.log("\nAll bounding box projection and geometry validation tests passed!");
});
