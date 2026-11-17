"""
Phase 3 - Multi-frame object tracking (SORT-style).

Each track has a constant-velocity Kalman filter on its bounding box
(centre x, centre y, width, height + their velocities). For every new frame:
  1. predict all tracks,
  2. associate detections to predictions by IoU (Hungarian algorithm),
  3. update matched tracks, create tracks for unmatched detections,
  4. delete tracks not seen for `max_age` frames.
A track is "confirmed" after `min_hits` consecutive matches, so a single
false detection does not get an ID.

Track IDs are persistent integers per session, shown as TRK-01, TRK-02, ...
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

try:
    from scipy.optimize import linear_sum_assignment
except Exception:  # pragma: no cover - scipy is in requirements, greedy fallback just in case
    linear_sum_assignment = None


def iou_xyxy(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pairwise IoU between boxes a (N,4) and b (M,4) in x1,y1,x2,y2."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / np.maximum(area_a[:, None] + area_b[None, :] - inter, 1e-9)


def _xyxy_to_z(b):
    w, h = b[2] - b[0], b[3] - b[1]
    return np.array([b[0] + w / 2.0, b[1] + h / 2.0, w, h], dtype=float)


def _x_to_xyxy(x):
    cx, cy, w, h = x[:4]
    w, h = max(w, 1.0), max(h, 1.0)
    return np.array([cx - w / 2.0, cy - h / 2.0, cx + w / 2.0, cy + h / 2.0])


class KalmanBoxTrack:
    """Constant-velocity Kalman filter on [cx, cy, w, h, vcx, vcy, vw, vh]."""

    def __init__(self, bbox, track_id: int, confidence: float, frame_index: int):
        self.x = np.zeros(8)
        self.x[:4] = _xyxy_to_z(bbox)
        self.P = np.diag([10.0, 10.0, 10.0, 10.0, 1000.0, 1000.0, 1000.0, 1000.0])
        self.F = np.eye(8)
        self.F[:4, 4:] = np.eye(4)
        self.H = np.zeros((4, 8))
        self.H[:, :4] = np.eye(4)
        self.Q = np.diag([1.0, 1.0, 1.0, 1.0, 0.5, 0.5, 0.5, 0.5])
        self.R = np.diag([4.0, 4.0, 9.0, 9.0])

        self.id = track_id
        self.confidence = float(confidence)
        self.hits = 1
        self.hit_streak = 1
        self.age = 1
        self.time_since_update = 0
        self.first_frame = frame_index
        self.history: List[List[float]] = [list(map(float, self.center()))]

    def center(self):
        return self.x[0], self.x[1]

    def predict(self):
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q
        self.age += 1
        if self.time_since_update > 0:
            self.hit_streak = 0
        self.time_since_update += 1
        return _x_to_xyxy(self.x)

    def update(self, bbox, confidence):
        z = _xyxy_to_z(bbox)
        y = z - self.H @ self.x
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        self.x = self.x + K @ y
        self.P = (np.eye(8) - K @ self.H) @ self.P
        self.confidence = float(confidence)
        self.hits += 1
        self.hit_streak += 1
        self.time_since_update = 0
        self.history.append(list(map(float, self.center())))
        self.history = self.history[-30:]

    def bbox(self):
        return _x_to_xyxy(self.x)


class SortTracker:
    def __init__(self, iou_threshold: float = 0.3, max_age: int = 5, min_hits: int = 2):
        self.iou_threshold = iou_threshold
        self.max_age = max_age
        self.min_hits = min_hits
        self.tracks: List[KalmanBoxTrack] = []
        self.next_id = 1
        self.frame_index = 0
        # metrics for the main target (highest-confidence confirmed track)
        self.primary_ids: List[Optional[int]] = []
        self.id_switches = 0

    def reset(self):
        self.__init__(self.iou_threshold, self.max_age, self.min_hits)

    def _associate(self, dets: np.ndarray, preds: np.ndarray):
        if len(dets) == 0 or len(preds) == 0:
            return [], list(range(len(dets))), list(range(len(preds)))
        iou = iou_xyxy(dets, preds)
        if linear_sum_assignment is not None:
            rows, cols = linear_sum_assignment(-iou)
            pairs = list(zip(rows.tolist(), cols.tolist()))
        else:  # greedy fallback
            pairs, used_r, used_c = [], set(), set()
            for r, c in sorted(np.ndindex(iou.shape), key=lambda rc: -iou[rc]):
                if r not in used_r and c not in used_c:
                    pairs.append((r, c)); used_r.add(r); used_c.add(c)
        matches = [(r, c) for r, c in pairs if iou[r, c] >= self.iou_threshold]
        md = {r for r, _ in matches}
        mt = {c for _, c in matches}
        return matches, [i for i in range(len(dets)) if i not in md], [j for j in range(len(preds)) if j not in mt]

    def update(self, detections: List[dict]) -> List[dict]:
        """
        detections: [{"bbox": [x1,y1,x2,y2], "confidence": float, "class_name": str}, ...]
        Returns confirmed tracks seen in this frame.
        """
        self.frame_index += 1
        preds = np.array([t.predict() for t in self.tracks]) if self.tracks else np.zeros((0, 4))
        dets = np.array([d["bbox"] for d in detections], dtype=float) if detections else np.zeros((0, 4))

        matches, unmatched_d, _ = self._associate(dets, preds)
        for di, ti in matches:
            self.tracks[ti].update(dets[di], detections[di].get("confidence", 0.0))
        for di in unmatched_d:
            self.tracks.append(KalmanBoxTrack(dets[di], self.next_id, detections[di].get("confidence", 0.0),
                                              self.frame_index))
            self.next_id += 1
        self.tracks = [t for t in self.tracks if t.time_since_update <= self.max_age]

        out = []
        for t in self.tracks:
            confirmed = t.hits >= self.min_hits
            if t.time_since_update == 0 and confirmed:
                b = t.bbox()
                out.append({
                    "track_id": f"TRK-{t.id:02d}",
                    "track_number": t.id,
                    "bbox": [round(float(v), 1) for v in b],
                    "confidence": round(t.confidence, 4),
                    "age_frames": int(t.age),
                    "hits": int(t.hits),
                    "trail": [[round(x, 1), round(y, 1)] for x, y in t.history[-15:]],
                })

        primary = max(out, key=lambda o: o["confidence"])["track_number"] if out else None
        last_known = next((p for p in reversed(self.primary_ids) if p is not None), None)
        if primary is not None and last_known is not None and primary != last_known:
            self.id_switches += 1
        self.primary_ids.append(primary)
        return out

    def metrics(self) -> Dict:
        seen = [p for p in self.primary_ids if p is not None]
        if not seen:
            return {"frames": self.frame_index, "frames_tracked": 0, "id_switches": 0,
                    "id_consistency_pct": None, "primary_track": None}
        values, counts = np.unique(seen, return_counts=True)
        main = int(values[np.argmax(counts)])
        return {
            "frames": self.frame_index,
            "frames_tracked": len(seen),
            "id_switches": self.id_switches,
            "id_consistency_pct": round(100.0 * counts.max() / len(seen), 1),
            "primary_track": f"TRK-{main:02d}",
        }
